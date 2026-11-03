import { describe, expect, it } from 'vitest'
import type { MediaResult } from './media.ts'
import { filterFilms, groupFilms, parseRelease, sortFilms } from './release.ts'

describe('release names', () => {
  it('reads the film name, year and quality', () => {
    expect(parseRelease('Matrix (1999) WEBRip 1080p HEVC AAC ITA ENG')).toEqual({ name: 'Matrix', year: 1999, quality: 'Full HD', hdr: false })
    expect(parseRelease('The.Matrix.Resurrections.2021.2160p.HDR.WEB-DL.mkv')).toEqual({ name: 'The Matrix Resurrections', year: 2021, quality: '4K', hdr: true })
    expect(parseRelease('Matrix.1080p.Multi.Subs.AAC.x265 DLKING.mkv')).toMatchObject({ name: 'Matrix', year: undefined, quality: 'Full HD' })
    expect(parseRelease('2001 A Space Odyssey 1968 720p')).toMatchObject({ name: '2001 A Space Odyssey', year: 1968, quality: 'HD' })
    expect(parseRelease('Matrix - The Matrix (1999) [3D.1080p.IMAX]')).toMatchObject({ name: 'Matrix', year: 1999 })
    expect(parseRelease('Mission Impossible - Fallout 2018 1080p')).toMatchObject({ name: 'Mission Impossible - Fallout' })
    expect(parseRelease('Matrix Generation (2023) 1080p WEBRip-WORLD')).toMatchObject({ name: 'Matrix Generation', year: 2023 })
  })
})

describe('films', () => {
  const r = (id: string, title: string, seeders?: number, extra: Partial<MediaResult> = {}): MediaResult =>
    ({ id, title, seeders, source: 'public', languages: [], subtitles: [], ...extra })

  it('groups releases of one film, most seeded first', () => {
    const films = groupFilms([
      r('a', 'Matrix (1999) WEBRip 1080p', 53),
      r('b', 'Matrix.1080p.Multi.Subs.mkv', 3),
      r('c', 'Matrix Revolutions (2003) 1080p', 104),
      r('d', 'The.Matrix.1999.2160p.UHD', 80),
      r('e', 'Matrix 1999 720p', 90),
    ])
    expect(films.map((f) => f.name)).toEqual(['Matrix', 'Matrix Revolutions', 'The Matrix'])
    expect(films[0].releases.map((x) => x.id)).toEqual(['e', 'a', 'b'])
    expect(films[0].quality).toBe('Full HD')
    expect(films[2].quality).toBe('4K')
  })

  it('keeps archive titles as they are', () => {
    const [film] = groupFilms([r('ia:x', 'His Girl Friday', undefined, { source: 'archive', year: 1940, poster: 'p.jpg' })])
    expect(film).toMatchObject({ name: 'His Girl Friday', year: 1940, poster: 'p.jpg' })
  })
})

describe('filters and order', () => {
  const r = (id: string, title: string, seeders?: number): MediaResult => ({ id, title, seeders, source: 'public', languages: [], subtitles: [] })
  const films = groupFilms([
    r('a', 'Alfa 2001 720p', 5), r('b', 'Alfa 2001 2160p', 0),
    r('c', 'Beta 1975 1080p', 40), r('d', 'Gama 2020 1080p', 12), r('e', 'Delta 1080p', 1),
  ])

  it('keeps only matching releases and films', () => {
    const fourK = filterFilms(films, { quality: '4K' })
    expect(fourK.map((f) => [f.name, f.releases.map((x) => x.id)])).toEqual([['Alfa', ['b']]])
    expect(filterFilms(films, { quality: '4K', available: true })).toEqual([])
    expect(filterFilms(films, { from: 2000, to: 2009 }).map((f) => f.name)).toEqual(['Alfa'])
    expect(filterFilms(films, { to: 1979 }).map((f) => f.name)).toEqual(['Beta'])
  })

  it('sorts by sources, year, rating and name', () => {
    expect(sortFilms(films, 'seeders').map((f) => f.name)).toEqual(['Beta', 'Gama', 'Alfa', 'Delta'])
    expect(sortFilms(films, 'newest').map((f) => f.name)).toEqual(['Gama', 'Alfa', 'Beta', 'Delta'])
    expect(sortFilms(films, 'oldest').map((f) => f.name)).toEqual(['Beta', 'Alfa', 'Gama', 'Delta'])
    expect(sortFilms(films, 'rating', (f) => ({ Gama: 8, Beta: 6 })[f.name]).map((f) => f.name)).toEqual(['Gama', 'Beta', 'Alfa', 'Delta'])
    expect(sortFilms(films, 'name').map((f) => f.name)).toEqual(['Alfa', 'Beta', 'Delta', 'Gama'])
    expect(sortFilms(films, 'relevance')).toBe(films)
  })
})
