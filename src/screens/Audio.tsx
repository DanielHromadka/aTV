import { useEffect, useState } from 'preact/hooks'
import type { MediaSearch } from '../../shared/media.ts'
import type { AudioDetails } from '../../shared/audio.ts'
import { applyKey, Button, Card, Keyboard, Message, Spinner, TextField } from '../components'
import { nav, useScreenText } from '../state'
import { hubApi, hubUrl } from '../services/hub'
import { ResultCard } from './Media'

const imageUrl = (url?: string) => url?.startsWith('/api/') ? hubUrl() + url : url
export function SourceSearch({ screenKey, kind, indexer, name, query: initial = '' }: { screenKey: number; kind: 'audio' | 'video'; indexer?: string; name?: string; query?: string }) {
  const [query, setQuery] = useState(initial)
  const [data, setData] = useState<MediaSearch | null>(null)
  const [error, setError] = useState('')
  useScreenText(screenKey, setQuery)
  useEffect(() => {
    let cancelled = false
    let timer: number
    setData(null); setError('')
    const load = async () => {
      try {
        const result = await hubApi<MediaSearch>(`/api/${kind === 'audio' ? 'audio' : 'sources'}/search?q=${encodeURIComponent(query)}&indexer=${encodeURIComponent(indexer ?? '')}`)
        if (cancelled) return
        setData(result)
        if (result.pending) timer = window.setTimeout(load, 1500)
      } catch { if (!cancelled) setError('Hledání není dostupné. Zkontrolujte hub a zkuste dotaz znovu.') }
    }
    if (query.trim().length >= 2) timer = window.setTimeout(load, 500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, indexer, kind])
  return <div class="screen-body padded-top padded-x" data-scroll="y">
    <h1 class="screen-title">{name ?? 'Audio'}</h1>
    <p class="muted">{kind === 'audio' ? 'Hudba, alba, singly a audioknihy' : 'Filmy a seriály'}{name ? ` · Hledání pouze v ${name}` : ' · Zdroje z Jackettu'}</p>
    <TextField label="Hledat audio nebo film" value={query} onChange={setQuery} placeholder={kind === 'audio' ? 'Interpret, skladba, album nebo autor…' : 'Název filmu…'} />
    <Keyboard onKey={k => setQuery(q => applyKey(q, k))} value={query} onChange={setQuery} />
    {error && <Message>{error}</Message>}
    {query.trim().length >= 2 && !data && !error && <Spinner label="Hledám…" />}
    {data?.providers.filter(p => p.state === 'error').map(p => <p key={p.id} class="muted">{p.name}: zdroj je nyní nedostupný.</p>)}
    {data?.pending && <Spinner label="Další zdroje ještě hledají…" />}
    {data && !data.pending && !data.results.length && <Message>{data.providers.length ? 'Nic nenalezeno. Zkuste jiný název nebo autora.' : 'V Jackettu není nastavený odpovídající zdroj.'}</Message>}
    <div class="audio-results">{data?.results.map(r => kind === 'video' ? <ResultCard key={r.id} prefix="source" r={r} /> :
      <Card key={r.id} id={`audio-${r.id}`} title={r.title} subtitle={`${r.indexName ?? ''} · ${r.seeders ?? 0} seedů`} image={imageUrl(r.poster)}
        onClick={() => nav.push({ type: 'audio-detail', mediaId: r.id, title: r.title, poster: imageUrl(r.poster) })} />)}</div>
  </div>
}

export function AudioDetail({ mediaId, title, poster }: { mediaId: string; title: string; poster?: string }) {
  const [data, setData] = useState<AudioDetails | null>(null)
  const [cover, setCover] = useState(poster)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(''); setData(null)
    hubApi<AudioDetails>(`/api/audio/${encodeURIComponent(mediaId)}`).then(d => {
      if (cancelled) return
      setData(d)
      if (d.cover) setCover(imageUrl(d.cover))
      else if (!poster) hubApi<{cover?: string}>(`/api/audio/cover?q=${encodeURIComponent(title)}`).then(c => { if (!cancelled) setCover(c.cover) }, () => {})
    }, () => { if (!cancelled) setError('Audio se nepodařilo načíst. Zkuste to znovu nebo vyberte jinou verzi.') })
    return () => { cancelled = true }
  }, [mediaId, attempt])
  return <div class="screen-body padded-top padded-x" data-scroll="y">
    <div class="audio-heading">{cover && <img src={cover} alt="Obal alba nebo audioknihy" onError={() => setCover(undefined)} />}<div><h1 class="screen-title">{title}</h1><p class="muted">{data ? `${data.tracks.length} skladeb / kapitol` : 'Načítání seznamu skladeb…'}</p></div></div>
    {error ? <><Message>{error}</Message><Button id="audio-retry" label="Zkusit znovu" onClick={() => setAttempt(n => n + 1)} /></> : !data ? <Spinner /> : !data.tracks.length ? <Message>Tento torrent neobsahuje podporované zvukové soubory.</Message> :
      <div class="audio-tracks">{data.tracks.map((track, n) => <Button key={track.index} id={`track-${track.index}`} label={`${n + 1}. ${track.name.split('/').pop()}`} onClick={() => {
        const base = `${hubUrl()}/api/media/${encodeURIComponent(mediaId)}/files/${track.index}`
        const direct = /\.(mp3|m4a|m4b|wav)$/i.test(track.name)
        nav.push({ type: 'player', source: { kind: 'url', title: track.name.split('/').pop() ?? title, url: base, audioOnly: true, poster: cover, mediaKey: mediaId,
          historyId: `${mediaId}/${track.index}`, seekTemplate: direct ? undefined : `${base}/play?t={t}` } })
      }} />)}</div>}
    <p class="muted audio-credit">Obaly: soubory torrentu, MusicBrainz / Cover Art Archive. Chybějící obal nebrání poslechu.</p>
  </div>
}
