import { and, eq, gte, max, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import { DEFAULT_GOLD_PREMIUM, GOLD_PREMIUM_KEY, loadManualAssets } from '../manualAssets'
import { FxTable } from '../portfolio/fx'
import { getJson, mapLimit, type FetchFn } from './http'
import { mfapiHistory, npsHistory } from './funds'
import { yahooHistory, yahooQuote, type PricePoint } from './yahoo'

const TROY_OUNCE_GRAMS = 31.1034768
const nowIso = () => new Date().toISOString()

function goldPremium(db: Db): number {
  const v = db.select().from(schema.settings).where(eq(schema.settings.key, GOLD_PREMIUM_KEY)).get()?.value
  const n = Number(v ?? DEFAULT_GOLD_PREMIUM)
  return Number.isFinite(n) ? n : DEFAULT_GOLD_PREMIUM
}

function saveMarketPrice(db: Db, key: string, price: number, prevClose: number | null, asOf: string, source: string) {
  const row = { key, price, prevClose, asOf, source, fetchedAt: nowIso() }
  db.insert(schema.marketPrices).values(row).onConflictDoUpdate({ target: schema.marketPrices.key, set: row }).run()
}

/** Gold and silver in INR per gram of pure metal: COMEX USD/oz × USD→INR ÷ 31.1035 × (1 + India premium). */
export async function refreshMetals(db: Db, f: FetchFn): Promise<void> {
  const fx = db.select().from(schema.fxRates).where(eq(schema.fxRates.pair, 'USDINR')).get()
  if (!fx) throw new Error('USD→INR rate not available yet')
  const factor = (1 + goldPremium(db) / 100) / TROY_OUNCE_GRAMS
  const prevFx = fx.prevClose ?? fx.rate
  for (const [key, symbol] of [
    ['XAU', 'GC=F'],
    ['XAG', 'SI=F']
  ] as const) {
    const q = await yahooQuote(symbol, f)
    saveMarketPrice(
      db,
      key,
      q.price * fx.rate * factor,
      q.prevClose !== null ? q.prevClose * prevFx * factor : null,
      q.asOf,
      'YAHOO'
    )
  }
}

export function cryptoSymbols(db: Db): string[] {
  return [
    ...new Set(
      loadManualAssets(db)
        .filter((x) => x.meta.kind === 'CRYPTO')
        .map((x) => (x.meta as { symbol: string }).symbol.toUpperCase())
    )
  ]
}

/** Coins from Yahoo (SYM-USD × USD→INR), falling back to CoinGecko's INR price. Returns symbols not found. */
export async function refreshCrypto(db: Db, f: FetchFn): Promise<string[]> {
  const symbols = cryptoSymbols(db)
  if (symbols.length === 0) return []
  const fx = db.select().from(schema.fxRates).where(eq(schema.fxRates.pair, 'USDINR')).get()
  const results = await mapLimit(symbols, 3, async (sym) => {
    if (fx) {
      try {
        const q = await yahooQuote(`${sym}-USD`, f)
        saveMarketPrice(
          db,
          `CRYPTO:${sym}`,
          q.price * fx.rate,
          q.prevClose !== null ? q.prevClose * (fx.prevClose ?? fx.rate) : null,
          q.asOf,
          'YAHOO'
        )
        return
      } catch {
        /* try CoinGecko */
      }
    }
    const search = await getJson<{ coins?: { id: string; symbol: string; market_cap_rank: number | null }[] }>(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`,
      { fetch: f }
    )
    const coin = (search.coins ?? [])
      .filter((c) => c.symbol.toUpperCase() === sym)
      .sort((a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9))[0]
    if (!coin) throw new Error(`Unknown coin ${sym}`)
    const p = await getJson<Record<string, { inr?: number; inr_24h_change?: number }>>(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=inr&include_24hr_change=true`,
      { fetch: f }
    )
    const v = p[coin.id]
    if (!v?.inr) throw new Error(`No price for ${sym}`)
    const prev = v.inr_24h_change !== undefined ? v.inr / (1 + v.inr_24h_change / 100) : null
    saveMarketPrice(db, `CRYPTO:${sym}`, v.inr, prev, nowIso(), 'COINGECKO')
  })
  return results.filter((r) => !r.ok).map((r) => r.item)
}

// ---------------- weekly price history (net worth over time, sparklines) ----------------

/** Keeps the last close of each ISO week (Monday-start), so every series is roughly weekly. */
export function weekly(points: PricePoint[]): PricePoint[] {
  const byWeek = new Map<string, PricePoint>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(`${p.date}T00:00:00Z`)
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
    byWeek.set(monday, p)
  }
  return [...byWeek.values()]
}

function saveHistory(db: Db, key: string, points: PricePoint[]) {
  db.transaction((tx) => {
    for (const p of points) {
      tx.insert(schema.priceHistory)
        .values({ key, date: p.date, close: p.close })
        .onConflictDoUpdate({ target: [schema.priceHistory.key, schema.priceHistory.date], set: { close: p.close } })
        .run()
    }
  })
}

function isStale(db: Db, key: string): boolean {
  const last = db
    .select({ d: max(schema.priceHistory.date) })
    .from(schema.priceHistory)
    .where(eq(schema.priceHistory.key, key))
    .get()?.d
  return !last || Date.now() - Date.parse(last) > 6 * 86400000
}

const fiveYearsAgo = () => new Date(Date.now() - 5 * 365.25 * 86400000).toISOString().slice(0, 10)

/**
 * Fills five years of weekly closes for every instrument that ever had units, plus metals and coins.
 * Only stale series are fetched, so after the first run this is a handful of requests a week.
 */
export async function refreshHistory(db: Db, f: FetchFn): Promise<string[]> {
  // Every instrument with trades or statement rows; hand-maintained assets are valued by their engines.
  const used = db.all<{ instrument_id: number }>(
    sql`
      SELECT DISTINCT instrument_id FROM (
        SELECT t.instrument_id, t.account_id FROM transactions t
        UNION SELECT s.instrument_id, s.account_id FROM holding_snapshots s
      ) x JOIN accounts a ON a.id = x.account_id WHERE a.kind != 'MANUAL_ASSET'`
  )
  const usedIds = new Set(used.map((u) => u.instrument_id))
  const instruments = db
    .select()
    .from(schema.instruments)
    .all()
    .filter((i) => usedIds.has(i.id))
  const fx = FxTable.load(db, 'USDINR')
  const failed: string[] = []

  const jobs: { label: string; key: string; run: () => Promise<PricePoint[]> }[] = []
  for (const i of instruments) {
    const key = `I:${i.id}`
    if (!isStale(db, key)) continue
    if (i.assetClass === 'MF' && i.amfiCode) {
      jobs.push({ label: i.name, key, run: async () => weekly(await mfapiHistory(i.amfiCode!, fiveYearsAgo(), f)) })
    } else if (i.assetClass === 'NPS' && i.npsCode) {
      jobs.push({
        label: i.name,
        key,
        run: async () => weekly((await npsHistory(i.npsCode!, f)).filter((p) => p.date >= fiveYearsAgo()))
      })
    } else if (i.yahooSymbol) {
      jobs.push({
        label: i.symbolNse ?? i.tickerUs ?? i.name,
        key,
        run: async () => (await yahooHistory(i.yahooSymbol!, '5y', f, '1wk')).prices
      })
    }
  }

  const factor = (1 + goldPremium(db) / 100) / TROY_OUNCE_GRAMS
  const inInr = (pts: PricePoint[], mult = 1) =>
    pts
      .map((p) => ({ date: p.date, close: p.close * (fx.on(p.date) ?? fx.latest() ?? 0) * mult }))
      .filter((p) => p.close > 0)
  for (const [key, symbol] of [
    ['XAU', 'GC=F'],
    ['XAG', 'SI=F']
  ] as const) {
    if (isStale(db, key))
      jobs.push({
        label: key === 'XAU' ? 'Gold' : 'Silver',
        key,
        run: async () => inInr((await yahooHistory(symbol, '5y', f, '1wk')).prices, factor)
      })
  }
  for (const sym of cryptoSymbols(db)) {
    const key = `CRYPTO:${sym}`
    if (isStale(db, key))
      jobs.push({ label: sym, key, run: async () => inInr((await yahooHistory(`${sym}-USD`, '5y', f, '1wk')).prices) })
  }

  const results = await mapLimit(jobs, 3, async (j) => {
    const pts = await j.run()
    if (pts.length) saveHistory(db, j.key, pts)
  })
  for (const r of results) if (!r.ok) failed.push(r.item.label)
  return failed
}

/** Weekly closes for one series, oldest first. */
export function historyFor(db: Db, key: string, since?: string): PricePoint[] {
  return db
    .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
    .from(schema.priceHistory)
    .where(and(eq(schema.priceHistory.key, key), since ? gte(schema.priceHistory.date, since) : undefined))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date))
}
