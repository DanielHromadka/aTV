import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { APPS } from '../../shared/apps.ts'
import type { TvKey } from '../../shared/intents.ts'
import type { Action } from '../../shared/keys.ts'
import type { HubToRemote, RemoteMessage, TvState } from '../../shared/protocol.ts'
import { DragStepper, tapAction } from '../../shared/trackpad.ts'
import type { Appearance, CustomBackground } from '../../shared/appearance.ts'
import { DesignTab } from './design'
import { BrowserTab } from './browser'
import { Icon, type IconName } from './icons'
import './remote.css'

const TOKEN_KEY = 'atv.remote.token'

function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}
function saveToken(t: string): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Without storage the phone pairs again next time.
  }
}

const buzz = () => navigator.vibrate?.(12)

type PadMode = 'buttons' | 'trackpad'
type RemoteTab = 'remote' | 'browser' | 'design'
const MODE_KEY = 'atv.remote.mode'
const SENSITIVITY_KEY = 'atv.remote.sensitivity'
const POINTER_KEY = 'atv.remote.pointer'
const TAB_KEY = 'atv.remote.tab'

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice then lasts only until the page reloads.
  }
}

const FLASH: Partial<Record<Action, IconName>> = { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back' }

/**
 * A touch surface. In cursor mode a drag moves the TV's pointer (the Samsung's own cursor, or
 * aTV's where the TV has none) and a tap clicks. In focus mode a drag moves the selection one tile
 * per `step` pixels. Either way a two-finger tap is Back. Pointer events, so a mouse works too.
 */
function Trackpad({ step, cursor, onKey, onPointer, onClick }: {
  step: number
  cursor: boolean
  onKey: (a: Action) => void
  onPointer: (dx: number, dy: number) => void
  onClick: () => void
}) {
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ stepper: DragStepper; start: number; travel: number; fingers: number } | null>(null)
  // Pointer moves are batched and sent at most every 30 ms, so the hub and TV are not flooded.
  const pending = useRef({ dx: 0, dy: 0, timer: 0 })
  const [flash, setFlash] = useState<{ icon: IconName; n: number } | null>(null)

  const show = (icon: IconName | undefined) => {
    if (icon) setFlash((f) => ({ icon, n: (f?.n ?? 0) + 1 }))
  }
  const emit = (a: Action) => {
    onKey(a)
    show(FLASH[a])
  }
  const flush = () => {
    const p = pending.current
    p.timer = 0
    if (!p.dx && !p.dy) return
    onPointer(Math.round(p.dx), Math.round(p.dy))
    p.dx = p.dx - Math.round(p.dx)
    p.dy = p.dy - Math.round(p.dy)
  }

  const down = (e: PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) gesture.current = { stepper: new DragStepper(step), start: Date.now(), travel: 0, fingers: 1 }
    else if (gesture.current) gesture.current.fingers = Math.max(gesture.current.fingers, pointers.current.size)
  }
  const move = (e: PointerEvent) => {
    const p = pointers.current.get(e.pointerId)
    const g = gesture.current
    if (!p || !g) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    // Two fingers are a Back tap, not a drag.
    if (pointers.current.size > 1) return
    g.travel += Math.abs(dx) + Math.abs(dy)
    if (cursor) {
      // Lower step = more sensitive, as in focus mode; slow drags stay precise, fast ones go far.
      const speed = Math.min(2.5, 1 + Math.hypot(dx, dy) / 25)
      const gain = (140 / step) * speed
      pending.current.dx += dx * gain
      pending.current.dy += dy * gain
      if (!pending.current.timer) pending.current.timer = window.setTimeout(flush, 30)
    } else {
      for (const s of g.stepper.move(dx, dy)) emit(s)
    }
  }
  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size || !g) return
    gesture.current = null
    if (pending.current.timer) {
      window.clearTimeout(pending.current.timer)
      flush()
    }
    const tap = tapAction(Date.now() - g.start, g.travel > 8, g.fingers)
    if (tap === 'back') emit('back')
    else if (tap === 'ok') {
      if (cursor) {
        onClick()
        show('ok')
      } else emit('ok')
    }
  }

  return (
    <div class="trackpad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {flash ? (
        <div class="trackpad-flash" key={flash.n}><Icon name={flash.icon} size={64} /></div>
      ) : (
        <div class="trackpad-hint">
          {cursor ? 'Táhněte pro pohyb kurzoru · ťuknutí = klik · dva prsty = Zpět' : 'Táhněte pro posun výběru · ťuknutí = OK · dva prsty = Zpět'}
        </div>
      )}
    </div>
  )
}

function Pair({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState(() => /code=(\d{4})/.exec(location.hash)?.[1] ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pair = async (c: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) })
      const body = (await res.json()) as { token?: string; error?: string }
      if (!res.ok || !body.token) throw new Error(body.error ?? 'Párování selhalo')
      history.replaceState(null, '', location.pathname)
      onPaired(body.token)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // A code from the QR link pairs right away.
  useEffect(() => {
    if (code.length === 4) void pair(code)
  }, [])

  return (
    <div class="pair">
      <div class="brand">a<span>TV</span></div>
      <p>Zadejte kód z televize (aTV → Nastavení → Ovladač v mobilu).</p>
      <input
        class="code"
        inputMode="numeric"
        maxLength={4}
        value={code}
        placeholder="0000"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
          setCode(v)
          if (v.length === 4) void pair(v)
        }}
      />
      {busy && <p class="muted">Páruji…</p>}
      {error && <p class="error">{error}</p>}
    </div>
  )
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start(): void }

function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null
}

function Remote({ token, onUnpaired }: { token: string; onUnpaired: () => void }) {
  const ws = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [tv, setTv] = useState<TvState | null>(null)
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null)
  const [samsung, setSamsung] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [command, setCommand] = useState('')
  const [typed, setTyped] = useState('')
  const [listening, setListening] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const [mode, setMode] = useState<PadMode>(() => (loadPref(MODE_KEY) === 'trackpad' ? 'trackpad' : 'buttons'))
  const [step, setStep] = useState(() => Number(loadPref(SENSITIVITY_KEY)) || 70)
  const [cursorMode, setCursorMode] = useState(() => loadPref(POINTER_KEY) !== 'focus')
  const [tab, setTab] = useState<RemoteTab>(() => { const t = loadPref(TAB_KEY); return t === 'design' || t === 'browser' ? t : 'remote' })
  const [look, setLook] = useState<{ appearance: Appearance; backgrounds: CustomBackground[] } | null>(null)
  const chooseTab = (t: RemoteTab) => {
    setTab(t)
    savePref(TAB_KEY, t)
    window.scrollTo(0, 0)
  }
  const chooseCursor = (on: boolean) => {
    setCursorMode(on)
    savePref(POINTER_KEY, on ? 'cursor' : 'focus')
  }
  const chooseMode = (m: PadMode) => {
    setMode(m)
    savePref(MODE_KEY, m)
  }

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    const connect = () => {
      const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
      ws.current = socket
      socket.onopen = () => {
        socket.send(JSON.stringify({ t: 'hello', role: 'remote', token }))
        setConnected(true)
      }
      socket.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as HubToRemote
        if (msg.t === 'unauthorized') {
          closed = true
          onUnpaired()
        } else if (msg.t === 'status') {
          setTv(msg.tv)
          setSleepEndsAt(msg.sleepEndsAt)
          setSamsung(msg.samsung)
        } else if (msg.t === 'appearance') {
          setLook({ appearance: msg.appearance, backgrounds: msg.backgrounds })
        } else if (msg.t === 'result') {
          setResult(msg)
          window.setTimeout(() => setResult((r) => (r === msg ? null : r)), 5000)
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      ws.current?.close()
    }
  }, [token])

  const send = (msg: RemoteMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }
  const key = (action: Action) => {
    buzz()
    send({ t: 'key', action })
  }
  const tvKey = (k: TvKey) => {
    buzz()
    send({ t: 'tv', key: k })
  }
  const run = (text: string) => {
    if (!text.trim()) return
    buzz()
    send({ t: 'command', text })
    setCommand('')
  }

  const Speech = speechRecognition()
  const listen = () => {
    if (!Speech) return
    const r = new Speech()
    r.lang = 'cs-CZ'
    r.interimResults = false
    r.onresult = (e) => {
      const text = e.results[0][0].transcript
      setCommand(text)
      run(text)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    setListening(true)
    r.start()
  }

  // Swipes on the pad move like the arrows; a tap is OK.
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return
    e.preventDefault()
    key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  const sleepMin = sleepEndsAt ? Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60_000)) : 0

  return (
    <div class="remote">
      <header>
        <div class="brand">a<span>TV</span></div>
        <div class={`status${connected && tv ? ' on' : ''}`}>
          {tv?.playing && <Icon name={tv.playing.paused ? 'pause' : 'play'} size={14} />}
          <span>{!connected ? 'Hub nedostupný' : tv ? (tv.playing ? tv.playing.title : 'Televize připojena') : 'aTV na televizi neběží'}</span>
          {sleepMin > 0 && (
            <>
              <Icon name="moon" size={14} />
              <span>{sleepMin} min</span>
            </>
          )}
        </div>
      </header>

      {tab === 'browser' ? (
        <BrowserTab showOnTv={(url) => run(`otevři ${url}`)} />
      ) : tab === 'design' ? (
        <DesignTab
          look={look?.appearance ?? null}
          photos={look?.backgrounds ?? []}
          token={token}
          onChange={(patch) => send({ t: 'appearance-set', patch })}
        />
      ) : (
        <>
        <form class="command" onSubmit={(e) => { e.preventDefault(); run(command) }}>
          <input value={command} placeholder="Řekněte nebo napište: pusť Netflix…" onInput={(e) => setCommand((e.target as HTMLInputElement).value)} enterKeyHint="send" />
          {Speech && window.isSecureContext ? (
            <button type="button" class={`mic${listening ? ' listening' : ''}`} onClick={listen} aria-label="Hlasový příkaz">
              <Icon name="mic" />
            </button>
          ) : (
            <button type="submit" class="mic" aria-label="Odeslat">
              <Icon name="send" />
            </button>
          )}
        </form>
        {result && <div class={`result${result.ok ? '' : ' error'}`}>{result.message}</div>}
        {!(Speech && window.isSecureContext) && <div class="muted small">Pro hlas použijte diktování na klávesnici telefonu (mikrofon na klávesnici).</div>}

        <div class="switch" role="tablist">
          <button role="tab" aria-selected={mode === 'buttons'} class={mode === 'buttons' ? 'on' : ''} onClick={() => chooseMode('buttons')}>Tlačítka</button>
          <button role="tab" aria-selected={mode === 'trackpad'} class={mode === 'trackpad' ? 'on' : ''} onClick={() => chooseMode('trackpad')}>Trackpad</button>
        </div>

        {mode === 'buttons' ? (
          <div class="pad" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <button class="up" aria-label="Nahoru" onClick={() => key('up')}><Icon name="up" size={30} /></button>
            <button class="left" aria-label="Doleva" onClick={() => key('left')}><Icon name="left" size={30} /></button>
            <button class="ok" onClick={() => key('ok')}>OK</button>
            <button class="right" aria-label="Doprava" onClick={() => key('right')}><Icon name="right" size={30} /></button>
            <button class="down" aria-label="Dolů" onClick={() => key('down')}><Icon name="down" size={30} /></button>
          </div>
        ) : (
          <>
            <Trackpad
              step={step}
              cursor={cursorMode}
              onKey={key}
              onPointer={(dx, dy) => send({ t: 'pointer', dx, dy })}
              onClick={() => {
                buzz()
                send({ t: 'click' })
              }}
            />
            <div class="switch small" role="tablist">
              <button role="tab" aria-selected={cursorMode} class={cursorMode ? 'on' : ''} onClick={() => chooseCursor(true)}>Kurzor</button>
              <button role="tab" aria-selected={!cursorMode} class={!cursorMode ? 'on' : ''} onClick={() => chooseCursor(false)}>Výběr</button>
            </div>
            <label class="sensitivity">
              <span>Citlivost</span>
              {/* Lower step = more sensitive; the slider runs the intuitive way. */}
              <input
                type="range"
                min={30}
                max={130}
                step={10}
                value={160 - step}
                onInput={(e) => {
                  const v = 160 - Number((e.target as HTMLInputElement).value)
                  setStep(v)
                  savePref(SENSITIVITY_KEY, String(v))
                }}
              />
            </label>
          </>
        )}

        <div class="buttons">
          <button onClick={() => key('back')}><Icon name="back" /> Zpět</button>
          <button onClick={() => run('domů')}><Icon name="home" /> Domů</button>
          <button aria-label="Přehrát/pauza" onClick={() => key('playpause')}><Icon name="playpause" /></button>
        </div>

        {samsung && (
          <div class="buttons">
            <button aria-label="Ztišit" onClick={() => tvKey('voldown')}><Icon name="voldown" /></button>
            <button aria-label="Vypnout zvuk" onClick={() => tvKey('mute')}><Icon name="mute" /></button>
            <button aria-label="Zesílit" onClick={() => tvKey('volup')}><Icon name="volup" /></button>
            <button onClick={() => { buzz(); send({ t: 'power-on' }) }}><Icon name="power" /> Zapnout</button>
            <button onClick={() => tvKey('power')}><Icon name="power" /> Vypnout</button>
          </div>
        )}

        <h2>Psát na televizi</h2>
        <form onSubmit={(e) => { e.preventDefault(); send({ t: 'text', text: typed, submit: true }); setTyped('') }}>
          <input
            value={typed}
            placeholder="Hledání, adresa, heslo…"
            enterKeyHint="go"
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value
              setTyped(v)
              send({ t: 'text', text: v })
            }}
          />
        </form>

        <h2>Aplikace</h2>
        <div class="apps">
          {APPS.map((a) => (
            <button key={a.id} style={{ background: a.background }} onClick={() => run(a.name)}>{a.name}</button>
          ))}
          <button class="plain" onClick={() => run('knihovna')}>Knihovna</button>
          <button class="plain" onClick={() => run('prohlížeč')}>Prohlížeč</button>
        </div>

        <CatalogSection token={token} />

        <h2>Časovač vypnutí</h2>
        <div class="buttons">
          {[15, 30, 60, 90].map((m) => (
            <button key={m} onClick={() => { buzz(); send({ t: 'sleep-set', minutes: m }) }}>{m} min</button>
          ))}
          <button onClick={() => send({ t: 'sleep-set', minutes: null })}>Zrušit</button>
        </div>

        <button class="unpair" onClick={onUnpaired}>Odpárovat tento telefon</button>
        </>
      )}

      <nav class="tabbar" role="tablist">
        <button role="tab" aria-selected={tab === 'remote'} class={tab === 'remote' ? 'on' : ''} onClick={() => chooseTab('remote')}><Icon name="remote" /> Ovladač</button>
        <button role="tab" aria-selected={tab === 'browser'} class={tab === 'browser' ? 'on' : ''} onClick={() => chooseTab('browser')}><Icon name="globe" /> Web</button>
        <button role="tab" aria-selected={tab === 'design'} class={tab === 'design' ? 'on' : ''} onClick={() => chooseTab('design')}><Icon name="palette" /> Vzhled</button>
      </nav>
    </div>
  )
}

interface CatalogEntry {
  id: string
  title: string
  languages: string[]
  subtitles: string[]
}

/** The owner's films: add a magnet link or a .torrent URL, remove entries. */
function CatalogSection({ token }: { token: string }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [source, setSource] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

  const load = () =>
    fetch('/api/catalog')
      .then((r) => r.json() as Promise<CatalogEntry[]>)
      .then(setEntries, () => {})
  useEffect(() => {
    void load()
  }, [])

  const add = async (e: Event) => {
    e.preventDefault()
    const res = await fetch('/api/catalog', { method: 'POST', headers, body: JSON.stringify({ source: source.trim(), title: title.trim() || undefined }) })
    const body = (await res.json()) as { error?: string; title?: string }
    if (!res.ok) return setMessage({ ok: false, text: body.error ?? 'Nepodařilo se přidat' })
    setMessage({ ok: true, text: `Přidáno: ${body.title}. Jazyky a titulky se doplní, až se torrent načte.` })
    setSource('')
    setTitle('')
    void load()
  }
  const remove = async (id: string) => {
    await fetch(`/api/catalog/${id}`, { method: 'DELETE', headers })
    void load()
  }

  return (
    <>
      <h2>Přidat film do katalogu</h2>
      <form class="stack" onSubmit={add}>
        <input value={source} placeholder="magnet:?xt=… nebo https://….torrent" onInput={(e) => setSource((e.target as HTMLInputElement).value)} />
        <input value={title} placeholder="Název (nepovinné)" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <button class="primary" type="submit" disabled={!source.trim()}>Přidat</button>
      </form>
      {message && <div class={`result${message.ok ? '' : ' error'}`}>{message.text}</div>}
      {entries.length > 0 && (
        <ul class="catalog">
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                {e.title}
                {(e.languages.length > 0 || e.subtitles.length > 0) && (
                  <small> · {[...e.languages.map((l) => l.toUpperCase()), ...(e.subtitles.length ? ['titulky'] : [])].join(' ')}</small>
                )}
              </span>
              <button aria-label="Odebrat" onClick={() => remove(e.id)}>
                Odebrat
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function RemoteApp() {
  const [token, setToken] = useState(loadToken)
  if (!token) {
    return <Pair onPaired={(t) => { saveToken(t); setToken(t) }} />
  }
  return <Remote token={token} onUnpaired={() => { saveToken(''); setToken('') }} />
}

render(<RemoteApp />, document.getElementById('remote')!)
