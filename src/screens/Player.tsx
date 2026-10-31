import { playMedia } from '../../shared/media-play.ts'
import { useEffect, useRef, useState } from 'preact/hooks'
import { formatTime, secondsToTicks } from '../../shared/context.ts'
import { streamFor } from '../../shared/jellyfin.ts'
import type { Action } from '../../shared/keys.ts'
import { playerTitle } from '../actions'
import { Spinner } from '../components'
import { platform } from '../runtime'
import { nav, playerControl, toast, useScreenKeys, type PlayerSource } from '../state'
import { hubApi, reportState, sendToHub } from '../services/hub'
import { jellyfin } from '../services/jellyfin'
import { resumeWatch } from '../../shared/watch-history.ts'
import { saveWatch, watchHistory } from '../services/watch-history'

export interface HlsLike {
  loadSource(url: string): void
  attachMedia(video: HTMLVideoElement): void
  destroy(): void
}

/**
 * Attaches a stream: natively on TVs, through hls.js (loaded on demand) in browsers that have MSE.
 * Desktop Chrome now reports native HLS too, but its player fails on fMP4 live streams (iVysílání),
 * so in a browser hls.js goes first and native playback is only the fallback (iOS Safari).
 */
export async function attach(video: HTMLVideoElement, url: string, hls: boolean, lowLatency = false): Promise<HlsLike | null> {
  if (!hls || platform.id !== 'browser') {
    video.src = url
    return null
  }
  const { default: Hls } = await import('hls.js')
  if (!Hls.isSupported()) {
    video.src = url
    return null
  }
  // Low latency: stay two short segments behind live and catch up a little faster when late.
  const h = new Hls(lowLatency ? { startPosition: -1, liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.5 } : { startPosition: -1 })
  h.loadSource(url)
  h.attachMedia(video)
  return h
}

export function Player({ source: requestedSource, screenKey }: { source: PlayerSource; screenKey: number }) {
  const [source] = useState(() => resumeWatch(requestedSource, watchHistory.get()))
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [osd, setOsd] = useState(true)
  const [error, setError] = useState('')
  const osdTimer = useRef<number | undefined>(undefined)
  const live = source.kind === 'url' && !!source.live
  // A transcoded torrent stream starts at `offset` seconds; seeking restarts it elsewhere.
  const template = source.kind === 'url' ? source.seekTemplate : undefined
  const offsetRef = useRef(source.kind === 'url' && source.seekTemplate ? source.startSeconds ?? 0 : 0)
  const [offset, setOffset] = useState(offsetRef.current)
  const subtitle = source.kind === 'url' ? source.subtitle : undefined
  const subsOn = useRef(!subtitle?.off)
  const at = (t: number) => template!.replace('{t}', String(Math.floor(t)))

  /** Jumps to `t` seconds of the film: within the file, or by restarting the transcoded stream there. */
  const seekTo = (t: number) => {
    const v = video.current
    if (!v) return
    const max = (source.kind === 'url' && source.duration) || v.duration || Infinity
    const target = Math.max(0, Math.min(t, max - 1))
    if (!template) {
      v.currentTime = target
      return
    }
    offsetRef.current = target
    setOffset(target)
    v.src = at(target)
    void playMedia(v).catch(() => {})
  }
  const position = () => offsetRef.current + (video.current?.currentTime ?? 0)

  const showOsd = () => {
    setOsd(true)
    window.clearTimeout(osdTimer.current)
    osdTimer.current = window.setTimeout(() => setOsd(false), 4000)
  }

  useEffect(() => {
    const v = video.current!
    let hls: HlsLike | null = null
    let disposed = false
    let progressTimer: number | undefined
    let hasPlayed = false
    let finished = false
    let session: { itemId: string; mediaSourceId: string; playSessionId: string; method: string } | null = null
    const jf = jellyfin()

    const report = (kind: 'start' | 'progress' | 'stopped') => {
      if (hasPlayed) saveWatch(source, offsetRef.current + (v.currentTime || 0),
        source.kind === 'url' ? source.duration || v.duration : v.duration, finished)
      if (!jf || !session) return
      jf.report(kind, {
        ItemId: session.itemId,
        MediaSourceId: session.mediaSourceId,
        PlaySessionId: session.playSessionId,
        PlayMethod: session.method,
        PositionTicks: secondsToTicks(v.currentTime || 0),
        IsPaused: v.paused,
        CanSeek: true,
      }).catch(() => {})
    }

    async function start() {
      let url: string
      let isHls: boolean
      // Reopen the torrent before requesting its file, including after a hub restart.
      if (source.kind === 'url' && source.mediaKey) {
        await hubApi(`/api/media/${encodeURIComponent(source.mediaKey)}`)
        if (disposed) return
      }
      if (source.kind === 'jellyfin') {
        if (!jf) throw new Error('Nejste přihlášeni k Jellyfinu')
        const info = await jf.playbackInfo(source.itemId)
        const ms = info.MediaSources[0]
        const stream = ms && streamFor(jf.s.server, jf.s.token, source.itemId, ms)
        if (!stream) throw new Error('Tento soubor nejde přehrát')
        session = { itemId: source.itemId, mediaSourceId: ms.Id, playSessionId: info.PlaySessionId, method: stream.method }
        url = stream.url
        isHls = stream.hls
      } else if (source.seekTemplate) {
        url = at(offsetRef.current)
        isHls = false
      } else {
        url = source.url
        isHls = /\.m3u8(\?|$)/i.test(url)
      }
      if (disposed) return
      const startAt = source.kind === 'jellyfin' ? source.startSeconds ?? 0 : source.seekTemplate ? 0 : source.startSeconds ?? 0
      v.addEventListener('loadedmetadata', () => {
        if (startAt > 0) v.currentTime = startAt
      }, { once: true } as AddEventListenerOptions)
      hls = await attach(v, url, isHls)
      if (disposed) return hls?.destroy()
      await playMedia(v).catch(() => {
        // Autoplay with sound can be refused in a desktop browser until the first click; OK starts it.
      })
      report('start')
      progressTimer = window.setInterval(() => report('progress'), 10_000)
    }

    start().catch((e: Error) => !disposed && setError(e.message))

    const onPlay = () => {
      setError('')
      showOsd()
      hasPlayed = true
      setPaused(false)
      setReady(true)
      sendToHub({ t: 'playback', state: 'playing', title: source.title })
      reportState({ screen: 'player', playing: { title: source.title, paused: false } })
    }
    const onPause = () => {
      setPaused(true)
      showOsd()
      sendToHub({ t: 'playback', state: 'paused', title: source.title })
      reportState({ screen: 'player', playing: { title: source.title, paused: true } })
      report('progress')
    }
    const onTime = () => setTime(offsetRef.current + v.currentTime)
    const onMeta = () => {
      const known = source.kind === 'url' ? source.duration : undefined
      setDuration(known ?? (isFinite(v.duration) ? v.duration : 0))
      // Subtitle tracks start hidden; show the chosen one.
      for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = subsOn.current ? 'showing' : 'hidden'
    }
    const onError = () => setError(source.kind === 'url' && source.audioOnly ? 'Zvuk se nepodařilo přehrát' : 'Video se nepodařilo přehrát')
    const onEnded = () => {
      finished = true
      report('stopped')
      session = null
      void playNext()
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('playing', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onMeta)
    v.addEventListener('error', onError)
    v.addEventListener('ended', onEnded)
    const flush = () => report('progress')
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)

    playerControl.set({
      playing: true,
      pause: () => v.pause(),
      resume: () => void playMedia(v).catch(() => {}),
      stop: () => nav.pop(),
    })

    return () => {
      disposed = true
      window.clearInterval(progressTimer)
      window.clearTimeout(osdTimer.current)
      report('stopped')
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('playing', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onMeta)
      v.removeEventListener('error', onError)
      v.removeEventListener('ended', onEnded)
      hls?.destroy()
      v.removeAttribute('src')
      v.load()
      playerControl.set(null)
      sendToHub({ t: 'playback', state: 'stopped' })
      reportState({ screen: 'home' })
    }
  }, [source])

  /** After an episode, the next one starts by itself. */
  async function playNext() {
    const jf = jellyfin()
    if (source.kind !== 'jellyfin' || !jf) return nav.pop()
    const item = await jf.item(source.itemId).catch(() => null)
    if (item?.Type !== 'Episode' || !item.SeriesId) return nav.pop()
    const [next] = await jf.nextUp(item.SeriesId).catch(() => [])
    if (!next || next.Id === item.Id) return nav.pop()
    toast(`Další díl: ${playerTitle(next)}`)
    nav.replace({ type: 'player', source: { kind: 'jellyfin', itemId: next.Id, title: playerTitle(next), startSeconds: 0 } })
  }

  useScreenKeys(screenKey, (action: Action) => {
    const v = video.current
    if (!v) return false
    showOsd()
    switch (action) {
      case 'ok':
      case 'playpause':
        if (v.paused) void playMedia(v).catch(() => {})
        else v.pause()
        return true
      case 'play':
        void playMedia(v).catch(() => {})
        return true
      case 'pause':
        v.pause()
        return true
      case 'stop':
        nav.pop()
        return true
      case 'left':
      case 'rw':
        // A restart of a transcoded stream is costly; jump further per press there.
        if (!live) seekTo(position() - (action === 'rw' || template ? 30 : 10))
        return true
      case 'right':
      case 'ff':
        if (!live) seekTo(position() + (action === 'ff' || template ? 30 : 10))
        return true
      case 'down':
        if (subtitle) {
          subsOn.current = !subsOn.current
          for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = subsOn.current ? 'showing' : 'hidden'
          toast(subsOn.current ? 'Titulky zapnuté' : 'Titulky vypnuté')
        }
        return true
      case 'up':
        return true
      default:
        return false
    }
  })

  return (
    <div class={`player${source.kind === 'url' && source.audioOnly ? ' audio-player' : ''}`} onClick={showOsd} onMouseMove={showOsd} onTouchStart={showOsd}>
      <video ref={video} class="player-video" playsInline crossOrigin={subtitle ? 'anonymous' : undefined}>
        {subtitle && (
          // Keyed by the offset, so a restarted stream gets subtitles shifted to match.
          <track key={offset} kind="subtitles" default label={subtitle.label} srcLang={subtitle.lang} src={subtitle.src.replace('{t}', String(Math.floor(offset)))} />
        )}
      </video>
      {source.kind === 'url' && source.audioOnly && <div class="audio-art">{source.poster ? <img src={source.poster} alt="Obal" onError={e => { e.currentTarget.style.display = 'none' }} /> : <span>Audio</span>}</div>}
      {!ready && !error && <div class="player-center"><Spinner label="Spouštím…" /></div>}
      {error && <div class="player-center player-error">{error}</div>}
      <div class={`player-osd${osd || paused || !ready || error ? ' show' : ''}`}>
        <div class="player-title">{source.title}</div>
        {live ? (
          <div class="player-live">● ŽIVĚ</div>
        ) : (
          <div class="player-bar">
            <span>{formatTime(time)}</span>
            <div class="player-track">
              <div class="player-fill" style={{ width: duration ? `${(time / duration) * 100}%` : '0%' }} />
            </div>
            <span>{formatTime(duration)}</span>
          </div>
        )}
        <div class="player-hint">{paused ? '▶ OK přehrát' : '❚❚ OK pauza'}{live ? '' : `  ·  ◀ ▶ posun o ${template ? 30 : 10} s`}{subtitle ? '  ·  ▼ titulky' : ''}  ·  Zpět ukončit</div>
      </div>
    </div>
  )
}
