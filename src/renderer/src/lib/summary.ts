import type { HoldingRow } from '@shared/types'

/** Totals in INR; US holdings are converted at the live USD→INR rate. */
export interface Totals {
  value: number
  /** Invested amount for rows where both cost and value are known. */
  invested: number
  gain: number
  gainPct: number | null
  /** Value of rows whose cost is unknown (excluded from gain). */
  valueWithoutCost: number
  dayChange: number
  /** Value of the rows that have a previous close, for the day-change percentage. */
  dayBase: number
}

export function totals(rows: HoldingRow[]): Totals {
  let value = 0
  let invested = 0
  let valueWithCost = 0
  let valueWithoutCost = 0
  let dayChange = 0
  let dayBase = 0
  for (const r of rows) {
    const v = r.marketValueInr ?? r.investedInr ?? 0
    value += v
    if (r.investedInr !== null && r.marketValueInr !== null) {
      invested += r.investedInr
      valueWithCost += r.marketValueInr
    } else {
      valueWithoutCost += v
    }
    if (r.dayChangeInr !== null && r.marketValueInr !== null) {
      dayChange += r.dayChangeInr
      dayBase += r.marketValueInr - r.dayChangeInr
    }
  }
  const gain = valueWithCost - invested
  return {
    value,
    invested,
    gain,
    gainPct: invested > 0 ? gain / invested : null,
    valueWithoutCost,
    dayChange,
    dayBase
  }
}

export function groupBy<K extends string | number>(
  rows: HoldingRow[],
  key: (r: HoldingRow) => K
): Map<K, HoldingRow[]> {
  const m = new Map<K, HoldingRow[]>()
  for (const r of rows) {
    const k = key(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return m
}

export function priceDateRange(rows: HoldingRow[]): { oldest: string | null; newest: string | null } {
  const dates = rows
    .map((r) => r.priceDate)
    .filter((d): d is string => !!d)
    .sort()
  return { oldest: dates[0] ?? null, newest: dates[dates.length - 1] ?? null }
}
