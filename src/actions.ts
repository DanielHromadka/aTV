import { findApp, type TvApp } from '../shared/apps.ts'
import { ticksToSeconds } from '../shared/context.ts'
import type { Intent } from '../shared/intents.ts'
import { bestMatch, matchScore } from '../shared/text.ts'
import { platform } from './runtime'
import { config, hubStatus, nav, playerControl, toast } from './state'
import { loadChannels, sendToHub } from './services/hub'
import { isPlayable, itemTitle, jellyfin, type Item } from './services/jellyfin'

/** Opens a page in aTV's own browser (Chrome on the hub), or the TV's built-in one without it. */
export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return toast('Neplatná adresa')
  if (config.get()?.features.browser) {
    nav.push({ type: 'browser', url })
    return
  }
  toast(`Otevírám ${url.replace(/^https?:\/\//, '')}…`)
  await platform.openUrl(url).catch((e: Error) => toast(e.message))
}

export function launchApp(app: TvApp): void {
  toast(`Spouštím ${app.name}…`)
  platform.launch(app).catch((e: Error) => toast(e.message))
}

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
  if (!isPlayable(item)) {
    nav.push({ type: 'detail', itemId: item.Id })
    return
  }
  const start = fromStart ? 0 : ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  nav.push({ type: 'player', source: { kind: 'jellyfin', itemId: item.Id, title: playerTitle(item), startSeconds: start } })
}

export function playerTitle(item: Item): string {
  return item.SeriesName ? `${item.SeriesName} · ${itemTitle(item)}` : item.Name
}

async function playChannel(query: string, required: boolean): Promise<boolean> {
  let list
  try {
    list = await loadChannels()
  } catch {
    if (required) toast('IPTV není nastavené')
    return false
  }
  const ch = bestMatch(query, list, (c) => c.name, required ? 0.5 : 0.8)
  if (!ch) {
    if (required) toast(`Kanál „${query}“ nenalezen`)
    return false
  }
  nav.push({ type: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })
  return true
}

/** Voice "pusť X": a channel with that exact name, else the best match in the Jellyfin library. */
async function playQuery(query: string): Promise<void> {
  if (await playChannel(query, false)) return
  const jf = jellyfin()
  if (!jf) return toast('Pro přehrávání z knihovny se přihlaste do Jellyfinu')
  const results = await jf.search(query)
  // Czech inflection ("Mandaloriana") still has the base name as a prefix; retry with the stem.
  const found = results.length ? results : query.length > 5 ? await jf.search(query.slice(0, -2)) : []
  if (!found.length) return toast(`„${query}“ v knihovně není`)
  found.sort((a, b) => matchScore(query, b.Name) - matchScore(query, a.Name) || rank(a) - rank(b))
  await playItem(found[0])
}

/** Prefer whole works over single episodes when names score the same. */
const rank = (i: Item) => (i.Type === 'Movie' || i.Type === 'Series' ? 0 : 1)

export async function runIntent(intent: Intent): Promise<void> {
  switch (intent.kind) {
    case 'launch': {
      const app = findApp(intent.app)
      if (app) launchApp(app)
      return
    }
    case 'play':
      return playQuery(intent.query)
    case 'channel':
      await playChannel(intent.query, true)
      return
    case 'open-url':
      return openUrl(intent.url)
    case 'search':
      nav.home()
      nav.push({ type: 'search', query: intent.query })
      return
    case 'navigate':
      nav.home()
      if (intent.screen === 'library') nav.push({ type: 'library' })
      else if (intent.screen === 'tv') nav.push({ type: 'iptv' })
      else if (intent.screen !== 'home') nav.push({ type: intent.screen })
      return
    case 'playback': {
      const p = playerControl.get()
      if (!p) return toast('Nic se nepřehrává')
      if (intent.action === 'pause') p.pause()
      else if (intent.action === 'resume') p.resume()
      else p.stop()
      return
    }
    case 'sleep':
      setSleep(intent.minutes)
      return
    default:
      // TV keys and power are run by the hub; the TV app cannot do them itself.
      toast('Tento příkaz potřebuje hub s ovládáním televize')
  }
}

let localSleep: number | undefined

/** Through the hub when connected (it can switch the TV off); otherwise a local timer that stops playback. */
export function setSleep(minutes: number | null): void {
  if (sendToHub({ t: 'sleep-set', minutes })) return
  window.clearTimeout(localSleep)
  hubStatus.set((s) => ({ ...s, sleepEndsAt: minutes ? Date.now() + minutes * 60_000 : null }))
  if (minutes) localSleep = window.setTimeout(sleepNow, minutes * 60_000)
}

export function sleepNow(): void {
  hubStatus.set((s) => ({ ...s, sleepEndsAt: null }))
  playerControl.get()?.stop()
  nav.home()
  platform.exit()
}

