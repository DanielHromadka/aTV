<script lang="ts">
  import type { MediaSearch } from '../../../shared/media.ts'
  import { groupFilms } from '../../../shared/release.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import FilmCard from '../components/FilmCard.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi, hubAsset } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** Audio (music, audiobooks) or films from the Jackett sources, optionally from one indexer only. */
  let { kind, indexer, label, query: initial = '' }: { kind: 'audio' | 'video'; indexer?: string; label?: string; query?: string } = $props()

  // svelte-ignore state_referenced_locally
  let query = $state(initial)
  let data = $state<MediaSearch | null>(null)
  let error = $state('')

  $effect(() => {
    const q = query.trim()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    data = null
    error = ''
    const load = async () => {
      try {
        const result = await hubApi<MediaSearch>(`/api/${kind === 'audio' ? 'audio' : 'sources'}/search?q=${encodeURIComponent(q)}&indexer=${encodeURIComponent(indexer ?? '')}`)
        if (cancelled) return
        data = result
        if (result.pending) timer = setTimeout(load, 1500)
      } catch {
        if (!cancelled) error = 'Hledání není dostupné. Zkontrolujte hub a zkuste dotaz znovu.'
      }
    }
    if (q.length >= 2) timer = setTimeout(load, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })
</script>

<Page title={label ?? 'Audio'} subtitle="{kind === 'audio' ? 'Hudba, alba, singly a audioknihy' : 'Filmy a seriály'}{label ? ` · Hledání pouze v ${label}` : ' · Zdroje z Jackettu'}">
  <!-- svelte-ignore a11y_autofocus -->
  <input class="search-field" type="search" bind:value={query} autofocus aria-label="Hledat"
    placeholder={kind === 'audio' ? 'Interpret, skladba, album nebo autor…' : 'Název filmu…'} />
  {#if error}<p class="message">{error}</p>{/if}
  {#if query.trim().length >= 2 && !data && !error}<Spinner label="Hledám…" />{/if}
  {#each data?.providers.filter((p) => p.state === 'error') ?? [] as p (p.id)}<p class="muted">{p.name}: zdroj je nyní nedostupný.</p>{/each}
  {#if data?.pending}<Spinner label="Další zdroje ještě hledají…" />{/if}
  {#if data && !data.pending && !data.results.length}
    <p class="message">{data.providers.length ? 'Nic nenalezeno. Zkuste jiný název nebo autora.' : 'V Jackettu není nastavený odpovídající zdroj.'}</p>
  {/if}
  {#if kind === 'video'}
    <div class="nf-grid">{#each groupFilms(data?.results ?? []) as f (f.key)}<FilmCard film={f} />{/each}</div>
  {:else}
  <div class="grid">
    {#each data?.results ?? [] as r (r.id)}
        <Card title={r.title} subtitle="{r.indexName ?? ''} · {r.seeders ?? 0} seedů" image={hubAsset(r.poster)} fallback={r.title}
          onclick={() => nav.push({ name: 'audio-detail', mediaId: r.id, title: r.title, poster: hubAsset(r.poster) })} />
    {/each}
  </div>
  {/if}
</Page>
