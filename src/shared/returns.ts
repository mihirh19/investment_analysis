// Returns from a price or NAV history: shared by the desktop's market look-ups and the phone app.

export interface PricePoint {
  date: string
  close: number
}

/** % change from the close nearest before `days` ago to the last close; a year or more as % a year. */
export function returnOver(points: PricePoint[], days: number): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const target = Date.parse(last.date) - days * 86400000
  // The close nearest the target day; none within ten days (weekly data, holidays) means too short a history.
  let start: PricePoint | null = null
  for (const p of points)
    if (!start || Math.abs(Date.parse(p.date) - target) < Math.abs(Date.parse(start.date) - target)) start = p
  if (!start || start === last || Math.abs(Date.parse(start.date) - target) > 10 * 86400000) return null
  const growth = last.close / start.close
  const years = days / 365
  const r = years >= 1 ? Math.pow(growth, 1 / years) - 1 : growth - 1
  return Math.round(r * 10000) / 100
}

/** The deepest fall from a high, %, and when it bottomed. */
export function worstFall(points: PricePoint[]): { pct: number; bottom: string } | null {
  let peak = 0
  let worst: { pct: number; bottom: string } | null = null
  for (const p of points) {
    peak = Math.max(peak, p.close)
    const fall = (p.close / peak - 1) * 100
    if (!worst || fall < worst.pct) worst = { pct: Math.round(fall * 100) / 100, bottom: p.date }
  }
  return worst
}

/** Return in each calendar year, %, from the last close of the year before. */
export function calendarYears(points: PricePoint[]): Record<string, number> {
  const yearEnd = new Map<string, number>()
  for (const p of points) yearEnd.set(p.date.slice(0, 4), p.close)
  const years = [...yearEnd.keys()].sort()
  const out: Record<string, number> = {}
  for (let i = 1; i < years.length; i++) {
    const prev = yearEnd.get(years[i - 1])!
    out[years[i]] = Math.round((yearEnd.get(years[i])! / prev - 1) * 10000) / 100
  }
  return out
}

/** A fund's NAV record: returns over periods, by calendar year, and its worst fall. */
export async function fundHistory(code: string, history: (code: string, since: string) => Promise<PricePoint[]>, today = new Date()) {
  const since = new Date(today.getTime() - 10.2 * 365 * 86400000).toISOString().slice(0, 10)
  const points = await history(code, since)
  if (!points.length) throw new Error(`No NAV history for scheme code ${code}.`)
  const last = points[points.length - 1]
  return {
    code,
    nav: last.close,
    navDate: last.date,
    since: points[0].date,
    returnsPct: {
      '1 month': returnOver(points, 30),
      '6 months': returnOver(points, 182),
      '1 year': returnOver(points, 365),
      '3 years (a year)': returnOver(points, 3 * 365),
      '5 years (a year)': returnOver(points, 5 * 365),
      '10 years (a year)': returnOver(points, 10 * 365)
    },
    byCalendarYear: calendarYears(points),
    worstFall: worstFall(points)
  }
}
