import { describe, expect, it, vi, afterEach } from 'vitest'
import { indexResults, mergeIndexResults, publicMagnet, searchPublicIndexes } from './public-indexes.ts'

const hash = 'abcdef0123456789abcdef0123456789abcdef01'
const row = { info_hash: hash.toUpperCase(), name: 'Film CZ 1080p', category: '207', seeders: '12', size: '2000000000' }
afterEach(() => vi.unstubAllGlobals())

describe('public indexes', () => {
  it('normalizes results and constructs restart-safe magnets', () => {
    const [r] = indexResults([row], 'apibay')
    expect(r).toMatchObject({ id: `bt:${hash}`, source: 'public', seeders: 12, size: 2000000000, languages: ['cs'] })
    expect(publicMagnet(r.id)).toContain(`magnet:?xt=urn:btih:${hash}&tr=`)
    expect(publicMagnet(`bt:${hash}&tr=https://example.com`)).toBeUndefined()
  })
  it('rejects placeholders, non-video categories and malformed entries', () => {
    expect(indexResults([{ ...row, info_hash: '0'.repeat(40) }, { ...row, category: '301' }, null, { ...row, name: 12 }], 'apibay')).toEqual([])
    expect(indexResults({ torrents: [{ infohash: hash, name: 'Linux.iso' }] }, 'csv')).toEqual([])
  })
  it('merges duplicate hashes using the better seeded result', () => {
    const a = indexResults([row], 'apibay')
    const b = indexResults({ torrents: [{ infohash: hash, name: row.name, seeders: 20, size_bytes: 42 }] }, 'csv')
    expect(mergeIndexResults([a, b])).toEqual(b)
  })
  it('keeps working when one provider fails and caches requests', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('apibay')) throw new Error('offline')
      return { ok: true, json: async () => ({ torrents: [{ infohash: hash, name: 'Bunny', seeders: 2 }] }) }
    })
    vi.stubGlobal('fetch', fetcher)
    const results = await searchPublicIndexes('Bunny test')
    expect(results).toHaveLength(1)
    expect(await searchPublicIndexes('Bunny test')).toEqual(results)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await searchPublicIndexes('x')).toEqual([])
  })
})
