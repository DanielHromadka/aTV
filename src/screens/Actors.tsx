import { useEffect, useState } from 'preact/hooks'
import type { Actor, ActorPage, Filmography } from '../../shared/actors.ts'
import { Button, Card, Message, Row, Spinner } from '../components'
import { config, nav, useStore } from '../state'
import { loadActors, loadFilmography } from '../services/actors'
import { settings } from '../services/settings'
import { focusById } from '../nav/focus'

export function ActorCard({ actor }: { actor: Actor }) {
  return <Card id={`actor-${actor.source}-${actor.id}`} title={actor.name} image={actor.photo} fallback={actor.name}
    subtitle={actor.knownFor} onClick={() => nav.push({ type: 'actor', actor })} />
}

export function Actors() {
  const c = useStore(config)
  const s = useStore(settings)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [attempt, retry] = useState(0)
  const [data, setData] = useState<ActorPage | null>(null)
  const [error, setError] = useState('')
  const changePage = (next: number) => { focusById('actor-search'); setPage(next) }
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    loadActors(query, page).then((v) => !cancelled && setData(v), (e: Error) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [query, page, attempt, c?.features.actors, s.jellyfin])
  return <div class="screen-body padded actors-screen" data-scroll="y">
    <h1 class="screen-title">Herci</h1>
    <div class="muted">Vyberte herce a prohlédněte si filmy, ve kterých hrál.</div>
    <div class="buttons">
      <Button id="actor-search" primary autofocus label={query ? `Hledat: ${query}` : 'Hledat herce'} onClick={() => nav.push({ type: 'keyboard', title: 'Jméno herce', value: query, onDone: (q) => { setPage(1); setQuery(q) } })} />
      {query && <Button id="actor-clear" label="Zobrazit všechny" onClick={() => { setQuery(''); setPage(1) }} />}
    </div>
    {error && <><Message>{error}</Message><div class="buttons">
      <Button id="actors-retry" label="Zkusit znovu" onClick={() => retry((v) => v + 1)} />
      {!s.jellyfin && !c?.features.actors && <Button id="actors-login" label="Připojit Jellyfin" onClick={() => nav.push({ type: 'login' })} />}
    </div></>}
    {!data && !error && <Spinner label="Načítám herce…" />}
    {data && <>
      <div class="muted">{data.collection
        ? `${data.collection.title} · aktivní ${data.collection.fromYear}–${data.collection.toYear}`
        : data.source === 'tmdb' ? 'Filmová databáze TMDB' : 'Herci z vaší knihovny Jellyfin'} · strana {data.page}</div>
      {!data.actors.length && <Message>{query ? 'Pro toto jméno nebyli nalezeni žádní herci.' : 'Na této stránce nejsou žádní herci.'}</Message>}
      <div class="grid actors-grid">{data.actors.map((a) => <ActorCard key={a.id} actor={a} />)}</div>
      <div class="buttons">
        {page > 1 && <Button id="actors-prev" label="Předchozí strana" onClick={() => changePage(page - 1)} />}
        {data.more && <Button id="actors-next" label="Další strana" onClick={() => changePage(page + 1)} />}
      </div>
    </>}
  </div>
}

export function ActorDetail({ actor }: { actor: Actor }) {
  const [data, setData] = useState<Filmography | null>(null)
  const [error, setError] = useState('')
  const [attempt, retry] = useState(0)
  const [oldest, setOldest] = useState(false)
  const [fullBio, setFullBio] = useState(false)
  useEffect(() => {
    let cancelled = false
    setData(null); setError('')
    loadFilmography(actor).then((v) => !cancelled && setData(v), (e: Error) => !cancelled && setError(e.message))
    return () => { cancelled = true }
  }, [actor.id, actor.source, attempt])
  const person = data?.actor || actor
  const movies = data ? [...data.movies].sort((a, b) => {
    if (!a.year || !b.year) return a.year ? -1 : b.year ? 1 : a.title.localeCompare(b.title, 'cs')
    return (oldest ? a.year - b.year : b.year - a.year) || a.title.localeCompare(b.title, 'cs')
  }) : []
  return <div class="screen-body padded actors-screen" data-scroll="y">
    <div class="actor-intro">
      {person.photo && <img class="actor-photo" src={person.photo} alt={person.name} />}
      <div><h1 class="screen-title">{person.name}</h1>
        <div class="muted">{actor.source === 'tmdb' ? 'Filmové role · TMDB' : 'Filmy dostupné ve vaší knihovně Jellyfin'}</div>
        {data?.biography && <>
          <p class="actor-biography">{!fullBio && data.biography.length > 500 ? `${data.biography.slice(0, 500)}…` : data.biography}</p>
          {data.biography.length > 500 && <Button id="actor-bio" label={fullBio ? 'Zkrátit životopis' : 'Celý životopis'} onClick={() => setFullBio((v) => !v)} />}
        </>}
      </div>
    </div>
    {error && <><Message>{error}</Message><Button id="actor-retry" label="Zkusit znovu" onClick={() => retry((v) => v + 1)} /></>}
    {!data && !error && <Spinner label="Načítám filmografii…" />}
    {data && <>
      <h2 class="section">Filmografie ({movies.length})</h2>
      <div class="buttons"><Button id="actor-sort" autofocus label={oldest ? 'Řazení: od nejstarších' : 'Řazení: od nejnovějších'} onClick={() => setOldest((v) => !v)} /></div>
      {actor.source === 'tmdb' && <div class="muted">Vyberte film a vyhledejte dostupné verze v aTV.</div>}
      {!movies.length && <Message>Pro tohoto herce nejsou dostupné žádné filmy.</Message>}
      <div class="grid actors-grid">{movies.map((m) => <Card key={m.id} id={`actor-film-${m.id}`} title={m.title}
        image={m.poster} fallback={m.title} subtitle={[m.year || 'Rok neuveden', m.role].filter(Boolean).join(' · ')}
        onClick={() => nav.push(m.source === 'jellyfin' ? { type: 'detail', itemId: m.id } : { type: 'search', query: `${m.originalTitle}${m.year ? ` ${m.year}` : ''}` })} />)}</div>
    </>}
  </div>
}

/** Home preview; the full browser remains reachable from the Herci tile. */
export function ActorsRow({ active }: { active: boolean }) {
  const c = useStore(config)
  const s = useStore(settings)
  const [actors, setActors] = useState<Actor[]>([])
  const [title, setTitle] = useState('Herci')
  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadActors().then((v) => {
      if (cancelled) return
      setActors(v.actors.slice(0, 12)); setTitle(v.collection?.title || 'Herci')
    }, () => !cancelled && setActors([]))
    return () => { cancelled = true }
  }, [active, c?.features.actors, s.jellyfin])
  if (!actors.length) return null
  return <Row title={title}>{actors.map((a) => <ActorCard key={a.id} actor={a} />)}<Button id="all-actors" label="Všichni herci" onClick={() => nav.push({ type: 'actors' })} /></Row>
}
