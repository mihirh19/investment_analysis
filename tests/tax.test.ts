import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { computeFifo } from '../src/main/portfolio/fifo'
import { computeTax, fmvKey } from '../src/main/portfolio/tax'
import {
  grandfatheredCost,
  ltcgExemption,
  taxClassOf,
  treatment,
  yearTax
} from '../src/main/portfolio/taxRules'

// ---------------- rules ----------------

describe('treatment: listed equity', () => {
  it('is long-term only when held for more than 12 months', () => {
    expect(treatment('EQUITY', '2023-01-01', '2024-01-01').term).toBe('ST')
    expect(treatment('EQUITY', '2023-01-01', '2024-01-02').term).toBe('LT')
    expect(treatment('EQUITY', '2023-01-01', '2024-01-01').longTermFrom).toBe('2024-01-02')
  })

  it('switches rates for sales from 23 July 2024', () => {
    expect(treatment('EQUITY', '2022-01-01', '2024-07-22')).toMatchObject({ kind: '112A', rate: 0.1 })
    expect(treatment('EQUITY', '2022-01-01', '2024-07-23')).toMatchObject({ kind: '112A', rate: 0.125 })
    expect(treatment('EQUITY', '2024-03-01', '2024-07-22')).toMatchObject({ kind: '111A', rate: 0.15 })
    expect(treatment('EQUITY', '2024-03-01', '2024-07-23')).toMatchObject({ kind: '111A', rate: 0.2 })
  })
})

describe('treatment: funds and other assets', () => {
  it('debt funds bought from April 2023 are always taxed at the slab', () => {
    const t = treatment('DEBT_FUND', '2023-04-01', '2030-01-01')
    expect(t).toMatchObject({ term: 'ST', kind: 'SLAB', rate: null, longTermFrom: null })
  })

  it('older debt funds: 36 months before 23 Jul 2024, 24 months after, at 12.5%', () => {
    expect(treatment('DEBT_FUND', '2022-06-01', '2024-07-01')).toMatchObject({ term: 'ST', kind: 'SLAB' })
    expect(treatment('DEBT_FUND', '2022-06-01', '2024-08-01')).toMatchObject({ term: 'LT', kind: 'LT_OTHER', rate: 0.125 })
  })

  it('gold and international funds bought Apr 2023–Mar 2025 are slab-taxed only if sold before Apr 2025', () => {
    expect(treatment('OTHER_FUND', '2023-06-01', '2025-03-01').kind).toBe('SLAB')
    expect(treatment('OTHER_FUND', '2023-06-01', '2025-05-01')).toMatchObject({ term: 'ST', kind: 'SLAB' })
    expect(treatment('OTHER_FUND', '2023-06-01', '2025-07-01')).toMatchObject({ term: 'LT', rate: 0.125 })
  })

  it('US shares need 24 months; listed bonds and SGBs 12 (10% before 23 Jul 2024)', () => {
    expect(treatment('FOREIGN', '2023-01-01', '2024-12-31').term).toBe('ST')
    expect(treatment('FOREIGN', '2023-01-01', '2025-01-02')).toMatchObject({ term: 'LT', rate: 0.125 })
    expect(treatment('LISTED_OTHER', '2023-01-01', '2024-01-02')).toMatchObject({ term: 'LT', rate: 0.1 })
    expect(treatment('LISTED_OTHER', '2024-01-01', '2025-01-02')).toMatchObject({ term: 'LT', rate: 0.125 })
  })
})

describe('grandfathering and the exemption', () => {
  it('uses the higher of cost and the lower of the 31 Jan 2018 value and the sale value', () => {
    expect(grandfatheredCost(100, 150, 200)).toBe(150)
    expect(grandfatheredCost(100, 150, 120)).toBe(120)
    expect(grandfatheredCost(160, 150, 200)).toBe(160)
    expect(grandfatheredCost(100, null, 200)).toBe(100)
  })

  it('is ₹1 lakh up to FY24 and ₹1.25 lakh from FY25', () => {
    expect(ltcgExemption('FY24')).toBe(100_000)
    expect(ltcgExemption('FY25')).toBe(125_000)
    expect(ltcgExemption('FY27')).toBe(125_000)
  })
})

describe('yearTax', () => {
  it('sets a short-term loss against long-term gains, then applies the exemption', () => {
    const t = yearTax('FY26', [
      { term: 'LT', kind: '112A', rate: 0.125, amount: 200_000 },
      { term: 'ST', kind: '111A', rate: 0.2, amount: -50_000 }
    ])
    expect(t.longTermGain).toBe(150_000)
    expect(t.exemptionUsed).toBe(125_000)
    expect(t.fixedRateTax).toBeCloseTo(25_000 * 0.125)
    expect(t.carryForward).toEqual({ shortTerm: 0, longTerm: 0 })
  })

  it('does not set a long-term loss against short-term gains; it is carried forward', () => {
    const t = yearTax('FY26', [
      { term: 'ST', kind: '111A', rate: 0.2, amount: 100_000 },
      { term: 'LT', kind: '112A', rate: 0.125, amount: -30_000 }
    ])
    expect(t.fixedRateTax).toBeCloseTo(20_000)
    expect(t.carryForward.longTerm).toBe(30_000)
  })

  it('gives the exemption to the 12.5% gains first in the year the rate changed', () => {
    const t = yearTax('FY25', [
      { term: 'LT', kind: '112A', rate: 0.1, amount: 100_000 },
      { term: 'LT', kind: '112A', rate: 0.125, amount: 100_000 }
    ])
    expect(t.fixedRateTax).toBeCloseTo(75_000 * 0.1)
  })

  it('a short-term loss goes against slab gains before fixed-rate ones', () => {
    const t = yearTax('FY26', [
      { term: 'ST', kind: 'SLAB', rate: null, amount: 40_000 },
      { term: 'ST', kind: '111A', rate: 0.2, amount: 40_000 },
      { term: 'ST', kind: '111A', rate: 0.2, amount: -50_000 }
    ])
    expect(t.slabGain).toBe(0)
    expect(t.fixedRateTax).toBeCloseTo(30_000 * 0.2)
  })
})

describe('taxClassOf', () => {
  const mf = (name: string, extra: { mfCategory?: string; mfType?: string } = {}) => taxClassOf({ assetClass: 'MF', name, ...extra })
  it('classifies the common cases', () => {
    expect(taxClassOf({ assetClass: 'EQUITY_IN', name: 'INFOSYS LIMITED' })).toBe('EQUITY')
    expect(taxClassOf({ assetClass: 'EQUITY_US', name: 'Apple Inc' })).toBe('FOREIGN')
    expect(taxClassOf({ assetClass: 'GOLD', name: 'SGB 2021-22 Series V' })).toBe('LISTED_OTHER')
    expect(taxClassOf({ assetClass: 'ETF', name: 'NIPPON INDIA ETF NIFTY 50 BEES' })).toBe('EQUITY')
    expect(taxClassOf({ assetClass: 'ETF', name: 'NIPPON INDIA ETF GOLD BEES' })).toBe('OTHER_FUND')
    expect(mf('Parag Parikh Flexi Cap Fund - Direct Plan Growth')).toBe('EQUITY')
    expect(mf('HDFC Liquid Fund - Direct Plan - Growth Option')).toBe('DEBT_FUND')
    expect(mf('Motilal Oswal Nasdaq 100 Fund of Fund')).toBe('OTHER_FUND')
    expect(mf('ICICI Prudential Equity & Debt Fund')).toBe('EQUITY')
    expect(mf('Edelweiss Nifty SDL Apr 2027 Index Fund')).toBe('DEBT_FUND')
    expect(mf('Some Fund', { mfCategory: 'Hybrid Scheme - Balanced Advantage' })).toBe('EQUITY')
    expect(mf('Some Fund', { mfCategory: 'Debt Scheme - Corporate Bond Fund' })).toBe('DEBT_FUND')
    expect(taxClassOf({ assetClass: 'FD', name: 'SBI FD' })).toBeNull()
  })
})

describe('computeFifo sales', () => {
  it('records each lot a sale draws from', () => {
    const r = computeFifo([
      { date: '2023-01-01', type: 'BUY', quantity: 10, amount: -1000, fees: 0 },
      { date: '2023-06-01', type: 'BUY', quantity: 10, amount: -2000, fees: 0 },
      { date: '2024-03-01', type: 'SELL', quantity: -15, amount: 3750, fees: 0 }
    ])
    expect(r.sales).toEqual([
      { buyDate: '2023-01-01', sellDate: '2024-03-01', quantity: 10, cost: 1000, proceeds: 2500 },
      { buyDate: '2023-06-01', sellDate: '2024-03-01', quantity: 5, cost: 1000, proceeds: 1250 }
    ])
  })
})

// ---------------- computeTax on a database ----------------

let dir: string
let db: Db
let close: () => void

function setup() {
  const acct = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'ZERODHA', kind: 'DEMAT', name: 'Zerodha demat', externalId: 'Z1', currency: 'INR' })
    .returning()
    .get()
  const add = (name: string, isin: string, assetClass: 'EQUITY_IN' | 'MF' = 'EQUITY_IN') =>
    db.insert(schema.instruments).values({ isin, name, assetClass, currency: 'INR' }).returning().get()
  const old = add('OLD CO', 'INE000A01001')
  const newer = add('NEW CO', 'INE000A01002')
  const loser = add('LOSS CO', 'INE000A01003')
  let n = 0
  const txn = (instrumentId: number, date: string, type: 'BUY' | 'SELL', qty: number, price: number) =>
    db
      .insert(schema.transactions)
      .values({
        accountId: acct.id,
        instrumentId,
        date,
        type,
        quantity: type === 'BUY' ? qty : -qty,
        price,
        amount: type === 'BUY' ? -qty * price : qty * price,
        source: 'TEST',
        externalId: String(++n)
      })
      .run()
  // OLD CO: 10 bought in 2017 at 100; 31 Jan 2018 value 150; 5 sold in Sep 2025 at 300.
  txn(old.id, '2017-06-01', 'BUY', 10, 100)
  txn(old.id, '2025-09-10', 'SELL', 5, 300)
  // NEW CO: 10 bought at 200 two months ago, 10 bought 13 months ago at 100.
  txn(newer.id, '2025-09-01', 'BUY', 10, 100)
  txn(newer.id, '2026-08-20', 'BUY', 10, 200)
  // LOSS CO: bought at 500 last year.
  txn(loser.id, '2025-12-01', 'BUY', 4, 500)
  db.insert(schema.priceHistory).values({ key: fmvKey(old.id), date: '2018-01-31', close: 150 }).run()
  const quote = (instrumentId: number, price: number) =>
    db
      .insert(schema.quotes)
      .values({ instrumentId, price, prevClose: price, currency: 'INR', asOf: '2026-10-13T10:00:00Z', source: 'TEST', fetchedAt: '2026-10-13T10:00:00Z' })
      .run()
  quote(old.id, 400)
  quote(newer.id, 250)
  quote(loser.id, 300)
  return { old, newer, loser }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-tax-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('computeTax', () => {
  it('works out a grandfathered long-term sale and its tax year', () => {
    setup()
    const t = computeTax(db, 1, '2026-10-13')
    expect(t.currentFy).toBe('FY27')
    const sale = t.realized.find((g) => g.name === 'OLD CO')!
    expect(sale).toMatchObject({ fy: 'FY26', term: 'LT', kind: '112A', rate: 0.125, grandfathered: true })
    // 5 units: actual cost 500, grandfathered to 5 × 150 = 750; proceeds 1500.
    expect(sale.costInr).toBe(750)
    expect(sale.gainInr).toBe(750)
    const fy26 = t.years.find((y) => y.fy === 'FY26')!
    expect(fy26.exemptionUsed).toBe(750)
    expect(fy26.fixedRateTax).toBe(0)
  })

  it('splits open lots by holding period and finds lots about to turn long-term', () => {
    const { newer } = setup()
    const t = computeTax(db, 1, '2026-10-13')
    const nl = t.lots.filter((l) => l.instrumentId === newer.id)
    expect(nl.map((l) => [l.buyDate, l.term])).toEqual([
      ['2025-09-01', 'LT'],
      ['2026-08-20', 'ST']
    ])
    // The Dec 2025 LOSS CO lot is at a loss, so it is not a "wait for long-term" idea.
    expect(t.soonLongTerm.map((l) => l.name)).toEqual([])
    expect(t.losses.map((l) => l.name)).toEqual(['LOSS CO'])
    expect(t.losses[0].gainInr).toBe(-800)
  })

  it('suggests harvesting long-term gains up to the unused exemption, oldest lots only', () => {
    setup()
    const t = computeTax(db, 1, '2026-10-13')
    expect(t.exemptionLeft).toEqual([{ personId: 1, personName: 'Me', left: 125_000, limit: 125_000 }])
    const names = t.harvest.map((h) => h.name).sort()
    expect(names).toEqual(['NEW CO', 'OLD CO'])
    // NEW CO: only the long-term 2025 lot (10 units, gain 1500); the 2026 lot is short-term.
    const nc = t.harvest.find((h) => h.name === 'NEW CO')!
    expect(nc.units).toBe(10)
    expect(nc.gainInr).toBe(1500)
  })

  it('lists a statement-only holding as an estimate, and skips people out of scope', () => {
    setup()
    const acct = db.insert(schema.accounts).values({ personId: 1, platform: 'DEMAT_OTHER', kind: 'DEMAT', name: 'CDSL demat', externalId: 'C1', currency: 'INR' }).returning().get()
    const inst = db.insert(schema.instruments).values({ isin: 'INE000A01009', name: 'STATEMENT CO', assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
    db.insert(schema.holdingSnapshots).values({ accountId: acct.id, instrumentId: inst.id, date: '2026-09-30', quantity: 3, price: 100, value: 300, source: 'CAS' }).run()
    const t = computeTax(db, 1, '2026-10-13')
    expect(t.estimateOnly.map((e) => e.name)).toContain('STATEMENT CO')
    expect(computeTax(db, 2, '2026-10-13').realized).toEqual([])
  })
})
