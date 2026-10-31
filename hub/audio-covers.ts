/** Metadata lookup is optional: a missing cover must never block playback. */
export class AudioCovers {
  private cache = new Map<string, Promise<string | undefined>>()
  private queue: Promise<unknown> = Promise.resolve()
  find(title: string): Promise<string | undefined> {
    const q = title.replace(/\[[^\]]*\]|\([^)]*(?:mp3|flac|kbps)[^)]*\)/gi, ' ').replace(/\b(?:mp3|flac|320kbps|lossless|WEB|CDRip)\b/gi, ' ').replace(/[._]/g, ' ').trim().slice(0, 180)
    const known = this.cache.get(q)
    if (known) return known
    const task = this.queue.then(async () => {
      const url = new URL('https://musicbrainz.org/ws/2/release-group/')
      url.search = new URLSearchParams({ query: q.replace(/[+!(){}\[\]^"~*?:\\/]/g, ' '), fmt: 'json', limit: '1' }).toString()
      const response = await fetch(url, { headers: { 'User-Agent': 'aTV/0.1 (personal media library)' }, signal: AbortSignal.timeout(6000) })
      if (!response.ok) return undefined
      const data = await response.json() as { 'release-groups'?: { id: string; score: number }[] }
      const match = data['release-groups']?.[0]
      if (!match || Number(match.score) < 95 || !/^[a-f0-9-]{36}$/.test(match.id)) return undefined
      return `https://coverartarchive.org/release-group/${match.id}/front-250`
    }).catch(() => undefined)
    this.queue = task.then(() => new Promise(resolve => setTimeout(resolve, 1100)))
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(q, task)
    return task
  }
}
