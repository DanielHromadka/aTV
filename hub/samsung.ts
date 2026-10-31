import { createSocket } from 'node:dgram'
import WebSocket from 'ws'
import type { TvKey } from '../shared/intents.ts'
import type { Action } from '../shared/keys.ts'

export const SAMSUNG_KEYS: Record<TvKey, string> = {
  volup: 'KEY_VOLUP',
  voldown: 'KEY_VOLDOWN',
  mute: 'KEY_MUTE',
  power: 'KEY_POWER',
  chup: 'KEY_CHUP',
  chdown: 'KEY_CHDOWN',
}

/** Remote buttons as the TV's own keys, so they work in whatever app is in front (Netflix, the browser, aTV). */
export const SAMSUNG_ACTION_KEYS: Record<Action, string> = {
  up: 'KEY_UP',
  down: 'KEY_DOWN',
  left: 'KEY_LEFT',
  right: 'KEY_RIGHT',
  ok: 'KEY_ENTER',
  back: 'KEY_RETURN',
  playpause: 'KEY_PLAY', // VERIFY: most apps toggle on KEY_PLAY; no separate play/pause key is documented
  play: 'KEY_PLAY',
  pause: 'KEY_PAUSE',
  stop: 'KEY_STOP',
  ff: 'KEY_FF',
  rw: 'KEY_REWIND',
}

/** The JSON a Samsung TV expects for one remote button press. */
export function keyPayload(key: string): string {
  return JSON.stringify({
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  })
}

/** Moves the TV's pointer by a relative amount (the Smart Remote / mouse cursor). */
export function pointerPayload(dx: number, dy: number): string {
  return JSON.stringify({
    method: 'ms.remote.control',
    params: { Cmd: 'Move', Position: { x: Math.round(dx), y: Math.round(dy), Time: String(Date.now()) }, TypeOfRemote: 'ProcessMouseDevice' },
  })
}

export function clickPayload(): string {
  return JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'LeftClick', TypeOfRemote: 'ProcessMouseDevice' } })
}

export function launchPayload(appId: string): string {
  return JSON.stringify({
    method: 'ms.channel.emit',
    params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: 'DEEP_LINK' } },
  })
}

/** Wake-on-LAN magic packet: six 0xFF bytes and the MAC address sixteen times. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[^0-9a-f]/gi, '')
  if (hex.length !== 12) throw new Error(`Neplatná MAC adresa: ${mac}`)
  const macBytes = Buffer.from(hex, 'hex')
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)])
}

interface Options {
  host: string
  mac?: string
  name?: string
  token?: string
  /** Called when the TV hands out a new token after the user allowed aTV on the TV. */
  onToken: (token: string) => void
}

/**
 * Controls a Samsung Tizen TV (2016+) through its remote-control WebSocket API on port 8002.
 * The first connection shows an "Allow" prompt on the TV; the token it returns skips that later.
 */
export class SamsungTv {
  private ws?: WebSocket
  private connecting?: Promise<WebSocket>
  private idle?: NodeJS.Timeout
  private readonly opts: Options

  constructor(opts: Options) {
    this.opts = opts
  }

  /** Whether the TV answers on its REST API (it does only when on, not in standby). */
  async isOn(): Promise<boolean> {
    try {
      const res = await fetch(`http://${this.opts.host}:8001/api/v2/`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }

  async key(key: string, repeat = 1): Promise<void> {
    const ws = await this.socket()
    for (let i = 0; i < repeat; i++) {
      ws.send(keyPayload(key))
      if (i < repeat - 1) await new Promise((r) => setTimeout(r, 150))
    }
  }

  async pointer(dx: number, dy: number): Promise<void> {
    const ws = await this.socket()
    ws.send(pointerPayload(dx, dy))
  }

  async click(): Promise<void> {
    const ws = await this.socket()
    ws.send(clickPayload())
  }

  async launch(appId: string): Promise<void> {
    const ws = await this.socket()
    ws.send(launchPayload(appId))
  }

  /** Sends the magic packet and waits until the TV answers (up to 20 s). */
  async powerOn(): Promise<void> {
    if (await this.isOn()) return
    if (!this.opts.mac) throw new Error('Pro zapnutí přes síť chybí MAC adresa televize (samsung.mac)')
    const packet = magicPacket(this.opts.mac)
    const sock = createSocket('udp4')
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject)
      sock.bind(() => {
        sock.setBroadcast(true)
        sock.send(packet, 9, '255.255.255.255', (err) => (err ? reject(err) : resolve()))
      })
    }).finally(() => sock.close())
    for (let i = 0; i < 20; i++) {
      if (await this.isOn()) return
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error('Televize se po Wake-on-LAN neozvala (je zapnuté „Zapnout přes síť“?)')
  }

  close(): void {
    clearTimeout(this.idle)
    this.ws?.close()
    this.ws = undefined
  }

  private socket(): Promise<WebSocket> {
    this.touch()
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws)
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined
    })
    return this.connecting
  }

  private connect(): Promise<WebSocket> {
    const name = Buffer.from(this.opts.name ?? 'aTV').toString('base64')
    const token = this.opts.token ? `&token=${encodeURIComponent(this.opts.token)}` : ''
    const url = `wss://${this.opts.host}:8002/api/v2/channels/samsung.remote.control?name=${name}${token}`
    // The TV's certificate is self-signed; the connection stays on the local network.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 5000 })
    return new Promise((resolve, reject) => {
      // The user has 30 s to press Allow on the TV.
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error('Televize neodpověděla (povolte aTV na televizi)'))
      }, 30_000)
      ws.on('message', (data) => {
        let msg: { event?: string; data?: { token?: string } }
        try {
          msg = JSON.parse(String(data))
        } catch {
          return
        }
        if (msg.event === 'ms.channel.connect') {
          clearTimeout(timer)
          if (msg.data?.token && msg.data.token !== this.opts.token) {
            this.opts.token = msg.data.token
            this.opts.onToken(msg.data.token)
          }
          this.ws = ws
          resolve(ws)
        } else if (msg.event === 'ms.channel.unauthorized') {
          clearTimeout(timer)
          ws.close()
          reject(new Error('Televize aTV nepovolila'))
        }
      })
      ws.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Televize nedostupná: ${err.message}`))
      })
      ws.on('close', () => {
        if (this.ws === ws) this.ws = undefined
      })
    })
  }

  /** Closes the socket after a minute without commands; the TV keeps few connections. */
  private touch(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.close(), 60_000)
    this.idle.unref()
  }
}
