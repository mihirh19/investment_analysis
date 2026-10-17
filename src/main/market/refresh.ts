import { and, eq, inArray, max } from 'drizzle-orm'
import type { MarketSourceStatus, MarketStatus } from '@shared/types'
import { schema, type Db } from '../db'
import { listHoldings } from '../portfolio/holdings'
import {
  fetchNavAll,
  fetchNseListings,
  fetchNseIndustries,
  matchNpsScheme,
  mfapiLatest,
  npsLatest,
  npsSchemes,
  type AmfiScheme
} from './funds'
import { mapLimit, type FetchFn } from './http'
import { refreshCrypto, refreshHistory, refreshMetals } from './extra'
import { refreshBenchmarks, refreshDaily } from './benchmarks'
import { refreshGrandfathering } from './grandfather'
import { refreshDirectPlans } from './directPlans'
import { refreshMarketCaps } from './marketcap'
import { refreshResidex, storedResidexCities } from './residex'

const HOUSING_KEY = 'residex:lastFetch'

/** Cities of the properties on record. */
function propertyCities(db: Db): number[] {
  const ids: number[] = []
  for (const a of db.select({ metaJson: schema.accounts.metaJson }).from(schema.accounts).all()) {
    try {
      const m = JSON.parse(a.metaJson ?? 'null')?.meta
      if (m?.kind === 'PROPERTY' && m.cityId) ids.push(Number(m.cityId))
    } catch {
      /* not a hand-kept asset */
    }
  }
  return ids
}
import { reclassifyDemat, tidyListedNames } from '../importers/isin'
import { syncDisclosures, type DisclosureDeps } from './disclosures'
import { fromIndustryText, fromNseIndustry, fromYahoo } from './sectors'
import { yahooDividends, yahooHistory, yahooProfile, yahooQuote, yahooSymbolForIsin, YahooSession } from './yahoo'

/** Classes traded on NSE/BSE with a Yahoo symbol: shares, ETFs, REIT and InvIT units. */
const LISTED_IN: string[] = ['EQUITY_IN', 'ETF', 'REIT']

/** A quote more than a week old: Yahoo has stopped updating that listing (e.g. MINDSPACE.NS since 2024). */
const isStale = (asOf: string) => Date.now() - Date.parse(asOf) > 7 * 86400000

type Instrument = typeof schema.instruments.$inferSelect
type SourceKey =
  | 'stocks'
  | 'fx'
  | 'metals'
  | 'crypto'
  | 'funds'
  | 'nps'
  | 'sectors'
  | 'dividends'
  | 'history'
  | 'benchmarks'
  | 'daily'
  | 'fmv2018'
  | 'direct'
  | 'disclosures'
  | 'caps'
  | 'housing'

const SOURCE_LABELS: Record<SourceKey, string> = {
  stocks: 'Stock & ETF prices (Yahoo Finance)',
  fx: 'USD → INR rate (Yahoo Finance)',
  metals: 'Gold & silver (COMEX via Yahoo Finance)',
  crypto: 'Crypto (Yahoo Finance, CoinGecko)',
  funds: 'Mutual fund NAVs (mfapi.in / AMFI)',
  nps: 'NPS NAVs (npsnav.in)',
  sectors: 'Sectors (NSE, Yahoo Finance)',
  dividends: 'Dividend history (Yahoo Finance)',
  history: 'Price history for charts (all of the above)',
  benchmarks: 'Benchmarks: Nifty 50 / 500 / Midcap 150, S&P 500, liquid fund',
  daily: 'Daily closes, last year (risk figures)',
  fmv2018: 'Prices on 31 Jan 2018 (tax on older shares and funds)',
  direct: 'Direct-plan NAVs (what Regular plans cost you)',
  disclosures: 'Fund portfolios (fund house monthly disclosures)',
  caps: 'Large, mid & small cap bands (AMFI)',
  housing: 'Home prices (NHB RESIDEX)'
}

const MINUTE = 60_000
const nowIso = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)

/** Weekday trading hours in the exchange's own time zone (holidays are not modelled). */
export function isMarketOpen(market: 'NSE' | 'US', at = new Date()): boolean {
  const tz = market === 'NSE' ? 'Asia/Kolkata' : 'America/New_York'
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  return market === 'NSE'
    ? minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30
    : minutes >= 9 * 60 + 30 && minutes <= 16 * 60
}

export class MarketData {
  private status = new Map<SourceKey, MarketSourceStatus>()
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private last = { quotes: 0, funds: 0, meta: 0 }
  private yahoo: YahooSession

  constructor(
    private readonly db: Db,
    private readonly onUpdate: () => void = () => {},
    private readonly f: FetchFn = fetch,
    private readonly opts: { renderLinks?: DisclosureDeps['renderLinks'] } = {}
  ) {
    this.yahoo = new YahooSession(f)
    for (const k of Object.keys(SOURCE_LABELS) as SourceKey[]) {
      this.status.set(k, { key: k, label: SOURCE_LABELS[k], lastSuccess: null, lastError: null, failed: [] })
    }
  }

  getStatus(): MarketStatus {
    const latest =
      this.db
        .select({ at: max(schema.quotes.fetchedAt) })
        .from(schema.quotes)
        .get()?.at ?? null
    return {
      lastRefresh: latest,
      refreshing: this.running !== null,
      nseOpen: isMarketOpen('NSE'),
      usOpen: isMarketOpen('US'),
      sources: [...this.status.values()]
    }
  }

  /** Starts the background schedule: prices every minute while a market is open, slower otherwise. */
  start(): void {
    void this.refresh({ full: true })
    this.timer = setInterval(() => void this.tick(), 30_000)
  }

  /** Re-checks fund house disclosures now (force re-downloads even if the month is stored). */
  async syncDisclosures(force = false): Promise<void> {
    await this.guard('disclosures', () =>
      syncDisclosures(this.db, { fetch: this.f, renderLinks: this.opts.renderLinks }, force)
    )
    this.onUpdate()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    const open = isMarketOpen('NSE') || isMarketOpen('US')
    const quotesDue = now - this.last.quotes >= (open ? MINUTE : 30 * MINUTE)
    const fundsDue = now - this.last.funds >= 120 * MINUTE
    const metaDue = now - this.last.meta >= 24 * 60 * MINUTE
    if (quotesDue || fundsDue || metaDue) await this.refresh({ quotes: quotesDue, funds: fundsDue, meta: metaDue })
  }

  /** Refreshes the requested groups; concurrent calls share one run. */
  refresh(what: { full?: boolean; quotes?: boolean; funds?: boolean; meta?: boolean } = { full: true }): Promise<void> {
    if (this.running) return this.running
    const doQuotes = what.full || what.quotes
    const doFunds = what.full || what.funds
    const doMeta = what.full || what.meta
    this.running = (async () => {
      try {
        const held = this.heldInstruments()
        // On a fresh install, load NSE's list before the first prices so renamed tickers resolve at once.
        if (doQuotes && doMeta) {
          await Promise.all([this.ensureNseList().catch(() => {}), this.ensureListings().catch(() => {})])
        }
        if (doQuotes) {
          await Promise.all([this.refreshQuotes(held), this.refreshFx()])
          // Gold, silver and coins are priced in USD, so they follow the exchange rate.
          await Promise.all([
            this.guard('metals', () => refreshMetals(this.db, this.f)),
            this.guard('crypto', () => refreshCrypto(this.db, this.f))
          ])
          this.last.quotes = Date.now()
          this.onUpdate()
        }
        if (doFunds) {
          await Promise.all([this.refreshMutualFunds(held), this.refreshNps(held)])
          this.last.funds = Date.now()
          this.onUpdate()
        }
        if (doMeta) {
          await this.refreshSectors(held)
          await this.refreshDividends(held)
          await this.guard('history', () => refreshHistory(this.db, this.f))
          await this.guard('benchmarks', () => refreshBenchmarks(this.db, this.f))
          await this.guard('daily', () => refreshDaily(this.db, this.f))
          await this.guard('fmv2018', () => refreshGrandfathering(this.db, this.f))
          await this.guard('direct', () => refreshDirectPlans(this.db, this.f))
          await this.guard('housing', async () => {
            const cities = [...new Set([...propertyCities(this.db), ...storedResidexCities(this.db)])]
            const last = this.db.select().from(schema.settings).where(eq(schema.settings.key, HOUSING_KEY)).get()?.value
            if (cities.length === 0 || (last && Date.now() - Date.parse(last) < 7 * 86400000)) return
            await refreshResidex(this.db, cities, this.f)
            const at = nowIso()
            this.db
              .insert(schema.settings)
              .values({ key: HOUSING_KEY, value: at })
              .onConflictDoUpdate({ target: schema.settings.key, set: { value: at } })
              .run()
          })
          await this.guard('caps', async () => {
            if (!(await refreshMarketCaps(this.db, this.f))) throw new Error("AMFI's market-cap list could not be read")
          })
          await this.guard('disclosures', () =>
            syncDisclosures(this.db, { fetch: this.f, renderLinks: this.opts.renderLinks })
          )
          this.last.meta = Date.now()
          this.onUpdate()
        }
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private heldInstruments(): Instrument[] {
    const ids = [...new Set(listHoldings(this.db).map((h) => h.instrumentId))]
    if (ids.length === 0) return []
    return this.db.select().from(schema.instruments).where(inArray(schema.instruments.id, ids)).all()
  }

  /** The source answered; `failed` lists holdings it had nothing for (not an outage). */
  private ok(k: SourceKey, failed: string[] = []) {
    const s = this.status.get(k)!
    s.lastSuccess = nowIso()
    s.failed = failed
    s.lastError = null
  }
  /** Runs one source, recording success (with any items it had no data for) or failure. */
  private async guard(k: SourceKey, run: () => Promise<string[] | void>): Promise<void> {
    try {
      this.ok(k, (await run()) ?? [])
    } catch (e) {
      this.fail(k, e)
    }
  }

  private fail(k: SourceKey, e: unknown) {
    const s = this.status.get(k)!
    s.lastError = e instanceof Error ? e.message : String(e)
  }

  private saveQuote(
    instrumentId: number,
    q: { price: number; prevClose: number | null; currency: string; asOf: string },
    source: string
  ) {
    const row = {
      instrumentId,
      price: q.price,
      prevClose: q.prevClose,
      currency: q.currency,
      asOf: q.asOf,
      source,
      fetchedAt: nowIso()
    }
    this.db.insert(schema.quotes).values(row).onConflictDoUpdate({ target: schema.quotes.instrumentId, set: row }).run()
  }

  // ---------------- stocks, ETFs, US ----------------

  /**
   * Symbols to try, in order. NSE's current symbol for the ISIN comes right after the stored one,
   * so renames and demergers (e.g. TATAMOTORS → TMPV) resolve without the user doing anything.
   */
  private yahooCandidates(i: Instrument): string[] {
    if (i.assetClass === 'EQUITY_US') return [...new Set([i.yahooSymbol, i.tickerUs].filter((s): s is string => !!s))]
    if (!LISTED_IN.includes(i.assetClass)) return []
    // NSE's full listing covers every stock and ETF; the index list is a fallback for older data.
    const listed = i.isin
      ? (this.db.select().from(schema.nseListings).where(eq(schema.nseListings.isin, i.isin)).get()?.symbol ??
        this.db.select().from(schema.sectorMap).where(eq(schema.sectorMap.isin, i.isin)).get()?.symbol)
      : null
    const out = [
      i.yahooSymbol,
      i.symbolNse && `${i.symbolNse}.NS`,
      listed && `${listed}.NS`,
      i.symbolBse && `${i.symbolBse}.BO`
    ]
    return [...new Set(out.filter((s): s is string => !!s))]
  }

  async refreshQuotes(held: Instrument[]): Promise<void> {
    const targets = held.filter((i) => [...LISTED_IN, 'EQUITY_US'].includes(i.assetClass))
    if (targets.length === 0) return this.ok('stocks')
    try {
      const results = await mapLimit(targets, 4, async (i) => {
        let lastErr: Error | null = null
        // Held in an object: TypeScript does not see assignments made inside tryAll.
        const found: { best: { sym: string; q: Awaited<ReturnType<typeof yahooQuote>> } | null } = { best: null }
        const tried = new Set<string>()
        // First fresh quote wins; a series that stopped updating is kept only if nothing better turns up.
        const tryAll = async (syms: string[]) => {
          for (const sym of syms) {
            if (tried.has(sym)) continue
            tried.add(sym)
            try {
              const q = await yahooQuote(sym, this.f)
              if (!found.best || q.asOf > found.best.q.asOf) found.best = { sym, q }
              if (!isStale(q.asOf)) return
            } catch (e) {
              lastErr = e as Error
            }
          }
        }
        await tryAll(this.yahooCandidates(i))
        // Unknown ticker, or only a stale series: Yahoo's search accepts an ISIN.
        if ((!found.best || isStale(found.best.q.asOf)) && i.isin) {
          const searched = await yahooSymbolForIsin(i.isin, this.f).catch(() => null)
          // Search often returns only the BSE symbol (MINDSPACE.BO); the NSE one is tried as well.
          if (searched)
            await tryAll(searched.endsWith('.BO') ? [searched.replace(/\.BO$/, '.NS'), searched] : [searched])
        }
        if (!found.best) throw lastErr ?? new Error('no symbol')
        const { sym, q } = found.best
        this.saveQuote(i.id, q, 'YAHOO')
        if (i.yahooSymbol !== sym) {
          this.db.update(schema.instruments).set({ yahooSymbol: sym }).where(eq(schema.instruments.id, i.id)).run()
        }
      })
      const failed = results.filter((r) => !r.ok).map((r) => r.item.symbolNse ?? r.item.tickerUs ?? r.item.name)
      if (failed.length === targets.length) throw new Error(`Yahoo Finance returned no prices (${failed.length} tried)`)
      this.ok('stocks', failed)
    } catch (e) {
      this.fail('stocks', e)
    }
  }

  async refreshFx(): Promise<void> {
    try {
      const q = await yahooQuote('USDINR=X', this.f)
      const row = { pair: 'USDINR', rate: q.price, prevClose: q.prevClose, asOf: q.asOf, fetchedAt: nowIso() }
      this.db.insert(schema.fxRates).values(row).onConflictDoUpdate({ target: schema.fxRates.pair, set: row }).run()

      // Daily history for converting past US purchases at the rate on the day.
      const lastDate = this.db
        .select({ d: max(schema.fxHistory.date) })
        .from(schema.fxHistory)
        .where(eq(schema.fxHistory.pair, 'USDINR'))
        .get()?.d
      const stale = !lastDate || Date.now() - Date.parse(lastDate) > 3 * 86400000
      if (stale) {
        const { prices } = await yahooHistory('USDINR=X', lastDate ? '1mo' : '10y', this.f, '1d')
        this.db.transaction((tx) => {
          for (const p of prices) {
            tx.insert(schema.fxHistory)
              .values({ pair: 'USDINR', date: p.date, rate: p.close })
              .onConflictDoUpdate({ target: [schema.fxHistory.pair, schema.fxHistory.date], set: { rate: p.close } })
              .run()
          }
        })
      }
      this.ok('fx')
    } catch (e) {
      this.fail('fx', e)
    }
  }

  // ---------------- mutual funds ----------------

  async refreshMutualFunds(held: Instrument[]): Promise<void> {
    const funds = held.filter((i) => i.assetClass === 'MF')
    try {
      let navMap: Map<string, AmfiScheme> | null = null
      const byIsin = async () => {
        if (!navMap) {
          navMap = new Map()
          for (const s of await fetchNavAll(this.f)) {
            if (s.isinGrowth) navMap.set(s.isinGrowth, s)
            if (s.isinReinvest) navMap.set(s.isinReinvest, s)
          }
        }
        return navMap
      }

      // Fund house for every fund and ETF (finds its monthly portfolio disclosure), from AMFI's NAV file.
      // Also its current scheme name: statements can carry a name from before a rename.
      const needHouse = held.filter(
        (i) => (i.assetClass === 'MF' || i.assetClass === 'ETF') && i.isin && (!i.fundHouse || !i.schemeName)
      )
      const housed = new Set<number>()
      if (needHouse.length) {
        const map = await byIsin().catch(() => null)
        for (const i of needHouse) {
          const s = map?.get(i.isin!)
          if (!s) continue
          this.db
            .update(schema.instruments)
            .set({ fundHouse: i.fundHouse ?? s.fundHouse, schemeName: s.name })
            .where(eq(schema.instruments.id, i.id))
            .run()
          if (i.fundHouse || s.fundHouse) housed.add(i.id)
        }
      }

      // ETFs without a market price today (unlisted symbol, Yahoo gap) fall back to their NAV.
      const today = new Date().toISOString().slice(0, 10)
      const unpricedEtfs = held.filter((i) => {
        if (i.assetClass !== 'ETF' || !i.isin) return false
        const q = this.db.select().from(schema.quotes).where(eq(schema.quotes.instrumentId, i.id)).get()
        return !q || (q.source !== 'YAHOO' && q.asOf.slice(0, 10) < today)
      })
      if (unpricedEtfs.length) {
        const map = await byIsin().catch(() => null)
        for (const i of unpricedEtfs) {
          const s = map?.get(i.isin!)
          if (s)
            this.saveQuote(
              i.id,
              { price: s.nav, prevClose: null, currency: 'INR', asOf: `${s.date}T18:30:00.000Z` },
              'AMFI'
            )
        }
      }

      if (funds.length === 0) return this.ok('funds')

      const results = await mapLimit(funds, 4, async (i) => {
        let code = i.amfiCode
        if (!code && i.isin) {
          code = (await byIsin()).get(i.isin)?.code ?? null
          if (code)
            this.db.update(schema.instruments).set({ amfiCode: code }).where(eq(schema.instruments.id, i.id)).run()
        }
        if (!code) throw new Error('no AMFI code')
        const q = await mfapiLatest(code, this.f)
        this.saveQuote(
          i.id,
          { price: q.nav, prevClose: q.prevNav, currency: 'INR', asOf: `${q.date}T18:30:00.000Z` },
          'MFAPI'
        )
        // mfapi also names the fund house, for schemes AMFI's file did not cover.
        if (!i.fundHouse && !housed.has(i.id) && q.fundHouse)
          this.db
            .update(schema.instruments)
            .set({ fundHouse: q.fundHouse })
            .where(eq(schema.instruments.id, i.id))
            .run()
        if (q.category && q.category !== i.mfCategory) {
          this.db
            .update(schema.instruments)
            .set({ mfCategory: q.category })
            .where(eq(schema.instruments.id, i.id))
            .run()
        }
      })
      // mfapi can lag or miss a scheme; AMFI's full file is the fallback for the latest NAV.
      const missing = results.filter((r) => !r.ok).map((r) => r.item)
      const stillMissing: string[] = []
      if (missing.length) {
        const map = await byIsin().catch(() => new Map<string, AmfiScheme>())
        for (const i of missing) {
          const s = i.isin ? map.get(i.isin) : undefined
          if (s)
            this.saveQuote(
              i.id,
              { price: s.nav, prevClose: null, currency: 'INR', asOf: `${s.date}T18:30:00.000Z` },
              'AMFI'
            )
          else stillMissing.push(i.name)
        }
      }
      if (stillMissing.length === funds.length) throw new Error('No NAVs could be fetched')
      this.ok('funds', stillMissing)
    } catch (e) {
      this.fail('funds', e)
    }
  }

  async refreshNps(held: Instrument[]): Promise<void> {
    const schemes = held.filter((i) => i.assetClass === 'NPS')
    if (schemes.length === 0) return this.ok('nps')
    try {
      let list: { code: string; name: string }[] | null = null
      const results = await mapLimit(schemes, 3, async (i) => {
        let code = i.npsCode
        if (!code) {
          list ??= await npsSchemes(this.f)
          code = matchNpsScheme(i.name, list)
          if (code)
            this.db.update(schema.instruments).set({ npsCode: code }).where(eq(schema.instruments.id, i.id)).run()
        }
        if (!code) throw new Error('scheme not recognised')
        const q = await npsLatest(code, this.f)
        this.saveQuote(
          i.id,
          { price: q.nav, prevClose: q.prevNav, currency: 'INR', asOf: `${q.date}T18:30:00.000Z` },
          'NPSNAV'
        )
      })
      const failed = results.filter((r) => !r.ok).map((r) => r.item.name)
      if (failed.length === schemes.length) throw new Error(`No NPS NAVs found (${failed.join(', ')})`)
      this.ok('nps', failed)
    } catch (e) {
      this.fail('nps', e)
    }
  }

  // ---------------- sectors and fund look-through ----------------

  /** NSE's ISIN → symbol/industry list, refreshed weekly. Also used to follow renamed tickers. */
  /** NSE's full stock and ETF listing by ISIN, refreshed weekly. */
  private async ensureListings(): Promise<void> {
    const age = this.db
      .select({ at: max(schema.nseListings.updatedAt) })
      .from(schema.nseListings)
      .get()?.at
    if (age && Date.now() - Date.parse(age) < 7 * 86400000) return
    const rows = await fetchNseListings(this.f)
    if (rows.length < 500) return
    const at = nowIso()
    this.db.transaction((tx) => {
      for (const r of rows) {
        const v = { isin: r.isin, symbol: r.symbol, name: r.name, kind: r.kind, updatedAt: at }
        tx.insert(schema.nseListings).values(v).onConflictDoUpdate({ target: schema.nseListings.isin, set: v }).run()
      }
    })
    // With NSE's list in hand: ETFs a statement filed as funds, and plain company names.
    reclassifyDemat(this.db)
    tidyListedNames(this.db)
  }

  private async ensureNseList(): Promise<void> {
    const mapAge = this.db
      .select({ at: max(schema.sectorMap.updatedAt) })
      .from(schema.sectorMap)
      .get()?.at
    if (mapAge && Date.now() - Date.parse(mapAge) < 7 * 86400000) return
    const rows = await fetchNseIndustries(this.f)
    if (rows.length < 100) return
    const at = nowIso()
    this.db.transaction((tx) => {
      for (const r of rows) {
        const v = { isin: r.isin, symbol: r.symbol, name: r.name, industry: r.industry, source: 'NSE', updatedAt: at }
        tx.insert(schema.sectorMap).values(v).onConflictDoUpdate({ target: schema.sectorMap.isin, set: v }).run()
      }
    })
  }

  async refreshSectors(held: Instrument[]): Promise<void> {
    try {
      await this.ensureNseList()
      const failed: string[] = []
      const needs = held.filter(
        (i) => i.assetClass === 'EQUITY_IN' || i.assetClass === 'EQUITY_US' || i.assetClass === 'ETF'
      )
      await mapLimit(needs, 3, async (i) => {
        const fresh = i.metaUpdatedAt && Date.now() - Date.parse(i.metaUpdatedAt) < 7 * 86400000
        if (fresh) return

        let sector: string | null = null
        let industry: string | null = null
        if (i.isin) {
          const m = this.db.select().from(schema.sectorMap).where(eq(schema.sectorMap.isin, i.isin)).get()
          if (m) {
            sector = fromNseIndustry(m.industry)
            industry = m.industry
          }
        }
        const sym = this.yahooCandidates(i)[0]
        let quoteType: string | null = null
        if (!sector && sym && i.assetClass !== 'ETF') {
          const p = await yahooProfile(sym, this.f).catch(() => null)
          quoteType = p?.quoteType ?? null
          if (p?.sector) {
            sector = fromYahoo(p.sector, p.industry)
            industry = p.industry
          }
        }
        // Unlisted shares (no NSE or Yahoo entry): the company name often says the sector.
        if (!sector && i.assetClass === 'EQUITY_IN') {
          const guess = fromIndustryText(i.name)
          if (guess !== 'Other') sector = guess
        }
        // US-listed funds: sector weights and top holdings from Yahoo.
        let isFund = false
        if (i.assetClass === 'EQUITY_US' && !sector && sym && quoteType !== 'EQUITY') {
          const fund = await this.yahoo.fund(sym).catch(() => null)
          if (fund) {
            this.saveYahooFund(i.id, fund)
            isFund = true
          }
        }
        // Only a successful lookup is remembered for a week; a miss is retried on the next daily run.
        const resolved = !!sector || isFund || i.assetClass === 'ETF'
        if (!resolved) failed.push(i.symbolNse ?? i.tickerUs ?? i.name)
        this.db
          .update(schema.instruments)
          .set({
            sector: sector ?? i.sector,
            industry: industry ?? i.industry,
            metaUpdatedAt: resolved ? nowIso() : i.metaUpdatedAt
          })
          .where(eq(schema.instruments.id, i.id))
          .run()
      })
      this.ok('sectors', failed)
    } catch (e) {
      this.fail('sectors', e)
    }
  }

  private saveYahooFund(instrumentId: number, fund: NonNullable<Awaited<ReturnType<YahooSession['fund']>>>) {
    const asOf = today()
    this.db.transaction((tx) => {
      tx.delete(schema.fundHoldings)
        .where(and(eq(schema.fundHoldings.fundInstrumentId, instrumentId), eq(schema.fundHoldings.source, 'YAHOO')))
        .run()
      // Equity part split by sector weight; bonds and cash as their own rows.
      for (const s of fund.sectorWeights) {
        tx.insert(schema.fundHoldings)
          .values({
            fundInstrumentId: instrumentId,
            asOf,
            source: 'YAHOO',
            name: `${fromYahoo(s.sector)} (sector weight)`,
            sector: fromYahoo(s.sector),
            industryRaw: s.sector,
            assetType: 'EQUITY',
            country: 'US',
            weight: s.weight * (fund.stock || 1)
          })
          .run()
      }
      if (fund.bond > 0)
        tx.insert(schema.fundHoldings)
          .values({
            fundInstrumentId: instrumentId,
            asOf,
            source: 'YAHOO',
            name: 'Bonds',
            assetType: 'DEBT',
            country: 'US',
            weight: fund.bond
          })
          .run()
      if (fund.cash > 0)
        tx.insert(schema.fundHoldings)
          .values({
            fundInstrumentId: instrumentId,
            asOf,
            source: 'YAHOO',
            name: 'Cash',
            assetType: 'CASH',
            country: 'US',
            weight: fund.cash
          })
          .run()
    })
  }

  // ---------------- dividends ----------------

  async refreshDividends(held: Instrument[]): Promise<void> {
    const targets = held.filter(
      (i) => [...LISTED_IN, 'EQUITY_US'].includes(i.assetClass) && this.yahooCandidates(i).length
    )
    if (targets.length === 0) return this.ok('dividends')
    try {
      const results = await mapLimit(targets, 3, async (i) => {
        const events = await yahooDividends(this.yahooCandidates(i)[0], this.f)
        this.db.transaction((tx) => {
          for (const d of events) {
            tx.insert(schema.dividends)
              .values({ instrumentId: i.id, exDate: d.exDate, amount: d.amount, currency: i.currency, source: 'YAHOO' })
              .onConflictDoUpdate({
                target: [schema.dividends.instrumentId, schema.dividends.exDate],
                set: { amount: d.amount }
              })
              .run()
          }
        })
      })
      this.ok(
        'dividends',
        results.filter((r) => !r.ok).map((r) => r.item.symbolNse ?? r.item.tickerUs ?? r.item.name)
      )
    } catch (e) {
      this.fail('dividends', e)
    }
  }
}
