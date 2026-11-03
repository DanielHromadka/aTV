export interface Notice {
  id: number
  title: string
  text?: string
  image?: string
}

let nextId = 1

export const ui = $state({
  toast: null as { id: number; text: string } | null,
  notices: [] as Notice[],
  /** The Appearance panel, drawn over whatever page is open. */
  appearanceOpen: false,
})

export function toast(text: string): void {
  const id = nextId++
  ui.toast = { id, text }
  setTimeout(() => {
    if (ui.toast?.id === id) ui.toast = null
  }, 3500)
}

/** A notice from the hub (a finished download, a doorbell); at most three at a time. */
export function notify(title: string, text?: string, image?: string, seconds = 10): void {
  const id = nextId++
  ui.notices = [...ui.notices, { id, title, text, image }].slice(-3)
  setTimeout(() => (ui.notices = ui.notices.filter((n) => n.id !== id)), seconds * 1000)
}
