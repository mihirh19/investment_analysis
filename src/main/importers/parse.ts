const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

const pad = (n: number) => String(n).padStart(2, '0')

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Parses the date formats seen in Indian broker/RTA exports into YYYY-MM-DD.
 * Numeric dates are read day-first (DD-MM-YYYY), as Indian statements print them.
 * Any time-of-day suffix is ignored.
 */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m: RegExpMatchArray | null

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3])
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return iso(+m[3], +m[2], +m[1])
  if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]+(\d{2,4})/))) {
    const mon = monthOf(m[2])
    return mon ? iso(+m[3], mon, +m[1]) : null
  }
  if ((m = s.match(/^([A-Za-z]{3,9})[ .-]+(\d{1,2}),?\s*(\d{4})/))) {
    const mon = monthOf(m[1])
    return mon ? iso(+m[3], mon, +m[2]) : null
  }
  return null
}

/** "Mar", "MARCH", "Sept" → 3, 3, 9 */
const monthOf = (word: string): number | undefined => MONTHS[word.slice(0, 3).toLowerCase()]

/** Parses "1,23,456.78", "(1,234.50)", "₹ 500", "-12.5" etc. Returns null for blanks. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s || s === '-' || s === '--') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[₹$,\s]|INR|USD|Rs\.?/gi, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
