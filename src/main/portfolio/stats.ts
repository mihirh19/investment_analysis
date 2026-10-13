// Small statistics helpers for the risk figures. Pure functions on plain arrays, unit-tested.

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)

/** Sample covariance of two equally long series (NaN with fewer than two points). */
export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return NaN
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (n - 1)
}

export const variance = (a: number[]) => covariance(a, a)
export const stdev = (a: number[]) => Math.sqrt(variance(a))

export function correlation(a: number[], b: number[]): number {
  const d = stdev(a) * stdev(b)
  return d > 0 ? covariance(a, b) / d : NaN
}

/** How much the asset moves for each 1% move of the market (cov / market variance). */
export function beta(asset: number[], market: number[]): number {
  const v = variance(market)
  return v > 0 ? covariance(asset, market) / v : NaN
}

/** Root-mean-square of the shortfalls below a target return per period (Sortino's denominator). */
export function downsideDeviation(returns: number[], target = 0): number {
  if (!returns.length) return NaN
  return Math.sqrt(returns.reduce((s, r) => s + Math.min(0, r - target) ** 2, 0) / returns.length)
}

/**
 * Prices on each calendar date: the last close on or before it (so holidays carry the previous
 * close), or null before the series starts. Both inputs must be sorted oldest first.
 */
export function alignTo(calendar: string[], series: { date: string; close: number }[]): (number | null)[] {
  const out: (number | null)[] = []
  let k = 0
  let last: number | null = null
  for (const d of calendar) {
    while (k < series.length && series[k].date <= d) last = series[k++].close
    out.push(last)
  }
  return out
}

/** Period returns from consecutive prices (all must be positive numbers). */
export function returnsOf(prices: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) out.push(prices[i] / prices[i - 1] - 1)
  return out
}

/** Herfindahl index of the shares (1 = everything in one, 1/n = n equal parts). */
export function hhi(values: number[]): number {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0)
  if (total <= 0) return NaN
  return values.reduce((s, v) => s + (Math.max(0, v) / total) ** 2, 0)
}

/** The portfolio's return each period from fixed weights. */
export function weightedReturns(weights: number[], returns: number[][]): number[] {
  const n = Math.min(...returns.map((r) => r.length))
  const out: number[] = []
  for (let t = 0; t < n; t++) {
    let s = 0
    for (let i = 0; i < weights.length; i++) s += weights[i] * returns[i][t]
    out.push(s)
  }
  return out
}

/**
 * Each holding's share of the portfolio's ups and downs: wᵢ·cov(rᵢ, rₚ) / var(rₚ). The shares add up
 * to 1; a holding whose risk share is well above its value share is the one making the portfolio swing.
 */
export function riskShares(weights: number[], returns: number[][]): number[] {
  const rp = weightedReturns(weights, returns)
  const v = variance(rp)
  if (!(v > 0)) return weights.map(() => NaN)
  return weights.map((w, i) => (w * covariance(returns[i], rp)) / v)
}
