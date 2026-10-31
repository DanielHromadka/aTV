import { describe, expect, it } from 'vitest'
import { bytesPerSecond, contiguousBytes, libraryPaths, pieceRange, readyToPlay, releaseTitle, safeName } from './downloads.ts'

// A 1000-byte file starting at byte 250 of the torrent, 100-byte pieces (pieces 2–12).
const layout = { fileOffset: 250, fileLength: 1000, pieceLength: 100, pieceCount: 20 }

describe('pieceRange', () => {
  it('covers the window from the position', () => {
    expect(pieceRange(layout, 0, 100)).toEqual([2, 3])
    expect(pieceRange(layout, 400, 300)).toEqual([6, 9])
  })
  it('stays inside the file', () => {
    expect(pieceRange(layout, 900, 10_000)).toEqual([11, 12])
    expect(pieceRange(layout, 5000, 100)).toEqual([12, 12])
  })
})

describe('contiguousBytes', () => {
  it('counts downloaded bytes up to the first missing piece', () => {
    const have = new Set([2, 3, 4, 6])
    expect(contiguousBytes(layout, 0, (p) => have.has(p))).toBe(250) // pieces 2–4 end at byte 500 = file byte 250
    expect(contiguousBytes(layout, 260, (p) => have.has(p))).toBe(0) // piece 5 is missing
  })
  it('reaches the end of a complete file', () => {
    expect(contiguousBytes(layout, 100, () => true)).toBe(900)
  })
})

describe('readyToPlay', () => {
  const bps = bytesPerSecond(7_200_000_000, 7200) // 1 MB/s film
  it('waits for a minute ahead on a slow download', () => {
    expect(readyToPlay({ aheadSeconds: 30, downloadSpeed: 500_000, bytesPerSecond: bps, complete: false })).toBe(false)
    expect(readyToPlay({ aheadSeconds: 60, downloadSpeed: 500_000, bytesPerSecond: bps, complete: false })).toBe(true)
  })
  it('starts early when the download is clearly faster than the film', () => {
    expect(readyToPlay({ aheadSeconds: 20, downloadSpeed: 2_000_000, bytesPerSecond: bps, complete: false })).toBe(true)
    expect(readyToPlay({ aheadSeconds: 5, downloadSpeed: 2_000_000, bytesPerSecond: bps, complete: false })).toBe(false)
  })
  it('starts at once when the file is complete', () => {
    expect(readyToPlay({ aheadSeconds: 0, downloadSpeed: 0, bytesPerSecond: bps, complete: true })).toBe(true)
  })
})

describe('library paths', () => {
  it('names the folder and files the way Jellyfin expects', () => {
    expect(libraryPaths('Nosferatu', 1922, 'nosferatu.1922.MKV', [{ name: 'a.srt', lang: 'cs' }, { name: 'b.srt', lang: 'cs' }, { name: 'c.SRT' }])).toEqual({
      folder: 'Filmy/Nosferatu (1922)',
      video: 'Filmy/Nosferatu (1922)/Nosferatu (1922).mkv',
      subtitles: ['Filmy/Nosferatu (1922)/Nosferatu (1922).cs.srt', 'Filmy/Nosferatu (1922)/Nosferatu (1922).cs.2.srt', 'Filmy/Nosferatu (1922)/Nosferatu (1922).srt'],
    })
  })
  it('removes characters that are not allowed in file names', () => {
    expect(safeName('  AC/DC: Live?  ')).toBe('AC DC Live')
    expect(safeName('..')).toBe('Film')
  })
})

describe('releaseTitle', () => {
  it('cuts release tags after the year', () => {
    expect(releaseTitle('Just.Play.Dead.2026.1080p.WEBRip.x265')).toEqual({ title: 'Just Play Dead', year: 2026 })
    expect(releaseTitle('Nosferatu (1922) [Restored]')).toEqual({ title: 'Nosferatu', year: 1922 })
  })
  it('keeps a plain title and a known year', () => {
    expect(releaseTitle('O princezně, která ráčkovala', 1987)).toEqual({ title: 'O princezně, která ráčkovala', year: 1987 })
    expect(releaseTitle('Some Film 1080p WEB-DL')).toEqual({ title: 'Some Film', year: undefined })
  })
})
