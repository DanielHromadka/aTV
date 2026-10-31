import type { SearchJob } from './search.ts'
import { detectLanguages, type MediaResult } from '../shared/media.ts'

const HASH = /^[a-f0-9]{40}$/i
const TRACKERS = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce']

/** Hash-based keys remain playable after a hub restart without persisting search results. */
export function publicMagnet(key: string): string | undefined {
  if (!key.startsWith('bt:') || !HASH.test(key.slice(3))) return undefined
  return `magnet:?xt=urn:btih:${key.slice(3).toLowerCase()}${TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

export function indexResults(data: unknown, provider: 'apibay' | 'csv'): MediaResult[] {
  const rows = provider === 'csv' ? (data as { torrents?: unknown } | null)?.torrents : data
  if (!Array.isArray(rows)) throw new Error('Index vrátil neplatná data')
  return rows.flatMap((row: unknown): MediaResult[] => {
    if (!row || typeof row !== 'object') return []
    const r = row as Record<string, unknown>
    const hash = r[provider === 'csv' ? 'infohash' : 'info_hash']
    if (typeof hash !== 'string' || !HASH.test(hash) || /^0+$/.test(hash)) return []
    if (typeof r.name !== 'string' || !r.name.trim()) return []
    if (provider === 'apibay' && !/^2\d\d$/.test(String(r.category))) return []
    if (/\.(iso|exe|apk|pdf|epub|mp3|flac)(?:\s|$)/i.test(r.name)) return []
    const seeders = count(r.seeders)
    return [{
      id: `bt:${hash.toLowerCase()}`, source: 'public', title: r.name.slice(0, 500),
      indexName: provider === 'csv' ? 'Torrents CSV' : 'API Bay',
      size: count(r[provider === 'csv' ? 'size_bytes' : 'size']), seeders,
      languages: detectLanguages(r.name), subtitles: [], popularity: seeders,
    }]
  })
}

export function mergeIndexResults(groups: MediaResult[][]): MediaResult[] {
  const unique = new Map<string, MediaResult>()
  for (const r of groups.flat()) {
    const previous = unique.get(r.id)
    if (!previous || (r.seeders ?? 0) > (previous.seeders ?? 0)) unique.set(r.id, r)
  }
  return [...unique.values()]
}

const cache = new Map<string, { expires: number; results: Promise<MediaResult[]> }>()

export function searchPublicIndexes(query: string): Promise<MediaResult[]> {
  const q = query.trim().slice(0, 200)
  if (q.length < 2) return Promise.resolve([])
  const key = q.toLowerCase()
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.results
  const results = Promise.all(publicIndexJobs(q).map((job) => job.run().catch(() => {
    console.warn(`[${job.id}] Index není dostupný`)
    return [] as MediaResult[]
  }))).then(mergeIndexResults)
  for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k)
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  cache.set(key, { expires: Date.now() + 60_000, results })
  return results
}

export function publicIndexJobs(query: string): SearchJob[] {
  const q = query.trim().slice(0, 200)
  return (['apibay', 'csv'] as const).map((provider) => ({
    id: provider,
    name: provider === 'apibay' ? 'API Bay' : 'Torrents CSV',
    run: async () => {
      if (q.length < (provider === 'csv' ? 3 : 2)) return []
      const url = provider === 'apibay'
        ? `https://apibay.org/q.php?q=${encodeURIComponent(q)}&cat=200`
        : `https://torrents-csv.com/service/search?q=${encodeURIComponent(q)}&size=50`
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return indexResults(await response.json(), provider)
    },
  }))
}
