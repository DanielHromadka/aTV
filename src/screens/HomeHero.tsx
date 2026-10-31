import { useEffect, useState } from 'preact/hooks'
import type { Appearance } from '../../shared/appearance.ts'
import { greeting } from '../../shared/context.ts'
import { Weather, useClock } from '../components'
import { onFocusChange } from '../nav/focus'
import { config, hubStatus, nav, useStore } from '../state'
import { hubApi, hubUrl } from '../services/hub'
import { appearance, backgroundUrl } from '../services/appearance'
import { findScene } from '../../shared/appearance.ts'
import type { TileDef } from '../tiles'
import { TvIcon, type TvIconName } from '../icons'
import { SleepBadge } from './Home'

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']

/** "Pátek 30. října"; written out here because TV engines often lack Czech locale data. */
export function czechDate(d: Date): string {
  const day = DAYS[d.getDay()]
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${d.getDate()}. ${MONTHS[d.getMonth()]}`
}

function RoundButton({ id, icon, label, onClick }: { id: string; icon: TvIconName; label: string; onClick: () => void }) {
  return (
    <div class="round-btn" data-focus={id} role="button" aria-label={label} onClick={onClick}>
      <TvIcon name={icon} size={40} />
    </div>
  )
}

/** The photo, scene or Immich slideshow behind the home screen, with a scrim that keeps text readable. */
export function HomeBackground() {
  const { appearance: look } = useStore(appearance)
  const c = useStore(config)
  const [photo, setPhoto] = useState<string | null>(null)
  const immich = look.background === 'immich' && !!c?.features.photos

  // Immich: a new random photo every minute.
  useEffect(() => {
    if (!immich) return setPhoto(null)
    let ids: string[] = []
    let i = 0
    const next = () => {
      if (ids.length) setPhoto(`/api/photos/${ids[i++ % ids.length]}`)
    }
    hubApi<string[]>('/api/photos/random?count=30').then((list) => {
      ids = list
      next()
    }, () => {})
    const t = window.setInterval(next, 60_000)
    return () => window.clearInterval(t)
  }, [immich])

  const url = immich ? (photo ? hubUrl() + photo : null) : backgroundUrl(look.background)
  const tint = findScene(look.background)?.tint ?? '#151a28'
  return (
    <div class="home-bg" style={{ backgroundColor: tint }}>
      {url && <div class="home-bg-image" key={url} style={{ backgroundImage: `url("${url}")` }} />}
      <div class={`home-scrim scrim-${look.design}`} />
    </div>
  )
}

/** One app: the tile face, and for some designs the name underneath. */
function AppTile({ t, look, size }: { t: TileDef; look: Appearance; size?: string }) {
  const below = look.design === 'icons' || look.design === 'minimal'
  const showIcon = look.labels !== 'name'
  const showName = look.labels !== 'icon'
  return (
    <div class={`app-tile${size ? ` app-${size}` : ''}`} data-focus={`tile-${t.id}`} onClick={t.run}>
      <div class="app-face" style={look.tiles === 'brand' ? { background: t.background } : undefined}>
        {/* No CSS variables on Tizen 3, so the glow colour sits on its own layer. */}
        {look.tiles === 'brand' && <div class="tile-glow" style={{ boxShadow: `0 0 40px ${t.glow}` }} />}
        {showIcon && <span class="app-icon"><TvIcon name={t.icon} size={size === 'hero' ? 120 : size === 'small' ? 56 : 72} stroke={1.6} /></span>}
        {showName && !below && <span class="app-name">{t.name}</span>}
      </div>
      {showName && below && <div class="app-caption">{t.name}</div>}
    </div>
  )
}

function HeroClock({ look, centered }: { look: Appearance; centered?: boolean }) {
  const now = useClock()
  if (look.clock === 'hidden') return null
  return (
    <div class={`hero-clock clock-${look.clock}${centered ? ' centered' : ''}`}>
      <time class="hero-time">{`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`}</time>
      <div class="hero-date">{czechDate(now)}</div>
    </div>
  )
}

/** The top of the home screen in the chosen design: clock, buttons and the app tiles. */
export function HomeHero({ tiles }: { tiles: TileDef[] }) {
  const { appearance: look } = useStore(appearance)
  const hub = useStore(hubStatus)
  const now = useClock()
  const [preview, setPreview] = useState<TileDef | null>(null)

  // The sidebar design shows the focused app large.
  useEffect(() => {
    if (look.design !== 'sidebar') return
    return onFocusChange((el) => {
      const id = el.dataset.focus?.replace(/^tile-/, '')
      const t = tiles.find((x) => x.id === id)
      if (t) setPreview(t)
    })
  }, [look.design, tiles])

  const bigClock = look.design === 'dock' || look.design === 'minimal'
  const top = (
    <header class="hero-top">
      {!bigClock ? <HeroClock look={look} /> : <div class="hero-spacer" />}
      <div class="hero-actions">
        <SleepBadge />
        <Weather />
        {!hub.connected && <span class="hero-offline">Hub nepřipojen</span>}
        <RoundButton id="home-search" icon="search" label="Hledat" onClick={() => nav.push({ type: 'search' })} />
        <RoundButton id="home-appearance" icon="palette" label="Vzhled" onClick={() => nav.push({ type: 'appearance' })} />
        <RoundButton id="home-settings" icon="gear" label="Nastavení" onClick={() => nav.push({ type: 'settings' })} />
      </div>
    </header>
  )

  const fontClass = `font-${look.font}`
  const cls = `home-hero hero-${look.design} tiles-${look.tiles} labels-${look.labels} ${fontClass}`

  switch (look.design) {
    case 'spotlight':
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <div class="spot-copy">
            <div class="spot-kicker">{greeting(now.getHours())}</div>
            <h1 class="spot-title">Na co se dnes podíváme?</h1>
          </div>
          <div class="hero-row" data-scroll="x">
            <div class="hero-track">{tiles.map((t) => <AppTile key={t.id} t={t} look={look} />)}</div>
          </div>
        </section>
      )
    case 'mosaic': {
      const [first, ...rest] = tiles
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <div class="mosaic">
            {first && <AppTile t={first} look={look} size="hero" />}
            <div class="mosaic-rest">
              {rest.map((t, i) => <AppTile key={t.id} t={t} look={look} size={i < 2 ? 'wide' : 'small'} />)}
            </div>
          </div>
        </section>
      )
    }
    case 'sidebar': {
      const shown = preview && tiles.some((t) => t.id === preview.id) ? preview : tiles[0]
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <div class="sidebar">
            <div class="sidebar-list" data-scroll="y">
              {tiles.map((t) => (
                <div key={t.id} class="side-item" data-focus={`tile-${t.id}`} onClick={t.run}>
                  <span class="side-icon" style={look.tiles === 'brand' ? { background: t.background } : undefined}><TvIcon name={t.icon} size={36} /></span>
                  <span class="side-name">{t.name}</span>
                </div>
              ))}
            </div>
            {shown && (
              <div class="side-preview" style={look.tiles === 'brand' ? { background: shown.background } : undefined}>
                <span class="side-preview-icon"><TvIcon name={shown.icon} size={160} stroke={1.4} /></span>
                <div class="side-preview-name">{shown.name}</div>
                <div class="side-preview-hint">Stiskněte OK pro otevření</div>
              </div>
            )}
          </div>
        </section>
      )
    }
    case 'dock':
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <HeroClock look={look} />
          <div class="dock">
            <div class="hero-row" data-scroll="x">
              <div class="hero-track">{tiles.map((t) => <AppTile key={t.id} t={t} look={look} />)}</div>
            </div>
          </div>
        </section>
      )
    case 'minimal':
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <HeroClock look={look} centered />
          <div class="hero-row minimal-strip" data-scroll="x">
            <div class="hero-track">{tiles.map((t) => <AppTile key={t.id} t={t} look={look} />)}</div>
          </div>
        </section>
      )
    default:
      // App icons and Glass: a grid of tiles.
      return (
        <section class={cls} data-scroll-pin>
          {top}
          <div class="app-grid">{tiles.map((t) => <AppTile key={t.id} t={t} look={look} />)}</div>
        </section>
      )
  }
}
