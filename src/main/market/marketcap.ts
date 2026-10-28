import { max, ne } from 'drizzle-orm'
import XLSX from 'xlsx'
import { schema, type Db } from '../db'
import { saveMany } from '../db/batch'
import { readSheets, type Grid } from '../sheets/read'
import { fetchWith, type FetchFn } from './http'

/**
 * SEBI's large / mid / small cap bands. AMFI publishes the official list twice a year (six-month
 * average market cap to 30 June and 31 December): ranks 1–100 are large cap, 101–250 mid cap and
 * the rest small cap. The file sits at a predictable address, so the newest one is fetched directly.
 * Page: https://www.amfiindia.com/otherdata/categorisation-of-stocks
 */

export type CapBand = 'LARGE' | 'MID' | 'SMALL'

export interface CapRow {
  isin: string
  name: string
  category: CapBand
  rank: number | null
  avgCapCr: number | null
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Half-years whose list may be out, newest first (AMFI publishes in the first week after). */
export function capPeriods(now: Date, count = 3): string[] {
  const out: string[] = []
  let y = now.getUTCFullYear()
  let h = now.getUTCMonth() >= 6 ? 1 : 0 // 1: Jan–Jun of this year has ended
  for (let i = 0; i < count; i++) {
    out.push(h === 1 ? `${y}-06-30` : `${y - 1}-12-31`)
    if (h === 1) h = 0
    else {
      h = 1
      y -= 1
    }
  }
  return out
}

/** Where AMFI has put the file for a half-year (the address moved with its 2025 site). */
export function capUrls(period: string): string[] {
  const [y, m, d] = period.split('-')
  const stamp = `${d}${MON[Number(m) - 1]}${y}`
  return [
    `https://portal.amfiindia.com/spages/AverageMarketCapitalization${stamp}.xlsx`,
    `https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalization${stamp}.xlsx`
  ]
}

const BAND: Record<string, CapBand> = { large: 'LARGE', mid: 'MID', small: 'SMALL' }

/** Reads AMFI's list: Sr. No., Company name, ISIN, …, Average of all exchanges, Categorization. */
export function parseCapList(data: Buffer | ArrayBuffer): CapRow[] {
  const wb = XLSX.read(data, { type: 'buffer' })
  return capRows(wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' }) })))
}

/** The same, from sheets already read into grids. */
export function capRows(grids: Grid[]): CapRow[] {
  const out: CapRow[] = []
  for (const { rows: grid } of grids) {
    const h = grid.findIndex((r) => r.some((c) => /^isin$/i.test(String(c).trim())))
    if (h < 0) continue
    const head = grid[h].map((c) => String(c).toLowerCase())
    const iIsin = head.findIndex((c) => c.trim() === 'isin')
    const iName = head.findIndex((c) => /company name/.test(c))
    const iRank = head.findIndex((c) => /sr\.? ?no/.test(c))
    const iCap = head.findIndex((c) => /average of all/.test(c))
    const iCat = head.findIndex((c) => /categori[sz]ation/.test(c))
    if (iIsin < 0 || iCat < 0) continue
    for (const r of grid.slice(h + 1)) {
      const isin = String(r[iIsin] ?? '')
        .trim()
        .toUpperCase()
      const band =
        BAND[
          String(r[iCat] ?? '')
            .trim()
            .toLowerCase()
            .split(/\s+/)[0]
        ]
      if (!/^IN[A-Z0-9]{10}$/.test(isin) || !band) continue
      const cap = Number(r[iCap])
      const rank = Number(r[iRank])
      out.push({
        isin,
        name: String(r[iName] ?? '').trim() || isin,
        category: band,
        rank: Number.isFinite(rank) && rank > 0 ? rank : null,
        avgCapCr: Number.isFinite(cap) ? cap : null
      })
    }
  }
  return out
}

/**
 * Loads the newest list unless it is already stored. Returns the half-year now in use, or null if
 * none could be read (the bands then stay as they were).
 */
export async function refreshMarketCaps(db: Db, f?: FetchFn, now = new Date()): Promise<string | null> {
  const stored = db
    .select({ period: max(schema.marketCaps.period) })
    .from(schema.marketCaps)
    .get()?.period
  for (const period of capPeriods(now)) {
    if (stored && stored >= period) return stored
    for (const url of capUrls(period)) {
      try {
        const rows = capRows(
          await readSheets(await fetchWith(url, { fetch: f, timeoutMs: 60_000 }, (res) => res.arrayBuffer()))
        )
        if (rows.length < 500) continue
        const at = new Date().toISOString()
        // The new list over the old, then whatever the new one no longer names.
        const seen = new Set<string>()
        const fresh = rows.filter((r) => !seen.has(r.isin) && !!seen.add(r.isin))
        await saveMany(db, schema.marketCaps, fresh.map((r) => ({ ...r, period, updatedAt: at })), schema.marketCaps.isin)
        db.delete(schema.marketCaps).where(ne(schema.marketCaps.period, period)).run()
        return period
      } catch {
        /* not published there (yet): try the next address or the half-year before */
      }
    }
  }
  return stored ?? null
}
