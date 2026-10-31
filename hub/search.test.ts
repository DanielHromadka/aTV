import { afterEach, expect, it, vi } from 'vitest'
import { Searches } from './search.ts'
import type { MediaResult } from '../shared/media.ts'
const result = (id: string): MediaResult => ({ id, title: id, source: 'public', languages: [], subtitles: [] })
afterEach(() => vi.useRealTimers())

it('keeps fast providers visible during discovery, then streams each discovered source independently', async () => {
  vi.useFakeTimers()
  const searches = new Searches(() => [
    { id: 'jackett', name: 'Jackett', load: () => new Promise(resolve => setTimeout(() => resolve([
      { id: 'discovered-fast', name: 'Fast', run: async () => [result('discovered')] },
      { id: 'discovered-slow', name: 'Slow', run: () => new Promise(r => setTimeout(() => r([result('slow')]), 5000)) },
      { id: 'broken', name: 'Broken', run: async () => { throw new Error('secret') } },
    ]), 1000)) },
    { id: 'archive', name: 'Archive', run: async () => [result('archive')] },
  ])
  searches.snapshot('Film')
  await vi.advanceTimersByTimeAsync(100)
  expect(searches.snapshot('Film').groups.flat()).toEqual([result('archive')])
  await vi.advanceTimersByTimeAsync(1000)
  expect(searches.snapshot('Film').providers.map(p => [p.id, p.state])).toEqual([
    ['discovered-fast', 'done'], ['discovered-slow', 'pending'], ['broken', 'error'], ['archive', 'done'],
  ])
  await vi.advanceTimersByTimeAsync(5000)
  expect((await searches.complete('Film')).flat()).toEqual([result('discovered'), result('slow'), result('archive')])
})

it('distinguishes unavailable discovery from an empty configured source list', async () => {
  const searches = new Searches(() => [
    { id: 'failed', name: 'Failed discovery', load: async () => { throw new Error('secret') } },
    { id: 'empty', name: 'Empty discovery', load: async () => [] },
  ])
  await searches.complete('Film')
  expect(searches.snapshot('Film').providers.map(p => p.state)).toEqual(['error', 'done'])
})

it('returns fast sources immediately while slow searches continue past 15 seconds', async () => {
  vi.useFakeTimers()
  const searches = new Searches(() => [
    { id: 'fast', name: 'Fast', run: async () => [result('fast')] },
    { id: 'slow', name: 'Slow', run: () => new Promise(resolve => setTimeout(() => resolve([result('slow')]), 22_000)) },
  ])
  expect(searches.snapshot('Film').providers.map(p => p.state)).toEqual(['pending', 'pending'])
  await vi.advanceTimersByTimeAsync(16_000)
  const partial = searches.snapshot('Film')
  expect(partial.groups.flat()).toEqual([result('fast')])
  expect(partial.providers.map(p => p.state)).toEqual(['done', 'pending'])
  await vi.advanceTimersByTimeAsync(6000)
  expect((await searches.complete('Film')).flat()).toEqual([result('fast'), result('slow')])
})

it('distinguishes unavailable providers from a successful empty result without exposing errors', async () => {
  const searches = new Searches(() => [
    { id: 'empty', name: 'Empty', run: async () => [] },
    { id: 'broken', name: 'Broken', run: async () => { throw new Error('apikey=secret') } },
  ])
  await searches.complete('Film')
  const snapshot = searches.snapshot('Film')
  expect(snapshot.providers.map(p => p.state)).toEqual(['done', 'error'])
  expect(JSON.stringify(snapshot)).not.toContain('secret')
})

it('reuses a query for polling and ignores too-short input', async () => {
  const jobs = vi.fn(() => [{ id: 'one', name: 'One', run: async () => [result('one')] }])
  const searches = new Searches(jobs)
  searches.snapshot('x')
  expect(jobs).not.toHaveBeenCalled()
  await searches.complete(' Film ')
  searches.snapshot('film')
  expect(jobs).toHaveBeenCalledTimes(1)
})
