import { describe, expect, it } from 'vitest'
import { nextFocus, type Rect } from './spatial.ts'

const box = (left: number, top: number, width = 100, height = 60): Rect => ({ left, top, width, height })

// Row A: four tiles; row B: two posters starting at the right; row C: one wide item.
const rowA = [box(0, 0), box(120, 0), box(240, 0), box(360, 0)]
const rowB = [box(300, 100), box(400, 100)]
const rowC = [box(0, 300, 400)]
const all = [...rowA, ...rowB, ...rowC]

describe('nextFocus', () => {
  it('moves along a row', () => {
    expect(nextFocus(rowA[1], all, 'right')).toBe(2)
    expect(nextFocus(rowA[1], all, 'left')).toBe(0)
  })

  it('stops at the end of a row instead of jumping to another row', () => {
    expect(nextFocus(rowA[3], all, 'right')).toBe(-1)
    expect(nextFocus(rowB[0], all, 'left')).toBe(-1)
  })

  it('goes to the nearest row even when its items are far to the side', () => {
    expect(nextFocus(rowA[0], all, 'down')).toBe(4)
  })

  it('picks the closest item sideways within that row', () => {
    expect(nextFocus(rowA[3], all, 'down')).toBe(5)
    expect(nextFocus(rowB[1], all, 'up')).toBe(3)
  })

  it('returns -1 when nothing lies in that direction', () => {
    expect(nextFocus(rowA[2], all, 'up')).toBe(-1)
    expect(nextFocus(rowC[0], all, 'down')).toBe(-1)
  })

  it('does not treat a shorter item in the same row as the row above', () => {
    const portrait = { left: 0, top: 500, width: 160, height: 300 }
    const shortCard = { left: 200, top: 500, width: 160, height: 260 }
    const above = { left: 0, top: 100, width: 300, height: 180 }
    expect(nextFocus(portrait, [shortCard, above], 'up')).toBe(1)
    expect(nextFocus(above, [shortCard, portrait], 'down')).toBe(1)
  })

  it('does not go up into a tall tile beside the current one', () => {
    const big = { left: 0, top: 0, width: 560, height: 748 }
    const wide = { left: 590, top: 0, width: 556, height: 360 }
    const small = { left: 590, top: 388, width: 264, height: 360 }
    expect(nextFocus(small, [big, wide], 'up')).toBe(1)
  })
})
