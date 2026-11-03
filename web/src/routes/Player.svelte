<script lang="ts">
  import { onMount } from 'svelte'
  import { formatTime, secondsToTicks } from '../../../shared/context.ts'
  import { streamFor } from '../../../shared/jellyfin.ts'
  import { playMedia } from '../../../shared/media-play.ts'
  import type { PlayerSource } from '../../../shared/playback.ts'
  import { resumeWatch } from '../../../shared/watch-history.ts'
  import Icon from '../components/Icon.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi } from '../lib/hub.svelte.ts'
  import { jellyfin, playerTitle } from '../lib/jellyfin.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { toast } from '../lib/toast.svelte.ts'
  import { saveWatch, watching } from '../lib/watch-history.svelte.ts'

  let { source: requested }: { source: PlayerSource } = $props()

  // Resolved once: a film played before continues where it stopped.
  // svelte-ignore state_referenced_locally
  const source = resumeWatch(requested, $state.snapshot(watching.entries))
  const url = source.kind === 'url' ? source : null
  const live = !!url?.live
  // A transcoded torrent stream starts at `offset` seconds; seeking restarts it elsewhere.
  const template = url?.seekTemplate
  const subtitle = url?.subtitle
  const step = template ? 30 : 10

  let video: HTMLVideoElement
  let shell: HTMLDivElement
  let ready = $state(false)
  let paused = $state(false)
  let time = $state(0)
  let duration = $state(0)
  let osd = $state(true)
  let error = $state('')
  let muted = $state(false)
  let volume = $state(1)
  let subsOn = $state(!subtitle?.off)
  let offset = $state(template ? (url?.startSeconds ?? 0) : 0)
  let osdTimer: ReturnType<typeof setTimeout> | undefined

  const at = (t: number) => template!.replace('{t}', String(Math.floor(t)))
  const position = () => offset + (video?.currentTime ?? 0)

  function showOsd(): void {
    osd = true
    clearTimeout(osdTimer)
    osdTimer = setTimeout(() => (osd = false), 3500)
  }

  /** Jumps to `t` seconds of the film: within the file, or by restarting the transcoded stream there. */
  function seekTo(t: number): void {
    const max = url?.duration || video.duration || Infinity
    const target = Math.max(0, Math.min(t, max - 1))
    if (!template) {
      video.currentTime = target
      return
    }
    offset = target
    video.src = at(target)
    void playMedia(video).catch(() => {})
  }

  const toggle = () => (video.paused ? void playMedia(video).catch(() => {}) : video.pause())

  function applySubs(): void {
    for (const track of video.textTracks) track.mode = subsOn ? 'showing' : 'hidden'
  }

  function fullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void shell.requestFullscreen?.()
  }

  /** After an episode, the next one starts by itself. */
  async function playNext(): Promise<void> {
    const jf = jellyfin()
    if (source.kind !== 'jellyfin' || !jf) return nav.back()
    const item = await jf.item(source.itemId).catch(() => null)
    if (item?.Type !== 'Episode' || !item.SeriesId) return nav.back()
    const [next] = await jf.nextUp(item.SeriesId).catch(() => [])
    if (!next || next.Id === item.Id) return nav.back()
    toast(`Další díl: ${playerTitle(next)}`)
    nav.replace({ name: 'player', source: { kind: 'jellyfin', itemId: next.Id, title: playerTitle(next), startSeconds: 0 } })
  }

  // Once per page: seeking changes `offset`, which must not restart the whole player.
  onMount(() => {
    const v = video
    let hls: { destroy(): void } | null = null
    let disposed = false
    let progressTimer: ReturnType<typeof setInterval> | undefined
    let hasPlayed = false
    let finished = false
    let session: { itemId: string; mediaSourceId: string; playSessionId: string; method: string } | null = null
    const jf = jellyfin()

    const report = (kind: 'start' | 'progress' | 'stopped') => {
      if (hasPlayed) saveWatch(source, offset + (v.currentTime || 0), url?.duration || v.duration, finished)
      if (!jf || !session) return
      jf.report(kind, {
        ItemId: session.itemId, MediaSourceId: session.mediaSourceId, PlaySessionId: session.playSessionId, PlayMethod: session.method,
        PositionTicks: secondsToTicks(v.currentTime || 0), IsPaused: v.paused, CanSeek: true,
      }).catch(() => {})
    }

    async function start(): Promise<void> {
      let src: string
      let isHls: boolean
      // Reopen the torrent before requesting its file, including after a hub restart.
      if (url?.mediaKey) {
        await hubApi(`/api/media/${encodeURIComponent(url.mediaKey)}`)
        if (disposed) return
      }
      if (source.kind === 'jellyfin') {
        if (!jf) throw new Error('Nejste přihlášeni k Jellyfinu')
        const info = await jf.playbackInfo(source.itemId)
        const ms = info.MediaSources[0]
        const stream = ms && streamFor(jf.s.server, jf.s.token, source.itemId, ms)
        if (!stream) throw new Error('Tento soubor nejde přehrát')
        session = { itemId: source.itemId, mediaSourceId: ms.Id, playSessionId: info.PlaySessionId, method: stream.method }
        src = stream.url
        isHls = stream.hls
      } else if (template) {
        src = at(offset)
        isHls = false
      } else {
        src = source.url
        isHls = /\.m3u8(\?|$)/i.test(src)
      }
      if (disposed) return
      const startAt = template ? 0 : (source.startSeconds ?? 0)
      v.addEventListener('loadedmetadata', () => startAt > 0 && (v.currentTime = startAt), { once: true })
      // Desktop Chrome reports native HLS but fails on fMP4 live streams, so hls.js goes first.
      if (isHls) {
        const { default: Hls } = await import('hls.js')
        if (disposed) return
        if (Hls.isSupported()) {
          const h = new Hls({ startPosition: -1 })
          h.loadSource(src)
          h.attachMedia(v)
          hls = h
        } else v.src = src
      } else v.src = src
      await playMedia(v).catch(() => {
        // Autoplay with sound can be refused until the first click; the play button starts it.
      })
      report('start')
      progressTimer = setInterval(() => report('progress'), 10_000)
    }

    start().catch((e: Error) => !disposed && (error = e.message))

    const onPlay = () => {
      error = ''
      hasPlayed = true
      paused = false
      ready = true
      showOsd()
    }
    const onPause = () => {
      paused = true
      osd = true
      report('progress')
    }
    const onTime = () => (time = offset + v.currentTime)
    const onMeta = () => {
      duration = url?.duration ?? (Number.isFinite(v.duration) ? v.duration : 0)
      applySubs()
    }
    const onError = () => (error = url?.audioOnly ? 'Zvuk se nepodařilo přehrát' : 'Video se nepodařilo přehrát')
    const onEnded = () => {
      finished = true
      report('stopped')
      session = null
      void playNext()
    }
    const onVolume = () => {
      muted = v.muted
      volume = v.volume
    }
    const events: [string, () => void][] = [
      ['play', onPlay], ['playing', onPlay], ['pause', onPause], ['timeupdate', onTime], ['durationchange', onMeta],
      ['error', onError], ['ended', onEnded], ['volumechange', onVolume],
    ]
    for (const [name, fn] of events) v.addEventListener(name, fn)
    const flush = () => report('progress')
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)

    return () => {
      disposed = true
      clearInterval(progressTimer)
      clearTimeout(osdTimer)
      report('stopped')
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      for (const [name, fn] of events) v.removeEventListener(name, fn)
      hls?.destroy()
      v.removeAttribute('src')
      v.load()
    }
  })

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
    showOsd()
    switch (e.key) {
      case ' ':
      case 'k':
        toggle()
        break
      case 'ArrowLeft':
        if (!live) seekTo(position() - step)
        break
      case 'ArrowRight':
        if (!live) seekTo(position() + step)
        break
      case 'ArrowUp':
        video.volume = Math.min(1, video.volume + 0.1)
        break
      case 'ArrowDown':
        video.volume = Math.max(0, video.volume - 0.1)
        break
      case 'm':
        video.muted = !video.muted
        break
      case 'f':
        fullscreen()
        break
      case 'c':
        if (subtitle) {
          subsOn = !subsOn
          applySubs()
        }
        break
      case 'Escape':
        if (!document.fullscreenElement) nav.back()
        return
      default:
        return
    }
    e.preventDefault()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="player" class:audio-player={url?.audioOnly} class:idle={!osd && !paused && ready && !error} bind:this={shell}
  role="presentation" onpointermove={showOsd} onpointerdown={showOsd}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} class="player-video" playsinline crossorigin={subtitle ? 'anonymous' : undefined} onclick={toggle} ondblclick={fullscreen}>
    {#if subtitle}
      {#key offset}
        <!-- Keyed by the offset, so a restarted stream gets subtitles shifted to match. -->
        <track kind="subtitles" default label={subtitle.label} srclang={subtitle.lang} src={subtitle.src.replace('{t}', String(Math.floor(offset)))} />
      {/key}
    {/if}
  </video>
  {#if url?.audioOnly}
    <div class="audio-art">{#if url.poster}<img src={url.poster} alt="Obal" />{:else}<span>Audio</span>{/if}</div>
  {/if}
  {#if !ready && !error}<div class="player-center"><Spinner label="Spouštím…" /></div>{/if}
  {#if error}<div class="player-center player-error">{error}</div>{/if}

  <div class="player-top" class:show={osd || paused || !ready || !!error}>
    <button class="round" aria-label="Zpět" onclick={nav.back}><Icon name="back" /></button>
    <div class="player-title">{source.title}</div>
  </div>

  <div class="player-osd" class:show={osd || paused || !ready || !!error}>
    {#if live}
      <div class="player-live">● ŽIVĚ</div>
    {:else}
      <div class="player-bar">
        <span>{formatTime(time)}</span>
        <input class="player-seek" type="range" min="0" max={duration || 0} step="1" value={time} aria-label="Pozice"
          onchange={(e) => seekTo(Number(e.currentTarget.value))} />
        <span>{formatTime(duration)}</span>
      </div>
    {/if}
    <div class="player-controls">
      {#if !live}<button class="round" aria-label="Zpět o {step} s" onclick={() => seekTo(position() - step)}><Icon name="rewind" /></button>{/if}
      <button class="round big" aria-label={paused ? 'Přehrát' : 'Pozastavit'} onclick={toggle}><Icon name={paused ? 'start' : 'pause'} size={30} /></button>
      {#if !live}<button class="round" aria-label="Vpřed o {step} s" onclick={() => seekTo(position() + step)}><Icon name="ffwd" /></button>{/if}
      <span class="player-spacer"></span>
      <button class="round" aria-label={muted ? 'Zapnout zvuk' : 'Vypnout zvuk'} onclick={() => (video.muted = !video.muted)}><Icon name={muted ? 'mute' : 'volume'} /></button>
      <input class="player-volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Hlasitost"
        oninput={(e) => { video.volume = Number(e.currentTarget.value); video.muted = false }} />
      {#if subtitle}
        <button class="round" class:on={subsOn} aria-label="Titulky" aria-pressed={subsOn} onclick={() => { subsOn = !subsOn; applySubs() }}><Icon name="subtitles" /></button>
      {/if}
      <button class="round" aria-label="Celá obrazovka" onclick={fullscreen}><Icon name="fullscreen" /></button>
    </div>
    <div class="player-hint">Mezerník pauza · ← → posun o {step} s · ↑ ↓ hlasitost · F celá obrazovka{subtitle ? ' · C titulky' : ''} · Esc zpět</div>
  </div>
</div>
