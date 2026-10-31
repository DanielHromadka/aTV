import type { TvApp } from '../../shared/apps.ts'

export type PlatformId = 'tizen' | 'webos' | 'android' | 'browser'

/** Everything the UI needs from the TV; one adapter per platform. */
export interface Platform {
  id: PlatformId
  name: string
  /** Registers keys and lifecycle hooks; called once at start. */
  init(): void
  /** Starts the service's native app; rejects with a readable message. */
  launch(app: TvApp): Promise<void>
  /** Opens a web page in the TV's own browser. */
  openUrl(url: string): Promise<void>
  /** Back on the home screen: leaves aTV (or does nothing where that is not allowed). */
  exit(): void
}
