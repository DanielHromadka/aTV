export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * Index of the candidate to focus when moving from `from` in `dir`, or -1.
 * Left and right stay within the row (the boxes must overlap vertically).
 * Up and down go to the nearest row first and then to the item closest
 * sideways, so a short row below is never skipped; items beside this one are never a row.
 */
export function nextFocus(from: Rect, candidates: Rect[], dir: Direction): number {
  const cx = from.left + from.width / 2
  const cy = from.top + from.height / 2
  const horizontal = dir === 'left' || dir === 'right'
  const options: { i: number; main: number; side: number }[] = []

  candidates.forEach((r, i) => {
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (horizontal) {
      const overlap = Math.min(from.top + from.height, r.top + r.height) - Math.max(from.top, r.top)
      if (overlap <= 0) return
      if (dir === 'left' ? x >= cx - 1 : x <= cx + 1) return
      options.push({ i, main: Math.abs(x - cx), side: Math.abs(y - cy) })
    } else {
      if (dir === 'up' ? y >= cy - 1 : y <= cy + 1) return
      // Only boxes that lie (almost) wholly above or below count, so a shorter item in the same row,
      // or a tall tile beside this one, is not mistaken for the next row.
      const slack = Math.min(from.height, r.height) / 4
      if (dir === 'up' ? r.top + r.height > from.top + slack : r.top < from.top + from.height - slack) return
      // The gap between the boxes, so tall and short items in one row count as one row.
      const gap = dir === 'up' ? from.top - (r.top + r.height) : r.top - (from.top + from.height)
      options.push({ i, main: Math.max(gap, 0), side: Math.abs(x - cx) })
    }
  })
  if (!options.length) return -1

  if (horizontal) {
    options.sort((a, b) => a.main - b.main || a.side - b.side)
    return options[0].i
  }
  const nearest = Math.min(...options.map((o) => o.main))
  const row = options.filter((o) => o.main <= nearest + 24)
  row.sort((a, b) => a.side - b.side)
  return row[0].i
}
