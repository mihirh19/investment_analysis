// Calendar helpers on ISO dates (YYYY-MM-DD), all in UTC so results never depend on the PC's time zone.

const DAY = 86400000

export const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const todayIso = () => new Date().toISOString().slice(0, 10)

export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY)
}

export function yearsBetween(a: string, b: string): number {
  return daysBetween(a, b) / 365
}

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * DAY)
}

/** Adds months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export const addYears = (iso: string, n: number) => addMonths(iso, n * 12)
export const minDate = (a: string, b: string) => (a < b ? a : b)
export const maxDate = (a: string, b: string) => (a > b ? a : b)

/** Indian financial year containing the date: 2026-05-10 → { start: 2026-04-01, end: 2027-03-31, label: FY27 } */
export function financialYearOf(iso: string): { start: string; end: string; label: string } {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const startYear = m >= 4 ? y : y - 1
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31`, label: `FY${String(startYear + 1).slice(2)}` }
}

/** Month-end dates from the month of `from` through the month of `to` (the last one is `to` itself). */
export function monthEnds(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    const end = fromMs(Date.UTC(y, m, 0))
    out.push(end > to ? to : end)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}
