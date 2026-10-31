import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parseM3u, type Channel } from '../shared/m3u.ts'
import type { HubConfig } from './config.ts'

/** IPTV channels from a playlist URL or a file in the data directory, cached for an hour. */
export class Iptv {
  private cache?: { at: number; channels: Channel[] }
  private readonly playlist: string
  private readonly dataDir: string

  constructor(playlist: string, dataDir: string) {
    this.playlist = playlist
    this.dataDir = dataDir
  }

  async channels(): Promise<Channel[]> {
    if (this.cache && Date.now() - this.cache.at < 3600_000) return this.cache.channels
    let text: string
    if (/^https?:\/\//.test(this.playlist)) {
      const res = await fetch(this.playlist, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`Playlist: HTTP ${res.status}`)
      text = await res.text()
    } else {
      text = await readFile(isAbsolute(this.playlist) ? this.playlist : join(this.dataDir, this.playlist), 'utf8')
    }
    const channels = parseM3u(text)
    this.cache = { at: Date.now(), channels }
    return channels
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Random photos from Immich; the API key stays in the hub, the TV gets ids and proxied images. */
export class Immich {
  private readonly cfg: NonNullable<HubConfig['immich']>

  constructor(cfg: NonNullable<HubConfig['immich']>) {
    this.cfg = cfg
  }

  async randomIds(count: number): Promise<string[]> {
    const body: Record<string, unknown> = { size: Math.min(Math.max(count, 1), 50), type: 'IMAGE' }
    if (this.cfg.albumId) body.albumIds = [this.cfg.albumId]
    const res = await fetch(new URL('/api/search/random', this.cfg.url), {
      method: 'POST',
      headers: { 'x-api-key': this.cfg.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Immich: HTTP ${res.status}`)
    const assets = (await res.json()) as { id: string }[]
    return assets.map((a) => a.id).filter((id) => UUID.test(id))
  }

  async image(id: string): Promise<Response> {
    if (!UUID.test(id)) throw new Error('Neplatné id fotky')
    return fetch(new URL(`/api/assets/${id}/thumbnail?size=preview`, this.cfg.url), {
      headers: { 'x-api-key': this.cfg.apiKey },
      signal: AbortSignal.timeout(15_000),
    })
  }
}

/** Turns on Home Assistant scenes when playback starts and stops ("kino" lights). */
export class HomeAssistant {
  private readonly cfg: NonNullable<HubConfig['homeAssistant']>
  private last?: string

  constructor(cfg: NonNullable<HubConfig['homeAssistant']>) {
    this.cfg = cfg
  }

  async playback(state: 'playing' | 'paused' | 'stopped'): Promise<void> {
    const scene = state === 'playing' ? this.cfg.scenes?.playing : state === 'stopped' ? this.cfg.scenes?.stopped : undefined
    // Pausing keeps the scene; repeated reports of one state call the scene only once.
    if (!scene || scene === this.last) return
    this.last = scene
    const res = await fetch(new URL('/api/services/scene/turn_on', this.cfg.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entity_id: scene }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Home Assistant: HTTP ${res.status}`)
  }
}
