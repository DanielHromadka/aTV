import { androidPlatform } from './android'
import { browserPlatform } from './browser'
import { tizenPlatform } from './tizen'
import type { Platform } from './types'
import { webosPlatform } from './webos'

export type { Platform } from './types'

/** Picks the adapter from the globals each TV engine injects. */
export function detectPlatform(w: Window = window): Platform {
  const g = w as unknown as Record<string, unknown>
  if (g.tizen) return tizenPlatform
  if (g.PalmServiceBridge || /Web0S|webOS/.test(w.navigator.userAgent)) return webosPlatform
  if (g.AtvBridge) return androidPlatform
  return browserPlatform
}
