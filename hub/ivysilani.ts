import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CT_CHANNELS,
  isCtChannel,
  isCtMediaId,
  isCtShowId,
  type CtEpisode,
  type CtEpisodes,
  type CtPlay,
  type CtSearch,
  type CtShow,
} from '../shared/ivysilani.ts'

const GRAPHQL = 'https://api.ceskatelevize.cz/graphql/'
const STREAM_API = 'https://api.ceskatelevize.cz/video/v1'
const PAGE = 24
const CACHE_MS = 5 * 60_000

type Fetch = typeof fetch

interface Context {
  json(res: ServerResponse, code: number, body: unknown): void
}

interface RawShow { id?: string; sidp?: string; title?: string; description?: string; imageUrl?: string; playable?: boolean }
interface RawEpisode {
  id?: string; idec?: string; title?: string; showTitle?: string; description?: string; duration?: number
  playable?: boolean; previewImage?: string; images?: { card?: string }; date?: { datetime?: string }
}
interface StreamData {
  title?: string
  showTitle?: string
  episodeTitle?: string
  duration?: number
  previewImageUrl?: string
  streams?: { url?: string; duration?: number; subtitles?: { language?: string; files?: { url?: string; format?: string }[] }[] }[]
  streamUrls?: { main?: string; isBlocked?: boolean }
  message?: { labels?: { textLong?: string; textShort?: string } }
}

const SEARCH = `query($q:String!$limit:PaginationAmount!){
  searchShows(limit:$limit offset:0 keyword:$q onlyPlayable:true){items{id sidp title description imageUrl(width:480 height:270) playable}}
  searchEpisodes(limit:$limit offset:0 keyword:$q onlyPlayable:true){items{idec title showTitle description duration playable previewImage(width:480)}}
}`
const EPISODES = `query($id:String!$limit:PaginationAmount!$offset:Int!){
  programme(legacySidpOrIdp:$id){id title shortDescription images{card(width:480)}
    episodes(limit:$limit offset:$offset orderBy:newest onlyPlayable:true){totalCount items{id title showTitle description duration playable images{card(width:480)} date{datetime}}}}
}`

export class CtError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

/** First sentence-ish of a long description, for cards. */
const short = (s?: string) => (s && s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s || undefined)

/**
 * iVysílání through ČT's public API: search, a show's episodes and stream addresses. Only streams
 * without DRM are requested (canPlayDrm=false); protected programmes come back as unavailable.
 */
export class Ivysilani {
  private readonly cache = new Map<string, { at: number; value: unknown }>()
  private readonly fetchFn: Fetch

  constructor(fetchFn: Fetch = fetch) {
    this.fetchFn = fetchFn
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new CtError('iVysílání neodpovídá. Zkuste to za chvíli.')
    })
    const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { extensions?: { code?: string } }[] }
    if (body.errors?.some((e) => e.extensions?.code === 'NOT_FOUND')) throw new CtError('Pořad nebyl nalezen.', 404)
    if (!res.ok || !body.data) throw new CtError('iVysílání vrátilo chybu. Zkuste to za chvíli.')
    return body.data
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
    const value = await load()
    this.cache.set(key, { at: Date.now(), value })
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!)
    return value
  }

  search(q: string): Promise<CtSearch> {
    const query = q.trim().slice(0, 100)
    if (query.length < 2) return Promise.resolve({ shows: [], episodes: [] })
    return this.cached(`s:${query.toLowerCase()}`, async () => {
      const d = await this.gql<{ searchShows?: { items?: RawShow[] }; searchEpisodes?: { items?: RawEpisode[] } }>(SEARCH, { q: query, limit: PAGE })
      const shows: CtShow[] = (d.searchShows?.items ?? [])
        .filter((s) => (s.sidp || s.id) && s.title)
        .map((s) => ({ id: String(s.sidp || s.id), title: s.title!, description: short(s.description), image: s.imageUrl || undefined, playable: s.playable !== false }))
      const episodes: CtEpisode[] = (d.searchEpisodes?.items ?? [])
        .filter((e) => e.idec && e.title)
        .map((e) => ({
          id: e.idec!.replace(/\D/g, ''),
          title: e.title!,
          showTitle: e.showTitle || undefined,
          description: short(e.description),
          image: e.previewImage || undefined,
          duration: e.duration || undefined,
          playable: e.playable !== false,
        }))
      return { shows, episodes }
    })
  }

  episodes(showId: string, offset = 0): Promise<CtEpisodes> {
    if (!isCtShowId(showId)) return Promise.reject(new CtError('Neplatný pořad', 400))
    const from = Math.max(0, Math.min(5000, Math.floor(offset)))
    return this.cached(`e:${showId}:${from}`, async () => {
      const d = await this.gql<{ programme?: { id: string; title?: string; shortDescription?: string; images?: { card?: string }; episodes?: { totalCount?: number; items?: RawEpisode[] } } }>(
        EPISODES, { id: showId, limit: PAGE, offset: from })
      const p = d.programme
      if (!p) throw new CtError('Pořad nebyl nalezen.', 404)
      return {
        show: { id: showId, title: p.title || '', description: short(p.shortDescription), image: p.images?.card || undefined },
        total: p.episodes?.totalCount ?? 0,
        items: (p.episodes?.items ?? []).filter((e) => e.id && e.title).map((e) => ({
          id: e.id!,
          title: e.title!,
          showTitle: e.showTitle || p.title,
          description: short(e.description),
          image: e.images?.card || undefined,
          duration: e.duration || undefined,
          playable: e.playable !== false,
          date: e.date?.datetime,
        })),
      }
    })
  }

  private async streamData(kind: 'live' | 'vod', id: string): Promise<StreamData> {
    const path = kind === 'live'
      ? `/playlist-live/v1/stream-data/channel/${id}`
      : `/playlist-vod/v1/stream-data/media/external/${id}`
    const res = await this.fetchFn(`${STREAM_API}${path}?canPlayDrm=false&streamType=hls&quality=web`, { signal: AbortSignal.timeout(15_000) }).catch(() => {
      throw new CtError('iVysílání neodpovídá. Zkuste to za chvíli.')
    })
    const d = (await res.json().catch(() => ({}))) as StreamData
    const url = kind === 'live' ? d.streamUrls?.main : d.streams?.[0]?.url
    if (!res.ok || !url || d.streamUrls?.isBlocked) {
      const reason = d.message?.labels?.textLong || d.message?.labels?.textShort
      throw new CtError(reason || 'Tento pořad v aTV přehrát nejde (je chráněný DRM nebo už není dostupný).', 404)
    }
    return d
  }

  /** Fresh CDN address of the stream (tokens expire, so every start asks again). */
  async streamUrl(kind: 'live' | 'vod', id: string): Promise<string> {
    const d = await this.streamData(kind, id)
    return (kind === 'live' ? d.streamUrls!.main : d.streams![0].url)!
  }

  /** Checks the programme is playable and describes it for the player, with hub URLs. */
  async play(kind: 'live' | 'vod', id: string, hub: string): Promise<CtPlay> {
    const d = await this.streamData(kind, id)
    const channel = CT_CHANNELS.find((c) => c.id === id)
    const vtt = kind === 'vod' && d.streams?.[0]?.subtitles?.find((s) => s.files?.some((f) => f.format === 'vtt' && f.url))
    const title = kind === 'live'
      ? channel?.name ?? d.title ?? 'ČT'
      : [d.showTitle, d.episodeTitle?.replace(`${d.showTitle} | `, '')].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || d.title || 'iVysílání'
    return {
      title,
      url: `${hub}/api/ct/stream/${kind}/${id}.m3u8`,
      live: kind === 'live',
      duration: kind === 'vod' ? d.streams?.[0]?.duration ?? d.duration : undefined,
      poster: d.previewImageUrl,
      subtitle: vtt ? { label: 'Čeština (skryté titulky)', lang: 'cs', src: `${hub}/api/ct/subtitles/${id}.vtt` } : undefined,
    }
  }

  async subtitles(id: string): Promise<string> {
    const d = await this.streamData('vod', id)
    const file = d.streams?.[0]?.subtitles?.flatMap((s) => s.files ?? []).find((f) => f.format === 'vtt' && f.url)
    if (!file?.url || !/^https:\/\/[a-z0-9.-]+\.ceskatelevize\.cz\//.test(file.url)) throw new CtError('Titulky nejsou k dispozici.', 404)
    const res = await this.fetchFn(file.url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new CtError('Titulky se nepodařilo načíst.')
    return res.text()
  }

  async route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Context): Promise<boolean> {
    const path = url.pathname
    if (!path.startsWith('/api/ct/')) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      ctx.json(res, 405, { error: 'Použijte GET' })
      return true
    }
    // The address the TV used to reach the hub, so the player's URLs work from the TV too.
    const hub = `http://${req.headers.host ?? 'localhost'}`
    const ok = (body: unknown) => {
      ctx.json(res, 200, body)
      return true
    }
    try {
      if (path === '/api/ct/channels') return ok(CT_CHANNELS)
      if (path === '/api/ct/search') return ok(await this.search(url.searchParams.get('q') ?? ''))
      const show = /^\/api\/ct\/shows\/(\d+)\/episodes$/.exec(path)
      if (show) return ok(await this.episodes(show[1], Number(url.searchParams.get('offset')) || 0))
      const play = /^\/api\/ct\/play\/(live|vod)\/([A-Z0-9_]+)$/.exec(path)
      if (play) {
        const [, kind, id] = play as unknown as [string, 'live' | 'vod', string]
        if (!(kind === 'live' ? isCtChannel(id) : isCtMediaId(id))) throw new CtError('Neplatný pořad', 400)
        return ok(await this.play(kind, id, hub))
      }
      const stream = /^\/api\/ct\/stream\/(live|vod)\/([A-Z0-9_]+)\.m3u8$/.exec(path)
      if (stream) {
        const [, kind, id] = stream as unknown as [string, 'live' | 'vod', string]
        if (!(kind === 'live' ? isCtChannel(id) : isCtMediaId(id))) throw new CtError('Neplatný pořad', 400)
        res.writeHead(302, { location: await this.streamUrl(kind, id), 'cache-control': 'no-store' })
        res.end()
        return true
      }
      const subs = /^\/api\/ct\/subtitles\/(\d+)\.vtt$/.exec(path)
      if (subs && isCtMediaId(subs[1])) {
        const body = await this.subtitles(subs[1])
        res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=3600' })
        res.end(body)
        return true
      }
      ctx.json(res, 404, { error: 'not found' })
    } catch (e) {
      ctx.json(res, e instanceof CtError ? e.status : 502, { error: e instanceof CtError ? e.message : 'iVysílání vrátilo chybu.' })
    }
    return true
  }
}
