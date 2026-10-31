import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaResult } from '../shared/media.ts'

/** A film the owner added (and holds the rights to share): where to get it and what is in it. */
export interface CatalogEntry {
  id: string
  title: string
  year?: number
  description?: string
  poster?: string
  /** A magnet link or an https URL of a .torrent file. */
  source: string
  languages: string[]
  subtitles: string[]
  addedAt: number
}

const MAGNET = /^magnet:\?xt=urn:btih:([0-9a-f]{40}|[a-z2-7]{32})/i
const TORRENT_URL = /^https:\/\/\S+\.torrent(\?\S*)?$/i

export function validSource(source: string): boolean {
  return MAGNET.test(source) || TORRENT_URL.test(source)
}

/** The display name a magnet link carries (dn=…), cleaned of dots and release tags. */
export function magnetTitle(source: string): string | undefined {
  const dn = /[?&]dn=([^&]+)/.exec(source)?.[1]
  if (!dn) return undefined
  return decodeURIComponent(dn.replace(/\+/g, ' '))
    .replace(/\.(mkv|mp4|avi)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b.*$/, '')
    .trim() || undefined
}

/** The owner's films in data/catalog.json. */
export class Catalog {
  private entries: CatalogEntry[] = []
  private readonly file: string

  constructor(dataDir: string) {
    this.file = join(dataDir, 'catalog.json')
    try {
      const list = JSON.parse(readFileSync(this.file, 'utf8')) as CatalogEntry[]
      this.entries = Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string' && validSource(e.source)) : []
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.entries, null, 2))
    renameSync(tmp, this.file)
  }

  list(): CatalogEntry[] {
    return [...this.entries].sort((a, b) => b.addedAt - a.addedAt)
  }

  get(id: string): CatalogEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  add(input: { source: string; title?: string; year?: number; description?: string }): CatalogEntry {
    if (!validSource(input.source)) throw new Error('Zadejte magnet odkaz nebo https adresu .torrent souboru')
    const existing = this.entries.find((e) => e.source === input.source)
    if (existing) return existing
    const entry: CatalogEntry = {
      id: randomBytes(6).toString('hex'),
      title: input.title?.trim() || magnetTitle(input.source) || 'Bez názvu',
      year: input.year,
      description: input.description,
      source: input.source,
      languages: [],
      subtitles: [],
      addedAt: Date.now(),
    }
    this.entries.push(entry)
    this.save()
    return entry
  }

  update(id: string, patch: Partial<Pick<CatalogEntry, 'languages' | 'subtitles' | 'title'>>): void {
    const e = this.get(id)
    if (!e) return
    Object.assign(e, patch)
    this.save()
  }

  remove(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length !== before) this.save()
    return this.entries.length !== before
  }

  results(): MediaResult[] {
    return this.list().map((e) => ({
      id: e.id,
      source: 'catalog',
      title: e.title,
      year: e.year,
      description: e.description,
      poster: e.poster,
      languages: e.languages,
      subtitles: e.subtitles,
    }))
  }
}
