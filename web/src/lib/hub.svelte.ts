import type { Channel } from '../../../shared/m3u.ts'
import type { HubToTv, PublicConfig, WebMessage } from '../../../shared/protocol.ts'
import { settings } from './settings.svelte.ts'
import { notify } from './toast.svelte.ts'

/** The hub's base URL: the setting, or the page's own origin when the hub serves the web app. */
export function hubUrl(): string {
  const set = settings.hubUrl.replace(/\/+$/, '')
  if (set) return set
  return /^https?:$/.test(location.protocol) ? location.origin : ''
}

/** Hub paths such as `/api/art/images/1` as full URLs; other URLs stay as they are. */
export const hubAsset = (url?: string): string | undefined => (url?.startsWith('/api/') ? hubUrl() + url : url)

export class HubError extends Error {}

export async function hubApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = hubUrl()
  if (!base) throw new HubError('Hub není nastavený')
  const res = await fetch(base + path, init).catch(() => {
    throw new HubError('Spojení s hubem se přerušilo. Ověřte, že hub běží, a zkuste to znovu.')
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new HubError(body.error || `HTTP ${res.status}`)
  return body
}

/** JSON to the hub with POST or DELETE. */
export const hubSend = <T>(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> =>
  hubApi<T>(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

export const hub = $state({
  connected: false,
  config: null as PublicConfig | null,
  pairing: null as { code: string; url: string } | null,
  sleepEndsAt: null as number | null,
})

type Listener = (msg: HubToTv) => void
const listeners = new Set<Listener>()

/** Messages from the hub that other modules handle (the shared look). */
export function onHubMessage(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

let ws: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | undefined

export function sendToHub(msg: WebMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify(msg))
  return true
}

/** Connects (and keeps reconnecting) as a web app; aTV works without a hub, just with fewer features. */
export function connectHub(): void {
  clearTimeout(retry)
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  const base = hubUrl()
  if (!base) return
  hubApi<PublicConfig>('/api/config').then((c) => (hub.config = c), () => {})
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`)
  ws = socket
  socket.onopen = () => {
    socket.send(JSON.stringify({ t: 'hello', role: 'web' } satisfies WebMessage))
    hub.connected = true
  }
  socket.onmessage = (e) => {
    let msg: HubToTv
    try {
      msg = JSON.parse(String(e.data)) as HubToTv
    } catch {
      return
    }
    if (msg.t === 'pairing') hub.pairing = { code: msg.code, url: msg.url }
    else if (msg.t === 'sleep') hub.sleepEndsAt = msg.endsAt
    else if (msg.t === 'notify') notify(msg.title, msg.text, msg.image)
    listeners.forEach((l) => l(msg))
  }
  socket.onclose = () => {
    if (ws !== socket) return
    ws = null
    hub.connected = false
    hub.pairing = null
    retry = setTimeout(connectHub, 5000)
  }
}

let channels: Promise<Channel[]> | null = null

/** IPTV channels from the hub, loaded once per session. */
export function loadChannels(): Promise<Channel[]> {
  channels ??= hubApi<Channel[]>('/api/iptv').catch((e: unknown) => {
    channels = null
    throw e
  })
  return channels
}

/** The TV's sleep timer, run by the hub (it can switch the TV off). */
export function setSleep(minutes: number | null): boolean {
  return sendToHub({ t: 'sleep-set', minutes })
}
