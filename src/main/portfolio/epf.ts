export interface EpfMeta {
  uan: string | null
  monthlyContribution: number
  /** Annual percentage, e.g. 8.25 */
  interestRate: number
}

export function parseEpfMeta(json: string | null): EpfMeta {
  try {
    const m = JSON.parse(json ?? '{}') as Partial<EpfMeta>
    return {
      uan: m.uan ?? null,
      monthlyContribution: Number(m.monthlyContribution) || 0,
      interestRate: Number.isFinite(Number(m.interestRate)) ? Number(m.interestRate) : 8.25
    }
  } catch {
    return { uan: null, monthlyContribution: 0, interestRate: 8.25 }
  }
}

/**
 * Projects an EPF balance from a passbook figure to a later date. EPFO computes interest on the
 * monthly running balance and credits it once a year; this accrues it monthly so the figure
 * stays current between passbook updates. Only whole months elapsed are counted.
 */
export function estimateEpfBalance(
  balance: number,
  fromIso: string,
  toIso: string,
  meta: Pick<EpfMeta, 'monthlyContribution' | 'interestRate'>
): number {
  const [fy, fm] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  const fd = Number(fromIso.slice(8, 10))
  let months = (ty - fy) * 12 + (tm - fm)
  if (td < fd) months -= 1
  if (months <= 0) return balance

  const monthlyRate = meta.interestRate / 100 / 12
  let running = balance
  let interest = 0
  let month = fm
  for (let i = 0; i < months; i++) {
    month = (month % 12) + 1
    running += meta.monthlyContribution
    interest += running * monthlyRate
    // Interest is credited at the end of March and earns interest from then on.
    if (month === 3) {
      running += interest
      interest = 0
    }
  }
  return running + interest
}
