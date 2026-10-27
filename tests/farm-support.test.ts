import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { deleteSupport, farmReport, saveSupport, supportOf } from '../src/main/farm'

describe('government support for the farm', () => {
  it('records payments, counts them in the year and tracks PM-KISAN periods', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-support-'))
    const o = openDatabase(join(dir, 't.db'), 'a'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      const dad = db.insert(schema.persons).values({ name: 'Dad', relation: 'PARENT' }).returning().get()
      expect(() => saveSupport(db, { personId: dad.id, scheme: 'PM_KISAN', date: '2026-05-10', amount: 0 })).toThrow()
      saveSupport(db, { personId: dad.id, scheme: 'PM_KISAN', date: '2026-06-20', amount: 2000 })
      // The Aug–Nov one came early in December: still counts for its period.
      saveSupport(db, { personId: dad.id, scheme: 'PM_KISAN', date: '2026-12-05', amount: 2000 })
      const claim = saveSupport(db, { personId: dad.id, scheme: 'CROP_CLAIM', date: '2026-11-02', amount: 18_000, note: 'Kharif 2026 groundnut' })
      saveSupport(db, { personId: dad.id, scheme: 'SUBSIDY', date: '2026-01-15', amount: 5000 }) // last financial year

      const s = supportOf(db, undefined, '2026-12-20')
      expect(s.entries.map((e) => e.scheme)).toEqual(['PM_KISAN', 'CROP_CLAIM', 'PM_KISAN', 'SUBSIDY'])
      expect(s.pmKisan).toHaveLength(1)
      expect(s.pmKisan[0].periods.map((p) => [p.label, p.received?.date ?? null, p.due])).toEqual([
        ['Apr–Jul', '2026-06-20', true],
        ['Aug–Nov', '2026-12-05', true],
        ['Dec–Mar', null, true]
      ])
      expect(farmReport(db, undefined, '2026-12-20').thisFy).toMatchObject({ fy: 'FY27', support: 22_000 })
      deleteSupport(db, claim)
      expect(farmReport(db, dad.id, '2026-12-20').thisFy.support).toBe(4000)
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
