import type { Actor, ActorPage, Filmography } from '../../../shared/actors.ts'
import { deviceProfile, type MediaSource } from '../../../shared/jellyfin.ts'
import { settings, updateSettings, type JellyfinSession } from './settings.svelte.ts'

export interface Person {
  Id: string
  Name: string
  Type: string
  Role?: string
  PrimaryImageTag?: string
}

export interface Item {
  Id: string
  Name: string
  Type: string
  MediaType?: string
  IsFolder?: boolean
  CollectionType?: string
  SeriesId?: string
  SeriesName?: string
  SeasonName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  ProductionYear?: number
  RunTimeTicks?: number
  OfficialRating?: string
  CommunityRating?: number
  Overview?: string
  People?: Person[]
  ImageTags?: { Primary?: string; Thumb?: string; Backdrop?: string }
  BackdropImageTags?: string[]
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  SeriesPrimaryImageTag?: string
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; PlayedPercentage?: number; UnplayedItemCount?: number }
}

interface ItemsResult {
  Items: Item[]
  TotalRecordCount: number
}

type Query = Record<string, string | number | boolean | undefined>

const FIELDS = 'Overview,PrimaryImageAspectRatio,ProductionYear,ParentId'

function qs(params: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

function authHeader(token?: string): string {
  const parts = [`Client="aTV"`, `Device="Web"`, `DeviceId="${settings.deviceId}"`, `Version="0.1.0"`]
  if (token) parts.push(`Token="${token}"`)
  return `MediaBrowser ${parts.join(', ')}`
}

async function request<T>(server: string, method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(server.replace(/\/+$/, '') + path, {
    method,
    headers: { Authorization: authHeader(token), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && token) {
    // The token was revoked on the server: log out so the UI offers a new login.
    updateSettings({ jellyfin: null })
    throw new Error('Přihlášení do Jellyfinu vypršelo')
  }
  if (!res.ok) throw new Error(`Jellyfin: HTTP ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const session = (server: string, r: { AccessToken: string; User: { Id: string; Name: string } }): JellyfinSession => ({
  server: server.replace(/\/+$/, ''),
  token: r.AccessToken,
  userId: r.User.Id,
  userName: r.User.Name,
})

/** Login without a session: Quick Connect (approve a code in another Jellyfin app) or name and password. */
export const jellyfinAuth = {
  publicInfo: (server: string) => request<{ ServerName: string; Version: string }>(server, 'GET', '/System/Info/Public'),
  quickConnectStart: (server: string) => request<{ Code: string; Secret: string }>(server, 'POST', '/QuickConnect/Initiate'),
  async quickConnectDone(server: string, secret: string): Promise<boolean> {
    return (await request<{ Authenticated: boolean }>(server, 'GET', `/QuickConnect/Connect${qs({ secret })}`)).Authenticated
  },
  async withQuickConnect(server: string, secret: string): Promise<JellyfinSession> {
    return session(server, await request(server, 'POST', '/Users/AuthenticateWithQuickConnect', undefined, { Secret: secret }))
  },
  async withPassword(server: string, user: string, password: string): Promise<JellyfinSession> {
    return session(server, await request(server, 'POST', '/Users/AuthenticateByName', undefined, { Username: user, Pw: password }))
  },
}

/** API calls for the logged-in user (Jellyfin 10.9+ routes). */
export class Jellyfin {
  constructor(readonly s: JellyfinSession) {}

  private get<T>(path: string, query: Query = {}): Promise<T> {
    return request<T>(this.s.server, 'GET', path + qs(query), this.s.token)
  }

  private post<T>(path: string, body?: unknown, query: Query = {}): Promise<T> {
    return request<T>(this.s.server, 'POST', path + qs(query), this.s.token, body ?? {})
  }

  refreshLibrary = () => this.post<void>('/Library/Refresh')

  async views(): Promise<Item[]> {
    return (await this.get<ItemsResult>('/UserViews', { userId: this.s.userId })).Items
  }

  async actors(query = '', page = 1): Promise<ActorPage> {
    const r = await this.get<ItemsResult>('/Persons', { userId: this.s.userId, personTypes: 'Actor', searchTerm: query || undefined, startIndex: (page - 1) * 24, limit: 24 })
    return {
      actors: r.Items.map((i): Actor => ({ id: i.Id, name: i.Name, photo: this.cardImage(i, false, 360), source: 'jellyfin' })),
      page,
      more: page * 24 < r.TotalRecordCount,
      source: 'jellyfin',
    }
  }

  async actorFilms(person: Actor): Promise<Filmography> {
    const movies: Item[] = []
    let total = 1
    while (movies.length < total) {
      const r = await this.get<ItemsResult>('/Items', {
        userId: this.s.userId, personIds: person.id, personTypes: 'Actor', includeItemTypes: 'Movie', recursive: true,
        fields: 'People,ProductionYear', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending', startIndex: movies.length, limit: 100,
      })
      movies.push(...r.Items)
      total = r.TotalRecordCount
      if (!r.Items.length) break
    }
    return {
      actor: person,
      movies: movies.map((i) => ({
        id: i.Id, title: i.Name, originalTitle: i.Name, year: i.ProductionYear, poster: this.cardImage(i, false, 360),
        role: i.People?.find((p) => p.Id === person.id && p.Type === 'Actor')?.Role, source: 'jellyfin' as const,
      })),
    }
  }

  async resume(): Promise<Item[]> {
    return (await this.get<ItemsResult>('/UserItems/Resume', { userId: this.s.userId, limit: 20, mediaTypes: 'Video', fields: FIELDS, enableUserData: true })).Items
  }

  async nextUp(seriesId?: string): Promise<Item[]> {
    return (await this.get<ItemsResult>('/Shows/NextUp', { userId: this.s.userId, seriesId, limit: 20, fields: FIELDS, enableResumable: false })).Items
  }

  latest(): Promise<Item[]> {
    return this.get<Item[]>('/Items/Latest', { userId: this.s.userId, limit: 20, fields: FIELDS, enableUserData: true })
  }

  /** A library's content: movies and series flattened, other folders as they are. */
  async items(parentId: string, collectionType?: string): Promise<Item[]> {
    const types: Record<string, string> = { movies: 'Movie', tvshows: 'Series', music: 'MusicAlbum', musicvideos: 'MusicVideo', homevideos: 'Video,Photo' }
    const include = collectionType ? types[collectionType] : undefined
    const r = await this.get<ItemsResult>('/Items', {
      userId: this.s.userId, parentId, recursive: include ? true : undefined, includeItemTypes: include,
      sortBy: 'SortName', sortOrder: 'Ascending', fields: FIELDS, enableUserData: true, limit: 500,
    })
    return r.Items
  }

  async children(parentId: string): Promise<Item[]> {
    return (await this.get<ItemsResult>('/Items', { userId: this.s.userId, parentId, sortBy: 'ParentIndexNumber,IndexNumber,SortName', fields: FIELDS, enableUserData: true })).Items
  }

  item = (id: string) => this.get<Item>(`/Items/${id}`, { userId: this.s.userId })

  async episodes(seriesId: string): Promise<Item[]> {
    return (await this.get<ItemsResult>(`/Shows/${seriesId}/Episodes`, { userId: this.s.userId, fields: FIELDS, enableUserData: true })).Items
  }

  async search(term: string): Promise<Item[]> {
    const r = await this.get<ItemsResult>('/Items', {
      userId: this.s.userId, searchTerm: term, recursive: true, includeItemTypes: 'Movie,Series,Episode,MusicAlbum,Audio,Video',
      fields: FIELDS, enableUserData: true, limit: 30,
    })
    return r.Items
  }

  playbackInfo(itemId: string, startTicks?: number): Promise<{ MediaSources: MediaSource[]; PlaySessionId: string }> {
    return this.post(`/Items/${itemId}/PlaybackInfo`, {
      UserId: this.s.userId, DeviceProfile: deviceProfile('browser'), MaxStreamingBitrate: 40_000_000, StartTimeTicks: startTicks,
      AutoOpenLiveStream: true, EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true,
    }, { userId: this.s.userId })
  }

  report(kind: 'start' | 'progress' | 'stopped', info: Record<string, unknown>): Promise<void> {
    const path = { start: '/Sessions/Playing', progress: '/Sessions/Playing/Progress', stopped: '/Sessions/Playing/Stopped' }[kind]
    return this.post(path, info)
  }

  /** An image URL; images need no token. */
  image(id: string, type: 'Primary' | 'Thumb' | 'Backdrop', height: number, tag?: string): string {
    return `${this.s.server}/Items/${id}/Images/${type}${qs({ fillHeight: height, quality: 85, tag })}`
  }

  /** The best picture for a card: landscape cards prefer thumbs and backdrops, portrait ones the poster. */
  cardImage(item: Item, landscape: boolean, height: number): string | undefined {
    const t = item.ImageTags ?? {}
    if (landscape) {
      if (t.Thumb) return this.image(item.Id, 'Thumb', height, t.Thumb)
      if (item.Type === 'Episode' && t.Primary) return this.image(item.Id, 'Primary', height, t.Primary)
      if (item.BackdropImageTags?.length) return this.image(item.Id, 'Backdrop', height, item.BackdropImageTags[0])
      if (item.ParentThumbItemId) return this.image(item.ParentThumbItemId, 'Thumb', height, item.ParentThumbImageTag)
      if (item.ParentBackdropItemId) return this.image(item.ParentBackdropItemId, 'Backdrop', height, item.ParentBackdropImageTags?.[0])
    }
    if (t.Primary) return this.image(item.Id, 'Primary', height, t.Primary)
    if (item.SeriesId && item.SeriesPrimaryImageTag) return this.image(item.SeriesId, 'Primary', height, item.SeriesPrimaryImageTag)
    return undefined
  }
}

/** The client for the current session, or null when logged out. */
export function jellyfin(): Jellyfin | null {
  return settings.jellyfin ? new Jellyfin(settings.jellyfin) : null
}

export const isPlayable = (i: Item): boolean =>
  i.MediaType === 'Video' || i.MediaType === 'Audio' || ['Movie', 'Episode', 'Video', 'Audio', 'MusicVideo', 'TvChannel'].includes(i.Type)

/** "S1:E3 · Name" for episodes, the name otherwise. */
export function itemTitle(i: Item): string {
  if (i.Type !== 'Episode') return i.Name
  const se = i.ParentIndexNumber !== undefined && i.IndexNumber !== undefined ? `S${i.ParentIndexNumber}:E${i.IndexNumber} · ` : ''
  return `${se}${i.Name}`
}

export const playerTitle = (item: Item): string => (item.SeriesName ? `${item.SeriesName} · ${itemTitle(item)}` : item.Name)
