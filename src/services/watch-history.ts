import { recordWatch, type WatchEntry } from '../../shared/watch-history'
import { createStore, type PlayerSource } from '../state'

const KEY = 'atv.watch-history.v1'
function load(): WatchEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((e): e is WatchEntry => !!e && typeof e.id === 'string'
      && e.source?.kind === 'url' && typeof e.source.url === 'string' && typeof e.source.title === 'string'
      && !e.source.live && Number.isFinite(e.position) && e.position >= 5
      && Number.isFinite(e.duration) && Number.isFinite(e.updatedAt)).slice(0, 50)
  } catch { return [] }
}

export const watchHistory = createStore<WatchEntry[]>(load())
export function saveWatch(source: PlayerSource, position: number, duration: number, ended = false): void {
  const previous = watchHistory.get()
  const next = recordWatch(previous, source, position, duration, ended)
  if (next === previous) return
  watchHistory.set(next)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* Keep session history when storage is unavailable. */ }
}
