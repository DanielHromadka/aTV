import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { libraryPaths, releaseTitle, type DownloadInfo, type DownloadState } from '../shared/downloads.ts'
import { isVideo, mainVideo, subtitleFiles } from '../shared/media.ts'
import type { Torrents } from './torrents.ts'

type Torrent = NonNullable<ReturnType<Torrents['get']>>

interface Entry {
  key: string
  /** The chosen video file; torrents often hold several versions of a film. */
  index?: number
  title: string
  year?: number
  /** Torrent source as resolved when the download started (Jackett links expire), Buffer as base64. */
  source: string
  sourceIsTorrentFile?: boolean
  state: DownloadState
  path?: string
  error?: string
  added: number
}

export interface DownloadHooks {
  /** Resolves a media key to its torrent source (magnet, URL or .torrent file). */
  resolve(key: string): Promise<string | Buffer>
  /** A film arrived in the library: refresh Jellyfin, tell the TVs. */
  done(title: string, path: string): void
}

/**
 * Downloads to the Jellyfin library: the whole film (and its subtitle files) downloads in the
 * background, then is copied to "<library>/Filmy/Název (rok)/" where Jellyfin finds it, and the
 * torrent data is deleted with the usual idle cleanup. The list survives hub restarts (data/downloads.json).
 */
export class Downloads {
  private readonly entries = new Map<string, Entry>()
  private readonly file: string
  private readonly libraryDir: string
  private readonly torrents: Torrents
  private readonly hooks: DownloadHooks
  private readonly running = new Set<string>()

  constructor(dataDir: string, libraryDir: string, torrents: Torrents, hooks: DownloadHooks) {
    this.file = join(dataDir, 'downloads.json')
    this.libraryDir = libraryDir
    this.torrents = torrents
    this.hooks = hooks
    try {
      for (const e of JSON.parse(readFileSync(this.file, 'utf8')) as Entry[]) this.entries.set(e.key, e)
    } catch {
      // No downloads yet.
    }
    // Unfinished downloads continue after a restart.
    for (const e of this.entries.values()) {
      if (e.state === 'downloading' || e.state === 'copying') void this.run(e)
    }
  }

  private async save(): Promise<void> {
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify([...this.entries.values()], null, 2))
    await rename(tmp, this.file)
  }

  /** Starts (or restarts after an error) downloading `key` into the library. */
  async start(key: string, title: string, year?: number, index?: number): Promise<DownloadInfo> {
    const known = this.entries.get(key)
    if (known && known.state !== 'error') return this.info(known)
    const source = await this.hooks.resolve(key)
    const clean = releaseTitle(title, year)
    const e: Entry = {
      key,
      index,
      title: clean.title,
      year: clean.year,
      source: Buffer.isBuffer(source) ? source.toString('base64') : source,
      sourceIsTorrentFile: Buffer.isBuffer(source),
      state: 'downloading',
      added: Date.now(),
    }
    this.entries.set(key, e)
    await this.save()
    void this.run(e)
    return this.info(e)
  }

  private async run(e: Entry): Promise<void> {
    if (this.running.has(e.key)) return
    this.running.add(e.key)
    try {
      const torrent = await this.torrents.open(e.key, e.sourceIsTorrentFile ? Buffer.from(e.source, 'base64') : e.source)
      this.torrents.pin(e.key, true)
      const files = this.torrents.files(torrent)
      const main = (e.index !== undefined ? files.find((f) => f.index === e.index) : undefined) ?? mainVideo(files)
      if (!main) throw new Error('Torrent neobsahuje žádný videosoubor.')
      const subs = subtitlesFor(main.name, subtitleFiles(files), files.filter((f) => isVideo(f.name)).length)
      // Everything needed downloads; a film playing at the same time still gets its window first.
      for (const f of [main, ...subs]) this.torrents.fill(torrent, f.index)
      await Promise.all([main, ...subs].map((f) => this.whenDone(e.key, torrent, f.index)))
      if (!this.entries.has(e.key)) return

      e.state = 'copying'
      await this.save()
      const paths = libraryPaths(e.title, e.year, main.name, subs.map((s) => ({ name: s.name, lang: s.lang })))
      await mkdir(join(this.libraryDir, paths.folder), { recursive: true })
      await copyInto(this.torrents.filePath(torrent, main.index)!, join(this.libraryDir, paths.video))
      for (const [i, s] of subs.entries()) await copyInto(this.torrents.filePath(torrent, s.index)!, join(this.libraryDir, paths.subtitles[i]))

      e.state = 'done'
      e.path = paths.video
      e.error = undefined
      await this.save()
      // The torrent data goes with the usual idle cleanup, so a film playing right now keeps playing.
      this.torrents.pin(e.key, false)
      console.log(`[download] ${e.title} → ${paths.video}`)
      this.hooks.done(e.year ? `${e.title} (${e.year})` : e.title, paths.video)
    } catch (err) {
      if (!this.entries.has(e.key)) return
      e.state = 'error'
      e.error = (err as Error).message || 'Stažení se nepodařilo.'
      this.torrents.pin(e.key, false)
      await this.save()
      console.warn(`[download] ${e.title}: ${e.error}`)
    } finally {
      this.running.delete(e.key)
    }
  }

  /** Resolves when the file is complete; a cancelled download ends the wait with an error. */
  private whenDone(key: string, t: Torrent, index: number): Promise<void> {
    const file = t.files[index]
    return new Promise((resolve, reject) => {
      if (file.done) return resolve()
      const check = setInterval(() => {
        if (file.done) {
          clearInterval(check)
          resolve()
        } else if (!this.entries.has(key)) {
          clearInterval(check)
          reject(new Error('Stahování bylo zrušeno.'))
        }
      }, 2000)
      file.once('done', () => {
        clearInterval(check)
        resolve()
      })
    })
  }

  /** Stops a download and deletes its partial data (a finished film stays in the library). */
  async cancel(key: string): Promise<boolean> {
    const e = this.entries.get(key)
    if (!e) return false
    this.entries.delete(key)
    if (e.state !== 'done') this.torrents.drop(key)
    await this.save()
    return true
  }

  get(key: string): DownloadInfo | undefined {
    const e = this.entries.get(key)
    return e && this.info(e)
  }

  list(): DownloadInfo[] {
    return [...this.entries.values()].sort((a, b) => b.added - a.added).map((e) => this.info(e))
  }

  private info(e: Entry): DownloadInfo {
    const t = e.state === 'downloading' ? this.torrents.get(e.key) : undefined
    const files = t ? this.torrents.files(t) : []
    const main = (e.index !== undefined ? files.find((f) => f.index === e.index) : undefined) ?? mainVideo(files)
    const progress = e.state === 'done' || e.state === 'copying' ? 1 : t && main ? t.files[main.index].progress : 0
    return {
      key: e.key,
      title: e.year ? `${e.title} (${e.year})` : e.title,
      state: e.state,
      progress,
      downloadSpeed: t ? Math.round(t.downloadSpeed) : 0,
      peers: t?.numPeers ?? 0,
      path: e.path,
      error: e.error,
    }
  }
}

/**
 * Subtitles that belong to the video: files named like it ("Film.srt", "Film.cs.srt"). Only a torrent
 * with a single video may also bring a small set named differently (a "Subs" folder); with several
 * videos (other cuts, other films) differently named subtitles may not match this one's timing.
 */
export function subtitlesFor<T extends { name: string }>(video: string, subs: T[], videoCount: number): T[] {
  const stem = (n: string) => (n.split('/').pop() ?? n).replace(/\.[^.]+$/, '').toLowerCase()
  const base = stem(video)
  const named = subs.filter((s) => stem(s.name).startsWith(base))
  if (named.length) return named
  return videoCount === 1 && subs.length <= 6 ? subs : []
}

/** Copies through a temporary name, so Jellyfin never picks up a half-written file. */
async function copyInto(from: string, to: string): Promise<void> {
  const tmp = join(dirname(to), `.${Date.now()}.part`)
  await copyFile(from, tmp)
  await rename(tmp, to)
}

