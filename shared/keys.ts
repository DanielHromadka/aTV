/** What a remote button means to the UI, independent of the platform's key codes. */
export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
  | 'playpause' | 'play' | 'pause' | 'stop' | 'ff' | 'rw'

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'ok', 'back', 'playpause', 'play', 'pause', 'stop', 'ff', 'rw']

// Older TV engines (Chromium 47 on Tizen 3) report `Left`/`Up` and often no `key` at all.
const BY_KEY: Record<string, Action> = {
  ArrowUp: 'up', Up: 'up',
  ArrowDown: 'down', Down: 'down',
  ArrowLeft: 'left', Left: 'left',
  ArrowRight: 'right', Right: 'right',
  Enter: 'ok', Select: 'ok',
  Escape: 'back', Backspace: 'back', GoBack: 'back', BrowserBack: 'back', XF86Back: 'back',
  MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
  MediaFastForward: 'ff', MediaRewind: 'rw',
}

// Samsung and LG share the media key codes.
const BY_CODE: Record<number, Action> = {
  38: 'up', 40: 'down', 37: 'left', 39: 'right',
  13: 'ok', 23: 'ok', // 23 = Android DPAD_CENTER
  10009: 'back', // Samsung Tizen
  461: 'back', // LG webOS
  27: 'back', 8: 'back',
  10252: 'playpause', 415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw',
}

export function toAction(e: { key?: string; keyCode?: number }): Action | null {
  if (e.key && BY_KEY[e.key]) return BY_KEY[e.key]
  if (e.keyCode !== undefined && BY_CODE[e.keyCode]) return BY_CODE[e.keyCode]
  return null
}
