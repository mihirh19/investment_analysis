import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { gatherReport, reportHtml } from '../src/main/report'

describe('the monthly report', () => {
  it('adds up the money and writes a printable page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-report-'))
    const o = openDatabase(join(dir, 't.db'), 'd'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      const me = db.insert(schema.persons).values({ name: 'Me <& co>', relation: 'SELF' }).returning().get()
      const acct = db.insert(schema.accounts).values({ personId: me.id, name: 'Demat', platform: 'ZERODHA', kind: 'DEMAT' }).returning().get()
      const i = db.insert(schema.instruments).values({ name: 'Infosys', isin: 'INE009A01021', assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
      db.insert(schema.transactions).values({ accountId: acct.id, instrumentId: i.id, date: '2026-01-02', type: 'BUY', quantity: 10, price: 1000, amount: -10_000, source: 'TEST', externalId: '1' }).run()
      db.insert(schema.quotes).values({ instrumentId: i.id, price: 1500, prevClose: 1500, currency: 'INR', asOf: '2026-10-20T10:00:00Z', source: 'TEST', fetchedAt: '2026-10-20T10:00:00Z' }).run()

      const r = gatherReport(db, undefined, new Date('2026-10-27T06:00:00Z'))
      expect(r).toMatchObject({ total: 15_000, owed: 0, month: 'October 2026' })
      expect(r.byClass).toEqual([{ label: 'Indian stocks', value: 15_000, share: 1 }])
      expect(r.top[0]).toMatchObject({ name: 'Infosys', value: 15_000, gain: 5_000 })
      expect(gatherReport(db, me.id).title).toBe('Me <& co>’s money'.replace('’', "'"))

      const html = reportHtml(gatherReport(db, me.id))
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('₹15,000')
      expect(html).toContain('Me &lt;&amp; co&gt;')
      expect(html).not.toContain('<script')
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
