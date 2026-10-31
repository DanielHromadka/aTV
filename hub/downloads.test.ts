import { describe, expect, it } from 'vitest'
import { subtitlesFor } from './downloads.ts'

const s = (name: string) => ({ name })

describe('subtitlesFor', () => {
  it('takes subtitles named like the video', () => {
    expect(subtitlesFor('Film/Movie.2020.mkv', [s('Film/Movie.2020.cs.srt'), s('Film/Other.srt')], 2)).toEqual([s('Film/Movie.2020.cs.srt')])
  })
  it('takes a small Subs folder only when the torrent has one video', () => {
    expect(subtitlesFor('Film/Movie.mkv', [s('Subs/Czech.srt'), s('Subs/English.srt')], 1)).toHaveLength(2)
    expect(subtitlesFor('Film/Movie_small.mp4', [s('Film/MOVIE_ONLY.asr.srt')], 17)).toEqual([])
  })
})
