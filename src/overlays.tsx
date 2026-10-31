import { useEffect, useState } from 'preact/hooks'
import { greeting } from '../shared/context.ts'
import { Clock, Weather, useClock } from './components'
import { config, notices, toastStore, useStore } from './state'
import { hubApi, hubUrl } from './services/hub'

export function Toast() {
  const t = useStore(toastStore)
  return <div class={`toast${t ? ' show' : ''}`}>{t?.text}</div>
}

export function Notices() {
  const list = useStore(notices)
  return (
    <div class="notices">
      {list.map((n) => (
        <div class="notice" key={n.id}>
          {n.image && <img src={n.image} alt="" />}
          <div>
            <div class="notice-title">{n.title}</div>
            {n.text && <div class="notice-text">{n.text}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Photos from Immich (through the hub) cross-fading every 20 s, or a calm gradient; clock and weather on top. */
export function Screensaver() {
  const c = useStore(config)
  const now = useClock()
  const [photos, setPhotos] = useState<string[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!c?.features.photos) return
    hubApi<string[]>('/api/photos/random?count=30').then(setPhotos, () => setPhotos([]))
  }, [c])

  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => i + 1), 20_000)
    return () => window.clearInterval(t)
  }, [])

  const base = hubUrl()
  return (
    <div class="screensaver">
      {photos.map((id, i) => (
        <div
          key={id}
          class={`saver-photo${i === index % photos.length ? ' show' : ''}`}
          // Only the current and the next photo load; the rest wait.
          style={i === index % photos.length || i === (index + 1) % photos.length ? { backgroundImage: `url("${base}/api/photos/${id}")` } : undefined}
        />
      ))}
      <div class="saver-info">
        <Clock big />
        <div class="saver-sub">
          {greeting(now.getHours())} · <Weather />
        </div>
      </div>
    </div>
  )
}
