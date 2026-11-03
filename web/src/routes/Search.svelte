<script lang="ts">
  import { APPS } from '../../../shared/apps.ts'
  import type { CtSearch } from '../../../shared/ivysilani.ts'
  import type { Channel } from '../../../shared/m3u.ts'
  import { LANGUAGE_NAMES, type MediaResult, type MediaSearch, type SearchProvider } from '../../../shared/media.ts'
  import { matchScore } from '../../../shared/text.ts'
  import { filterFilms, groupFilms, sortFilms, type Film, type FilmArt, type FilmSort, type Quality } from '../../../shared/release.ts'
  import Card from '../components/Card.svelte'
  import FilmCard from '../components/FilmCard.svelte'
  import Icon from '../components/Icon.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { launchApp } from '../lib/actions.ts'
  import { hub, hubApi, loadChannels } from '../lib/hub.svelte.ts'
  import { itemTitle, jellyfin, type Item } from '../lib/jellyfin.ts'
  import { filmArt } from '../lib/films.svelte.ts'
  import { hashFor, nav, type Route } from '../lib/router.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'

  /** Search across the Jellyfin library, IPTV, iVysílání, torrent films and the streaming apps. */
  let props: Omit<Extract<Route, { name: 'search' }>, 'name'> = $props()

  const SORTS: [FilmSort, string][] = [
    ['relevance', 'Nejlepší shoda'], ['seeders', 'Nejvíc zdrojů'], ['rating', 'Nejlépe hodnocené'],
    ['newest', 'Nejnovější'], ['oldest', 'Nejstarší'], ['name', 'Název A–Z'],
  ]
  const QUALITIES: Quality[] = ['4K', 'Full HD', 'HD', 'SD']
  const YEARS: [string, string][] = [
    ['2020-', 'Od 2020'], ['2010-2019', '2010–2019'], ['2000-2009', '2000–2009'], ['1990-1999', '1990–1999'],
    ['1980-1989', '1980–1989'], ['1960-1979', '1960–1979'], ['-1959', 'Před 1960'],
  ]

  // svelte-ignore state_referenced_locally
  let query = $state(props.query ?? '')
  // svelte-ignore state_referenced_locally
  let sort = $state<FilmSort>(SORTS.some(([v]) => v === props.sort) ? (props.sort as FilmSort) : 'relevance')
  // svelte-ignore state_referenced_locally
  let quality = $state<Quality | ''>(QUALITIES.includes(props.quality as Quality) ? (props.quality as Quality) : '')
  // svelte-ignore state_referenced_locally
  let years = $state(YEARS.some(([v]) => v === props.years) ? props.years! : '')
  // svelte-ignore state_referenced_locally
  let genre = $state(props.genre ?? '')
  // svelte-ignore state_referenced_locally
  let available = $state(props.available === '1')
  // Artwork per film: ratings and genres for sorting and filtering.
  let arts = $state<Record<string, FilmArt | null>>({})
  let items = $state<Item[]>([])
  let channels = $state<Channel[]>([])
  let films = $state<MediaResult[]>([])
  let ct = $state<CtSearch | null>(null)
  let busy = $state(false)
  let providers = $state<SearchProvider[]>([])
  let searchError = $state('')
  // Torrent films: '' = any language, else audio or subtitles in that language.
  // svelte-ignore state_referenced_locally
  let lang = $state(props.lang ?? '')
  // svelte-ignore state_referenced_locally
  let withSubs = $state(props.subs === '1')
  // Before typing: the most watched archive films to browse.
  let popular = $state<MediaResult[]>([])
  let field: HTMLInputElement | undefined = $state()

  $effect(() => {
    hubApi<{ archive: MediaResult[] }>('/api/media/browse').then((d) => (popular = d.archive), () => {})
  })

  // The query, filters and order stay in the address, so Back returns to the same results.
  $effect(() => {
    history.replaceState(null, '', hashFor({
      name: 'search', query: query.trim(), sort: sort === 'relevance' ? '' : sort, quality, years, genre, lang,
      subs: withSubs ? '1' : '', available: available ? '1' : '',
    }))
  })

  $effect(() => {
    const q = query.trim()
    const filter = { lang, withSubs }
    providers = []
    searchError = ''
    films = []
    items = []
    channels = []
    ct = null
    if (q.length < 2) {
      busy = false
      return
    }
    let cancelled = false
    let poll: ReturnType<typeof setTimeout> | undefined
    let libraryBusy = true
    let mediaBusy = !!hub.config
    busy = true
    const updateBusy = () => !cancelled && (busy = libraryBusy || mediaBusy)
    const loadFilms = async () => {
      try {
        const data = await hubApi<MediaSearch>(`/api/media/search?progressive=1&q=${encodeURIComponent(q)}&lang=${filter.lang}&subs=${filter.withSubs ? 1 : 0}`)
        if (cancelled) return
        films = data.results
        providers = data.providers
        mediaBusy = data.pending
        updateBusy()
        if (data.pending) poll = setTimeout(loadFilms, 1500)
      } catch {
        if (cancelled) return
        mediaBusy = false
        searchError = 'Hledání torrentů není dostupné. Zkontrolujte spojení s hubem.'
        updateBusy()
      }
    }
    // Library and channels show independently of slow torrent indexers.
    const timer = setTimeout(() => {
      const jf = jellyfin()
      void Promise.all([
        jf ? jf.search(q).catch(() => [] as Item[]) : Promise.resolve([] as Item[]),
        hub.config?.features.iptv ? loadChannels().catch(() => [] as Channel[]) : Promise.resolve([] as Channel[]),
      ]).then(([found, all]) => {
        if (cancelled) return
        items = found
        channels = all.filter((ch) => matchScore(q, ch.name) > 0).slice(0, 12)
        libraryBusy = false
        updateBusy()
      })
      if (hub.config) {
        void loadFilms()
        hubApi<CtSearch>(`/api/ct/search?q=${encodeURIComponent(q)}`).then((r) => !cancelled && (ct = r), () => {})
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(poll)
    }
  })

  const jf = $derived(settings.jellyfin ? jellyfin() : null)
  const apps = $derived(query.trim().length >= 2 ? APPS.filter((a) => matchScore(query, a.name) > 0) : [])
  const nothing = $derived(query.trim().length >= 2 && !busy && !items.length && !channels.length && !apps.length && !films.length && !ct?.shows.length)
  const pending = $derived(providers.filter((p) => p.state === 'pending').map((p) => p.name))
  const failed = $derived(providers.filter((p) => p.state === 'error').map((p) => p.name))
  const browsing = $derived(query.trim().length < 2)
  const allFilms = $derived(groupFilms(browsing ? popular : films))

  // The same cached lookups the tiles make.
  $effect(() => {
    for (const f of allFilms) {
      if (f.key in arts) continue
      arts[f.key] = null
      void filmArt(f.name, f.year).then((a) => (arts[f.key] = a))
    }
  })

  const range = $derived(years ? years.split('-').map((y) => Number(y) || undefined) : [])
  const shown = $derived.by(() => {
    const narrowed = filterFilms(allFilms, { quality: quality || undefined, available, from: range[0], to: range[1] })
      .filter((f) => !genre || arts[f.key]?.genres.includes(genre))
    return sortFilms(narrowed, sort, (f: Film) => arts[f.key]?.rating)
  })
  // Genres of the films found, the most common first.
  const genres = $derived.by(() => {
    const count = new Map<string, number>()
    for (const f of allFilms) for (const g of arts[f.key]?.genres ?? []) count.set(g, (count.get(g) ?? 0) + 1)
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs')).map(([g]) => g)
  })
  const filtered = $derived(!!(quality || years || genre || available))
  const clearFilters = () => {
    quality = ''
    years = ''
    genre = ''
    available = false
  }
  const langs = $derived(['', settings.prefLang, ...(settings.prefLang === 'en' ? [] : ['en'])])
</script>

<div class="nf nf-page">
  <header class="nf-top">
    <button class="nf-circle dark" aria-label="Zpět" onclick={nav.back}><Icon name="back" size={22} /></button>
    <label class="nf-search">
      <Icon name="search" size={22} />
      <!-- svelte-ignore a11y_autofocus -->
      <input type="search" bind:this={field} bind:value={query} placeholder="Filmy, seriály, kanály, pořady…" aria-label="Hledat" autofocus />
      {#if query}<button class="nf-clear" aria-label="Vymazat" onclick={() => { query = ''; field?.focus() }}><Icon name="close" size={20} /></button>{/if}
    </label>
    <button class="nf-circle dark" aria-label="Domů" onclick={nav.home}><Icon name="home" size={20} /></button>
  </header>

  {#if hub.config}
    <div class="nf-toolbar">
      <div class="nf-filters">
        {#if !browsing}
          {#each langs as l (l || 'any')}
            <button class="nf-pill" class:on={lang === l} onclick={() => (lang = l)}>{l ? LANGUAGE_NAMES[l] ?? l : 'Všechny jazyky'}</button>
          {/each}
          <button class="nf-pill" class:on={withSubs} aria-pressed={withSubs} onclick={() => (withSubs = !withSubs)}>Jen s titulky</button>
        {/if}
        <button class="nf-pill" class:on={available} aria-pressed={available} onclick={() => (available = !available)}>Jen dostupné</button>
        <label class="tp-select" class:on={!!quality}>
          <span>Kvalita</span>
          <select bind:value={quality}>
            <option value="">Všechny</option>
            {#each QUALITIES as q (q)}<option value={q}>{q}</option>{/each}
          </select>
        </label>
        <label class="tp-select" class:on={!!years}>
          <span>Rok</span>
          <select bind:value={years}>
            <option value="">Všechny</option>
            {#each YEARS as [v, label] (v)}<option value={v}>{label}</option>{/each}
          </select>
        </label>
        {#if genres.length || genre}
          <label class="tp-select" class:on={!!genre}>
            <span>Žánr</span>
            <select bind:value={genre}>
              <option value="">Všechny</option>
              {#each genre && !genres.includes(genre) ? [genre, ...genres] : genres as g (g)}<option value={g}>{g}</option>{/each}
            </select>
          </label>
        {/if}
        {#if filtered}<button class="link" onclick={clearFilters}>Zrušit filtry</button>{/if}
      </div>
      <label class="tp-select nf-sort">
        <span>Řadit</span>
        <select bind:value={sort}>{#each SORTS as [v, label] (v)}<option value={v}>{label}</option>{/each}</select>
      </label>
    </div>
  {/if}
  {#if busy}<Spinner label={pending.length ? `Ještě hledám: ${pending.join(', ')}…` : 'Hledám…'} />{/if}
  {#if failed.length}<p class="muted">Nedostupné zdroje: {failed.join(', ')}.</p>{/if}
  {#if searchError}<p class="message">{searchError}</p>{/if}
  {#if nothing}
    <div class="nf-empty">
      <p>Pro „{query.trim()}“ jsme nic nenašli.</p>
      <ul><li>Zkuste jiná klíčová slova nebo původní název filmu</li><li>Hledejte podle roku, např. „Matrix 1999“</li><li>Vypněte filtr jazyka a titulků</li></ul>
    </div>
  {/if}

  {#if allFilms.length}
    <h2 class="nf-h2">
      {browsing ? 'Oblíbené ve sbírce' : 'Filmy'}
      <span class="muted">{filtered ? `${shown.length} z ${allFilms.length}` : allFilms.length}{browsing ? '' : ` pro „${query.trim()}“`}</span>
    </h2>
    {#if shown.length}
      <div class="nf-grid">{#each shown as f (f.key)}<FilmCard film={f} />{/each}</div>
    {:else}
      <p class="nf-empty-filter">Filtrům neodpovídá žádný film. <button class="link" onclick={clearFilters}>Zrušit filtry</button></p>
    {/if}
  {/if}
  {#if jf && items.length}
    <Row title="Z vaší Knihovny">
      {#each items as i (i.Id)}
        <Card landscape title={i.Type === 'Episode' ? `${i.SeriesName} · ${itemTitle(i)}` : i.Name} subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined}
          image={jf.cardImage(i, true, 500)} fallback={i.Name} onclick={() => nav.push({ name: 'detail', itemId: i.Id })} />
      {/each}
    </Row>
  {/if}
  {#if ct?.shows.length}
    <Row title="iVysílání">
      {#each ct.shows.slice(0, 12) as s (s.id)}
        <Card landscape title={s.title} image={s.image} onclick={() => nav.push({ name: 'ct-show', id: s.id, title: s.title })} />
      {/each}
    </Row>
  {/if}
  {#if channels.length}
    <Row title="Televize">
      {#each channels as ch (ch.id)}
        <Card landscape title={ch.name} image={ch.logo} fallback={ch.name} onclick={() => nav.push({ name: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })} />
      {/each}
    </Row>
  {/if}
  {#if apps.length}
    <h2 class="nf-h2">Aplikace</h2>
    <div class="grid grid-wide">
      {#each apps as a (a.id)}
        <button class="app-chip" style:background={a.background} onclick={() => launchApp(a)}>{a.name}</button>
      {/each}
    </div>
  {/if}
</div>
