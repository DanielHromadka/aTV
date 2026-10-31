import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { BrowserCommand, BrowserEvent, BrowserKey, BrowserState } from '../shared/protocol.ts'
import type { ServerResponse } from 'node:http'
import { BrowserAv, avEnv, avSupported } from './browser-av.ts'

/** Where Chrome or Chromium usually lives; CHROME_PATH wins. */
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
]

export function findChrome(env = process.env): string | undefined {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : undefined
  return CANDIDATES.find((p) => existsSync(p))
}

const WIDTH = 1280
const HEIGHT = 720
const IDLE_MS = 10 * 60_000

const KEYS: Record<BrowserKey, { code: number; text?: string }> = {
  Enter: { code: 13, text: '\r' },
  Backspace: { code: 8 },
  Tab: { code: 9 },
  Escape: { code: 27 },
  ArrowLeft: { code: 37 },
  ArrowUp: { code: 38 },
  ArrowRight: { code: 39 },
  ArrowDown: { code: 40 },
}

// Pages that open new windows (target=_blank, window.open) stay in the one tab the TV shows.
const SAME_TAB = `
  window.open = function (u) { if (u) location.href = u; return null };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
    if (a) a.target = '_self';
  }, true);
`

/**
 * aTV's own browser: a headless Chrome on the hub, one tab, shared by every TV that shows it.
 * The TV gets JPEG frames from Chrome's screencast and sends mouse, wheel, keys and text back.
 * Chrome starts with the first viewer and quits ten minutes after the last one left.
 */
export class RemoteBrowser {
  private chrome?: ChildProcess
  private page?: WebSocket
  private starting?: Promise<void>
  private seq = 0
  private readonly pending = new Map<number, (r: { result?: Record<string, unknown>; error?: { message: string } }) => void>()
  private readonly viewers = new Set<WebSocket>()
  private lastFrame?: Buffer
  private state: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
  private idle?: NodeJS.Timeout
  private readonly path: string
  private readonly profile: string
  private readonly port: number
  /** With a virtual screen and sound card (Docker), the TV can also watch the page as video with sound. */
  readonly av?: BrowserAv

  constructor(chromePath: string, dataDir: string, port = 9444) {
    this.path = chromePath
    this.profile = join(dataDir, 'browser-profile')
    this.port = port
    if (avSupported()) this.av = new BrowserAv(WIDTH, HEIGHT)
  }

  /** Serves the video-with-sound stream; the browser starts first if nobody had it open. */
  async serveAv(file: string, res: ServerResponse): Promise<void> {
    if (!this.av) {
      res.writeHead(404).end()
      return
    }
    await this.av.serve(file, res, () => this.start())
  }

  /** A TV opened the browser: start Chrome if needed and send it the current picture and state. */
  async attach(ws: WebSocket): Promise<void> {
    this.viewers.add(ws)
    clearTimeout(this.idle)
    ws.on('close', () => {
      this.viewers.delete(ws)
      if (!this.viewers.size) {
        this.idle = setTimeout(() => this.stop(), IDLE_MS)
        this.idle.unref()
      }
    })
    ws.on('message', (data, binary) => {
      if (binary) return
      let cmd: BrowserCommand
      try {
        cmd = JSON.parse(String(data)) as BrowserCommand
      } catch {
        return
      }
      this.command(cmd).catch((e: Error) => this.sendTo(ws, { t: 'error', message: e.message }))
    })
    try {
      await this.start()
    } catch (e) {
      this.sendTo(ws, { t: 'error', message: `Prohlížeč se nespustil: ${(e as Error).message}` })
      return
    }
    this.sendTo(ws, { t: 'state', state: this.state })
    if (this.lastFrame) ws.send(this.lastFrame)
  }

  private sendTo(ws: WebSocket, msg: BrowserEvent): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  private broadcast(msg: BrowserEvent): void {
    for (const ws of this.viewers) this.sendTo(ws, msg)
  }

  private start(): Promise<void> {
    if (this.page?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.starting ??= this.launch().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async launch(): Promise<void> {
    mkdirSync(this.profile, { recursive: true })
    // A Chrome whose page went away is replaced, not doubled.
    this.chrome?.kill()
    // A previous Chrome that crashed leaves a lock behind that stops the next one from starting.
    for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(this.profile, lock), { force: true })
    if (this.av) await this.av.ensureDisplay()
    const args = [
      ...(this.av
        ? // A real window on the virtual screen, playing into the virtual sound card that ffmpeg records.
          ['--kiosk', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage']
        : // The hub's speakers are not the TV's; screencast carries no sound anyway.
          ['--headless=new', '--mute-audio']),
      `--remote-debugging-port=${this.port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${this.profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // Containers have no user namespaces for Chrome's sandbox.
      ...(existsSync('/.dockerenv') ? ['--no-sandbox'] : []),
      'about:blank',
    ]
    this.chrome = spawn(this.path, args, { stdio: 'ignore', env: this.av ? avEnv() : process.env })
    const chrome = this.chrome
    chrome.on('exit', () => {
      // Only the current Chrome's exit matters; a replaced one may exit after its successor started.
      if (this.chrome !== chrome) return
      this.chrome = undefined
      this.page?.close()
    })

    let pageUrl: string | undefined
    for (let i = 0; i < 50 && !pageUrl; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const list = (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
        pageUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
      } catch {
        // Not listening yet.
      }
    }
    if (!pageUrl) throw new Error('Chrome neodpověděl')

    const page = new WebSocket(pageUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
    await new Promise<void>((resolve, reject) => {
      page.once('open', () => resolve())
      page.once('error', reject)
    })
    this.page = page
    page.on('message', (d) => this.onCdp(JSON.parse(String(d)) as CdpMessage))
    page.on('close', () => {
      if (this.page === page) this.page = undefined
    })

    await this.cdp('Page.enable')
    await this.cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
    await this.cdp('Page.addScriptToEvaluateOnNewDocument', { source: SAME_TAB })
    await this.cdp('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    await this.cdp('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 })
    console.log('[browser] Chrome started')
  }

  private cdp(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const page = this.page
    if (!page || page.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Prohlížeč neběží'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, (r) => (r.error ? reject(new Error(r.error.message)) : resolve(r.result ?? {})))
      page.send(JSON.stringify({ id, method, params }))
    })
  }

  private onCdp(m: CdpMessage): void {
    if (m.id !== undefined) {
      this.pending.get(m.id)?.(m)
      this.pending.delete(m.id)
      return
    }
    switch (m.method) {
      case 'Page.screencastFrame': {
        const p = m.params as { data: string; sessionId: number }
        void this.cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
        const frame = Buffer.from(p.data, 'base64')
        this.lastFrame = frame
        for (const ws of this.viewers) {
          // A slow TV skips frames instead of falling behind.
          if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1_000_000) ws.send(frame)
        }
        break
      }
      case 'Page.javascriptDialogOpening':
        // Nobody can answer an alert() on the TV; accept it so the page goes on.
        void this.cdp('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
        break
      case 'Page.frameStartedLoading':
        this.setState({ loading: true })
        break
      case 'Page.frameStoppedLoading':
      case 'Page.loadEventFired':
      case 'Page.navigatedWithinDocument':
      case 'Page.frameNavigated':
        void this.refreshState(m.method === 'Page.frameNavigated' ? undefined : false)
        if (m.method === 'Page.loadEventFired') void this.checkPage().catch(() => {})
        break
    }
  }

  private async checkPage(): Promise<void> {
    const result = await this.cdp('Runtime.evaluate', {
      expression: `location.protocol.startsWith('http') && !!document.body && document.body.childElementCount === 0 && !document.body.textContent.trim()`,
      returnByValue: true,
    })
    if ((result.result as { value?: boolean } | undefined)?.value) {
      this.broadcast({ t: 'error', message: 'Web vrátil prázdnou stránku. Zkuste Obnovit nebo otevřete jiný web.' })
    }
  }

  private setState(patch: Partial<BrowserState>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast({ t: 'state', state: this.state })
  }

  private async refreshState(loading?: boolean): Promise<void> {
    const h = (await this.cdp('Page.getNavigationHistory').catch(() => null)) as { currentIndex: number; entries: { url: string; title: string }[] } | null
    if (!h) return
    const entry = h.entries[h.currentIndex]
    this.setState({
      url: entry?.url === 'about:blank' ? '' : entry?.url ?? '',
      title: entry?.title ?? '',
      canGoBack: h.currentIndex > 0 && h.entries[h.currentIndex - 1]?.url !== 'about:blank',
      canGoForward: h.currentIndex < h.entries.length - 1,
      ...(loading !== undefined ? { loading } : {}),
    })
  }

  private async go(delta: number): Promise<void> {
    const h = (await this.cdp('Page.getNavigationHistory')) as { currentIndex: number; entries: { id: number }[] }
    const entry = h.entries[h.currentIndex + delta]
    if (entry) await this.cdp('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  private async command(cmd: BrowserCommand): Promise<void> {
    await this.start()
    const at = (x: number, y: number) => ({ x: Math.round(clamp01(x) * WIDTH), y: Math.round(clamp01(y) * HEIGHT) })
    switch (cmd.t) {
      case 'open': {
        // Only web pages: no file://, chrome:// or javascript: from a TV.
        if (typeof cmd.url !== 'string' || !/^https?:\/\/\S+$/i.test(cmd.url)) throw new Error('Neplatná adresa')
        const result = await this.cdp('Page.navigate', { url: cmd.url })
        if (result.errorText) throw new Error(`Stránku se nepodařilo načíst (${String(result.errorText)})`)
        break
      }
      case 'back':
        await this.go(-1)
        break
      case 'forward':
        await this.go(1)
        break
      case 'reload':
        await this.cdp('Page.reload')
        break
      case 'mouse': {
        const p = at(cmd.x, cmd.y)
        if (cmd.kind === 'move') {
          await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p })
        } else {
          await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 })
          await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 })
        }
        break
      }
      case 'wheel':
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at(cmd.x, cmd.y), deltaX: 0, deltaY: Math.max(-2000, Math.min(2000, Number(cmd.dy) || 0)) })
        break
      case 'key': {
        const k = KEYS[cmd.key]
        if (!k) return
        // Shift+Tab moves focus back; CDP's modifier bit 8 is Shift.
        const modifiers = cmd.shift ? 8 : 0
        await this.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: cmd.key, windowsVirtualKeyCode: k.code, modifiers })
        if (k.text) await this.cdp('Input.dispatchKeyEvent', { type: 'char', text: k.text, key: cmd.key, modifiers })
        await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: cmd.key, windowsVirtualKeyCode: k.code, modifiers })
        break
      }
      case 'text':
        if (typeof cmd.text === 'string' && cmd.text.length <= 2000) await this.cdp('Input.insertText', { text: cmd.text })
        break
    }
  }

  stop(): void {
    this.av?.stopStream()
    this.page?.close()
    this.chrome?.kill()
    this.chrome = undefined
    this.lastFrame = undefined
    console.log('[browser] Chrome stopped')
  }
}

interface CdpMessage {
  id?: number
  method?: string
  params?: unknown
  result?: Record<string, unknown>
  error?: { message: string }
}

const clamp01 = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
