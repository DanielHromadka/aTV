import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Media } from './media.ts'
import { Catalog } from './catalog.ts'
import type { Torrents } from './torrents.ts'
import type { Probe } from '../shared/media.ts'

const dirs: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function setup(peers: number) {
  const dir = mkdtempSync(join(tmpdir(), 'atv-media-')); dirs.push(dir)
  const catalog = new Catalog(dir)
  const entry = catalog.add({ source: `magnet:?xt=urn:btih:${'a'.repeat(40)}`, title: 'Film' })
  const torrent = { name: 'Film', numPeers: peers, progress: 0 }
  const torrents = {
    get: () => undefined,
    open: vi.fn(async () => torrent),
    files: () => [{ index: 0, name: 'film.mp4', length: 1000 }],
    status: () => ({ progress: 0, downloadSpeed: 0, uploadSpeed: 0, peers }),
  }
  const media = new Media(catalog, torrents as unknown as Torrents, 8090)
  const probe = vi.spyOn(media as unknown as { probe(key: string, index: number): Promise<Probe> }, 'probe')
  return { media, key: entry.id, probe }
}

it('returns the file list immediately without probing when no peer has connected', async () => {
  const { media, key, probe } = setup(0)
  const details = await media.details(key)
  expect(details.videos).toHaveLength(1)
  expect(details.status.peers).toBe(0)
  expect(details.probing).toBe(false)
  expect(probe).not.toHaveBeenCalled()
})

it('does not block on slow video analysis and shares one probe between requests', async () => {
  const { media, key, probe } = setup(2)
  let finish!: (value: Probe) => void
  probe.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  expect((await media.details(key)).probing).toBe(true)
  expect((await media.details(key)).probing).toBe(true)
  expect(probe).toHaveBeenCalledTimes(1)
  const result: Probe = { video: { codec: 'h264' }, audio: [{ index: 0, lang: 'cs', codec: 'aac' }], embeddedSubtitles: [] }
  finish(result)
  await Promise.resolve(); await Promise.resolve()
  const ready = await media.details(key)
  expect(ready.probe).toEqual(result)
  expect(ready.probing).toBe(false)
})

it('keeps details usable after a failed probe without retrying on every poll', async () => {
  const { media, key, probe } = setup(1)
  probe.mockRejectedValue(new Error('timeout'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await media.details(key)
  await Promise.resolve(); await Promise.resolve()
  const details = await media.details(key)
  expect(details.probeError).toBeTruthy()
  expect(details.videos).toHaveLength(1)
  expect(details.probing).toBe(false)
  expect(probe).toHaveBeenCalledTimes(1)
})
