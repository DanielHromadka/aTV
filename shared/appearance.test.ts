import { describe, expect, it } from 'vitest'
import { applyAppearance, cycle, DEFAULT_APPEARANCE, DESIGNS, isBackgroundId, normalizeAppearance, SCENES } from './appearance.ts'

describe('appearance', () => {
  it('takes the preset of a newly chosen design', () => {
    const dock = DESIGNS.find((d) => d.id === 'dock')!
    expect(applyAppearance(DEFAULT_APPEARANCE, { design: 'dock' })).toEqual({ ...DEFAULT_APPEARANCE, design: 'dock', ...dock.preset })
  })

  it('keeps overrides sent with the design and the background', () => {
    const next = applyAppearance({ ...DEFAULT_APPEARANCE, background: 'scene:dunes' }, { design: 'minimal', font: 'classic' })
    expect(next.font).toBe('classic')
    expect(next.background).toBe('scene:dunes')
  })

  it('ignores unknown values', () => {
    expect(applyAppearance(DEFAULT_APPEARANCE, { design: 'x', tiles: 'neon', background: '../etc', clock: 1 })).toEqual(DEFAULT_APPEARANCE)
    expect(applyAppearance(DEFAULT_APPEARANCE, null)).toBe(DEFAULT_APPEARANCE)
  })

  it('accepts only known background id shapes', () => {
    expect(isBackgroundId('scene:valley')).toBe(true)
    expect(isBackgroundId('photo:0123456789abcdef')).toBe(true)
    expect(isBackgroundId('immich')).toBe(true)
    expect(isBackgroundId('photo:../x')).toBe(false)
    expect(isBackgroundId('scene:nowhere')).toBe(false)
    expect(isBackgroundId('https://example.com/a.jpg')).toBe(false)
  })

  it('repairs a broken saved appearance', () => {
    expect(normalizeAppearance({ design: 'mosaic', font: 'comic' })).toEqual({ ...DEFAULT_APPEARANCE, design: 'mosaic' })
    expect(normalizeAppearance('nonsense')).toEqual(DEFAULT_APPEARANCE)
  })

  it('cycles both ways with wrap-around', () => {
    expect(cycle(['a', 'b', 'c'], 'c', 1)).toBe('a')
    expect(cycle(['a', 'b', 'c'], 'a', -1)).toBe('c')
  })

  it('has unique scene ids that pass validation', () => {
    const ids = SCENES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(isBackgroundId(`scene:${id}`)).toBe(true)
  })
})
