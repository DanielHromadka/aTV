<script lang="ts">
  import type { Film, FilmArt } from '../../../shared/release.ts'
  import { filmArt, openFilm } from '../lib/films.svelte.ts'
  import { hubAsset } from '../lib/hub.svelte.ts'
  import Icon from './Icon.svelte'

  /** A Netflix-like tile: artwork with the title; on hover it grows and offers play, download and details. */
  let { film }: { film: Film } = $props()

  let art = $state<FilmArt | null>(null)
  let failed = $state(false)
  $effect(() => {
    let cancelled = false
    art = null
    void filmArt(film.name, film.year).then((a) => !cancelled && (art = a))
    return () => {
      cancelled = true
    }
  })

  const image = $derived(art?.backdrop ?? hubAsset(film.poster) ?? art?.poster)
  const title = $derived(art?.title ?? film.name)
  const seeders = $derived(film.releases.reduce((n, r) => n + (r.seeders ?? 0), 0))
  const versions = $derived(film.releases.length)
</script>

<article class="fc">
  <div class="fc-inner">
    <button class="fc-hit" onclick={() => openFilm(film)} aria-label="{title}{film.year ? ` (${film.year})` : ''}">
      <span class="fc-image">
        {#if image && !failed}
          <img src={image} alt="" loading="lazy" onerror={() => (failed = true)} />
        {:else}
          <span class="fc-fallback"></span>
        {/if}
        <span class="fc-title">{title}</span>
        {#if film.quality === '4K'}<span class="fc-badge">4K</span>{/if}
      </span>
    </button>
    <div class="fc-info">
      <div class="fc-actions">
        <button class="nf-circle white" aria-label="Přehrát {title}" onclick={() => openFilm(film, 'play')}><Icon name="start" size={18} stroke={2.4} /></button>
        <button class="nf-circle" aria-label="Stáhnout {title} do Knihovny" onclick={() => openFilm(film, 'download')}><Icon name="download" size={18} stroke={2.2} /></button>
        <button class="nf-circle push" aria-label="Podrobnosti {title}" onclick={() => openFilm(film)}><Icon name="down" size={18} stroke={2.4} /></button>
      </div>
      <div class="fc-meta">
        {#if art?.rating}<span class="nf-green">★ {art.rating.toLocaleString('cs', { maximumFractionDigits: 1 })}</span>{/if}
        {#if film.year}<span>{film.year}</span>{/if}
        {#if film.quality}<span class="nf-box">{film.quality === 'Full HD' ? 'HD' : film.quality}</span>{/if}
        {#if seeders}<span class="nf-green">{seeders} seedů</span>{/if}
      </div>
      <div class="fc-tags">
        {#if art?.genres.length}{art.genres.join(' • ')}{:else}{versions} {versions === 1 ? 'verze' : versions <= 4 ? 'verze' : 'verzí'}{/if}
      </div>
    </div>
  </div>
</article>
