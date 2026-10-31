import type { Channel } from '../../shared/m3u.ts'
import type { HubToTv, PublicConfig, TvMessage, TvState } from '../../shared/protocol.ts'
import { platform } from '../runtime'
import { config, createStore, hubStatus, notify } from '../state'
import { settings } from './settings'

/** The hub's base URL: the setting, or the page's own origin when the hub serves aTV. */
export function hubUrl(): string {
  const set = settings.get().hubUrl.replace(/\/+$/, '')
  if (set) return set
  return /^https?:$/.test(location.protocol) ? location.origin : ''
}

export async function hubApi<T>(path: string): Promise<T> {
  const base = hubUrl()
  if (!base) throw new Error('Hub není nastavený')
  const res = await fetch(base + path).catch(() => {
    throw new Error('Spojení s hubem se přerušilo. Ověřte, že hub běží, a zkuste to znovu.')
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

let ws: WebSocket | null = null
let retry: number | undefined
let handler: (msg: HubToTv) => void = () => {}

export function onHubMessage(h: (msg: HubToTv) => void): void {
  handler = h
}

export function sendToHub(msg: TvMessage): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify(msg))
  return true
}

let lastState = ''
export function reportState(state: TvState): void {
  const s = JSON.stringify(state)
  if (s === lastState) return
  lastState = s
  sendToHub({ t: 'state', state })
}

/** Connects (and keeps reconnecting) to the hub; aTV works without it, just with fewer features. */
export function connectHub(): void {
  window.clearTimeout(retry)
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  const base = hubUrl()
  if (!base) return
  hubApi<PublicConfig>('/api/config')
    .then((c) => config.set(c))
    .catch(() => {})
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`)
  ws = socket
  socket.onopen = () => {
    socket.send(JSON.stringify({ t: 'hello', role: 'tv', platform: platform.id }))
    hubStatus.set((s) => ({ ...s, connected: true }))
    if (lastState) socket.send(JSON.stringify({ t: 'state', state: JSON.parse(lastState) }))
  }
  socket.onmessage = (e) => {
    let msg: HubToTv
    try {
      msg = JSON.parse(String(e.data)) as HubToTv
    } catch {
      return
    }
    if (msg.t === 'pairing') hubStatus.set((s) => ({ ...s, pairing: { code: msg.code, url: msg.url } }))
    else if (msg.t === 'sleep') hubStatus.set((s) => ({ ...s, sleepEndsAt: msg.endsAt }))
    else if (msg.t === 'notify') notify({ title: msg.title, text: msg.text, image: msg.image })
    else handler(msg)
  }
  socket.onclose = () => {
    if (ws !== socket) return
    ws = null
    hubStatus.set((s) => ({ ...s, connected: false, pairing: null }))
    retry = window.setTimeout(connectHub, 5000)
  }
}

export const channels = createStore<Channel[] | null>(null)

/** IPTV channels from the hub, loaded once per session (null until loaded or when not configured). */
export async function loadChannels(): Promise<Channel[]> {
  const cached = channels.get()
  if (cached) return cached
  const list = await hubApi<Channel[]>('/api/iptv')
  channels.set(list)
  return list
}
