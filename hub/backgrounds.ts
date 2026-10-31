import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { CustomBackground } from '../shared/appearance.ts'

/** Phones shrink photos before sending; this still leaves room for a large original. */
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024
const MAX_BACKGROUNDS = 40

/** Recognises JPEG, PNG and WebP by their first bytes, so the hub never stores anything else. */
export function imageType(data: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** A readable name from the phone's file name ("IMG_2041.jpeg" → "IMG_2041"). */
export function backgroundName(raw: string | undefined): string {
  const name = (raw ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)
  return name || 'Vlastní fotka'
}

/** Background photos sent from phones, stored as files next to the hub's state. */
export class Backgrounds {
  private readonly dir: string
  private readonly list: CustomBackground[]
  private readonly save: () => void

  /** `list` is the hub state's array, changed in place; `save` writes the state. */
  constructor(dataDir: string, list: CustomBackground[], save: () => void) {
    this.dir = join(dataDir, 'backgrounds')
    this.list = list
    this.save = save
    mkdirSync(this.dir, { recursive: true })
  }

  has(id: string): boolean {
    return this.list.some((b) => b.id === id)
  }

  async add(req: IncomingMessage, name: string | undefined): Promise<CustomBackground> {
    if (this.list.length >= MAX_BACKGROUNDS) throw new Error(`Uložit jde nejvýš ${MAX_BACKGROUNDS} fotek. Nejdřív nějakou smažte.`)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BACKGROUND_BYTES) throw new Error('Fotka je příliš velká (nejvýš 12 MB).')
      chunks.push(chunk as Buffer)
    }
    const data = Buffer.concat(chunks)
    if (!imageType(data)) throw new Error('Pozadí může být jen fotka JPEG, PNG nebo WebP.')
    const bg = { id: randomBytes(8).toString('hex'), name: backgroundName(name) }
    await writeFile(join(this.dir, bg.id), data)
    this.list.push(bg)
    this.save()
    return bg
  }

  async remove(id: string): Promise<boolean> {
    const i = this.list.findIndex((b) => b.id === id)
    if (i < 0) return false
    this.list.splice(i, 1)
    this.save()
    await unlink(join(this.dir, id)).catch(() => {})
    return true
  }

  async read(id: string): Promise<{ data: Buffer; type: string } | null> {
    if (!this.has(id)) return null
    const data = await readFile(join(this.dir, id)).catch(() => null)
    const type = data && imageType(data)
    return data && type ? { data, type } : null
  }
}
