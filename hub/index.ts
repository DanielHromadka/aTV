import { Art } from './art.ts'
import { Musicians } from './musicians.ts'
import { Jackett } from './jackett.ts'
import { Actors } from './actors.ts'
// aTV hub: serves the TV app and the phone remote, relays between them, and does what a
// sandboxed TV app cannot (Samsung control, Wake-on-LAN, secrets for Immich, Home Assistant, Claude).
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { APPS, findApp } from '../shared/apps.ts'
import { applyAppearance, type Appearance } from '../shared/appearance.ts'
import { describeIntent, parseCommand, type Intent } from '../shared/intents.ts'
import { ACTIONS } from '../shared/keys.ts'
import type { AppearanceMessage, HubToRemote, HubToTv, TvState } from '../shared/protocol.ts'
import { Backgrounds } from './backgrounds.ts'
import { RemoteBrowser } from './browser.ts'
import { Catalog } from './catalog.ts'
import { loadConfig, publicConfig } from './config.ts'
import { HomeAssistant, Immich, Iptv } from './integrations.ts'
import { interpretWithClaude } from './llm.ts'
import { Media } from './media.ts'
import { SAMSUNG_ACTION_KEYS, SAMSUNG_KEYS, SamsungTv } from './samsung.ts'
import { PairingCode, safeEqual, Store } from './store.ts'
import { Torrents } from './torrents.ts'
import { Ivysilani } from './ivysilani.ts'
import { Downloads } from './downloads.ts'

/** aTV's own Tizen app id (platforms/tizen/config.xml), started when a command needs the TV app. */
const ATV_TIZEN_ID = 'aTVattoSft.aTV'

const config = loadConfig()
const art = new Art(config.dataDir)
const musicians = new Musicians(config.dataDir)
const actors = config.tmdbApiKey ? new Actors(config.tmdbApiKey, fetch, config.dataDir) : undefined
const store = new Store(config.dataDir)
const backgrounds = new Backgrounds(config.dataDir, store.state.backgrounds, () => store.save())
const samsung = config.samsung
  ? new SamsungTv({
      ...config.samsung,
      token: store.state.samsungToken,
      onToken: (token) => {
        store.state.samsungToken = token
        store.save()
      },
    })
  : undefined
const iptv = config.iptv ? new Iptv(config.iptv.playlist, config.dataDir) : undefined
const immich = config.immich ? new Immich(config.immich) : undefined
const homeAssistant = config.homeAssistant ? new HomeAssistant(config.homeAssistant) : undefined
const torrents = new Torrents(config.dataDir)
const browser = config.chromePath ? new RemoteBrowser(config.chromePath, config.dataDir) : undefined
const browserWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
browserWss.on('connection', (ws) => {
  if (!browser) return ws.close()
  void browser.attach(ws)
})
const ivysilani = new Ivysilani()
const media = new Media(new Catalog(config.dataDir), torrents, config.port, config.jackett ? new Jackett(config.jackett, config.dataDir) : undefined)

const tvs = new Set<WebSocket>()
/** aTV web apps in desktop browsers: they share the look, pairing code and sleep timer, not remote input. */
const webs = new Set<WebSocket>()
/** Platform each TV app reported; decides whether remote input goes to the Samsung itself. */
const tvPlatforms = new Map<WebSocket, string>()
const remotes = new Set<WebSocket>()
let tvState: TvState | null = null
let sleep: { endsAt: number; timer: NodeJS.Timeout } | null = null
/** Intents waiting for the TV app to start (after a command woke the TV); dropped after a minute. */
let pending: { intent: Intent; at: number }[] = []

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return 'localhost'
}
const publicUrl = (config.publicUrl ?? `http://${lanAddress()}:${config.port}`).replace(/\/+$/, '')

/** The address each TV used to reach the hub; phones on the same network can use it too. */
const tvBase = new Map<WebSocket, string>()

/**
 * The phone link for the QR code: the configured public URL, else the address the TV connected to
 * (inside Docker the hub's own interfaces are container addresses no phone can reach).
 */
function pairingUrl(code: string, ws?: WebSocket): string {
  const base = config.publicUrl ? publicUrl : (ws && tvBase.get(ws)) || publicUrl
  return `${base}/remote.html#code=${code}`
}

const pairing = new PairingCode((code) => {
  for (const ws of [...tvs, ...webs]) send(ws, { t: 'pairing', code, url: pairingUrl(code, ws) })
})

function send(ws: WebSocket, msg: HubToTv | HubToRemote): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
function toTvs(msg: HubToTv): void {
  for (const ws of tvs) send(ws, msg)
}
/** TVs and web apps: what every screen shows (look, sleep timer, notices). */
function toScreens(msg: HubToTv): void {
  for (const ws of [...tvs, ...webs]) send(ws, msg)
}

/** Asks Jellyfin to scan its libraries; without an API key the TVs do it with their own login. */
async function refreshJellyfin(): Promise<void> {
  if (config.jellyfinUrl && config.jellyfinApiKey) {
    const res = await fetch(`${config.jellyfinUrl.replace(/\/+$/, '')}/Library/Refresh`, {
      method: 'POST',
      headers: { 'X-Emby-Token': config.jellyfinApiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (res?.ok) return
    console.warn('[download] Jellyfin refresh failed; the TV will try')
  }
  toTvs({ t: 'library-updated' })
}

media.downloads = new Downloads(config.dataDir, config.libraryDir, torrents, {
  resolve: (key) => media.resolveSource(key),
  done: (title) => {
    void refreshJellyfin()
    toScreens({ t: 'notify', title: 'Staženo do Knihovny', text: `${title} bude v Knihovně, až ji Jellyfin načte.` })
  },
})
function toRemotes(msg: HubToRemote): void {
  for (const ws of remotes) send(ws, msg)
}
function appearanceMessage(): AppearanceMessage {
  return { t: 'appearance', appearance: store.state.appearance, backgrounds: store.state.backgrounds }
}
/** Applies a change from the TV panel or a phone, saves it and shows the result everywhere. */
function setAppearance(patch: unknown): void {
  const next: Appearance = applyAppearance(store.state.appearance, patch)
  // A photo that was deleted meanwhile cannot be chosen.
  if (next.background.startsWith('photo:') && !backgrounds.has(next.background.slice(6))) next.background = store.state.appearance.background
  store.state.appearance = next
  store.save()
  const msg = appearanceMessage()
  toScreens(msg)
  toRemotes(msg)
}
function status(): HubToRemote {
  return { t: 'status', tv: tvs.size ? tvState : null, sleepEndsAt: sleep?.endsAt ?? null, samsung: !!samsung }
}

function setSleep(minutes: number | null): void {
  if (sleep) clearTimeout(sleep.timer)
  sleep = null
  if (minutes) {
    const timer = setTimeout(() => {
      sleep = null
      console.log('[sleep] time is up')
      toTvs({ t: 'sleep-fire' })
      toScreens({ t: 'sleep', endsAt: null })
      toRemotes(status())
      // Give the TV app a moment to stop playback (and report it) before switching off.
      if (samsung) {
        setTimeout(() => {
          samsung
            .isOn()
            .then((on) => (on ? samsung.key('KEY_POWER') : undefined))
            .catch((e: Error) => console.warn('[sleep] power off failed:', e.message))
        }, 3000)
      }
    }, minutes * 60_000)
    sleep = { endsAt: Date.now() + minutes * 60_000, timer }
  }
  toScreens({ t: 'sleep', endsAt: sleep?.endsAt ?? null })
  toRemotes(status())
}

/** Runs what the hub can run itself and hands the rest to the TV app, starting it if needed. */
async function runIntent(intent: Intent): Promise<{ ok: boolean; message: string }> {
  const done = { ok: true, message: describeIntent(intent) }
  switch (intent.kind) {
    case 'tv':
      if (!samsung) return { ok: false, message: 'Ovládání televize po síti není nastavené' }
      await samsung.key(SAMSUNG_KEYS[intent.key], intent.repeat ?? 1)
      return done
    case 'power-on':
      if (!samsung) return { ok: false, message: 'Ovládání televize po síti není nastavené' }
      await samsung.powerOn()
      return done
    case 'sleep':
      setSleep(intent.minutes)
      return done
    default:
      break
  }
  if (tvs.size) {
    toTvs({ t: 'intent', intent })
    return done
  }
  if (!samsung) return { ok: false, message: 'aTV na televizi neběží' }
  await samsung.powerOn()
  const app = intent.kind === 'launch' ? findApp(intent.app) : undefined
  if (app?.samsungRemote) {
    await samsung.launch(app.samsungRemote)
    return done
  }
  pending.push({ intent, at: Date.now() })
  await samsung.launch(ATV_TIZEN_ID)
  return { ok: true, message: `${done.message} (spouštím aTV)` }
}

async function runCommand(text: string): Promise<{ ok: boolean; message: string }> {
  let intent = parseCommand(text)
  if (!intent && config.anthropicApiKey) {
    try {
      intent = await interpretWithClaude(config.anthropicApiKey, text)
    } catch (e) {
      console.warn('[llm]', (e as Error).message)
    }
  }
  if (!intent) return { ok: false, message: `Nerozumím: „${text}“` }
  console.log('[command]', JSON.stringify(text), '→', JSON.stringify(intent))
  try {
    return await runIntent(intent)
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// --- WebSocket ---------------------------------------------------------------

function parse(data: unknown): Record<string, unknown> | null {
  try {
    const v = JSON.parse(String(data)) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function onTvMessage(msg: Record<string, unknown>): void {
  switch (msg.t) {
    case 'state':
      tvState = msg.state as TvState
      toRemotes(status())
      break
    case 'playback':
      if (homeAssistant && (msg.state === 'playing' || msg.state === 'paused' || msg.state === 'stopped')) {
        homeAssistant.playback(msg.state).catch((e: Error) => console.warn('[ha]', e.message))
      }
      break
    case 'sleep-set':
      setSleep(typeof msg.minutes === 'number' && msg.minutes > 0 && msg.minutes <= 600 ? msg.minutes : null)
      break
    case 'appearance-set':
      setAppearance(msg.patch)
      break
  }
}

/** The web app may change the shared look and the TV's sleep timer, like the TV's own settings. */
function onWebMessage(msg: Record<string, unknown>): void {
  if (msg.t === 'appearance-set') setAppearance(msg.patch)
  else if (msg.t === 'sleep-set') setSleep(typeof msg.minutes === 'number' && msg.minutes > 0 && msg.minutes <= 600 ? msg.minutes : null)
}

/**
 * Remote input goes to the Samsung as native keys and pointer events when the hub controls one,
 * so it works in every app on the TV (Netflix, the browser), aTV included. When an aTV runs
 * somewhere else (a desktop browser during development), input goes to that app instead,
 * which draws its own cursor.
 */
function nativeInput(): boolean {
  if (!samsung) return false
  for (const p of tvPlatforms.values()) if (p !== 'tizen') return false
  return true
}

let lastInputError = 0
function inputFailed(ws: WebSocket, e: Error): void {
  // Pointer moves arrive many times a second; report a failure once, not for every move.
  if (Date.now() - lastInputError < 5000) return
  lastInputError = Date.now()
  send(ws, { t: 'result', ok: false, message: e.message })
}

const clamp = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.max(-500, Math.min(500, v)) : 0)

async function onRemoteMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
  const reply = (r: { ok: boolean; message: string }) => send(ws, { t: 'result', ...r })
  switch (msg.t) {
    case 'key': {
      if (!ACTIONS.includes(msg.action as never)) break
      const action = msg.action as (typeof ACTIONS)[number]
      if (nativeInput()) await samsung!.key(SAMSUNG_ACTION_KEYS[action]).catch((e: Error) => inputFailed(ws, e))
      else toTvs({ t: 'key', action })
      break
    }
    case 'pointer': {
      const dx = clamp(msg.dx)
      const dy = clamp(msg.dy)
      if (!dx && !dy) break
      if (nativeInput()) await samsung!.pointer(dx, dy).catch((e: Error) => inputFailed(ws, e))
      else toTvs({ t: 'pointer', dx, dy })
      break
    }
    case 'click':
      if (nativeInput()) await samsung!.click().catch((e: Error) => inputFailed(ws, e))
      else toTvs({ t: 'click' })
      break
    case 'text':
      if (typeof msg.text === 'string' && msg.text.length <= 200) toTvs({ t: 'text', text: msg.text, submit: msg.submit === true })
      break
    case 'command':
      if (typeof msg.text === 'string' && msg.text.trim()) reply(await runCommand(msg.text.slice(0, 500)))
      break
    case 'tv':
      if (typeof msg.key === 'string' && msg.key in SAMSUNG_KEYS) {
        reply(await runIntent({ kind: 'tv', key: msg.key as keyof typeof SAMSUNG_KEYS }).catch((e: Error) => ({ ok: false, message: e.message })))
      }
      break
    case 'power-on':
      reply(await runIntent({ kind: 'power-on' }).catch((e: Error) => ({ ok: false, message: e.message })))
      break
    case 'sleep-set':
      setSleep(typeof msg.minutes === 'number' && msg.minutes > 0 && msg.minutes <= 600 ? msg.minutes : null)
      break
    case 'appearance-set':
      setAppearance(msg.patch)
      break
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
wss.on('connection', (ws, req: IncomingMessage) => {
  const host = req.headers.host ?? ''
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/^(localhost|127\.|\[::1\])/i.test(host)) tvBase.set(ws, `http://${host}`)
  let role: 'tv' | 'remote' | 'web' | null = null
  ws.on('message', (data) => {
    const msg = parse(data)
    if (!msg) return
    if (!role) {
      if (msg.t === 'hello' && msg.role === 'tv') {
        role = 'tv'
        tvs.add(ws)
        tvPlatforms.set(ws, String(msg.platform))
        console.log(`[tv] connected (${String(msg.platform)}), ${tvs.size} total`)
        send(ws, { t: 'pairing', code: pairing.code, url: pairingUrl(pairing.code, ws) })
        send(ws, { t: 'sleep', endsAt: sleep?.endsAt ?? null })
        send(ws, appearanceMessage())
        pending = pending.filter((p) => Date.now() - p.at < 60_000)
        for (const p of pending) send(ws, { t: 'intent', intent: p.intent })
        pending = []
        toRemotes(status())
      } else if (msg.t === 'hello' && msg.role === 'web') {
        role = 'web'
        webs.add(ws)
        console.log(`[web] connected, ${webs.size} total`)
        send(ws, { t: 'pairing', code: pairing.code, url: pairingUrl(pairing.code, ws) })
        send(ws, { t: 'sleep', endsAt: sleep?.endsAt ?? null })
        send(ws, appearanceMessage())
      } else if (msg.t === 'hello' && msg.role === 'remote' && store.hasRemote(msg.token)) {
        role = 'remote'
        remotes.add(ws)
        send(ws, status())
        send(ws, appearanceMessage())
      } else {
        send(ws, { t: 'unauthorized' })
        ws.close()
      }
      return
    }
    if (role === 'tv') onTvMessage(msg)
    else if (role === 'web') onWebMessage(msg)
    else void onRemoteMessage(ws, msg)
  })
  ws.on('close', () => {
    tvBase.delete(ws)
    tvPlatforms.delete(ws)
    if (tvs.delete(ws)) {
      if (!tvs.size) tvState = null
      toRemotes(status())
    }
    remotes.delete(ws)
    webs.delete(ws)
  })
})

// --- HTTP --------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) throw new Error('too large')
    chunks.push(chunk as Buffer)
  }
  const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function bearer(req: IncomingMessage): string {
  return /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
}

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const root = resolve(config.distDir)
  let file = resolve(join(root, decodeURIComponent(path === '/' ? '/index.html' : path)))
  if (file !== root && !file.startsWith(root + sep)) return json(res, 404, { error: 'not found' })
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    await stat(file)
  } catch {
    return json(res, 404, { error: 'not found' })
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    // Built assets carry a content hash in their names.
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://hub')
  const path = url.pathname
  // The packaged TV app runs from file:// or the TV's own origin and calls the hub cross-origin.
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, authorization, range')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return void res.end()
  }

  if (path === '/api/health') return json(res, 200, { ok: true, tvs: tvs.size, remotes: remotes.size })
  if (path === '/api/config') return json(res, 200, publicConfig(config))
  if (path === '/api/apps') return json(res, 200, APPS)
  if (path === '/api/art/artists') return json(res, 200, { artists: art.library.artists.map(a=>({id:a.id,name:a.name,count:a.works.length,photo:a.photo?`portrait-${a.id}`:undefined,cover:a.works[0]?.id})) })
  const artImage = /^\/api\/art\/images\/(portrait-\d+|\d+)$/.exec(path)
  if (artImage) {
    try { const body=await art.image(artImage[1],url.searchParams.get('thumb')==='1');res.writeHead(200,{'content-type':'image/jpeg','cache-control':'public, max-age=86400'});res.end(body);return }
    catch { return json(res,502,{error:'Obraz se nepodařilo načíst.'}) }
  }
  const artArtist=/^\/api\/art\/artists\/(\d+)$/.exec(path)
  if(artArtist){const a=art.library.artists.find(a=>a.id===artArtist[1]);return json(res,a?200:404,a??{error:'Umělec nenalezen.'})}
  if (path === '/api/musicians' || /^\/api\/musicians\/[^/]+$/.test(path)) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Použijte GET' })
    if (path === '/api/musicians') {
      try { return json(res, 200, musicians.list(url.searchParams.get('q') || '', Number(url.searchParams.get('page')) || 1)) }
      catch { return json(res, 503, { error: 'Knihovna muzikantů ještě není importovaná.' }) }
    }
    const id = path.slice('/api/musicians/'.length)
    if (!/^\d{1,15}$/.test(id)) return json(res, 400, { error: 'Neplatný interpret' })
    const detail = musicians.detail(id)
    return json(res, detail ? 200 : 404, detail ?? { error: 'Interpret není ve výběru.' })
  }
  if (path === '/api/actors' || /^\/api\/actors\/[^/]+$/.test(path)) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Použijte GET' })
    if (!actors) return json(res, 503, { error: 'Filmová databáze není připojená. Doplňte TMDB klíč v konfiguraci hubu.' })
    const id = path.slice('/api/actors/'.length)
    if (path !== '/api/actors' && !/^\d{1,10}$/.test(id)) return json(res, 400, { error: 'Neplatný identifikátor herce' })
    const page = Math.max(1, Math.min(500, Math.floor(Number(url.searchParams.get('page')) || 1)))
    return json(res, 200, path === '/api/actors' ? await actors.list(url.searchParams.get('q') || '', page) : await actors.filmography(id))
  }

  if (/^\/api\/films\/\d{1,10}$/.test(path)) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Použijte GET' })
    if (!actors) return json(res, 503, { error: 'Filmová databáze není připojená. Doplňte TMDB klíč v konfiguraci hubu.' })
    return json(res, 200, await actors.filmDetails(path.slice('/api/films/'.length)))
  }
  if (path === '/api/films/art') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Použijte GET' })
    if (!actors) return json(res, 503, { error: 'Filmová databáze není připojená. Doplňte TMDB klíč v konfiguraci hubu.' })
    const year = Number(url.searchParams.get('year'))
    return json(res, 200, await actors.film(url.searchParams.get('q') || '', year >= 1880 && year <= 2100 ? year : undefined))
  }

  if (path === '/api/pair' && req.method === 'POST') {
    const body = await readJson(req)
    if (!pairing.check(body.code)) return json(res, 403, { error: 'Špatný kód' })
    console.log('[pair] phone paired')
    return json(res, 200, { token: store.addRemote() })
  }

  if (path === '/api/command' && req.method === 'POST') {
    // For shortcuts and automations (Siri, Home Assistant): a phone token or the notify token.
    const token = bearer(req)
    if (!store.hasRemote(token) && !safeEqual(token, store.state.notifyToken)) return json(res, 401, { error: 'unauthorized' })
    const body = await readJson(req)
    if (typeof body.text !== 'string' || !body.text.trim()) return json(res, 400, { error: 'text chybí' })
    return json(res, 200, await runCommand(body.text.slice(0, 500)))
  }

  if (path === '/api/notify' && req.method === 'POST') {
    if (!safeEqual(bearer(req), store.state.notifyToken)) return json(res, 401, { error: 'unauthorized' })
    const body = await readJson(req)
    const title = typeof body.title === 'string' ? body.title.slice(0, 120) : ''
    if (!title) return json(res, 400, { error: 'title chybí' })
    const text = typeof body.text === 'string' ? body.text.slice(0, 500) : undefined
    const image = typeof body.image === 'string' && /^https?:\/\//.test(body.image) ? body.image : undefined
    toScreens({ t: 'notify', title, text, image })
    return json(res, 200, { ok: true, delivered: tvs.size })
  }

  if (path === '/api/backgrounds' && req.method === 'POST') {
    if (!store.hasRemote(bearer(req))) return json(res, 401, { error: 'unauthorized' })
    const bg = await backgrounds.add(req, url.searchParams.get('name') ?? undefined).catch((e: Error) => e)
    if (bg instanceof Error) return json(res, 400, { error: bg.message })
    console.log(`[appearance] background photo added (${bg.id})`)
    if (url.searchParams.get('use') === '1') setAppearance({ background: `photo:${bg.id}` })
    else toRemotes(appearanceMessage())
    return json(res, 200, bg)
  }
  const bgPath = /^\/api\/backgrounds\/([a-z0-9]{6,32})$/.exec(path)
  if (bgPath) {
    if (req.method === 'DELETE') {
      if (!store.hasRemote(bearer(req))) return json(res, 401, { error: 'unauthorized' })
      if (!(await backgrounds.remove(bgPath[1]))) return json(res, 404, { error: 'Fotka nenalezena' })
      // The TV falls back to the default scene when its photo is gone.
      if (store.state.appearance.background === `photo:${bgPath[1]}`) setAppearance({ background: 'scene:valley' })
      else {
        toScreens(appearanceMessage())
        toRemotes(appearanceMessage())
      }
      return json(res, 200, { ok: true })
    }
    const image = await backgrounds.read(bgPath[1])
    if (!image) return json(res, 404, { error: 'Fotka nenalezena' })
    res.writeHead(200, { 'content-type': image.type, 'cache-control': 'public, max-age=31536000, immutable' })
    return void res.end(image.data)
  }

  if (path === '/api/iptv') {
    if (!iptv) return json(res, 404, { error: 'IPTV není nastavené' })
    return json(res, 200, await iptv.channels())
  }

  if (path === '/api/photos/random') {
    if (!immich) return json(res, 404, { error: 'Immich není nastavený' })
    return json(res, 200, await immich.randomIds(Number(url.searchParams.get('count') ?? 20)))
  }
  const photo = /^\/api\/photos\/([0-9a-f-]{36})$/.exec(path)
  if (photo) {
    if (!immich) return json(res, 404, { error: 'Immich není nastavený' })
    const upstream = await immich.image(photo[1])
    if (!upstream.ok || !upstream.body) return json(res, 502, { error: `Immich: HTTP ${upstream.status}` })
    res.writeHead(200, {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    })
    Readable.fromWeb(upstream.body as never).pipe(res)
    return
  }

  if (await ivysilani.route(req, res, url, { json })) return
  const avFile = /^\/api\/browser\/av\/([a-z0-9.]+)$/.exec(path)
  if (avFile) {
    if (!browser?.av) return json(res, 404, { error: 'Video se zvukem potřebuje hub v Dockeru.' })
    try {
      return await browser.serveAv(avFile[1], res)
    } catch (e) {
      return json(res, 503, { error: (e as Error).message })
    }
  }
  if (await media.route(req, res, url, { json, readJson, isRemote: (r) => store.hasRemote(bearer(r)) })) return

  if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' })
  return serveStatic(path, res)
}

const server = createServer((req, res) => {
  handle(req, res).catch((e: Error) => {
    console.warn(`[http] ${req.method} ${req.url}:`, e.message)
    if (!res.headersSent) json(res, 500, { error: e.message })
    else res.end()
  })
})
server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://hub').pathname
  if (path === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  else if (path === '/ws/browser') browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req))
  else socket.destroy()
})

server.listen(config.port, () => {
  const features = Object.entries(publicConfig(config).features)
    .map(([k, on]) => `${k}:${on ? 'on' : 'off'}`)
    .join(' ')
  console.log(`aTV hub on :${config.port} (${features})`)
  console.log(`  TV app:      ${publicUrl}/`)
  console.log(`  phone:       ${publicUrl}/remote.html  (pairing code ${pairing.code})`)
  console.log(`  notify token: ${store.state.notifyToken}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    samsung?.close()
    torrents.close()
    browser?.stop()
    server.close()
    process.exit(0)
  })
}
