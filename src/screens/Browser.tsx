import { useEffect, useRef, useState } from 'preact/hooks'
import type { BrowserCommand, BrowserEvent, BrowserState } from '../../shared/protocol.ts'
import { textEdit, toUrl } from '../../shared/text.ts'
import type { Action } from '../../shared/keys.ts'
import { setFocus } from '../nav/focus'
import { platform } from '../runtime'
import { config, nav, toast, useScreenKeys, useScreenText, useStore } from '../state'
import { hubUrl } from '../services/hub'
import { settings, updateSettings } from '../services/settings'
import { Button, Message } from '../components'
import { attach, type HlsLike } from './Player'

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false }

/**
 * aTV's own browser. The page runs in a current Chrome on the hub (the TV's built-in browser is old
 * and slow); the TV shows its picture and sends clicks, scrolling and typing back. In the bar the
 * remote moves between buttons; on the page the arrows move a pointer, OK clicks, the edges scroll
 * and Back goes back in the page history.
 */
export function Browser({ screenKey, url: startUrl }: { screenKey: number; url?: string }) {
  const c = useStore(config)
  const s = useStore(settings)
  const ws = useRef<WebSocket | null>(null)
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [frame, setFrame] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'bar' | 'page'>(startUrl ? 'page' : 'bar')
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.4 })
  const [bookmarks, setBookmarks] = useState(false)
  const stale = useRef<string[]>([])
  const lastMove = useRef({ dir: '', at: 0, speed: 1 })
  const phoneText = useRef('')
  // Video with sound: the hub records its browser's screen and sound card as a live stream.
  const [av, setAv] = useState(false)
  const avVideo = useRef<HTMLVideoElement>(null)
  const [avError, setAvError] = useState('')
  const mouseOn = s.virtualMouse !== 'off'

  const send = (cmd: BrowserCommand) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(cmd))
  }
  const open = (url: string) => {
    send({ t: 'open', url })
    setBookmarks(false)
    setMode('page')
  }

  useEffect(() => {
    if (!c?.features.browser) return
    const socket = new WebSocket(`${hubUrl().replace(/^http/, 'ws')}/ws/browser`)
    socket.binaryType = 'blob'
    ws.current = socket
    socket.onopen = () => {
      if (startUrl) socket.send(JSON.stringify({ t: 'open', url: startUrl }))
    }
    socket.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const url = URL.createObjectURL(e.data)
        // Old frames are freed once the new one has loaded, so the picture never blinks.
        setFrame((prev) => {
          if (prev) stale.current.push(prev)
          return url
        })
        return
      }
      const msg = JSON.parse(String(e.data)) as BrowserEvent
      if (msg.t === 'state') {
        setState(msg.state)
        if (msg.state.loading) setError('')
      }
      else setError(msg.message)
    }
    socket.onclose = () => setError((e) => e || 'Spojení s prohlížečem na hubu se přerušilo')
    return () => {
      socket.onclose = null
      socket.close()
      stale.current.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [c?.features.browser])

  useEffect(() => {
    const v = avVideo.current
    if (!av || !v) return
    let hls: HlsLike | null = null
    let disposed = false
    setAvError('')
    const onError = () => setAvError('Video se zvukem se nepodařilo přehrát.')
    v.addEventListener('error', onError)
    attach(v, `${hubUrl()}/api/browser/av/live.m3u8`, true, true)
      .then((h) => {
        if (disposed) return h?.destroy()
        hls = h
        return v.play()
      })
      .catch(() => setAvError('Video se zvukem se nepodařilo spustit. Zkuste to znovu.'))
    return () => {
      disposed = true
      v.removeEventListener('error', onError)
      hls?.destroy()
      v.removeAttribute('src')
      v.load()
    }
  }, [av, !!state.url])

  // Page mode has no focusable elements; put focus back on the bar when leaving it.
  useEffect(() => {
    if (mode === 'bar') {
      const el = document.querySelector<HTMLElement>('.screen.top [data-focus="b-address"]')
      if (el) setFocus(el)
    }
  }, [mode])

  const movePointer = (dx: number, dy: number) => {
    setPointer((p) => {
      const next = { x: Math.max(0, Math.min(1, p.x + dx)), y: Math.max(0, Math.min(1, p.y + dy)) }
      send({ t: 'mouse', kind: 'move', ...next })
      return next
    })
  }

  useScreenKeys(screenKey, (action: Action) => {
    if (bookmarks) {
      if (action === 'back') {
        setBookmarks(false)
        return true
      }
      return false
    }
    if (mode === 'bar') {
      if (action === 'down' && state.url) {
        setMode('page')
        return true
      }
      return false
    }
    // Without the virtual mouse the remote works the page like a keyboard: links by Tab, arrows scroll.
    if (!mouseOn) {
      switch (action) {
        case 'left':
          send({ t: 'key', key: 'Tab', shift: true })
          return true
        case 'right':
          send({ t: 'key', key: 'Tab' })
          return true
        case 'up':
          send({ t: 'key', key: 'ArrowUp' })
          return true
        case 'down':
          send({ t: 'key', key: 'ArrowDown' })
          return true
        case 'ok':
          send({ t: 'key', key: 'Enter' })
          return true
        case 'back':
          if (state.canGoBack) send({ t: 'back' })
          else setMode('bar')
          return true
        default:
          return false
      }
    }
    // Page mode: a pointer that speeds up while an arrow is held.
    const now = Date.now()
    const m = lastMove.current
    m.speed = m.dir === action && now - m.at < 300 ? Math.min(m.speed + 0.5, 5) : 1
    m.dir = action
    m.at = now
    const step = 0.015 * m.speed
    switch (action) {
      case 'left':
        movePointer(-step, 0)
        return true
      case 'right':
        movePointer(step, 0)
        return true
      case 'up':
        if (pointer.y <= 0.02) send({ t: 'wheel', ...pointer, dy: -360 })
        else movePointer(0, -step * 1.6)
        return true
      case 'down':
        if (pointer.y >= 0.98) send({ t: 'wheel', ...pointer, dy: 360 })
        else movePointer(0, step * 1.6)
        return true
      case 'ok':
        send({ t: 'mouse', kind: 'click', ...pointer })
        return true
      case 'back':
        if (state.canGoBack) send({ t: 'back' })
        else setMode('bar')
        return true
      default:
        return false
    }
  })

  // The phone's text field: on the page it types (only what changed), in the bar Enter opens it as an address.
  useScreenText(screenKey, (text, submit) => {
    if (mode === 'bar' || !state.url) {
      if (submit && text.trim()) open(toUrl(text))
      return
    }
    const { backspaces, insert } = textEdit(phoneText.current, text)
    for (let i = 0; i < backspaces; i++) send({ t: 'key', key: 'Backspace' })
    if (insert) send({ t: 'text', text: insert })
    phoneText.current = text
    if (submit) {
      send({ t: 'key', key: 'Enter' })
      phoneText.current = ''
    }
  })

  const editAddress = () =>
    nav.push({ type: 'keyboard', title: 'Adresa nebo hledání', value: state.url, onDone: (v) => v && open(toUrl(v)) })
  const typeIntoPage = () =>
    nav.push({
      type: 'keyboard',
      title: 'Psát do stránky',
      value: '',
      onDone: (v) => {
        if (v) send({ t: 'text', text: v })
        setMode('page')
      },
    })
  const addBookmark = () => {
    if (!state.url || s.bookmarks.some((b) => b.url === state.url)) return
    updateSettings({ bookmarks: [...s.bookmarks, { name: state.title || state.url.replace(/^https?:\/\//, ''), url: state.url }] })
    toast('Přidáno do záložek')
  }

  // Mouse over the picture (the TV's own cursor, or a mouse during development) acts directly on the page.
  const at = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const lastMouse = useRef(0)
  const pageInput = {
    onMouseMove: (e: MouseEvent) => {
      if (Date.now() - lastMouse.current < 50) return
      lastMouse.current = Date.now()
      send({ t: 'mouse', kind: 'move', ...at(e) })
    },
    onClick: (e: MouseEvent) => {
      setMode('page')
      send({ t: 'mouse', kind: 'click', ...at(e) })
    },
    onWheel: (e: WheelEvent) => {
      e.preventDefault()
      send({ t: 'wheel', ...at(e), dy: e.deltaY })
    },
  }

  if (!c?.features.browser) {
    return (
      <div class="screen-body padded">
        <h1 class="screen-title">Prohlížeč</h1>
        <Message>Prohlížeč aTV potřebuje hub s Chromem (na Macu stačí nainstalovaný Google Chrome, v Dockeru je součástí obrazu).</Message>
        <Button id="native" autofocus label="Otevřít prohlížeč televize" onClick={() => void platform.openUrl('https://www.google.com').catch((e: Error) => toast(e.message))} />
      </div>
    )
  }

  const title = state.title || state.url.replace(/^https?:\/\//, '') || 'Nová stránka'
  return (
    <div class="screen-body browser">
      <div class="browser-bar">
        <div class={`btn btn-small${state.canGoBack ? '' : ' disabled'}`} data-focus="b-back" onClick={() => send({ t: 'back' })}>◀</div>
        <div class={`btn btn-small${state.canGoForward ? '' : ' disabled'}`} data-focus="b-forward" onClick={() => send({ t: 'forward' })}>▶</div>
        <div class="btn btn-small" data-focus="b-reload" onClick={() => send({ t: 'reload' })}>{state.loading ? '✕' : '⟳'}</div>
        <div class="browser-address" data-focus="b-address" data-autofocus={!startUrl ? '' : undefined} onClick={editAddress}>
          <span class="browser-title">{title}</span>
          <span class="browser-url">{state.url}</span>
        </div>
        <div class="btn btn-small" data-focus="b-type" onClick={typeIntoPage}>Psát</div>
        <div class="btn btn-small" data-focus="b-bookmarks" onClick={() => setBookmarks(!bookmarks)}>Záložky</div>
        {c.features.browserAudio && (
          <div class={`btn btn-small${av ? ' btn-primary' : ''}`} data-focus="b-av" onClick={() => setAv(!av)}>
            {av ? '🔊 Se zvukem' : '🔇 Bez zvuku'}
          </div>
        )}
        <div class={`btn btn-small${mode === 'page' ? ' btn-primary' : ''}`} data-focus="b-page" onClick={() => setMode('page')}>Stránka ▼</div>
      </div>
      <div class={`browser-view${mode === 'page' ? ' active' : ''}`}>
        {state.url && av ? (
          // The stream lags a few seconds behind the page; clicks still go straight to it.
          <video ref={avVideo} class="browser-frame" playsInline {...pageInput} />
        ) : state.url && frame ? (
          <img
            class="browser-frame"
            src={frame}
            alt=""
            onLoad={() => {
              const old = stale.current
              stale.current = []
              old.forEach((u) => URL.revokeObjectURL(u))
            }}
            {...pageInput}
          />
        ) : (
          <div class="browser-start">
            <h2 class="row-title">Záložky</h2>
            <div class="grid">
              {s.bookmarks.map((b) => (
                <div class="tile tile-small" key={b.url} data-focus={`start-${b.url}`} style={{ background: 'linear-gradient(135deg, #2b6cb0 0%, #1a365d 100%)' }} onClick={() => open(b.url)}>
                  <span class="tile-name small">{b.name}</span>
                </div>
              ))}
            </div>
            <div class="muted">Adresu napíšete v řádku nahoře, z mobilu (Psát na televizi + Enter) nebo hlasem: „otevři seznam.cz“.</div>
          </div>
        )}
        {mode === 'page' && state.url && mouseOn && <div class="browser-pointer" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />}
        {state.loading && <div class="browser-loading" />}
        {error && <div class="browser-error">{error}</div>}
        {av && avError && <div class="browser-error">{avError}</div>}
      </div>
      {mode === 'page' && state.url && (
        <div class="browser-hint">
          {mouseOn ? 'Šipky = kurzor · OK = klik · u okraje se roluje' : '◀ ▶ = předchozí / další odkaz · ▲ ▼ = rolovat · OK = otevřít'}
          {' · Zpět = předchozí stránka'}{state.canGoBack ? '' : ' / lišta'}
        </div>
      )}
      {bookmarks && (
        <div class="browser-bookmarks" data-scroll="y">
          <h2 class="row-title">Záložky</h2>
          <div class="settings-row" data-focus="bm-add" data-autofocus="" onClick={addBookmark}>
            <span>☆ Přidat tuto stránku</span>
            <span class="value">{state.url.replace(/^https?:\/\//, '')}</span>
          </div>
          {s.bookmarks.map((b) => (
            <div class="tile-setting" key={b.url}>
              <div class="settings-row grow" data-focus={`bm-${b.url}`} onClick={() => open(b.url)}>
                <span>{b.name}</span>
                <span class="value">{b.url.replace(/^https?:\/\//, '')}</span>
              </div>
              <div class="btn btn-small" data-focus={`bm-del-${b.url}`} onClick={() => updateSettings({ bookmarks: s.bookmarks.filter((x) => x.url !== b.url) })}>✕</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

