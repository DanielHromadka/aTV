import type { Platform } from './types'

/** Development in a desktop browser (or the Docker image): opens web versions in a new tab. */
export const browserPlatform: Platform = {
  id: 'browser',
  name: 'Prohlížeč',
  init() {
    // aTV is laid out for a 1920×1080 TV; a browser window shows the same picture, scaled to fit.
    const app = document.getElementById('app')
    if (!app) return
    const root = document.documentElement.style as CSSStyleDeclaration & { zoom: string }
    const fit = () => {
      // Some browsers report the window size in zoomed units, so it is read with the zoom off.
      root.zoom = ''
      const width = window.innerWidth
      const scale = Math.min(width / 1920, window.innerHeight / 1080)
      if (scale >= 1) {
        app.style.width = app.style.height = ''
        return
      }
      // The height is the TV's; the width follows the window, so wider windows have no empty bars.
      root.zoom = String(scale)
      app.style.width = `${Math.round(width / scale)}px`
      app.style.height = '1080px'
    }
    fit()
    window.addEventListener('resize', fit)
  },
  async launch(app) {
    // With noopener, window.open returns null even on success, so there is nothing to check.
    window.open(app.url, '_blank', 'noopener')
  },
  async openUrl(url) {
    window.open(url, '_blank', 'noopener')
  },
  exit() {},
}
