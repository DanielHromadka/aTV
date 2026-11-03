<script lang="ts">
  import type { AudioDetails } from '../../../shared/audio.ts'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi, hubAsset, hubUrl } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** An album or audiobook from a torrent: its tracks, each playing while it downloads. */
  let { mediaId, title, poster }: { mediaId: string; title: string; poster?: string } = $props()

  let data = $state<AudioDetails | null>(null)
  // svelte-ignore state_referenced_locally
  let cover = $state(poster)
  let error = $state('')
  let attempt = $state(0)

  $effect(() => {
    void attempt
    let cancelled = false
    error = ''
    data = null
    hubApi<AudioDetails>(`/api/audio/${encodeURIComponent(mediaId)}`).then((d) => {
      if (cancelled) return
      data = d
      if (d.cover) cover = hubAsset(d.cover)
      else if (!poster) hubApi<{ cover?: string }>(`/api/audio/cover?q=${encodeURIComponent(title)}`).then((c) => !cancelled && (cover = c.cover), () => {})
    }, () => !cancelled && (error = 'Audio se nepodařilo načíst. Zkuste to znovu nebo vyberte jinou verzi.'))
    return () => (cancelled = true)
  })

  function play(index: number, name: string): void {
    const base = `${hubUrl()}/api/media/${encodeURIComponent(mediaId)}/files/${index}`
    const direct = /\.(mp3|m4a|m4b|wav)$/i.test(name)
    nav.push({
      name: 'player',
      source: {
        kind: 'url', title: name.split('/').pop() ?? title, url: base, audioOnly: true, poster: cover, mediaKey: mediaId,
        historyId: `${mediaId}/${index}`, seekTemplate: direct ? undefined : `${base}/play?t={t}`,
      },
    })
  }
</script>

<Page {title} subtitle={data ? `${data.tracks.length} skladeb / kapitol` : 'Načítání seznamu skladeb…'}>
  <div class="audio-heading">
    {#if cover}<img src={cover} alt="Obal alba nebo audioknihy" onerror={() => (cover = undefined)} />{/if}
    <div class="audio-tracks">
      {#if error}
        <p class="message">{error}</p>
        <button class="btn" onclick={() => attempt++}>Zkusit znovu</button>
      {:else if !data}<Spinner />
      {:else if !data.tracks.length}<p class="message">Tento torrent neobsahuje podporované zvukové soubory.</p>
      {:else}
        {#each data.tracks as track, n (track.index)}
          <button class="track" onclick={() => play(track.index, track.name)}><span class="track-no">{n + 1}</span>{track.name.split('/').pop()}<Icon name="start" size={16} /></button>
        {/each}
      {/if}
    </div>
  </div>
  <p class="muted small">Obaly: soubory torrentu, MusicBrainz / Cover Art Archive. Chybějící obal nebrání poslechu.</p>
</Page>
