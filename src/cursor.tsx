import { setFocus } from './nav/focus'
import { createStore, useStore } from './state'

/**
 * aTV's own pointer for the phone trackpad where the TV has no native cursor (LG and Android for
 * now, a desktop browser during development). On a Samsung the hub moves the TV's real cursor instead.
 */
export const cursor = createStore({ x: 960, y: 540, visible: false })

let hideTimer: number | undefined

function show(x: number, y: number): void {
  cursor.set({ x, y, visible: true })
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => cursor.set((c) => ({ ...c, visible: false })), 5000)
}

function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const top = document.querySelector('.screen.top')
  return el && top && top.contains(el) ? el : null
}

export function moveCursor(dx: number, dy: number): void {
  const c = cursor.get()
  const x = Math.max(0, Math.min(window.innerWidth - 1, c.x + dx))
  const y = Math.max(0, Math.min(window.innerHeight - 1, c.y + dy))
  show(x, y)
  // Hovering a tile focuses it, like a mouse does; the browser picture wants the position itself.
  const target = targetAt(x, y)
  target?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
  const focusable = target?.closest?.('[data-focus]') as HTMLElement | null
  if (focusable) setFocus(focusable)
}

const held = { dir: '', at: 0, speed: 1 }

/**
 * The virtual mouse: a remote arrow moves the cursor, faster while the arrow is held. Returns false
 * when the cursor already sits at that edge of the screen, so the caller can scroll the content instead.
 */
export function stepCursor(dir: 'up' | 'down' | 'left' | 'right'): boolean {
  const now = Date.now()
  held.speed = held.dir === dir && now - held.at < 300 ? Math.min(held.speed + 0.6, 6) : 1
  held.dir = dir
  held.at = now
  const c = cursor.get()
  const step = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.025 * held.speed)
  const dx = dir === 'left' ? -step : dir === 'right' ? step : 0
  const dy = dir === 'up' ? -step : dir === 'down' ? step : 0
  const atEdge =
    c.visible &&
    ((dx < 0 && c.x <= 0) || (dx > 0 && c.x >= window.innerWidth - 1) || (dy < 0 && c.y <= 0) || (dy > 0 && c.y >= window.innerHeight - 1))
  if (atEdge) return false
  // The first press only shows the cursor where it was.
  if (!c.visible) show(Math.min(c.x, window.innerWidth - 1), Math.min(c.y, window.innerHeight - 1))
  else moveCursor(dx, dy)
  return true
}

/** Clicks what is under the cursor; returns false when the cursor is hidden (the caller then presses OK). */
export function clickCursor(): boolean {
  const c = cursor.get()
  if (!c.visible) return false
  show(c.x, c.y)
  const el = targetAt(c.x, c.y)
  const clickable = (el?.closest?.('[data-focus]') as HTMLElement | null) ?? el
  clickable?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: c.x, clientY: c.y }))
  return true
}

export function Cursor() {
  const c = useStore(cursor)
  return <div class={`cursor${c.visible ? ' show' : ''}`} style={{ transform: `translate(${c.x}px, ${c.y}px)` }} />
}
