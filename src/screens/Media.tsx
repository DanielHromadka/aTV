import { useEffect, useState } from 'preact/hooks'
import { languageBadge, type MediaResult } from '../../shared/media.ts'
import { Button, Card, Message, Row, Spinner } from '../components'
import { nav } from '../state'
import { hubApi, hubUrl } from '../services/hub'

const posterUrl = (url?: string) => url?.startsWith('/api/') ? hubUrl() + url : url

export function openResult(r: MediaResult): void {
  nav.push({ type: 'media-detail', mediaId: r.id, title: r.title, poster: posterUrl(r.poster), description: r.description })
}

export function ResultCard({ r, prefix }: { r: MediaResult; prefix: string }) {
  const badge = languageBadge(r)
  return (
    <Card
      id={`${prefix}-${r.id}`}
      title={r.title}
      subtitle={[r.year, r.source === 'public' ? r.indexName : r.source === 'catalog' ? 'Můj katalog' : 'Internet Archive', badge, r.seeders !== undefined ? `${r.seeders} seedů` : '', r.size ? `${(r.size / 1_000_000_000).toFixed(2)} GB` : ''].filter(Boolean).join(' · ')}
      image={posterUrl(r.poster)}
      fallback={r.title}
      onClick={() => openResult(r)}
    />
  )
}

/** Films from the own torrent catalog and Internet Archive's most watched. */
export function Media() {
  const [data, setData] = useState<{ catalog: MediaResult[]; archive: MediaResult[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    hubApi<{ catalog: MediaResult[]; archive: MediaResult[] }>('/api/media/browse').then(setData, (e: Error) => setError(e.message))
  }, [])

  return (
    <div class="screen-body padded-top" data-scroll="y">
      <div class="padded-x">
        <h1 class="screen-title">Archivní filmy</h1>
        <div class="buttons">
          <Button id="search" primary autofocus label="⌕ Hledat filmy" onClick={() => nav.push({ type: 'search' })} />
          <Button id="browse-actors" label="Herci a filmografie" onClick={() => nav.push({ type: 'actors' })} />
        </div>
      </div>
      {error && <div class="padded-x"><Message>{error}</Message></div>}
      {!data && !error && <Spinner />}
      {data && data.catalog.length > 0 && (
        <Row title="Můj katalog">
          {data.catalog.map((r) => (
            <ResultCard key={r.id} r={r} prefix="cat" />
          ))}
        </Row>
      )}
      {data && !data.catalog.length && (
        <div class="padded-x muted">Vlastní filmy přidáte z mobilu: Ovladač → Přidat film do katalogu (magnet odkaz).</div>
      )}
      {data && data.archive.length > 0 && (
        <Row title="Internet Archive · nejsledovanější">
          {data.archive.map((r) => (
            <ResultCard key={r.id} r={r} prefix="ia" />
          ))}
        </Row>
      )}
    </div>
  )
}
