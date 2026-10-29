import { desc, eq, inArray, sql } from 'drizzle-orm'
import {
  benchmarkFor,
  computeFundMetrics,
  FUND_FIELDS,
  inrReturn,
  missingIndexFigures,
  monthEnds,
  riskFreeFor,
  NO_METRICS,
  type FundChartData,
  type FundDetail,
  type FundField,
  type FundMetrics,
  type FundRow,
  type FundScreenData,
  type Benchmark,
  type FundMarket,
  type FundScreenStatus,
  type PricePt
} from '@shared/fundScreener'
import { baseCurrency, globalProfile, issuerRank } from '@shared/globalEtfs'
import { fundRank, fundScorecard } from '@shared/fundScorecard'
import { allocOf, globalPeriods, sebiTarget, type PortfolioSnapshot, type PortfolioView } from '@shared/fundPortfolio'
import type { SchemeFacts } from '@shared/insights'
import { schema, type Db } from '../db'
import { factsFor, storedSchemeFacts } from '../market/amfiData'
import { FOLLOWED_KEY, HISTORY_MONTHS } from '../market/disclosures'
import { fetchNavAll, mfapiHistory, type AmfiScheme } from '../market/funds'
import type { FetchFn } from '../market/http'
import { yahooAdjusted, YahooSession } from '../market/yahoo'
import { addGlobalEtf, fetchNport, isGlobal, portfolioSnapshots, refreshGlobal, savePortfolioSnapshot, storedGlobal, yahooSnapshot } from './global'
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
  /** Absent for Indian funds saved before global ETFs came in (India, a mutual fund, in rupees). */
  market?: FundMarket
  vehicle?: 'MF' | 'ETF'
  ticker?: string | null
  exchange?: string | null
  currency?: string
  leveraged?: boolean
  /** Global ETFs: net assets in dollars and expense ratio (% a year), from Yahoo's screener. */
  assetsUsd?: number | null
  ter?: number | null
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

/**
 * Open-ended Direct plans with the growth option, one line per fund, and the ETFs listed in India
 * (which have no Direct or Regular plan).
 */
export function universeFrom(navs: AmfiScheme[]): UniverseFund[] {
  const out: UniverseFund[] = []
  for (const s of navs) {
    const c = categoryOf(s.category)
    if (!c.open) continue
    const label = [s.name, s.plan, s.option].filter(Boolean).join(' ')
    if (/idcw|dividend|bonus|payout|reinvest/i.test(label)) continue
    const etf = /\betf/i.test(c.category) || /\betf\b|\bbees\b/i.test(s.name)
    if (!etf && !/direct/i.test(label)) continue
    out.push({
      code: s.code,
      name: s.name.replace(/\s*-\s*(direct|growth|plan|option)[\w\s-]*$/i, '').trim() || s.name,
      fundHouse: s.fundHouse,
      category: c.category,
      group: c.group,
      isin: s.isinGrowth,
      nav: s.nav || null,
      navDate: s.date || null,
      ...(etf ? { vehicle: 'ETF' as const } : {})
    })
  }
  return out
}

// Parsed once until the stored list changes.
let universeCache: { raw: string; value: { at: string | null; funds: UniverseFund[] } } | null = null

/** India's funds and ETFs from AMFI's NAV file. */
export function storedIndia(db: Db): { at: string | null; funds: UniverseFund[] } {
  const v = getSetting(db, UNIVERSE_KEY)
  if (!v) return { at: null, funds: [] }
  if (universeCache?.raw !== v) universeCache = { raw: v, value: JSON.parse(v) as { at: string; funds: UniverseFund[] } }
  return universeCache.value
}

let mergedCache: { india: UniverseFund[]; global: UniverseFund[]; value: { at: string | null; funds: UniverseFund[] } } | null = null

/** Every fund the screener knows: India's, then the US and UCITS ETFs. */
export function storedUniverse(db: Db): { at: string | null; funds: UniverseFund[] } {
  const india = storedIndia(db)
  const global = storedGlobal(db).funds
  if (mergedCache?.india !== india.funds || mergedCache.global !== global) mergedCache = { india: india.funds, global, value: { at: india.at, funds: [...india.funds, ...global] } }
  return mergedCache.value
}

/** Funds the family holds, by ISIN and AMFI code, and global ETFs by ticker. */
function heldFunds(db: Db): { isins: Set<string>; codes: Set<string>; tickers: Set<string> } {
  // Units actually held (a followed fund has a record but no units).
  const ids = new Set(listHoldings(db).filter((h) => (h.assetClass === 'MF' || h.assetClass === 'ETF') && h.quantity > 0).map((h) => h.instrumentId))
  if (ids.size === 0) return { isins: new Set(), codes: new Set(), tickers: new Set() }
  const rows = db
    .select({ isin: schema.instruments.isin, code: schema.instruments.amfiCode, us: schema.instruments.tickerUs, yahoo: schema.instruments.yahooSymbol })
    .from(schema.instruments)
    .where(inArray(schema.instruments.id, [...ids]))
    .all()
  const some = (xs: (string | null)[]) => new Set(xs.filter((x): x is string => !!x))
  return { isins: some(rows.map((r) => r.isin)), codes: some(rows.map((r) => r.code)), tickers: some(rows.flatMap((r) => [r.us, r.yahoo])) }
}

function storedIndex(db: Db, symbol: string): { at: string; points: PricePt[] } | null {
  const v = getSetting(db, INDEX_KEY(symbol))
  return v ? (JSON.parse(v) as { at: string; points: PricePt[] }) : null
}

export function saveStats(db: Db, code: string, metrics: FundMetrics | null, months: PricePt[], index: string | null, error: string | null): void {
  const v = { metricsJson: metrics ? JSON.stringify(metrics) : null, monthsJson: JSON.stringify(months), indexSymbol: index, computedAt: new Date().toISOString(), error }
  db.insert(schema.fundStats).values({ code, ...v }).onConflictDoUpdate({ target: schema.fundStats.code, set: v }).run()
}

/** The index a fund's ratios are measured against: by AMFI category for India, by name for global ETFs. */
export function benchFor(u: UniverseFund): Benchmark | null {
  if (u.market === 'US' || u.market === 'UCITS') {
    const bench = globalProfile(u.name, u.market, u.currency ?? 'USD').bench
    // A fund measured against itself shows a tracking error of zero and a beta of one, which says
    // nothing: another fund tracking the same index stands in, or none where there is no second
    // dollar line.
    if (bench && u.ticker && bench.symbol.toUpperCase() === u.ticker.toUpperCase()) {
      const other = SAME_INDEX[bench.symbol.toUpperCase()]
      return other ? { symbol: other, label: `${bench.label.replace(/ \(via [^)]+\)$/, '')} (via ${other})` } : null
    }
    return bench
  }
  return benchmarkFor(u.category, u.name)
}

/** The London dollar ETFs used as indices, and a second dollar ETF on the same index for each to be measured against. */
const SAME_INDEX: Record<string, string> = { 'CSPX.L': 'VUAA.L', 'CNDX.L': 'EQQU.L', 'IWDA.L': 'XDWD.L' }

// The rows are rebuilt only when the funds, the facts, the stats or the holdings change.
let rowsCache: { key: string; funds: UniverseFund[]; facts: SchemeFacts[]; rows: FundRow[] } | null = null

function rowsOf(db: Db, facts: SchemeFacts[]): FundRow[] {
  const held = heldFunds(db)
  const funds = storedUniverse(db).funds
  const usdInr = storedGlobal(db).usdInr
  const sig = db.select({ n: sql<number>`count(*)`, at: sql<string>`max(${schema.fundStats.computedAt})` }).from(schema.fundStats).get()
  const key = `${sig?.n}|${sig?.at}|${[...held.isins, ...held.codes, ...held.tickers].sort().join(',')}`
  if (rowsCache && rowsCache.key === key && rowsCache.funds === funds && rowsCache.facts === facts) return rowsCache.rows
  const stats = new Map(db.select().from(schema.fundStats).all().map((s) => [s.code, s]))
  const rows = funds.map((u): FundRow => {
    const india = !u.market || u.market === 'IN'
    const f = india ? factsFor(facts, u.name) : null
    const s = stats.get(u.code)
    const stored = s?.metricsJson ? (JSON.parse(s.metricsJson) as FundMetrics & { lastPrice?: number; lastDate?: string }) : null
    const { lastPrice, lastDate, ...rest } = stored ?? {}
    const metrics: FundMetrics = stored ? { ...NO_METRICS, ...rest } : NO_METRICS
    // AMFI's NAV file names categories one way throughout ("Mid Cap Fund"); its performance page another.
    const bench = benchFor(u)
    const currency = u.currency ?? 'INR'
    return {
      ...metrics,
      ret1yInr: metrics.ret1yInr ?? (currency === 'INR' ? metrics.ret1y : null),
      code: u.code,
      name: u.name,
      fundHouse: u.fundHouse,
      category: u.category,
      group: u.group,
      isin: u.isin,
      nav: india ? u.nav : (lastPrice ?? null),
      navDate: india ? u.navDate : (lastDate ?? null),
      // Abroad: Yahoo's net assets in dollars, at the dollar's rate when the list was read, in ₹ crore.
      aumCr: india ? (f?.aumCr ?? null) : u.assetsUsd && usdInr ? (u.assetsUsd * usdInr) / 1e7 : null,
      ter: india ? (f?.terDirect ?? null) : (u.ter ?? null),
      risk: f?.risk ?? null,
      benchmark: f?.benchmark ?? null,
      index: bench?.label ?? null,
      held: (!!u.isin && held.isins.has(u.isin)) || held.codes.has(u.code) || (!!u.ticker && held.tickers.has(u.ticker)),
      statsAt: s?.computedAt ?? null,
      market: u.market ?? 'IN',
      vehicle: u.vehicle ?? 'MF',
      ticker: u.ticker ?? null,
      exchange: u.exchange ?? null,
      currency,
      leveraged: u.leveraged ?? false
    }
  })
  rowsCache = { key, funds, facts, rows }
  return rows
}

export class FundScreenSync {
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private current: string | null = null
  private lastError: string | null = null
  private globalError: string | null = null

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
    return { enabled: this.enabled(), funds: funds.length, measured: funds.filter((u) => fresh.has(u.code)).length, running: this.running !== null, current: this.current, lastError: this.lastError ?? this.globalError }
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

  /** AMFI's NAV file for India's funds, and the US and UCITS ETF lists, weekly. */
  private async universe(): Promise<void> {
    await this.indiaUniverse()
    await this.globalUniverse()
  }

  private async indiaUniverse(): Promise<void> {
    const u = storedIndia(this.db)
    if (!(u.at && Date.now() - Date.parse(u.at) < WEEK && u.funds.length)) {
      this.current = 'the list of funds'
      const funds = universeFrom(await fetchNavAll(this.f))
      if (funds.length < 100) throw new Error('AMFI’s NAV file had too few funds')
      setSetting(this.db, UNIVERSE_KEY, JSON.stringify({ at: new Date().toISOString(), funds }))
      this.onUpdate()
    }
  }

  /** Yahoo's lists of US and UCITS ETFs (one refresh at a time). */
  private globalRun: Promise<void> | null = null
  private globalUniverse(): Promise<void> {
    this.globalRun ??= this.refreshGlobalList().finally(() => (this.globalRun = null))
    return this.globalRun
  }
  private async refreshGlobalList(): Promise<void> {
    try {
      this.current = 'the list of US and UCITS ETFs'
      this.yahoo ??= new YahooSession(this.f)
      if (await refreshGlobal(this.db, this.f, this.yahoo, this.gapMs)) this.onUpdate()
      this.globalError = null
    } catch (e) {
      // India's funds go on; the global list is tried again on the next pass.
      this.globalError = `The US ETF list: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  /**
   * An index's (or currency's) five years of daily closes from Yahoo, adjusted for dividends where
   * it is an ETF, kept for a day. A failed or near-empty answer is tried once more, then falls back
   * to the last good copy; a failure is remembered for ten minutes so the backlog doesn't ask Yahoo
   * again for every fund.
   */
  private failedIndex = new Map<string, number>()
  private async index(symbol: string): Promise<PricePt[] | null> {
    const s = storedIndex(this.db, symbol)
    if (s && Date.now() - Date.parse(s.at) < 86400_000) return s.points
    if (Date.now() - (this.failedIndex.get(symbol) ?? 0) < 10 * 60_000) return s?.points ?? null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const points = (await yahooAdjusted(symbol, '5y', this.f)).prices
        if (points.length > 100) {
          setSetting(this.db, INDEX_KEY(symbol), JSON.stringify({ at: new Date().toISOString(), points }))
          this.failedIndex.delete(symbol)
          return points
        }
      } catch {
        // tried again below
      }
      if (attempt === 0 && this.gapMs > 0) await new Promise((res) => setTimeout(res, 2000))
    }
    this.failedIndex.set(symbol, Date.now())
    return s?.points ?? null
  }

  /**
   * Whether a fund's page should measure it first: never measured, or its stored ratios lack the
   * index figures they should have (asked again at most every ten minutes).
   */
  needsMeasure(code: string): boolean {
    const s = this.db.select().from(schema.fundStats).where(eq(schema.fundStats.code, code)).get()
    if (!s) return true
    if (Date.now() - Date.parse(s.computedAt) < 10 * 60_000) return false
    const u = storedUniverse(this.db).funds.find((f) => f.code === code)
    return !!u && missingIndexFigures(s.metricsJson ? (JSON.parse(s.metricsJson) as FundMetrics) : null, s.indexSymbol, benchFor(u))
  }

  /** One fund's prices and ratios: mfapi NAVs for India, Yahoo's adjusted closes for global ETFs. */
  private async measureOne(r: FundRow): Promise<void> {
    const u: UniverseFund = r
    const bench = benchFor(u)
    try {
      let nav: PricePt[]
      let extra: { lastPrice?: number; lastDate?: string; ret1yInr?: number | null } = {}
      if (r.market === 'IN') {
        const since = new Date(Date.now() - (5 * 365 + 30) * 86400_000).toISOString().slice(0, 10)
        nav = await mfapiHistory(r.code, since, this.f)
      } else {
        nav = (await yahooAdjusted(r.ticker!, '5y', this.f)).prices
        const last = nav.at(-1)
        if (last) extra = { lastPrice: last.close, lastDate: last.date }
      }
      const index = bench ? await this.index(bench.symbol) : null
      const m = computeFundMetrics(nav, index, riskFreeFor(baseCurrency(r.currency)))
      if (r.market !== 'IN' && m.ret1y !== null) {
        const fx = await this.index(`${baseCurrency(r.currency)}INR=X`)
        extra.ret1yInr = inrReturn(m.ret1y, fx)
      }
      saveStats(this.db, r.code, { ...m, ...extra } as FundMetrics, monthEnds(nav), bench?.symbol ?? null, null)
    } catch (e) {
      saveStats(this.db, r.code, null, [], bench?.symbol ?? null, e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Each fund's ratios, a week old being fresh enough: held funds first, then India's biggest, then
   * UCITS ETFs and the US ones, biggest first. Yahoo is asked a little less often than mfapi.
   */
  private async measure(): Promise<void> {
    const facts = storedSchemeFacts(this.db).schemes
    const stats = new Map(this.db.select().from(schema.fundStats).all().map((s) => [s.code, s]))
    const rows = rowsOf(this.db, facts)
    const follow = new Set(followed(this.db))
    const isDue = (r: FundRow) => {
      const s = stats.get(r.code)
      if (!s) return true
      const age = Date.now() - Date.parse(s.computedAt)
      if (age >= WEEK) return true
      // Ratios saved without their index (Yahoo failed, or the index changed): again after six hours.
      return age >= 6 * 3600_000 && missingIndexFigures(s.metricsJson ? (JSON.parse(s.metricsJson) as FundMetrics) : null, s.indexSymbol, benchFor(r))
    }
    const tier = (r: FundRow) => (r.held || follow.has(r.code) ? 0 : r.market === 'IN' ? 1 : r.market === 'UCITS' ? 2 : 3)
    const due = rows
      .filter(isDue)
      .sort((a, b) => tier(a) - tier(b) || (b.aumCr ?? 0) - (a.aumCr ?? 0) || issuerRank(a.name) - issuerRank(b.name) || Number(a.leveraged) - Number(b.leveraged))
    let n = 0
    for (const r of due) {
      if (!this.enabled()) return
      this.current = r.ticker ? `${r.name} (${r.ticker})` : r.name
      await this.measureOne(r)
      if (++n % 20 === 0) this.onUpdate()
      await new Promise((res) => setTimeout(res, r.market === 'IN' ? this.gapMs : Math.round((this.gapMs * 4) / 3)))
    }
  }

  /** One fund now (its page was opened), whether or not the backlog has reached it. */
  async measureNow(code: string): Promise<void> {
    // A fund page opened before the screener ever was: India's list first (one AMFI file).
    if (!isGlobal(code) && !storedIndia(this.db).funds.length) await this.indiaUniverse()
    const r = rowsOf(this.db, storedSchemeFacts(this.db).schemes).find((x) => x.code === code)
    if (r) await this.measureOne(r)
  }

  private yahoo: YahooSession | null = null

  /**
   * A global ETF's portfolio for its page: Yahoo's summary of top holdings and sectors once a month,
   * and for US ETFs the latest N-PORT filing once its quarter is out (when an SEC contact is set).
   */
  async refreshPortfolio(code: string): Promise<void> {
    const u = storedUniverse(this.db).funds.find((f) => f.code === code)
    if (!u?.ticker || !isGlobal(code)) return
    const snaps = portfolioSnapshots(this.db, code)
    const month = new Date().toISOString().slice(0, 7)
    if (!snaps.some((s) => s.source === 'YAHOO' && s.asOf.startsWith(month))) {
      try {
        this.yahoo ??= new YahooSession(this.f)
        const fund = await this.yahoo.fund(u.ticker)
        if (fund) savePortfolioSnapshot(this.db, code, yahooSnapshot(fund, new Date().toISOString().slice(0, 10)))
      } catch {
        // Kept for next time; the page shows what is stored.
      }
    }
    const lastN = snaps.filter((s) => s.source === 'NPORT').at(-1)
    // N-PORT comes 60 days after each quarter end; look again a month after the last one's date plus a quarter.
    const dueN = u.market === 'US' && (!lastN || Date.now() - Date.parse(lastN.asOf) > 150 * 86400_000)
    const triedKey = `funds:nport-tried:${code}`
    const tried = getSetting(this.db, triedKey)
    if (dueN && (!tried || Date.now() - Date.parse(tried) > 7 * 86400_000)) {
      setSetting(this.db, triedKey, new Date().toISOString())
      try {
        const snap = await fetchNport(this.db, u.ticker, this.f)
        if (snap) savePortfolioSnapshot(this.db, code, snap)
      } catch {
        // The SEC was unreachable or the filing unreadable; tried again in a week.
      }
    }
  }

  /** Adds an ETF by ticker, ISIN or name and measures it at once. */
  async addEtf(query: string): Promise<string> {
    const code = await addGlobalEtf(this.db, query, this.f)
    await this.measureNow(code).catch(() => null)
    this.onUpdate()
    return code
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
  // A global ETF needs no record: following it only puts it first in the queue.
  if (isGlobal(code)) {
    if (on) list.push(code)
    setSetting(db, FOLLOWED_KEY, JSON.stringify(list))
    return
  }
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

  // Compared within its own market: India's funds with India's, US ETFs with US ETFs.
  const market = rows.filter((r) => r.market === row.market && (row.leveraged || !r.leveraged))
  const peers = market.filter((r) => r.category === row.category && r.statsAt)
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
  const global = isGlobal(code)
  const all = global
    ? []
    : ids.length
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

  // Month by month: each holding's share of the fund over the stored months (the latest file of
  // each month), so a stock going from 4% in September to 2% in October shows as it happened.
  const byMonth = new Map<string, string>()
  for (const p of [...periods].reverse()) byMonth.set(p.slice(0, 7), p)
  const monthDates = [...byMonth.values()].slice(-HISTORY_MONTHS)
  const history =
    monthDates.length > 1
      ? (() => {
          const at = monthDates.map((p) => new Map<string, (typeof all)[number]>(all.filter((h) => h.asOf === p).map((h) => [key(h), h])))
          const keys = new Set(at.flatMap((m) => [...m.keys()]))
          const last = at[at.length - 1]
          const rows = [...keys]
            .map((k) => {
              const any = at.map((m) => m.get(k)).find(Boolean)!
              const weights = at.map((m) => m.get(k)?.weight ?? null)
              return { name: last.get(k)?.name ?? any.name, isin: any.isin, sector: any.sector, assetType: any.assetType, weights }
            })
            // Held now, largest first; then those sold out along the way, by the most they ever held.
            .sort((a, b) => (b.weights.at(-1) ?? -1) - (a.weights.at(-1) ?? -1) || Math.max(...b.weights.map((w) => w ?? 0)) - Math.max(...a.weights.map((w) => w ?? 0)))
            .filter((r) => r.weights.some((w) => (w ?? 0) >= 0.001))
          const sectorNames = new Set<string>()
          const perMonth = at.map((m) => {
            const s = new Map<string, number>()
            for (const h of m.values())
              if (h.assetType === 'EQUITY') {
                const name = h.sector ?? 'Other'
                sectorNames.add(name)
                s.set(name, (s.get(name) ?? 0) + h.weight)
              }
            return s
          })
          const sectorRows = [...sectorNames]
            .map((sector) => ({ sector, weights: perMonth.map((s) => s.get(sector) ?? 0) }))
            .sort((a, b) => b.weights.at(-1)! - a.weights.at(-1)!)
          return { months: monthDates, rows, sectors: sectorRows }
        })()
      : null
  // Global ETFs: the stored snapshots (N-PORT where there are any, else Yahoo's summaries).
  const snaps = global ? portfolioSnapshots(db, code) : []
  const nport = snaps.filter((x) => x.source === 'NPORT')
  // Holdings and allocation from N-PORT where there is a filing; its sectors (it has none) from Yahoo's summaries.
  const merged = globalPeriods(snaps)
  const chosen = merged.holdings
  const gHoldings = global ? globalHoldings(chosen) : null
  if (gHoldings) {
    const withSectors = merged.periods.filter((p) => p.sectors.length)
    const cur = withSectors.at(-1)
    const before = withSectors.at(-2)
    if (cur && !gHoldings.sectors.length) {
      const prev = new Map((before?.sectors ?? []).map((s) => [s.sector, s.weight]))
      gHoldings.sectors = cur.sectors.map((s) => ({ sector: s.sector, weight: s.weight, change: before ? s.weight - (prev.get(s.sector) ?? 0) : null }))
    }
  }

  const bench = benchFor(row)
  const portfolio: PortfolioView | null = global
    ? chosen.length
      ? {
          periods: merged.periods,
          target: null,
          source: nport.length
            ? 'Quarterly N-PORT filings with the SEC (allocation and holdings) and Yahoo Finance’s fund summary, read once a month (sectors, which the filings don’t carry)'
            : 'Yahoo Finance’s fund summary, read once a month'
        }
      : null
    : periods.length
      ? {
          periods: (monthDates.length ? monthDates : [periods[0]]).map((p) => {
            const list = all.filter((h) => h.asOf === p)
            const sec = bySector(list)
            return { asOf: p, alloc: allocOf(list), sectors: [...sec].sort((a, b) => b[1] - a[1]).map(([sector, weight]) => ({ sector, weight })) }
          }),
          target: sebiTarget(row.category, !!bench),
          source: 'The fund house’s monthly portfolio files'
        }
      : null

  if (gHoldings)
    return {
      history: gHoldings.history,
      row,
      growth,
      categoryAvg,
      categoryCount: peers.length,
      holdings: gHoldings.holdings,
      sectors: gHoldings.sectors,
      assetMix: gHoldings.assetMix,
      holdingsNote: gHoldings.holdings ? null : row.market === 'US' ? 'Holdings come from Yahoo Finance’s fund summary and the ETF’s quarterly N-PORT filing with the SEC; they are fetched when the page opens.' : 'Top holdings come from Yahoo Finance’s fund summary; they are fetched when the page opens.',
      followed: followed(db).includes(code),
      scorecard: fundScorecard(row, market),
      rank: fundRank(row, market),
      similar: similarTo(row, market),
      portfolio
    }

  return {
    portfolio,
    history,
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
    followed: followed(db).includes(code),
    scorecard: fundScorecard(row, market),
    rank: fundRank(row, market),
    similar: similarTo(row, market)
  }
}

function similarTo(row: FundRow, rows: FundRow[]): FundRow[] {
  return rows
    .filter((r) => r.category === row.category && r.code !== row.code)
    .sort((a, b) => Number(!!b.statsAt) - Number(!!a.statsAt) || (b.aumCr ?? 0) - (a.aumCr ?? 0) || issuerRank(a.name) - issuerRank(b.name))
    .slice(0, 4)
}

/** A global ETF's holdings in the fund page's shape, from its snapshots (oldest first). */
function globalHoldings(snaps: PortfolioSnapshot[]): Pick<FundDetail, 'holdings' | 'history' | 'sectors' | 'assetMix'> {
  const last = snaps.at(-1)
  if (!last) return { holdings: null, history: null, sectors: [], assetMix: [] }
  const prev = snaps.at(-2) ?? null
  const key = (h: { isin: string | null; name: string }) => h.isin ?? h.name.toLowerCase()
  const prevBy = new Map((prev?.holdings ?? []).map((h) => [key(h), h.weight]))
  const nowKeys = new Set(last.holdings.map(key))
  const prevSec = new Map((prev?.sectors ?? []).map((s) => [s.sector, s.weight]))
  const recent = snaps.slice(-HISTORY_MONTHS)
  const history =
    recent.length > 1
      ? (() => {
          const at = recent.map((x) => new Map(x.holdings.map((h) => [key(h), h])))
          const keys = [...new Set(at.flatMap((m) => [...m.keys()]))]
          const rows = keys
            .map((k) => {
              const any = at.map((m) => m.get(k)).find(Boolean)!
              return { name: any.name, isin: any.isin, sector: any.sector, assetType: any.assetType, weights: at.map((m) => m.get(k)?.weight ?? null) }
            })
            .sort((a, b) => (b.weights.at(-1) ?? -1) - (a.weights.at(-1) ?? -1))
            .filter((r) => r.weights.some((w) => (w ?? 0) >= 0.001))
          const names = [...new Set(recent.flatMap((x) => x.sectors.map((s) => s.sector)))]
          const sectors = names
            .map((sector) => ({ sector, weights: recent.map((x) => x.sectors.find((s) => s.sector === sector)?.weight ?? 0) }))
            .sort((a, b) => b.weights.at(-1)! - a.weights.at(-1)!)
          return { months: recent.map((x) => x.asOf), rows, sectors }
        })()
      : null
  return {
    holdings: {
      asOf: last.asOf,
      prevAsOf: prev?.asOf ?? null,
      rows: last.holdings.map((h) => ({ name: h.name, isin: h.isin, sector: h.sector ?? (h.country && h.country !== 'US' ? h.country : null), assetType: h.assetType, weight: h.weight, change: prev ? (prevBy.has(key(h)) ? h.weight - prevBy.get(key(h))! : null) : 0 })),
      exited: (prev?.holdings ?? []).filter((h) => !nowKeys.has(key(h)) && h.weight >= 0.002).map((h) => ({ name: h.name, weight: h.weight }))
    },
    history,
    sectors: last.sectors.map((s) => ({ sector: s.sector, weight: s.weight, change: prev ? s.weight - (prevSec.get(s.sector) ?? 0) : null })),
    assetMix: last.alloc.map((a) => ({ type: a.label === 'Cash & equivalents' ? 'CASH' : a.label.toUpperCase(), weight: a.weight }))
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

/** Yahoo's adjusted daily closes for ten years, and whatever it has before that (it can thin out to monthly). */
async function dailyAndOlder(symbol: string, f: FetchFn): Promise<PricePt[]> {
  const daily = (await yahooAdjusted(symbol, '10y', f)).prices
  const older = daily.length ? (await yahooAdjusted(symbol, 'max', f).catch(() => ({ prices: [] as PricePt[] }))).prices.filter((p) => p.date < daily[0].date) : []
  return [...older, ...daily]
}

/** A fund's NAV since it started, and its index's (from Yahoo, as far back as it goes). */
export async function fundChart(db: Db, code: string, f: FetchFn = fetch): Promise<FundChartData | null> {
  const u = storedUniverse(db).funds.find((x) => x.code === code)
  if (!u) return null
  const bench = benchFor(u)
  const nav = await cached(`nav:${code}`, () => (isGlobal(code) ? dailyAndOlder(u.ticker!, f) : mfapiHistory(code, '1990-01-01', f)))
  const index = bench ? await cached(`idx:${bench.symbol}`, () => dailyAndOlder(bench.symbol, f)).catch(() => null) : null
  return { nav, index: index && index.length > 30 ? index : null, indexLabel: bench?.label ?? null }
}
