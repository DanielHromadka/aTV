import { useEffect, useState } from 'preact/hooks'
import type { Channel } from '../../shared/m3u.ts'
import { matchScore } from '../../shared/text.ts'
import { launchApp } from '../actions'
import { Card, Keyboard, Message, Spinner, TextField, applyKey } from '../components'
import { config, nav, useScreenText, useStore } from '../state'
import { hubApi, loadChannels } from '../services/hub'
import { itemTitle, jellyfin, type Item } from '../services/jellyfin'
import { APPS } from '../../shared/apps.ts'
import { LANGUAGE_NAMES, type MediaResult, type MediaSearch, type SearchProvider } from '../../shared/media.ts'
import { settings } from '../services/settings'
import { ResultCard } from './Media'
import type { CtSearch } from '../../shared/ivysilani.ts'

/** Search across the Jellyfin library, IPTV channels and the streaming apps. */
export function Search({ query: initial = '', screenKey }: { query?: string; screenKey: number }) {
  const c = useStore(config)
  const [query, setQuery] = useState(initial)
  const [items, setItems] = useState<Item[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [films, setFilms] = useState<MediaResult[]>([])
  const [ct, setCt] = useState<CtSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<SearchProvider[]>([])
  const [searchError, setSearchError] = useState('')
  const s = useStore(settings)
  // Torrent films: '' = any language, else audio or subtitles in that language.
  const [lang, setLang] = useState('')
  const [withSubs, setWithSubs] = useState(false)

  useScreenText(screenKey, (text) => setQuery(text))

  useEffect(() => {
    const q = query.trim()
    setProviders([])
    setSearchError('')
    setFilms([])
    setItems([])
    setChannels([])
    setCt(null)
    if (q.length < 2) { setBusy(false); return }
    let cancelled = false
    let poll: number | undefined
    let libraryBusy = true
    let mediaBusy = !!c
    setBusy(true)
    const updateBusy = () => { if (!cancelled) setBusy(libraryBusy || mediaBusy) }
    const loadFilms = async () => {
      try {
        const data = await hubApi<MediaSearch>(`/api/media/search?progressive=1&q=${encodeURIComponent(q)}&lang=${lang}&subs=${withSubs ? 1 : 0}`)
        if (cancelled) return
        setFilms(data.results)
        setProviders(data.providers)
        mediaBusy = data.pending
        updateBusy()
        if (data.pending) poll = window.setTimeout(loadFilms, 1500)
      } catch {
        if (cancelled) return
        mediaBusy = false
        setSearchError('Hledání torrentů není dostupné. Zkontrolujte spojení s hubem.')
        updateBusy()
      }
    }
    // Library and channels render independently of slow torrent indexers.
    const timer = window.setTimeout(() => {
      const jf = jellyfin()
      Promise.all([
        jf ? jf.search(q).catch(() => [] as Item[]) : Promise.resolve([] as Item[]),
        c?.features.iptv ? loadChannels().catch(() => [] as Channel[]) : Promise.resolve([] as Channel[]),
      ]).then(([found, all]) => {
        if (cancelled) return
        setItems(found)
        setChannels(all.filter((ch) => matchScore(q, ch.name) > 0).slice(0, 12))
        libraryBusy = false
        updateBusy()
      })
      if (c) {
        void loadFilms()
        hubApi<CtSearch>(`/api/ct/search?q=${encodeURIComponent(q)}`).then((r) => !cancelled && setCt(r), () => {})
      }
    }, 400)
    return () => { cancelled = true; window.clearTimeout(timer); window.clearTimeout(poll) }
  }, [query, c, lang, withSubs])

  const jf = jellyfin()
  const apps = query.trim().length >= 2 ? APPS.filter((a) => matchScore(query, a.name) > 0) : []
  const nothing = query.trim().length >= 2 && !busy && !items.length && !channels.length && !apps.length && !films.length && !ct?.shows.length
  const pendingProviders = providers.filter((p) => p.state === 'pending').map((p) => p.name)
  const failedProviders = providers.filter((p) => p.state === 'error').map((p) => p.name)
  const langs = ['', s.prefLang, ...(s.prefLang === 'en' ? [] : ['en'])]

  return (
    <div class="screen-body search">
      <div class="search-left">
        <TextField value={query} onChange={setQuery} label="Hledat" placeholder="Hledat…" />
        <Keyboard value={query} onChange={setQuery} candidates={[...films.map((f) => f.title), ...items.map((i) => i.Name), ...channels.map((ch) => ch.name), ...APPS.map((a) => a.name)]} onKey={(k) => setQuery((q) => applyKey(q, k))} />
        <div class="search-hint">Psát můžete i z mobilu</div>
      </div>
      <div class="search-results" data-scroll="y">
        {c && query.trim().length >= 2 && (
          <div class="buttons chips">
            {langs.map((l) => (
              <div key={l || 'any'} class={`btn btn-small${lang === l ? ' btn-primary' : ''}`} data-focus={`lang-${l || 'any'}`} onClick={() => setLang(l)}>
                {(lang === l ? '✓ ' : '') + (l ? LANGUAGE_NAMES[l] ?? l : 'Všechny jazyky')}
              </div>
            ))}
            <div class={`btn btn-small${withSubs ? ' btn-primary' : ''}`} data-focus="subs" onClick={() => setWithSubs(!withSubs)}>
              {(withSubs ? '✓ ' : '') + 'Jen s titulky'}
            </div>
          </div>
        )}
        {busy && <Spinner label={pendingProviders.length ? `Ještě hledám: ${pendingProviders.join(', ')}…` : 'Hledám…'} />}
        {failedProviders.length > 0 && <Message>Nedostupné zdroje: {failedProviders.join(', ')}.</Message>}
        {searchError && <Message>{searchError}</Message>}
        {nothing && <Message>Nic nenalezeno.</Message>}
        {apps.length > 0 && (
          <div class="result-group">
            <h2 class="row-title">Aplikace</h2>
            <div class="grid">
              {apps.map((a) => (
                <div class="tile tile-small" key={a.id} data-focus={`app-${a.id}`} style={{ background: a.background }} onClick={() => launchApp(a)}>
                  <span class="tile-name">{a.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {channels.length > 0 && (
          <div class="result-group">
            <h2 class="row-title">Televize</h2>
            <div class="grid">
              {channels.map((ch) => (
                <Card key={ch.id} id={`ch-${ch.id}`} landscape title={ch.name} image={ch.logo} fallback={ch.name}
                  onClick={() => nav.push({ type: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })} />
              ))}
            </div>
          </div>
        )}
        {ct && ct.shows.length > 0 && (
          <div class="result-group">
            <h2 class="row-title">iVysílání</h2>
            <div class="grid">
              {ct.shows.slice(0, 12).map((s) => (
                <Card key={s.id} id={`ct-${s.id}`} landscape title={s.title} image={s.image}
                  onClick={() => nav.push({ type: 'ct-show', id: s.id, title: s.title })} />
              ))}
            </div>
          </div>
        )}
        {films.length > 0 && (
          <div class="result-group">
            <h2 class="row-title">Filmy (torrenty)</h2>
            <div class="grid">
              {films.map((r) => (
                <ResultCard key={r.id} r={r} prefix="film" />
              ))}
            </div>
          </div>
        )}
        {jf && items.length > 0 && (
          <div class="result-group">
            <h2 class="row-title">Knihovna</h2>
            <div class="grid">
              {items.map((i) => (
                <Card key={i.Id} id={`res-${i.Id}`} title={i.Type === 'Episode' ? `${i.SeriesName} · ${itemTitle(i)}` : i.Name}
                  subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined} image={jf.cardImage(i, false, 300)}
                  onClick={() => nav.push({ type: 'detail', itemId: i.Id })} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
