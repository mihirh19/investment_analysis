// Period arithmetic for the shared period picker (pure, unit-tested).

export type Period = '6M' | '1Y' | '3Y' | '5Y' | 'FY' | 'ALL'

export const PERIODS: { key: Period; label: string; title: string }[] = [
  { key: '6M', label: '6M', title: 'Last 6 months' },
  { key: '1Y', label: '1Y', title: 'Last year' },
  { key: '3Y', label: '3Y', title: 'Last 3 years' },
  { key: '5Y', label: '5Y', title: 'Last 5 years' },
  { key: 'FY', label: 'This FY', title: 'This financial year, from 1 April' },
  { key: 'ALL', label: 'All', title: 'Everything on record' }
]

/** The date the period starts on, for a given "today" (ISO dates). */
export function periodStartDate(period: Period, today: string): string | null {
  const [y, m, d] = today.split('-').map(Number)
  const back = (months: number) => {
    const dt = new Date(Date.UTC(y, m - 1 - months, 1))
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
    dt.setUTCDate(Math.min(d, last))
    return dt.toISOString().slice(0, 10)
  }
  switch (period) {
    case '6M':
      return back(6)
    case '1Y':
      return back(12)
    case '3Y':
      return back(36)
    case '5Y':
      return back(60)
    case 'FY':
      // The last day of the previous financial year, so the first point is the opening value.
      return `${m >= 4 ? y : y - 1}-03-31`
    case 'ALL':
      return null
  }
}

/**
 * Index of the first date to show: the last date on or before the period start (so the chart opens
 * with the value at the start), or 0 when history begins later.
 */
export function periodStartIndex(dates: string[], period: Period): number {
  if (!dates.length) return 0
  const start = periodStartDate(period, dates[dates.length - 1])
  if (!start) return 0
  let i = 0
  for (let k = 0; k < dates.length; k++) if (dates[k] <= start) i = k
  return i
}

