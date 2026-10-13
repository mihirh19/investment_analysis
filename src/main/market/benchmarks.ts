import { and, asc, eq, gte, lt, max, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import { FxTable } from '../portfolio/fx'
import { mfapiHistory, npsHistory } from './funds'
import { mapLimit, type FetchFn } from './http'
import { yahooHistory, type PricePoint } from './yahoo'

// Market indices to compare the portfolio with, and one year of daily closes for risk numbers.
// Yahoo's Indian and US indices are price indices: they leave out dividends, so they understate a
// total-return benchmark by roughly the index's dividend yield (about 1–1.5% a year for Nifty 50).

export interface Benchmark {
  key: string
  label: string
  /** Yahoo symbol, or an AMFI scheme code when `source` is 'MFAPI'. */
  symbol: string
  source: 'YAHOO' | 'MFAPI'
  currency: 'INR' | 'USD'
  /** True when the series includes reinvested income (a fund NAV), false for a price index. */
  totalReturn: boolean
}

export const BENCHMARKS: Benchmark[] = [
  { key: 'BM:NIFTY50', label: 'Nifty 50', symbol: '^NSEI', source: 'YAHOO', currency: 'INR', totalReturn: false },
  { key: 'BM:NIFTY500', label: 'Nifty 500', symbol: '^CRSLDX', source: 'YAHOO', currency: 'INR', totalReturn: false },
  {
    key: 'BM:MIDCAP150',
    label: 'Nifty Midcap 150',
    symbol: 'NIFTYMIDCAP150.NS',
    source: 'YAHOO',
    currency: 'INR',
    totalReturn: false
  },
  { key: 'BM:SP500_INR', label: 'S&P 500 (in ₹)', symbol: '^GSPC', source: 'YAHOO', currency: 'USD', totalReturn: false },
  // HDFC Liquid Fund – Direct – Growth: a stand-in for "kept as cash", NAV includes the interest.
  { key: 'BM:LIQUID', label: 'Liquid fund', symbol: '119091', source: 'MFAPI', currency: 'INR', totalReturn: true }
]

export const benchmarkByKey = (key: string) => BENCHMARKS.find((b) => b.key === key)

const DAY = 86400000
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10)

/** Converts USD closes to rupees at the exchange rate on each date; drops dates with no rate. */
export function toInr(points: PricePoint[], fx: FxTable): PricePoint[] {
  return points
    .map((p) => ({ date: p.date, close: p.close * (fx.on(p.date) ?? fx.latest() ?? 0) }))
    .filter((p) => p.close > 0)
}

// ---------------- weekly benchmark history (10 years, in price_history) ----------------

function lastDate(db: Db, table: typeof schema.priceHistory | typeof schema.priceDaily, key: string) {
  return db.select({ d: max(table.date) }).from(table).where(eq(table.key, key)).get()?.d ?? null
}

function save(db: Db, table: typeof schema.priceHistory | typeof schema.priceDaily, key: string, pts: PricePoint[]) {
  db.transaction((tx) => {
    for (const p of pts) {
      tx.insert(table)
        .values({ key, date: p.date, close: p.close })
        .onConflictDoUpdate({ target: [table.key, table.date], set: { close: p.close } })
        .run()
    }
  })
}

/** Keeps the last close of each Monday-start week. */
function weeklyOf(points: PricePoint[]): PricePoint[] {
  const byWeek = new Map<string, PricePoint>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(`${p.date}T00:00:00Z`)
    byWeek.set(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10), p)
  }
  return [...byWeek.values()]
}

async function fetchBenchmark(b: Benchmark, f: FetchFn, fx: FxTable, daily: boolean): Promise<PricePoint[]> {
  if (b.source === 'MFAPI') {
    const pts = await mfapiHistory(b.symbol, isoDaysAgo(daily ? 400 : 3660), f)
    return daily ? pts : weeklyOf(pts)
  }
  const { prices } = await yahooHistory(b.symbol, daily ? '1y' : '10y', f, daily ? '1d' : '1wk')
  return b.currency === 'USD' ? toInr(prices, fx) : prices
}

/** Fetches ten years of weekly closes for each benchmark not refreshed in the last six days. */
export async function refreshBenchmarks(db: Db, f: FetchFn): Promise<string[]> {
  const fx = FxTable.load(db, 'USDINR')
  const due = BENCHMARKS.filter((b) => {
    const last = lastDate(db, schema.priceHistory, b.key)
    return !last || Date.now() - Date.parse(last) > 6 * DAY
  })
  const results = await mapLimit(due, 3, async (b) => {
    const pts = await fetchBenchmark(b, f, fx, false)
    if (!pts.length) throw new Error(`No history for ${b.label}`)
    save(db, schema.priceHistory, b.key, pts)
  })
  return results.filter((r) => !r.ok).map((r) => r.item.label)
}

// ---------------- daily closes, last year (in price_daily) ----------------

const KEEP_DAYS = 400

/**
 * One year of daily closes for every held market instrument and every benchmark, for volatility,
 * drawdown and beta. Series updated today are skipped; rows older than ~13 months are pruned.
 */
export async function refreshDaily(db: Db, f: FetchFn): Promise<string[]> {
  const fx = FxTable.load(db, 'USDINR')
  const today = new Date().toISOString().slice(0, 10)
  const fresh = (key: string) => {
    const last = lastDate(db, schema.priceDaily, key)
    // A series whose last close is from the previous trading day is current on weekends and mornings.
    return !!last && Date.now() - Date.parse(last) < 2 * DAY + DAY / 2 && last <= today
  }

  const held = db.all<{ id: number }>(sql`
    SELECT DISTINCT s.instrument_id AS id FROM holding_snapshots s JOIN accounts a ON a.id = s.account_id
    WHERE a.kind != 'MANUAL_ASSET'
    UNION SELECT DISTINCT t.instrument_id FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.kind != 'MANUAL_ASSET'`)
  const ids = new Set(held.map((h) => h.id))
  const instruments = db
    .select()
    .from(schema.instruments)
    .all()
    .filter((i) => ids.has(i.id))

  const jobs: { label: string; key: string; run: () => Promise<PricePoint[]> }[] = []
  for (const b of BENCHMARKS) {
    if (!fresh(b.key)) jobs.push({ label: b.label, key: b.key, run: () => fetchBenchmark(b, f, fx, true) })
  }
  for (const i of instruments) {
    const key = `I:${i.id}`
    if (fresh(key)) continue
    if (i.assetClass === 'MF' && i.amfiCode) {
      jobs.push({ label: i.name, key, run: () => mfapiHistory(i.amfiCode!, isoDaysAgo(KEEP_DAYS), f) })
    } else if (i.assetClass === 'NPS' && i.npsCode) {
      jobs.push({
        label: i.name,
        key,
        run: async () => (await npsHistory(i.npsCode!, f)).filter((p) => p.date >= isoDaysAgo(KEEP_DAYS))
      })
    } else if (i.yahooSymbol) {
      jobs.push({ label: i.symbolNse ?? i.tickerUs ?? i.name, key, run: async () => (await yahooHistory(i.yahooSymbol!, '1y', f, '1d')).prices })
    }
  }

  const results = await mapLimit(jobs, 3, async (j) => {
    const pts = await j.run()
    if (pts.length) save(db, schema.priceDaily, j.key, pts)
  })
  db.delete(schema.priceDaily).where(lt(schema.priceDaily.date, isoDaysAgo(KEEP_DAYS))).run()
  return results.filter((r) => !r.ok).map((r) => r.item.label)
}

// ---------------- reading ----------------

/** Closes for one series, oldest first: weekly from price_history, or daily from price_daily. */
export function seriesFor(db: Db, key: string, opts: { since?: string; daily?: boolean } = {}): PricePoint[] {
  const t = opts.daily ? schema.priceDaily : schema.priceHistory
  return db
    .select({ date: t.date, close: t.close })
    .from(t)
    .where(and(eq(t.key, key), opts.since ? gte(t.date, opts.since) : undefined))
    .orderBy(asc(t.date))
    .all()
}
