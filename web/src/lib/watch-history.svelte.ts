import type { PlayerSource } from '../../../shared/playback.ts'
import { recordWatch, type WatchEntry } from '../../../shared/watch-history.ts'

/** The same storage as the TV app's browser version, so "continue watching" is shared in one browser. */
const KEY = 'atv.watch-history.v1'

function load(): WatchEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value
      .filter((e): e is WatchEntry => !!e && typeof e.id === 'string' && e.source?.kind === 'url' && typeof e.source.url === 'string'
        && typeof e.source.title === 'string' && !e.source.live && Number.isFinite(e.position) && e.position >= 5
        && Number.isFinite(e.duration) && Number.isFinite(e.updatedAt))
      .slice(0, 50)
  } catch {
    return []
  }
}

export const watching = $state({ entries: load() })

export function saveWatch(source: PlayerSource, position: number, duration: number, ended = false): void {
  const previous = $state.snapshot(watching.entries) as WatchEntry[]
  const next = recordWatch(previous, source, position, duration, ended)
  if (next === previous) return
  watching.entries = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Keep the history for this session when storage is unavailable.
  }
}
