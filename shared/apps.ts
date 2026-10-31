/** A streaming service with its native app id on each platform. */
export interface TvApp {
  id: string
  name: string
  /** Spoken or typed names, normalized (lowercase, no diacritics). */
  aliases: string[]
  /** Tile background and the colour of its focus glow. */
  background: string
  glow: string
  /** Tizen application id (`<package>.<name>`), for tizen.application.launch inside aTV. */
  tizen?: string
  /** Samsung remote-control API id, for launching from the hub while aTV is not running. */
  samsungRemote?: string
  /** webOS application id, for luna://com.webos.applicationManager/launch. */
  webos?: string
  /** Android package name, launched through the wrapper's leanback intent. */
  android?: string
  /** Web version, opened in the browser during development. */
  url: string
}

// Ids marked VERIFY are not confirmed on a device yet: list the installed apps
// (Tizen: `sdb shell 0 applist`, webOS: `ares-install -l`, Android: `adb shell pm list packages`).
export const APPS: TvApp[] = [
  {
    id: 'telly',
    name: 'Telly',
    aliases: ['telly', 'teli', 'tely', 'telli'],
    background: 'linear-gradient(135deg, #7b2ff7 0%, #3a0ca3 100%)',
    glow: '#9d4edd',
    tizen: undefined, // VERIFY: Telly's Tizen id
    webos: undefined, // VERIFY: Telly's webOS id
    android: 'cz.telly.android', // VERIFY
    url: 'https://www.telly.cz',
  },
  {
    id: 'disney',
    name: 'Disney+',
    aliases: ['disney', 'disney plus', 'disney+', 'disnej', 'disnej plus'],
    background: 'linear-gradient(135deg, #1a3cd6 0%, #04103d 100%)',
    glow: '#3fa9f5',
    tizen: 'MCmYXNxgcu.DisneyPlus', // VERIFY
    samsungRemote: '3201901017640',
    webos: 'com.disney.disneyplus-prod',
    android: 'com.disney.disneyplus',
    url: 'https://www.disneyplus.com',
  },
  {
    id: 'netflix',
    name: 'Netflix',
    aliases: ['netflix', 'netflixe', 'netflik', 'netfliks'],
    background: 'linear-gradient(135deg, #1b1b1b 0%, #000 100%)',
    glow: '#e50914',
    tizen: 'RN1MCdNq8t.Netflix', // VERIFY
    samsungRemote: '11101200001',
    webos: 'netflix',
    android: 'com.netflix.ninja',
    url: 'https://www.netflix.com',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    aliases: ['youtube', 'jutub', 'jutjub', 'youtubu', 'jutubu', 'yt'],
    background: 'linear-gradient(135deg, #ff1f1f 0%, #a30000 100%)',
    glow: '#ff4d4d',
    tizen: '9Ur5IzDKqV.TizenYouTube', // VERIFY
    samsungRemote: '111299001912',
    webos: 'youtube.leanback.v4',
    android: 'com.google.android.youtube.tv',
    url: 'https://www.youtube.com',
  },
]

export const findApp = (id: string): TvApp | undefined => APPS.find((a) => a.id === id)
