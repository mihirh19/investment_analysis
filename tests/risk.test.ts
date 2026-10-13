import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { computeRisk, DEFAULT_RISK_FREE, RISK_FREE_KEY, statsOf } from '../src/main/portfolio/risk'
import {
  alignTo,
  beta,
  correlation,
  covariance,
  downsideDeviation,
  hhi,
  returnsOf,
  riskShares,
  stdev,
  weightedReturns
} from '../src/main/portfolio/stats'

describe('stats', () => {
  it('covariance, standard deviation and correlation', () => {
    const a = [1, 2, 3, 4, 5]
    expect(covariance(a, a)).toBeCloseTo(2.5)
    expect(stdev(a)).toBeCloseTo(Math.sqrt(2.5))
    expect(correlation(a, [2, 4, 6, 8, 10])).toBeCloseTo(1)
    expect(correlation(a, [5, 4, 3, 2, 1])).toBeCloseTo(-1)
    expect(Number.isNaN(correlation(a, [3, 3, 3, 3, 3]))).toBe(true)
  })

  it('beta is the slope against the market', () => {
    const m = [0.01, -0.02, 0.015, 0.005, -0.01]
    expect(beta(m.map((x) => 2 * x), m)).toBeCloseTo(2)
    expect(beta(m.map((x) => 0.5 * x + 0.001), m)).toBeCloseTo(0.5)
  })

  it('downside deviation counts only shortfalls below the target', () => {
    expect(downsideDeviation([0.02, -0.02, 0.01, -0.01])).toBeCloseTo(Math.sqrt((0.0004 + 0.0001) / 4))
    expect(downsideDeviation([0.01, 0.02])).toBe(0)
  })

  it('aligns a series to a calendar, carrying the last close over gaps', () => {
    const cal = ['2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06']
    expect(
      alignTo(cal, [
        { date: '2026-01-02', close: 10 },
        { date: '2026-01-06', close: 12 }
      ])
    ).toEqual([null, 10, 10, 12])
    expect(returnsOf([10, 11, 9.9]).map((r) => +r.toFixed(4))).toEqual([0.1, -0.1])
  })

  it('Herfindahl index: one holding is 1, n equal holdings 1/n', () => {
    expect(hhi([100])).toBe(1)
    expect(hhi([1, 1, 1, 1])).toBeCloseTo(0.25)
    expect(hhi([3, 1])).toBeCloseTo(0.625)
  })

  it('risk shares add up to 1, and a riskless holding carries none', () => {
    const swingy = [0.02, -0.03, 0.025, -0.01, 0.015, -0.02]
    const calm = [0.001, 0.001, 0.001, 0.001, 0.001, 0.001]
    const s = riskShares([0.5, 0.5], [swingy, calm])
    expect(s[0] + s[1]).toBeCloseTo(1)
    expect(s[1]).toBeCloseTo(0)
    expect(weightedReturns([0.5, 0.5], [swingy, calm])[0]).toBeCloseTo(0.0105)
  })
})

describe('statsOf', () => {
  // 253 trading days a year apart: a steady 0.04% a day with a wobble.
  const dates = Array.from({ length: 253 }, (_, i) => new Date(Date.UTC(2025, 9, 13) + Math.round((i * 365) / 252) * 86400000).toISOString().slice(0, 10))
  const r = Array.from({ length: 252 }, (_, i) => 0.0004 + (i % 2 ? 0.01 : -0.01))

  it('annualises volatility and computes Sharpe and Sortino against the risk-free rate', () => {
    const s = statsOf(dates, r, 0.07, null)
    expect(s.volatility!).toBeCloseTo(0.01 * Math.sqrt(252), 2)
    expect(s.return1y!).toBeGreaterThan(0)
    expect(s.sharpe!).toBeCloseTo((s.return1y! - 0.07) / s.volatility!, 6)
    expect(s.sortino!).toBeGreaterThan(s.sharpe!)
    expect(s.beta).toBeNull()
    expect(s.worstDay!.r).toBeCloseTo(-0.0096)
  })

  it('returns empty figures with too little data', () => {
    expect(statsOf(dates.slice(0, 10), r.slice(0, 9), 0.07, null).volatility).toBeNull()
  })
})

// ---------------- computeRisk on a database ----------------

let dir: string
let db: Db
let close: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-risk-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const TODAY = '2026-10-13'
const tradingDays = (() => {
  const out: string[] = []
  for (let t = Date.UTC(2025, 9, 14); t <= Date.UTC(2026, 9, 13); t += 86400000) {
    const d = new Date(t)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
})()

function seed() {
  const acct = db
    .insert(schema.accounts)
    .values({ personId: 1, platform: 'ZERODHA', kind: 'DEMAT', name: 'Demat', externalId: 'D1', currency: 'INR' })
    .returning()
    .get()
  const inst = (name: string, isin: string) =>
    db.insert(schema.instruments).values({ isin, name, assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
  const steady = inst('STEADY CO', 'INE000S01001')
  const wild = inst('WILD CO', 'INE000W01001')
  const fresh = inst('NEW LISTING', 'INE000N01001')
  const snap = (id: number, value: number) =>
    db.insert(schema.holdingSnapshots).values({ accountId: acct.id, instrumentId: id, date: '2026-10-01', quantity: 1, price: value, value, source: 'CAS' }).run()
  snap(steady.id, 60_000)
  snap(wild.id, 40_000)
  snap(fresh.id, 10_000)
  const rows: { key: string; date: string; close: number }[] = []
  let n = 100
  let s = 100
  let w = 100
  tradingDays.forEach((d, i) => {
    const m = i % 2 ? 0.01 : -0.009 // market wobble
    n *= 1 + m
    s *= 1 + 0.5 * m + 0.0002
    w *= 1 + 2 * m
    rows.push({ key: 'BM:NIFTY50', date: d, close: n }, { key: `I:${steady.id}`, date: d, close: s }, { key: `I:${wild.id}`, date: d, close: w })
    if (i > tradingDays.length - 40) rows.push({ key: `I:${fresh.id}`, date: d, close: 50 })
  })
  for (let i = 0; i < rows.length; i += 500) db.insert(schema.priceDaily).values(rows.slice(i, i + 500)).run()
  return { steady, wild, fresh }
}

describe('computeRisk', () => {
  it("replays today's weights: beta is the value-weighted beta, and a new listing is left out", () => {
    seed()
    const r = computeRisk(db, 1, TODAY)
    expect(r.riskFreeRate).toBe(DEFAULT_RISK_FREE)
    expect(r.coverage.includedInr).toBe(100_000)
    expect(r.coverage.excluded).toEqual([{ name: 'NEW LISTING', valueInr: 10_000, reason: 'TOO_LITTLE_HISTORY' }])
    // 60% × 0.5 + 40% × 2 = 1.1
    expect(r.portfolio!.beta!).toBeCloseTo(1.1, 2)
    expect(r.portfolio!.correlation!).toBeCloseTo(1, 2)
    expect(r.dates.length).toBe(r.growth.length)
    expect(r.niftyGrowth[0]).toBe(100)
    const wild = r.holdings.find((h) => h.name === 'WILD CO')!
    expect(wild.beta!).toBeCloseTo(2, 2)
    // 40% of the money, (0.4 × 2) / 1.1 ≈ 73% of the swings.
    expect(wild.riskShare!).toBeCloseTo(0.8 / 1.1, 2)
    expect(r.holdings[0].name).toBe('WILD CO')
    expect(r.correlation.names).toEqual(['STEADY CO', 'WILD CO'])
    expect(r.correlation.matrix[0][1]!).toBeCloseTo(1, 2)
    expect(r.benchmarks.find((b) => b.key === 'BM:NIFTY50')!.stats.beta).toBeNull()
  })

  it('uses the stored risk-free rate', () => {
    seed()
    db.insert(schema.settings).values({ key: RISK_FREE_KEY, value: '0.05' }).run()
    const a = computeRisk(db, 1, TODAY)
    expect(a.riskFreeRate).toBe(0.05)
    const p = a.portfolio!
    expect(p.sharpe!).toBeCloseTo((p.return1y! - 0.05) / p.volatility!, 6)
  })

  it('measures concentration by holding', () => {
    seed()
    const [c] = computeRisk(db, 1, TODAY).concentration
    expect(c.holdings).toBe(3)
    expect(c.largest).toEqual({ name: 'STEADY CO', share: 60_000 / 110_000 })
    const h = (6 / 11) ** 2 + (4 / 11) ** 2 + (1 / 11) ** 2
    expect(c.effectiveHoldings).toBeCloseTo(1 / h)
    expect(c.top5Share).toBe(1)
  })

  it('returns no portfolio figures without daily prices', () => {
    const r = computeRisk(db, 1, TODAY)
    expect(r.portfolio).toBeNull()
    expect(r.holdings).toEqual([])
  })
})
