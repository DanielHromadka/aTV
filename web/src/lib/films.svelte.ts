import type { MediaResult, MediaSearch } from '../../../shared/media.ts'
import { groupFilms, type Film, type FilmArt, type FilmDetails } from '../../../shared/release.ts'
import { hub, hubApi } from './hub.svelte.ts'
import { nav } from './router.svelte.ts'

const art = new Map<string, Promise<FilmArt | null>>()
/** Films seen in the last results, so the film page opens without searching again. */
const seen = new Map<string, Film>()

/** Backdrop, poster and a Czech overview from the film database; null without it or when unknown. */
export function filmArt(name: string, year?: number): Promise<FilmArt | null> {
  if (!hub.config?.features.actors) return Promise.resolve(null)
  const key = `${name}|${year ?? ''}`
  let found = art.get(key)
  if (!found) {
    found = hubApi<FilmArt | null>(`/api/films/art?q=${encodeURIComponent(name)}${year ? `&year=${year}` : ''}`).catch(() => null)
    art.set(key, found)
  }
  return found
}

const details = new Map<string, Promise<FilmDetails | null>>()

/** Cast, director, runtime and the full overview of a film the database knows. */
export function filmDetails(id: string): Promise<FilmDetails | null> {
  let found = details.get(id)
  if (!found) {
    found = hubApi<FilmDetails>(`/api/films/${encodeURIComponent(id)}`).catch(() => null)
    details.set(id, found)
  }
  return found
}

export function openFilm(film: Film, action?: 'play' | 'download'): void {
  seen.set(film.key, film)
  nav.push({ name: 'film', key: film.key, query: film.year ? `${film.name} ${film.year}` : film.name, action })
}

/** The film from the last results, or found again by searching (after a reload). */
export async function findFilm(key: string, query: string): Promise<Film | null> {
  const known = seen.get(key)
  if (known) return known
  for (let i = 0; i < 20; i++) {
    const data = await hubApi<MediaSearch>(`/api/media/search?progressive=1&q=${encodeURIComponent(query)}`)
    const film = groupFilms(data.results).find((f) => f.key === key)
    if (film || !data.pending) return film ?? null
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

/** The release to play: one in the preferred language with sources, else the most seeded. */
export function bestRelease(film: Film, lang: string): MediaResult {
  const alive = film.releases.filter((r) => r.seeders !== 0)
  return alive.find((r) => r.languages.includes(lang)) ?? alive[0] ?? film.releases[0]
}

export const gb = (bytes?: number) => (bytes ? `${(bytes / 1_000_000_000).toLocaleString('cs', { maximumFractionDigits: 1 })} GB` : '')
