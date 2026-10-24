const formatters = new Map<string, Intl.NumberFormat>()
function nf(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = formatters.get(key)
  if (!f) formatters.set(key, (f = make()))
  return f
}

/** ₹12,34,567 (Indian grouping) or $1,234.56. */
export function money(v: number | null | undefined, currency = 'INR', fractionDigits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const digits = fractionDigits ?? (currency === 'INR' ? (Math.abs(v) >= 1000 ? 0 : 2) : 2)
  return nf(
    `m:${currency}:${digits}`,
    () =>
      new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      })
  ).format(v)
}

/** ₹4.25 L / ₹1.32 Cr for headline figures. */
export function lakhCrore(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`
  return money(v)
}

/** Short axis labels: ₹850, ₹12k, ₹4.2L, ₹1.3Cr (or $ for USD). */
export function compactMoney(v: number, currency = 'INR'): string {
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  const sym = currency === 'USD' ? '$' : '₹'
  const trim = (n: number) => String(Number(n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)))
  if (currency === 'USD') {
    if (a >= 1e6) return `${sign}${sym}${trim(a / 1e6)}M`
    if (a >= 1e3) return `${sign}${sym}${trim(a / 1e3)}k`
    return `${sign}${sym}${trim(a)}`
  }
  if (a >= 1e7) return `${sign}${sym}${trim(a / 1e7)}Cr`
  if (a >= 1e5) return `${sign}${sym}${trim(a / 1e5)}L`
  if (a >= 1e3) return `${sign}${sym}${trim(a / 1e3)}k`
  return `${sign}${sym}${trim(a)}`
}

/** Indian financial year label for a date: 2026-05-10 → "FY27" (Apr 2026 – Mar 2027). */
export function financialYear(iso: string): string {
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const end = m >= 4 ? y + 1 : y
  return `FY${String(end).slice(2)}`
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export function units(v: number): string {
  const digits = Number.isInteger(v) ? 0 : 3
  return nf(
    `u:${digits}`,
    () => new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  ).format(v)
}

export function percent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(2)}%`
}

export function signedMoney(v: number | null | undefined, currency = 'INR'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = money(Math.abs(v), currency)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function toneClass(v: number | null | undefined): string {
  if (!v) return 'text-ink-muted'
  return v > 0 ? 'text-gain' : 'text-loss'
}

/** Company-sized amounts: ₹46,824 Cr, or ₹10.68 lakh Cr from a lakh crore up. */
export function bigMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 1e12) return `${sign}₹${(a / 1e12).toFixed(2)} lakh Cr`
  if (a >= 1e9) return `${sign}₹${Math.round(a / 1e7).toLocaleString('en-IN')} Cr`
  return lakhCrore(v)
}

/** Chart axis for company figures: ₹80k Cr, ₹1.2L Cr, ₹950 Cr. */
export function axisCrore(v: number): string {
  const sign = v < 0 ? '−' : ''
  const cr = Math.abs(v) / 1e7
  const trim = (n: number) => String(Number(n.toFixed(n >= 100 ? 0 : 1)))
  if (cr >= 1e5) return `${sign}₹${trim(cr / 1e5)}L Cr`
  if (cr >= 1e3) return `${sign}₹${trim(cr / 1e3)}k Cr`
  if (cr >= 1) return `${sign}₹${trim(cr)} Cr`
  return compactMoney(v)
}
