export interface Artwork { id: string; title: string; artist: string; date: string; image: string; museum?: string }
export interface ArtArtist { id: string; name: string; photo?: string; works: Artwork[] }
export interface ArtLibrary { version: 1; updatedAt: string; artists: ArtArtist[] }
export const GALLERY_INTERVALS = [5, 15, 30, 60, 300, 900, 3600, 0]
export const galleryNext = (index: number, length: number, delta = 1) => length ? ((index + delta) % length + length) % length : 0
