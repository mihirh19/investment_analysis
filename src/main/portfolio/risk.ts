import { eq } from 'drizzle-orm'
import type { HoldingRow, RiskReport, RiskStats } from '@shared/types'
import { schema, type Db } from '../db'
import { BENCHMARKS, seriesFor, toInr } from '../market/benchmarks'
import { addDays, todayIso, yearsBetween } from './dates'
import { FxTable } from './fx'
import { listHoldings } from './holdings'
import { annualise, growthIndex, maxDrawdown } from './returns'
import { alignTo, beta, correlation, downsideDeviation, hhi, returnsOf, riskShares, stdev, weightedReturns } from './stats'

export const RISK_FREE_KEY = 'risk:riskFreeRate'
/** Roughly what a 1-year government bill or a liquid fund paid in 2024–26. */
export const DEFAULT_RISK_FREE = 0.07

/** Asset classes priced every trading day (market quotes or NAVs). */
const DAILY_PRICED = new Set(['EQUITY_IN', 'EQUITY_US', 'ETF', 'MF', 'REIT', 'NPS'])
const NIFTY = 'BM:NIFTY50'
const TOP_CORRELATION = 8

export function riskFreeRate(db: Db): number {
  const v = Number(db.select().from(schema.settings).where(eq(schema.settings.key, RISK_FREE_KEY)).get()?.value)
  return Number.isFinite(v) && v >= 0 && v <= 0.2 ? v : DEFAULT_RISK_FREE
}

/** Risk figures for one return series on `dates` (dates has one more entry than returns). */
export function statsOf(
  dates: string[],
  returns: number[],
  rf: number,
  market: number[] | null
): RiskStats {
  if (returns.length < 20) {
    return {
      return1y: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      maxDrawdown: null,
      beta: null,
      correlation: null,
      worstDay: null,
      bestDay: null
    }
  }
  const years = Math.max(yearsBetween(dates[0], dates[dates.length - 1]), 1 / 12)
  const perYear = returns.length / years
  const growth = growthIndex(returns)
  const ret = annualise(growth[growth.length - 1] / 100 - 1, years)
  const vol = stdev(returns) * Math.sqrt(perYear)
  const rfPer = (1 + rf) ** (1 / perYear) - 1
  const down = downsideDeviation(returns, rfPer) * Math.sqrt(perYear)
  let worst = 0
  let best = 0
  returns.forEach((r, i) => {
    if (r < returns[worst]) worst = i
    if (r > returns[best]) best = i
  })
  const fin = (x: number) => (Number.isFinite(x) ? x : null)
  return {
    return1y: ret,
    volatility: fin(vol),
    sharpe: vol > 0 ? (ret - rf) / vol : null,
    sortino: down > 0 ? (ret - rf) / down : null,
    maxDrawdown: maxDrawdown(dates, growth),
    beta: market ? fin(beta(returns, market)) : null,
    correlation: market ? fin(correlation(returns, market)) : null,
    worstDay: { date: dates[worst + 1], r: returns[worst] },
    bestDay: { date: dates[best + 1], r: returns[best] }
  }
}

/**
 * Risk of the market holdings as they are today, replayed over the last year of daily prices at
 * today's weights (how the current mix would have behaved, not what happened to the money). Deposits,
 * EPF, property and other assets without daily prices are left out and reported as coverage.
 */
export function computeRisk(db: Db, personId?: number, today = todayIso()): RiskReport {
  const rf = riskFreeRate(db)
  const rows = listHoldings(db, personId)
  const fx = FxTable.load(db, 'USDINR')
  const since = addDays(today, -366)
  const valueOf = (r: HoldingRow) => r.marketValueInr ?? r.investedInr ?? 0
  const totalInr = rows.reduce((s, r) => s + Math.max(0, valueOf(r)), 0)

  // ---------- one entry per instrument ----------
  const byInst = new Map<number, { name: string; value: number; assetClass: string; currency: string }>()
  for (const r of rows) {
    const v = valueOf(r)
    if (v <= 0) continue
    const e = byInst.get(r.instrumentId) ?? { name: r.instrumentName, value: 0, assetClass: r.assetClass, currency: r.currency }
    e.value += v
    byInst.set(r.instrumentId, e)
  }

  // ---------- daily prices on one calendar ----------
  const nifty = seriesFor(db, NIFTY, { since, daily: true })
  const raw = new Map<number, { date: string; close: number }[]>()
  for (const [id, e] of byInst) {
    if (!DAILY_PRICED.has(e.assetClass)) continue
    let pts = seriesFor(db, `I:${id}`, { since, daily: true })
    if (e.currency === 'USD') pts = toInr(pts, fx)
    if (pts.length) raw.set(id, pts)
  }
  // Indian trading days when the Nifty series is there; otherwise every date any series has.
  const calendar =
    nifty.length >= 100 ? nifty.map((p) => p.date) : [...new Set([...raw.values()].flat().map((p) => p.date))].sort()
  const n = calendar.length

  const excluded: RiskReport['coverage']['excluded'] = []
  const usable: { id: number; prices: (number | null)[]; first: number }[] = []
  for (const [id, e] of byInst) {
    const pts = raw.get(id)
    if (!DAILY_PRICED.has(e.assetClass)) {
      excluded.push({ name: e.name, valueInr: e.value, reason: 'NO_DAILY_PRICES' })
      continue
    }
    const prices = pts && n ? alignTo(calendar, pts) : []
    const first = prices.findIndex((p) => p !== null)
    const count = pts?.length ?? 0
    // Needs prices from near the start of the year and most trading days in between.
    if (first < 0 || first > Math.floor(n * 0.1) || count < n * 0.6) {
      excluded.push({ name: e.name, valueInr: e.value, reason: 'TOO_LITTLE_HISTORY' })
      continue
    }
    usable.push({ id, prices, first })
  }
  excluded.sort((a, b) => b.valueInr - a.valueInr)

  const start = Math.max(0, ...usable.map((u) => u.first))
  const dates = calendar.slice(start)
  const includedInr = usable.reduce((s, u) => s + byInst.get(u.id)!.value, 0)
  const empty: RiskReport = {
    riskFreeRate: rf,
    from: null,
    to: null,
    coverage: { includedInr, totalInr, excluded },
    portfolio: null,
    benchmarks: [],
    dates: [],
    growth: [],
    niftyGrowth: [],
    holdings: [],
    correlation: { names: [], matrix: [] },
    concentration: concentrationOf(rows, personId, db)
  }
  if (!usable.length || dates.length < 21) return empty

  const weights = usable.map((u) => byInst.get(u.id)!.value / includedInr)
  const rets = usable.map((u) => returnsOf(u.prices.slice(start) as number[]))
  const rp = weightedReturns(weights, rets)

  const niftyPrices = alignTo(dates, nifty)
  const niftyR = niftyPrices.every((p) => p !== null) ? returnsOf(niftyPrices as number[]) : null

  const benchmarks: RiskReport['benchmarks'] = []
  for (const b of BENCHMARKS) {
    const pts = seriesFor(db, b.key, { since, daily: true })
    const prices = alignTo(dates, pts)
    if (!pts.length || prices.some((p) => p === null)) continue
    const r = returnsOf(prices as number[])
    benchmarks.push({ key: b.key, label: b.label, stats: statsOf(dates, r, rf, b.key === NIFTY ? null : niftyR) })
  }

  const shares = riskShares(weights, rets)
  const holdings: RiskReport['holdings'] = usable
    .map((u, i) => {
      const e = byInst.get(u.id)!
      const s = statsOf(dates, rets[i], rf, niftyR)
      const p = u.prices.slice(start) as number[]
      return {
        instrumentId: u.id,
        name: e.name,
        valueInr: e.value,
        weight: weights[i],
        riskShare: Number.isFinite(shares[i]) ? shares[i] : null,
        volatility: s.volatility,
        beta: s.beta,
        return1y: p[p.length - 1] / p[0] - 1
      }
    })
    .sort((a, b) => (b.riskShare ?? 0) - (a.riskShare ?? 0))

  const top = usable
    .map((u, i) => ({ i, value: byInst.get(u.id)!.value, name: byInst.get(u.id)!.name }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_CORRELATION)
  const matrix = top.map((a) => top.map((b) => (a.i === b.i ? null : correlation(rets[a.i], rets[b.i]))))

  const growth = growthIndex(rp)
  const niftyGrowth = niftyR ? growthIndex(niftyR) : dates.map(() => null)

  return {
    ...empty,
    from: dates[0],
    to: dates[dates.length - 1],
    portfolio: statsOf(dates, rp, rf, niftyR),
    benchmarks,
    dates,
    growth,
    niftyGrowth,
    holdings,
    correlation: { names: top.map((t) => t.name), matrix: matrix.map((r) => r.map((v) => (v !== null && Number.isFinite(v) ? v : null))) }
  }
}

/** How concentrated the money is, by holding: for the person, or for the family and each member. */
export function concentrationOf(rows: HoldingRow[], personId: number | undefined, db: Db): RiskReport['concentration'] {
  const one = (label: string, pid: number | null, rs: HoldingRow[]) => {
    const by = new Map<number, { name: string; value: number }>()
    for (const r of rs) {
      const v = r.marketValueInr ?? r.investedInr ?? 0
      if (v <= 0) continue
      const e = by.get(r.instrumentId) ?? { name: r.instrumentName, value: 0 }
      e.value += v
      by.set(r.instrumentId, e)
    }
    const list = [...by.values()].sort((a, b) => b.value - a.value)
    const total = list.reduce((s, x) => s + x.value, 0)
    const share = (k: number) => (total > 0 ? list.slice(0, k).reduce((s, x) => s + x.value, 0) / total : 0)
    const h = hhi(list.map((x) => x.value))
    return {
      label,
      personId: pid,
      holdings: list.length,
      effectiveHoldings: Number.isFinite(h) && h > 0 ? 1 / h : 0,
      largest: list[0] && total > 0 ? { name: list[0].name, share: list[0].value / total } : null,
      top5Share: share(5),
      top10Share: share(10)
    }
  }
  const names = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  if (personId) return [one(names.get(personId) ?? '', personId, rows)]
  const people = [...new Set(rows.map((r) => r.personId))]
  const out = [one('Family', null, rows)]
  if (people.length > 1)
    for (const pid of people) out.push(one(names.get(pid) ?? '', pid, rows.filter((r) => r.personId === pid)))
  return out
}
