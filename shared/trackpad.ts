export type Step = 'up' | 'down' | 'left' | 'right'

/**
 * Turns a finger drag on the phone's trackpad into focus steps: every `step` pixels along the
 * dominant axis is one arrow press, so a long drag moves several tiles. Moving along one axis
 * clears the other, so a slightly diagonal swipe along a row does not also jump rows.
 */
export class DragStepper {
  private ax = 0
  private ay = 0
  private readonly step: number

  constructor(step: number) {
    this.step = step
  }

  move(dx: number, dy: number): Step[] {
    this.ax += dx
    this.ay += dy
    const out: Step[] = []
    for (;;) {
      if (Math.abs(this.ax) >= this.step && Math.abs(this.ax) >= Math.abs(this.ay)) {
        out.push(this.ax > 0 ? 'right' : 'left')
        this.ax -= Math.sign(this.ax) * this.step
        this.ay = 0
      } else if (Math.abs(this.ay) >= this.step) {
        out.push(this.ay > 0 ? 'down' : 'up')
        this.ay -= Math.sign(this.ay) * this.step
        this.ax = 0
      } else {
        return out
      }
    }
  }
}

/** A short touch that did not move: one finger is OK, two fingers are Back. */
export function tapAction(durationMs: number, moved: boolean, fingers: number): 'ok' | 'back' | null {
  if (moved || durationMs > 350) return null
  return fingers >= 2 ? 'back' : 'ok'
}
