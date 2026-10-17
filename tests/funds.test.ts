import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { parseNavAll } from '../src/main/market/funds'
import {
  amfiHistoryKey,
  computeFunds,
  directPlanKey,
  findDirectCounterpart,
  oneYearReturn,
  overlapOf,
  planOf,
  shortFundName,
  splitCategory
} from '../src/main/portfolio/fundInsights'

describe('names, plans and categories', () => {
  it('reads the plan from the scheme name', () => {
    expect(planOf('Parag Parikh Flexi Cap Fund - Direct Plan - Growth', 'MF')).toBe('DIRECT')
    expect(planOf('HDFC Flexi Cap Fund - Regular Plan - Growth', 'MF')).toBe('REGULAR')
    expect(planOf('HDFC Equity Fund - Growth', 'MF')).toBe('NOT_STATED')
    expect(planOf('NIPPON INDIA ETF NIFTY 50 BEES', 'ETF')).toBe('ETF')
  })

  it('shortens fund names for chart labels', () => {
    expect(shortFundName('Parag Parikh Flexi Cap Fund - Direct Plan - Growth')).toBe('Parag Parikh Flexi Cap Fund')
    expect(shortFundName('ICICI PRUDENTIAL EQUITY & DEBT FUND - DIRECT - GROWTH')).toBe('ICICI PRUDENTIAL EQUITY & DEBT FUND')
    expect(shortFundName('Axis Bluechip Fund Direct Plan')).toBe('Axis Bluechip Fund')
  })

  it("splits AMFI's category into group and name", () => {
    expect(splitCategory('Equity Scheme - Flexi Cap Fund')).toEqual({ group: 'Equity', name: 'Flexi Cap Fund' })
    expect(splitCategory('Hybrid Scheme - Aggressive Hybrid Fund')).toEqual({ group: 'Hybrid', name: 'Aggressive Hybrid Fund' })
    expect(splitCategory(null)).toEqual({ group: 'Other', name: 'Not known' })
  })
})

describe('overlapOf', () => {
  it('adds the smaller weight of each shared holding', () => {
    const a = new Map([
      ['X', 0.5],
      ['Y', 0.3],
      ['Z', 0.2]
    ])
    const b = new Map([
      ['X', 0.2],
      ['Y', 0.6],
      ['W', 0.2]
    ])
    expect(overlapOf(a, b)).toBeCloseTo(0.5)
    expect(overlapOf(a, a)).toBeCloseTo(1)
    expect(overlapOf(a, new Map([['Q', 1]]))).toBe(0)
  })
})

describe('findDirectCounterpart', () => {
  // Newer AMFI file: Plan and Option in their own columns.
  const file = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
    'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)',
    'HDFC Mutual Fund',
    '118955;INF179K01UT0;-;HDFC Flexi Cap Fund;Direct Plan;Growth Option;2147.243;12-Oct-2026',
    '101762;INF179K01608;-;HDFC Flexi Cap Fund;Regular Plan;Growth Option;1948.489;12-Oct-2026',
    '118954;INF179K01VL5;INF179K01VM3;HDFC Flexi Cap Fund;Direct Plan;IDCW Option;86.821;12-Oct-2026',
    '101763;INF179K01582;INF179K01590;HDFC Flexi Cap Fund;Regular Plan;IDCW Option;70.41;12-Oct-2026'
  ].join('\n')
  const schemes = parseNavAll(file)

  it('parses the Plan and Option columns', () => {
    expect(schemes[0]).toMatchObject({ code: '118955', name: 'HDFC Flexi Cap Fund', plan: 'Direct Plan', option: 'Growth Option' })
  })

  it('finds the Direct plan with the same option from the fund’s ISIN', () => {
    expect(findDirectCounterpart({ isin: 'INF179K01608', name: 'x', fundHouse: null }, schemes)?.code).toBe('118955')
    expect(findDirectCounterpart({ isin: 'INF179K01590', name: 'x', fundHouse: null }, schemes)?.code).toBe('118954')
  })

  it('falls back to the name when the ISIN is not in the list', () => {
    const r = findDirectCounterpart({ isin: null, name: 'HDFC Flexi Cap Fund - Regular Plan - Growth', fundHouse: 'HDFC Mutual Fund' }, schemes)
    expect(r?.code).toBe('118955')
    expect(findDirectCounterpart({ isin: null, name: 'Some Other Fund - Regular - Growth', fundHouse: null }, schemes)).toBeNull()
  })
})

describe('oneYearReturn', () => {
  it('compares the last close with the close a year earlier', () => {
    expect(
      oneYearReturn([
        { date: '2025-10-06', close: 100 },
        { date: '2026-04-06', close: 105 },
        { date: '2026-10-12', close: 110 }
      ])
    ).toBeCloseTo(0.1)
    expect(oneYearReturn([{ date: '2026-04-06', close: 100 }, { date: '2026-10-12', close: 110 }])).toBeNull()
  })
})

// ---------------- computeFunds on a database ----------------

let dir: string
let db: Db
let close: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-funds-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

function seed() {
  const acct = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'MF_RTA', kind: 'MF_FOLIO', name: 'Folio', externalId: 'F1', currency: 'INR' })
    .returning()
    .get()
  const demat = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'ZERODHA', kind: 'DEMAT', name: 'Demat', externalId: 'D1', currency: 'INR' })
    .returning()
    .get()
  const fund = (name: string, isin: string, house: string, category: string) =>
    db
      .insert(schema.instruments)
      .values({ isin, name, assetClass: 'MF', currency: 'INR', fundHouse: house, mfCategory: category })
      .returning()
      .get()
  const a = fund('Alpha Flexi Cap Fund - Direct Plan - Growth', 'INF000A01001', 'Alpha MF', 'Equity Scheme - Flexi Cap Fund')
  const b = fund('Beta Flexi Cap Fund - Regular Plan - Growth', 'INF000B01001', 'Beta MF', 'Equity Scheme - Flexi Cap Fund')
  const stock = db
    .insert(schema.instruments)
    .values({ isin: 'INE000X01001', name: 'X BANK LTD', assetClass: 'EQUITY_IN', currency: 'INR' })
    .returning()
    .get()
  const snap = (accountId: number, instrumentId: number, value: number) =>
    db.insert(schema.holdingSnapshots).values({ accountId, instrumentId, date: '2026-09-30', quantity: 1, price: value, value, source: 'CAS' }).run()
  snap(acct.id, a.id, 100_000)
  snap(acct.id, b.id, 50_000)
  snap(demat.id, stock.id, 20_000)
  const hold = (fundId: number, name: string, isin: string, weight: number) =>
    db.insert(schema.fundHoldings).values({ fundInstrumentId: fundId, asOf: '2026-09-30', source: 'AMC_AUTO', name, isin, assetType: 'EQUITY', weight }).run()
  hold(a.id, 'X Bank', 'INE000X01001', 0.5)
  hold(a.id, 'Y Tech', 'INE000Y01001', 0.3)
  hold(a.id, 'Z Power', 'INE000Z01001', 0.2)
  hold(b.id, 'X Bank', 'INE000X01001', 0.2)
  hold(b.id, 'Y Tech', 'INE000Y01001', 0.6)
  hold(b.id, 'W Auto', 'INE000W01001', 0.2)
  return { a, b, stock }
}

describe('computeFunds', () => {
  it('builds the overlap matrix including your own shares', () => {
    const { a, b } = seed()
    const r = computeFunds(db, 1)
    expect(r.overlap.portfolios.map((p) => p.label)).toEqual(['Your shares', 'Alpha Flexi Cap Fund', 'Beta Flexi Cap Fund'])
    const ia = r.overlap.portfolios.findIndex((p) => p.id === a.id)
    const ib = r.overlap.portfolios.findIndex((p) => p.id === b.id)
    expect(r.overlap.matrix[ia][ib]).toBeCloseTo(0.5)
    expect(r.overlap.matrix[ia][ia]).toBeNull()
    // Your shares are all X Bank: 50% of Alpha.
    expect(r.overlap.matrix[0][ia]).toBeCloseTo(0.5)
    const pair = r.overlap.pairs.find((p) => p.a === a.id && p.b === b.id)!
    expect(pair.shared.map((s) => s.name)).toEqual(['Y Tech', 'X Bank'])
  })

  it('combines routes to the same company', () => {
    seed()
    const x = computeFunds(db, 1).companies.find((c) => c.isin === 'INE000X01001')!
    // 20k direct + 50k via Alpha + 10k via Beta.
    expect(x.valueInr).toBeCloseTo(80_000)
    expect(x.directInr).toBe(20_000)
    expect(x.sources.map((s) => s.label)).toEqual(['Alpha Flexi Cap Fund', 'Held directly', 'Beta Flexi Cap Fund'])
  })

  it('groups by fund house and category, and prices a Regular plan against its Direct plan', () => {
    const { b } = seed()
    db.insert(schema.settings).values({ key: directPlanKey(b.id), value: JSON.stringify({ code: '999', name: 'Beta Direct' }) }).run()
    db.insert(schema.priceHistory)
      .values([
        { key: `I:${b.id}`, date: '2025-10-06', close: 100 },
        { key: `I:${b.id}`, date: '2026-10-12', close: 110 },
        { key: amfiHistoryKey('999'), date: '2025-10-06', close: 100 },
        { key: amfiHistoryKey('999'), date: '2026-10-12', close: 111 }
      ])
      .run()
    const r = computeFunds(db, 1)
    expect(r.byCategory).toEqual([{ group: 'Equity', name: 'Flexi Cap Fund', valueInr: 150_000, funds: ['Alpha Flexi Cap Fund', 'Beta Flexi Cap Fund'] }])
    expect(r.byHouse.map((h) => h.name)).toEqual(['Alpha MF', 'Beta MF'])
    const beta = r.funds.find((f) => f.instrumentId === b.id)!
    expect(beta.plan).toBe('REGULAR')
    expect(beta.directPlan?.gap1y).toBeCloseTo(0.01)
    expect(beta.directPlan?.extraCostInr).toBeCloseTo(500)
    expect(r.notes.some((n) => n.includes('Regular plan') && n.includes('500'))).toBe(true)
  })
})

describe('overlapping funds side by side', () => {
  it('pairs funds a quarter or more alike, with AMFI facts for the plan held', async () => {
    const { a, b } = seed()
    const facts = (name: string, terRegular: number, terDirect: number) => ({
      name,
      category: 'Flexi Cap Fund',
      categoryGroup: 'Equity',
      benchmark: 'Nifty 500 TRI',
      risk: 'Very High',
      aumCr: 5000,
      navDate: '15-Oct-2026',
      r1y: { regular: 5, direct: 6, benchmark: 4 },
      r3y: { regular: 14, direct: 15, benchmark: 13 },
      r5y: { regular: null, direct: null, benchmark: null },
      r10y: { regular: null, direct: null, benchmark: null },
      terRegular,
      terDirect
    })
    db.insert(schema.settings)
      .values({
        key: 'amfi:schemes',
        value: JSON.stringify({ at: 'x', date: '15-Oct-2026', schemes: [facts('Alpha Flexi Cap Fund', 1.6, 0.6), facts('Beta Flexi Cap Fund', 1.8, 0.7)] })
      })
      .run()
    const { computeFundComparisons } = await import('../src/main/portfolio/insights')
    const r = computeFundComparisons(db, 1)
    expect(r.pairs).toHaveLength(1) // "Your shares" is not a fund to compare
    const [fa, fb] = r.pairs[0].funds
    expect(r.pairs[0].overlap).toBeCloseTo(0.5)
    expect(fa).toMatchObject({ instrumentId: a.id, plan: 'DIRECT', ter: 0.6, r3y: 15, matched: true })
    expect(fb).toMatchObject({ instrumentId: b.id, plan: 'REGULAR', ter: 1.8, r3y: 14 })
    // Alpha: X Bank 0.5 and Y Tech 0.3 are shared, so 20% is its own; Beta: 20% too.
    expect(fa.uniqueShare).toBeCloseTo(0.2)
    expect(fb.uniqueShare).toBeCloseTo(0.2)
  })
})
