import { describe, expect, it } from 'vitest'
import { recordWatch, resumeWatch } from './watch-history'
import type { PlayerSource } from './playback.ts'

const movie: PlayerSource = { kind: 'url', title: 'Film', url: 'http://hub/file', historyId: 'torrent/0' }
describe('continue watching', () => {
  it('updates the same film without duplicates and preserves playback choices', () => {
    const first = recordWatch([], movie, 60, 3600, false, 1)
    const source = { ...movie, seekTemplate: 'http://hub/play?t={t}', subtitle: { label: 'CZ', src: 'http://hub/sub' } }
    const next = recordWatch(first, source, 180, 3600, false, 2)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ position: 180, updatedAt: 2, source })
  })
  it('excludes live TV, Jellyfin (server-owned history), failed starts and invalid times', () => {
    expect(recordWatch([], { ...movie, live: true }, 60, 3600)).toEqual([])
    expect(recordWatch([], { kind: 'jellyfin', itemId: '1', title: 'Film' }, 60, 3600)).toEqual([])
    expect(recordWatch([], movie, 0, 3600)).toEqual([])
    expect(recordWatch([], movie, NaN, 3600)).toEqual([])
  })
  it('removes completed films, including an ended stream without a known duration', () => {
    const first = recordWatch([], movie, 60, 3600)
    expect(recordWatch(first, movie, 3500, 3600)).toEqual([])
    expect(recordWatch(first, movie, 120, 0, true)).toEqual([])
    expect(recordWatch(first, movie, 0, 0)).toEqual(first)
  })
  it('keeps the most recently watched first and limits stored history', () => {
    let entries = recordWatch([], movie, 60, Infinity)
    expect(entries[0].duration).toBe(0)
    for (let i = 0; i < 55; i++) entries = recordWatch(entries, { ...movie, historyId: String(i) }, 60, 3600)
    expect(entries).toHaveLength(50)
    expect(entries[0].id).toBe('54')
  })
})

it('keeps audiobook positions near the end until playback actually ends', () => {
  const book = { ...movie, audioOnly: true }
  const saved = recordWatch([], book, 9700, 10000)
  expect(saved[0].position).toBe(9700)
  expect(recordWatch(saved, book, 10000, 10000, true)).toEqual([])
})
it('resumes fresh selections by file identity, preserves current URLs and honors explicit starts', () => {
  const saved = recordWatch([], { ...movie, audioOnly: true }, 125, 500)
  expect(resumeWatch({ ...movie, url: 'http://new-hub/file', audioOnly: true }, saved)).toMatchObject({ startSeconds: 125, duration: 500, url: 'http://new-hub/file' })
  expect(resumeWatch({ ...movie, startSeconds: 0 }, saved).startSeconds).toBe(0)
  expect(resumeWatch({ ...movie, live: true }, saved).startSeconds).toBeUndefined()
  expect(resumeWatch({ ...movie, historyId: 'torrent/1' }, saved).startSeconds).toBeUndefined()
})
