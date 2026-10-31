import { applyAppearance, DEFAULT_APPEARANCE, findScene, normalizeAppearance, sceneUrl, type Appearance, type CustomBackground } from '../../shared/appearance.ts'
import { createStore } from '../state'
import { hubUrl, sendToHub } from './hub'

const KEY = 'atv.appearance'

function load(): { appearance: Appearance; backgrounds: CustomBackground[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as { appearance?: unknown; backgrounds?: CustomBackground[] }
    return { appearance: normalizeAppearance(saved.appearance), backgrounds: Array.isArray(saved.backgrounds) ? saved.backgrounds : [] }
  } catch {
    return { appearance: DEFAULT_APPEARANCE, backgrounds: [] }
  }
}

/** The hub's appearance, kept locally too so the TV starts with the right look before it connects. */
export const appearance = createStore(load())

appearance.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance.get()))
  } catch {
    // Without storage the TV shows the default look until the hub answers.
  }
})

/** A change from the TV panel: through the hub when there is one, so phones see it too. */
export function setAppearance(patch: Partial<Appearance>): void {
  // Applied right away as well, so the panel feels instant; the hub's answer then confirms it.
  appearance.set((a) => ({ ...a, appearance: applyAppearance(a.appearance, patch) }))
  sendToHub({ t: 'appearance-set', patch })
}

/** The picture behind the home screen, or null for the plain gradient (`none`, Immich handled apart). */
export function backgroundUrl(background: string, thumb = false): string | null {
  const scene = findScene(background)
  if (scene) return sceneUrl(scene, thumb)
  if (background.startsWith('photo:')) {
    const base = hubUrl()
    return base ? `${base}/api/backgrounds/${background.slice(6)}` : null
  }
  return null
}

/** The name shown in the panel for the current background. */
export function backgroundName(background: string, photos: CustomBackground[]): string {
  if (background === 'none') return 'Bez pozadí'
  if (background === 'immich') return 'Fotky z Immich'
  const scene = findScene(background)
  if (scene) return scene.name
  return photos.find((p) => `photo:${p.id}` === background)?.name ?? 'Vlastní fotka'
}
