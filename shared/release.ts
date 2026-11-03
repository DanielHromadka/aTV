import type { MediaResult } from './media.ts'
import { normalize } from './text.ts'

export type Quality = '4K' | 'Full HD' | 'HD' | 'SD'

/** What a release name says: "Matrix (1999) WEBRip 1080p HEVC" → Matrix, 1999, Full HD. */
export interface Release {
  name: string
  year?: number
  quality?: Quality
  hdr: boolean
}

const TOKENS = /\b(?:(?:480|576|720|1080|2160|4320)[pi]|4k|uhd|proper|unrated|repack|remastered|extended|imax|bluray|blu ?ray|bdrip|brrip|webrip|web ?dl|web|hdtv|hdrip|dvdrip|dvd|x26[45]|h ?26[45]|hevc|xvid|aac|ac3|dts|multi|subs?|dual|dabing|cz|eng?|ita|3d)\b/i
const QUALITY: [RegExp, Quality][] = [
  [/\b(?:2160p|4320p|4k|uhd)\b/i, '4K'],
  [/\b1080[pi]\b/i, 'Full HD'],
  [/\b720p\b/i, 'HD'],
  [/\b(?:480p|576p|dvdrip|dvd|xvid|sd)\b/i, 'SD'],
]

export function parseRelease(raw: string): Release {
  const text = raw
    .replace(/&amp;/gi, '&')
    .replace(/\.(mkv|mp4|avi|m4v|webm)$/i, '')
    .replace(/^\s*\[[^\]]*\]\s*-?\s*/, '')
    .replace(/[._]+/g, ' ')
  const year = /(?:^|[\s[(-])((?:19|20)\d{2})(?=$|[\s)\]-])/g
  let found: RegExpExecArray | null
  let cut = -1
  let releaseYear: number | undefined
  // A year at the very start is part of the name ("2001 A Space Odyssey 1968").
  while ((found = year.exec(text))) {
    if (found.index === 0 && !/^\s*[[(]/.test(text)) continue
    cut = found.index
    releaseYear = Number(found[1])
    break
  }
  const token = TOKENS.exec(text)
  if (token && token.index > 0 && (cut < 0 || token.index < cut)) cut = token.index
  const name = (cut > 0 ? text.slice(0, cut) : text)
    .replace(/[[(][^\])]*$/, '')
    .replace(/[\s\-–:[(]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  // "Matrix - The Matrix": the same name twice, local and original.
  const twice = /^(.+?)\s+[-–]\s+(?:the\s+)?(.+)$/i.exec(name)
  return {
    name: twice && normalize(twice[1]) === normalize(twice[2]) ? twice[1] : name || text.trim(),
    year: releaseYear,
    quality: QUALITY.find(([re]) => re.test(text))?.[1],
    hdr: /\b(?:hdr10?\+?|hdr|dolby ?vision|dv)\b/i.test(text),
  }
}

/** One film with all its releases, for a Netflix-like result grid. */
export interface Film {
  key: string
  name: string
  year?: number
  /** Ranked as they came, most seeded first. */
  releases: MediaResult[]
  quality?: Quality
  poster?: string
  description?: string
}

const QUALITY_ORDER: Quality[] = ['4K', 'Full HD', 'HD', 'SD']
export const filmKey = (name: string, year?: number) => `${normalize(name)}${year ? `|${year}` : ''}`

/**
 * Releases of the same film grouped, in the order the search ranked them. A release without a year
 * joins the only dated film of that name; archive and own-catalog films keep their own titles.
 */
export function groupFilms(results: MediaResult[]): Film[] {
  const films = new Map<string, Film>()
  const undated: [MediaResult, Release][] = []
  for (const r of results) {
    const parsed: Release = r.source === 'public' ? parseRelease(r.title) : { name: r.title, year: r.year, hdr: false }
    const year = parsed.year ?? r.year
    if (!year && r.source === 'public') {
      undated.push([r, parsed])
      continue
    }
    add(films, filmKey(parsed.name, year), parsed.name, year, r, parsed.quality)
  }
  for (const [r, parsed] of undated) {
    const base = normalize(parsed.name)
    const dated = [...films.values()].filter((f) => normalize(f.name) === base)
    if (dated.length === 1) add(films, dated[0].key, dated[0].name, dated[0].year, r, parsed.quality)
    else add(films, filmKey(parsed.name), parsed.name, undefined, r, parsed.quality)
  }
  const order = new Map(results.map((r, i) => [r.id, i]))
  return [...films.values()]
    .map((f) => ({ ...f, releases: f.releases.sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1) || order.get(a.id)! - order.get(b.id)!) }))
    .sort((a, b) => Math.min(...a.releases.map((r) => order.get(r.id)!)) - Math.min(...b.releases.map((r) => order.get(r.id)!)))
}

function add(films: Map<string, Film>, key: string, name: string, year: number | undefined, r: MediaResult, quality?: Quality): void {
  const film = films.get(key) ?? { key, name, year, releases: [] }
  film.releases.push(r)
  if (quality && (!film.quality || QUALITY_ORDER.indexOf(quality) < QUALITY_ORDER.indexOf(film.quality))) film.quality = quality
  film.poster ??= r.poster
  film.description ??= r.description
  films.set(key, film)
}

/** Film artwork and details from the film database, when it knows the film. */
export interface FilmArt {
  id: string
  title: string
  year?: number
  overview?: string
  poster?: string
  backdrop?: string
  /** 0–10. */
  rating?: number
  genres: string[]
}

export type FilmSort = 'relevance' | 'seeders' | 'newest' | 'oldest' | 'rating' | 'name'

export interface FilmFilter {
  /** Only releases of this quality. */
  quality?: Quality
  /** Only releases somebody seeds. */
  available?: boolean
  /** Release years, inclusive. */
  from?: number
  to?: number
}

/** Films narrowed to the matching releases; a film without any drops out. */
export function filterFilms(films: Film[], f: FilmFilter): Film[] {
  return films.flatMap((film) => {
    if ((f.from || f.to) && !film.year) return []
    if (f.from && film.year! < f.from) return []
    if (f.to && film.year! > f.to) return []
    const releases = film.releases.filter((r) =>
      (!f.available || r.seeders !== 0) && (!f.quality || (r.source === 'public' ? parseRelease(r.title).quality : undefined) === f.quality))
    if (!releases.length) return []
    return [releases.length === film.releases.length ? film : { ...film, releases, quality: f.quality ?? film.quality }]
  })
}

/** Films in the chosen order; unknown years and ratings go last, ties keep the search ranking. */
export function sortFilms(films: Film[], sort: FilmSort, rating: (film: Film) => number | undefined = () => undefined): Film[] {
  if (sort === 'relevance') return films
  const seeds = (f: Film) => f.releases.reduce((n, r) => n + (r.seeders ?? 0), 0)
  const by: Record<Exclude<FilmSort, 'relevance'>, (a: Film, b: Film) => number> = {
    seeders: (a, b) => seeds(b) - seeds(a),
    newest: (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
    oldest: (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity),
    rating: (a, b) => (rating(b) ?? -1) - (rating(a) ?? -1),
    name: (a, b) => a.name.localeCompare(b.name, 'cs'),
  }
  return films.map((film, i) => ({ film, i })).sort((a, b) => by[sort](a.film, b.film) || a.i - b.i).map((x) => x.film)
}

/** The film page's details: who plays, who directed, how long and how it is rated. */
export interface FilmDetails extends FilmArt {
  originalTitle?: string
  tagline?: string
  /** Minutes. */
  runtime?: number
  votes?: number
  directors: string[]
  cast: { id: string; name: string; character?: string; photo?: string }[]
}
