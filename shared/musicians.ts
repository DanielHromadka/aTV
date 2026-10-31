export interface Musician { id: string; name: string; photo?: string; fans: number; link: string }
export interface MusicRelease { id: string; title: string; year?: number; date?: string; cover?: string; type: string; link: string }
export interface MusicTrack { id: string; title: string; album: string; cover?: string; duration: number; link: string }
export interface Discography { musician: Musician; releases: MusicRelease[]; tracks: MusicTrack[] }
export interface MusicianLibrary { version: 1; updatedAt: string; title: string; entries: Discography[] }
export interface MusicianPage { musicians: Musician[]; page: number; more: boolean; total: number; updatedAt: string }
