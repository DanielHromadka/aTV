import { mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream'
import type { TorrentFileInfo } from '../shared/media.ts'
import { contiguousBytes, pieceRange, type PieceLayout } from '../shared/downloads.ts'

// The parts of WebTorrent we use (the package ships no types).
interface TFile {
  name: string
  path: string
  length: number
  /** Byte offset of the file inside the torrent. */
  offset: number
  done: boolean
  progress: number
  createReadStream(opts?: { start?: number; end?: number }): NodeJS.ReadableStream
  select(priority?: number): void
  deselect(): void
  once(event: 'done', cb: () => void): void
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
  /** Folder the torrent's files are written to. */
  path: string
  pieceLength: number
  pieces: unknown[]
  bitfield?: { get(index: number): boolean }
  critical(start: number, end: number): void
  /**
   * Internal, but the only way to a selection that is not merged with others: plain selections that
   * overlap are joined (WebTorrent 3.0), so a moving window inside a whole-file selection would vanish.
   * Stream selections stay separate and are removed exactly. Checked against webtorrent 3.0.21.
   */
  _select(start: number, end: number, priority: number, notify: null, isStreamSelection: true): void
  _deselect(start: number, end: number, isStreamSelection: true): void
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
/** Above a player's own read stream (1): the window ahead of the playhead comes first. */
const WINDOW_PRIORITY = 2
/** Pieces right at the playhead are asked from every peer at once. */
const CRITICAL_PIECES = 4
/** Only errors with messages safe to display to the client use this type. */
export class TorrentOpenError extends Error {}

/**
 * Torrents as streamable files. Nothing downloads until a file is played or downloaded. While a
 * film plays, the next ten minutes from the playhead download first (a window that follows the
 * playback), and the rest of the file fills in behind at low priority, so the player never waits
 * for pieces it will need soon even when it pauses its own reading. Torrents unused for two hours
 * are removed with their data, except those being downloaded to the library (pinned).
 */
export class Torrents {
  private client?: Promise<Client>
  private readonly active = new Map<string, { torrent: Torrent; used: number; window?: [number, number]; pinned?: boolean }>()
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

  layout(t: Torrent, index: number): PieceLayout | undefined {
    const file = t.files[index]
    if (!file) return undefined
    return { fileOffset: file.offset, fileLength: file.length, pieceLength: t.pieceLength, pieceCount: t.pieces.length }
  }

  /** Downloads `bytes` of the file from `position` first, replacing the previous window of this torrent. */
  prioritize(key: string, index: number, position: number, bytes: number): void {
    const a = this.active.get(key)
    const l = a && this.layout(a.torrent, index)
    if (!a || !l || !l.fileLength) return
    a.used = Date.now()
    const [from, to] = pieceRange(l, position, bytes)
    if (a.window?.[0] === from && a.window[1] === to) return
    if (a.window) a.torrent._deselect(a.window[0], a.window[1], true)
    a.torrent._select(from, to, WINDOW_PRIORITY, null, true)
    a.torrent.critical(from, Math.min(to, from + CRITICAL_PIECES - 1))
    a.window = [from, to]
  }

  /** Lets the whole file download behind the window (lowest priority, in order). */
  fill(t: Torrent, index: number): void {
    t.files[index]?.select(0)
  }

  /** Bytes downloaded without a gap from `position`. */
  ahead(t: Torrent, index: number, position: number): number {
    const l = this.layout(t, index)
    const bits = t.bitfield
    if (!l || !bits) return 0
    return contiguousBytes(l, position, (p) => bits.get(p))
  }

  /** Keeps a torrent (no eviction, no idle removal) while it downloads to the library. */
  pin(key: string, on: boolean): void {
    const a = this.active.get(key)
    if (a) a.pinned = on
  }

  /** Where the file is on disk (complete once `file.done`). */
  filePath(t: Torrent, index: number): string | undefined {
    const file = t.files[index]
    return file && join(t.path, file.path)
  }

  /** Forgets the torrent and deletes its data now. */
  drop(key: string): void {
    this.remove(key)
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
  serve(t: Torrent, index: number, req: IncomingMessage, res: ServerResponse, onRead?: (position: number) => void): void {
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
    const stream = file.createReadStream({ start, end })
    if (onRead) {
      // Report where the player reads, at most every two seconds, so the download window follows it.
      let position = start
      let reported = 0
      onRead(position)
      stream.on('data', (chunk: Buffer) => {
        position += chunk.length
        if (Date.now() - reported > 2000) {
          reported = Date.now()
          onRead(position)
        }
      })
    }
    pipeline(stream, res, () => {})
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
    // Library downloads are never evicted; with only those left, one more torrent may be open.
    const unpinned = () => [...this.active.entries()].filter(([, a]) => !a.pinned).sort((a, b) => a[1].used - b[1].used)
    while (this.active.size >= MAX_ACTIVE && unpinned().length) this.remove(unpinned()[0][0])
  }

  private sweep(): void {
    for (const [key, a] of this.active) if (!a.pinned && Date.now() - a.used > IDLE_MS) this.remove(key)
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
