import { useEffect, useState } from 'preact/hooks'
import type { Discography, Musician, MusicianPage } from '../../shared/musicians.ts'
import { Button, Card, Message, Row, Spinner } from '../components'
import { nav } from '../state'
import { hubApi } from '../services/hub'
import { focusById } from '../nav/focus'

function MusicianCard({ musician }: { musician: Musician }) {
  return <Card id={`musician-${musician.id}`} title={musician.name} image={musician.photo} fallback={musician.name}
    onClick={() => nav.push({ type: 'musician', id: musician.id })} />
}
export function Musicians() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [attempt, retry] = useState(0)
  const [data, setData] = useState<MusicianPage | null>(null)
  const [error, setError] = useState('')
  const changePage = (next: number) => { focusById('musician-search'); setPage(next) }
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    hubApi<MusicianPage>(`/api/musicians?q=${encodeURIComponent(query)}&page=${page}`).then(d => !cancelled && setData(d), (e: Error) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [query, page, attempt])
  return <div class="screen-body padded actors-screen" data-scroll="y">
    <h1 class="screen-title">Muzikanti</h1>
    <p class="muted">300 známých interpretů a kapel · světová, česká a slovenská hudba</p>
    <div class="buttons"><Button id="musician-search" primary autofocus label={query ? `Hledat: ${query}` : 'Hledat muzikanta'}
      onClick={() => nav.push({ type: 'keyboard', title: 'Jméno interpreta nebo kapely', value: query, onDone: q => { setPage(1); setQuery(q) } })} />
      {query && <Button id="musician-clear" label="Zobrazit všechny" onClick={() => { setPage(1); setQuery('') }} />}</div>
    {error && <><Message>{error}</Message><Button id="musicians-retry" label="Zkusit znovu" onClick={() => retry(n => n + 1)} /></>}
    {!data && !error && <Spinner label="Načítám muzikanty…" />}
    {data && <><p class="muted">{data.total} interpretů · strana {data.page} · kurátorský výběr, nikoli žebříček popularity</p>
      {!data.musicians.length && <Message>Pro toto jméno není ve výběru žádný interpret.</Message>}
      <div class="grid actors-grid">{data.musicians.map(m => <MusicianCard key={m.id} musician={m} />)}</div>
      <div class="buttons">{data.page > 1 && <Button id="musicians-prev" label="Předchozí strana" onClick={() => changePage(data.page - 1)} />}
        {data.more && <Button id="musicians-next" label="Další strana" onClick={() => changePage(data.page + 1)} />}</div>
      <p class="muted">Fotografie a diskografie: Deezer. Dostupnost vydání se může lišit podle katalogu.</p></>}
  </div>
}
export function MusicianDetail({ id }: { id: string }) {
  const [data, setData] = useState<Discography | null>(null)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  const [type, setType] = useState('all')
  const [oldest, setOldest] = useState(false)
  const [limit, setLimit] = useState(48)
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    hubApi<Discography>(`/api/musicians/${id}`).then(d => !cancelled && setData(d), (e: Error) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [id, attempt])
  if (error) return <div class="screen-body padded"><Message>{error}</Message><Button id="musician-retry" label="Zkusit znovu" onClick={() => retry(n=>n+1)} /></div>
  if (!data) return <Spinner label="Načítám diskografii…" />
  const releases = data.releases.filter(r => type === 'all' || r.type === type)
  if (oldest) releases.reverse()
  const search = (title: string) => nav.push({ type: 'audio', query: `${data.musician.name} ${title}` })
  return <div class="screen-body padded actors-screen" data-scroll="y">
    <div class="actor-intro musician-intro">
      {data.musician.photo && <img class="actor-photo" src={data.musician.photo} alt={data.musician.name} />}
      <div><h1 class="screen-title">{data.musician.name}</h1><p class="muted">{data.releases.length} vydání · alba, singly a EP</p>
        <p class="actor-biography">Vyberte album nebo skladbu a vyhledejte dostupnou nahrávku v Audiu.</p>
        <a href={data.musician.link} target="_blank" rel="noreferrer" data-focus="musician-deezer">Profil a metadata na Deezeru ↗</a></div>
    </div>
    {!!data.tracks.length && <Row title="Známé skladby">{data.tracks.map(t => <Card key={t.id} id={`song-${t.id}`} title={t.title} subtitle={t.album} image={t.cover} onClick={() => search(t.title)} />)}</Row>}
    <h2 class="section">Diskografie ({releases.length})</h2>
    <div class="buttons">{[['all','Všechna vydání'],['album','Alba'],['single','Singly'],['ep','EP']].map(([value,label]) =>
      <Button key={value} id={`music-filter-${value}`} primary={type === value} label={label} onClick={() => { setType(value); setLimit(48) }} />)}
      <Button id="music-sort" label={oldest ? 'Od nejstarších' : 'Od nejnovějších'} onClick={() => { setOldest(!oldest); setLimit(48) }} /></div>
    {!releases.length && <Message>V této kategorii nejsou dostupná vydání.</Message>}
    <div class="grid actors-grid music-releases">{releases.slice(0,limit).map(r => <Card key={r.id} id={`release-${r.id}`} title={r.title} image={r.cover}
      subtitle={[r.year, r.type === 'single' ? 'Singl' : r.type === 'ep' ? 'EP' : 'Album'].filter(Boolean).join(' · ')} onClick={() => search(r.title)} />)}</div>
    {releases.length > limit && <Button id="music-more" label={`Další vydání (${releases.length - limit})`} onClick={() => setLimit(limit + 48)} />}
    <p class="muted">Fotografie, obaly a diskografie: Deezer. Různé edice stejného alba jsou uvedené samostatně.</p>
  </div>
}
export function MusiciansRow({ active }: { active: boolean }) {
  const [musicians, setMusicians] = useState<Musician[]>([])
  useEffect(() => {
    if (!active) return
    let cancelled = false
    hubApi<MusicianPage>('/api/musicians').then(d => { if (!cancelled) setMusicians(d.musicians.slice(0,12)) }, () => { if (!cancelled) setMusicians([]) })
    return () => { cancelled = true }
  }, [active])
  return musicians.length ? <Row title="300 známých muzikantů">{musicians.map(m => <MusicianCard key={m.id} musician={m} />)}<Button id="all-musicians" label="Všichni muzikanti" onClick={() => nav.push({ type: 'musicians' })} /></Row> : null
}
