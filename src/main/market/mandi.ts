import { eq, ne } from 'drizzle-orm'
import { CROPS, type CropKey } from '@shared/farm'
import { schema, type Db } from '../db'
import { classKey, defaultMarket, mandiKey, monthlyKey, priceTargets, saveRange, varietyKey } from '../farm'
import { fetchRajkotRates } from './apmcRajkot'
import { getJson, type FetchFn } from './http'

/**
 * Mandi prices from Agmarknet (the Ministry of Agriculture's market information service): the same
 * JSON the agmarknet.gov.in pages use, no key needed. Daily modal prices for the last week of one
 * market, kept day by day as they arrive; monthly averages for the past year (and the same month a
 * year earlier) for the trend. Prices are ₹ per quintal.
 */

const API = 'https://api.agmarknet.gov.in/v1'
const MARKETS_KEY = 'mandi:markets'
const LAST_KEY = 'mandi:last'
const ERROR_KEY = 'farm:priceError'
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const GUJARAT = 11

export interface MandiMarket {
  id: number
  name: string
  stateId: number | null
  districtId: number | null
}

function getSetting(db: Db, key: string): string | null {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}
function setSetting(db: Db, key: string, value: string): void {
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}

interface Filters {
  at: string
  markets: MandiMarket[]
  /** Agmarknet's variety names by commodity id. */
  varieties?: Record<string, string[]>
}

/** Agmarknet's lists of markets and varieties, kept for a month. */
async function filters(db: Db, f?: FetchFn): Promise<Filters> {
  const cached = getSetting(db, MARKETS_KEY)
  if (cached) {
    const c = JSON.parse(cached) as Filters
    if (Date.now() - Date.parse(c.at) < 30 * 86400000 && c.markets.length && c.varieties) return c
  }
  const j = await getJson<{
    data?: {
      market_data?: { id: number; mkt_name: string; state_id: number | null; district_id: number | null }[]
      variety_data?: { cmdt_id: number[] | null; variety_name: string }[]
    }
  }>(`${API}/daily-price-arrival/filters`, { fetch: f, timeoutMs: 30_000 })
  const list = (j.data?.market_data ?? [])
    .filter((m) => m.state_id !== null)
    .map((m) => ({ id: m.id, name: m.mkt_name, stateId: m.state_id, districtId: m.district_id }))
  if (!list.length) throw new Error('Agmarknet sent no market list.')
  // Only the crops the app knows, to keep the stored list small.
  const ours = new Set(Object.values(CROPS).map((c) => c.agmarkId))
  const varieties: Record<string, string[]> = {}
  for (const v of j.data?.variety_data ?? [])
    for (const id of Array.isArray(v.cmdt_id) ? v.cmdt_id : [])
      if (ours.has(id as never)) (varieties[id] ??= []).push(v.variety_name)
  const out: Filters = { at: new Date().toISOString(), markets: list, varieties }
  setSetting(db, MARKETS_KEY, JSON.stringify(out))
  return out
}

/** Agmarknet's variety names for a crop, from the last list fetched (empty until then). */
export function knownVarieties(db: Db, crop: CropKey): string[] {
  const c = getSetting(db, MARKETS_KEY)
  return c ? ((JSON.parse(c) as Filters).varieties?.[CROPS[crop].agmarkId] ?? []) : []
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bapmc\b|\bmarket\b|\byard\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The market a typed name means: "Rajkot" is "Rajkot APMC"; Gujarat's first when names repeat. */
export function findMarket(list: MandiMarket[], name: string): MandiMarket | null {
  const want = norm(name)
  if (!want) return null
  const rank = (m: MandiMarket) => (m.stateId === GUJARAT ? 0 : 1)
  const exact = list.filter((m) => norm(m.name) === want).sort((a, b) => rank(a) - rank(b))
  if (exact.length) return exact[0]
  // "Gondal" also matches "Gondal(Veg.market Gondal) APMC"; the plain one first.
  const starts = list.filter((m) => norm(m.name).startsWith(`${want} `)).sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
  return starts[0] ?? null
}

/** Days with a price in Agmarknet's last-week table: the middle of the varieties' modal prices, and their spread. */
export function parseLastWeek(j: { columns?: { key: string }[]; data?: Record<string, unknown>[] }): { date: string; modal: number; min: number; max: number }[] {
  const days = (j.columns ?? []).map((c) => c.key).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
  const out: { date: string; modal: number; min: number; max: number }[] = []
  for (const d of days) {
    const vals = (j.data ?? []).map((r) => r[d]).filter((v): v is number => typeof v === 'number' && v > 0).sort((a, b) => a - b)
    if (!vals.length) continue
    const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
    out.push({ date: d, modal: Math.round(mid), min: vals[0], max: vals[vals.length - 1] })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Each variety's prices in the last-week table: "Rajkot APMC - G20" is the variety G20. */
export function parseVarieties(j: { columns?: { key: string }[]; data?: Record<string, unknown>[] }): { variety: string; points: { date: string; price: number }[] }[] {
  const days = (j.columns ?? []).map((c) => c.key).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
  return (j.data ?? [])
    .map((r) => {
      const label = String(r.variety ?? '')
      const variety = label.includes(' - ') ? label.slice(label.lastIndexOf(' - ') + 3).trim() : label.trim()
      const points = days.filter((d) => typeof r[d] === 'number' && (r[d] as number) > 0).map((d) => ({ date: d, price: Math.round(r[d] as number) }))
      return { variety, points }
    })
    .filter((v) => v.variety && v.points.length)
}

/** One market's monthly averages from Agmarknet's monthly analysis: this month, the one before, and a year earlier. */
export function parseMonthly(
  j: { rows?: Record<string, unknown>[] },
  market: string,
  year: number,
  month: number
): { date: string; price: number }[] {
  const row = (j.rows ?? []).find((r) => norm(String(r.market ?? '')) === norm(market))
  if (!row) return []
  const at = (y: number, m: number) => {
    const v = row[`prices_${MONTHS[m - 1]}_${y}`]
    return typeof v === 'number' && v > 0 ? { date: `${y}-${String(m).padStart(2, '0')}-15`, price: Math.round(v) } : null
  }
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1]
  return [at(year, month), at(prev[0], prev[1]), at(year - 1, month)].filter((x): x is { date: string; price: number } => !!x)
}

function store(db: Db, key: string, points: { date: string; price: number }[]): void {
  db.transaction((tx) => {
    for (const p of points)
      tx.insert(schema.priceHistory)
        .values({ key, date: p.date, close: p.price })
        .onConflictDoUpdate({ target: [schema.priceHistory.key, schema.priceHistory.date], set: { close: p.price } })
        .run()
  })
}

/** The crops the farm grows, holds or watches, each with the mandi its price comes from. */
function wanted(db: Db): { crop: CropKey; market: string }[] {
  const fallback = defaultMarket(db)
  const seen = new Map<string, { crop: CropKey; market: string }>()
  const add = (crop: CropKey, market: string) => seen.set(`${crop}:${norm(market)}`, { crop, market })
  for (const s of db.select().from(schema.farmSeasons).where(ne(schema.farmSeasons.status, 'CLOSED')).all()) add(s.crop, s.market ?? fallback)
  for (const c of Object.keys(priceTargets(db)) as CropKey[]) add(c, fallback)
  return [...seen.values()]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches the last week's prices for every crop the farm needs (at most every six hours unless
 * forced) and, once, a year of monthly averages. Returns the crops no price was found for.
 */
export async function refreshMandiPrices(db: Db, f?: FetchFn, force = false, now = new Date()): Promise<string[]> {
  // What went wrong is kept for the Farm page, whether this run was the daily one or a button press.
  try {
    const missed = await fetchAll(db, f, force, now)
    if (missed.length) setSetting(db, ERROR_KEY, `No price found lately for ${missed.join('; ')}.`)
    else db.delete(schema.settings).where(eq(schema.settings.key, ERROR_KEY)).run()
    return missed
  } catch (e) {
    setSetting(db, ERROR_KEY, `Agmarknet didn’t answer (${e instanceof Error ? e.message : String(e)}). The last prices fetched are used.`)
    throw e
  }
}

async function fetchAll(db: Db, f: FetchFn | undefined, force: boolean, now: Date): Promise<string[]> {
  const needs = wanted(db)
  if (!needs.length) return []
  const list = (await filters(db, f)).markets
  const last: Record<string, string> = JSON.parse(getSetting(db, LAST_KEY) ?? '{}')
  const missed: string[] = []
  for (const { crop, market } of needs) {
    const key = mandiKey(crop, market)
    const label = `${CROPS[crop].label} at ${market}`
    const m = findMarket(list, market)
    if (!m) {
      missed.push(`${label} (Agmarknet has no mandi by that name)`)
      continue
    }
    if (!force && last[key] && now.getTime() - Date.parse(last[key]) < 6 * 3600000) continue

    const week = await getJson<{ columns?: { key: string }[]; data?: Record<string, unknown>[] }>(
      `${API}/prices-and-arrivals/market-price/lastweek?marketId=${m.id}&stateId=${m.stateId}&commodityId=${CROPS[crop].agmarkId}&includeExcel=false`,
      { fetch: f, timeoutMs: 30_000 }
    )
    const days = parseLastWeek(week)
    store(db, key, days.map((d) => ({ date: d.date, price: d.modal })))
    const latest = days.at(-1)
    if (latest) saveRange(db, key, { date: latest.date, min: latest.min, max: latest.max })
    // And each variety on its own, so G20 is valued at G20's price.
    for (const v of parseVarieties(week)) store(db, varietyKey(crop, market, v.variety), v.points)

    // A year of monthly averages: twelve months once, then just this one and the last.
    const mKey = monthlyKey(crop, market)
    const haveMonthly = db.select().from(schema.priceHistory).where(eq(schema.priceHistory.key, mKey)).limit(1).get()
    const back = haveMonthly ? 2 : 12
    for (let i = 0; i < back; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      const y = d.getUTCFullYear()
      const mo = d.getUTCMonth() + 1
      try {
        const mj = await getJson<{ rows?: Record<string, unknown>[] }>(
          `${API}/price-trend/wholesale-prices-monthly?report_mode=Marketwise&commodity=${CROPS[crop].agmarkId}&year=${y}&month=${mo}&state=${m.stateId}&district=${m.districtId}`,
          { fetch: f, timeoutMs: 30_000 }
        )
        store(db, mKey, parseMonthly(mj, m.name, y, mo))
      } catch {
        /* a month without a report; the daily prices still stand */
      }
      if (i < back - 1) await sleep(f ? 0 : 250)
    }

    if (!days.length && !db.select().from(schema.priceHistory).where(eq(schema.priceHistory.key, key)).limit(1).get()) missed.push(label)
    last[key] = now.toISOString()
    setSetting(db, LAST_KEY, JSON.stringify(last))
  }

  // Rajkot APMC's own rates: groundnut jini and jadi, wheat lokwan and tukda, with the day's low and high.
  const rajkot = needs.some((n) => norm(n.market) === 'rajkot')
  const yardKey = 'APMC:RAJKOT'
  if (rajkot && (force || !last[yardKey] || now.getTime() - Date.parse(last[yardKey]) >= 6 * 3600000)) {
    try {
      for (const r of await fetchRajkotRates(f)) {
        const k = classKey(r.crop, 'Rajkot', r.cls)
        store(db, k, [{ date: r.date, price: Math.round((r.min + r.max) / 2) }])
        saveRange(db, k, { date: r.date, min: r.min, max: r.max })
      }
      last[yardKey] = now.toISOString()
      setSetting(db, LAST_KEY, JSON.stringify(last))
    } catch {
      // Agmarknet's prices stand; the yard's own page is a second source.
      missed.push('Rajkot APMC’s own daily rates (the site didn’t answer)')
    }
  }
  return missed
}
