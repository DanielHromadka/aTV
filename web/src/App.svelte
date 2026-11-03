<script lang="ts">
  import AppearancePanel from './components/AppearancePanel.svelte'
  import Overlays from './components/Overlays.svelte'
  import Screensaver from './components/Screensaver.svelte'
  import { router } from './lib/router.svelte.ts'
  import { settings } from './lib/settings.svelte.ts'
  import { ui } from './lib/toast.svelte.ts'
  import { startWeather } from './lib/weather.svelte.ts'
  import Actor from './routes/Actor.svelte'
  import Actors from './routes/Actors.svelte'
  import ArtArtist from './routes/ArtArtist.svelte'
  import Artists from './routes/Artists.svelte'
  import AudioDetail from './routes/AudioDetail.svelte'
  import Browser from './routes/Browser.svelte'
  import CtShow from './routes/CtShow.svelte'
  import Detail from './routes/Detail.svelte'
  import Film from './routes/Film.svelte'
  import Gallery from './routes/Gallery.svelte'
  import Home from './routes/Home.svelte'
  import Iptv from './routes/Iptv.svelte'
  import Ivysilani from './routes/Ivysilani.svelte'
  import Library from './routes/Library.svelte'
  import Login from './routes/Login.svelte'
  import Media from './routes/Media.svelte'
  import MediaDetail from './routes/MediaDetail.svelte'
  import Musician from './routes/Musician.svelte'
  import Musicians from './routes/Musicians.svelte'
  import Player from './routes/Player.svelte'
  import Search from './routes/Search.svelte'
  import Settings from './routes/Settings.svelte'
  import SourceSearch from './routes/SourceSearch.svelte'

  startWeather()

  const r = $derived(router.route)

  // The screensaver starts after the set idle time, never over a playing video or the gallery.
  let saver = $state(false)
  let lastInput = Date.now()
  const touch = () => (lastInput = Date.now())
  $effect(() => {
    const minutes = settings.screensaverMinutes
    if (!minutes) return
    const t = setInterval(() => {
      const busy = router.route.name === 'player' || router.route.name === 'gallery'
      if (!saver && !busy && Date.now() - lastInput > minutes * 60_000) saver = true
    }, 15_000)
    return () => clearInterval(t)
  })
</script>

<svelte:window onpointermove={touch} onkeydown={touch} onpointerdown={touch} onscroll={touch} />

{#key r}
  {#if r.name === 'home'}<Home />
  {:else if r.name === 'library'}<Library parentId={r.parentId} title={r.title} collectionType={r.collectionType} />
  {:else if r.name === 'detail'}<Detail itemId={r.itemId} />
  {:else if r.name === 'player'}<Player source={r.source} />
  {:else if r.name === 'search'}<Search {...r} />
  {:else if r.name === 'iptv'}<Iptv />
  {:else if r.name === 'ivysilani'}<Ivysilani />
  {:else if r.name === 'ct-show'}<CtShow id={r.id} title={r.title} />
  {:else if r.name === 'settings'}<Settings />
  {:else if r.name === 'browser'}<Browser url={r.url} />
  {:else if r.name === 'media'}<Media />
  {:else if r.name === 'media-detail'}<MediaDetail mediaKey={r.mediaId} title={r.title} poster={r.poster} description={r.description} year={r.year} />
  {:else if r.name === 'film'}<Film filmKey={r.key} query={r.query} action={r.action} />
  {:else if r.name === 'audio'}<SourceSearch kind="audio" indexer={r.indexer} label={r.label} query={r.query} />
  {:else if r.name === 'source-search'}<SourceSearch kind="video" indexer={r.indexer} label={r.label} />
  {:else if r.name === 'audio-detail'}<AudioDetail mediaId={r.mediaId} title={r.title} poster={r.poster} />
  {:else if r.name === 'artists'}<Artists />
  {:else if r.name === 'art-artist'}<ArtArtist id={r.id} />
  {:else if r.name === 'gallery'}<Gallery artistId={r.artistId} start={r.start} />
  {:else if r.name === 'musicians'}<Musicians />
  {:else if r.name === 'musician'}<Musician id={r.id} />
  {:else if r.name === 'actors'}<Actors />
  {:else if r.name === 'actor'}<Actor actor={r.actor} />
  {:else if r.name === 'login'}<Login />
  {/if}
{/key}

{#if ui.appearanceOpen}<AppearancePanel />{/if}
{#if saver}<Screensaver onclose={() => { saver = false; touch() }} />{/if}
<Overlays />
