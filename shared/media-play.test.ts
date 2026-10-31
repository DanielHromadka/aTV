import { expect, it, vi } from 'vitest'
import { playMedia } from './media-play.ts'
it('accepts a legacy TV play() that returns nothing', async () => {
  const play = vi.fn(() => undefined)
  await expect(playMedia({ play })).resolves.toBeUndefined()
  expect(play).toHaveBeenCalledOnce()
})
it('preserves modern playback failures and synchronous TV errors', async () => {
  await expect(playMedia({ play: () => Promise.reject(new Error('blocked')) })).rejects.toThrow('blocked')
  await expect(playMedia({ play: () => { throw new Error('unsupported') } })).rejects.toThrow('unsupported')
})
