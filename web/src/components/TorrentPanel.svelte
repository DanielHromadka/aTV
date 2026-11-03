<script lang="ts">
  import { formatTime } from '../../../shared/context.ts'
  import { START_BUFFER_SECONDS, type DownloadInfo } from '../../../shared/downloads.ts'
  import { LANGUAGE_NAMES, needsTranscode, type Probe, type TorrentFileInfo } from '../../../shared/media.ts'
  import type { PlayerSource } from '../../../shared/playback.ts'
  import { resumeWatch } from '../../../shared/watch-history.ts'
  import { mb, sources } from '../lib/actions.ts'
  import { hubApi, hubSend, hubUrl } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'
  import { toast } from '../lib/toast.svelte.ts'
  import { watching } from '../lib/watch-history.svelte.ts'
  import Icon from './Icon.svelte'

  interface Status {
    progress: number
    downloadSpeed: number
    peers: number
  }
  interface Details {
    key: string
    title: string
    videos: TorrentFileInfo[]
    main?: number
    subtitles: { index: number; name: string; lang?: string }[]
    probe?: Probe
    probing: boolean
    probeError?: string
    status: Status
  }
  interface Buffer {
    aheadSeconds: number
    downloadSpeed: number
    peers: number
    ready: boolean
  }

  /** One torrent: connect, pick the video file, audio track and subtitles, then play while it downloads or save it to the library. */
  let { mediaKey, title, poster, year, action }: { mediaKey: string; title: string; poster?: string; year?: number; action?: 'play' | 'download' } = $props()

  const api = $derived(`/api/media/${encodeURIComponent(mediaKey)}`)
  let d = $state<Details | null>(null)
  let error = $state('')
  let attempt = $state(0)
  let video = $state<number | undefined>()
  let audio = $state(0)
  let subtitle = $state<number | null>(null)
  let subtitleChosen = false
  let probeApplied = false
  // Waiting for the start buffer: the source to play once enough is downloaded ahead.
  let preparing = $state<{ source: PlayerSource; file: number; at: number } | null>(null)
  let buffer = $state<Buffer | null>(null)
  let download = $state<DownloadInfo | null>(null)
  // Play or Download pressed before the torrent answered: done as soon as it does.
  // svelte-ignore state_referenced_locally
  let wanted = $state<'play' | 'download' | null>(action ?? null)

  const langName = (l?: string) => (l ? LANGUAGE_NAMES[l] ?? l.toUpperCase() : undefined)

  // Connect, then keep refreshing: the file list arrives before the video analysis.
  $effect(() => {
    void attempt
    let cancelled = false
    let pending = false
    error = ''
    d = null
    subtitleChosen = false
    probeApplied = false
    const load = (first: boolean) => {
      if (pending) return
      pending = true
      hubApi<Details>(api)
        .then((details) => {
          if (cancelled) return
          d = details
          if (first) {
            video = details.main
            subtitle = details.subtitles.find((s) => s.lang === settings.prefLang)?.index ?? null
          }
          // Language preferences apply once, when the analysis arrives.
          if (details.probe && !probeApplied) {
            probeApplied = true
            const preferred = details.probe.audio.find((t) => t.lang === settings.prefLang)
            audio = preferred?.index ?? 0
            if (!subtitleChosen && (preferred ?? details.probe.audio[0])?.lang !== settings.prefLang) {
              subtitle = details.subtitles.find((s) => s.lang === settings.prefLang)?.index ?? null
            }
          }
        }, (e: Error) => first && !cancelled && (error = e.message))
        .finally(() => (pending = false))
    }
    load(true)
    const t = setInterval(() => d && load(false), 2000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  })

  $effect(() => {
    let cancelled = false
    const load = () => hubApi<DownloadInfo>(`${api}/download`).then((info) => !cancelled && (download = info), () => !cancelled && (download = null))
    void load()
    const t = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  })

  // Ask the hub to download from the start position first, then play once a minute is ready.
  $effect(() => {
    const p = preparing
    if (!p) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      try {
        const b = await hubApi<Buffer>(`${api}/files/${p.file}/prepare?t=${Math.floor(p.at)}`)
        if (cancelled) return
        buffer = b
        if (b.ready) {
          preparing = null
          nav.push({ name: 'player', source: p.source })
          return
        }
      } catch (e) {
        if (cancelled) return
        toast((e as Error).message)
      }
      timer = setTimeout(check, 1000)
    }
    void check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })

  $effect(() => {
    if (!wanted || !d || video === undefined) return
    const w = wanted
    wanted = null
    if (w === 'play') play()
    else if (!download || download.state === 'error') startDownload()
  })

  function play(): void {
    if (!d || video === undefined) {
      wanted = 'play'
      return
    }
    const file = d.videos.find((v) => v.index === video)
    if (!file) return
    const base = `${hubUrl()}${api}`
    const probe = video === d.main ? d.probe : undefined
    const transcode = needsTranscode('browser', file.name, probe, audio)
    const sub = d.subtitles.find((x) => x.index === subtitle)
    const source: PlayerSource = {
      kind: 'url',
      historyId: `${mediaKey}/${video}`,
      mediaKey,
      poster,
      title,
      url: `${base}/files/${video}`,
      seekTemplate: transcode ? `${base}/files/${video}/play?audio=${audio}&t={t}` : undefined,
      duration: probe?.duration,
      subtitle: sub ? { label: langName(sub.lang) ?? sub.name, lang: sub.lang, src: `${base}/files/${sub.index}/vtt${transcode ? '?shift={t}' : ''}` } : undefined,
    }
    // Resume where it was left; the buffer is prepared from that point.
    const at = resumeWatch(source, $state.snapshot(watching.entries)).startSeconds || 0
    buffer = null
    preparing = { source, file: video, at }
  }

  function startDownload(): void {
    if (!d || video === undefined) {
      wanted = 'download'
      return
    }
    hubSend<DownloadInfo>(`${api}/download`, 'POST', { title, year, file: video }).then((info) => {
      download = info
      toast('Stahuji do Knihovny')
    }, (e: Error) => toast(e.message))
  }
  const cancelDownload = () => hubSend(`${api}/download`, 'DELETE').then(() => (download = null), (e: Error) => toast(e.message))

  const status = $derived(d?.status)
  const resume = $derived(watching.entries.find((e) => e.id.startsWith(`${mediaKey}/`)))
  const bufferShare = $derived(buffer ? Math.min(1, buffer.aheadSeconds / START_BUFFER_SECONDS) : 0)
  const connecting = $derived(!d && !error)
  const RING = 2 * Math.PI * 9
</script>

<div class="tp">
  {#if preparing}
    <div class="tp-prepare" role="status">
      <div class="tp-prepare-head">
        <span>Připravuji přehrávání</span>
        <span class="muted">{buffer ? `${Math.min(buffer.aheadSeconds, START_BUFFER_SECONDS)} / ${START_BUFFER_SECONDS} s · ${mb(buffer.downloadSpeed)}/s` : 'Připojuji se…'}</span>
      </div>
      <div class="nf-bar"><span style:width="{bufferShare * 100}%"></span></div>
      <div class="tp-buttons">
        <button class="nf-btn white" onclick={() => { const p = preparing; preparing = null; if (p) nav.push({ name: 'player', source: p.source }) }}>
          <Icon name="start" size={22} stroke={2.4} /> Přehrát hned
        </button>
        <button class="nf-btn grey" onclick={() => (preparing = null)}>Zrušit</button>
      </div>
      {#if buffer?.peers === 0}<p class="muted">Zatím se nepřipojil žádný zdroj.</p>{/if}
    </div>
  {:else}
    <div class="tp-buttons">
      <button class="nf-btn white" onclick={play} disabled={!!error || (!!d && !d.videos.length)}>
        <Icon name="start" size={24} stroke={2.4} /> {connecting && wanted === 'play' ? 'Připojuji…' : resume ? 'Pokračovat' : 'Přehrát'}
      </button>
      {#if download?.state === 'done'}
        <button class="nf-btn grey" onclick={() => nav.push({ name: 'library' })}><Icon name="check" size={22} stroke={2.4} /> V Knihovně</button>
      {:else if download && download.state !== 'error'}
        <button class="nf-btn grey" onclick={cancelDownload} aria-label="Zrušit stahování">
          <svg class="tp-ring" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="9" class="on" stroke-dasharray={RING} stroke-dashoffset={RING * (1 - download.progress)} />
          </svg>
          {download.state === 'copying' ? 'Ukládám…' : `Stahuji ${Math.round(download.progress * 100)} %`}
        </button>
      {:else}
        <button class="nf-btn grey" onclick={startDownload} disabled={!!error}>
          <Icon name="download" size={22} stroke={2.2} /> {connecting && wanted === 'download' ? 'Připojuji…' : download ? 'Stáhnout znovu' : 'Stáhnout'}
        </button>
      {/if}
    </div>
    {#if resume?.duration}
      <div class="tp-resume"><div class="nf-bar"><span style:width="{Math.min(1, resume.position / resume.duration) * 100}%"></span></div>
        <span class="muted">Zbývá {formatTime(resume.duration - resume.position)}</span></div>
    {/if}
  {/if}

  <div class="tp-status">
    {#if error}
      <span class="tp-error">{error}</span> <button class="link" onclick={() => attempt++}>Zkusit znovu</button>
    {:else if connecting}
      <span class="muted">Připojuji se k torrentu…</span>
    {:else if status}
      <span class:nf-green={status.peers > 0}>● {sources(status.peers)}</span>
      <span>{mb(status.downloadSpeed)}/s</span>
      <span>staženo {Math.round(status.progress * 100)} %</span>
      {#if d?.probe?.duration}<span>{formatTime(d.probe.duration)}</span>{/if}
      {#if download?.state === 'downloading'}<span>do Knihovny {mb(download.downloadSpeed)}/s · {sources(download.peers)}</span>{/if}
    {/if}
  </div>
  {#if download?.state === 'done'}<p class="muted small">Uloženo: {download.path}</p>{/if}
  {#if download?.state === 'error'}<p class="tp-error">Stažení se nepodařilo: {download.error}</p>{/if}
  {#if d && status?.peers === 0 && status.progress === 0}
    <p class="tp-note">Čekám na zdroje videa. Pokud se žádný nepřipojí, vyberte jinou verzi. Počet seedů v indexu může být zastaralý.</p>
  {/if}
  {#if d && !d.videos.length}<p class="tp-note">Torrent neobsahuje žádný podporovaný videosoubor.</p>{/if}

  {#if d && d.videos.length}
    <div class="tp-options">
      {#if d.videos.length > 1}
        <label class="tp-select">
          <span>Soubor</span>
          <select bind:value={video}>
            {#each d.videos as v (v.index)}<option value={v.index}>{v.name.split('/').pop() ?? v.name} ({mb(v.length)})</option>{/each}
          </select>
        </label>
      {/if}
      {#if (d.probe?.audio.length ?? 0) > 1 && video === d.main}
        <label class="tp-select">
          <span>Zvuk</span>
          <select bind:value={audio}>
            {#each d.probe?.audio ?? [] as a (a.index)}
              <option value={a.index}>{langName(a.lang) ?? `Stopa ${a.index + 1}`} · {a.codec.toUpperCase()}{a.channels ? ` ${a.channels > 2 ? `${a.channels - 1}.1` : `${a.channels}.0`}` : ''}</option>
            {/each}
          </select>
        </label>
      {:else if d.probing}
        <span class="tp-select muted">Zvuk: načítám stopy…</span>
      {/if}
      <label class="tp-select">
        <span>Titulky</span>
        <select bind:value={subtitle} onchange={() => (subtitleChosen = true)} disabled={!d.subtitles.length}>
          <option value={null}>{d.subtitles.length ? 'Vypnuto' : 'Bez titulků'}</option>
          {#each d.subtitles as x (x.index)}<option value={x.index}>{langName(x.lang) ?? x.name}</option>{/each}
        </select>
      </label>
    </div>
    {#if d.probe?.embeddedSubtitles.length}
      <p class="muted small">Ve videu jsou vložené titulky ({d.probe.embeddedSubtitles.map((x) => langName(x.lang) ?? '?').join(', ')}); zobrazit je zatím neumím.</p>
    {/if}
    {#if d.probeError}<p class="muted small">{d.probeError}</p>{/if}
  {/if}
</div>
