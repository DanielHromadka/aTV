import type { Actor, ActorPage, Filmography } from '../../shared/actors.ts'
import { config } from '../state'
import { hubApi } from './hub'
import { jellyfin } from './jellyfin'

export async function loadActors(query = '', page = 1): Promise<ActorPage> {
  if (config.get()?.features.actors) return hubApi(`/api/actors?q=${encodeURIComponent(query)}&page=${page}`)
  const jf = jellyfin()
  if (jf) return jf.actors(query, page)
  throw new Error('Pro herce a jejich filmografie připojte filmovou databázi TMDB nebo se přihlaste do knihovny Jellyfin.')
}

export async function loadFilmography(actor: Actor): Promise<Filmography> {
  if (actor.source === 'tmdb') return hubApi(`/api/actors/${encodeURIComponent(actor.id)}`)
  const jf = jellyfin()
  if (!jf) throw new Error('Přihlaste se do knihovny Jellyfin.')
  return jf.actorFilms(actor)
}
