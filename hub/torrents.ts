import { mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream'
import type { TorrentFileInfo } from '../shared/media.ts'

// The parts of WebTorrent we use (the package ships no types).
interface TFile {
  name: string
  path: string
  length: number
  createReadStream(opts?: { start?: number; end?: number }): NodeJS.ReadableStream
  deselect(): void
}
interface Torrent {
  infoHash: string
  name: string
  files: TFile[]
  ready: boolean
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  numPeers: number
  once(event: 'ready', cb: () => void): void
  once(event: 'error', cb: (e: Error) => void): void
  destroy(opts: { destroyStore: boolean }, cb?: () => void): void
}
interface Client {
  add(source: string | Buffer, opts: { path: string; deselect?: boolean }, cb?: (t: Torrent) => void): Torrent
  destroy(cb?: () => void): void
  on(event: 'error', cb: (e: Error) => void): void
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', ts: 'video/mp2t', ogv: 'video/ogg', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  srt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
}

const MAX_ACTIVE = 3
const IDLE_MS = 2 * 3600_000
/** Only errors with messages safe to display to the client use this type. */
export class TorrentOpenError extends Error {}

/**
 * Torrents as streamable files. Nothing downloads until a file is read: playback pulls the pieces
 * it needs (seeking included), and torrents unused for two hours are removed with their data.
 */
export class Torrents {
  private client?: Promise<Client>
  private readonly active = new Map<string, { torrent: Torrent; used: number }>()
  private readonly opening = new Map<string, Promise<Torrent>>()
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'torrents')
    setInterval(() => this.sweep(), 10 * 60_000).unref()
  }

  private getClient(): Promise<Client> {
    // Loaded at first use: WebTorrent is large and most hub starts never need it.
    this.client ??= import('webtorrent').then((m) => {
      mkdirSync(this.dir, { recursive: true })
      const WebTorrent = m.default as unknown as new (opts: object) => Client
      const c = new WebTorrent({ utp: false })
      c.on('error', (e) => console.warn('[torrent]', e.message))
      return c
    })
    return this.client
  }

  /** The torrent for `key`, added from `source` if needed; waits for its file list (up to a minute). */
  open(key: string, source: string | Buffer): Promise<Torrent> {
    const known = this.active.get(key)
    if (known) {
      known.used = Date.now()
      return Promise.resolve(known.torrent)
    }
    let p = this.opening.get(key)
    if (!p) {
      p = this.add(key, source).finally(() => this.opening.delete(key))
      this.opening.set(key, p)
    }
    return p
  }

  private async add(key: string, source: string | Buffer): Promise<Torrent> {
    const client = await this.getClient()
    this.evict()
    const torrent = client.add(source, { path: join(this.dir, key.replace(/[^a-z0-9._-]/gi, '_')), deselect: true })
    await new Promise<void>((resolve, reject) => {
      if (torrent.ready) return resolve()
      const timer = setTimeout(() => {
        torrent.destroy({ destroyStore: true })
        reject(new TorrentOpenError('Torrent do minuty neposkytl seznam souborů. Zkuste to znovu nebo vyberte jinou verzi filmu.'))
      }, 60_000)
      torrent.once('ready', () => {
        clearTimeout(timer)
        resolve()
      })
      torrent.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
    // Nothing is fetched until a stream asks for it.
    for (const f of torrent.files) f.deselect()
    this.active.set(key, { torrent, used: Date.now() })
    console.log(`[torrent] ${key}: ${torrent.name} (${torrent.files.length} files)`)
    return torrent
  }

  get(key: string): Torrent | undefined {
    const a = this.active.get(key)
    if (a) a.used = Date.now()
    return a?.torrent
  }

  files(t: Torrent): TorrentFileInfo[] {
    return t.files.map((f, index) => ({ index, name: f.path, length: f.length }))
  }

  status(t: Torrent) {
    return {
      progress: t.progress,
      downloadSpeed: Math.round(t.downloadSpeed),
      uploadSpeed: Math.round(t.uploadSpeed),
      peers: t.numPeers,
    }
  }

  /** Serves one file with HTTP range support, so players can seek. */
  serve(t: Torrent, index: number, req: IncomingMessage, res: ServerResponse): void {
    const file = t.files[index]
    if (!file) {
      res.writeHead(404)
      res.end()
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const headers: Record<string, string | number> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    }
    let start = 0
    let end = file.length - 1
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1])
        if (range[2]) end = Math.min(Number(range[2]), end)
      } else {
        start = Math.max(0, file.length - Number(range[2]))
      }
      if (start > end || start >= file.length) {
        res.writeHead(416, { 'content-range': `bytes */${file.length}` })
        res.end()
        return
      }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${file.length}`, 'content-length': end - start + 1 })
    } else {
      res.writeHead(200, { ...headers, 'content-length': file.length })
    }
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    pipeline(file.createReadStream({ start, end }), res, () => {})
  }

  /** Reads a small file (subtitles) completely. */
  async text(t: Torrent, index: number): Promise<string> {
    const file = t.files[index]
    if (!file || file.length > 5_000_000) throw new Error('Soubor nejde načíst')
    const chunks: Buffer[] = []
    for await (const chunk of file.createReadStream()) chunks.push(Buffer.from(chunk as Buffer))
    const buf = Buffer.concat(chunks)
    // Czech subtitles are often Windows-1250; UTF-8 is tried first.
    const utf8 = buf.toString('utf8')
    return utf8.includes('�') ? new TextDecoder('windows-1250').decode(buf) : utf8
  }

  private evict(): void {
    while (this.active.size >= MAX_ACTIVE) {
      const [oldest] = [...this.active.entries()].sort((a, b) => a[1].used - b[1].used)
      this.remove(oldest[0])
    }
  }

  private sweep(): void {
    for (const [key, a] of this.active) if (Date.now() - a.used > IDLE_MS) this.remove(key)
  }

  private remove(key: string): void {
    const a = this.active.get(key)
    if (!a) return
    this.active.delete(key)
    a.torrent.destroy({ destroyStore: true })
    console.log(`[torrent] removed ${key}`)
  }

  close(): void {
    void this.client?.then((c) => c.destroy())
  }
}
