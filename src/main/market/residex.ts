import { eq, like } from 'drizzle-orm'
import { schema, type Db } from '../db'
import { fetchWith, type FetchFn } from './http'

/**
 * Home prices from NHB RESIDEX, the National Housing Bank's housing price index
 * (https://residex.nhbonline.org.in). For about 50 cities it publishes, every quarter, the weighted
 * average price per sq ft from valuations by banks and housing finance companies, overall and by
 * carpet area: under 60 m², 60–110 m² and over 110 m². Gujarat: Ahmedabad, Gandhinagar, Rajkot,
 * Surat, Vadodara.
 *
 * Two base-year series are joined: FY 2017-18 (from June 2018) and FY 2024-25 (from June 2025).
 * Where they overlap the newer one wins, and the older one is scaled to meet it so the history
 * has no step.
 */

const BASE = 'https://residex.nhbonline.org.in'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const CITIES_KEY = 'residex:cities'

export type SizeBand = 'ALL' | 'LT60' | '60TO110' | 'GT110'
export const SIZE_BANDS: SizeBand[] = ['ALL', 'LT60', '60TO110', 'GT110']
const FIELD: Record<SizeBand, string> = {
  ALL: 'WTAVG_COMPOSITE',
  LT60: 'WTAVG_LESSTHAN60',
  '60TO110': 'WTAVG_60TO110',
  GT110: 'WTAVG_GREATER110'
}

/** price_history key for a city's price per sq ft in one size band. */
export const residexKey = (cityId: number, band: SizeBand) => `RESIDEX:${cityId}:${band}`

/** The size band RESIDEX would put a home in, from its carpet area in sq ft. */
export function sizeBandOf(carpetSqft: number | null | undefined): SizeBand {
  if (!carpetSqft || carpetSqft <= 0) return 'ALL'
  const sqm = carpetSqft / 10.7639
  return sqm < 60 ? 'LT60' : sqm <= 110 ? '60TO110' : 'GT110'
}

export interface ResidexCity {
  id: number
  name: string
  state: string
}

interface Session {
  get(path: string): Promise<unknown>
  post(path: string, form: Record<string, string>): Promise<unknown>
}

/** The site expects the cookie its own page sets, as the page's scripts send it. */
async function openSession(f?: FetchFn): Promise<Session> {
  const fetchFn = f ?? fetch
  const page = await fetchFn(`${BASE}/DashboardBY2024/DashboardBY2024`, { headers: { 'User-Agent': UA } })
  await page.text()
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const headers = { 'User-Agent': UA, Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' }
  return {
    get: (path) => fetchWith(`${BASE}${path}`, { fetch: f, headers, timeoutMs: 30_000 }, (r) => r.json()),
    post: (path, form) =>
      fetchWith(
        `${BASE}${path}`,
        {
          fetch: (u, init) =>
            fetchFn(u, {
              ...init,
              method: 'POST',
              body: new URLSearchParams(form),
              headers: {
                ...(init?.headers as Record<string, string>),
                'Content-Type': 'application/x-www-form-urlencoded'
              }
            }),
          headers,
          timeoutMs: 30_000
        },
        (r) => r.json()
      )
  }
}

/** Every city RESIDEX covers, by state (cached for a month). */
export async function residexCities(db: Db, f?: FetchFn): Promise<ResidexCity[]> {
  const cached = db.select().from(schema.settings).where(eq(schema.settings.key, CITIES_KEY)).get()
  if (cached) {
    const { at, list } = JSON.parse(cached.value) as { at: string; list: ResidexCity[] }
    if (Date.now() - Date.parse(at) < 30 * 86400000 && list.length) return list
  }
  const s = await openSession(f)
  const states = ((await s.get('/ApplicationUtilities/GetState')) as { value: string; text: string }[]).filter(
    (x) => x.value !== '0'
  )
  const list: ResidexCity[] = []
  for (const st of states) {
    const cities = (await s.get(`/ApplicationUtilities/GetCity?State=${encodeURIComponent(st.value)}`)) as {
      value: string
      text: string
    }[]
    for (const c of cities) if (Number(c.value) > 0) list.push({ id: Number(c.value), name: c.text, state: st.text })
  }
  if (list.length) {
    const value = JSON.stringify({ at: new Date().toISOString(), list })
    db.insert(schema.settings)
      .values({ key: CITIES_KEY, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }
  return list
}

interface TrendRow {
  QTR_YEAR?: string
  [field: string]: unknown
}

const MONTHS: Record<string, string> = {
  Mar: '03-31',
  Jun: '06-30',
  Sep: '09-30',
  Dec: '12-31'
}
/** "Jun 2025" → 2025-06-30 (the quarter's last day). */
export function quarterEnd(label: string | undefined): string | null {
  const m = (label ?? '').match(/^([A-Za-z]{3})\w*\s+(\d{4})$/)
  return m && MONTHS[m[1]] ? `${m[2]}-${MONTHS[m[1]]}` : null
}

/** One city's quarterly price per sq ft by size band, older series scaled to meet the newer. */
export function joinSeries(older: TrendRow[], newer: TrendRow[]): Record<SizeBand, { date: string; close: number }[]> {
  const out = {} as Record<SizeBand, { date: string; close: number }[]>
  for (const band of SIZE_BANDS) {
    const read = (rows: TrendRow[]) =>
      new Map(
        rows
          .map((r) => [quarterEnd(r.QTR_YEAR), Number(r[FIELD[band]])] as const)
          .filter((x): x is [string, number] => !!x[0] && Number.isFinite(x[1]) && x[1] > 0)
      )
    const old = read(older)
    const cur = read(newer)
    const overlap = [...cur.keys()].filter((d) => old.has(d)).sort()
    const scale = overlap.length ? cur.get(overlap[0])! / old.get(overlap[0])! : 1
    const merged = new Map<string, number>()
    for (const [d, v] of old) merged.set(d, v * scale)
    for (const [d, v] of cur) merged.set(d, v)
    out[band] = [...merged].sort((a, b) => a[0].localeCompare(b[0])).map(([date, close]) => ({ date, close }))
  }
  return out
}

/** Downloads and stores the price series of the given cities. Returns the latest quarter stored. */
export async function refreshResidex(db: Db, cityIds: number[], f?: FetchFn): Promise<string | null> {
  if (cityIds.length === 0) return null
  const s = await openSession(f)
  const trend = async (base: '2018' | '2024', cityId: number) => {
    const res = (await s.post(`/DashboardBY${base}/Get_NHBResiCersai_PriceTrend`, {
      reporttype: 'CITY',
      lookup: 'HFC',
      cityid: String(cityId),
      pincode: '0',
      wardid: '0',
      // 2: valuation (assessment) prices, the series RESIDEX headlines.
      pricemtdid: '2',
      locid: '0',
      chkbefore1718: 'false'
    })) as { status?: string; data?: string }
    return res.status === 'Success' && res.data ? (JSON.parse(res.data) as TrendRow[]) : []
  }
  let latest: string | null = null
  for (const cityId of [...new Set(cityIds)]) {
    const series = joinSeries(await trend('2018', cityId), await trend('2024', cityId))
    db.transaction((tx) => {
      for (const band of SIZE_BANDS) {
        const key = residexKey(cityId, band)
        if (series[band].length === 0) continue
        tx.delete(schema.priceHistory).where(eq(schema.priceHistory.key, key)).run()
        for (const p of series[band]) tx.insert(schema.priceHistory).values({ key, date: p.date, close: p.close }).run()
      }
    })
    const last = series.ALL.at(-1)?.date ?? null
    if (last && (!latest || last > latest)) latest = last
  }
  return latest
}

/** Cities already downloaded, to refresh them. */
export function storedResidexCities(db: Db): number[] {
  return [
    ...new Set(
      db
        .select({ key: schema.priceHistory.key })
        .from(schema.priceHistory)
        .where(like(schema.priceHistory.key, 'RESIDEX:%'))
        .all()
        .map((r) => Number(r.key.split(':')[1]))
    )
  ]
}
