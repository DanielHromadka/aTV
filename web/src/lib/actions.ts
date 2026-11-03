import type { TvApp } from '../../../shared/apps.ts'
import { ticksToSeconds } from '../../../shared/context.ts'
import type { CtPlay } from '../../../shared/ivysilani.ts'
import type { MediaResult } from '../../../shared/media.ts'
import { hubApi, hubAsset } from './hub.svelte.ts'
import { isPlayable, jellyfin, playerTitle, type Item } from './jellyfin.ts'
import { nav } from './router.svelte.ts'
import { toast } from './toast.svelte.ts'

/** Plays an item; series start at their next unwatched episode, folders open their detail. */
export async function playItem(item: Item, fromStart = false): Promise<void> {
  const jf = jellyfin()
  if (!jf) return
  if (item.Type === 'Series') {
    const [next] = await jf.nextUp(item.Id)
    const episode = next ?? (await jf.episodes(item.Id))[0]
    if (!episode) return toast('Seriál nemá žádné díly')
    return playItem(episode)
  }
  if (!isPlayable(item)) return nav.push({ name: 'detail', itemId: item.Id })
  const startSeconds = fromStart ? 0 : ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  nav.push({ name: 'player', source: { kind: 'jellyfin', itemId: item.Id, title: playerTitle(item), startSeconds } })
}

export function openResult(r: MediaResult): void {
  nav.push({ name: 'media-detail', mediaId: r.id, title: r.title, poster: hubAsset(r.poster), description: r.description, year: r.year })
}

/** Streaming apps have no web player here; their web version opens in a new tab. */
export function launchApp(app: TvApp): void {
  window.open(app.url, '_blank', 'noopener')
}

let starting = false

/** Asks the hub whether an iVysílání programme plays without DRM, then opens the player. */
export async function playCt(kind: 'live' | 'vod', id: string, title?: string): Promise<void> {
  if (starting) return
  starting = true
  try {
    const p = await hubApi<CtPlay>(`/api/ct/play/${kind}/${encodeURIComponent(id)}`)
    nav.push({
      name: 'player',
      source: {
        kind: 'url',
        url: p.url,
        title: title || p.title,
        poster: p.poster,
        live: p.live,
        duration: p.duration,
        subtitle: p.subtitle && { ...p.subtitle, off: true },
        historyId: p.live ? undefined : `ct:${id}`,
      },
    })
  } catch (e) {
    toast((e as Error).message)
  } finally {
    starting = false
  }
}

/** "1 zdroj", "3 zdroje", "7 zdrojů". */
export const sources = (n: number) => `${n} ${n === 1 ? 'zdroj' : n >= 2 && n <= 4 ? 'zdroje' : 'zdrojů'}`

export const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes > 10_000_000 ? 0 : 1)} MB`
