// Valuation history and a reverse DCF, from a company's filed results and its price history.
// Information only: what the price has been against profits and book value, and what growth the
// price takes for granted. Nothing here says whether to buy or sell.

import type { BalanceRow, QuarterRow, YearRow } from './research'

/** Results reach the market about six weeks after the quarter ends. */
const FILING_LAG_DAYS = 45

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400_000).toISOString().slice(0, 10)
const profitOf = (q: { ownersProfit?: number; netProfit?: number }) => q.ownersProfit ?? q.netProfit

/** Profit over the four quarters to each quarter end, when all four are filed and in a row. */
export function ttmProfits(quarters: QuarterRow[]): { periodEnd: string; value: number }[] {
  const qs = [...quarters].filter((q) => profitOf(q) !== undefined).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
  const out = []
  for (let i = 3; i < qs.length; i++) {
    const four = qs.slice(i - 3, i + 1)
    // Consecutive quarters: the first and last ends are nine months apart, give or take a few days.
    const span = (Date.parse(four[3].periodEnd) - Date.parse(four[0].periodEnd)) / 86400_000
    if (span < 260 || span > 290) continue
    out.push({ periodEnd: four[3].periodEnd, value: four.reduce((s, q) => s + profitOf(q)!, 0) })
  }
  return out
}

export interface Band {
  points: { date: string; value: number }[]
  current: number | null
  median: number | null
  low: number | null
  high: number | null
  /** Share of the history below today's value, 0..1. */
  rank: number | null
}

const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return null
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo)
}

function band(points: { date: string; value: number }[]): Band {
  const sorted = points.map((p) => p.value).sort((a, b) => a - b)
  const now = points.at(-1)?.value ?? null
  return {
    points,
    current: now,
    median: quantile(sorted, 0.5),
    low: quantile(sorted, 0.1),
    high: quantile(sorted, 0.9),
    rank: now === null || sorted.length === 0 ? null : sorted.filter((v) => v < now).length / sorted.length
  }
}

/**
 * Price to earnings and price to book over time. Market value then is the split-adjusted price
 * times today's shares, which is exact through splits and bonuses; each figure counts from about six
 * weeks after its period ended. Periods of losses have no P/E and are left out.
 */
export function valuationBands(
  prices: { date: string; close: number }[],
  shares: number | null,
  quarters: QuarterRow[],
  balances: BalanceRow[]
): { pe: Band; pb: Band } {
  const empty = band([])
  if (!shares || prices.length === 0) return { pe: empty, pb: empty }
  const ttm = ttmProfits(quarters).map((t) => ({ from: addDays(t.periodEnd, FILING_LAG_DAYS), value: t.value }))
  const books = balances
    .filter((b) => (b.equity ?? b.totalEquity) !== undefined)
    .map((b) => ({ from: addDays(b.periodEnd, FILING_LAG_DAYS), value: (b.equity ?? b.totalEquity)! }))
    .sort((a, b) => a.from.localeCompare(b.from))
  const known = <T extends { from: string }>(list: T[], date: string) => {
    let hit: T | undefined
    for (const x of list) if (x.from <= date) hit = x
    return hit
  }
  const pe: { date: string; value: number }[] = []
  const pb: { date: string; value: number }[] = []
  for (const p of [...prices].sort((a, b) => a.date.localeCompare(b.date))) {
    const mcap = p.close * shares
    const e = known(ttm, p.date)
    if (e && e.value > 0) pe.push({ date: p.date, value: mcap / e.value })
    const b = known(books, p.date)
    if (b && b.value > 0) pb.push({ date: p.date, value: mcap / b.value })
  }
  return { pe: band(pe), pb: band(pb) }
}

/** Free cash flow (cash from operations less capital spending), averaged over the last three years filed. */
export function averageFcf(years: YearRow[], n = 3): number | null {
  const fcf = [...years]
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
    .filter((y) => y.cfo !== undefined)
    .slice(0, n)
    .map((y) => y.cfo! - Math.abs(y.capex ?? 0))
  return fcf.length ? fcf.reduce((s, v) => s + v, 0) / fcf.length : null
}

export interface DcfInput {
  /** This year's cash flow (or profit) the growth starts from, ₹. */
  base: number
  /** Growth a year during the growth years, as a fraction. */
  growth: number
  years: number
  /** The return asked for, as a fraction (the discount rate). */
  discount: number
  /** Growth a year forever after, as a fraction; must be below the discount rate. */
  terminalGrowth: number
}

/** What a stream of cash growing as given is worth today. */
export function dcfValue({ base, growth, years, discount, terminalGrowth }: DcfInput): number {
  let value = 0
  let cash = base
  for (let t = 1; t <= years; t++) {
    cash *= 1 + growth
    value += cash / (1 + discount) ** t
  }
  const terminal = (cash * (1 + terminalGrowth)) / (discount - terminalGrowth)
  return value + terminal / (1 + discount) ** years
}

/**
 * The yearly growth that makes the cash flow worth today's market value: what the price assumes.
 * Null when the base isn't positive, or when even no growth (or very fast growth) can't meet it.
 */
export function impliedGrowth(marketValue: number, input: Omit<DcfInput, 'growth'>): number | null {
  if (!(input.base > 0) || !(marketValue > 0) || input.terminalGrowth >= input.discount) return null
  let lo = -0.5
  let hi = 1.5
  if (dcfValue({ ...input, growth: lo }) > marketValue || dcfValue({ ...input, growth: hi }) < marketValue) return null
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (dcfValue({ ...input, growth: mid }) < marketValue) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
