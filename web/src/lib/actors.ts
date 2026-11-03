import type { Actor, ActorPage, Filmography } from '../../../shared/actors.ts'
import { hub, hubApi } from './hub.svelte.ts'
import { jellyfin } from './jellyfin.ts'

/** Actors from TMDB through the hub when it has a key, else from the Jellyfin library. */
export async function loadActors(query = '', page = 1): Promise<ActorPage> {
  if (hub.config?.features.actors) return hubApi(`/api/actors?q=${encodeURIComponent(query)}&page=${page}`)
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
