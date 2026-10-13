import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenLot, Targets } from '@shared/types'
import { openDatabase, schema, type Db } from '../src/main/db'
import { computeRebalance, loadTargets, roundedTargets, saleCost, saveTargets, splitRows, validateTargets } from '../src/main/portfolio/rebalance'
import { loadExposureInputs } from '../src/main/portfolio/exposure'
import type { HoldingRow } from '@shared/types'

const t = (eq: number, debt: number, extra: Partial<Targets['buckets']> = {}, band = 0.05): Targets => ({
  buckets: { EQUITY_IN: eq, EQUITY_INTL: 0, DEBT: debt, GOLD: 0, CASH: 0, ...extra },
  band
})

describe('targets', () => {
  it('rounds today’s mix to 5% steps that add up to 100%', () => {
    const r = roundedTargets({ EQUITY_IN: 0.62, EQUITY_INTL: 0.13, DEBT: 0.18, GOLD: 0.04, CASH: 0.03 })
    expect(Object.values(r).reduce((s, v) => s + v, 0)).toBeCloseTo(1)
    expect(r).toEqual({ EQUITY_IN: 0.6, EQUITY_INTL: 0.15, DEBT: 0.2, GOLD: 0.05, CASH: 0 })
    const thirds = roundedTargets({ EQUITY_IN: 1 / 3, EQUITY_INTL: 0, DEBT: 1 / 3, GOLD: 1 / 3, CASH: 0 })
    expect(Object.values(thirds).reduce((s, v) => s + v, 0)).toBeCloseTo(1)
  })

  it('rejects targets that do not add up, or a silly band', () => {
    expect(() => validateTargets(t(0.5, 0.4))).toThrow(/add up to 100%/)
    expect(() => validateTargets(t(0.5, 0.5, {}, 0))).toThrow(/drift/)
    expect(() => validateTargets({ ...t(0.5, 0.5), caps: { LARGE: 0.5, MID: 0.3, SMALL: 0.1 } })).toThrow(/cap/)
    expect(validateTargets(t(0.5, 0.5)).buckets.DEBT).toBe(0.5)
  })
})

describe('saleCost', () => {
  const lot = (buyDate: string, units: number, cost: number, value: number, term: 'ST' | 'LT', kind: OpenLot['kind']): OpenLot => ({
    personId: 1,
    personName: 'Me',
    accountName: 'Demat',
    accountId: 1,
    instrumentId: 1,
    name: 'X',
    taxClass: 'EQUITY',
    buyDate,
    units,
    costInr: cost,
    valueInr: value,
    gainInr: value - cost,
    term,
    kind,
    longTermFrom: null
  })

  it('sells oldest lots first and uses the exemption before taxing long-term gains', () => {
    const lots = [lot('2023-01-01', 10, 1000, 3000, 'LT', '112A'), lot('2026-06-01', 10, 2500, 3000, 'ST', '111A')]
    const c = saleCost(lots, 4500, 1000)
    // All of lot 1 (gain 2000) + half of lot 2 (gain 250).
    expect(c.units).toBeCloseTo(15)
    expect(c.gainInr).toBeCloseTo(2250)
    expect(c.exemptUsed).toBe(1000)
    expect(c.taxInr).toBeCloseTo(1000 * 0.125 + 250 * 0.2)
  })

  it('reports slab gains without taxing them, and no tax on a loss', () => {
    expect(saleCost([lot('2024-01-01', 10, 1200, 1000, 'LT', '112A')], 500, 0).taxInr).toBe(0)
    const slab = saleCost([lot('2024-01-01', 10, 800, 1000, 'ST', 'SLAB')], 1000, 0)
    expect(slab).toMatchObject({ taxInr: 0, slabGainInr: 200 })
  })
})

// ---------------- computeRebalance on a database ----------------

let dir: string
let db: Db
let close: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-rebal-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

/** ₹80k in one share (bought 2024 at half today's price), ₹20k in a liquid fund, optionally ₹100k PPF. */
function seed(ppf = 0) {
  const demat = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'ZERODHA', kind: 'DEMAT', name: 'Demat', externalId: 'D1', currency: 'INR' })
    .returning()
    .get()
  const folio = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'MF_RTA', kind: 'MF_FOLIO', name: 'Folio', externalId: 'F1', currency: 'INR' })
    .returning()
    .get()
  const stock = db.insert(schema.instruments).values({ isin: 'INE000S01001', name: 'STEADY CO', assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
  const liquid = db
    .insert(schema.instruments)
    .values({ isin: 'INF000L01001', name: 'Some Liquid Fund - Direct Plan - Growth', assetClass: 'MF', currency: 'INR', mfCategory: 'Debt Scheme - Liquid Fund' })
    .returning()
    .get()
  db.insert(schema.transactions)
    .values({ accountId: demat.id, instrumentId: stock.id, date: '2024-01-01', type: 'BUY', quantity: 100, price: 400, amount: -40_000, source: 'TEST', externalId: '1' })
    .run()
  db.insert(schema.quotes)
    .values({ instrumentId: stock.id, price: 800, prevClose: 800, currency: 'INR', asOf: '2026-10-13T10:00:00Z', source: 'TEST', fetchedAt: '2026-10-13T10:00:00Z' })
    .run()
  db.insert(schema.holdingSnapshots).values({ accountId: folio.id, instrumentId: liquid.id, date: '2026-09-30', quantity: 10, price: 2000, value: 20_000, source: 'CAS' }).run()
  if (ppf) {
    const acct = db.insert(schema.accounts).values({ personId: 1, platform: 'BANK', kind: 'OTHER', name: 'PPF', externalId: 'P1', currency: 'INR' }).returning().get()
    const inst = db.insert(schema.instruments).values({ name: 'PPF', assetClass: 'PPF', currency: 'INR' }).returning().get()
    db.insert(schema.holdingSnapshots).values({ accountId: acct.id, instrumentId: inst.id, date: '2026-09-30', quantity: 1, price: ppf, value: ppf, source: 'MANUAL' }).run()
  }
  return { stock, liquid }
}

describe('computeRebalance', () => {
  it('without targets, shows the mix and offers it rounded as a starting point', () => {
    seed()
    const r = computeRebalance(db, 1, { newMoneyInr: 0, allowSells: false })
    expect(r.targets).toBeNull()
    expect(r.baseInr).toBeCloseTo(100_000)
    expect(r.buckets.find((b) => b.bucket === 'EQUITY_IN')!.share).toBeCloseTo(0.8)
    expect(r.suggestedTargets.buckets).toMatchObject({ EQUITY_IN: 0.8, DEBT: 0.2 })
    expect(r.plan.trades).toEqual([])
  })

  it('puts new money into the bucket below target, using a holding already there', () => {
    const { liquid } = seed()
    saveTargets(db, null, t(0.5, 0.5))
    const r = computeRebalance(db, 1, { newMoneyInr: 20_000, allowSells: false })
    expect(r.buckets.find((b) => b.bucket === 'EQUITY_IN')!.status).toBe('OVER')
    expect(r.plan.trades).toHaveLength(1)
    expect(r.plan.trades[0]).toMatchObject({ action: 'BUY', bucket: 'DEBT', amountInr: 20_000 })
    expect(r.plan.trades[0].holding?.instrumentId).toBe(liquid.id)
    expect(r.plan.after.find((a) => a.bucket === 'DEBT')!.share).toBeCloseTo(40 / 120)
  })

  it('with selling allowed, sells the overweight bucket down to target and works out the tax', () => {
    seed()
    saveTargets(db, null, t(0.5, 0.5))
    const r = computeRebalance(db, 1, { newMoneyInr: 0, allowSells: true })
    const sell = r.plan.trades.find((x) => x.action === 'SELL')!
    expect(sell).toMatchObject({ bucket: 'EQUITY_IN', amountInr: 30_000 })
    expect(sell.units).toBeCloseTo(37.5)
    // Long-term gain of ₹15,000 sits inside the ₹1.25 lakh exemption.
    expect(sell.gainInr).toBeCloseTo(15_000)
    expect(sell.taxInr).toBe(0)
    expect(r.plan.trades.find((x) => x.action === 'BUY')).toMatchObject({ bucket: 'DEBT', amountInr: 30_000 })
    expect(r.plan.after.find((a) => a.bucket === 'EQUITY_IN')!.share).toBeCloseTo(0.5)
  })

  it("can't sell PPF: says so, and sells what it can", () => {
    seed(100_000)
    saveTargets(db, null, t(0.8, 0.2))
    const r = computeRebalance(db, 1, { newMoneyInr: 0, allowSells: true })
    const debt = r.buckets.find((b) => b.bucket === 'DEBT')!
    expect(debt).toMatchObject({ status: 'OVER', lockedInr: 100_000 })
    const sell = r.plan.trades.find((x) => x.action === 'SELL')!
    expect(sell).toMatchObject({ bucket: 'DEBT', amountInr: 20_000, taxInr: null })
    expect(r.plan.notes.some((n) => n.includes('₹1,00,000 of it is in deposits, EPF, PPF'))).toBe(true)
  })

  it('never offers a hand-entered asset for sale, even a bond', () => {
    const row = { accountId: 7, instrumentId: 1, instrumentName: 'Muthoot NCD 9% 2028', assetClass: 'BOND', marketValueInr: 100_000, investedInr: 91_000, isin: null, platform: 'OTHER' } as unknown as HoldingRow
    const inputs = loadExposureInputs(db)
    expect(splitRows([row], inputs)[0]).toMatchObject({ sellable: true, buckets: { DEBT: 100_000 } })
    expect(splitRows([row], inputs, new Set([7]))[0].sellable).toBe(false)
  })

  it('a person without their own target uses the family one', () => {
    seed()
    saveTargets(db, null, t(0.6, 0.4))
    expect(loadTargets(db, 1).source).toBe('FAMILY')
    saveTargets(db, 1, t(0.7, 0.3))
    expect(loadTargets(db, 1)).toMatchObject({ source: 'OWN', targets: { buckets: { EQUITY_IN: 0.7 } } })
    saveTargets(db, 1, null)
    expect(loadTargets(db, 1).source).toBe('FAMILY')
  })
})
