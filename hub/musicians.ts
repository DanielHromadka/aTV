import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Discography, MusicianLibrary, MusicianPage } from '../shared/musicians.ts'
export const foldMusician = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export class Musicians {
  private library?: MusicianLibrary
  constructor(dataDir: string) {
    try {
      const data = JSON.parse(readFileSync(join(dataDir, 'musicians-library.json'), 'utf8')) as MusicianLibrary
      if (data.version === 1 && data.entries.length === 300 && new Set(data.entries.map(e => e.musician.id)).size === 300 && data.entries.every(e => /^\d+$/.test(e.musician.id) && Array.isArray(e.releases) && Array.isArray(e.tracks))) this.library = data
    } catch { /* The API reports a missing import; never invent profiles. */ }
  }
  list(query: string, page: number): MusicianPage {
    if (!this.library) throw new Error('Knihovna muzikantů ještě není importovaná.')
    const q = foldMusician(query.slice(0,120))
    const entries = this.library.entries.filter(e => !q || foldMusician(e.musician.name).includes(q))
    const current = Math.max(1, Math.min(Math.ceil(entries.length / 24) || 1, Math.floor(page) || 1))
    return { musicians: entries.slice((current - 1) * 24, current * 24).map(e => e.musician), page: current, more: current * 24 < entries.length, total: entries.length, updatedAt: this.library.updatedAt }
  }
  detail(id: string): Discography | undefined { return this.library?.entries.find(e => e.musician.id === id) }
}
