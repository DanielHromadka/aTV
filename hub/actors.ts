import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Actor, ActorLibrary, ActorMovie, ActorPage, Filmography } from '../shared/actors.ts'
import type { FilmArt, FilmDetails } from '../shared/release.ts'

interface Person { id: number; name: string; also_known_as?: string[]; profile_path?: string; biography?: string; adult?: boolean; known_for_department?: string; known_for?: { title?: string; name?: string }[] }
interface Movie { id: number; title: string; release_date?: string; overview?: string; poster_path?: string; backdrop_path?: string; vote_average?: number; vote_count?: number; genre_ids?: number[]; adult?: boolean }
interface Credit { id: number; title: string; original_title?: string; release_date?: string; poster_path?: string; character?: string; adult?: boolean }
const image = (path?: string, size = 'w500') => path && /^\/[\w.-]+$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : undefined
const actor = (p: Person): Actor => ({ id: String(p.id), name: p.name, aliases: p.also_known_as, photo: image(p.profile_path), source: 'tmdb', knownFor: p.known_for?.map((m) => m.title || m.name).filter(Boolean).join(' · ') })

export function movieCredits(credits: Credit[]): ActorMovie[] {
  const unique = new Map<number, ActorMovie>()
  for (const c of credits) {
    if (c.adult || !Number.isInteger(c.id) || !c.title) continue
    const year = Number(c.release_date?.slice(0, 4)) || undefined
    const found = unique.get(c.id)
    if (found) {
      if (c.character && !found.role?.includes(c.character)) found.role = [found.role, c.character].filter(Boolean).join(' / ')
      continue
    }
    unique.set(c.id, { id: String(c.id), title: c.title, originalTitle: c.original_title || c.title, year,
      poster: image(c.poster_path), role: c.character, source: 'tmdb' })
  }
  return [...unique.values()].sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'cs'))
}

export class Actors {
  private cache = new Map<string, { expires: number; value: unknown }>()
  private key: string
  private fetcher: typeof fetch
  private library?: ActorLibrary
  constructor(key: string, fetcher: typeof fetch = fetch, dataDir?: string) {
    this.key = key; this.fetcher = fetcher
    if (dataDir) {
      try {
        const saved = JSON.parse(readFileSync(join(dataDir, 'actors-library.json'), 'utf8')) as ActorLibrary
        if (saved.version === 1 && Array.isArray(saved.entries) && [100, 400].includes(saved.entries.length)
          && saved.entries.every((e) => /^\d+$/.test(e.actor?.id) && e.actor?.source === 'tmdb' && Array.isArray(e.movies))) this.library = saved
      } catch { /* A missing import falls back to live TMDB browsing. */ }
    }
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const cacheKey = path + JSON.stringify(params)
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.value as T
    const url = new URL(`https://api.themoviedb.org/3${path}`)
    url.searchParams.set('language', 'cs-CZ')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.key.includes('.')) headers.Authorization = `Bearer ${this.key}`
    else url.searchParams.set('api_key', this.key)
    let res: Response
    try { res = await this.fetcher(url, { headers, signal: AbortSignal.timeout(12_000) }) }
    catch { throw new Error('Filmová databáze neodpovídá. Zkuste to znovu.') }
    if (res.status === 401 || res.status === 403) throw new Error('Přístup k TMDB nebyl přijat. Zkontrolujte API klíč v konfiguraci hubu.')
    if (!res.ok) throw new Error('Filmová databáze je dočasně nedostupná. Zkuste to znovu.')
    let value: T
    try { value = await res.json() as T } catch { throw new Error('Filmová databáze vrátila neplatná data.') }
    if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(cacheKey, { expires: Date.now() + 3_600_000, value })
    return value
  }

  async list(query: string, page: number, language = 'cs-CZ'): Promise<ActorPage> {
    const q = query.trim().slice(0, 120)
    if (!q && this.library) {
      const size = 20
      const { title, fromYear, toYear, entries } = this.library
      return { actors: entries.slice((page - 1) * size, page * size).map((e) => e.actor), page, more: page * size < entries.length,
        source: 'tmdb', collection: { title, fromYear, toYear, total: entries.length } }
    }
    const data = await this.get<{ results: Person[]; total_pages: number }>(q ? '/search/person' : '/person/popular',
      { page: String(page), language, ...(q ? { query: q, include_adult: 'false' } : {}) })
    return { actors: data.results.filter((p) => !p.adult && p.known_for_department === 'Acting').map(actor), page, more: page < Math.min(data.total_pages, 500), source: 'tmdb' }
  }

  async filmography(id: string): Promise<Filmography> {
    if (!/^\d{1,10}$/.test(id)) throw new Error('Neplatný identifikátor herce')
    const saved = this.library?.entries.find((e) => e.actor.id === id)
    if (saved) return saved
    const [person, credits] = await Promise.all([
      this.get<Person>(`/person/${id}`), this.get<{ cast: Credit[] }>(`/person/${id}/movie_credits`),
    ])
    if (person.adult) throw new Error('Tento profil není dostupný')
    return { actor: actor(person), biography: person.biography, movies: movieCredits(credits.cast) }
  }

  /** Artwork and a Czech overview for a film found by its release name; null when unknown. */
  async film(name: string, year?: number): Promise<FilmArt | null> {
    const query = name.trim().slice(0, 120)
    if (!query) return null
    const search = (y?: number) => this.get<{ results: Movie[] }>('/search/movie', { query, include_adult: 'false', ...(y ? { year: String(y) } : {}) })
    let found = (await search(year)).results.filter((m) => !m.adult)
    // Release years differ from the database by a year at most; another year is another film.
    if (!found.length && year) found = (await search()).results.filter((m) => !m.adult && Math.abs((Number(m.release_date?.slice(0, 4)) || 0) - year) <= 1)
    // Prefer a known film over an obscure namesake.
    const m = found.slice(0, 5).sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))[0]
    if (!m) return null
    const genres = await this.get<{ genres: { id: number; name: string }[] }>('/genre/movie/list').catch(() => ({ genres: [] }))
    return {
      id: String(m.id), title: m.title, year: Number(m.release_date?.slice(0, 4)) || undefined, overview: m.overview || undefined,
      poster: image(m.poster_path), backdrop: image(m.backdrop_path, 'w1280'), rating: m.vote_count ? m.vote_average : undefined,
      genres: (m.genre_ids ?? []).map((id) => genres.genres.find((g) => g.id === id)?.name).filter((g): g is string => !!g).slice(0, 3),
    }
  }

  /** Overview, rating, runtime, director and the main cast of one film. */
  async filmDetails(id: string): Promise<FilmDetails> {
    if (!/^\d{1,10}$/.test(id)) throw new Error('Neplatný identifikátor filmu')
    type Cast = { id: number; name: string; character?: string; profile_path?: string; adult?: boolean }
    const m = await this.get<Movie & { original_title?: string; tagline?: string; runtime?: number; genres?: { name: string }[]
      credits?: { cast: Cast[]; crew: { name: string; job: string }[] } }>(`/movie/${id}`, { append_to_response: 'credits' })
    if (m.adult) throw new Error('Tento film není dostupný')
    // Czech overviews are often missing; the English one is better than none.
    const overview = m.overview || (await this.get<Movie>(`/movie/${id}`, { language: 'en-US' }).catch(() => null))?.overview || undefined
    return {
      id: String(m.id), title: m.title, originalTitle: m.original_title !== m.title ? m.original_title : undefined,
      year: Number(m.release_date?.slice(0, 4)) || undefined, overview, tagline: m.tagline || undefined, runtime: m.runtime || undefined,
      poster: image(m.poster_path), backdrop: image(m.backdrop_path, 'w1280'),
      rating: m.vote_count ? m.vote_average : undefined, votes: m.vote_count || undefined,
      genres: (m.genres ?? []).map((g) => g.name).slice(0, 3),
      directors: (m.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 2),
      cast: (m.credits?.cast ?? []).filter((c) => !c.adult).slice(0, 15)
        .map((c) => ({ id: String(c.id), name: c.name, character: c.character || undefined, photo: image(c.profile_path, 'w185') })),
    }
  }
}
