import { mkdir, rename, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Actors } from '../hub/actors.ts'
import { loadConfig } from '../hub/config.ts'
import { ACTOR_SELECTION } from '../shared/actor-selection.ts'
import type { ActorLibrary, Filmography } from '../shared/actors.ts'

const config = loadConfig()
if (!config.tmdbApiKey) throw new Error('Nastavte tmdbApiKey v data/config.json nebo TMDB_API_KEY.')
try { const old = JSON.parse(await readFile(join(config.dataDir, 'actors-library.json'), 'utf8')); if (old.entries?.length > 100) throw new Error('Rozšířenou knihovnu aktualizujte pomocí npm run expand:actors; základní import by ji zmenšil.') } catch (e) { if ((e as Error).message.includes('Rozšířenou')) throw e }
const service = new Actors(config.tmdbApiKey)
const toYear = new Date().getFullYear()
const fromYear = toYear - 30
const entries: Filmography[] = new Array(ACTOR_SELECTION.length)
const failures: string[] = []
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
let cursor = 0
let complete = 0

async function worker() {
  while (cursor < ACTOR_SELECTION.length) {
    const index = cursor++
    const name = ACTOR_SELECTION[index]
    try {
      const { actors } = await service.list(name, 1, 'en-US')
      let match = actors.find((a) => fold(a.name) === fold(name)) || (actors.length === 1 ? actors[0] : undefined)
      if (!match) {
        const candidates = []
        for (const candidate of actors) {
          const detail = await service.filmography(candidate.id)
          if (detail.actor.aliases?.some((alias) => fold(alias) === fold(name))) candidates.push(candidate)
        }
        if (candidates.length === 1) match = candidates[0]
      }
      if (!match) throw new Error(`Nejednoznačné jméno: ${actors.map((a) => a.name).join(', ') || 'žádné výsledky'}`)
      const films = await service.filmography(match.id)
      if (!films.movies.some((m) => m.year && m.year >= fromYear && m.year <= toYear)) throw new Error('Nenalezena filmová role v požadovaném období')
      films.actor.knownFor = match.knownFor
      // Use the verified selection's familiar spelling; credits remain localized to Czech.
      films.actor.name = name
      entries[index] = films
      complete++
      if (complete % 10 === 0) console.log(`Načteno ${complete}/${ACTOR_SELECTION.length} herců a filmografií`)
    } catch (e) { failures.push(`${name}: ${(e as Error).message}`) }
  }
}
await Promise.all([worker(), worker(), worker()])
if (failures.length) {
  console.error(failures.join('\n'))
  throw new Error('Import není kompletní; původní výběr zůstal zachovaný.')
}
if (entries.length !== 100 || new Set(entries.map((e) => e.actor.id)).size !== 100) throw new Error('Výběr musí obsahovat přesně 100 různých herců.')
const library: ActorLibrary = { version: 1, title: '100 známých herců', fromYear, toYear, updatedAt: new Date().toISOString(), entries }
await mkdir(config.dataDir, { recursive: true })
const file = join(config.dataDir, 'actors-library.json')
await writeFile(`${file}.tmp`, JSON.stringify(library), { mode: 0o600 })
await rename(`${file}.tmp`, file)
const movies = new Map(entries.flatMap((e) => e.movies.map((m) => [m.id, m] as const)))
console.log(JSON.stringify({ actors: entries.length, films: movies.size, covers: [...movies.values()].filter((m) => m.poster).length,
  portraits: entries.filter((e) => e.actor.photo).length, fromYear, toYear, file }))
