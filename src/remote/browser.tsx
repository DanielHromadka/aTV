import { useEffect, useRef, useState } from 'preact/hooks'
import type { BrowserCommand, BrowserEvent, BrowserState } from '../../shared/protocol.ts'
import { toUrl } from '../../shared/text.ts'
import { Icon } from './icons'

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false }

/**
 * The hub's browser on the phone or a computer: the same tab the TV shows, live. A tap clicks,
 * a drag scrolls, a mouse wheel scrolls, and the fields type into the page or open an address.
 * `showOnTv` opens the address in aTV's browser on the TV (a command, so the TV switches to it).
 */
export function BrowserTab({ showOnTv }: { showOnTv: (url: string) => void }) {
  const ws = useRef<WebSocket | null>(null)
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [frame, setFrame] = useState('')
  const [error, setError] = useState('')
  const [address, setAddress] = useState('')
  const [typed, setTyped] = useState('')
  const drag = useRef<{ x: number; y: number; lastY: number; moved: boolean } | null>(null)
  const old = useRef<string[]>([])

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    const connect = () => {
      const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/browser`)
      socket.binaryType = 'blob'
      ws.current = socket
      socket.onopen = () => setError('')
      socket.onmessage = (e) => {
        if (e.data instanceof Blob) {
          const url = URL.createObjectURL(e.data)
          setFrame((prev) => {
            if (prev) old.current.push(prev)
            return url
          })
          return
        }
        const msg = JSON.parse(String(e.data)) as BrowserEvent
        if (msg.t === 'state') setState(msg.state)
        else setError(msg.message)
      }
      socket.onclose = () => {
        if (closed) return
        setError('Spojení s prohlížečem na hubu se přerušilo, zkouším znovu…')
        retry = window.setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      ws.current?.close()
      old.current.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const send = (cmd: BrowserCommand) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(cmd))
  }
  const at = (e: PointerEvent | WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, h: r.height }
  }

  const onDown = (e: PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, lastY: e.clientY, moved: false }
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8) d.moved = true
    if (!d.moved) return
    // A finger drag scrolls the page the way a phone does: content follows the finger.
    const p = at(e)
    const dy = ((d.lastY - e.clientY) / p.h) * 720
    if (Math.abs(dy) >= 20) {
      send({ t: 'wheel', x: p.x, y: p.y, dy })
      d.lastY = e.clientY
    }
  }
  const onUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const p = at(e)
    send({ t: 'mouse', kind: 'click', x: p.x, y: p.y })
  }

  const open = (e: Event) => {
    e.preventDefault()
    if (!address.trim()) return
    send({ t: 'open', url: toUrl(address) })
  }

  return (
    <div class="browser-tab">
      <h2>Prohlížeč na hubu</h2>
      <form class="command" onSubmit={open}>
        <input value={address} placeholder="Adresa nebo hledání" enterKeyHint="go" inputMode="url"
          onInput={(e) => setAddress((e.target as HTMLInputElement).value)} />
        <button type="submit" class="mic" aria-label="Otevřít"><Icon name="send" /></button>
      </form>
      <div class="buttons">
        <button disabled={!state.canGoBack} aria-label="Zpět" onClick={() => send({ t: 'back' })}><Icon name="left" /></button>
        <button disabled={!state.canGoForward} aria-label="Vpřed" onClick={() => send({ t: 'forward' })}><Icon name="right" /></button>
        <button onClick={() => send({ t: 'reload' })}>{state.loading ? 'Načítám…' : 'Obnovit'}</button>
        <button
          disabled={!state.url && !address.trim()}
          onClick={() => showOnTv(state.url || toUrl(address))}
        >
          <Icon name="send" /> Na televizi
        </button>
      </div>
      {error && <div class="result error">{error}</div>}
      <div class="browser-shot">
        {state.url && frame ? (
          <img
            src={frame}
            alt={state.title || 'Stránka v prohlížeči hubu'}
            draggable={false}
            onLoad={() => {
              old.current.forEach((u) => URL.revokeObjectURL(u))
              old.current = []
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => {
              e.preventDefault()
              const p = at(e)
              send({ t: 'wheel', x: p.x, y: p.y, dy: e.deltaY })
            }}
          />
        ) : (
          <div class="muted browser-empty">Napište adresu nahoře. Stránka se ukáže tady i na televizi, pokud tam máte otevřený Prohlížeč.</div>
        )}
      </div>
      {state.url && <div class="muted small browser-url">{state.title ? `${state.title} · ` : ''}{state.url}</div>}
      <h2>Psát do stránky</h2>
      <form onSubmit={(e) => {
        e.preventDefault()
        if (typed) send({ t: 'text', text: typed })
        send({ t: 'key', key: 'Enter' })
        setTyped('')
      }}>
        <input value={typed} placeholder="Klepněte do pole na stránce a pište" enterKeyHint="send"
          onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
      </form>
      <div class="buttons">
        <button onClick={() => { if (typed) send({ t: 'text', text: typed }); setTyped('') }}>Vložit text</button>
        <button onClick={() => send({ t: 'key', key: 'Backspace' })}>⌫</button>
        <button onClick={() => send({ t: 'key', key: 'Tab' })}>Tab</button>
        <button onClick={() => send({ t: 'key', key: 'Escape' })}>Esc</button>
      </div>
    </div>
  )
}
