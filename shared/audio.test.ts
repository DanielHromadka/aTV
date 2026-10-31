import { expect, it } from 'vitest'
import { audioCategory, audioTracks, isAudio } from './audio.ts'
it('keeps audio chapters in natural order and excludes videos and artwork', () => {
  const names = ['Chapter 10.mp3', 'cover.jpg', 'Chapter 2.m4b', 'movie.mp4', 'Chapter 1.FLAC']
  expect(audioTracks(names.map((name,index)=>({name,index,length:100}))).map(f=>f.name)).toEqual(['Chapter 1.FLAC','Chapter 2.m4b','Chapter 10.mp3'])
  expect(isAudio('audio.mp3.exe')).toBe(false)
  expect([2000,3000,3030,3999,4000,6000].filter(audioCategory)).toEqual([3000,3030,3999])
})
