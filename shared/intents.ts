import { APPS } from './apps.ts'
import { normalize, toUrl } from './text.ts'

export type Screen = 'home' | 'library' | 'tv' | 'search' | 'settings' | 'browser' | 'appearance'
export type TvKey = 'volup' | 'voldown' | 'mute' | 'power' | 'chup' | 'chdown'

/** What a spoken or typed command asks for. The hub runs TV keys and timers, the TV app the rest. */
export type Intent =
  | { kind: 'launch'; app: string }
  | { kind: 'play'; query: string }
  | { kind: 'channel'; query: string }
  | { kind: 'search'; query: string }
  | { kind: 'open-url'; url: string }
  | { kind: 'navigate'; screen: Screen }
  | { kind: 'playback'; action: 'pause' | 'resume' | 'stop' }
  | { kind: 'tv'; key: TvKey; repeat?: number }
  | { kind: 'power-on' }
  | { kind: 'sleep'; minutes: number | null }

const NUMBERS: Record<string, number> = {
  jednu: 1, jedna: 1, dve: 2, tri: 3, ctyri: 4, pet: 5, sest: 6, sedm: 7, osm: 8, devet: 9,
  deset: 10, patnact: 15, dvacet: 20, tricet: 30, ctyricet: 40, padesat: 50, sedesat: 60, devadesat: 90,
}

const SCREENS: [RegExp, Screen][] = [
  [/^(domu|domov|domovska obrazovka|hlavni obrazovka)$/, 'home'],
  [/^(knihovn[au]|jellyfin|filmy|serialy|moje filmy)$/, 'library'],
  [/^(televiz[ei] program|iptv|kanaly|program|zive vysilani)$/, 'tv'],
  [/^(nastaveni)$/, 'settings'],
  [/^(vzhled|design|pozadi|vzhled domovske obrazovky)$/, 'appearance'],
  [/^(hledani|vyhledavani)$/, 'search'],
  [/^(prohlizec|internet|web|browser)$/, 'browser'],
]

function number(word: string | undefined): number | undefined {
  if (!word) return undefined
  if (/^\d+$/.test(word)) return Number(word)
  return NUMBERS[word]
}

/** "za 30 minut", "za pul hodiny", "za hodinu", "za dve hodiny" → minutes. */
function duration(text: string): number | undefined {
  if (/\bpul hodiny\b/.test(text)) return 30
  if (/\bhodinu a pul\b/.test(text)) return 90
  const m = new RegExp(`\\b(\\d+|${Object.keys(NUMBERS).join('|')})?\\s*(minut[ay]?|min|hodin[uya]?|hod)\\b`).exec(text)
  if (!m) return undefined
  const unit = m[2].startsWith('h') ? 60 : 1
  const n = m[1] === undefined ? (unit === 60 ? 1 : undefined) : number(m[1])
  return n === undefined ? undefined : n * unit
}

function appByName(name: string): string | undefined {
  return APPS.find((a) => a.aliases.includes(name))?.id
}

/** Rule-based Czech command parser; null means "not understood" (the hub may ask an LLM). */
export function parseCommand(input: string): Intent | null {
  // A web address needs its dots, which normalize() drops: "otevři seznam.cz".
  const web = /^(otevri|otevři|jdi na|přejdi na|prejdi na|web|stranka|stránka)\s+([^\s]+\.[a-z]{2,}\S*)$/i.exec(input.trim())
  if (web) return { kind: 'open-url', url: toUrl(web[2]) }

  const text = normalize(input)
  if (!text) return null

  // Sleep timer first: "vypni televizi za 30 minut" is a timer, not power off.
  if (/\b(zrus|vypni|zastav) (casovac|uspani)\b/.test(text)) return { kind: 'sleep', minutes: null }
  if (/\b(za|po)\b/.test(text) && /\b(vypni|vypnout|uspi|usni|casovac|vypnuti|spat)\b/.test(text)) {
    const minutes = duration(text)
    if (minutes) return { kind: 'sleep', minutes }
  }

  if (/^(ztlum zvuk|vypni zvuk|ztlumit|mute|bez zvuku|zapni zvuk)$/.test(text)) return { kind: 'tv', key: 'mute' }
  const louder = /^(zesil|hlasitost nahoru|hlasitej[si]*|nahlas|pridej|pridej zvuk)( o (\S+))?$/.exec(text)
  if (louder) return { kind: 'tv', key: 'volup', repeat: number(louder[3]) ?? 2 }
  const quieter = /^(ztis|ztlum|hlasitost dolu|potichu|tiseji|uber|uber zvuk)( o (\S+))?$/.exec(text)
  if (quieter) return { kind: 'tv', key: 'voldown', repeat: number(quieter[3]) ?? 2 }
  if (/^(dalsi kanal|kanal nahoru)$/.test(text)) return { kind: 'tv', key: 'chup' }
  if (/^(predchozi kanal|kanal dolu)$/.test(text)) return { kind: 'tv', key: 'chdown' }

  if (/^(vypni|vypnout) (televizi|tv|televize)$/.test(text)) return { kind: 'tv', key: 'power' }
  if (/^(zapni|zapnout) (televizi|tv|televize)$/.test(text)) return { kind: 'power-on' }

  if (/^(pauza|pozastav|zastav|stop pauza|pockej)$/.test(text)) return { kind: 'playback', action: 'pause' }
  if (/^(pokracuj|prehravej|play|pust to|hraj)$/.test(text)) return { kind: 'playback', action: 'resume' }
  if (/^(stop|ukonci prehravani|konec)$/.test(text)) return { kind: 'playback', action: 'stop' }

  for (const [re, screen] of SCREENS) {
    if (re.test(text)) return { kind: 'navigate', screen }
    const m = /^(otevri|jdi na|prejdi na|ukaz) (.+)$/.exec(text)
    if (m && re.test(m[2])) return { kind: 'navigate', screen }
  }

  const search = /^(hledej|najdi|vyhledej|vyhledat) (.+)$/.exec(text)
  if (search) return { kind: 'search', query: search[2] }

  const channel = /^(prepni na|prepni|kanal|pust kanal|zapni kanal) (.+)$/.exec(text)
  if (channel) return { kind: 'channel', query: channel[2] }

  const open = /^(zapni|spust|otevri|pust|pustit|spustit) (.+)$/.exec(text)
  if (open) {
    const app = appByName(open[2])
    if (app) return { kind: 'launch', app }
    if (open[1] === 'otevri' || open[1] === 'spust' || open[1] === 'spustit') return null
    return { kind: 'play', query: open[2].replace(/^(film|serial|dil|porad) /, '') }
  }

  const bare = appByName(text)
  return bare ? { kind: 'launch', app: bare } : null
}

/** Validates an intent from an untrusted source (a phone, an LLM). */
export function toIntent(value: unknown): Intent | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const str = (x: unknown) => (typeof x === 'string' && x.trim() && x.length <= 200 ? x.trim() : null)
  switch (v.kind) {
    case 'launch':
      return typeof v.app === 'string' && APPS.some((a) => a.id === v.app) ? { kind: 'launch', app: v.app } : null
    case 'play':
    case 'channel':
    case 'search': {
      const query = str(v.query)
      return query ? { kind: v.kind, query } : null
    }
    case 'open-url':
      return typeof v.url === 'string' && /^https?:\/\/\S+$/i.test(v.url) && v.url.length <= 2000 ? { kind: 'open-url', url: v.url } : null
    case 'navigate':
      return ['home', 'library', 'tv', 'search', 'settings', 'browser', 'appearance'].includes(v.screen as string)
        ? { kind: 'navigate', screen: v.screen as Screen }
        : null
    case 'playback':
      return ['pause', 'resume', 'stop'].includes(v.action as string)
        ? { kind: 'playback', action: v.action as 'pause' | 'resume' | 'stop' }
        : null
    case 'tv': {
      if (!['volup', 'voldown', 'mute', 'power', 'chup', 'chdown'].includes(v.key as string)) return null
      const repeat = typeof v.repeat === 'number' && v.repeat >= 1 ? Math.min(Math.round(v.repeat), 20) : undefined
      return repeat ? { kind: 'tv', key: v.key as TvKey, repeat } : { kind: 'tv', key: v.key as TvKey }
    }
    case 'power-on':
      return { kind: 'power-on' }
    case 'sleep':
      if (v.minutes === null) return { kind: 'sleep', minutes: null }
      return typeof v.minutes === 'number' && v.minutes >= 1 && v.minutes <= 600
        ? { kind: 'sleep', minutes: Math.round(v.minutes) }
        : null
    default:
      return null
  }
}

/** One line for the phone after a command ran. */
export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case 'launch':
      return `Spouštím ${APPS.find((a) => a.id === intent.app)?.name ?? intent.app}`
    case 'play':
      return `Hledám a pouštím „${intent.query}“`
    case 'channel':
      return `Přepínám na ${intent.query}`
    case 'search':
      return `Hledám „${intent.query}“`
    case 'open-url':
      return `Otevírám ${intent.url.replace(/^https?:\/\//, '')}`
    case 'navigate':
      return 'Otevírám'
    case 'playback':
      return intent.action === 'pause' ? 'Pozastaveno' : intent.action === 'resume' ? 'Pokračuji' : 'Zastaveno'
    case 'tv':
      return { volup: 'Zesiluji', voldown: 'Ztišuji', mute: 'Zvuk vypnut/zapnut', power: 'Vypínám televizi', chup: 'Další kanál', chdown: 'Předchozí kanál' }[intent.key]
    case 'power-on':
      return 'Zapínám televizi'
    case 'sleep':
      return intent.minutes === null ? 'Časovač zrušen' : `Vypnu za ${intent.minutes} min`
  }
}
