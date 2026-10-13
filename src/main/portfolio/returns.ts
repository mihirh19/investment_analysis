import { daysBetween, financialYearOf } from './dates'
import type { CashFlow } from './xirr'

// Pure return arithmetic, kept separate from the database so every formula is unit-tested.
// Cash flows use the investor's sign throughout (money put in < 0, money taken out > 0), the same
// as XIRR. The portfolio sees the opposite sign: an investor's −₹100 is a +₹100 inflow to it.

/**
 * Modified Dietz return for one period: (V1 − V0 − C) / (V0 + Σ wᵢ·Cᵢ), where C is the net money
 * that came into the portfolio and wᵢ the share of the period each flow was invested for.
 * Null when there was nothing invested to earn a return on.
 */
export function modifiedDietz(v0: number, v1: number, flows: CashFlow[], start: string, end: string): number | null {
  const span = Math.max(1, daysBetween(start, end))
  let net = 0
  let weighted = 0
  for (const f of flows) {
    const inflow = -f.amount
    const w = Math.min(1, Math.max(0, daysBetween(f.date, end) / span))
    net += inflow
    weighted += w * inflow
  }
  const base = v0 + weighted
  // Below ₹1 of capital at work the ratio is noise (e.g. a month that opens and closes at zero).
  if (base < 1) return null
  return (v1 - v0 - net) / base
}

/**
 * One return per period between consecutive dates. Flows on a period-end date belong to the period
 * that ends there (they were made before that day's closing value was taken).
 */
export function periodReturns(dates: string[], values: number[], flows: CashFlow[]): (number | null)[] {
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date))
  const out: (number | null)[] = []
  let k = 0
  // Flows on or before the first date are the opening position, not part of any period.
  while (k < sorted.length && sorted[k].date <= dates[0]) k++
  for (let i = 1; i < dates.length; i++) {
    const inPeriod: CashFlow[] = []
    while (k < sorted.length && sorted[k].date <= dates[i]) inPeriod.push(sorted[k++])
    out.push(modifiedDietz(values[i - 1], values[i], inPeriod, dates[i - 1], dates[i]))
  }
  return out
}

/** Compounds period returns; null periods (nothing invested) count as flat. */
export function chain(returns: (number | null)[]): number {
  return returns.reduce<number>((acc, r) => acc * (1 + (r ?? 0)), 1) - 1
}

/** Growth of `base` through the periods: one value per date (the first is `base`). */
export function growthIndex(returns: (number | null)[], base = 100): number[] {
  const out = [base]
  for (const r of returns) out.push(out[out.length - 1] * (1 + (r ?? 0)))
  return out
}

/** Annualises a total return over a number of years; returns it as-is for a year or less. */
export function annualise(total: number, years: number): number {
  if (years <= 1) return total
  return (1 + total) ** (1 / years) - 1
}

/** Fall from the running peak at each point (0 at a new high, −0.25 = 25% below the peak). */
export function drawdowns(index: number[]): number[] {
  let peak = -Infinity
  return index.map((v) => {
    peak = Math.max(peak, v)
    return peak > 0 ? v / peak - 1 : 0
  })
}

/** The deepest drawdown, the dates of its peak and trough, and when (if ever) the old peak was regained. */
export function maxDrawdown(
  dates: string[],
  index: number[]
): { depth: number; peak: string; trough: string; recovered: string | null } | null {
  if (index.length < 2) return null
  let peakI = 0
  let best = { depth: 0, peakI: 0, troughI: 0 }
  for (let i = 1; i < index.length; i++) {
    if (index[i] >= index[peakI]) peakI = i
    const dd = index[i] / index[peakI] - 1
    if (dd < best.depth) best = { depth: dd, peakI, troughI: i }
  }
  if (best.depth === 0) return null
  let recovered: string | null = null
  for (let i = best.troughI + 1; i < index.length; i++) {
    if (index[i] >= index[best.peakI]) {
      recovered = dates[i]
      break
    }
  }
  return { depth: best.depth, peak: dates[best.peakI], trough: dates[best.troughI], recovered }
}

/** Trailing return over the last `n` periods at each point (null until there are `n` periods). */
export function rolling(returns: (number | null)[], n: number): (number | null)[] {
  return returns.map((_, i) => (i + 1 < n ? null : chain(returns.slice(i + 1 - n, i + 1))))
}

// ---------------- calendar and financial years ----------------

export interface YearSpan {
  kind: 'CY' | 'FY'
  label: string
  /** Index into `dates` of the opening value (the previous year's last date). */
  from: number
  /** Index into `dates` of the closing value. */
  to: number
  /** Opening or closing date is not the true year boundary (history starts or ends inside the year). */
  partial: boolean
}

/** Splits month-end dates into calendar (Jan–Dec) or financial (Apr–Mar) years. */
export function yearSpans(dates: string[], kind: 'CY' | 'FY'): YearSpan[] {
  const labelOf = (d: string) => (kind === 'CY' ? d.slice(0, 4) : financialYearOf(d).label)
  const endOf = (d: string) => (kind === 'CY' ? `${d.slice(0, 4)}-12-31` : financialYearOf(d).end)
  const spans: YearSpan[] = []
  for (let i = 1; i < dates.length; i++) {
    const label = labelOf(dates[i])
    const last = spans[spans.length - 1]
    if (last && last.label === label) last.to = i
    else spans.push({ kind, label, from: i - 1, to: i, partial: false })
  }
  for (const s of spans) {
    s.partial = dates[s.from] !== prevEnd(dates[s.to], kind) || dates[s.to] !== endOf(dates[s.to])
  }
  return spans
}

/** The last day of the year before the one containing `d`. */
function prevEnd(d: string, kind: 'CY' | 'FY'): string {
  if (kind === 'CY') return `${Number(d.slice(0, 4)) - 1}-12-31`
  return `${Number(financialYearOf(d).start.slice(0, 4))}-03-31`
}

// ---------------- benchmarks ----------------

/** Last close on or before `date`; the first close when `date` is before the series starts. */
export function priceOn(series: { date: string; close: number }[], date: string): number | null {
  if (!series.length) return null
  let lo = 0
  let hi = series.length - 1
  if (date < series[0].date) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (series[mid].date <= date) lo = mid
    else hi = mid - 1
  }
  return series[lo].close
}

/** Index return between two dates, or null when the series doesn't cover the opening date. */
export function indexReturn(series: { date: string; close: number }[], from: string, to: string): number | null {
  const a = priceOn(series, from)
  const b = priceOn(series, to)
  return a && b ? b / a - 1 : null
}

/**
 * "Same money in the index": buys index units with every rupee you put in and sells units for every
 * rupee you took out, on the same dates. `opening` is a value already held on dates[0], bought then.
 * Returns the value of those units at each date (null before the index has a price).
 */
export function replayIntoIndex(
  dates: string[],
  flows: CashFlow[],
  series: { date: string; close: number }[],
  opening = 0
): (number | null)[] {
  const sorted = [...flows].filter((f) => f.date > dates[0]).sort((a, b) => a.date.localeCompare(b.date))
  const p0 = priceOn(series, dates[0])
  if (!p0) return dates.map(() => null)
  let units = opening / p0
  let k = 0
  return dates.map((d) => {
    while (k < sorted.length && sorted[k].date <= d) {
      const f = sorted[k++]
      const p = priceOn(series, f.date)
      if (p) units = Math.max(0, units - f.amount / p) // investor −₹ (put in) buys units
    }
    const p = priceOn(series, d)
    return p ? units * p : null
  })
}
