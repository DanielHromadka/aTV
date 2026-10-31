import { audioCategory } from '../shared/audio.ts'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStringPromise } from 'xml2js'
import type { SearchBatch } from './search.ts'
import { TorrentOpenError } from './torrents.ts'
import { detectLanguages, type MediaResult } from '../shared/media.ts'

export interface JackettConfig { url: string; apiKey: string }
export interface JackettIndexer { id: string; name: string; categories: number[]; searchable: boolean }
const videoCategory = (n: number) => (n >= 2000 && n < 3000) || (n >= 5000 && n < 6000)

export async function parseIndexers(xml: string): Promise<JackettIndexer[]> {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Neplatný seznam indexerů')
  const parsed = await parseStringPromise(xml, { explicitArray: true })
  if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, 'indexers')) throw new Error('Neplatný seznam indexerů')
  const rows = parsed.indexers?.indexer ?? []
  const indexers = new Map<string, JackettIndexer>()
  for (const row of rows) {
    const id = row.$?.id
    if (row.$?.configured !== 'true' || typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id) || id === 'all') continue
    const name = typeof row.title?.[0] === 'string' ? row.title[0].slice(0, 100) : id
    const categories: number[] = (row.caps?.[0]?.categories?.[0]?.category ?? [])
      .map((c: { $?: { id?: string } }) => Number(c.$?.id)).filter(Number.isFinite)
    indexers.set(id, { id, name, categories, searchable: categories.some(videoCategory) })
  }
  return [...indexers.values()]
}
interface SavedSource { source: string; title: string; poster?: string }

/** Keeps tracker download links (including credentials) exclusively on the hub. */
export class Jackett {
  private readonly sources = new Map<string, SavedSource>()
  private readonly cache = new Map<string, { expires: number; results: Promise<MediaResult[]> }>()
  private readonly file: string
  private readonly config: JackettConfig
  private readonly base: URL
  private discovery?: { expires: number; value: Promise<JackettIndexer[]> }
  private readonly resolving = new Map<string, Promise<string | Buffer>>()

  constructor(config: JackettConfig, dataDir: string) {
    this.config = config
    this.base = new URL(config.url.replace(/\/$/, '') + '/')
    if (!['http:', 'https:'].includes(this.base.protocol)) throw new Error('Neplatná adresa Jackettu')
    this.file = join(dataDir, 'jackett-sources.json')
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, SavedSource>
      for (const [key, entry] of Object.entries(saved).slice(-1000)) {
        if (/^jk:[a-f0-9]{64}$/.test(key) && typeof entry?.title === 'string' && this.safeSource(entry.source)) this.sources.set(key, { ...entry, poster: this.safeAsset(entry.poster, 'img') ? entry.poster : undefined })
      }
    } catch { /* First start has no saved search results. */ }
  }

  private safeSource(value: unknown): value is string {
    if (typeof value !== 'string') return false
    if (/^magnet:\?xt=urn:btih:([a-f0-9]{40}|[a-z2-7]{32})(?:&|$)/i.test(value)) return true
    return this.safeAsset(value, 'dl')
  }

  private safeAsset(value: unknown, kind: 'dl' | 'img'): value is string {
    if (typeof value !== 'string') return false
    try {
      const url = new URL(value)
      return url.origin === this.base.origin && url.pathname.startsWith(`${this.base.pathname}${kind}/`)
    } catch { return false }
  }

  async image(key: string): Promise<{ body: Buffer; type: string } | undefined> {
    const poster = this.sources.get(key)?.poster
    if (!poster) return undefined
    const response = await fetch(poster, { signal: AbortSignal.timeout(10_000) })
    const type = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type) || !response.body) throw new Error('Plakát není dostupný')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 5_000_000) throw new Error('Plakát je příliš velký')
      chunks.push(Buffer.from(chunk))
    }
    return { body: Buffer.concat(chunks), type }
  }

  source(key: string): string | undefined { return this.sources.get(key)?.source }
  title(key: string): string | undefined { return this.sources.get(key)?.title }

  /** Jackett's /dl links may serve a torrent file or redirect to a magnet URI. */
  resolveSource(key: string): Promise<string | Buffer> {
    const source = this.source(key)
    if (!source) return Promise.reject(new TorrentOpenError('Výsledek z Jackettu vypršel; vyhledejte film znovu.'))
    if (source.startsWith('magnet:')) return Promise.resolve(source)
    const pending = this.resolving.get(key)
    if (pending) return pending
    const task = this.downloadSource(source).then((resolved) => {
      // A resolved magnet includes its tracker parameters and survives a hub restart.
      if (typeof resolved === 'string') {
        const saved = this.sources.get(key)
        if (saved) { this.sources.set(key, { ...saved, source: resolved }); this.saveSources() }
      }
      return resolved
    }).finally(() => this.resolving.delete(key))
    this.resolving.set(key, task)
    return task
  }

  private async downloadSource(source: string): Promise<string | Buffer> {
    let url = new URL(source)
    const signal = AbortSignal.timeout(30_000)
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await fetch(url, { redirect: 'manual', signal })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          await response.body?.cancel()
          if (!location) throw new TorrentOpenError('Jackett vrátil přesměrování bez odkazu na torrent.')
          const next = new URL(location, url)
          if (next.protocol === 'magnet:') {
            if (!this.safeSource(next.href)) throw new TorrentOpenError('Jackett vrátil neplatný magnet odkaz.')
            return next.href
          }
          if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) throw new TorrentOpenError('Jackett vrátil nepodporované přesměrování.')
          url = next
          continue
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel()
          throw new TorrentOpenError(`Stažení torrentu přes Jackett selhalo (HTTP ${response.status}). Zkuste jinou verzi filmu.`)
        }
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 10_000_000) throw new TorrentOpenError('Soubor torrentu překračuje povolenou velikost.')
          chunks.push(Buffer.from(chunk))
        }
        const bytes = Buffer.concat(chunks)
        if (bytes[0] !== 100 || bytes[bytes.length - 1] !== 101) throw new TorrentOpenError('Zdroj místo torrentu vrátil jiný obsah. Zkuste jinou verzi filmu.')
        return bytes
      }
      throw new TorrentOpenError('Odkaz na torrent má příliš mnoho přesměrování.')
    } catch (e) {
      if (e instanceof TorrentOpenError) throw e
      throw new TorrentOpenError('Odkaz na torrent se nepodařilo načíst. Ověřte dostupnost zdroje nebo zkuste jinou verzi filmu.')
    }
  }

  private saveSources(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.sources)), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  configuredIndexers(): Promise<JackettIndexer[]> {
    if (this.discovery && this.discovery.expires > Date.now()) return this.discovery.value
    const value = (async () => {
      const url = new URL('api/v2.0/indexers/all/results/torznab/api', this.base)
      url.search = new URLSearchParams({ apikey: this.config.apiKey, t: 'indexers', configured: 'true' }).toString()
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw new Error('Jackett není dostupný')
        return await parseIndexers(await response.text())
      } catch { throw new Error('Seznam zdrojů z Jackettu není dostupný') }
    })()
    this.discovery = { expires: Date.now() + 30_000, value }
    value.catch(() => { if (this.discovery?.value === value) this.discovery = undefined })
    return value
  }

  jobs(query: string, kind: 'video' | 'audio' = 'video', selected?: string): SearchBatch[] {
    return [{ id: 'jackett', name: 'Jackett', load: async () => (await this.configuredIndexers())
      .filter((i) => (!selected || i.id === selected) && (kind === 'audio' ? i.categories.some(audioCategory) : i.searchable)).map(({ id, name }) => ({ id: `jackett:${id}`, name, run: () => this.request(query, id, kind) })) }]
  }

  async search(query: string): Promise<MediaResult[]> {
    const q = query.trim().slice(0, 200)
    if (q.length < 2) return Promise.resolve([])
    const indexers = (await this.configuredIndexers()).filter((i) => i.searchable)
    const key = q.toLowerCase() + ':' + indexers.map((i) => i.id).join(',')
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.results
    const results = Promise.all(indexers.map(({ id: indexer }) => this.request(q, indexer).catch(() => {
      // Fetch errors can contain the API key; never log their raw message.
      console.warn(`[jackett:${indexer}] Hledání selhalo; ověřte připojení a nastavení indexeru`)
      return [] as MediaResult[]
    }))).then((groups) => groups.flat())
    for (const [k, value] of this.cache) if (value.expires <= Date.now()) this.cache.delete(k)
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { expires: Date.now() + 60_000, results })
    return results
  }

  private async request(q: string, indexer: string, kind: 'video' | 'audio' = 'video'): Promise<MediaResult[]> {
    const url = new URL(`api/v2.0/indexers/${indexer}/results`, this.base)
    url.search = new URLSearchParams({ apikey: this.config.apiKey, query: q, 'Category[]': kind === 'audio' ? '3000' : '2000,5000' }).toString()
    const response = await fetch(url, { signal: AbortSignal.timeout(indexer === '1337x' ? 60_000 : 20_000) })
    if (!response.ok) throw new Error('Jackett není dostupný')
    const data = await response.json() as { Results?: unknown; Indexers?: { Status?: number }[] }
    if (!Array.isArray(data.Results)) throw new Error('Neplatná odpověď Jackettu')
    if (data.Indexers?.length && data.Indexers.every((i) => i.Status === 1)) throw new Error('Indexer není dostupný')
    const results: MediaResult[] = []
    for (const row of data.Results.slice(0, 100)) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      if (typeof r.Title !== 'string' || !r.Title.trim()) continue
      if (!Array.isArray(r.Category) || !r.Category.some((c: unknown) => typeof c === 'number' && (kind === 'audio' ? audioCategory(c) : videoCategory(c)))) continue
      const source = this.safeSource(r.Link) ? r.Link : this.safeSource(r.MagnetUri) ? r.MagnetUri : undefined
      if (!source) continue
      const id = `jk:${createHash('sha256').update(`${indexer}:${r.Guid || source}`).digest('hex')}`
      this.sources.delete(id)
      const poster = this.safeAsset(r.Poster, 'img') ? r.Poster : undefined
      this.sources.set(id, { source, title: r.Title.slice(0, 500), poster })
      const langs = (value: unknown) => Array.isArray(value) ? detectLanguages(value.filter((l) => typeof l === 'string').join(' ')) : []
      const hash = typeof r.InfoHash === 'string' && /^[a-f0-9]{40}$/i.test(r.InfoHash) ? r.InfoHash.toLowerCase() : /[?&]xt=urn:btih:([a-f0-9]{40})(?:&|$)/i.exec(source)?.[1]?.toLowerCase()
      const seeders = Math.max(0, Number(r.Seeders) || 0)
      results.push({
        id, infoHash: hash, source: 'public', poster: poster ? `/api/media/${encodeURIComponent(id)}/poster` : undefined, title: r.Title.slice(0, 500), indexName: typeof r.Tracker === 'string' ? r.Tracker : indexer,
        languages: [...new Set([...detectLanguages(r.Title), ...langs(r.Languages)])], subtitles: langs(r.Subs),
        size: Math.max(0, Number(r.Size) || 0), seeders, popularity: seeders,
      })
    }
    while (this.sources.size > 1000) this.sources.delete(this.sources.keys().next().value!)
    this.saveSources()
    return results
  }
}
