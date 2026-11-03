import type { Actor } from '../../../shared/actors.ts'
import type { PlayerSource } from '../../../shared/playback.ts'

/** Every page of the web app; the same screens as on the TV. */
export type Route =
  | { name: 'home' }
  | { name: 'library'; parentId?: string; title?: string; collectionType?: string }
  | { name: 'detail'; itemId: string }
  | { name: 'player'; source: PlayerSource }
  /** Film filters and order stay in the address, so Back returns to the same view. */
  | { name: 'search'; query?: string; sort?: string; quality?: string; years?: string; genre?: string; lang?: string; subs?: string; available?: string }
  | { name: 'iptv' }
  | { name: 'ivysilani' }
  | { name: 'ct-show'; id: string; title: string }
  | { name: 'settings' }
  | { name: 'browser'; url?: string }
  | { name: 'media' }
  | { name: 'media-detail'; mediaId: string; title: string; poster?: string; description?: string; year?: number }
  /** One film with all its torrent releases; `query` finds them again after a reload. */
  | { name: 'film'; key: string; query: string; action?: 'play' | 'download' }
  | { name: 'audio'; indexer?: string; label?: string; query?: string }
  | { name: 'source-search'; indexer: string; label: string }
  | { name: 'audio-detail'; mediaId: string; title: string; poster?: string }
  | { name: 'artists' }
  | { name: 'art-artist'; id: string }
  | { name: 'gallery'; artistId: string; start: number }
  | { name: 'musicians' }
  | { name: 'musician'; id: string }
  | { name: 'actors' }
  | { name: 'actor'; actor: Actor }
  | { name: 'login' }

export type RouteName = Route['name']

const NUMBERS = new Set(['start', 'year'])
const OBJECTS = new Set(['source', 'actor'])

/** "#/media-detail?mediaId=ia%3Anosferatu&title=Nosferatu": readable, and a reload opens the same page. */
export function hashFor(route: Route): string {
  const { name, ...params } = route
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  const s = q.toString()
  return name === 'home' ? '#/' : `#/${name}${s ? `?${s}` : ''}`
}

export function parseHash(hash: string): Route {
  const m = /^#\/([a-z-]*)(?:\?(.*))?$/.exec(hash)
  if (!m || !m[1]) return { name: 'home' }
  const params: Record<string, unknown> = {}
  for (const [k, v] of new URLSearchParams(m[2] ?? '')) {
    if (OBJECTS.has(k)) {
      try {
        params[k] = JSON.parse(v)
      } catch {
        return { name: 'home' }
      }
    } else params[k] = NUMBERS.has(k) ? Number(v) : v
  }
  return { name: m[1], ...params } as Route
}

export const router = $state({ route: parseHash(location.hash) })

window.addEventListener('hashchange', () => {
  router.route = parseHash(location.hash)
  window.scrollTo(0, 0)
})

export const nav = {
  push(route: Route): void {
    location.hash = hashFor(route)
  },
  /** Swaps the current page, e.g. the player for the next episode. */
  replace(route: Route): void {
    history.replaceState(null, '', hashFor(route))
    router.route = route
  },
  back(): void {
    if (history.length > 1) history.back()
    else nav.push({ name: 'home' })
  },
  home(): void {
    nav.push({ name: 'home' })
  },
}
