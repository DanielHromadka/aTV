<script lang="ts">
  import type { FilmArt, FilmDetails, Quality } from '../../../shared/release.ts'
  import { gb } from '../lib/films.svelte.ts'

  /** Rating, year, length and quality, then the tagline, overview, director and the leading actors. */
  let { art, details, year, quality, hdr = false, size, overview }:
    { art: FilmArt | null; details: FilmDetails | null; year?: number; quality?: Quality; hdr?: boolean; size?: number; overview?: string } = $props()

  const rating = $derived(details?.rating ?? art?.rating)
  const votes = $derived(details?.votes)
  const runtime = $derived(details?.runtime ? `${details.runtime >= 60 ? `${Math.floor(details.runtime / 60)} h ` : ''}${details.runtime % 60} min` : '')
  const text = $derived(details?.overview ?? art?.overview ?? overview)
  const genres = $derived(details?.genres.length ? details.genres : art?.genres ?? [])
  const fmt = (n: number) => n.toLocaleString('cs', { maximumFractionDigits: 1 })
</script>

<div class="bb-meta">
  {#if rating}
    <span class="bb-rating" title="Hodnocení TMDB">
      <span class="nf-green">★ {fmt(rating)}</span><span class="muted">/10{votes ? ` · ${votes >= 1000 ? `${fmt(votes / 1000)} tis.` : votes} hodnocení` : ''}</span>
    </span>
  {/if}
  {#if year}<span>{year}</span>{/if}
  {#if runtime}<span>{runtime}</span>{/if}
  {#if quality}<span class="nf-box">{quality}</span>{/if}
  {#if hdr}<span class="nf-box">HDR</span>{/if}
  {#if size}<span>{gb(size)}</span>{/if}
</div>
{#if genres.length}<div class="bb-genres">{genres.join(' • ')}</div>{/if}
{#if details?.tagline}<p class="bb-tagline">{details.tagline}</p>{/if}
{#if text}<p class="bb-overview">{text}</p>{/if}
{#if details?.cast.length || details?.directors.length}
  <dl class="bb-credits">
    {#if details.cast.length}<div><dt>Hrají:</dt> <dd>{details.cast.slice(0, 4).map((c) => c.name).join(', ')}</dd></div>{/if}
    {#if details.directors.length}<div><dt>Režie:</dt> <dd>{details.directors.join(', ')}</dd></div>{/if}
  </dl>
{/if}
