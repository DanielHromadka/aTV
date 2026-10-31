import { describe, expect, it } from 'vitest'
import { toAction } from './keys.ts'

describe('toAction', () => {
  it('maps modern and legacy arrow names', () => {
    expect(toAction({ key: 'ArrowLeft' })).toBe('left')
    expect(toAction({ key: 'Up' })).toBe('up')
  })

  it('falls back to key codes when the engine sends no key', () => {
    expect(toAction({ keyCode: 39 })).toBe('right')
    expect(toAction({ keyCode: 13 })).toBe('ok')
  })

  it('treats every platform Back as back', () => {
    expect(toAction({ keyCode: 10009 })).toBe('back') // Samsung
    expect(toAction({ keyCode: 461 })).toBe('back') // LG
    expect(toAction({ key: 'Escape' })).toBe('back')
    expect(toAction({ key: 'Backspace' })).toBe('back')
  })

  it('ignores other keys', () => {
    expect(toAction({ key: 'a', keyCode: 65 })).toBeNull()
  })
})
