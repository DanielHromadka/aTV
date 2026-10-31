import { nextFocus, type Direction } from '../../shared/spatial.ts'

/**
 * Focus for the remote: elements with `data-focus="<id>"` in the top screen are focusable.
 * Only a `focused` class moves (no DOM focus), so TV engines never pop up their own UI.
 * The last focused id is remembered per screen, so Back lands where the user left.
 */

let current: HTMLElement | null = null
const remembered = new Map<string, string>()
const listeners = new Set<(el: HTMLElement) => void>()

/** Calls back whenever focus moves (the home sidebar previews the focused app). */
export function onFocusChange(l: (el: HTMLElement) => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.screen.top')
}

function visible(el: HTMLElement): boolean {
  return el.offsetWidth > 0 || el.offsetHeight > 0
}

function focusables(r: HTMLElement): HTMLElement[] {
  return Array.prototype.slice.call(r.querySelectorAll('[data-focus]')).filter(visible)
}

export function currentFocus(): HTMLElement | null {
  return current
}

export function setFocus(el: HTMLElement): void {
  if (current === el) return
  if (current) current.classList.remove('focused')
  current = el
  el.classList.add('focused')
  reveal(el)
  const r = root()
  if (r && r.dataset.screen) remembered.set(r.dataset.screen, el.dataset.focus ?? '')
  listeners.forEach((l) => l(el))
}

export function move(dir: Direction): boolean {
  const r = root()
  if (!r) return false
  const items = focusables(r)
  if (!current || !r.contains(current)) {
    ensure()
    return true
  }
  const from = current.getBoundingClientRect()
  const others = items.filter((el) => el !== current)
  const i = nextFocus(from, others.map((el) => el.getBoundingClientRect()), dir)
  if (i < 0) return false
  setFocus(others[i])
  return true
}

export function activate(): void {
  if (current && root()?.contains(current)) current.click()
}

/** Puts focus back inside the top screen after it changed: remembered item, autofocus, or the first one. */
export function ensure(): void {
  const r = root()
  if (!r) return
  if (current && r.contains(current) && visible(current)) return
  const items = focusables(r)
  if (!items.length) {
    current = null
    return
  }
  const id = r.dataset.screen ? remembered.get(r.dataset.screen) : undefined
  const next =
    (id && items.find((el) => el.dataset.focus === id)) ||
    items.find((el) => el.hasAttribute('data-autofocus')) ||
    items[0]
  if (current) current.classList.remove('focused')
  current = null
  setFocus(next)
}

/** Focuses a specific element by its id within the top screen (e.g. after a list reloads). */
export function focusById(id: string): void {
  const el = root()?.querySelector<HTMLElement>(`[data-focus="${id}"]`)
  if (el) setFocus(el)
}

/**
 * Scrolls containers marked `data-scroll="x"` or `"y"` so the element is fully visible with some margin.
 * Inside a block marked `data-scroll-pin` (the home screen's top part) a vertical container instead
 * shows the whole block from its top, so the clock and buttons never shift while moving through it.
 */
function reveal(el: HTMLElement): void {
  const pin = el.closest('[data-scroll-pin]') as HTMLElement | null
  for (let p = el.parentElement; p; p = p.parentElement) {
    const axis = p.dataset.scroll
    if (!axis) continue
    const box = p.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // Screen distances are scaled when the page is zoomed to fit a browser window; scroll offsets are not.
    const k = (axis === 'x' ? box.width / p.offsetWidth : box.height / p.offsetHeight) || 1
    const margin = 80 * k
    if (axis === 'y' && pin && p.contains(pin)) {
      p.scrollTop += (pin.getBoundingClientRect().top - box.top) / k
    } else if (axis === 'x') {
      if (r.left < box.left + margin) p.scrollLeft -= (box.left + margin - r.left) / k
      else if (r.right > box.right - margin) p.scrollLeft += (r.right - (box.right - margin)) / k
    } else {
      if (r.top < box.top + margin) p.scrollTop -= (box.top + margin - r.top) / k
      else if (r.bottom > box.bottom - margin) p.scrollTop += (r.bottom - (box.bottom - margin)) / k
    }
  }
}

/** Keeps focus valid while screens render asynchronously, and lets the mouse move it too. */
export function installFocus(app: HTMLElement): void {
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      ensure()
    })
  }).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  app.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest?.('[data-focus]') as HTMLElement | null
    if (el && root()?.contains(el)) setFocus(el)
  })
}
