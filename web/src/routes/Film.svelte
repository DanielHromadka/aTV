<script lang="ts">
  import { LANGUAGE_NAMES } from '../../../shared/media.ts'
  import { parseRelease, type Film, type FilmArt, type FilmDetails } from '../../../shared/release.ts'
  import Billboard from '../components/Billboard.svelte'
  import Cast from '../components/Cast.svelte'
  import FilmFacts from '../components/FilmFacts.svelte'
  import Spinner from '../components/Spinner.svelte'
  import TorrentPanel from '../components/TorrentPanel.svelte'
  import { bestRelease, filmArt, filmDetails, findFilm, gb } from '../lib/films.svelte.ts'
  import { hubAsset } from '../lib/hub.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'

  /** One film: artwork and overview, Play and Download, and every release to choose from. */
  let { filmKey, query, action }: { filmKey: string; query: string; action?: 'play' | 'download' } = $props()

  let film = $state<Film | null>(null)
  let art = $state<FilmArt | null>(null)
  let details = $state<FilmDetails | null>(null)
  let error = $state('')
  let chosen = $state<string | null>(null)

  $effect(() => {
    let cancelled = false
    findFilm(filmKey, query).then((f) => {
      if (cancelled) return
      if (!f) return (error = 'Film se nepodařilo znovu najít. Vraťte se do hledání.')
      film = f
      void filmArt(f.name, f.year).then(async (a) => {
        if (cancelled || !a) return
        art = a
        const more = await filmDetails(a.id)
        if (!cancelled) details = more
      })
    }, (e: Error) => !cancelled && (error = e.message))
    return () => {
      cancelled = true
    }
  })

  const release = $derived(film ? (film.releases.find((r) => r.id === chosen) ?? bestRelease(film, settings.prefLang)) : null)
  const title = $derived(art?.title ?? film?.name ?? query)
  const year = $derived(film?.year ?? art?.year)
  const langs = (codes: string[]) => codes.filter((l) => l !== 'und').map((l) => LANGUAGE_NAMES[l] ?? l.toUpperCase()).join(', ')
</script>

<div class="nf">
  <Billboard image={art?.backdrop ?? hubAsset(film?.poster)} {title}>
    {#if error}<p class="tp-error">{error}</p>{/if}
    {#if !film && !error}<Spinner label="Hledám verze filmu…" />{/if}
    {#if film && release}
      {@const q = parseRelease(release.title)}
      <FilmFacts {art} {details} {year} quality={q.quality} hdr={q.hdr} size={release.size} overview={film.description} />
      {#key release.id}
        <TorrentPanel mediaKey={release.id} {title} poster={art?.poster ?? hubAsset(release.poster)} {year} {action} />
      {/key}
    {/if}
  </Billboard>

  {#if details?.cast.length}<Cast cast={details.cast} />{/if}
  {#if film}
    <section class="nf-section">
      <h2 class="nf-h2">Verze <span class="muted">{film.releases.length}</span></h2>
      <ol class="versions">
        {#each film.releases as r, i (r.id)}
          {@const q = parseRelease(r.title)}
          <li>
            <button class="version" class:on={r.id === release?.id} onclick={() => { chosen = r.id; window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
              <span class="version-n">{i + 1}</span>
              <span class="version-q">{q.quality ?? '—'}</span>
              <span class="version-body">
                <span class="version-title">{r.title}</span>
                <span class="version-meta">
                  <span class:nf-green={!!r.seeders}>{r.seeders ?? '?'} seedů</span>
                  {#if r.size}<span>{gb(r.size)}</span>{/if}
                  {#if r.languages.length}<span>Zvuk: {langs(r.languages)}</span>{/if}
                  {#if r.subtitles.length}<span>Titulky{langs(r.subtitles) ? `: ${langs(r.subtitles)}` : ''}</span>{/if}
                  {#if r.indexName}<span>{r.indexName}</span>{/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</div>
