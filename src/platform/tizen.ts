import type { Platform } from './types'

// Minimal typing of the Tizen Web API parts we use; the full API is only on the TV.
interface TizenApi {
  ApplicationControl: new (operation: string, uri?: string) => unknown
  application: {
    launch(id: string, ok?: () => void, fail?: (e: { message: string }) => void): void
    launchAppControl(control: unknown, id: string | null, ok?: () => void, fail?: (e: { message: string }) => void): void
    getCurrentApplication(): { exit(): void }
  }
  tvinputdevice?: { registerKey(name: string): void }
}

const tizen = (): TizenApi => (window as unknown as { tizen: TizenApi }).tizen

/** Samsung's built-in browser (Samsung Internet for TV). */
const BROWSER_ID = 'org.tizen.browser'

export const tizenPlatform: Platform = {
  id: 'tizen',
  name: 'Samsung Tizen',
  init() {
    // Arrows, Enter and Back always arrive; media and colour keys only after registering.
    for (const key of ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']) {
      try {
        tizen().tvinputdevice?.registerKey(key)
      } catch {
        // Not every model has every key.
      }
    }
  },
  launch(app) {
    return new Promise((resolve, reject) => {
      if (!app.tizen) {
        reject(new Error(`${app.name} nemá na Tizenu známé ID aplikace`))
        return
      }
      tizen().application.launch(app.tizen, resolve, (e) => reject(new Error(e.message)))
    })
  },
  openUrl(url) {
    return new Promise((resolve, reject) => {
      const t = tizen()
      const control = new t.ApplicationControl('http://tizen.org/appcontrol/operation/view', url)
      t.application.launchAppControl(control, BROWSER_ID, resolve, (e) => reject(new Error(e.message)))
    })
  },
  exit() {
    tizen().application.getCurrentApplication().exit()
  },
}
