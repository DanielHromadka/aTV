import type { Platform } from './types'

/** Injected by the Android wrapper (platforms/android) via addJavascriptInterface. */
export interface AtvBridge {
  launch(packageName: string): boolean
  openUrl(url: string): boolean
  exit(): void
}

const bridge = (): AtvBridge => (window as unknown as { AtvBridge: AtvBridge }).AtvBridge

export const androidPlatform: Platform = {
  id: 'android',
  name: 'Android TV',
  init() {},
  async launch(app) {
    if (!app.android) throw new Error(`${app.name} nemá na Androidu známý balíček`)
    if (!bridge().launch(app.android)) throw new Error(`${app.name} není nainstalovaný`)
  },
  async openUrl(url) {
    if (!bridge().openUrl(url)) throw new Error('Na zařízení není prohlížeč')
  },
  exit() {
    bridge().exit()
  },
}
