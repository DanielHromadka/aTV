import { audioTracks, isAudio } from '../shared/audio.ts'
import { AudioCovers } from './audio-covers.ts'
import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  detectLanguages,
  isVideo,
  mainVideo,
  normalizeLanguage,
  rankResults,
  shiftVtt,
  srtToVtt,
  subtitleFiles,
  type MediaResult,
  type MediaSearch,
  type Probe,
  type TorrentFileInfo,
} from '../shared/media.ts'
import { ARCHIVE_ID, archiveTorrentUrl, popularArchive, searchArchive } from './archive.ts'
import { publicMagnet, publicIndexJobs } from './public-indexes.ts'
import { Searches } from './search.ts'
import type { Jackett } from './jackett.ts'
import type { Catalog } from './catalog.ts'
import { TorrentOpenError, type Torrents } from './torrents.ts'

export interface MediaDetails {
  key: string
  title: string
  videos: TorrentFileInfo[]
  main?: number
  subtitles: { index: number; name: string; lang?: string }[]
  probe?: Probe
  probing: boolean
  probeError?: string
  status: { progress: number; downloadSpeed: number; uploadSpeed: number; peers: number }
}

interface Context {
  json(res: ServerResponse, code: number, body: unknown): void
  readJson(req: IncomingMessage): Promise<Record<string, unknown>>
  /** Whether the request carries a paired phone's token (needed to change the catalog). */
  isRemote(req: IncomingMessage): boolean
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
    p.stdout.on('data', (d: Buffer) => (out += d))
    p.stderr.on('data', (d: Buffer) => (err += d))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim().split('\n').pop() || `${cmd} skončil s kódem ${code}`))
    })
  })
}

export class Media {
  private readonly probes = new Map<string, Probe>()
  private readonly probing = new Set<string>()
  private readonly probeFailures = new Map<string, number>()
  private readonly catalog: Catalog
  private readonly torrents: Torrents
  private readonly selfUrl: string
  private readonly jackett?: Jackett
  private readonly searches: Searches
  private readonly sourceSearches = new Map<string, Searches>()
  private readonly covers = new AudioCovers()

  constructor(catalog: Catalog, torrents: Torrents, port: number, jackett?: Jackett) {
    this.jackett = jackett
    this.searches = new Searches((q) => [
      ...(jackett?.jobs(q) ?? []),
      { id: 'archive', name: 'Internet Archive', run: () => searchArchive(q) },
      ...(jackett ? [] : publicIndexJobs(q)),
    ])
    this.catalog = catalog
    this.torrents = torrents
    this.selfUrl = `http://127.0.0.1:${port}`
  }

  private source(key: string): string {
    const jackettSource = this.jackett?.source(key)
    if (jackettSource) return jackettSource
    if (key.startsWith('jk:')) throw new Error('Výsledek z Jackettu vypršel; vyhledejte film znovu')
    const magnet = publicMagnet(key)
    if (magnet) return magnet
    if (key.startsWith('ia:')) {
      const id = key.slice(3)
      if (!ARCHIVE_ID.test(id)) throw new Error('Neplatné id')
      return archiveTorrentUrl(id)
    }
    const entry = this.catalog.get(key)
    if (!entry) throw new Error('Film v katalogu není')
    return entry.source
  }

  private fileUrl(key: string, index: number): string {
    return `${this.selfUrl}/api/media/${encodeURIComponent(key)}/files/${index}`
  }

  async search(q: string, filter: { lang?: string; subtitles?: boolean }): Promise<MediaResult[]> {
    return this.rank(q, await this.searches.complete(q), filter)
  }

  searchProgress(q: string, filter: { lang?: string; subtitles?: boolean }): MediaSearch {
    const { groups, providers } = this.searches.snapshot(q)
    return { results: this.rank(q, groups, filter), providers, pending: providers.some((p) => p.state === 'pending') }
  }

  private rank(q: string, groups: MediaResult[][], filter: { lang?: string; subtitles?: boolean }): MediaResult[] {
    const unique = new Map<string, MediaResult>()
    // Jobs are ordered with Jackett first so private announce URLs survive deduplication.
    for (const r of groups.flat()) {
      const hash = r.infoHash ?? (r.id.startsWith('bt:') ? r.id.slice(3) : r.id)
      if (!unique.has(hash)) unique.set(hash, r)
    }
    return rankResults(q, [...this.catalog.results(), ...unique.values()], filter).slice(0, 40)
  }

  async browse(): Promise<{ catalog: MediaResult[]; archive: MediaResult[] }> {
    return { catalog: this.catalog.results(), archive: await popularArchive().catch(() => []) }
  }

  /** Opens the torrent, finds the film and its subtitles, and reads its tracks with ffprobe. */
  async details(key: string): Promise<MediaDetails> {
    const source = this.source(key)
    const torrent = this.torrents.get(key) ?? await this.torrents.open(key,
      key.startsWith('jk:') && this.jackett ? await this.jackett.resolveSource(key) : source)
    const files = this.torrents.files(torrent)
    const main = mainVideo(files)
    const subtitles = subtitleFiles(files).map((s) => ({ index: s.index, name: s.name.split('/').pop() ?? s.name, lang: s.lang }))
    const probeKey = main ? `${key}/${main.index}` : ''
    const probe = this.probes.get(probeKey)
    const failedAt = this.probeFailures.get(probeKey)
    // Metadata is useful even when no peer has the video. Never block the detail on ffprobe.
    if (main && !probe && !this.probing.has(probeKey) && (!failedAt || Date.now() - failedAt > 30_000)
      && (torrent.numPeers > 0 || torrent.progress > 0)) {
      this.probing.add(probeKey)
      void this.probe(key, main.index).then((found) => {
        this.probes.set(probeKey, found)
        this.probeFailures.delete(probeKey)
      }, () => {
        this.probeFailures.set(probeKey, Date.now())
        console.warn('[ffprobe] Analýza videa není dostupná')
      }).finally(() => this.probing.delete(probeKey))
    }
    const entry = this.catalog.get(key)
    if (entry) {
      // Remember what the torrent contains, so search can filter by language next time.
      const languages = [...new Set([...(probe?.audio.map((a) => a.lang).filter((l): l is string => !!l) ?? []), ...detectLanguages(main?.name ?? '')])]
      const subs = [...new Set([...subtitles.map((s) => s.lang ?? 'und'), ...(probe?.embeddedSubtitles.map((s) => s.lang ?? 'und') ?? [])])]
      this.catalog.update(key, { languages, subtitles: subs })
    }
    return {
      key,
      title: entry?.title ?? this.jackett?.title(key) ?? torrent.name,
      videos: files.filter((f) => isVideo(f.name)),
      main: main?.index,
      subtitles,
      probe,
      probing: this.probing.has(probeKey),
      probeError: failedAt ? 'Zvukové stopy se zatím nepodařilo načíst; čekám na dostupná data.' : undefined,
      status: this.torrents.status(torrent),
    }
  }

  private async probe(key: string, index: number): Promise<Probe> {
    const out = await run('ffprobe', ['-v', 'error', '-rw_timeout', '10000000', '-print_format', 'json', '-show_streams', '-show_format', this.fileUrl(key, index)], 15_000)
    const data = JSON.parse(out) as {
      format?: { duration?: string }
      streams?: { codec_type: string; codec_name: string; channels?: number; tags?: { language?: string; title?: string } }[]
    }
    const streams = data.streams ?? []
    let audioIndex = 0
    return {
      duration: Number(data.format?.duration) || undefined,
      video: streams.find((s) => s.codec_type === 'video') ? { codec: streams.find((s) => s.codec_type === 'video')!.codec_name } : undefined,
      audio: streams
        .filter((s) => s.codec_type === 'audio')
        .map((s) => ({ index: audioIndex++, lang: normalizeLanguage(s.tags?.language), codec: s.codec_name, channels: s.channels, title: s.tags?.title })),
      embeddedSubtitles: streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({ lang: normalizeLanguage(s.tags?.language), codec: s.codec_name })),
    }
  }

  /**
   * Re-encodes on the fly for players that cannot take the file (a desktop browser and MKV, or a
   * chosen audio track): fragmented MP4, H.264 copied when it already is H.264, audio to stereo AAC.
   * Seeking restarts the stream at `t` seconds.
   */
  private transcode(key: string, index: number, audio: number, t: number, req: IncomingMessage, res: ServerResponse): void {
    const probe = this.probes.get(`${key}/${index}`)
    const copyVideo = probe?.video?.codec === 'h264'
    const torrent = this.torrents.get(key)
    const onlyAudio = !!torrent && isAudio(this.torrents.files(torrent).find(f => f.index === index)?.name ?? '')
    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...(t > 0 ? ['-ss', String(t)] : []),
      '-i', this.fileUrl(key, index),
      ...(onlyAudio ? ['-vn', '-map', '0:a:0'] : ['-map', '0:v:0', '-map', `0:a:${audio}?`]),
      ...(onlyAudio ? [] : copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']),
      '-c:a', onlyAudio ? 'libmp3lame' : 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k', '-sn',
      ...(onlyAudio ? [] : ['-movflags', 'frag_keyframe+empty_moov+default_base_moof']),
      '-f', onlyAudio ? 'mp3' : 'mp4', 'pipe:1',
    ]
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    ff.stderr.on('data', (d: Buffer) => console.warn('[ffmpeg]', String(d).trim()))
    ff.on('error', (e) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(`ffmpeg: ${e.message}`)
    })
    res.writeHead(200, { 'content-type': onlyAudio ? 'audio/mpeg' : 'video/mp4', 'cache-control': 'no-store' })
    ff.stdout.pipe(res)
    // The player went away (seek, Back): stop encoding.
    req.on('close', () => ff.kill('SIGKILL'))
  }

  /** Handles /api/media/* and /api/catalog*; returns false for other paths. */
  async route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Context): Promise<boolean> {
    const path = url.pathname

    if (path === '/api/catalog' && req.method === 'GET') {
      ctx.json(res, 200, this.catalog.list())
      return true
    }
    if (path === '/api/catalog' && req.method === 'POST') {
      if (!ctx.isRemote(req)) {
      ctx.json(res, 401, { error: 'Jen ze spárovaného telefonu' })
      return true
    }
      const body = await ctx.readJson(req)
      try {
        const entry = this.catalog.add({
          source: String(body.source ?? '').trim(),
          title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
          year: typeof body.year === 'number' ? body.year : undefined,
        })
        // Read the file list in the background, so languages and subtitles show up in search.
        this.details(entry.id).catch((e: Error) => console.warn('[catalog]', e.message))
        ctx.json(res, 200, entry)
      } catch (e) {
        ctx.json(res, 400, { error: (e as Error).message })
      }
      return true
    }
    const del = /^\/api\/catalog\/([0-9a-f]{12})$/.exec(path)
    if (del && req.method === 'DELETE') {
      if (!ctx.isRemote(req)) {
      ctx.json(res, 401, { error: 'Jen ze spárovaného telefonu' })
      return true
    }
      ctx.json(res, this.catalog.remove(del[1]) ? 200 : 404, { ok: true })
      return true
    }

    if (path === '/api/audio/search' || path === '/api/sources/search') {
      const kind = path === '/api/audio/search' ? 'audio' : 'video'
      const selected = url.searchParams.get('indexer') || undefined
      if (selected && !/^[a-z0-9-]{1,80}$/.test(selected)) { ctx.json(res, 400, { error: 'Neplatný zdroj' }); return true }
      const sessionKey = `${kind}:${selected ?? 'all'}`
      let searches = this.sourceSearches.get(sessionKey)
      if (!searches) {
        if (this.sourceSearches.size >= 50) this.sourceSearches.delete(this.sourceSearches.keys().next().value!)
        searches = new Searches(q => this.jackett?.jobs(q, kind, selected) ?? [])
        this.sourceSearches.set(sessionKey, searches)
      }
      const { groups, providers } = searches.snapshot(url.searchParams.get('q') ?? '')
      ctx.json(res, 200, { results: groups.flat().sort((a,b) => (b.seeders ?? 0) - (a.seeders ?? 0)), providers, pending: providers.some(p => p.state === 'pending') })
      return true
    }
    if (path === '/api/audio/cover') {
      ctx.json(res, 200, { cover: await this.covers.find(url.searchParams.get('q') ?? '') })
      return true
    }
    const audioDetail = /^\/api\/audio\/([^/]+)$/.exec(path)
    if (audioDetail) {
      try {
        const key = decodeURIComponent(audioDetail[1])
        const source = this.source(key)
        const torrent = this.torrents.get(key) ?? await this.torrents.open(key,
          key.startsWith('jk:') && this.jackett ? await this.jackett.resolveSource(key) : source)
        const files = this.torrents.files(torrent)
        const cover = files.find(f => /(?:^|\/)(?:cover|folder|front)\.(?:jpg|jpeg|png)$/i.test(f.name) && f.length < 5_000_000)
        ctx.json(res, 200, { key, title: this.jackett?.title(key) ?? torrent.name, tracks: audioTracks(files),
          cover: cover ? `/api/media/${encodeURIComponent(key)}/files/${cover.index}` : undefined, peers: torrent.numPeers })
      } catch (e) { ctx.json(res, 502, { error: e instanceof TorrentOpenError ? e.message : 'Audio se nepodařilo otevřít. Zkuste jiný zdroj.' }) }
      return true
    }
    if (path === '/api/media/providers') {
      ctx.json(res, 200, { mode: this.jackett ? 'jackett' : 'public', indexers: await this.jackett?.configuredIndexers() ?? [] })
      return true
    }
    if (path === '/api/media/search') {
      const lang = url.searchParams.get('lang') || undefined
      const q = url.searchParams.get('q') ?? ''
      const filter = { lang, subtitles: url.searchParams.get('subs') === '1' }
      ctx.json(res, 200, url.searchParams.get('progressive') === '1' ? this.searchProgress(q, filter) : await this.search(q, filter))
      return true
    }
    if (path === '/api/media/browse') {
      ctx.json(res, 200, await this.browse())
      return true
    }

    const m = /^\/api\/media\/([^/]+)(?:\/(status|poster|files\/(\d+)(?:\/(play|vtt))?))?$/.exec(path)
    if (!m) return false
    let key: string
    try {
      key = decodeURIComponent(m[1])
      this.source(key)
    } catch (e) {
      ctx.json(res, 404, { error: (e as Error).message })
      return true
    }
    if (!m[2]) {
      try {
        ctx.json(res, 200, await this.details(key))
      } catch (e) {
        ctx.json(res, 502, { error: e instanceof TorrentOpenError ? e.message : key.startsWith('jk:') ? 'Torrent se nepodařilo otevřít. Zkuste to znovu nebo vyberte jinou verzi filmu.' : (e as Error).message })
      }
      return true
    }
    if (m[2] === 'poster') {
      try {
        const image = await this.jackett?.image(key)
        if (!image) ctx.json(res, 404, { error: 'Plakát není dostupný' })
        else {
          res.writeHead(200, { 'content-type': image.type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
          res.end(image.body)
        }
      } catch {
        ctx.json(res, 502, { error: 'Plakát se nepodařilo načíst' })
      }
      return true
    }
    const torrent = this.torrents.get(key)
    if (!torrent) {
      ctx.json(res, 409, { error: 'Torrent není otevřený' })
      return true
    }
    if (m[2] === 'status') {
      ctx.json(res, 200, this.torrents.status(torrent))
      return true
    }

    const index = Number(m[3])
    if (!m[4]) {
      this.torrents.serve(torrent, index, req, res)
    } else if (m[4] === 'play') {
      const audio = Math.max(0, Math.min(20, Number(url.searchParams.get('audio')) || 0))
      const t = Math.max(0, Number(url.searchParams.get('t')) || 0)
      this.transcode(key, index, audio, t, req, res)
    } else {
      try {
        const text = await this.torrents.text(torrent, index)
        const vtt = /^WEBVTT/.test(text.replace(/^﻿/, '')) ? text : srtToVtt(text)
        res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' })
        res.end(shiftVtt(vtt, Math.max(0, Number(url.searchParams.get('shift')) || 0)))
      } catch (e) {
        ctx.json(res, 500, { error: (e as Error).message })
      }
    }
    return true
  }
}
