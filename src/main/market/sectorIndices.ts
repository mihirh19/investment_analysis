import { eq } from 'drizzle-orm'
import type { SectorIndexStats } from '@shared/insights'
import { schema, type Db } from '../db'
import type { FetchFn } from './http'

/**
 * NSE's sector indices and their record: daily closes and daily P/E, P/B and dividend yield for
 * ten years from niftyindices.com (the data behind its "Historical data" reports). From these:
 * returns over 1, 3 and 5 years, the 52-week range, and today's P/E against its own ten years.
 * Refreshed weekly.
 */

/** Index (NSE's short name, as the site wants it) and the NSE industries it follows. */
export const SECTOR_INDICES: { key: string; industries: string[] }[] = [
  { key: 'NIFTY FIN SERVICE', industries: ['Financial Services'] },
  { key: 'NIFTY BANK', industries: ['Financial Services'] },
  { key: 'NIFTY PVT BANK', industries: ['Financial Services'] },
  { key: 'NIFTY PSU BANK', industries: ['Financial Services'] },
  { key: 'NIFTY CAPITAL MKT', industries: ['Financial Services'] },
  { key: 'NIFTY IT', industries: ['Information Technology'] },
  { key: 'NIFTY IND DIGITAL', industries: ['Information Technology', 'Telecommunication'] },
  { key: 'NIFTY PHARMA', industries: ['Healthcare'] },
  { key: 'NIFTY HEALTHCARE', industries: ['Healthcare'] },
  { key: 'NIFTY FMCG', industries: ['Fast Moving Consumer Goods'] },
  { key: 'NIFTY CONSUMPTION', industries: ['Fast Moving Consumer Goods', 'Consumer Services', 'Consumer Durables'] },
  { key: 'NIFTY AUTO', industries: ['Automobile and Auto Components'] },
  { key: 'NIFTY METAL', industries: ['Metals & Mining'] },
  { key: 'NIFTY COMMODITIES', industries: ['Metals & Mining', 'Chemicals', 'Construction Materials'] },
  { key: 'NIFTY CHEMICALS', industries: ['Chemicals'] },
  { key: 'NIFTY ENERGY', industries: ['Oil Gas & Consumable Fuels', 'Power'] },
  { key: 'NIFTY OIL AND GAS', industries: ['Oil Gas & Consumable Fuels'] },
  { key: 'NIFTY CPSE', industries: ['Power', 'Oil Gas & Consumable Fuels', 'Capital Goods'] },
  { key: 'NIFTY INFRA', industries: ['Construction', 'Construction Materials', 'Power', 'Telecommunication', 'Capital Goods'] },
  { key: 'NIFTY IND DEFENCE', industries: ['Capital Goods'] },
  { key: 'NIFTY REALTY', industries: ['Realty'] },
  { key: 'NIFTY HOUSING', industries: ['Realty', 'Construction Materials'] },
  { key: 'NIFTY CONSR DURBL', industries: ['Consumer Durables'] },
  { key: 'NIFTY MEDIA', industries: ['Media Entertainment & Publication'] },
  { key: 'NIFTY SERV SECTOR', industries: ['Services', 'Consumer Services'] }
]
/** The broad market, to read every sector against. */
export const MARKET_INDEX = 'NIFTY 500'

const SITE = 'https://www.niftyindices.com'
const KEY = 'sectors:indices'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const siteDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`
/** "16 Oct 2026" → 2026-10-16 */
const isoOf = (s: string) => {
  const m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[ -](\d{4})$/)
  return m ? `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

async function session(f: FetchFn) {
  const page = await f(`${SITE}/reports/historical-data`, { headers: { 'User-Agent': UA } })
  await page.text()
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return async <T>(endpoint: string, name: string, from: Date, to: Date): Promise<T[]> => {
    const res = await f(`${SITE}/BackPage/${endpoint}`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json; charset=UTF-8',
        Origin: SITE,
        Referer: `${SITE}/reports/historical-data`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({
        cinfo: `{'name':'${name}','startDate':'${siteDate(from)}','endDate':'${siteDate(to)}','indexName':'${name}'}`
      })
    })
    const text = (await res.text()).trim()
    if (!text.startsWith('[') && !text.startsWith('{')) throw new Error(`niftyindices.com: no data for ${name}`)
    const body = JSON.parse(text) as T[] | { d: string }
    return Array.isArray(body) ? body : (JSON.parse(body.d) as T[])
  }
}

/** One index's figures from its price and valuation history (both newest first or any order). */
export function statsFrom(
  key: string,
  name: string,
  prices: { date: string; close: number }[],
  vals: { date: string; pe: number | null; pb: number | null; dy: number | null }[]
): SectorIndexStats | null {
  const p = [...prices].filter((x) => x.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (p.length === 0) return null
  const last = p[p.length - 1]
  const at = (yearsBack: number) => {
    const target = new Date(Date.parse(last.date) - yearsBack * 365.25 * 86400000).toISOString().slice(0, 10)
    // The closest close to that day, and only when the history really reaches it (within a fortnight).
    let found: (typeof p)[number] | null = null
    for (const x of p)
      if (!found || Math.abs(Date.parse(x.date) - Date.parse(target)) < Math.abs(Date.parse(found.date) - Date.parse(target)))
        found = x
    return found && Math.abs(Date.parse(target) - Date.parse(found.date)) < 15 * 86400000 ? found : null
  }
  const ret = (y: number) => {
    const then = at(y)
    return then ? ((last.close / then.close) ** (1 / y) - 1) * 100 : null
  }
  const yearAgo = new Date(Date.parse(last.date) - 365 * 86400000).toISOString().slice(0, 10)
  const year = p.filter((x) => x.date > yearAgo)
  const high = Math.max(...year.map((x) => x.close))
  const low = Math.min(...year.map((x) => x.close))
  const v = [...vals].filter((x) => x.pe !== null && x.pe > 0).sort((a, b) => a.date.localeCompare(b.date))
  const pes = v.map((x) => x.pe!).sort((a, b) => a - b)
  const pe = v.at(-1)?.pe ?? null
  const median = pes.length ? pes[Math.floor(pes.length / 2)] : null
  const percentile = pe !== null && pes.length ? pes.filter((x) => x < pe).length / pes.length : null
  const monthly = new Map<string, number>()
  for (const x of v) monthly.set(x.date.slice(0, 7), x.pe!)
  return {
    key,
    name,
    asOf: last.date,
    close: last.close,
    r1y: ret(1),
    r3y: ret(3),
    r5y: ret(5),
    high52w: high,
    low52w: low,
    belowHigh: high > 0 ? 1 - last.close / high : 0,
    pe,
    peMedian10y: median,
    pePercentile: percentile,
    pb: v.at(-1)?.pb ?? null,
    divYield: v.at(-1)?.dy ?? null,
    peHistory: [...monthly].map(([m, pe]) => ({ date: `${m}-01`, pe }))
  }
}

/** Downloads every sector index's ten years. At most weekly unless forced. Returns how many loaded. */
export async function refreshSectorIndices(db: Db, f: FetchFn = fetch, force = false): Promise<number> {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  const at = row ? (JSON.parse(row.value) as { at: string }).at : null
  if (!force && at && Date.now() - Date.parse(at) < 7 * 86400000) return 0
  const call = await session(f)
  const to = new Date()
  const from = new Date(to.getTime() - 10.1 * 365.25 * 86400000)
  const stats: SectorIndexStats[] = []
  for (const key of [MARKET_INDEX, ...SECTOR_INDICES.map((s) => s.key)]) {
    try {
      const prices = await call<{ HistoricalDate: string; CLOSE: string; INDEX_NAME?: string }>(
        'getHistoricaldatatabletoString',
        key,
        from,
        to
      )
      const vals = await call<{ DATE: string; pe: string; pb: string; divYield: string; 'Index Name'?: string }>(
        'getpepbHistoricaldataDBtoString',
        key,
        from,
        to
      )
      const n = (s: string) => (Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null)
      const s = statsFrom(
        key,
        vals[0]?.['Index Name'] || prices[0]?.INDEX_NAME || key,
        prices.map((x) => ({ date: isoOf(x.HistoricalDate) ?? '', close: Number(x.CLOSE) })).filter((x) => x.date),
        vals.map((x) => ({ date: isoOf(x.DATE) ?? '', pe: n(x.pe), pb: n(x.pb), dy: n(x.divYield) })).filter((x) => x.date)
      )
      if (s) stats.push(s)
    } catch {
      /* one index failing leaves the rest */
    }
  }
  if (stats.length === 0) throw new Error('niftyindices.com sent no index data')
  const value = JSON.stringify({ at: new Date().toISOString(), stats })
  db.insert(schema.settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
  return stats.length
}

export function storedSectorIndices(db: Db): SectorIndexStats[] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  return row ? (JSON.parse(row.value) as { stats: SectorIndexStats[] }).stats : []
}

// ---------------- the market's sector weights ----------------

const WEIGHTS_KEY = 'sectors:nifty500'

/** Nifty 500 members and their industries (NSE's list); weights come from AMFI's market caps. */
export async function refreshNifty500(db: Db, f: FetchFn = fetch, force = false): Promise<number> {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, WEIGHTS_KEY)).get()
  const at = row ? (JSON.parse(row.value) as { at: string }).at : null
  if (!force && at && Date.now() - Date.parse(at) < 30 * 86400000) return 0
  const res = await f('https://archives.nseindia.com/content/indices/ind_nifty500list.csv', { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`NSE Nifty 500 list: ${res.status}`)
  const lines = (await res.text()).split(/\r?\n/).filter(Boolean)
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const iInd = head.indexOf('industry')
  const iIsin = head.findIndex((h) => h.startsWith('isin'))
  const members: { isin: string; industry: string }[] = []
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim()) ?? []
    if (/^IN[A-Z0-9]{10}$/.test(cells[iIsin] ?? '')) members.push({ isin: cells[iIsin], industry: cells[iInd] })
  }
  if (members.length < 400) throw new Error('NSE Nifty 500 list looks incomplete')
  const value = JSON.stringify({ at: new Date().toISOString(), members })
  db.insert(schema.settings)
    .values({ key: WEIGHTS_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
  return members.length
}

/** Each industry's share of the Nifty 500 by full market capitalisation (AMFI's six-month average). */
export function marketSectorWeights(db: Db): { weights: Map<string, number>; members: number; capPeriod: string | null } | null {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, WEIGHTS_KEY)).get()
  if (!row) return null
  const members = (JSON.parse(row.value) as { members: { isin: string; industry: string }[] }).members
  const caps = new Map(db.select().from(schema.marketCaps).all().map((c) => [c.isin, c]))
  const by = new Map<string, number>()
  let total = 0
  let period: string | null = null
  for (const m of members) {
    const c = caps.get(m.isin)
    if (!c?.avgCapCr) continue
    period ??= c.period
    by.set(m.industry, (by.get(m.industry) ?? 0) + c.avgCapCr)
    total += c.avgCapCr
  }
  if (total <= 0) return null
  return { weights: new Map([...by].map(([k, v]) => [k, v / total])), members: members.length, capPeriod: period }
}
