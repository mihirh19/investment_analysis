import { yearsBetween } from './dates'

export interface CashFlow {
  date: string
  amount: number // investor's view: money in < 0, money out (and today's value) > 0
}

/**
 * Annualised money-weighted return: the rate r where Σ amount / (1+r)^(years since first flow) = 0.
 * Newton's method from a sensible start, falling back to bisection. Null when undefined
 * (fewer than two flows, all one sign, or no convergence).
 */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows
    .filter((f) => f.amount !== 0 && Number.isFinite(f.amount))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (fs.length < 2 || !fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null
  const t0 = fs[0].date
  const ts = fs.map((f) => yearsBetween(t0, f.date))
  // Everything on one day has no time dimension to annualise.
  if (ts[ts.length - 1] < 1 / 365) return null

  const npv = (r: number) => fs.reduce((s, f, i) => s + f.amount / (1 + r) ** ts[i], 0)
  const dnpv = (r: number) => fs.reduce((s, f, i) => s - (ts[i] * f.amount) / (1 + r) ** (ts[i] + 1), 0)

  let r = 0.1
  for (let i = 0; i < 50; i++) {
    const v = npv(r)
    const d = dnpv(r)
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break
    const next = r - v / d
    if (!Number.isFinite(next) || next <= -0.9999) break
    if (Math.abs(next - r) < 1e-9) return next
    r = next
  }

  // Bisection over a wide bracket.
  let lo = -0.9999
  let hi = 100
  let flo = npv(lo)
  const fhi = npv(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid
    if (flo * fm < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return null
}
