import { describe, expect, it } from 'vitest'
import { CtError, Ivysilani } from './ivysilani.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('Ivysilani', () => {
  it('maps search results and strips IDEC separators', async () => {
    const ct = new Ivysilani((async () => json({
      data: {
        searchShows: { items: [{ id: '1', sidp: '10095426857', title: 'Interview ČT24', imageUrl: 'https://img/1.jpg', playable: true }] },
        searchEpisodes: { items: [{ idec: '226 411 05804/1031', title: '31. října', showTitle: 'Interview ČT24', duration: 1676, playable: true }] },
      },
    })) as typeof fetch)
    const r = await ct.search('interview')
    expect(r.shows).toEqual([{ id: '10095426857', title: 'Interview ČT24', description: undefined, image: 'https://img/1.jpg', playable: true }])
    expect(r.episodes[0]).toMatchObject({ id: '226411058041031', title: '31. října', duration: 1676 })
  })

  it('skips the API for too short queries', async () => {
    const ct = new Ivysilani((async () => {
      throw new Error('should not fetch')
    }) as typeof fetch)
    expect(await ct.search(' a ')).toEqual({ shows: [], episodes: [] })
  })

  it('describes a playable episode with hub URLs and subtitles', async () => {
    const ct = new Ivysilani((async () => json({
      showTitle: 'Show', episodeTitle: 'Show | Díl 1', duration: 100,
      streams: [{ url: 'https://cdn/x', duration: 99, subtitles: [{ files: [{ format: 'vtt', url: 'https://ctfs.ceskatelevize.cz/s.vtt' }] }] }],
    })) as typeof fetch)
    const p = await ct.play('vod', '123456789', 'http://hub:8090')
    expect(p).toMatchObject({ title: 'Show · Díl 1', url: 'http://hub:8090/api/ct/stream/vod/123456789.m3u8', live: false, duration: 99 })
    expect(p.subtitle?.src).toBe('http://hub:8090/api/ct/subtitles/123456789.vtt')
  })

  it('reports DRM-only or missing programmes as unavailable', async () => {
    const ct = new Ivysilani((async () => json({ message: { labels: { textLong: 'Video není k dispozici' } } }, 404)) as typeof fetch)
    await expect(ct.play('vod', '123456789', 'http://hub')).rejects.toThrow(CtError)
    await expect(ct.play('vod', '123456789', 'http://hub')).rejects.toThrow('Video není k dispozici')
  })

  it('rejects invalid show ids before calling the API', async () => {
    const ct = new Ivysilani((async () => json({})) as typeof fetch)
    await expect(ct.episodes('../x')).rejects.toThrow('Neplatný pořad')
  })
})
