import { describe, expect, it } from 'vitest'
import { DragStepper, tapAction } from './trackpad.ts'

describe('DragStepper', () => {
  it('emits one step per threshold along the dominant axis', () => {
    const s = new DragStepper(50)
    expect(s.move(30, 0)).toEqual([])
    expect(s.move(30, 0)).toEqual(['right'])
    expect(s.move(100, 0)).toEqual(['right', 'right'])
    expect(s.move(0, -120)).toEqual(['up', 'up'])
  })

  it('does not drift to another row on a slightly diagonal swipe', () => {
    const s = new DragStepper(50)
    expect(s.move(60, 20)).toEqual(['right'])
    expect(s.move(60, 20)).toEqual(['right'])
    expect(s.move(60, 20)).toEqual(['right'])
  })

  it('turns back the other way after a change of direction', () => {
    const s = new DragStepper(50)
    expect(s.move(-55, 0)).toEqual(['left'])
    expect(s.move(60, 0)).toEqual(['right'])
  })
})

describe('tapAction', () => {
  it('maps quick taps to OK and two-finger taps to Back', () => {
    expect(tapAction(120, false, 1)).toBe('ok')
    expect(tapAction(120, false, 2)).toBe('back')
  })

  it('ignores drags and long presses', () => {
    expect(tapAction(120, true, 1)).toBeNull()
    expect(tapAction(900, false, 1)).toBeNull()
  })
})
