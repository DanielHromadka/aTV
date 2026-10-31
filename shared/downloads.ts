/** Torrent prioritisation and library downloads: pure helpers shared by the hub and the TV. */

/** How much of the film ahead of the playhead downloads first. */
export const AHEAD_SECONDS = 600
/** Before playback starts, this much should be downloaded ahead (unless the download is clearly fast enough). */
export const START_BUFFER_SECONDS = 60

export interface PieceLayout {
  /** Byte offset of the file inside the torrent. */
  fileOffset: number
  fileLength: number
  pieceLength: number
  pieceCount: number
}

/** Pieces [from, to] covering `bytes` of the file from `position` (clamped to the file). */
export function pieceRange(l: PieceLayout, position: number, bytes: number): [number, number] {
  const start = l.fileOffset + Math.max(0, Math.min(position, l.fileLength - 1))
  const end = l.fileOffset + Math.min(l.fileLength, Math.max(position, 0) + Math.max(bytes, 1)) - 1
  const last = Math.min(l.pieceCount - 1, Math.floor((l.fileOffset + l.fileLength - 1) / l.pieceLength))
  return [Math.min(Math.floor(start / l.pieceLength), last), Math.min(Math.floor(end / l.pieceLength), last)]
}

/** Bytes of the file already downloaded without a gap from `position` on. */
export function contiguousBytes(l: PieceLayout, position: number, has: (piece: number) => boolean): number {
  const [first, last] = pieceRange(l, position, l.fileLength)
  let piece = first
  while (piece <= last && has(piece)) piece++
  const until = Math.min(l.fileOffset + l.fileLength, piece * l.pieceLength)
  return Math.max(0, until - (l.fileOffset + position))
}

/** Bytes per second of the film, from its size and length; a 2-hour film when the length is unknown. */
export function bytesPerSecond(fileLength: number, duration?: number): number {
  return fileLength / (duration && duration > 0 ? duration : 7200)
}

/**
 * Whether playback can start without stalling soon: enough is downloaded ahead, the whole file is
 * there, or the download runs clearly faster than the film plays (with a little head start).
 */
export function readyToPlay(s: { aheadSeconds: number; downloadSpeed: number; bytesPerSecond: number; complete: boolean }): boolean {
  if (s.complete || s.aheadSeconds >= START_BUFFER_SECONDS) return true
  return s.aheadSeconds >= 15 && s.downloadSpeed >= s.bytesPerSecond * 1.5
}

/** A name safe as a folder or file on every system Jellyfin runs on. */
export function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120) || 'Film'
}

/** Where a downloaded film goes in the library: "Filmy/Název (rok)/Název (rok).mkv", subtitles beside it. */
export function libraryPaths(title: string, year: number | undefined, videoName: string, subtitles: { name: string; lang?: string }[]) {
  const base = safeName(year ? `${title} (${year})` : title)
  const ext = (name: string) => (/\.[a-z0-9]{2,4}$/i.exec(name)?.[0] ?? '').toLowerCase()
  const used = new Set<string>()
  return {
    folder: `Filmy/${base}`,
    video: `Filmy/${base}/${base}${ext(videoName)}`,
    subtitles: subtitles.map((s) => {
      // Jellyfin reads the language from "Name.cs.srt"; a second file in the same language gets a number.
      let name = `${base}${s.lang ? `.${s.lang}` : ''}`
      for (let n = 2; used.has(name + ext(s.name)); n++) name = `${base}${s.lang ? `.${s.lang}` : ''}.${n}`
      used.add(name + ext(s.name))
      return `Filmy/${base}/${name}${ext(s.name)}`
    }),
  }
}

export type DownloadState = 'downloading' | 'copying' | 'done' | 'error'

export interface DownloadInfo {
  key: string
  title: string
  state: DownloadState
  progress: number
  downloadSpeed: number
  peers: number
  /** Library path of the video once copied. */
  path?: string
  error?: string
}

/** "Movie.Name.2020.1080p.WEB-DL" → { title: "Movie Name", year: 2020 }; plain titles pass through. */
export function releaseTitle(name: string, year?: number): { title: string; year?: number } {
  const plain = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  const m = /^(.+?)[\s([]+((?:19|20)\d{2})(?:[\s)\]]|$)/.exec(plain)
  if (m && m[1].trim().length >= 1) return { title: m[1].replace(/[\s\-–([]+$/, '').trim(), year: year ?? Number(m[2]) }
  // No year: cut at the first technical tag.
  const tag = /\s(?:2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|bluray|brrip|hdrip|dvdrip|x26[45]|h\.?26[45]|hevc|xvid)\b/i.exec(plain)
  return { title: (tag ? plain.slice(0, tag.index) : plain).trim() || plain, year }
}
