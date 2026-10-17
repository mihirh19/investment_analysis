import { eq } from 'drizzle-orm'
import type { CpiFigure, CpiSummary, ExpenseKey } from '@shared/plan'
import { schema, type Db } from '../db'
import { getJson, type FetchFn } from './http'

/**
 * Official inflation by spending category: MoSPI's All-India Consumer Price Index (combined rural
 * and urban, base 2012), from its public API (no sign-up needed for a few records at a time).
 * The long-run rate per category is the compound yearly rise over ten years of December indices;
 * five-year and latest year-on-year figures are kept for context.
 *
 * Built-in figures (December 2015 to December 2025) are used until a download succeeds.
 */

const API = 'https://api.mospi.gov.in/api/cpi/getCPIIndex'
const KEY = 'cpi:summary'

/** The CPI sub-group each category follows. EMI is a fixed amount: no inflation. */
export const CPI_SERIES: Partial<Record<ExpenseKey, string>> = {
  GROCERY: 'Food and Beverages-Overall',
  RENT: 'Housing-Overall',
  HEALTH: 'Health',
  EDUCATION: 'Education',
  TRANSPORT: 'Transport and Communication',
  FUEL_POWER: 'Fuel and Light-Overall',
  CLOTHING: 'Clothing and Footwear-Overall',
  HOUSEHOLD: 'Household Goods and Services',
  PERSONAL: 'Personal Care and Effects',
  LEISURE: 'Recreation and Amusement',
  OTHER: 'General-Overall'
}
const GENERAL = 'General-Overall'

const f = (series: string, tenYear: number, fiveYear: number, latest: number): CpiFigure => ({
  series,
  tenYear,
  fiveYear,
  latest
})
/** MoSPI CPI (base 2012), All India, combined: December 2015 → December 2025. */
export const BUILT_IN_CPI: CpiSummary = {
  asOf: '2025-12',
  builtIn: true,
  general: f(GENERAL, 4.62, 4.71, 1.33),
  byCategory: {
    GROCERY: f('Food and Beverages-Overall', 4.4, 4.65, -1.85),
    RENT: f('Housing-Overall', 4.32, 3.46, 2.86),
    HEALTH: f('Health', 5.37, 5.15, 3.43),
    EDUCATION: f('Education', 4.51, 4.26, 3.37),
    TRANSPORT: f('Transport and Communication', 4.45, 3.97, 0.82),
    FUEL_POWER: f('Fuel and Light-Overall', 4.04, 4.16, 1.97),
    CLOTHING: f('Clothing and Footwear-Overall', 4.36, 5.08, 1.44),
    HOUSEHOLD: f('Household Goods and Services', 4.19, 4.44, 1.91),
    PERSONAL: f('Personal Care and Effects', 8.84, 11.09, 28.16),
    LEISURE: f('Recreation and Amusement', 4.22, 3.87, 1.17),
    OTHER: f(GENERAL, 4.62, 4.71, 1.33)
  }
}

interface Row {
  year: number
  subgroup: string
  index: string
  inflation: string
}

async function december(year: number, fetchFn?: FetchFn): Promise<Map<string, { index: number; inflation: number }>> {
  const q = new URLSearchParams({
    base_year: '2012',
    series: 'Current',
    year: String(year),
    month_code: '12',
    state_code: '99',
    sector_code: '3',
    limit: '60',
    Format: 'JSON'
  })
  const r = await getJson<{ data?: Row[] }>(`${API}?${q}`, { fetch: fetchFn, timeoutMs: 30_000 })
  return new Map(
    (r.data ?? [])
      .filter((x) => Number(x.index) > 0)
      .map((x) => [x.subgroup, { index: Number(x.index), inflation: Number(x.inflation) }])
  )
}

/** Downloads the latest ten years of December indices and works out each category's rates. */
export async function fetchCpi(now = new Date(), fetchFn?: FetchFn): Promise<CpiSummary | null> {
  for (let y = now.getUTCFullYear() - (now.getUTCMonth() === 11 ? 0 : 1); y >= 2020; y--) {
    const latest = await december(y, fetchFn)
    if (latest.size === 0) continue
    const [five, ten] = await Promise.all([december(y - 5, fetchFn), december(y - 10, fetchFn)])
    const rate = (a: number | undefined, b: number | undefined, years: number) =>
      a && b ? Math.round(((a / b) ** (1 / years) - 1) * 10000) / 100 : null
    const figure = (series: string): CpiFigure | null => {
      const l = latest.get(series)
      const tenY = rate(l?.index, ten.get(series)?.index, 10)
      if (!l || tenY === null) return null
      return { series, tenYear: tenY, fiveYear: rate(l.index, five.get(series)?.index, 5) ?? tenY, latest: l.inflation }
    }
    const general = figure(GENERAL)
    if (!general) return null
    const byCategory: CpiSummary['byCategory'] = {}
    for (const [k, series] of Object.entries(CPI_SERIES) as [ExpenseKey, string][]) {
      const fig = figure(series)
      if (fig) byCategory[k] = fig
    }
    return { asOf: `${y}-12`, general, byCategory, builtIn: false }
  }
  return null
}

export function storedCpi(db: Db): CpiSummary {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  if (!row) return BUILT_IN_CPI
  try {
    return (JSON.parse(row.value) as { summary: CpiSummary }).summary
  } catch {
    return BUILT_IN_CPI
  }
}

/** Refreshes the stored figures at most monthly. Returns the month they run to. */
export async function refreshCpi(db: Db, fetchFn?: FetchFn, force = false): Promise<string | null> {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  const at = row ? (JSON.parse(row.value) as { at?: string }).at : undefined
  if (!force && at && Date.now() - Date.parse(at) < 30 * 86400000) return storedCpi(db).asOf
  const summary = await fetchCpi(new Date(), fetchFn)
  if (!summary) return null
  const value = JSON.stringify({ at: new Date().toISOString(), summary })
  db.insert(schema.settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
  return summary.asOf
}
