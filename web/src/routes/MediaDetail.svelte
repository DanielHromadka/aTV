<script lang="ts">
  import { parseRelease, type FilmArt, type FilmDetails } from '../../../shared/release.ts'
  import Billboard from '../components/Billboard.svelte'
  import Cast from '../components/Cast.svelte'
  import FilmFacts from '../components/FilmFacts.svelte'
  import TorrentPanel from '../components/TorrentPanel.svelte'
  import { filmArt, filmDetails } from '../lib/films.svelte.ts'

  /** One torrent film from the catalog, Internet Archive or a download: artwork, Play and Download. */
  let { mediaKey, title, poster, description, year }: { mediaKey: string; title: string; poster?: string; description?: string; year?: number } = $props()

  let art = $state<FilmArt | null>(null)
  let details = $state<FilmDetails | null>(null)
  const release = $derived(parseRelease(title))

  $effect(() => {
    let cancelled = false
    void filmArt(release.name, year ?? release.year).then(async (a) => {
      if (cancelled || !a) return
      art = a
      const more = await filmDetails(a.id)
      if (!cancelled) details = more
    })
    return () => {
      cancelled = true
    }
  })
</script>

<div class="nf">
  <Billboard image={art?.backdrop ?? poster} title={art?.title ?? release.name}>
    <!-- The archive's own description describes this very copy, so it comes first. -->
    <FilmFacts {art} details={details && description ? { ...details, overview: description } : details} year={year ?? release.year ?? art?.year}
      quality={release.quality} overview={description} />
    <TorrentPanel {mediaKey} title={art?.title ?? title} poster={art?.poster ?? poster} year={year ?? release.year} />
  </Billboard>
  {#if details?.cast.length}<Cast cast={details.cast} />{/if}
</div>
