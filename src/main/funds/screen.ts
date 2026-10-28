import { desc, eq, inArray } from 'drizzle-orm'
import {
  benchmarkFor,
  computeFundMetrics,
  FUND_FIELDS,
  monthEnds,
  NO_METRICS,
  type FundChartData,
  type FundDetail,
  type FundField,
  type FundMetrics,
  type FundRow,
  type FundScreenData,
  type FundScreenStatus,
  type PricePt
} from '@shared/fundScreener'
import type { SchemeFacts } from '@shared/insights'
import { schema, type Db } from '../db'
import { factsFor, storedSchemeFacts } from '../market/amfiData'
import { FOLLOWED_KEY } from '../market/disclosures'
import { fetchNavAll, mfapiHistory, type AmfiScheme } from '../market/funds'
import type { FetchFn } from '../market/http'
import { yahooHistory } from '../market/yahoo'
import { listHoldings } from '../portfolio/holdings'

/**
 * The fund screener's data: the universe of open-ended Direct Growth plans (from AMFI's NAV file,
 * weekly), each fund's ratios from five years of NAVs (mfapi.in, a fund every couple of seconds,
 * weekly), and the indices they are measured against (Yahoo, daily).
 */

const UNIVERSE_KEY = 'funds:universe'
const SYNC_KEY = 'funds:sync'
const INDEX_KEY = (s: string) => `funds:index:${s}`
const WEEK = 7 * 86400_000

export interface UniverseFund {
  code: string
  name: string
  fundHouse: string | null
  category: string
  group: string
  isin: string | null
  nav: number | null
  navDate: string | null
}

const getSetting = (db: Db, k: string) => db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value ?? null
const setSetting = (db: Db, key: string, value: string) =>
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()

/**
 * "Equity Scheme - Flexi Cap Fund" (today's file) or "Open Ended Schemes(Equity Scheme - Flexi Cap
 * Fund)" (older ones) → group "Equity", category "Flexi Cap Fund". Close-ended, interval and fixed
 * maturity schemes can't be bought, so they don't count as open.
 */
export function categoryOf(heading: string | null): { open: boolean; group: string; category: string } {
  const h = heading ?? ''
  const inner = /\(([^)]*)\)/.exec(h)?.[1] ?? h
  const [g, ...rest] = inner.split(' - ')
  const group = /equity/i.test(g) ? 'Equity' : /debt/i.test(g) ? 'Debt' : /hybrid/i.test(g) ? 'Hybrid' : /solution|children|retirement/i.test(g) ? 'Solution Oriented' : 'Other'
  return { open: !!h && !/close ended|interval|fixed maturity|\bfmp\b/i.test(h), group, category: (rest.join(' - ') || g).trim() }
}

/** Open-ended Direct plans with the growth option: one line per fund. */
export function universeFrom(navs: AmfiScheme[]): UniverseFund[] {
  const out: UniverseFund[] = []
  for (const s of navs) {
    const c = categoryOf(s.category)
    if (!c.open) continue
    const label = [s.name, s.plan, s.option].filter(Boolean).join(' ')
    if (!/direct/i.test(label) || /idcw|dividend|bonus|payout|reinvest/i.test(label)) continue
    if (/etf/i.test(c.category) || /\betf\b/i.test(s.name)) continue
    out.push({ code: s.code, name: s.name.replace(/\s*-\s*(direct|growth|plan|option)[\w\s-]*$/i, '').trim() || s.name, fundHouse: s.fundHouse, category: c.category, group: c.group, isin: s.isinGrowth, nav: s.nav || null, navDate: s.date || null })
  }
  return out
}

// Parsed once until the stored list changes.
let universeCache: { raw: string; value: { at: string | null; funds: UniverseFund[] } } | null = null

export function storedUniverse(db: Db): { at: string | null; funds: UniverseFund[] } {
  const v = getSetting(db, UNIVERSE_KEY)
  if (!v) return { at: null, funds: [] }
  if (universeCache?.raw !== v) universeCache = { raw: v, value: JSON.parse(v) as { at: string; funds: UniverseFund[] } }
  return universeCache.value
}

/** Funds the family holds, by ISIN and AMFI code. */
function heldFunds(db: Db): { isins: Set<string>; codes: Set<string> } {
  // Units actually held (a followed fund has a record but no units).
  const ids = new Set(listHoldings(db).filter((h) => h.assetClass === 'MF' && h.quantity > 0).map((h) => h.instrumentId))
  if (ids.size === 0) return { isins: new Set(), codes: new Set() }
  const rows = db.select({ isin: schema.instruments.isin, code: schema.instruments.amfiCode }).from(schema.instruments).where(inArray(schema.instruments.id, [...ids])).all()
  return { isins: new Set(rows.map((r) => r.isin).filter((x): x is string => !!x)), codes: new Set(rows.map((r) => r.code).filter((x): x is string => !!x)) }
}

function storedIndex(db: Db, symbol: string): { at: string; points: PricePt[] } | null {
  const v = getSetting(db, INDEX_KEY(symbol))
  return v ? (JSON.parse(v) as { at: string; points: PricePt[] }) : null
}

export function saveStats(db: Db, code: string, metrics: FundMetrics | null, months: PricePt[], index: string | null, error: string | null): void {
  const v = { metricsJson: metrics ? JSON.stringify(metrics) : null, monthsJson: JSON.stringify(months), indexSymbol: index, computedAt: new Date().toISOString(), error }
  db.insert(schema.fundStats).values({ code, ...v }).onConflictDoUpdate({ target: schema.fundStats.code, set: v }).run()
}

function rowsOf(db: Db, facts: SchemeFacts[]): FundRow[] {
  const held = heldFunds(db)
  const stats = new Map(db.select().from(schema.fundStats).all().map((s) => [s.code, s]))
  return storedUniverse(db).funds.map((u) => {
    const f = factsFor(facts, u.name)
    const s = stats.get(u.code)
    const metrics = s?.metricsJson ? (JSON.parse(s.metricsJson) as FundMetrics) : NO_METRICS
    // AMFI's NAV file names categories one way throughout ("Mid Cap Fund"); its performance page another.
    const bench = benchmarkFor(u.category, u.name)
    return {
      ...metrics,
      code: u.code,
      name: u.name,
      fundHouse: u.fundHouse,
      category: u.category,
      group: u.group,
      isin: u.isin,
      nav: u.nav,
      navDate: u.navDate,
      aumCr: f?.aumCr ?? null,
      ter: f?.terDirect ?? null,
      risk: f?.risk ?? null,
      benchmark: f?.benchmark ?? null,
      index: bench?.label ?? null,
      held: (!!u.isin && held.isins.has(u.isin)) || held.codes.has(u.code),
      statsAt: s?.computedAt ?? null
    }
  })
}

export class FundScreenSync {
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private current: string | null = null
  private lastError: string | null = null

  constructor(
    private readonly db: Db,
    private readonly onUpdate: () => void = () => {},
    private readonly f: FetchFn = fetch,
    private readonly gapMs = 1500
  ) {}

  enabled(): boolean {
    return getSetting(this.db, SYNC_KEY) === 'on'
  }
  setEnabled(on: boolean): void {
    setSetting(this.db, SYNC_KEY, on ? 'on' : 'off')
    if (on) void this.run()
  }
  /** The screener was opened: the first time, this switches the downloads on. */
  opened(): void {
    if (getSetting(this.db, SYNC_KEY) === null) this.setEnabled(true)
  }
  start(): void {
    void this.run()
    this.timer = setInterval(() => void this.run(), 30 * 60_000)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): FundScreenStatus {
    const funds = storedUniverse(this.db).funds
    const fresh = new Set(
      this.db
        .select({ code: schema.fundStats.code, at: schema.fundStats.computedAt })
        .from(schema.fundStats)
        .all()
        .filter((s) => Date.now() - Date.parse(s.at) < WEEK)
        .map((s) => s.code)
    )
    return { enabled: this.enabled(), funds: funds.length, measured: funds.filter((u) => fresh.has(u.code)).length, running: this.running !== null, current: this.current, lastError: this.lastError }
  }

  run(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      // Yield first, so a pass that ends at once still clears `running` after it is set.
      await Promise.resolve()
      try {
        if (!this.enabled()) return
        await this.universe()
        await this.measure()
        this.lastError = null
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e)
      } finally {
        this.current = null
        this.running = null
        this.onUpdate()
      }
    })()
    return this.running
  }

  /** AMFI's NAV file for the list of funds, weekly. */
  private async universe(): Promise<void> {
    const u = storedUniverse(this.db)
    if (u.at && Date.now() - Date.parse(u.at) < WEEK && u.funds.length) return
    this.current = 'the list of funds'
    const funds = universeFrom(await fetchNavAll(this.f))
    if (funds.length < 100) throw new Error('AMFI’s NAV file had too few funds')
    setSetting(this.db, UNIVERSE_KEY, JSON.stringify({ at: new Date().toISOString(), funds }))
    this.onUpdate()
  }

  /** An index's five years of daily closes from Yahoo, kept for a day. */
  private async index(symbol: string): Promise<PricePt[] | null> {
    const s = storedIndex(this.db, symbol)
    if (s && Date.now() - Date.parse(s.at) < 86400_000) return s.points
    try {
      const points = (await yahooHistory(symbol, '5y', this.f, '1d')).prices
      if (points.length > 100) setSetting(this.db, INDEX_KEY(symbol), JSON.stringify({ at: new Date().toISOString(), points }))
      return points
    } catch {
      return s?.points ?? null
    }
  }

  /** Each fund's ratios, held funds first and then the biggest; a week old is fresh enough. */
  private async measure(): Promise<void> {
    const facts = storedSchemeFacts(this.db).schemes
    const stats = new Map(this.db.select({ code: schema.fundStats.code, at: schema.fundStats.computedAt }).from(schema.fundStats).all().map((s) => [s.code, Date.parse(s.at)]))
    const rows = rowsOf(this.db, facts)
    const due = rows
      .filter((r) => !(Date.now() - (stats.get(r.code) ?? 0) < WEEK))
      .sort((a, b) => Number(b.held) - Number(a.held) || (b.aumCr ?? 0) - (a.aumCr ?? 0))
    const since = new Date(Date.now() - (5 * 365 + 30) * 86400_000).toISOString().slice(0, 10)
    let n = 0
    for (const r of due) {
      if (!this.enabled()) return
      this.current = r.name
      const bench = benchmarkFor(r.category, r.name)
      try {
        const nav = await mfapiHistory(r.code, since, this.f)
        const index = bench ? await this.index(bench.symbol) : null
        saveStats(this.db, r.code, computeFundMetrics(nav, index), monthEnds(nav), bench?.symbol ?? null, null)
      } catch (e) {
        saveStats(this.db, r.code, null, [], bench?.symbol ?? null, e instanceof Error ? e.message : String(e))
      }
      if (++n % 20 === 0) this.onUpdate()
      await new Promise((res) => setTimeout(res, this.gapMs))
    }
  }

  /** One fund now (its page was opened), whether or not the backlog has reached it. */
  async measureNow(code: string): Promise<void> {
    const r = rowsOf(this.db, storedSchemeFacts(this.db).schemes).find((x) => x.code === code)
    if (!r) return
    const bench = benchmarkFor(r.category, r.name)
    const since = new Date(Date.now() - (5 * 365 + 30) * 86400_000).toISOString().slice(0, 10)
    const nav = await mfapiHistory(code, since, this.f)
    const index = bench ? await this.index(bench.symbol) : null
    saveStats(this.db, code, computeFundMetrics(nav, index), monthEnds(nav), bench?.symbol ?? null, null)
  }
}

export const followed = (db: Db): string[] => JSON.parse(getSetting(db, FOLLOWED_KEY) ?? '[]') as string[]

/**
 * Follows a fund (or stops): its monthly portfolio is then fetched like a held fund's. It needs a
 * record of the fund (no units, so it shows nowhere else) for its holdings to belong to.
 */
export function setFollowed(db: Db, code: string, on: boolean): void {
  const u = storedUniverse(db).funds.find((f) => f.code === code)
  if (!u) throw new Error('That fund isn’t in AMFI’s list.')
  const list = followed(db).filter((c) => c !== code)
  if (on) {
    list.push(code)
    const have = db.select().from(schema.instruments).where(eq(schema.instruments.amfiCode, code)).get() ?? (u.isin ? db.select().from(schema.instruments).where(eq(schema.instruments.isin, u.isin)).get() : undefined)
    if (have) db.update(schema.instruments).set({ amfiCode: code, fundHouse: have.fundHouse ?? u.fundHouse }).where(eq(schema.instruments.id, have.id)).run()
    else db.insert(schema.instruments).values({ name: `${u.name} - Direct Plan - Growth`, schemeName: u.name, isin: u.isin, amfiCode: code, fundHouse: u.fundHouse, assetClass: 'MF', currency: 'INR' }).run()
  }
  setSetting(db, FOLLOWED_KEY, JSON.stringify(list))
}

export function fundScreenData(db: Db, status: FundScreenStatus): FundScreenData {
  const facts = storedSchemeFacts(db)
  return { rows: rowsOf(db, facts.schemes), status, factsAsOf: facts.date }
}

/** One fund: its growth against the index, the category's averages and its disclosed portfolio. */
export function fundDetail(db: Db, code: string): FundDetail | null {
  const facts = storedSchemeFacts(db).schemes
  const rows = rowsOf(db, facts)
  const row = rows.find((r) => r.code === code)
  if (!row) return null
  const s = db.select().from(schema.fundStats).where(eq(schema.fundStats.code, code)).get()
  const months = s ? (JSON.parse(s.monthsJson) as PricePt[]) : []
  const idx = s?.indexSymbol ? storedIndex(db, s.indexSymbol)?.points ?? null : null
  const idxMonths = idx ? new Map(monthEnds(idx).map((p) => [p.date.slice(0, 7), p.close])) : null
  // Both start at 100 from the first month they share (the index's five years can start later).
  const start = idxMonths ? months.findIndex((p) => idxMonths.has(p.date.slice(0, 7))) : -1
  const from = start > 0 ? months.slice(start) : months
  const first = from[0]
  const firstIdx = first && idxMonths ? idxMonths.get(first.date.slice(0, 7)) : undefined
  const growth = from.map((p) => {
    const i = idxMonths?.get(p.date.slice(0, 7))
    return { date: p.date, fund: (p.close / first.close) * 100, index: i && firstIdx ? (i / firstIdx) * 100 : null }
  })

  const peers = rows.filter((r) => r.category === row.category && r.statsAt)
  const categoryAvg: Partial<Record<FundField, number>> = {}
  for (const f of FUND_FIELDS) {
    const vals = peers.map((r) => r[f.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (vals.length) categoryAvg[f.key] = vals.reduce((a, b) => a + b, 0) / vals.length
  }

  // Holdings: the fund's own disclosures when the family holds it (by ISIN or AMFI code).
  const ids = db
    .select({ id: schema.instruments.id, isin: schema.instruments.isin, code: schema.instruments.amfiCode })
    .from(schema.instruments)
    .all()
    .filter((i) => (row.isin && i.isin === row.isin) || i.code === code)
    .map((i) => i.id)
  const all = ids.length
    ? db.select().from(schema.fundHoldings).where(inArray(schema.fundHoldings.fundInstrumentId, ids)).orderBy(desc(schema.fundHoldings.asOf)).all().filter((h) => h.source !== 'YAHOO')
    : []
  const periods = [...new Set(all.map((h) => h.asOf))].sort().reverse()
  const latest = all.filter((h) => h.asOf === periods[0])
  const prev = periods[1] ? all.filter((h) => h.asOf === periods[1]) : []
  const key = (h: { isin: string | null; name: string }) => h.isin ?? h.name.toLowerCase()
  const prevBy = new Map(prev.map((h) => [key(h), h.weight]))
  const nowKeys = new Set(latest.map(key))
  const holdings = periods[0]
    ? {
        asOf: periods[0],
        prevAsOf: periods[1] ?? null,
        rows: latest
          .sort((a, b) => b.weight - a.weight)
          .map((h) => ({ name: h.name, isin: h.isin, sector: h.sector, assetType: h.assetType, weight: h.weight, change: prev.length ? (prevBy.has(key(h)) ? h.weight - prevBy.get(key(h))! : null) : 0 })),
        exited: prev.filter((h) => !nowKeys.has(key(h)) && h.weight >= 0.002).map((h) => ({ name: h.name, weight: h.weight })).sort((a, b) => b.weight - a.weight)
      }
    : null
  const bySector = (list: typeof latest) => {
    const m = new Map<string, number>()
    for (const h of list) if (h.assetType === 'EQUITY') m.set(h.sector ?? 'Other', (m.get(h.sector ?? 'Other') ?? 0) + h.weight)
    return m
  }
  const sNow = bySector(latest)
  const sPrev = bySector(prev)
  const sectors = [...sNow].sort((a, b) => b[1] - a[1]).map(([sector, weight]) => ({ sector, weight, change: prev.length ? weight - (sPrev.get(sector) ?? 0) : null }))
  const mix = new Map<string, number>()
  for (const h of latest) mix.set(h.assetType, (mix.get(h.assetType) ?? 0) + h.weight)
  return {
    row,
    growth,
    categoryAvg,
    categoryCount: peers.length,
    holdings,
    sectors,
    assetMix: [...mix].sort((a, b) => b[1] - a[1]).map(([type, weight]) => ({ type, weight })),
    holdingsNote: holdings
      ? null
      : followed(db).includes(code)
        ? 'Fetching the fund house’s monthly portfolio file; this can take a few minutes.'
        : 'The family doesn’t hold this fund, so its monthly portfolio file isn’t downloaded yet.',
    followed: followed(db).includes(code)
  }
}

// The whole history for the full chart and rolling returns: kept a few hours per fund and index.
const chartCache = new Map<string, { at: number; data: PricePt[] }>()
const HOURS_6 = 6 * 3600_000

async function cached(key: string, load: () => Promise<PricePt[]>): Promise<PricePt[]> {
  const hit = chartCache.get(key)
  if (hit && Date.now() - hit.at < HOURS_6) return hit.data
  const data = await load()
  chartCache.set(key, { at: Date.now(), data })
  return data
}

/** A fund's NAV since it started, and its index's (from Yahoo, as far back as it goes). */
export async function fundChart(db: Db, code: string, f: FetchFn = fetch): Promise<FundChartData | null> {
  const u = storedUniverse(db).funds.find((x) => x.code === code)
  if (!u) return null
  const bench = benchmarkFor(u.category, u.name)
  const nav = await cached(`nav:${code}`, () => mfapiHistory(code, '1990-01-01', f))
  // Yahoo gives daily points for ten years; "everything" comes monthly, so it only fills in before that.
  const index = bench
    ? await cached(`idx:${bench.symbol}`, async () => {
        const daily = (await yahooHistory(bench.symbol, '10y', f, '1d')).prices
        const older = daily.length ? (await yahooHistory(bench.symbol, 'max', f, '1d').catch(() => ({ prices: [] as PricePt[] }))).prices.filter((p) => p.date < daily[0].date) : []
        return [...older, ...daily]
      }).catch(() => null)
    : null
  return { nav, index: index && index.length > 30 ? index : null, indexLabel: bench?.label ?? null }
}
