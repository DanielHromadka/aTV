import type { PlayerSource } from './playback.ts'

export interface WatchEntry {
  id: string
  source: Extract<PlayerSource, { kind: 'url' }>
  position: number
  duration: number
  updatedAt: number
}

/** Live streams and failed starts never become resumable films. */
export function recordWatch(entries: WatchEntry[], source: PlayerSource, position: number, duration: number, ended = false, now = Date.now()): WatchEntry[] {
  if (source.kind !== 'url' || source.live || !Number.isFinite(position) || position < 0) return entries
  const id = source.historyId || source.url
  const rest = entries.filter((e) => e.id !== id)
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0
  if (ended || (!source.audioOnly && length > 0 && position >= length * 0.95)) return rest
  if (position < 5) return entries
  return [{ id, source, position, duration: length, updatedAt: now }, ...rest].slice(0, 50)
}

/** Resume fresh selections too, while respecting an explicit start (including zero). */
export function resumeWatch(source: PlayerSource, entries: WatchEntry[]): PlayerSource {
  if (source.kind !== 'url' || source.live || source.startSeconds !== undefined) return source
  const saved = entries.find(e => e.id === (source.historyId || source.url))
  return saved ? { ...source, startSeconds: saved.position, duration: source.duration || saved.duration || undefined } : source
}
