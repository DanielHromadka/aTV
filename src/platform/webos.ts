import type { Platform } from './types'

// PalmServiceBridge is built into every webOS web engine, so we need no webOSTV.js.
interface ServiceBridge {
  onservicecallback: (response: string) => void
  call(uri: string, params: string): void
}
type BridgeCtor = new () => ServiceBridge

function luna(uri: string, params: object): Promise<{ returnValue?: boolean; errorText?: string }> {
  return new Promise((resolve) => {
    const Bridge = (window as unknown as { PalmServiceBridge: BridgeCtor }).PalmServiceBridge
    const bridge = new Bridge()
    bridge.onservicecallback = (response) => resolve(JSON.parse(response))
    bridge.call(uri, JSON.stringify(params))
  })
}

async function launch(id: string, params: object | undefined, name: string): Promise<void> {
  const res = await luna('luna://com.webos.applicationManager/launch', params ? { id, params } : { id })
  if (res.returnValue === false) throw new Error(res.errorText ?? `${name} se nepodařilo spustit`)
}

export const webosPlatform: Platform = {
  id: 'webos',
  name: 'LG webOS',
  init() {},
  async launch(app) {
    if (!app.webos) throw new Error(`${app.name} nemá na webOS známé ID aplikace`)
    await launch(app.webos, undefined, app.name)
  },
  openUrl(url) {
    return launch('com.webos.app.browser', { target: url }, 'Prohlížeč')
  },
  exit() {
    // `disableBackHistoryAPI` in appinfo.json hands Back to us; closing the window leaves the app.
    window.close()
  },
}
