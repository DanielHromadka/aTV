import { useEffect, useState } from 'preact/hooks'
import { CT_CHANNELS, ctDuration, type CtEpisode, type CtEpisodes, type CtPlay, type CtSearch, type CtShow } from '../../shared/ivysilani.ts'
import { Button, Card, Message, Row, Spinner } from '../components'
import { nav, toast, useScreenText } from '../state'
import { hubApi } from '../services/hub'

let starting = false

/** Asks the hub whether the programme plays without DRM, then opens the player. */
export async function playCt(kind: 'live' | 'vod', id: string, title?: string): Promise<void> {
  if (starting) return
  starting = true
  try {
    const p = await hubApi<CtPlay>(`/api/ct/play/${kind}/${encodeURIComponent(id)}`)
    nav.push({
      type: 'player',
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

const dateLabel = (iso?: string) => {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
}

function EpisodeCard({ e, prefix, withShow }: { e: CtEpisode; prefix: string; withShow?: boolean }) {
  const title = withShow && e.showTitle && e.showTitle !== e.title ? `${e.showTitle} · ${e.title}` : e.title
  return (
    <Card
      id={`${prefix}-${e.id}`}
      landscape
      title={title}
      subtitle={[dateLabel(e.date), ctDuration(e.duration)].filter(Boolean).join(' · ') || undefined}
      image={e.image}
      onClick={() => void playCt('vod', e.id, e.showTitle && e.showTitle !== e.title ? `${e.showTitle} · ${e.title}` : e.title)}
    />
  )
}

function ShowCard({ s }: { s: CtShow }) {
  return (
    <Card id={`ct-show-${s.id}`} landscape title={s.title} image={s.image}
      onClick={() => nav.push({ type: 'ct-show', id: s.id, title: s.title })} />
  )
}

/** iVysílání: live ČT channels and search in the archive. Text typed on the phone searches too. */
export function Ivysilani({ screenKey, query: initial = '' }: { screenKey: number; query?: string }) {
  const [query, setQuery] = useState(initial)
  const [result, setResult] = useState<CtSearch | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useScreenText(screenKey, (text, submit) => {
    if (submit || text.trim().length >= 2) setQuery(text)
  })

  useEffect(() => {
    const q = query.trim()
    setResult(null)
    setError('')
    if (q.length < 2) return
    let cancelled = false
    setBusy(true)
    hubApi<CtSearch>(`/api/ct/search?q=${encodeURIComponent(q)}`)
      .then((r) => !cancelled && setResult(r), (e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
  }, [query])

  const ask = () =>
    nav.push({ type: 'keyboard', title: 'Hledat v iVysílání', value: query, onDone: (v) => setQuery(v) })

  return (
    <div class="screen-body padded-top" data-scroll="y">
      <h1 class="screen-title padded-x">iVysílání</h1>
      <div class="buttons padded-x">
        <Button id="ct-search" primary label={query.trim() ? `Hledáno: ${query.trim()}` : 'Hledat pořad'} onClick={ask} autofocus />
        {query.trim() && <Button id="ct-clear" label="Zrušit hledání" onClick={() => setQuery('')} />}
      </div>
      {busy && <Spinner label="Hledám v iVysílání…" />}
      {error && <Message>{error}</Message>}
      {result && !result.shows.length && !result.episodes.length && <Message>V iVysílání nic nenalezeno.</Message>}
      {result && result.shows.length > 0 && (
        <Row title="Pořady">
          {result.shows.map((s) => <ShowCard key={s.id} s={s} />)}
        </Row>
      )}
      {result && result.episodes.length > 0 && (
        <Row title="Díly">
          {result.episodes.map((e) => <EpisodeCard key={e.id} e={e} prefix="ct-ep" withShow />)}
        </Row>
      )}
      <Row title="Živě">
        {CT_CHANNELS.map((c) => (
          <Card key={c.id} id={`ct-live-${c.id}`} landscape title={c.name} fallback={c.name}
            onClick={() => void playCt('live', c.id, c.name)} />
        ))}
      </Row>
      <div class="muted padded-x">Pořady chráněné DRM v aTV přehrát nejde, ostatní ano.</div>
    </div>
  )
}

/** A show's episodes, newest first, 24 at a time. */
export function CtShowScreen({ id, title }: { id: string; title: string }) {
  const [data, setData] = useState<CtEpisodes | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = (offset: number) => {
    setLoading(true)
    hubApi<CtEpisodes>(`/api/ct/shows/${encodeURIComponent(id)}/episodes?offset=${offset}`)
      .then((d) => setData((prev) => (prev && offset ? { ...d, items: [...prev.items, ...d.items] } : d)), (e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(0), [id])

  const items = data?.items ?? []
  return (
    <div class="screen-body padded-top" data-scroll="y">
      <h1 class="screen-title padded-x">{data?.show.title || title}</h1>
      {data?.show.description && <div class="muted padded-x">{data.show.description}</div>}
      {error && <Message>{error}</Message>}
      {!data && !error && <Spinner />}
      {data && !items.length && <Message>Žádné díly teď nejsou k přehrání.</Message>}
      {items.length > 0 && (
        <div class="grid padded-x">
          {items.map((e) => <EpisodeCard key={e.id} e={e} prefix="ct-show-ep" />)}
        </div>
      )}
      {data && items.length < data.total && (
        <div class="buttons padded-x">
          {loading ? <Spinner /> : <Button id="ct-more" label={`Načíst další (${data.total - items.length})`} onClick={() => load(items.length)} />}
        </div>
      )}
    </div>
  )
}
