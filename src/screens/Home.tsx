import { ArtistsRow } from './Art'
import { MusiciansRow } from './Musicians'
import { useEffect, useState } from 'preact/hooks'
import { formatTime, type HomeRow } from '../../shared/context.ts'
import type { Channel } from '../../shared/m3u.ts'
import { playItem } from '../actions'
import { Button, Card, Row, useClock } from '../components'
import { config, hubStatus, nav, useStore } from '../state'
import { hubApi, loadChannels } from '../services/hub'
import { itemTitle, jellyfin, type Item } from '../services/jellyfin'
import { settings } from '../services/settings'
import { visibleTiles } from '../tiles'
import { watchHistory } from '../services/watch-history'
import { ActorsRow } from './Actors'
import { HomeBackground, HomeHero } from './HomeHero'

interface Data {
  resume: Item[]
  nextup: Item[]
  latest: Item[]
  libraries: Item[]
  channels: Channel[]
}

const EMPTY: Data = { resume: [], nextup: [], latest: [], libraries: [], channels: [] }

export function Home({ active }: { active: boolean }) {
  const s = useStore(settings)
  const c = useStore(config)
  const watching = useStore(watchHistory)
  const [data, setData] = useState<Data>(EMPTY)

  // Reload whenever Home comes back to the top (after playing something, progress changed).
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const jf = jellyfin()
    const safe = <T,>(p: Promise<T[]> | undefined): Promise<T[]> => (p ? p.catch(() => [] as T[]) : Promise.resolve([] as T[]))
    Promise.all([
      safe(jf?.resume()),
      safe(jf?.nextUp()),
      safe(jf?.latest()),
      safe(jf?.views()),
      c?.features.iptv ? safe(loadChannels()) : Promise.resolve([] as Channel[]),
    ]).then(([resume, nextup, latest, libraries, channels]) => {
      // Next up repeats what is already in "continue watching".
      const resumeIds = new Set(resume.map((i) => i.SeriesId ?? i.Id))
      if (!cancelled) setData({ resume, nextup: nextup.filter((i) => !resumeIds.has(i.SeriesId ?? i.Id)), latest, libraries, channels })
    })
    return () => {
      cancelled = true
    }
  }, [active, s.jellyfin, c])

  const jf = jellyfin()
  const tiles = visibleTiles(s, c)

  // The app tiles are drawn by the hero in the chosen design.
  const rows: Record<Exclude<HomeRow, 'apps'>, () => preact.JSX.Element | null> = {
    resume: () =>
      watching.length || (jf && data.resume.length) ? (
        <Row title="Pokračovat ve sledování" key="resume">
          {watching.map((entry) => (
            <Card
              key={entry.id}
              id={`watch-${entry.id}`}
              landscape
              title={entry.source.title}
              image={entry.source.poster}
              subtitle={`${formatTime(entry.position)}${entry.duration ? ` z ${formatTime(entry.duration)}` : ''} · ${entry.source.audioOnly ? 'Audio' : entry.source.mediaKey ? 'Torrent' : 'Video'}`}
              progress={entry.duration ? entry.position / entry.duration : undefined}
              onClick={() => nav.push({ type: 'player', source: { ...entry.source, startSeconds: entry.position } })}
            />
          ))}
          {jf && data.resume.map((i) => (
            <Card
              key={i.Id}
              id={`resume-${i.Id}`}
              landscape
              title={i.SeriesName ?? i.Name}
              subtitle={i.SeriesName ? itemTitle(i) : i.ProductionYear ? String(i.ProductionYear) : undefined}
              image={jf.cardImage(i, true, 270)}
              progress={(i.UserData?.PlayedPercentage ?? 0) / 100}
              onClick={() => void playItem(i)}
            />
          ))}
        </Row>
      ) : null,
    nextup: () =>
      jf && data.nextup.length ? (
        <Row title="Další díly" key="nextup">
          {data.nextup.map((i) => (
            <Card key={i.Id} id={`next-${i.Id}`} landscape title={i.SeriesName ?? i.Name} subtitle={itemTitle(i)} image={jf.cardImage(i, true, 270)} onClick={() => void playItem(i)} />
          ))}
        </Row>
      ) : null,
    latest: () =>
      jf && data.latest.length ? (
        <Row title="Nově přidané" key="latest">
          {data.latest.map((i) => (
            <Card key={i.Id} id={`latest-${i.Id}`} title={i.Name} subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined} image={jf.cardImage(i, false, 360)} onClick={() => nav.push({ type: 'detail', itemId: i.Id })} />
          ))}
        </Row>
      ) : null,
    libraries: () =>
      jf && data.libraries.length ? (
        <Row title="Knihovny" key="libraries">
          {data.libraries.map((i) => (
            <Card
              key={i.Id}
              id={`lib-${i.Id}`}
              landscape
              title={i.Name}
              image={jf.cardImage(i, false, 270)}
              onClick={() => nav.push({ type: 'library', parentId: i.Id, title: i.Name, collectionType: i.CollectionType })}
            />
          ))}
        </Row>
      ) : null,
    channels: () =>
      data.channels.length ? (
        <Row title="Televize" key="channels">
          {data.channels.slice(0, 16).map((ch) => (
            <Card
              key={ch.id}
              id={`ch-${ch.id}`}
              landscape
              title={ch.name}
              subtitle={ch.group}
              image={ch.logo}
              fallback={ch.name}
              onClick={() => nav.push({ type: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })}
            />
          ))}
        </Row>
      ) : null,
  }

  return (
    <>
      <HomeBackground />
      <div class="screen-body home" data-scroll="y">
        <HomeHero tiles={tiles} />
        <div class="home-rest">
          {rows.resume()}
          <ActorsRow active={active} />
          <MusiciansRow active={active} />
          <ArtistsRow active={active} />
          <section class="home-jellyfin padded-x">
            <h2 class="row-title">Jellyfin</h2>
            <div class="buttons">
              <Button id="home-jellyfin" label={jf ? 'Otevřít knihovnu Jellyfin' : 'Připojit Jellyfin'} onClick={() => nav.push({ type: jf ? 'library' : 'login' })} />
              {jf && <Button id="home-jellyfin-settings" label="Nastavení připojení" onClick={() => nav.push({ type: 'login' })} />}
            </div>
          </section>
          {rows.nextup()}
          {rows.latest()}
          {rows.libraries()}
          {rows.channels()}
          <TorrentSources active={active} />
        </div>
      </div>
    </>
  )
}

export function SleepBadge() {
  const { sleepEndsAt } = useStore(hubStatus)
  useClock()
  if (!sleepEndsAt) return null
  const min = Math.max(1, Math.ceil((sleepEndsAt - Date.now()) / 60_000))
  return <span class="sleep-badge">☾ {min} min</span>
}

function TorrentSources({ active }: { active: boolean }) {
  const [sources, setSources] = useState<{ id: string; name: string; searchable: boolean; categories: number[] }[]>([])
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    hubApi<{ indexers: typeof sources }>('/api/media/providers').then(d => {
      if (!cancelled) { setSources(d.indexers.filter(i => i.searchable || i.categories.some(c => c >= 3000 && c < 4000))); setError(false) }
    }, () => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [active])
  if (error) return <div class="padded-x muted">Torrentové zdroje se nepodařilo načíst. Zkontrolujte spojení s Jackettem.</div>
  if (!sources.length) return null
  return <Row title="Torrentové zdroje">{sources.map(s => <Card key={s.id} id={`source-${s.id}`} landscape title={s.name}
    subtitle={s.searchable ? 'Hledat filmy v tomto zdroji' : 'Hledat audio v tomto zdroji'} fallback={s.name}
    onClick={() => nav.push(s.searchable ? { type: 'source-search', indexer: s.id, name: s.name } : { type: 'audio', indexer: s.id, name: s.name })} />)}</Row>
}
