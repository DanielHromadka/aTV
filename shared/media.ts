import { matchScore, normalize } from './text.ts'

export const LANGUAGE_NAMES: Record<string, string> = {
  cs: 'Čeština',
  sk: 'Slovenština',
  en: 'Angličtina',
  de: 'Němčina',
  fr: 'Francouzština',
  es: 'Španělština',
  it: 'Italština',
  pl: 'Polština',
  ru: 'Ruština',
  ja: 'Japonština',
  nl: 'Nizozemština',
  pt: 'Portugalština',
  hu: 'Maďarština',
}

/** Tokens in file names and metadata that name a language (ISO 639-1/-2, English and Czech names). */
const LANGUAGE_TOKENS: Record<string, string> = {
  cz: 'cs', cs: 'cs', cze: 'cs', ces: 'cs', czech: 'cs', cesky: 'cs', cestina: 'cs', dabing: 'cs', cztit: 'cs',
  sk: 'sk', slk: 'sk', slo: 'sk', slovak: 'sk', slovensky: 'sk',
  en: 'en', eng: 'en', english: 'en', anglicky: 'en',
  de: 'de', ger: 'de', deu: 'de', german: 'de', deutsch: 'de',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  es: 'es', spa: 'es', spanish: 'es',
  it: 'it', ita: 'it', italian: 'it',
  pl: 'pl', pol: 'pl', polish: 'pl',
  ru: 'ru', rus: 'ru', russian: 'ru',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl',
  pt: 'pt', por: 'pt', portuguese: 'pt',
  hu: 'hu', hun: 'hu', hungarian: 'hu',
}

/** Languages named in a file name or a metadata value ("Film.2020.CZ.EN.1080p.mkv", "English"). */
export function detectLanguages(text: string): string[] {
  const out: string[] = []
  for (const token of normalize(text.replace(/[._\-[\]()]/g, ' ')).split(' ')) {
    const lang = LANGUAGE_TOKENS[token]
    if (lang && !out.includes(lang)) out.push(lang)
  }
  return out
}

/** A three-letter or full language from ffprobe/Matroska tags ("cze", "eng", "und") as ISO 639-1. */
export function normalizeLanguage(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  return LANGUAGE_TOKENS[normalize(tag)]
}

const VIDEO = /\.(mp4|m4v|mkv|webm|avi|mov|ts|mpg|mpeg|ogv|wmv)$/i
const SUBTITLE = /\.(srt|vtt|ass|ssa|sub)$/i
/** Containers and codecs a desktop browser plays without help (H.264/AAC MP4, WebM). */
const BROWSER_SAFE = /\.(mp4|m4v|webm)$/i

export const isVideo = (name: string) => VIDEO.test(name)
export const isSubtitle = (name: string) => SUBTITLE.test(name)
export const browserSafe = (name: string) => BROWSER_SAFE.test(name)

export interface TorrentFileInfo {
  index: number
  name: string
  length: number
}

/** The film itself: the largest video file that is not a sample or trailer. */
export function mainVideo(files: TorrentFileInfo[]): TorrentFileInfo | undefined {
  const videos = files.filter((f) => isVideo(f.name) && !/\b(sample|trailer|ukazka)\b/i.test(f.name))
  return (videos.length ? videos : files.filter((f) => isVideo(f.name))).sort((a, b) => b.length - a.length)[0]
}

export interface SubtitleFile extends TorrentFileInfo {
  lang?: string
}

/** Subtitle files with the language read from their names; unknown languages last. */
export function subtitleFiles(files: TorrentFileInfo[]): SubtitleFile[] {
  return files
    .filter((f) => isSubtitle(f.name) && /\.(srt|vtt)$/i.test(f.name))
    .map((f) => ({ ...f, lang: detectLanguages(f.name.replace(/\.[^.]+$/, '').split('/').pop() ?? '')[0] }))
    .sort((a, b) => (a.lang ? 0 : 1) - (b.lang ? 0 : 1))
}

/** SubRip to WebVTT: header, dots instead of commas in times, no cue numbers needed. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .trim()
  return `WEBVTT\n\n${body}\n`
}

/** One search hit, from the own catalog, Internet Archive or Jellyfin. */
export interface MediaResult {
  id: string
  source: 'catalog' | 'archive' | 'public'
  infoHash?: string
  indexName?: string
  size?: number
  seeders?: number
  title: string
  year?: number
  description?: string
  poster?: string
  /** Audio languages (ISO 639-1) as far as known. */
  languages: string[]
  /** Subtitle languages as far as known; "und" when subtitles exist in an unknown language. */
  subtitles: string[]
  /** Downloads or views, for popularity. */
  popularity?: number
  /** 0–5. */
  rating?: number
}

/** Compare the film name before release metadata, while retaining explicit years in queries. */
function titleRelevance(query: string, title: string): number {
  const readable = title.replace(/&amp;/gi, '&').replace(/[._]/g, ' ')
  const release = /[[(](?:19|20)\d{2}[)\]]|\b(?:19|20)\d{2}\s+(?:(?:480|720|1080|2160|4320)p|proper|unrated|repack|remastered|bluray|blu[ -]?ray|brrip|webrip|web[ -]?dl|hdtv|dvdrip|x26[45]|h26[45]|internal)\b|\b(?:(?:480|720|1080|2160|4320)p|webrip|brrip|bluray|blu[ -]?ray|web[ -]?dl|dvdrip|x26[45]|h26[45])\b/i.exec(readable)
  const core = release && release.index > 0 ? readable.slice(0, release.index).trim() : readable
  return Math.max(matchScore(query, core), matchScore(query, readable))
}

/** Relevance always wins over popularity. Among equally relevant releases, prefer available seeds. */
export function rankResults(query: string, results: MediaResult[], filter: { lang?: string; subtitles?: boolean } = {}): MediaResult[] {
  const scored = results.filter((r) => {
    if (filter.lang && !r.languages.includes(filter.lang) && !r.subtitles.includes(filter.lang)) return false
    if (filter.subtitles && !r.subtitles.length) return false
    return true
  }).map((r) => ({ r, relevance: query.trim() ? titleRelevance(query, r.title) : 0.5 }))
  const titled = scored.filter((s) => !query.trim() || s.relevance > 0)
  // Only Archive hits can legitimately match descriptions rather than the title. Never show an
  // unrelated own-catalog film merely because every external index returned no results.
  const hits = titled.length ? titled : scored.filter((s) => s.r.source === 'archive')
  return hits.sort((a, b) => {
    const relevance = b.relevance - a.relevance
    if (relevance) return relevance
    const available = Number(b.r.seeders !== 0) - Number(a.r.seeders !== 0)
    if (available) return available
    const own = Number(b.r.source === 'catalog') - Number(a.r.source === 'catalog')
    if (own) return own
    // Downloads/views and seed counts are different units; do not mix them in one score.
    const popularity = a.r.source === 'archive' && b.r.source === 'archive'
      ? (b.r.popularity ?? 0) - (a.r.popularity ?? 0)
      : (b.r.seeders ?? 0) - (a.r.seeders ?? 0)
    return popularity || (b.r.rating ?? 0) - (a.r.rating ?? 0) || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0)
  }).map((s) => s.r)
}

/**
 * Shifts WebVTT cues earlier by `seconds` (a transcoded stream that starts mid-film counts its
 * time from zero) and drops the cues that ended before the new start.
 */
export function shiftVtt(vtt: string, seconds: number): string {
  if (!seconds) return vtt
  const toSec = (t: string) => {
    const p = t.split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
  }
  const fmt = (s: number) => {
    const v = Math.max(0, s)
    const h = Math.floor(v / 3600)
    const m = Math.floor((v % 3600) / 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${(v % 60).toFixed(3).padStart(6, '0')}`
  }
  const [header, ...cues] = vtt.split(/\n\n+/)
  const kept = cues.flatMap((cue) => {
    const m = /((?:\d+:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d+:)?\d{2}:\d{2}\.\d{3})(.*)/.exec(cue)
    if (!m) return [cue]
    const end = toSec(m[2]) - seconds
    if (end <= 0) return []
    return [cue.replace(m[0], `${fmt(toSec(m[1]) - seconds)} --> ${fmt(end)}${m[3]}`)]
  })
  return [header, ...kept].join('\n\n')
}

/** What ffprobe found in a video: tracks to choose from, and the codecs that decide on transcoding. */
export interface Probe {
  duration?: number
  video?: { codec: string }
  audio: { index: number; lang?: string; codec: string; channels?: number; title?: string }[]
  /** Subtitles inside the container (shown as information; players get the external ones). */
  embeddedSubtitles: { lang?: string; codec: string }[]
}

const BROWSER_VIDEO = ['h264', 'vp8', 'vp9', 'av1']
const BROWSER_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac']
const TV_VIDEO = ['h264', 'hevc', 'mpeg4', 'vp9', 'mpeg2video']

/**
 * Whether the hub has to re-encode: always for another audio track than the first (players cannot
 * switch tracks reliably), in a desktop browser for anything but MP4/WebM with web codecs, and on
 * TVs (which take MKV, AVI, AC-3) only for video codecs they do not decode.
 */
export function needsTranscode(platform: string, fileName: string, probe: Probe | undefined, audioIndex: number): boolean {
  if (audioIndex > 0) return true
  const video = probe?.video?.codec
  const audio = probe?.audio[0]?.codec
  if (platform === 'browser') {
    if (!browserSafe(fileName)) return true
    return (!!video && !BROWSER_VIDEO.includes(video)) || (!!audio && !BROWSER_AUDIO.includes(audio))
  }
  return !!video && !TV_VIDEO.includes(video)
}

/** "CZ EN · titulky CZ" for result cards. */
export function languageBadge(r: Pick<MediaResult, 'languages' | 'subtitles'>): string {
  const audio = r.languages.map((l) => l.toUpperCase()).join(' ')
  const subs = r.subtitles.filter((l) => l !== 'und').map((l) => l.toUpperCase())
  const subText = r.subtitles.length ? `titulky${subs.length ? ` ${subs.join(' ')}` : ''}` : ''
  return [audio, subText].filter(Boolean).join(' · ')
}

/** Availability is separate from an empty, successful search. */
export interface SearchProvider {
  id: string
  name: string
  state: 'pending' | 'done' | 'error'
  count: number
}

export interface MediaSearch {
  results: MediaResult[]
  providers: SearchProvider[]
  pending: boolean
}
