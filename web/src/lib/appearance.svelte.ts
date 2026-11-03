import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  findScene,
  normalizeAppearance,
  sceneUrl,
  type Appearance,
  type CustomBackground,
} from '../../../shared/appearance.ts'
import { hubUrl, onHubMessage, sendToHub } from './hub.svelte.ts'

const KEY = 'atv.appearance'

function load(): { appearance: Appearance; backgrounds: CustomBackground[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as { appearance?: unknown; backgrounds?: CustomBackground[] }
    return { appearance: normalizeAppearance(saved.appearance), backgrounds: Array.isArray(saved.backgrounds) ? saved.backgrounds : [] }
  } catch {
    return { appearance: DEFAULT_APPEARANCE, backgrounds: [] }
  }
}

/** The hub's look, shared with the TVs and phones; kept locally so the page starts with it. */
export const look = $state(load())

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(look)))
  } catch {
    // Without storage the page shows the default look until the hub answers.
  }
}

onHubMessage((msg) => {
  if (msg.t !== 'appearance') return
  look.appearance = msg.appearance
  look.backgrounds = msg.backgrounds
  save()
})

/** A change from this page: applied at once, and through the hub so the TV and phones follow. */
export function setAppearance(patch: Partial<Appearance>): void {
  look.appearance = applyAppearance(look.appearance, patch)
  save()
  sendToHub({ t: 'appearance-set', patch })
}

/** The picture for a background id, or null for the plain gradient (`none`, Immich handled apart). */
export function backgroundUrl(background: string, thumb = false): string | null {
  const scene = findScene(background)
  if (scene) return sceneUrl(scene, thumb)
  if (background.startsWith('photo:')) {
    const base = hubUrl()
    return base ? `${base}/api/backgrounds/${background.slice(6)}` : null
  }
  return null
}

export function backgroundName(background: string, photos: CustomBackground[]): string {
  if (background === 'none') return 'Bez pozadí'
  if (background === 'immich') return 'Fotky z Immich'
  return findScene(background)?.name ?? photos.find((p) => `photo:${p.id}` === background)?.name ?? 'Vlastní fotka'
}
