import { describe, expect, it } from 'vitest'
import { backgroundName, imageType } from './backgrounds.ts'

describe('background photos', () => {
  it('recognises images by their first bytes', () => {
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg')
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(imageType(Buffer.from('<svg onload="x">'))).toBeNull()
  })

  it('makes a readable name', () => {
    expect(backgroundName('IMG_2041.jpeg')).toBe('IMG_2041')
    expect(backgroundName('')).toBe('Vlastní fotka')
    expect(backgroundName(undefined)).toBe('Vlastní fotka')
  })
})
