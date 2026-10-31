import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeAppearance, type Appearance, type CustomBackground } from '../shared/appearance.ts'

/** What the hub remembers between starts: paired phones, the Samsung token, the notify token. */
export interface HubState {
  remoteTokens: string[]
  samsungToken?: string
  notifyToken: string
  /** The home-screen look shared by every TV and phone. */
  appearance: Appearance
  /** Photos phones sent as backgrounds; the files live in `<data>/backgrounds`. */
  backgrounds: CustomBackground[]
}

const token = () => randomBytes(24).toString('base64url')

export class Store {
  readonly state: HubState
  private readonly file: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'state.json')
    let loaded: Partial<HubState> = {}
    try {
      loaded = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<HubState>
    } catch {
      // First start, or an unreadable file: start fresh (pairings are cheap to redo).
    }
    this.state = {
      remoteTokens: Array.isArray(loaded.remoteTokens) ? loaded.remoteTokens : [],
      samsungToken: loaded.samsungToken,
      notifyToken: loaded.notifyToken ?? token(),
      appearance: normalizeAppearance(loaded.appearance),
      backgrounds: Array.isArray(loaded.backgrounds) ? loaded.backgrounds.filter((b) => b && typeof b.id === 'string' && /^[a-z0-9]{6,32}$/.test(b.id)) : [],
    }
    this.save()
  }

  /** Writes a temporary file and renames it, so a crash never leaves half a file. */
  save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  addRemote(): string {
    const t = token()
    this.state.remoteTokens.push(t)
    this.save()
    return t
  }

  hasRemote(t: unknown): boolean {
    return typeof t === 'string' && this.state.remoteTokens.some((known) => safeEqual(known, t))
  }

  clearRemotes(): void {
    this.state.remoteTokens = []
    this.save()
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The four-digit code shown on the TV for pairing a phone. It changes after every
 * pairing and every 10 minutes, and five wrong guesses in a row replace it.
 */
export class PairingCode {
  code = ''
  private failures = 0
  private timer?: NodeJS.Timeout
  private readonly onChange: (code: string) => void

  constructor(onChange: (code: string) => void) {
    this.onChange = onChange
    this.rotate()
  }

  rotate(): void {
    this.code = String(randomInt(0, 10_000)).padStart(4, '0')
    this.failures = 0
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.rotate(), 10 * 60_000)
    this.timer.unref()
    this.onChange(this.code)
  }

  check(code: unknown): boolean {
    if (typeof code === 'string' && safeEqual(code, this.code)) {
      this.rotate()
      return true
    }
    this.failures++
    if (this.failures >= 5) this.rotate()
    return false
  }
}
