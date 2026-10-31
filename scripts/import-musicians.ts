import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MUSICIAN_SELECTION } from '../shared/musician-selection.ts'
import { foldMusician } from '../hub/musicians.ts'
import { loadConfig } from '../hub/config.ts'
import type { Discography, MusicianLibrary } from '../shared/musicians.ts'
const { dataDir } = loadConfig()
const cacheDir = join(dataDir, 'musicians-import')
await mkdir(cacheDir, { recursive: true })
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
let last = 0
async function get(path: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await pause(Math.max(0, 180 - (Date.now() - last))); last = Date.now()
    try {
      const r = await fetch(`https://api.deezer.com${path}`, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as any
      if (data.error) throw new Error(data.error.message)
      return data
    } catch (e) { if (attempt === 3) throw e; await pause(1500 * (attempt + 1)) }
  }
}
const image = (url: unknown): string | undefined => typeof url === 'string' && /^https:\/\/(?:cdn-images|cdns-images)\.dzcdn\.net\//.test(url) ? url : undefined
const entries: Discography[] = []
const failures: string[] = []
for (const name of MUSICIAN_SELECTION) {
  const file = join(cacheDir, `${foldMusician(name)}.json`)
  try {
    let entry: Discography | undefined
    try { entry = JSON.parse(await readFile(file, 'utf8')) as Discography } catch {}
    if (!entry) {
      const search = await get(`/search/artist?q=${encodeURIComponent(name)}&limit=100`)
      const candidates = search.data.filter((a: any) => foldMusician(a.name) === foldMusician(name)).sort((a: any,b: any) => b.nb_fan - a.nb_fan)
      const artist = candidates[0]
      if (!artist) throw new Error('Nenalezena přesná shoda jména')
      if (candidates[1]?.nb_fan > artist.nb_fan * 0.5) throw new Error('Nejednoznačné jméno')
      const releases = new Map<string, any>()
      for (let offset = 0; ; offset += 100) {
        const page = await get(`/artist/${artist.id}/albums?limit=100&index=${offset}`)
        for (const a of page.data) if (a.id && a.title) releases.set(String(a.id), { id: String(a.id), title: a.title, date: a.release_date,
          year: Number(a.release_date?.slice(0,4)) || undefined, cover: image(a.cover_big), type: a.record_type || 'album', link: `https://www.deezer.com/album/${a.id}` })
        if (!page.next || !page.data.length) break
        if (offset >= 4900) throw new Error('Diskografie přesahuje bezpečný limit importu')
      }
      const top = await get(`/artist/${artist.id}/top?limit=10`)
      entry = { musician: { id: String(artist.id), name, photo: image(artist.picture_big), fans: artist.nb_fan || 0, link: `https://www.deezer.com/artist/${artist.id}` },
        releases: [...releases.values()].sort((a,b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title)),
        tracks: top.data.map((t: any) => ({ id: String(t.id), title: t.title, album: t.album?.title || '', cover: image(t.album?.cover_big), duration: t.duration || 0, link: `https://www.deezer.com/track/${t.id}` })) }
      if (!entry.musician.photo || !entry.releases.length) throw new Error('Chybí portrét nebo diskografie')
      await writeFile(file, JSON.stringify(entry))
    }
    entries.push(entry)
    if (entries.length % 10 === 0) console.log(`Import ${entries.length}/300`)
  } catch (e) { failures.push(`${name}: ${(e as Error).message}`); console.log(failures.at(-1)) }
}
if (failures.length) throw new Error(`Neúplný import: ${failures.join('; ')}`)
if (entries.length !== 300 || new Set(entries.map(e => e.musician.id)).size !== 300) throw new Error('Výběr musí obsahovat 300 různých interpretů.')
const library: MusicianLibrary = { version: 1, title: '300 známých muzikantů', updatedAt: new Date().toISOString(), entries }
const file = join(dataDir, 'musicians-library.json')
await writeFile(`${file}.tmp`, JSON.stringify(library)); await rename(`${file}.tmp`, file)
console.log(JSON.stringify({ artists: entries.length, portraits: entries.filter(e => e.musician.photo).length, releases: entries.reduce((n,e)=>n+e.releases.length,0), tracks: entries.reduce((n,e)=>n+e.tracks.length,0), file }))
