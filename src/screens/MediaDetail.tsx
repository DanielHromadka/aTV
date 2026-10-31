import { useEffect, useRef, useState } from 'preact/hooks'
import { formatTime } from '../../shared/context.ts'
import { LANGUAGE_NAMES, needsTranscode, type Probe, type TorrentFileInfo } from '../../shared/media.ts'
import { Button, Message, Spinner } from '../components'
import { platform } from '../runtime'
import { nav, toast, useStore } from '../state'
import { hubApi, hubUrl } from '../services/hub'
import { watchHistory } from '../services/watch-history'
import { resumeWatch } from '../../shared/watch-history'
import { START_BUFFER_SECONDS, type DownloadInfo } from '../../shared/downloads.ts'
import type { PlayerSource } from '../state'
import { settings } from '../services/settings'

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
interface Status {
  progress: number
  downloadSpeed: number
  peers: number
}

interface Buffer {
  aheadSeconds: number
  downloadSpeed: number
  bytesPerSecond: number
  complete: boolean
  peers: number
  ready: boolean
}

async function hubSend<T>(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(hubUrl() + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const langName = (l?: string) => (l ? LANGUAGE_NAMES[l] ?? l.toUpperCase() : undefined)
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes > 10_000_000 ? 0 : 1)} MB`

/** One torrent film: connect, pick video file, audio track and subtitles, then play while it downloads. */
export function MediaDetail({ mediaKey, title, poster, description, year }: { mediaKey: string; title: string; poster?: string; description?: string; year?: number }) {
  const s = useStore(settings)
  const [d, setD] = useState<Details | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [video, setVideo] = useState<number | undefined>()
  const [audio, setAudio] = useState(0)
  const [subtitle, setSubtitle] = useState<number | null>(null)
  const subtitleChosen = useRef(false)
  const base = `${hubUrl()}/api/media/${encodeURIComponent(mediaKey)}`
  const api = `/api/media/${encodeURIComponent(mediaKey)}`
  // Waiting for the start buffer: the source to play once enough is downloaded ahead.
  const [preparing, setPreparing] = useState<{ source: PlayerSource; file: number; at: number } | null>(null)
  const [buffer, setBuffer] = useState<Buffer | null>(null)
  const [download, setDownload] = useState<DownloadInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => hubApi<DownloadInfo>(`${api}/download`).then((info) => !cancelled && setDownload(info), () => !cancelled && setDownload(null))
    void load()
    const t = window.setInterval(load, 3000)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [mediaKey])

  // Ask the hub to download from the start position first, then play once a minute is ready.
  useEffect(() => {
    if (!preparing) return
    let cancelled = false
    let timer: number | undefined
    const check = async () => {
      try {
        const b = await hubApi<Buffer>(`${api}/files/${preparing.file}/prepare?t=${Math.floor(preparing.at)}`)
        if (cancelled) return
        setBuffer(b)
        if (b.ready) {
          setPreparing(null)
          nav.push({ type: 'player', source: preparing.source })
          return
        }
      } catch (e) {
        if (cancelled) return
        toast((e as Error).message)
      }
      timer = window.setTimeout(check, 1000)
    }
    void check()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [preparing])

  const startDownload = () => {
    hubSend<DownloadInfo>(`${api}/download`, 'POST', { title, year, file: video })
      .then((info) => { setDownload(info); toast('Stahuji do Knihovny') }, (e: Error) => toast(e.message))
  }
  const cancelDownload = () => {
    hubSend(`${api}/download`, 'DELETE').then(() => setDownload(null), (e: Error) => toast(e.message))
  }

  useEffect(() => {
    let cancelled = false
    setError('')
    setD(null)
    setStatus(null)
    subtitleChosen.current = false
    hubApi<Details>(`/api/media/${encodeURIComponent(mediaKey)}`).then(
      (details) => {
        if (cancelled) return
        setD(details)
        setStatus(details.status)
        setVideo(details.main)
        setSubtitle(details.subtitles.find((sub) => sub.lang === s.prefLang)?.index ?? null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [mediaKey, attempt])

  // Refresh metadata too: the file list appears before the video analysis completes.
  useEffect(() => {
    if (!d) return
    let cancelled = false
    let pending = false
    const t = window.setInterval(() => {
      if (pending) return
      pending = true
      hubApi<Details>(`/api/media/${encodeURIComponent(mediaKey)}`).then((details) => {
        if (cancelled) return
        setD(details)
        setStatus(details.status)
      }, () => {}).finally(() => { pending = false })
    }, 2000)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [!!d, mediaKey])

  // Apply language preferences once when the background analysis arrives.
  useEffect(() => {
    if (!d?.probe) return
    const tracks = d.probe.audio
    const preferred = tracks.find((track) => track.lang === s.prefLang)
    setAudio(preferred?.index ?? 0)
    if (!subtitleChosen.current && (preferred ?? tracks[0])?.lang !== s.prefLang) {
      setSubtitle(d.subtitles.find((sub) => sub.lang === s.prefLang)?.index ?? null)
    }
  }, [!!d?.probe, mediaKey])

  function play() {
    if (!d || video === undefined) return
    const file = d.videos.find((v) => v.index === video)
    if (!file) return
    const probe = video === d.main ? d.probe : undefined
    const transcode = needsTranscode(platform.id, file.name, probe, audio)
    const sub = d.subtitles.find((x) => x.index === subtitle)
    const source: PlayerSource = {
      kind: 'url',
      historyId: `${mediaKey}/${video}`,
      mediaKey,
      poster,
      title: d.title || title,
      url: `${base}/files/${video}`,
      seekTemplate: transcode ? `${base}/files/${video}/play?audio=${audio}&t={t}` : undefined,
      duration: probe?.duration,
      subtitle: sub
        ? { label: langName(sub.lang) ?? sub.name, lang: sub.lang, src: `${base}/files/${sub.index}/vtt${transcode ? '?shift={t}' : ''}` }
        : undefined,
    }
    // Resume where it was left; the buffer is prepared from that point.
    const at = (source.kind === 'url' && resumeWatch(source, watchHistory.get()).startSeconds) || 0
    setBuffer(null)
    setPreparing({ source, file: video, at })
  }

  return (
    <div class="screen-body detail" data-scroll="y">
      {poster && <div class="backdrop" style={{ backgroundImage: `url("${poster}")` }} />}
      <div class="detail-info">
        <h1 class="detail-title">{d?.title && d.title !== mediaKey.replace(/^ia:/, '') ? d.title : title}</h1>
        {description && <p class="detail-overview">{description}</p>}
        {error && <>
          <Message>{error}</Message>
          <Button id="retry-media" primary autofocus label="Zkusit znovu" onClick={() => setAttempt((a) => a + 1)} />
        </>}
        {!d && !error && <Spinner label="Připojuji se k torrentu…" />}
        {status && (
          <div class="detail-meta">
            {status.peers} {status.peers === 1 ? 'zdroj' : status.peers >= 2 && status.peers <= 4 ? 'zdroje' : 'zdrojů'} · {mb(status.downloadSpeed)}/s · staženo {Math.round(status.progress * 100)} %
            {d?.probe?.duration ? ` · ${formatTime(d.probe.duration)}` : ''}
          </div>
        )}
        {d && status?.peers === 0 && status.progress === 0 && (
          <Message>Čekám na zdroje videa. Pokud se žádný nepřipojí, vraťte se do hledání a vyberte jinou verzi filmu. Počet seedů v indexu může být zastaralý.</Message>
        )}
        {d?.probing && <Spinner label="Načítám zvukové stopy a délku videa…" />}
        {d?.probeError && <div class="muted">{d.probeError}</div>}
        {d && !d.videos.length && <Message>Torrent neobsahuje žádný podporovaný videosoubor.</Message>}
        {d && (
          <>
            {d.videos.length > 1 && (
              <>
                <h2 class="section">Soubor</h2>
                <div class="buttons">
                  {d.videos.map((v) => (
                    <div key={v.index} class={`btn${video === v.index ? ' btn-primary' : ''}`} data-focus={`video-${v.index}`} onClick={() => setVideo(v.index)}>
                      {(video === v.index ? '✓ ' : '') + (v.name.split('/').pop() ?? v.name)} ({mb(v.length)})
                    </div>
                  ))}
                </div>
              </>
            )}
            {(d.probe?.audio.length ?? 0) > 1 && video === d.main && (
              <>
                <h2 class="section">Zvuk</h2>
                <div class="buttons">
                  {d.probe!.audio.map((a) => (
                    <div key={a.index} class={`btn${audio === a.index ? ' btn-primary' : ''}`} data-focus={`audio-${a.index}`} onClick={() => setAudio(a.index)}>
                      {(audio === a.index ? '✓ ' : '') + (langName(a.lang) ?? `Stopa ${a.index + 1}`)} · {a.codec.toUpperCase()}
                      {a.channels ? ` ${a.channels > 2 ? `${a.channels - 1}.1` : `${a.channels}.0`}` : ''}
                    </div>
                  ))}
                </div>
              </>
            )}
            <h2 class="section">Titulky</h2>
            <div class="buttons">
              <div class={`btn${subtitle === null ? ' btn-primary' : ''}`} data-focus="sub-none" onClick={() => { subtitleChosen.current = true; setSubtitle(null) }}>
                {subtitle === null ? '✓ ' : ''}Bez titulků
              </div>
              {d.subtitles.map((x) => (
                <div key={x.index} class={`btn${subtitle === x.index ? ' btn-primary' : ''}`} data-focus={`sub-${x.index}`} onClick={() => { subtitleChosen.current = true; setSubtitle(x.index) }}>
                  {(subtitle === x.index ? '✓ ' : '') + (langName(x.lang) ?? x.name)}
                </div>
              ))}
            </div>
            {!d.subtitles.length && <div class="muted">Torrent neobsahuje titulky v samostatném souboru.</div>}
            {(d.probe?.embeddedSubtitles.length ?? 0) > 0 && (
              <div class="muted">
                Ve videu jsou vložené titulky ({d.probe!.embeddedSubtitles.map((x) => langName(x.lang) ?? '?').join(', ')}); zobrazit je zatím neumím.
              </div>
            )}
            {preparing ? (
              <div class="prepare">
                <Spinner label={buffer
                  ? `Připravuji přehrávání: staženo ${Math.min(buffer.aheadSeconds, START_BUFFER_SECONDS)} s z ${START_BUFFER_SECONDS} s dopředu · ${mb(buffer.downloadSpeed)}/s`
                  : 'Připravuji přehrávání…'} />
                <div class="buttons">
                  <Button id="play-now" autofocus label="Přehrát hned" onClick={() => { const p = preparing; setPreparing(null); nav.push({ type: 'player', source: p.source }) }} />
                  <Button id="play-cancel" label="Zrušit" onClick={() => setPreparing(null)} />
                </div>
                {buffer && buffer.peers === 0 && <div class="muted">Zatím se nepřipojil žádný zdroj.</div>}
              </div>
            ) : video !== undefined && <div class="buttons">
              <Button id="play" primary autofocus label="▶ Přehrát" onClick={play} />
              {!download && <Button id="download" label="⬇ Stáhnout do Knihovny" onClick={startDownload} />}
              {download?.state === 'error' && <Button id="download" label="⬇ Stáhnout znovu" onClick={startDownload} />}
              {download && download.state !== 'done' && download.state !== 'error' && <Button id="download-cancel" label="Zrušit stahování" onClick={cancelDownload} />}
            </div>}
            {download && (
              <div class="muted">
                {download.state === 'downloading' && `Stahuji do Knihovny: ${Math.round(download.progress * 100)} % · ${mb(download.downloadSpeed)}/s · ${download.peers} zdrojů`}
                {download.state === 'copying' && 'Ukládám do Knihovny…'}
                {download.state === 'done' && `✓ V Knihovně: ${download.path}`}
                {download.state === 'error' && `Stažení se nepodařilo: ${download.error}`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
