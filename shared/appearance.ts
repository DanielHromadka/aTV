/**
 * The look of the home screen: a design (layout preset) plus a background and a few overrides.
 * The hub keeps one appearance for the household and sends it to every TV and phone,
 * so the TV's Appearance panel and the phone's Design tab change the same thing.
 */

export type DesignId = 'icons' | 'spotlight' | 'mosaic' | 'sidebar' | 'dock' | 'minimal' | 'shore'
export type TileStyle = 'brand' | 'glass' | 'plain'
export type LabelStyle = 'both' | 'icon' | 'name'
export type FontStyle = 'modern' | 'classic' | 'light' | 'rounded'
export type ClockStyle = 'small' | 'big' | 'hidden'

export interface Appearance {
  design: DesignId
  /** A built-in scene (`scene:<id>`), a photo sent from a phone (`photo:<id>`), `immich`, or `none`. */
  background: string
  tiles: TileStyle
  labels: LabelStyle
  font: FontStyle
  clock: ClockStyle
}

/** A photo a phone uploaded to the hub, usable as a background. */
export interface CustomBackground {
  id: string
  name: string
}

export interface Option<T extends string> {
  id: T
  name: string
  description: string
}

/** Each design brings its own tile style, labels, font and clock; the user can override them afterwards. */
export const DESIGNS: (Option<DesignId> & { preset: Omit<Appearance, 'design' | 'background'> })[] = [
  { id: 'icons', name: 'Ikony aplikací', description: 'Barevné ikony v mřížce', preset: { tiles: 'brand', labels: 'both', font: 'modern', clock: 'small' } },
  { id: 'spotlight', name: 'Reflektor', description: 'Velké přivítání, jedna řada aplikací', preset: { tiles: 'brand', labels: 'icon', font: 'classic', clock: 'small' } },
  { id: 'mosaic', name: 'Mozaika', description: 'Výrazné barevné bloky, velké i malé', preset: { tiles: 'brand', labels: 'both', font: 'rounded', clock: 'small' } },
  { id: 'sidebar', name: 'Postranní panel', description: 'Seznam aplikací s velkým náhledem', preset: { tiles: 'brand', labels: 'both', font: 'modern', clock: 'small' } },
  { id: 'dock', name: 'Dok', description: 'Obří hodiny, aplikace u spodního okraje', preset: { tiles: 'glass', labels: 'both', font: 'light', clock: 'big' } },
  { id: 'minimal', name: 'Minimal', description: 'Jen čas a vaše ikony', preset: { tiles: 'plain', labels: 'icon', font: 'light', clock: 'big' } },
  { id: 'shore', name: 'Sklo', description: 'Skleněné dlaždice přes fotku', preset: { tiles: 'glass', labels: 'both', font: 'modern', clock: 'small' } },
]

export const TILE_STYLES: Option<TileStyle>[] = [
  { id: 'brand', name: 'Barvy aplikací', description: 'Každá dlaždice ve své barvě' },
  { id: 'glass', name: 'Sklo', description: 'Průsvitné dlaždice přes pozadí' },
  { id: 'plain', name: 'Bez dlaždic', description: 'Jen ikona a název' },
]

export const LABEL_STYLES: Option<LabelStyle>[] = [
  { id: 'both', name: 'Ikona a název', description: '' },
  { id: 'icon', name: 'Jen ikona', description: '' },
  { id: 'name', name: 'Jen název', description: '' },
]

export const FONTS: Option<FontStyle>[] = [
  { id: 'modern', name: 'Moderní', description: 'Bezpatkové písmo' },
  { id: 'classic', name: 'Klasické', description: 'Patkové písmo' },
  { id: 'light', name: 'Tenké', description: 'Lehký řez' },
  { id: 'rounded', name: 'Zaoblené', description: 'Měkké a tučné' },
]

export const CLOCKS: Option<ClockStyle>[] = [
  { id: 'small', name: 'Malé', description: '' },
  { id: 'big', name: 'Velké', description: '' },
  { id: 'hidden', name: 'Skryté', description: '' },
]

export const DEFAULT_APPEARANCE: Appearance = { design: 'icons', background: 'scene:valley', ...DESIGNS[0].preset }

const pick = <T extends string>(list: Option<T>[], value: unknown, fallback: T): T =>
  list.some((o) => o.id === value) ? (value as T) : fallback

/** Accepted background ids; photo ids are checked against the uploaded list by the hub. */
export function isBackgroundId(value: unknown): value is string {
  return typeof value === 'string' && (value === 'none' || value === 'immich' || !!findScene(value) || /^photo:[a-z0-9]{6,32}$/.test(value))
}

/**
 * Applies a change from a phone or the TV to an appearance. Choosing a design also takes its preset,
 * unless the same change sets those parts itself. Anything unknown is ignored.
 */
export function applyAppearance(current: Appearance, patch: unknown): Appearance {
  if (!patch || typeof patch !== 'object') return current
  const p = patch as Record<string, unknown>
  let next = { ...current }
  if (p.design !== undefined && p.design !== current.design) {
    const design = DESIGNS.find((d) => d.id === p.design)
    if (design) next = { ...next, design: design.id, ...design.preset }
  }
  if (isBackgroundId(p.background)) next.background = p.background
  next.tiles = pick(TILE_STYLES, p.tiles, next.tiles)
  next.labels = pick(LABEL_STYLES, p.labels, next.labels)
  next.font = pick(FONTS, p.font, next.font)
  next.clock = pick(CLOCKS, p.clock, next.clock)
  return next
}

/** A saved appearance with missing or broken parts replaced by defaults. */
export function normalizeAppearance(value: unknown): Appearance {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    design: DESIGNS.some((d) => d.id === v.design) ? (v.design as DesignId) : DEFAULT_APPEARANCE.design,
    background: isBackgroundId(v.background) ? v.background : DEFAULT_APPEARANCE.background,
    tiles: pick(TILE_STYLES, v.tiles, DEFAULT_APPEARANCE.tiles),
    labels: pick(LABEL_STYLES, v.labels, DEFAULT_APPEARANCE.labels),
    font: pick(FONTS, v.font, DEFAULT_APPEARANCE.font),
    clock: pick(CLOCKS, v.clock, DEFAULT_APPEARANCE.clock),
  }
}

/** The next or previous option in a list, wrapping around (left/right on the TV panel). */
export function cycle<T extends string>(ids: readonly T[], current: T, by: 1 | -1): T {
  const i = ids.indexOf(current)
  return ids[(i + by + ids.length) % ids.length]
}

// --- Built-in scenes -------------------------------------------------------------------------
// Photos shipped with the app in public/backgrounds (TVs may be offline). All are CC0 copies of
// Unsplash photos on Wikimedia Commons; public/backgrounds/CREDITS.md lists the sources.

export interface Scene {
  id: string
  name: string
  /** Average colour, shown while the photo loads. */
  tint: string
  photographer: string
}

export const SCENES: Scene[] = [
  { id: 'valley', name: 'Horské pleso', tint: '#3d5566', photographer: 'Aleksandra Boguslawska' },
  { id: 'lake', name: 'Zrcadlové jezero', tint: '#6b7680', photographer: 'Ales Krivec' },
  { id: 'dunes', name: 'Pouštní duny', tint: '#8a6a4c', photographer: 'Giorgio Parravicini' },
  { id: 'forest', name: 'Mlhavý les', tint: '#45503f', photographer: 'Vadim Sherbakov' },
  { id: 'aurora', name: 'Polární záře', tint: '#1d3a3a', photographer: 'Johannes Groll' },
  { id: 'city', name: 'Město v noci', tint: '#2a2836', photographer: 'Alex Wong' },
  { id: 'coast', name: 'Skalnaté pobřeží', tint: '#3d6066', photographer: 'Adrian (aows)' },
  { id: 'dusk', name: 'Severský soumrak', tint: '#1f2b3d', photographer: 'Johannes Groll' },
  { id: 'mist', name: 'Mlha v údolí', tint: '#4a524a', photographer: 'John Towner' },
]

/** Relative to the page, so it works from the hub and from the packaged TV app; thumbs are 500 px wide. */
export const sceneUrl = (scene: Scene, thumb = false): string => `backgrounds/${scene.id}${thumb ? '-thumb' : ''}.jpg`

export const findScene = (background: string): Scene | undefined =>
  background.startsWith('scene:') ? SCENES.find((s) => `scene:${s.id}` === background) : undefined
