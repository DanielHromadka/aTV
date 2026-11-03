export interface JellyfinSession {
  server: string
  token: string
  userId: string
  userName: string
}

export interface Bookmark {
  name: string
  url: string
}

/** The same settings as the TV app; in one browser both read the same storage, so logins carry over. */
export interface Settings {
  /** Hub address; empty means the page's own origin (when the hub serves aTV). */
  hubUrl: string
  jellyfinServer: string
  jellyfin: JellyfinSession | null
  /** Home tiles in order; hidden ones stay listed so they can be shown again. */
  tiles: { id: string; hidden: boolean }[]
  /** 0 turns the screensaver off. */
  screensaverMinutes: number
  bookmarks: Bookmark[]
  /** Preferred language for audio and subtitles (ISO 639-1). */
  prefLang: string
  deviceId: string
}

const KEY = 'atv.settings'

const BOOKMARKS: Bookmark[] = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'Seznam', url: 'https://www.seznam.cz' },
  { name: 'ČT24', url: 'https://ct24.ceskatelevize.cz' },
  { name: 'iVysílání', url: 'https://www.ceskatelevize.cz/ivysilani/' },
  { name: 'Wikipedie', url: 'https://cs.wikipedia.org' },
]

function readSaved(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    // Private mode or a broken value: defaults.
    return {}
  }
}

function load(saved: Record<string, unknown>): Settings {
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
  return {
    hubUrl: str(saved.hubUrl, (import.meta.env.VITE_HUB_URL as string | undefined) ?? ''),
    jellyfinServer: str(saved.jellyfinServer, ''),
    jellyfin: (saved.jellyfin as JellyfinSession | null | undefined) ?? null,
    tiles: Array.isArray(saved.tiles) ? saved.tiles : [],
    screensaverMinutes: typeof saved.screensaverMinutes === 'number' ? saved.screensaverMinutes : 5,
    bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : BOOKMARKS,
    prefLang: str(saved.prefLang, '') || 'cs',
    deviceId: str(saved.deviceId, '') || `atv-web-${crypto.randomUUID()}`,
  }
}

export const settings: Settings = $state(load(readSaved()))

/** Saves a change, keeping fields only the TV app knows (such as its virtual mouse). */
export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch)
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readSaved(), ...$state.snapshot(settings) }))
  } catch {
    // Storage full or blocked: settings live for this session only.
  }
}

// The deviceId is generated once and must stay stable for Jellyfin.
updateSettings({})
