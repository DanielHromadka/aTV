import { CLOCKS, cycle, DESIGNS, FONTS, findScene, LABEL_STYLES, SCENES, TILE_STYLES, type Appearance } from '../../shared/appearance.ts'
import { currentFocus } from '../nav/focus'
import { config, hubStatus, nav, useScreenKeys, useStore } from '../state'
import { appearance, backgroundName, backgroundUrl, setAppearance } from '../services/appearance'

type Field = 'design' | 'background' | 'tiles' | 'labels' | 'font' | 'clock'

/** Background ids in the order left/right walks through them. */
function backgroundIds(photos: { id: string }[], immich: boolean): string[] {
  return [...SCENES.map((s) => `scene:${s.id}`), ...photos.map((p) => `photo:${p.id}`), ...(immich ? ['immich'] : []), 'none']
}

/**
 * "Make it yours": the home screen's look, drawn over the screen below so every change shows
 * right away. Left and right change the focused setting, OK moves to the next value.
 */
export function AppearancePanel({ screenKey }: { screenKey: number }) {
  const { appearance: look, backgrounds } = useStore(appearance)
  const c = useStore(config)
  const hub = useStore(hubStatus)
  const bgIds = backgroundIds(backgrounds, !!c?.features.photos)

  const ids: Record<Field, string[]> = {
    design: DESIGNS.map((d) => d.id),
    background: bgIds,
    tiles: TILE_STYLES.map((o) => o.id),
    labels: LABEL_STYLES.map((o) => o.id),
    font: FONTS.map((o) => o.id),
    clock: CLOCKS.map((o) => o.id),
  }
  const change = (field: Field, by: 1 | -1) => {
    const list = ids[field]
    const current = list.indexOf(look[field]) >= 0 ? look[field] : list[0]
    setAppearance({ [field]: cycle(list, current, by) } as Partial<Appearance>)
  }

  useScreenKeys(screenKey, (action) => {
    if (action !== 'left' && action !== 'right') return false
    const field = currentFocus()?.dataset.field as Field | undefined
    if (!field) return true
    change(field, action === 'right' ? 1 : -1)
    return true
  })

  const name = <T extends string>(list: { id: T; name: string }[], id: T) => list.find((o) => o.id === id)?.name ?? id
  const thumb = backgroundUrl(look.background, true)
  const photographer = findScene(look.background)?.photographer

  const row = (field: Field, label: string, value: string, extra?: preact.JSX.Element) => (
    <div class="look-row" data-focus={`look-${field}`} data-field={field} data-autofocus={field === 'design' ? '' : undefined} onClick={() => change(field, 1)}>
      <span class="look-label">{label}</span>
      <span class="look-value">
        <span class="look-arrow">‹</span>
        {extra}
        <span class="look-text">{value}</span>
        <span class="look-arrow">›</span>
      </span>
    </div>
  )

  return (
    <div class="look-panel">
      <div class="look-kicker">Vzhled</div>
      <h1 class="look-title">Udělejte si ji po svém</h1>
      {row('design', 'Návrh', name(DESIGNS, look.design))}
      {row('background', 'Pozadí', backgroundName(look.background, backgrounds), thumb ? <span class="look-thumb" style={{ backgroundImage: `url("${thumb}")` }} /> : undefined)}
      {row('tiles', 'Dlaždice', name(TILE_STYLES, look.tiles))}
      {row('labels', 'Popisky', name(LABEL_STYLES, look.labels))}
      {row('font', 'Písmo', name(FONTS, look.font))}
      {row('clock', 'Hodiny', name(CLOCKS, look.clock))}
      <div class="look-row look-action" data-focus="look-done" onClick={() => nav.pop()}>
        <span class="look-label">Hotovo</span>
      </div>
      <div class="look-note">
        Šipky vlevo a vpravo mění nastavení, změny se ukládají hned.
        {hub.connected ? ' Vlastní fotky na pozadí nahrajete z mobilu: ovladač → Vzhled.' : ' Bez hubu se vzhled uloží jen na této televizi.'}
        {photographer && <div class="look-credit">Foto: {photographer} (Unsplash, CC0)</div>}
      </div>
    </div>
  )
}
