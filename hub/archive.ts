import { detectLanguages, type MediaResult } from '../shared/media.ts'

/**
 * Internet Archive: public-domain and openly licensed films. Every item has a torrent with
 * archive.org as web seed, so it streams even with no other peers.
 */
const BASE = 'https://archive.org'
export const ARCHIVE_ID = /^[A-Za-z0-9._-]{1,100}$/

interface Doc {
  identifier: string
  title?: string | string[]
  year?: string | number
  downloads?: number
  avg_rating?: number
  language?: string | string[]
  description?: string | string[]
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function toResult(d: Doc): MediaResult {
  const lang = Array.isArray(d.language) ? d.language.join(' ') : d.language ?? ''
  const description = first(d.description)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return {
    id: `ia:${d.identifier}`,
    source: 'archive',
    title: first(d.title) ?? d.identifier,
    year: Number(d.year) || undefined,
    description: description?.slice(0, 600),
    poster: `${BASE}/services/img/${encodeURIComponent(d.identifier)}`,
    languages: detectLanguages(lang),
    subtitles: [],
    popularity: d.downloads,
    rating: d.avg_rating,
  }
}

async function query(q: string, rows: number, sort?: string): Promise<MediaResult[]> {
  const params = new URLSearchParams({ q, rows: String(rows), output: 'json' })
  for (const f of ['identifier', 'title', 'year', 'downloads', 'avg_rating', 'language', 'description']) params.append('fl[]', f)
  if (sort) params.append('sort[]', sort)
  const res = await fetch(`${BASE}/advancedsearch.php?${params}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Internet Archive: HTTP ${res.status}`)
  const body = (await res.json()) as { response?: { docs?: Doc[] } }
  return (body.response?.docs ?? []).filter((d) => ARCHIVE_ID.test(d.identifier)).map(toResult)
}

/** Films whose title (weighted) or description match; the hub ranks them with the rest. */
export function searchArchive(text: string): Promise<MediaResult[]> {
  const words = text.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim()
  if (!words) return Promise.resolve([])
  return query(`(title:(${words})^4 OR (${words})) AND mediatype:(movies) AND collection:(feature_films OR short_films OR animationandcartoons OR classic_tv OR silent_films)`, 40)
}

/** The most downloaded feature films, for browsing. */
export function popularArchive(): Promise<MediaResult[]> {
  return query('mediatype:(movies) AND collection:(feature_films)', 30, 'downloads desc')
}

export function archiveTorrentUrl(identifier: string): string {
  return `${BASE}/download/${identifier}/${identifier}_archive.torrent`
}
