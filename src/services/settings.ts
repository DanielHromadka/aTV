import { createStore } from '../state'

export interface JellyfinSession {
  server: string
  token: string
  userId: string
  userName: string
}

export interface Settings {
  /** Hub address; empty means the page's own origin (when the hub serves aTV). */
  hubUrl: string
  jellyfinServer: string
  jellyfin: JellyfinSession | null
  /** Home tiles in order; hidden ones stay listed so they can be shown again. */
  tiles: { id: string; hidden: boolean }[]
  /** 0 turns the screensaver off. */
  screensaverMinutes: number
  bookmarks: { name: string; url: string }[]
  /** Preferred language for audio and subtitles (ISO 639-1). */
  prefLang: string
  deviceId: string
  /** Remote arrows move an on-screen mouse: only in the browser (default), everywhere, or never. */
  virtualMouse: VirtualMouse
}

export type VirtualMouse = 'browser' | 'all' | 'off'
const MOUSE_MODES: VirtualMouse[] = ['browser', 'all', 'off']

const BOOKMARKS = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'Seznam', url: 'https://www.seznam.cz' },
  { name: 'ČT24', url: 'https://ct24.ceskatelevize.cz' },
  { name: 'iVysílání', url: 'https://www.ceskatelevize.cz/ivysilani/' },
  { name: 'Wikipedie', url: 'https://cs.wikipedia.org' },
]

const KEY = 'atv.settings'

function load(): Settings {
  let saved: Partial<Settings> = {}
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>
  } catch {
    // Private mode or a broken value: defaults.
  }
  return {
    hubUrl: saved.hubUrl ?? (import.meta.env.VITE_HUB_URL as string | undefined) ?? '',
    jellyfinServer: saved.jellyfinServer ?? '',
    jellyfin: saved.jellyfin ?? null,
    tiles: Array.isArray(saved.tiles) ? saved.tiles : [],
    screensaverMinutes: typeof saved.screensaverMinutes === 'number' ? saved.screensaverMinutes : 5,
    bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : BOOKMARKS,
    prefLang: saved.prefLang || 'cs',
    virtualMouse: MOUSE_MODES.includes(saved.virtualMouse as VirtualMouse) ? saved.virtualMouse! : 'browser',
    deviceId: saved.deviceId || `atv-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  }
}

export const settings = createStore<Settings>(load())

settings.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()))
  } catch {
    // Storage full or blocked: settings live for this session only.
  }
})

export function updateSettings(patch: Partial<Settings>): void {
  settings.set((s) => ({ ...s, ...patch }))
}
