/** Česká televize's iVysílání as the hub serves it to the TV (only streams without DRM). */

export interface CtChannel {
  /** ČT's channel id, e.g. "CH_24". */
  id: string
  name: string
}

export interface CtShow {
  id: string
  title: string
  description?: string
  image?: string
  playable: boolean
}

export interface CtEpisode {
  /** ČT's external media id (IDEC without separators), used for the stream. */
  id: string
  title: string
  showTitle?: string
  description?: string
  image?: string
  /** Seconds. */
  duration?: number
  playable: boolean
  /** ISO date of the broadcast. */
  date?: string
}

export interface CtSearch {
  shows: CtShow[]
  episodes: CtEpisode[]
}

export interface CtEpisodes {
  show: { id: string; title: string; description?: string; image?: string }
  total: number
  items: CtEpisode[]
}

/** What the TV needs to start a programme: hub URLs that resolve to a fresh CDN address each time. */
export interface CtPlay {
  title: string
  url: string
  live: boolean
  duration?: number
  poster?: string
  subtitle?: { label: string; lang: string; src: string }
}

export const CT_CHANNELS: CtChannel[] = [
  { id: 'CH_1', name: 'ČT1' },
  { id: 'CH_2', name: 'ČT2' },
  { id: 'CH_24', name: 'ČT24' },
  { id: 'CH_4', name: 'ČT sport' },
  { id: 'CH_5', name: 'ČT :D' },
  { id: 'CH_6', name: 'ČT art' },
  { id: 'CH_7', name: 'ČT3' },
]

export const isCtChannel = (id: string): boolean => CT_CHANNELS.some((c) => c.id === id)
export const isCtMediaId = (id: string): boolean => /^\d{6,20}$/.test(id)
/** Show ids are numeric (legacy SIDP/IDP). */
export const isCtShowId = (id: string): boolean => /^\d{3,20}$/.test(id)

/** "1:05:12" or "28 min" for a card subtitle. */
export function ctDuration(seconds?: number): string | undefined {
  if (!seconds || seconds <= 0) return undefined
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
