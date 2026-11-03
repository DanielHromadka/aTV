import type { Action } from './keys.ts'
import type { Intent, TvKey } from './intents.ts'
import type { Appearance, CustomBackground } from './appearance.ts'

/** The household's home-screen look, sent to TVs and phones whenever it changes. */
export type AppearanceMessage = { t: 'appearance'; appearance: Appearance; backgrounds: CustomBackground[] }

/** What the TV reports, shown on the phone. */
export interface TvState {
  screen: string
  playing?: { title: string; paused: boolean }
}

/** TV → hub. */
export type TvMessage =
  | { t: 'hello'; role: 'tv'; platform: string }
  | { t: 'state'; state: TvState }
  | { t: 'playback'; state: 'playing' | 'paused' | 'stopped'; title?: string }
  | { t: 'sleep-set'; minutes: number | null }
  /** A change from the TV's Appearance panel; the hub applies it and sends the result to everyone. */
  | { t: 'appearance-set'; patch: Partial<Appearance> }

/** aTV web app (desktop browser) → hub. */
export type WebMessage =
  | { t: 'hello'; role: 'web' }
  | { t: 'appearance-set'; patch: Partial<Appearance> }
  | { t: 'sleep-set'; minutes: number | null }

/** Phone → hub. */
export type RemoteMessage =
  | { t: 'hello'; role: 'remote'; token: string }
  | { t: 'key'; action: Action }
  | { t: 'text'; text: string; submit?: boolean }
  | { t: 'command'; text: string }
  /** Trackpad in cursor mode: relative movement in TV pixels, and a click. */
  | { t: 'pointer'; dx: number; dy: number }
  | { t: 'click' }
  | { t: 'tv'; key: TvKey }
  | { t: 'power-on' }
  | { t: 'sleep-set'; minutes: number | null }
  | { t: 'appearance-set'; patch: Partial<Appearance> }

/** Hub → TV. */
export type HubToTv =
  | { t: 'key'; action: Action }
  | { t: 'pointer'; dx: number; dy: number }
  | { t: 'click' }
  | { t: 'text'; text: string; submit?: boolean }
  | { t: 'intent'; intent: Intent }
  | { t: 'notify'; title: string; text?: string; image?: string }
  /** A film was added to the Jellyfin folder: the TV asks Jellyfin to scan it (when the hub cannot). */
  | { t: 'library-updated' }
  | { t: 'sleep'; endsAt: number | null }
  | { t: 'sleep-fire' }
  | { t: 'pairing'; code: string; url: string }
  | AppearanceMessage

/** Hub → phone. */
export type HubToRemote =
  | { t: 'status'; tv: TvState | null; sleepEndsAt: number | null; samsung: boolean }
  | { t: 'result'; ok: boolean; message: string }
  | { t: 'unauthorized' }
  | AppearanceMessage

/** The parts of the hub's configuration a TV may read. */
export interface PublicConfig {
  jellyfinUrl?: string
  weather: { lat: number; lon: number; name: string }
  features: { samsung: boolean; iptv: boolean; photos: boolean; llm: boolean; homeAssistant: boolean; browser: boolean; browserAudio?: boolean; actors?: boolean }
}

/** aTV's own browser: a Chrome on the hub, shown on the TV as screencast frames. TV → hub. */
export type BrowserCommand =
  | { t: 'open'; url: string }
  | { t: 'back' }
  | { t: 'forward' }
  | { t: 'reload' }
  /** Coordinates as fractions (0–1) of the page, so the TV's picture size does not matter. */
  | { t: 'mouse'; kind: 'move' | 'click'; x: number; y: number }
  | { t: 'wheel'; x: number; y: number; dy: number }
  | { t: 'key'; key: BrowserKey; shift?: boolean }
  | { t: 'text'; text: string }

export type BrowserKey = 'Enter' | 'Backspace' | 'Tab' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** Hub → TV, as text; the frames themselves come as binary JPEG messages. */
export type BrowserEvent = { t: 'state'; state: BrowserState } | { t: 'error'; message: string }
