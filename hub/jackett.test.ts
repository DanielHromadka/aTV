import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Jackett, parseIndexers } from './jackett.ts'
import { loadConfig, publicConfig } from './config.ts'
import { Media } from './media.ts'
import { Catalog } from './catalog.ts'
import type { Torrents } from './torrents.ts'

const dirs: string[] = []
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'atv-jackett-')); dirs.push(d); return d }
const config = { url: 'http://jackett:9117', apiKey: 'secret-key', indexer: 'sktorrent' }
const row = { Title: 'Test film CZ', Guid: 'https://sktorrent.eu/details/123', Link: 'http://jackett:9117/dl/sktorrent/?apikey=secret-key&path=token', Tracker: 'Sk-CzTorrent', Category: [2000], Languages: ['cs'], Subs: ['en'], Size: 1234, Seeders: 12 }
const indexerXml = (ids = ['sktorrent']) => `<indexers>${ids.map((id) => `<indexer id="${id}" configured="true"><title>${id}</title><caps><categories><category id="2000"/></categories></caps></indexer>`).join('')}</indexers>`
const discovery = (ids?: string[]) => ({ ok: true, text: async () => indexerXml(ids) })
const response = (rows: unknown[]) => ({ ...discovery(), json: async () => ({ Results: rows }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('Jackett integration', () => {
  it('queries only the selected audio index and excludes non-audio results', async () => {
    const queried: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.searchParams.get('t') === 'indexers') return { ok: true, text: async () => indexerXml(['audiobookbay', 'other']).replaceAll('id="2000"', 'id="3000"') }
      queried.push(url)
      return response([{ ...row, Category: [3030] }, { ...row, Guid: 'movie', Category: [2000] }, { ...row, Guid: 'other', Category: [6000] }])
    }))
    const jobs = await new Jackett(config, dir()).jobs('Alice', 'audio', 'audiobookbay')[0].load()
    expect(jobs).toHaveLength(1)
    expect(await jobs[0].run()).toHaveLength(1)
    expect(queried[0].pathname).toContain('/audiobookbay/results')
    expect(queried[0].searchParams.get('Category[]')).toBe('3000')
  })
  it('reads configured sources and their categories without trusting IDs or XML entities', async () => {
    const xml = `<indexers>
      <indexer id="new-movies" configured="true"><title>Movies &amp; TV</title><caps><categories><category id="2000"/><category id="5000"/></categories></caps></indexer>
      <indexer id="books" configured="true"><title>Books</title><caps><categories><category id="7000"/></categories></caps></indexer>
      <indexer id="disabled" configured="false"><title>Not configured</title></indexer>
      <indexer id="../escape" configured="true"><title>Invalid</title></indexer>
    </indexers>`
    expect(await parseIndexers(xml)).toEqual([
      { id: 'new-movies', name: 'Movies & TV', categories: [2000, 5000], searchable: true },
      { id: 'books', name: 'Books', categories: [7000], searchable: false },
    ])
    expect(await parseIndexers('<indexers/>')).toEqual([])
    await expect(parseIndexers('<html>login</html>')).rejects.toThrow()
    await expect(parseIndexers('<!DOCTYPE x><indexers/>')).rejects.toThrow()
  })
  it('picks up source additions and removals without restart or reusing results from old sources', async () => {
    vi.useFakeTimers()
    let ids = ['first']
    const searched: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.searchParams.get('t') === 'indexers') return discovery(ids)
      searched.push(url.pathname)
      return response([row])
    }))
    const j = new Jackett(config, dir())
    await j.search('Film')
    ids = ['replacement', 'added']
    await vi.advanceTimersByTimeAsync(30_001)
    await j.search('Film')
    expect(searched).toEqual(['/api/v2.0/indexers/first/results', '/api/v2.0/indexers/replacement/results', '/api/v2.0/indexers/added/results'])
  })
  it('reports discovery failures safely instead of using a hardcoded source list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('apikey=secret-key') }))
    const j = new Jackett(config, dir())
    await expect(j.jobs('Film')[0].load()).rejects.toThrow('Seznam zdrojů z Jackettu není dostupný')
  })
  it('searches SkTorrent for movies and TV, keeps credentials private and caches searches', async () => {
    const fetcher = vi.fn(async () => response([row]))
    vi.stubGlobal('fetch', fetcher)
    const j = new Jackett(config, dir())
    const results = await j.search('Test film')
    expect(results[0]).toMatchObject({ source: 'public', title: row.Title, languages: ['cs'], subtitles: ['en'], seeders: 12 })
    expect(JSON.stringify(results)).not.toContain('secret-key')
    expect(j.source(results[0].id)).toBe(row.Link)
    const url = new URL(String(fetcher.mock.calls[1]?.[0]))
    expect(url.pathname).toBe('/api/v2.0/indexers/sktorrent/results')
    expect(url.searchParams.get('Category[]')).toBe('2000,5000')
    expect(url.searchParams.get('query')).toBe('Test film')
    expect(await j.search('Test film')).toEqual(results)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('retains authenticated torrent sources after restart and passes them intact to playback', async () => {
    const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&tr=https%3A%2F%2Ftracker.example%2Fprivate`
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.pathname.startsWith('/dl/')
      ? new Response(null, { status: 302, headers: { location: magnet } }) : response([row])))
    const dataDir = dir()
    const [r] = await new Jackett(config, dataDir).search('Test')
    const restarted = new Jackett(config, dataDir)
    expect(restarted.source(r.id)).toBe(row.Link)
    const open = vi.fn(async () => { throw new Error('stop before network') })
    const media = new Media(new Catalog(dataDir), { open, get: () => undefined } as unknown as Torrents, 8090, restarted)
    await expect(media.details(r.id)).rejects.toThrow('stop before network')
    expect(open).toHaveBeenCalledWith(r.id, magnet)
    expect(new Jackett(config, dataDir).source(r.id)).toBe(magnet)
  })
  it('downloads torrent bytes and follows relative redirects', async () => {
    const bytes = Buffer.from('d4:infod4:name4:teste e'.replace(' ', ''))
    const fetcher = vi.fn(async (url: URL) => {
      if (url.pathname === '/download') return new Response(bytes)
      if (url.pathname.startsWith('/dl/')) return new Response(null, { status: 307, headers: { location: '/download' } })
      return response([row])
    })
    vi.stubGlobal('fetch', fetcher)
    const j = new Jackett(config, dir())
    const [r] = await j.search('Test')
    const first = j.resolveSource(r.id)
    expect(j.resolveSource(r.id)).toBe(first)
    expect(await first).toEqual(bytes)
  })
  it('rejects HTML and redacts download errors while allowing retry', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (!url.pathname.startsWith('/dl/')) return response([row])
      if (fail) throw new Error('apikey=secret-key')
      return new Response('<html>Login</html>')
    }))
    const j = new Jackett(config, dir())
    const [r] = await j.search('Test')
    await expect(j.resolveSource(r.id)).rejects.toThrow('Odkaz na torrent se nepodařilo načíst')
    fail = false
    await expect(j.resolveSource(r.id)).rejects.toThrow('Zdroj místo torrentu vrátil jiný obsah')
  })
  it('searches multiple indexers independently when one is unavailable', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.searchParams.get('t') === 'indexers') return discovery(['yts', '1337x'])
      if (url.pathname.includes('/1337x/')) throw new Error('offline')
      return response([{ ...row, Tracker: 'YTS', InfoHash: 'a'.repeat(40) }])
    })
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const j = new Jackett(config, dir())
    const results = await j.search('Test')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(results).toHaveLength(1)
    expect(results[0].infoHash).toBe('a'.repeat(40))
    expect(results[0].indexName).toBe('YTS')
  })
  it('proxies posters without exposing the Jackett URL or API key', async () => {
    const poster = 'http://jackett:9117/img/yts/?apikey=secret-key&path=image'
    const fetcher = vi.fn(async (url: URL | string) => {
      if (String(url).includes('/img/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })
      return response([{ ...row, Poster: poster }])
    })
    vi.stubGlobal('fetch', fetcher)
    const j = new Jackett(config, dir())
    const [r] = await j.search('Film')
    expect(r.poster).toBe(`/api/media/${encodeURIComponent(r.id)}/poster`)
    expect(JSON.stringify(r)).not.toContain('secret-key')
    expect(await j.image(r.id)).toEqual({ type: 'image/jpeg', body: Buffer.from([1, 2, 3]) })
  })
  it('rejects untrusted links, non-video results and malformed rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([null, { ...row, Link: 'http://attacker/dl/foo' }, { ...row, Category: [6000] }, { ...row, Title: 123 }])))
    expect(await new Jackett(config, dir()).search('Test')).toEqual([])
  })
  it('preserves complete magnet links including private trackers', async () => {
    const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&tr=https%3A%2F%2Ftracker.example%2Fsecret`
    vi.stubGlobal('fetch', vi.fn(async () => response([{ ...row, Link: null, MagnetUri: magnet }])))
    const j = new Jackett(config, dir())
    const [r] = await j.search('Test')
    expect(j.source(r.id)).toBe(magnet)
  })
  it('isolates provider failures and redacts network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.searchParams.get('t') === 'indexers') return discovery()
      throw new Error('http://jackett/?apikey=secret-key')
    }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await new Jackett(config, dir()).search('Test')).toEqual([])
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret-key')
  })
  it('loads environment config without exposing the key in public configuration', () => {
    const loaded = loadConfig({ ATV_DATA: dir(), JACKETT_URL: config.url, JACKETT_API_KEY: config.apiKey })
    expect(loaded.jackett).toEqual({ url: config.url, apiKey: config.apiKey })
    expect(JSON.stringify(publicConfig(loaded))).not.toContain('secret-key')
    expect(loadConfig({ ATV_DATA: dir() }).jackett).toBeUndefined()
    const dataDir = dir()
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ jackett: config }))
    expect(loadConfig({ ATV_DATA: dataDir, JACKETT_URL: '', JACKETT_API_KEY: '', JACKETT_INDEXER: '' }).jackett?.apiKey).toBe(config.apiKey)
  })
})
