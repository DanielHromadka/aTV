import type { PublicConfig } from '../shared/protocol.ts'
import { nav } from './state'
import type { Settings } from './services/settings'
import type { TvIconName } from './icons'

/** A tile in the home screen's app row: a streaming app or one of aTV's own screens. */
export interface TileDef {
  id: string
  name: string
  icon: TvIconName
  background: string
  glow: string
  run(): void
}

const BUILTIN: TileDef[] = [
  { id: 'artists', name: 'Umělci · Galerie', icon: 'palette', background: '#443d32', glow: '#c6bca3', run: () => nav.push({ type: 'artists' }) },
  { id: 'musicians', name: 'Muzikanti', icon: 'music', background: '#3d334d', glow: '#b7a1d0', run: () => nav.push({ type: 'musicians' }) },
  { id: 'audio', name: 'Audio', icon: 'headphones', background: '#253d36', glow: '#88b9a4', run: () => nav.push({ type: 'audio' }) },
  { id: 'actors', name: 'Herci', icon: 'masks', background: 'linear-gradient(135deg, #485c72 0%, #192535 100%)', glow: '#8bb8d9', run: () => nav.push({ type: 'actors' }) },
  { id: 'library', name: 'Knihovna', icon: 'play', background: 'linear-gradient(135deg, #00a4dc 0%, #4b2a8a 100%)', glow: '#00a4dc', run: () => nav.push({ type: 'library' }) },
  { id: 'films', name: 'Archivní filmy', icon: 'film', background: 'linear-gradient(135deg, #c05621 0%, #4a1d0b 100%)', glow: '#f6ad55', run: () => nav.push({ type: 'media' }) },
  { id: 'tv', name: 'Televize', icon: 'tv', background: 'linear-gradient(135deg, #0f9b8e 0%, #0b3d3a 100%)', glow: '#2ed3c3', run: () => nav.push({ type: 'iptv' }) },
  { id: 'ivysilani', name: 'iVysílání', icon: 'tv', background: 'linear-gradient(135deg, #e3001b 0%, #5c000b 100%)', glow: '#ff4d5e', run: () => nav.push({ type: 'ivysilani' }) },
  { id: 'browser', name: 'Prohlížeč', icon: 'globe', background: 'linear-gradient(135deg, #2b6cb0 0%, #1a365d 100%)', glow: '#63b3ed', run: () => nav.push({ type: 'browser' }) },
  { id: 'search', name: 'Hledat', icon: 'search', background: 'linear-gradient(135deg, #39404f 0%, #1a1e27 100%)', glow: '#8a90a2', run: () => nav.push({ type: 'search' }) },
  { id: 'settings', name: 'Nastavení', icon: 'gear', background: 'linear-gradient(135deg, #39404f 0%, #1a1e27 100%)', glow: '#8a90a2', run: () => nav.push({ type: 'settings' }) },
]

export const ALL_TILES: TileDef[] = BUILTIN

/** The saved order with tiles added in newer versions appended. */
export function tileLayout(s: Settings): { def: TileDef; hidden: boolean }[] {
  const out: { def: TileDef; hidden: boolean }[] = []
  for (const t of s.tiles) {
    const def = ALL_TILES.find((d) => d.id === t.id)
    if (def) out.push({ def, hidden: t.hidden })
  }
  for (const def of ALL_TILES) if (!out.some((o) => o.def.id === def.id)) out.push({ def, hidden: false })
  return out
}

/** Tiles to show: the IPTV tile only when the hub has a playlist; Settings can never be hidden. */
export function visibleTiles(s: Settings, c: PublicConfig | null): TileDef[] {
  return tileLayout(s)
    .filter((t) => (!t.hidden || t.def.id === 'settings') && (t.def.id !== 'tv' || !!c?.features.iptv))
    .map((t) => t.def)
}
