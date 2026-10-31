export interface Actor {
  id: string
  name: string
  photo?: string
  knownFor?: string
  aliases?: string[]
  source: 'tmdb' | 'jellyfin'
}
export interface ActorMovie {
  id: string
  title: string
  originalTitle: string
  year?: number
  poster?: string
  role?: string
  source: 'tmdb' | 'jellyfin'
}
export interface ActorPage { actors: Actor[]; page: number; more: boolean; source: 'tmdb' | 'jellyfin'; collection?: { title: string; total: number; fromYear: number; toYear: number } }
export interface Filmography { actor: Actor; biography?: string; movies: ActorMovie[] }
export interface ActorLibrary { version: 1; title: string; fromYear: number; toYear: number; updatedAt: string; entries: Filmography[] }
