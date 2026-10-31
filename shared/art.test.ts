import { expect, it } from 'vitest'
import { galleryNext, GALLERY_INTERVALS } from './art.ts'
it('wraps art navigation in both directions and handles empty or single-item galleries',()=>{
 expect(galleryNext(2,3)).toBe(0);expect(galleryNext(0,3,-1)).toBe(2);expect(galleryNext(0,1)).toBe(0);expect(galleryNext(5,0)).toBe(0)
})
it('offers timed display and an explicit indefinite display',()=>{expect(GALLERY_INTERVALS).toContain(0);expect(GALLERY_INTERVALS).toContain(3600);expect(GALLERY_INTERVALS.every(n=>Number.isInteger(n)&&n>=0)).toBe(true)})
