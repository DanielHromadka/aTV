import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Musicians } from './musicians.ts'
import { MUSICIAN_SELECTION } from '../shared/musician-selection.ts'
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))
function fixture(duplicate = false) {
  const d = mkdtempSync(join(tmpdir(), 'atv-musicians-')); dirs.push(d)
  writeFileSync(join(d, 'musicians-library.json'), JSON.stringify({ version: 1, updatedAt: '2026-10-30', entries: Array.from({ length:300 }, (_,i) => ({ musician: { id: duplicate ? '1' : String(i+1), name: i === 299 ? 'Miroslav Žbirka' : `Artist ${i}`, fans: 1, link: 'https://www.deezer.com' }, releases: [{id:'1',title:'Album'}], tracks: [] })) }))
  return new Musicians(d)
}
it('defines exactly 300 unique editorial names', () => { expect(MUSICIAN_SELECTION).toHaveLength(300); expect(new Set(MUSICIAN_SELECTION).size).toBe(300) })
it('paginates without duplicates and searches Czech names without accents', () => {
  const service = fixture()
  const pages = Array.from({length:13}, (_,i) => service.list('',i+1))
  expect(new Set(pages.flatMap(p=>p.musicians.map(m=>m.id))).size).toBe(300)
  expect(pages[12].musicians).toHaveLength(12)
  expect(pages[12].more).toBe(false)
  expect(service.list('zbirka', 10).musicians[0].name).toBe('Miroslav Žbirka')
  expect(service.list('not found',1).total).toBe(0)
  expect(service.detail('300')?.releases).toHaveLength(1)
  expect(service.detail('../config')).toBeUndefined()
})
it('does not expose an incomplete or duplicated library as a completed collection', () => { expect(()=>fixture(true).list('',1)).toThrow('není importovaná') })
