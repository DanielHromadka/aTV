import { describe, expect, it } from 'vitest'
import { detectLanguages, languageBadge, mainVideo, needsTranscode, normalizeLanguage, rankResults, shiftVtt, srtToVtt, subtitleFiles, type MediaResult } from './media.ts'

describe('languages', () => {
  it('reads languages from file names', () => {
    expect(detectLanguages('Muj.Film.2020.CZ.EN.1080p.mkv')).toEqual(['cs', 'en'])
    expect(detectLanguages('film [dabing].avi')).toEqual(['cs'])
    expect(detectLanguages('English')).toEqual(['en'])
    expect(detectLanguages('Film.2020.1080p.x264')).toEqual([])
  })

  it('maps stream tags', () => {
    expect(normalizeLanguage('cze')).toBe('cs')
    expect(normalizeLanguage('eng')).toBe('en')
    expect(normalizeLanguage('und')).toBeUndefined()
  })
})

describe('torrent files', () => {
  const files = [
    { index: 0, name: 'Film/sample.mkv', length: 50 },
    { index: 1, name: 'Film/Film.2020.mkv', length: 5000 },
    { index: 2, name: 'Film/Film.2020.cz.srt', length: 10 },
    { index: 3, name: 'Film/Film.2020.srt', length: 10 },
    { index: 4, name: 'Film/cover.jpg', length: 30 },
  ]

  it('picks the largest video that is not a sample', () => {
    expect(mainVideo(files)?.index).toBe(1)
  })

  it('lists subtitles with known languages first', () => {
    expect(subtitleFiles(files).map((s) => [s.index, s.lang])).toEqual([
      [2, 'cs'],
      [3, undefined],
    ])
  })
})

describe('srtToVtt', () => {
  it('converts times and adds the header', () => {
    const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nAhoj\r\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nAhoj\n')
  })
})

describe('rankResults', () => {
  const r = (id: string, title: string, extra: Partial<MediaResult> = {}): MediaResult => ({ id, source: 'archive', title, languages: [], subtitles: [], ...extra })

  it('ranks title matches first, then popularity', () => {
    const list = [
      r('a', 'Night of the Living Dead', { popularity: 900000 }),
      r('b', 'Nosferatu', { popularity: 1000 }),
      r('c', 'Nosferatu the Vampyre', { popularity: 50000 }),
    ]
    expect(rankResults('nosferatu', list).map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('never lets popularity push a sequel ahead of an exact title', () => {
    const list = [r('first', 'Iron Man', { seeders: 1 }), r('sequel', 'Iron Man 2', { seeders: 10000, popularity: 10000 })]
    expect(rankResults('iron man', list).map(x => x.id)).toEqual(['first', 'sequel'])
  })

  it('recognizes the same film across release metadata and prioritizes available seeds', () => {
    const list = [
      r('sequel', 'Iron.Man.2.2010.1080p.BluRay', { source: 'public', seeders: 10000 }),
      r('dead', 'Iron Man (2008) 1080p BRRip x264', { source: 'public', seeders: 0 }),
      r('live', 'Iron.Man.2008.PROPER.1080p.BluRay', { source: 'public', seeders: 12 }),
    ]
    expect(rankResults('iron man', list).map(x => x.id)).toEqual(['live', 'dead', 'sequel'])
    expect(rankResults('iron man 2008', list).map(x => x.id)).toEqual(['live', 'dead'])
  })

  it('does not treat years that belong to a title as release metadata', () => {
    expect(rankResults('blade runner 2049', [r('blade', 'Blade Runner 2049 (2017) 1080p')])[0].id).toBe('blade')
  })

  it('does not return unrelated own films when indexers have no matching results', () => {
    expect(rankResults('zahulime uvidime', [r('own', 'Sintel', { source: 'catalog' })])).toEqual([])
  })

  it('filters by language in audio or subtitles and by subtitles', () => {
    const list = [r('a', 'Film', { languages: ['en'] }), r('b', 'Film', { languages: ['en'], subtitles: ['cs'] }), r('c', 'Film', { languages: ['cs'] })]
    expect(rankResults('film', list, { lang: 'cs' }).map((x) => x.id).sort()).toEqual(['b', 'c'])
    expect(rankResults('film', list, { subtitles: true }).map((x) => x.id)).toEqual(['b'])
  })

  it('prefers the own catalog when everything else is equal', () => {
    const list = [r('a', 'Film'), r('b', 'Film', { source: 'catalog' })]
    expect(rankResults('film', list)[0].id).toBe('b')
  })
})

describe('shiftVtt', () => {
  it('moves cues earlier and drops the past ones', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:05.000 --> 00:00:07.000\nPryč\n\n2\n00:01:05.500 --> 00:01:07.000\nZůstane'
    expect(shiftVtt(vtt, 60)).toBe('WEBVTT\n\n2\n00:00:05.500 --> 00:00:07.000\nZůstane')
  })
})

describe('needsTranscode', () => {
  const probe = (video: string, audio: string) => ({ video: { codec: video }, audio: [{ index: 0, codec: audio }], embeddedSubtitles: [] })

  it('plays web-friendly files directly in the browser', () => {
    expect(needsTranscode('browser', 'a.mp4', probe('h264', 'aac'), 0)).toBe(false)
    expect(needsTranscode('browser', 'a.mkv', probe('h264', 'aac'), 0)).toBe(true)
    expect(needsTranscode('browser', 'a.mp4', probe('h264', 'ac3'), 0)).toBe(true)
  })

  it('lets TVs play MKV with their own decoders', () => {
    expect(needsTranscode('tizen', 'a.mkv', probe('hevc', 'ac3'), 0)).toBe(false)
    expect(needsTranscode('tizen', 'a.avi', probe('msmpeg4v3', 'mp3'), 0)).toBe(true)
  })

  it('transcodes for any audio track but the first', () => {
    expect(needsTranscode('tizen', 'a.mkv', probe('h264', 'aac'), 1)).toBe(true)
  })
})

describe('languageBadge', () => {
  it('lists audio and subtitle languages', () => {
    expect(languageBadge({ languages: ['cs', 'en'], subtitles: ['cs', 'und'] })).toBe('CS EN · titulky CS')
    expect(languageBadge({ languages: [], subtitles: ['und'] })).toBe('titulky')
    expect(languageBadge({ languages: [], subtitles: [] })).toBe('')
  })
})
