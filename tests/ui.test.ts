import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { periodStartDate, periodStartIndex } from '../src/renderer/src/lib/periods'
import { openDatabase, schema, type Db } from '../src/main/db'
import { computeHealth } from '../src/main/portfolio/health'
import { createServices } from '../src/main/services'

describe('period picker arithmetic', () => {
  it('works out where each period starts', () => {
    expect(periodStartDate('6M', '2026-10-13')).toBe('2026-04-13')
    expect(periodStartDate('1Y', '2026-10-13')).toBe('2025-10-13')
    expect(periodStartDate('3Y', '2026-08-31')).toBe('2023-08-31')
    expect(periodStartDate('FY', '2026-10-13')).toBe('2026-03-31')
    expect(periodStartDate('FY', '2026-02-10')).toBe('2025-03-31')
    expect(periodStartDate('6M', '2026-08-31')).toBe('2026-02-28')
    expect(periodStartDate('ALL', '2026-10-13')).toBeNull()
  })

  it('opens the window on the last month end at or before the start', () => {
    const months = ['2025-09-30', '2025-10-31', '2025-11-30', '2026-03-31', '2026-09-30', '2026-10-13']
    expect(periodStartIndex(months, '1Y')).toBe(0)
    expect(periodStartIndex(months, 'FY')).toBe(3)
    expect(periodStartIndex(months, 'ALL')).toBe(0)
    expect(periodStartIndex(months.slice(3), '5Y')).toBe(0)
  })
})

let dir: string
let db: Db
let close: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-ui-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('computeHealth', () => {
  it('flags a holding with no buy price, an old price, a Regular plan and a missing target', () => {
    const acct = db
      .insert(schema.accounts)
      .values({ personId: 1, platform: 'DEMAT_OTHER', kind: 'DEMAT', name: 'CDSL demat', externalId: 'C1', currency: 'INR' })
      .returning()
      .get()
    const stock = db.insert(schema.instruments).values({ isin: 'INE000A01001', name: 'SOME CO', assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
    const fund = db
      .insert(schema.instruments)
      .values({ isin: 'INF000A01001', name: 'Some Flexi Cap Fund - Regular Plan - Growth', assetClass: 'MF', currency: 'INR', mfCategory: 'Equity Scheme - Flexi Cap Fund' })
      .returning()
      .get()
    db.insert(schema.holdingSnapshots)
      .values([
        { accountId: acct.id, instrumentId: stock.id, date: '2026-09-30', quantity: 10, price: 100, value: 1000, source: 'CAS' },
        { accountId: acct.id, instrumentId: fund.id, date: '2026-09-30', quantity: 10, price: 50, value: 500, cost: 400, source: 'CAS' }
      ])
      .run()
    const h = computeHealth(db, 1, null, '2026-10-13')
    const by = new Map(h.checks.map((c) => [c.key, c]))
    expect(by.get('buy-price')).toMatchObject({ status: 'WARN', link: '/import?kind=BROKER_HOLDINGS' })
    expect(by.get('buy-price')!.title).toMatch(/^1 holding has no buy price/)
    expect(by.get('prices')!.status).toBe('WARN')
    expect(by.get('regular')).toMatchObject({ status: 'WARN', link: '/funds' })
    expect(by.get('targets')).toMatchObject({ status: 'INFO', title: 'No target mix set' })
    expect(h.issues).toBe(h.checks.filter((c) => c.status === 'WARN').length)
    // Problems first, passes last.
    expect(h.checks[h.checks.length - 1].status).not.toBe('WARN')
  })

  it('passes everything for an empty book', () => {
    const h = computeHealth(db, 1, null, '2026-10-13')
    expect(h.issues).toBe(0)
  })
})

describe('theme setting', () => {
  it('is saved and handed to the window', () => {
    const applied: string[] = []
    const svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, applyTheme: (t) => applied.push(t) })
    // The terminal look until another is chosen.
    expect(svc.getTheme()).toBe('terminal')
    svc.setTheme('dark')
    expect(svc.getTheme()).toBe('dark')
    expect(applied).toEqual(['dark'])
    svc.setTheme('system')
    expect(svc.getTheme()).toBe('system')
    expect(() => svc.setTheme('blue' as never)).toThrow()
  })
})
