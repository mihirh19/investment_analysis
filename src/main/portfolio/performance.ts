import type { PerformanceReport, PerformanceYear } from '@shared/types'
import type { Db } from '../db'
import { BENCHMARKS, seriesFor } from '../market/benchmarks'
import { buildHistory, loadContext, type Item } from './analysis'
import { yearsBetween } from './dates'
import {
  annualise,
  chain,
  drawdowns,
  growthIndex,
  indexReturn,
  maxDrawdown,
  periodReturns,
  priceOn,
  replayIntoIndex,
  rolling,
  yearSpans
} from './returns'
import { xirr, type CashFlow } from './xirr'

/**
 * Performance of the holdings with dated money in and out: a full trade history, deposits and the
 * like, and holdings known from statements, which are measured from their first statement (counted
 * as bought then, at that day's value, with later changes in units as buys and sells). Only what
 * has no dated record at all (EPF, insurance, a holding with no price) is left out.
 */
export function computePerformance(db: Db, personId?: number): PerformanceReport {
  const ctx = loadContext(db, personId)
  const valueOf = (i: Item) => i.row.marketValueInr ?? i.row.investedInr ?? 0
  // A holding with no current price yet would read as a 100% loss; leave it out until it has one.
  const covered = ctx.items.filter((i) => i.own && i.flows && i.row.marketValueInr !== null)
  const totalValueInr = ctx.items.reduce((s, i) => s + valueOf(i), 0)
  const coveredValueInr = covered.reduce((s, i) => s + valueOf(i), 0)
  const fromStatements = covered.filter((i) => i.since)
  const fromStatementsInr = fromStatements.reduce((s, i) => s + valueOf(i), 0)
  const statementsSince = fromStatements.map((i) => i.since!).sort()[0] ?? null
  const longEnough = (i: Item) => {
    const first = i.own!.map((f) => f.date).sort()[0]
    return !!first && Date.parse(ctx.today) - Date.parse(first) >= 90 * 86400000
  }

  const pairs = new Set(covered.map((i) => `${i.row.accountId}:${i.row.instrumentId}`))
  const hist = buildHistory(db, ctx.accounts, ctx.txnsByPair, ctx.engines, ctx.fx, ctx.today, pairs)
  const dates = hist.months
  const values = dates.map((_, m) => hist.series.reduce((s, g) => s + g.values[m], 0))
  // Today's point at live prices, matching the Overview and the XIRR (history uses weekly closes).
  if (values.length) values[values.length - 1] = coveredValueInr

  const flows: CashFlow[] = covered.flatMap((i) => i.own!)
  const netInvested = dates.map((d) => -flows.filter((f) => f.date <= d).reduce((s, f) => s + f.amount, 0))
  const monthly = dates.length > 1 ? periodReturns(dates, values, flows) : []
  const growth = growthIndex(monthly)
  const last = dates.length - 1

  // ---------- benchmarks ----------
  const series = BENCHMARKS.map((b) => ({ b, pts: seriesFor(db, b.key) })).filter((x) => x.pts.length > 0)
  const benchmarks: PerformanceReport['benchmarks'] = series.map(({ b, pts }) => {
    // Rebase to the portfolio's growth on the first date the index has a price, so the lines meet.
    const first = dates.findIndex((d) => priceOn(pts, d) !== null)
    const base = first >= 0 ? priceOn(pts, dates[first])! : null
    return {
      key: b.key,
      label: b.label,
      totalReturn: b.totalReturn,
      growth: dates.map((d, i) => {
        const p = priceOn(pts, d)
        return base && p && i >= first ? (growth[first] * p) / base : null
      }),
      sameMoney: dates.length ? replayIntoIndex(dates, flows, pts, values[0]) : []
    }
  })
  const benchReturn = (from: string, to: string) =>
    Object.fromEntries(series.map(({ b, pts }) => [b.key, indexReturn(pts, from, to)]))

  // ---------- trailing ----------
  const trailing: PerformanceReport['trailing'] = []
  for (const [key, n] of [
    ['1Y', 12],
    ['3Y', 36],
    ['5Y', 60]
  ] as const) {
    if (monthly.length < n) continue
    const years = n / 12
    const from = dates[last - n]
    trailing.push({
      key,
      years,
      twr: annualise(chain(monthly.slice(-n)), years),
      benchmarks: Object.fromEntries(
        Object.entries(benchReturn(from, dates[last])).map(([k, r]) => [k, r === null ? null : annualise(r, years)])
      )
    })
  }
  if (monthly.length) {
    const years = yearsBetween(dates[0], dates[last])
    trailing.push({
      key: 'ALL',
      years,
      twr: annualise(chain(monthly), years),
      benchmarks: Object.fromEntries(
        Object.entries(benchReturn(dates[0], dates[last])).map(([k, r]) => [k, r === null ? null : annualise(r, years)])
      )
    })
  }

  // ---------- calendar and financial years ----------
  const years: PerformanceYear[] = (['CY', 'FY'] as const).flatMap((kind) =>
    yearSpans(dates, kind).map((s) => {
      const from = dates[s.from]
      const to = dates[s.to]
      const inYear = flows.filter((f) => f.date > from && f.date <= to)
      const added = -inYear.filter((f) => f.amount < 0).reduce((a, f) => a + f.amount, 0)
      const withdrawn = inYear.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0)
      const opening = values[s.from]
      const closing = values[s.to]
      return {
        kind,
        label: s.label,
        start: from,
        end: to,
        partial: s.partial,
        twr: s.to > s.from ? chain(monthly.slice(s.from, s.to)) : null,
        benchmarks: benchReturn(from, to),
        opening,
        added,
        withdrawn,
        gain: closing - opening - added + withdrawn,
        closing
      }
    })
  )

  // ---------- XIRR by account and by holding ----------
  const byAccountMap = new Map<number, Item[]>()
  for (const i of covered) byAccountMap.set(i.row.accountId, [...(byAccountMap.get(i.row.accountId) ?? []), i])
  const byAccount = [...byAccountMap].map(([accountId, group]) => ({
    accountId,
    label: group[0].row.accountName,
    personName: group[0].row.personName,
    xirr: xirr(group.flatMap((i) => i.flows!)),
    valueInr: group.reduce((s, i) => s + valueOf(i), 0)
  }))
  byAccount.sort((a, b) => b.valueInr - a.valueInr)
  const byHolding = covered
    .map((i) => ({
      accountId: i.row.accountId,
      instrumentId: i.row.instrumentId,
      name: i.row.instrumentName,
      personName: i.row.personName,
      platform: i.row.platform,
      xirr: longEnough(i) ? xirr(i.flows!) : null,
      valueInr: valueOf(i),
      gainInr:
        i.row.marketValueInr !== null && i.row.investedInr !== null ? i.row.marketValueInr - i.row.investedInr : null,
      since: i.since
    }))
    .filter((h) => h.valueInr > 0)
    .sort((a, b) => b.valueInr - a.valueInr)

  const dd = drawdowns(growth)
  return {
    coverage: totalValueInr > 0 ? coveredValueInr / totalValueInr : 0,
    coveredValueInr,
    fromStatementsInr,
    statementsSince,
    totalValueInr,
    dates,
    values,
    netInvested,
    growth,
    monthly,
    drawdown: dd,
    maxDrawdown: maxDrawdown(dates, growth),
    rolling12: [null, ...rolling(monthly, 12)],
    trailing,
    years,
    benchmarks,
    xirr: { overall: xirr(covered.flatMap((i) => i.flows!)), byAccount, byHolding }
  }
}
