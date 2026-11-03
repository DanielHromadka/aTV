<script lang="ts">
  import type { DownloadInfo } from '../../../shared/downloads.ts'
  import type { MediaResult } from '../../../shared/media.ts'
  import { groupFilms } from '../../../shared/release.ts'
  import FilmCard from '../components/FilmCard.svelte'
  import Icon from '../components/Icon.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { mb, sources } from '../lib/actions.ts'
  import { hubApi, hubSend } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { toast } from '../lib/toast.svelte.ts'

  /** Films from the own torrent catalog and Internet Archive's most watched, and downloads to the library. */
  let data = $state<{ catalog: MediaResult[]; archive: MediaResult[] } | null>(null)
  let error = $state('')
  let downloads = $state<DownloadInfo[]>([])

  $effect(() => {
    hubApi<{ catalog: MediaResult[]; archive: MediaResult[] }>('/api/media/browse').then((d) => (data = d), (e: Error) => (error = e.message))
  })
  const loadDownloads = () => hubApi<DownloadInfo[]>('/api/downloads').then((d) => (downloads = d), () => {})
  $effect(() => {
    void loadDownloads()
    const t = setInterval(loadDownloads, 3000)
    return () => clearInterval(t)
  })

  const cancel = (d: DownloadInfo) =>
    hubSend(`/api/media/${encodeURIComponent(d.key)}/download`, 'DELETE').then(loadDownloads, (e: Error) => toast(e.message))
  const open = (d: DownloadInfo) => (d.state === 'done' ? nav.push({ name: 'library' }) : nav.push({ name: 'media-detail', mediaId: d.key, title: d.title }))
  const active = $derived(downloads.filter((d) => d.state === 'downloading' || d.state === 'copying').length)
</script>

<div class="nf nf-page">
  <header class="nf-top">
    <button class="nf-circle dark" aria-label="Zpět" onclick={nav.back}><Icon name="back" size={22} /></button>
    <h1 class="nf-h1">Archivní filmy</h1>
    <button class="nf-search nf-search-link" onclick={() => nav.push({ name: 'search' })}><Icon name="search" size={22} /> Hledat filmy…</button>
    <button class="nf-pill" onclick={() => nav.push({ name: 'actors' })}>Herci</button>
    <button class="nf-circle dark" aria-label="Domů" onclick={nav.home}><Icon name="home" size={20} /></button>
  </header>
  {#if error}<p class="message">{error}</p>{/if}
  {#if !data && !error}<Spinner />{/if}

  {#if downloads.length}
    <section class="nf-section">
      <h2 class="nf-h2">Stahování {#if active}<span class="muted">{active} probíhá</span>{/if}</h2>
      <ul class="dl-list">
        {#each downloads as d (d.key)}
          <li class="dl">
            <button class="dl-open" onclick={() => open(d)}>
              <span class="dl-icon" class:done={d.state === 'done'} class:bad={d.state === 'error'}>
                <Icon name={d.state === 'done' ? 'check' : d.state === 'error' ? 'close' : 'download'} size={22} stroke={2.2} />
              </span>
              <span class="dl-body">
                <span class="dl-title">{d.title}</span>
                <span class="dl-meta">
                  {#if d.state === 'done'}V Knihovně
                  {:else if d.state === 'copying'}Ukládám do Knihovny…
                  {:else if d.state === 'error'}Chyba: {d.error}
                  {:else}{Math.round(d.progress * 100)} % · {mb(d.downloadSpeed)}/s · {sources(d.peers)}{/if}
                </span>
                {#if d.state === 'downloading'}<span class="nf-bar"><span style:width="{d.progress * 100}%"></span></span>{/if}
              </span>
            </button>
            {#if d.state === 'downloading'}
              <button class="nf-circle dark" aria-label="Zrušit stahování {d.title}" onclick={() => cancel(d)}><Icon name="close" size={18} /></button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data?.catalog.length}
    <Row title="Můj katalog">{#each groupFilms(data.catalog) as f (f.key)}<FilmCard film={f} />{/each}</Row>
  {:else if data}
    <p class="muted">Vlastní filmy přidáte z mobilu: Ovladač → Přidat film do katalogu (magnet odkaz).</p>
  {/if}
  {#if data?.archive.length}
    <Row title="Internet Archive · nejsledovanější">{#each groupFilms(data.archive) as f (f.key)}<FilmCard film={f} />{/each}</Row>
  {/if}
</div>
