import { describe, expect, it, vi } from 'vitest'
import { Actors, movieCredits } from './actors.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ACTOR_SELECTION } from '../shared/actor-selection.ts'

describe('actor filmographies', () => {
  it('has exactly 100 distinct editorial choices', () => {
    expect(ACTOR_SELECTION).toHaveLength(100)
    expect(new Set(ACTOR_SELECTION).size).toBe(100)
  })
  it.each([100,400])('serves all %i imported profiles after restart without external requests', async (count) => {
    const dir = mkdtempSync(join(tmpdir(), 'atv-actors-'))
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    try {
      const entries = Array.from({ length: count }, (_, i) => ({ actor: { id: String(i + 1), name: `Actor ${i}`, source: 'tmdb' }, movies: [{ id: String(i), title: 'Film' }] }))
      writeFileSync(join(dir, 'actors-library.json'), JSON.stringify({ version: 1, title: `${count} známých herců`, fromYear: 1996, toYear: 2026, entries }))
      const service = new Actors('secret', fetcher as typeof fetch, dir)
      const pages = await Promise.all(Array.from({length:count/20},(_,i)=>i+1).map((p) => service.list('', p)))
      expect(new Set(pages.flatMap((p) => p.actors.map((a) => a.id))).size).toBe(count)
      expect(pages.at(-1)?.more).toBe(false)
      expect(pages[0].collection?.total).toBe(count)
      expect((await service.filmography('100')).movies[0].title).toBe('Film')
      expect(fetcher).not.toHaveBeenCalled()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('deduplicates film roles, sorts years and omits unsafe image paths and adult entries', () => {
    const movies = movieCredits([
      { id: 1, title: 'Starší film', release_date: '2000-01-01', character: 'A', poster_path: '/cover.jpg' },
      { id: 2, title: 'Novější film', original_title: 'Original title', release_date: '2020-01-01', poster_path: '//other.example/image' },
      { id: 1, title: 'Starší film', character: 'B' },
      { id: 3, title: 'Nevhodný', adult: true },
      { id: 4, title: 'Bez data' },
    ])
    expect(movies.map((m) => m.id)).toEqual(['2', '1', '4'])
    expect(movies[0]).toMatchObject({ originalTitle: 'Original title', year: 2020, poster: undefined })
    expect(movies[1]).toMatchObject({ role: 'A / B', poster: 'https://image.tmdb.org/t/p/w500/cover.jpg' })
  })
  it('searches actors in Czech, excludes crew, and reuses successful requests', async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [
      { id: 1, name: 'Herec', known_for_department: 'Acting', known_for: [{ title: 'Film' }] },
      { id: 2, name: 'Režisér', known_for_department: 'Directing' },
    ], total_pages: 2 }))
    const service = new Actors('test-key', fetcher as typeof fetch)
    const result = await service.list('Herec', 1)
    expect(result.actors.map((a) => a.name)).toEqual(['Herec'])
    expect(result.more).toBe(true)
    const [url] = fetcher.mock.calls[0] as unknown as [URL]
    expect(url.searchParams.get('language')).toBe('cs-CZ')
    expect(url.searchParams.get('query')).toBe('Herec')
    await service.list('Herec', 1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('test-key')
  })
  it('uses acting credits, never the crew filmography', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => Response.json(String(url).includes('movie_credits')
      ? { cast: [{ id: 10, title: 'Hraná role' }], crew: [{ id: 20, title: 'Režie' }] }
      : { id: 1, name: 'Herec', biography: 'Životopis' }))
    const result = await new Actors('test-key', fetcher as typeof fetch).filmography('1')
    expect(result.movies.map((m) => m.title)).toEqual(['Hraná role'])
    expect(result.biography).toBe('Životopis')
  })
  it('rejects invalid IDs before making requests and never exposes credentials in failures', async () => {
    const fetcher = vi.fn(async () => { throw new Error('https://api.example/?api_key=secret') })
    const service = new Actors('secret', fetcher as typeof fetch)
    await expect(service.filmography('../configuration')).rejects.toThrow('Neplatný')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.list('name', 1)).rejects.toThrow('Filmová databáze neodpovídá')
  })
  it('handles rejected credentials with an actionable message', async () => {
    const service = new Actors('a.b.c', (async () => new Response('', { status: 401 })) as typeof fetch)
    await expect(service.list('', 1)).rejects.toThrow('Zkontrolujte API klíč')
  })
  it('finds film artwork, retries without the year and prefers the known film', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (u: URL) => {
      calls.push(`${u.pathname}?${u.searchParams.get('year') ?? ''}`)
      if (u.pathname.endsWith('/genre/movie/list')) return Response.json({ genres: [{ id: 28, name: 'Akční' }] })
      if (u.searchParams.get('year')) return Response.json({ results: [] })
      return Response.json({ results: [
        { id: 1, title: 'Matrix fanfilm', vote_count: 2, vote_average: 9 },
        { id: 603, title: 'Matrix', release_date: '1999-03-30', overview: 'Neo…', poster_path: '/p.jpg', backdrop_path: '/b.jpg', vote_average: 8.2, vote_count: 26000, genre_ids: [28] },
      ] })
    })
    const service = new Actors('secret', fetcher as unknown as typeof fetch)
    const art = await service.film('Matrix', 1998)
    expect(art).toEqual({ id: '603', title: 'Matrix', year: 1999, overview: 'Neo…', poster: 'https://image.tmdb.org/t/p/w500/p.jpg',
      backdrop: 'https://image.tmdb.org/t/p/w1280/b.jpg', rating: 8.2, genres: ['Akční'] })
    expect(calls.slice(0, 2)).toEqual(['/3/search/movie?1998', '/3/search/movie?'])
    expect(await service.film('Matrix', 1955)).toBeNull()
  })
  it('reads film details with the director and the main cast, with an English overview as fallback', async () => {
    const fetcher = vi.fn(async (u: URL) => {
      if (u.searchParams.get('language') === 'en-US') return Response.json({ id: 603, title: 'The Matrix', overview: 'Neo learns…' })
      return Response.json({ id: 603, title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-30', overview: '', runtime: 136,
        vote_average: 8.2, vote_count: 26000, genres: [{ name: 'Akční' }],
        credits: { cast: [{ id: 6384, name: 'Keanu Reeves', character: 'Neo', profile_path: '/k.jpg' }, { id: 9, name: 'X', adult: true }],
          crew: [{ name: 'Lana Wachowski', job: 'Director' }, { name: 'Joel Silver', job: 'Producer' }] } })
    })
    const d = await new Actors('secret', fetcher as unknown as typeof fetch).filmDetails('603')
    expect(d).toMatchObject({ title: 'Matrix', originalTitle: 'The Matrix', overview: 'Neo learns…', runtime: 136, votes: 26000, directors: ['Lana Wachowski'],
      cast: [{ id: '6384', name: 'Keanu Reeves', character: 'Neo', photo: 'https://image.tmdb.org/t/p/w185/k.jpg' }] })
    await expect(new Actors('secret', fetcher as unknown as typeof fetch).filmDetails('x')).rejects.toThrow('Neplatný')
  })
})
