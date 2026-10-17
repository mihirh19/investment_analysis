import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Plan } from '../src/shared/plan'
import { openDatabase, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { BUILT_IN_CPI, fetchCpi } from '../src/main/market/cpi'
import { bucketShares, computeForecast, loadPlan, savePlan } from '../src/main/portfolio/forecast'

describe('official inflation by category', () => {
  it('works out ten- and five-year rates from December indices', async () => {
    const index: Record<number, number> = { 2015: 100, 2020: 125, 2025: 160 }
    const f = (async (url: string | URL | Request) => {
      const y = Number(new URL(String(url)).searchParams.get('year'))
      const data = index[y]
        ? [
            { year: y, subgroup: 'General-Overall', index: String(index[y]), inflation: '2.10' },
            { year: y, subgroup: 'Health', index: String(index[y] * 1.1), inflation: '3.40' }
          ]
        : []
      return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const cpi = await fetchCpi(new Date('2026-10-17'), f)
    expect(cpi?.asOf).toBe('2025-12')
    expect(cpi?.general.tenYear).toBeCloseTo((1.6 ** 0.1 - 1) * 100, 1)
    expect(cpi?.general.fiveYear).toBeCloseTo(((160 / 125) ** 0.2 - 1) * 100, 1)
    expect(cpi?.general.latest).toBe(2.1)
    expect(cpi?.byCategory.HEALTH?.latest).toBe(3.4)
    expect(cpi?.byCategory.GROCERY).toBeUndefined()
  })

  it('ships official figures to start from', () => {
    expect(BUILT_IN_CPI.general.tenYear).toBeCloseTo(4.62, 2)
    expect(BUILT_IN_CPI.byCategory.HEALTH?.tenYear).toBeGreaterThan(BUILT_IN_CPI.byCategory.GROCERY!.tenYear)
  })
})

describe('what counts as what', () => {
  const mf = (name: string, mfCategory: string | null = null) =>
    bucketShares({ assetClass: 'MF', instrumentName: name }, { name, mfCategory, mfType: null, schemeName: null })
  it('sorts funds into equity, debt and gold', () => {
    expect(mf('Parag Parikh Flexi Cap Fund', 'Equity Scheme - Flexi Cap Fund')).toEqual({ EQUITY: 1 })
    expect(mf('HDFC Overnight Fund')).toEqual({ DEBT: 1 })
    expect(mf('SBI Gold Fund')).toEqual({ GOLD: 1 })
    expect(mf('ICICI Balanced Advantage', 'Hybrid Scheme - Balanced Advantage')).toEqual({ EQUITY: 0.5, DEBT: 0.5 })
    expect(bucketShares({ assetClass: 'ETF', instrumentName: 'NIPPON INDIA ETF GOLD BEES' })).toEqual({ GOLD: 1 })
    expect(bucketShares({ assetClass: 'INSURANCE', instrumentName: 'LIC' })).toEqual({})
  })
})

describe('the forecast', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-fc-'))
    const o = openDatabase(join(dir, 't.db'), '5'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const today = new Date('2026-01-15T00:00:00Z')
  const flat = (over: Partial<Plan>): Plan => {
    const p = loadPlan(db)
    return {
      ...p,
      targetYear: 2027,
      inflation: 0,
      spread: 0,
      returns: Object.fromEntries(Object.keys(p.returns).map((k) => [k, 0])) as Plan['returns'],
      ...over
    }
  }

  it('steps a SIP up once a year, in its own month', () => {
    savePlan(
      db,
      flat({
        sips: [{ id: 's', personId: 1, name: 'Flexi cap', monthly: 1000, stepUpPct: 10, bucket: 'EQUITY', start: '2024-01', endYear: null }]
      }),
      today
    )
    const f = computeForecast(db, undefined, today)
    expect(f.years.map((y) => [y.year, Math.round(y.nominal)])).toEqual([
      [2026, 12 * 1000],
      [2027, 12 * 1000 + 12 * 1100]
    ])
    expect(f.sipMonthly).toBe(1000)
  })

  it('compounds what is held and shows it in today’s money', () => {
    persistBundle(db, {
      personId: 1,
      kind: 'CAS_PDF',
      fileName: 'cas.pdf',
      bundle: {
        accounts: [{ key: 'a', platform: 'ZERODHA', kind: 'DEMAT', name: 'Z', externalId: '1', currency: 'INR' }],
        instruments: [{ key: 'i', isin: 'INE009A01021', name: 'INFOSYS', assetClass: 'EQUITY_IN', currency: 'INR' }],
        transactions: [],
        snapshots: [{ accountKey: 'a', instrumentKey: 'i', date: '2026-01-10', quantity: 100, price: 1000, value: 100000, cost: null, source: 'CAS' }],
        warnings: []
      }
    })
    const p = flat({ targetYear: 2035, inflation: 5 })
    p.returns.EQUITY = 12
    savePlan(db, p, today)
    const f = computeForecast(db, undefined, today)
    const last = f.years.at(-1)!
    // Ten years less two weeks of growth at 12%, deflated at 5%.
    expect(last.nominal).toBeCloseTo(100000 * 1.12 ** 10, -3)
    expect(last.real).toBeCloseTo(last.nominal / 1.05 ** 10, -3)
    expect(f.startByBucket.EQUITY).toBe(100000)
  })

  it('inflates each spending category at its own rate', () => {
    savePlan(
      db,
      flat({
        targetYear: 2046,
        inflation: 5,
        expenses: loadPlan(db).expenses.map((e) =>
          e.key === 'HEALTH' ? { ...e, monthly: 10000, inflation: 11.5 } : e.key === 'EMI' ? { ...e, monthly: 10000 } : e
        )
      }),
      today
    )
    const f = computeForecast(db, undefined, today)
    const health = f.expenses.find((e) => e.key === 'HEALTH')!
    expect(health.source).toBe('CUSTOM')
    expect(health.monthlyThen).toBeGreaterThan(10000 * 1.115 ** 20)
    expect(f.expenses.find((e) => e.key === 'EMI')!.inflation).toBe(0)
    // Half the spending at 11.5%, half fixed: in between, and rising over time toward 11.5%.
    expect(f.personalInflation!).toBeGreaterThan(0.05)
    expect(f.personalInflation!).toBeLessThan(0.115)
    expect(f.expenses.find((e) => e.key === 'GROCERY')!.inflation).toBe(BUILT_IN_CPI.byCategory.GROCERY!.tenYear)
  })

  it('pays goals and retirement costs out of the investments, and says when money runs out', () => {
    const p = flat({
      targetYear: 2032,
      retireYear: 2028,
      withdrawalRate: 4,
      goals: [{ id: 'g', name: 'School', costToday: 30000, year: 2026, category: 'GENERAL', fromPortfolio: true }],
      expenses: loadPlan(db).expenses.map((e) => (e.key === 'OTHER' ? { ...e, monthly: 10000, inflation: 0 } : e)),
      sips: [{ id: 's', personId: 1, name: 'Index', monthly: 20000, stepUpPct: 0, bucket: 'DEBT', start: '2026-01', endYear: null }]
    })
    savePlan(db, p, today)
    const f = computeForecast(db, undefined, today)
    expect(f.goals[0]).toMatchObject({ funded: true, costThen: 30000 })
    // 24 months of ₹20,000 less the ₹30,000 goal = ₹4.5 lakh, drawn at ₹1.2 lakh a year from 2028.
    expect(f.retirement).toMatchObject({ year: 2028, needed: 120000 / 0.04 })
    expect(f.retirement!.projected).toBeCloseTo(450000, 0)
    expect(f.retirement!.lastsUntil).toBe(2031)
    expect(f.years.find((y) => y.year === 2027)!.putIn).toBe(480000)
  })

  it('finds SIPs in recent fund purchases', () => {
    persistBundle(db, {
      personId: 1,
      kind: 'ZERODHA_TRADEBOOK',
      fileName: 'tb.csv',
      bundle: {
        accounts: [{ key: 'a', platform: 'ZERODHA', kind: 'DEMAT', name: 'Z', externalId: '1', currency: 'INR' }],
        instruments: [{ key: 'f', isin: 'INF000K01AB1', name: 'Axis Midcap Fund - Direct Growth', assetClass: 'MF', currency: 'INR' }],
        transactions: ['2025-11-05', '2025-12-05', '2026-01-05'].map((date, i) => ({
          accountKey: 'a',
          instrumentKey: 'f',
          date,
          type: 'BUY' as const,
          quantity: 10,
          price: 500,
          amount: 5000,
          fees: 0,
          currency: 'INR',
          description: null,
          source: 'T',
          externalId: `t${i}`
        })),
        snapshots: [],
        warnings: []
      }
    })
    const f = computeForecast(db, undefined, today)
    expect(f.detectedSips).toEqual([
      { personId: 1, name: 'Axis Midcap Fund', monthly: 5000, stepUpPct: 10, bucket: 'EQUITY', start: '2025-11', endYear: null }
    ])
  })

  it('refuses a plan that makes no sense', () => {
    expect(() => savePlan(db, flat({ targetYear: 2020 }), today)).toThrow(/Pick a year/)
    expect(() => savePlan(db, flat({ retireYear: 2040, targetYear: 2030 }), today)).toThrow(/retirement year/)
  })
})
