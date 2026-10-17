import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { flowsFromStatements } from '../src/main/portfolio/analysis'
import { unitsHeldBefore } from '../src/main/portfolio/dividends'
import type { FxTable } from '../src/main/portfolio/fx'
import { computePerformance } from '../src/main/portfolio/performance'

const snap = (date: string, quantity: number, price: number) =>
  ({ id: 0, accountId: 1, instrumentId: 1, date, quantity, price, value: quantity * price, cost: null, source: 'CAS', importBatchId: null })
const trade = (date: string, quantity: number, price: number) =>
  ({
    id: 0,
    accountId: 1,
    instrumentId: 1,
    date,
    type: quantity > 0 ? 'BUY' : 'SELL',
    quantity,
    price,
    amount: Math.abs(quantity) * price,
    fees: 0,
    currency: 'INR',
    description: null,
    source: 'X',
    externalId: date,
    importBatchId: null
  }) as never
const noFx = {} as FxTable

describe('returns measured from statements', () => {
  it('counts the first statement as bought then, and unexplained changes as buys or sells', () => {
    const r = flowsFromStatements(
      [snap('2026-03-31', 100, 50), snap('2026-06-30', 120, 55), snap('2026-09-30', 115, 60)],
      [trade('2026-08-10', -10, 58)],
      (_d, s) => s?.price ?? null,
      noFx,
      false
    )
    expect(r?.since).toBe('2026-03-31')
    expect(r?.flows).toEqual([
      { date: '2026-03-31', amount: -5000 },
      { date: '2026-06-30', amount: -20 * 55 }, // 20 more units, no trade on record: bought
      { date: '2026-08-10', amount: 580 }, // the recorded sale
      { date: '2026-09-30', amount: -5 * 60 } // 110 after the sale, 115 held: 5 more bought
    ])
  })

  it('goes back to the first trade when trade files reach further than the statements', () => {
    // Held 100 at the statement; the trades explain 30 of them, so 70 were there before April 2025.
    const r = flowsFromStatements(
      [snap('2026-09-30', 100, 80)],
      [trade('2025-04-02', 30, 70), trade('2026-10-05', 5, 82)],
      (d, s) => (s ? s.price : d === '2025-04-01' ? 65 : null),
      noFx,
      false
    )
    expect(r?.since).toBe('2025-04-01')
    expect(r?.flows).toEqual([
      { date: '2025-04-01', amount: -70 * 65 },
      { date: '2025-04-02', amount: -2100 },
      { date: '2026-10-05', amount: -410 }
    ])
  })

  it('counts those units in the history from the first trade, not the first statement', () => {
    const snaps = [snap('2026-09-30', 100, 80)]
    const trades = [trade('2025-04-02', 30, 70), trade('2026-10-05', 5, 82)]
    expect(unitsHeldBefore('2025-03-01', trades, snaps)).toBeNull() // before the files: unknown
    expect(unitsHeldBefore('2025-04-02', trades, snaps)).toBe(70)
    expect(unitsHeldBefore('2025-06-01', trades, snaps)).toBe(100)
    expect(unitsHeldBefore('2026-10-10', trades, snaps)).toBe(105)
  })

  it('stays with the statements when they go back further than the trades', () => {
    const r = flowsFromStatements(
      [snap('2024-03-31', 50, 40), snap('2026-09-30', 100, 80)],
      [trade('2025-04-02', 30, 70)],
      (_d, s) => s?.price ?? null,
      noFx,
      false
    )
    expect(r?.since).toBe('2024-03-31')
  })
})

describe('the Performance page', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-perf-'))
    const o = openDatabase(join(dir, 't.db'), 'f'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('includes statement-only holdings, measured from their first statement', () => {
    persistBundle(db, {
      personId: 1,
      kind: 'CAS_PDF',
      fileName: 'cas.pdf',
      bundle: {
        accounts: [{ key: 'a', platform: 'ZERODHA', kind: 'DEMAT', name: 'Zerodha', externalId: '1', currency: 'INR' }],
        instruments: [{ key: 'i', isin: 'INE009A01021', name: 'INFOSYS LIMITED', assetClass: 'EQUITY_IN', currency: 'INR' }],
        transactions: [],
        snapshots: [
          { accountKey: 'a', instrumentKey: 'i', date: '2025-09-30', quantity: 10, price: 1500, value: 15000, cost: null, source: 'CAS' },
          { accountKey: 'a', instrumentKey: 'i', date: '2026-09-30', quantity: 10, price: 1650, value: 16500, cost: null, source: 'CAS' }
        ],
        warnings: []
      }
    })
    const p = computePerformance(db, 1)
    expect(p.coverage).toBeCloseTo(1, 6)
    expect(p.fromStatementsInr).toBe(16500)
    expect(p.statementsSince).toBe('2025-09-30')
    expect(p.xirr.byHolding[0].since).toBe('2025-09-30')
    expect(p.xirr.overall).toBeGreaterThan(0.05)
  })
})
