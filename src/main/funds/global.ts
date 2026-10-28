import { eq } from 'drizzle-orm'
import { nportFilings, parseNport, type AllocLabel, type PortfolioSnapshot } from '@shared/fundPortfolio'
import { globalProfile, isUcitsListing, pickListings, type GlobalMarket } from '@shared/globalEtfs'
import { UCITS_SEED } from '@shared/ucitsSeed'
import { schema, type Db } from '../db'
import { findSymbols } from '../marketLookup'
import { getJson, getText, type FetchFn } from '../market/http'
import { yahooAdjusted, yahooQuote, YahooSession, type EtfScreenQuote } from '../market/yahoo'
import type { UniverseFund } from './screen'

/**
 * US and UCITS ETFs for the screener, from Yahoo's ETF screener weekly: every US ETF, and the UCITS
 * ETFs on London, Xetra and Amsterdam, with their size and costs. A list checked against Yahoo ships
 * with the app for before the first download, and the family can add any ETF by ticker or ISIN. Prices come from Yahoo; full holdings of US ETFs from the SEC's N-PORT
 * filings, and top holdings and sectors of any ETF from Yahoo's fund summary.
 */

const GLOBAL_KEY = 'funds:global'
const ADDED_KEY = 'funds:global:added'
const SEC_TICKERS_KEY = 'sec:mf-tickers'
const SEC_CONTACT_KEY = 'sec:contact'
const SNAP_KEY = (code: string) => `funds:portfolio:${code}`
const WEEK = 7 * 86400_000

const getSetting = (db: Db, k: string) => db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value ?? null
const setSetting = (db: Db, key: string, value: string) =>
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()

export const isGlobal = (code: string) => code.startsWith('US:') || code.startsWith('UC:')

function globalFund(market: GlobalMarket, ticker: string, name: string, currency: string, exchange: string): UniverseFund {
  const p = globalProfile(name, market, currency)
  return {
    code: `${market === 'US' ? 'US' : 'UC'}:${ticker}`,
    name,
    fundHouse: issuerOf(name),
    category: p.category,
    group: p.group,
    isin: null,
    nav: null,
    navDate: null,
    market,
    vehicle: 'ETF',
    ticker,
    exchange,
    currency,
    leveraged: p.leveraged
  }
}

/** The issuer, from the first words of the name ("iShares Core S&P 500" → "iShares"). */
export function issuerOf(name: string): string | null {
  const known = ['iShares', 'Vanguard', 'SPDR', 'Invesco', 'Schwab', 'Xtrackers', 'Amundi', 'JPMorgan', 'Global X', 'WisdomTree', 'HSBC', 'Fidelity', 'ProShares', 'Direxion', 'First Trust', 'VanEck', 'ARK', 'Franklin', 'Dimensional', 'L&G', 'UBS', 'Lyxor', 'BNP Paribas', 'Goldman Sachs', 'Pacer', 'Roundhill', 'Defiance', 'Avantis', 'American Century', 'Nuveen', 'Columbia', 'Principal', 'Hartford', 'John Hancock', 'Simplify', 'Grayscale']
  const hit = known.find((k) => name.toLowerCase().startsWith(k.toLowerCase()))
  if (hit) return hit
  if (/^state street/i.test(name)) return 'SPDR'
  return name.split(/\s+/)[0] || null
}

export function ucitsSeed(): UniverseFund[] {
  return UCITS_SEED.map(([ticker, name, currency, exchange]) => globalFund('UCITS', ticker, name, currency, exchange))
}

/** Screener rows as universe funds, with Yahoo's size and costs. */
export function fundsFromScreen(market: GlobalMarket, quotes: EtfScreenQuote[]): UniverseFund[] {
  return quotes.map((q) => ({ ...globalFund(market, q.symbol, q.name, q.currency, q.exchange), assetsUsd: q.netAssets, ter: q.expenseRatio }))
}

// Parsed once until the stored lists change.
let cache: { raw: string; value: { at: string | null; usdInr: number | null; funds: UniverseFund[] } } | null = null

/** The global ETFs on file: the weekly lists, plus the ones added by hand; and the dollar's rupee rate then. */
export function storedGlobal(db: Db): { at: string | null; usdInr: number | null; funds: UniverseFund[] } {
  const g = getSetting(db, GLOBAL_KEY)
  const added = getSetting(db, ADDED_KEY) ?? '[]'
  const raw = `${g ?? ''}|${added}`
  if (cache?.raw !== raw) {
    const stored = g ? (JSON.parse(g) as { at: string; usdInr?: number; funds: UniverseFund[] }) : null
    const base = stored?.funds ?? ucitsSeed()
    const seen = new Set(base.map((f) => f.code))
    cache = { raw, value: { at: stored?.at ?? null, usdInr: stored?.usdInr ?? null, funds: [...base, ...(JSON.parse(added) as UniverseFund[]).filter((f) => !seen.has(f.code))] } }
  }
  return cache.value
}

/** Node's "fetch failed" hides why in `cause` (a refused connection, a reset, a bad certificate): say it. */
function withCause(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(String(e))
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
  const why = cause?.code ?? cause?.message
  return why && !err.message.includes(why) ? new Error(`${err.message} (${why})`) : err
}

/** Every page of Yahoo's ETF screener for a region and exchange, a little apart. */
async function screenAll(yahoo: YahooSession, region: string, exchange: string | null, gapMs: number, maxPages = 40): Promise<EtfScreenQuote[]> {
  const out: EtfScreenQuote[] = []
  for (let page = 0; page < maxPages; page++) {
    // A dropped connection on one page of sixty shouldn't lose the whole weekly download: that page
    // is asked for again (after 3 s, then 9 s) before giving up.
    let r: Awaited<ReturnType<YahooSession['screenEtfs']>> | null = null
    for (let attempt = 0; !r; attempt++) {
      try {
        r = await yahoo.screenEtfs(region, exchange, page * 250)
      } catch (e) {
        if (attempt >= 2 || !(e instanceof TypeError || (e instanceof Error && /fetch failed|timeout|aborted/i.test(e.message)))) throw withCause(e)
        await new Promise((res) => setTimeout(res, 3000 * 3 ** attempt))
      }
    }
    out.push(...r.quotes)
    if (r.quotes.length < 250 || out.length >= r.total) break
    if (gapMs > 0) await new Promise((res) => setTimeout(res, gapMs))
  }
  return out
}

/**
 * The weekly lists from Yahoo's ETF screener: every US ETF, and the UCITS ETFs on London, Xetra and
 * Amsterdam (one listing per fund), with the shipped list kept for any the screener misses.
 */
export async function refreshGlobal(db: Db, f: FetchFn, yahoo: YahooSession = new YahooSession(f), gapMs = 1500): Promise<boolean> {
  const { at } = storedGlobal(db)
  if (at && Date.now() - Date.parse(at) < WEEK) return false
  const us = fundsFromScreen('US', await screenAll(yahoo, 'us', null, gapMs))
  if (us.length < 1000) throw new Error('Yahoo’s ETF screener sent too few US ETFs')
  const europe: EtfScreenQuote[] = []
  for (const [region, exchange] of [
    ['gb', 'LSE'],
    ['de', 'GER'],
    ['nl', 'AMS']
  ] as const)
    europe.push(...(await screenAll(yahoo, region, exchange, gapMs)).filter((q) => isUcitsListing(q.symbol, q.name)))
  const ucits = fundsFromScreen('UCITS', pickListings(europe))
  const have = new Set(ucits.map((x) => x.ticker))
  const funds = [...ucits, ...ucitsSeed().filter((x) => !have.has(x.ticker)), ...us]
  const usdInr = await yahooQuote('USDINR=X', f).then((q) => q.price).catch(() => null)
  setSetting(db, GLOBAL_KEY, JSON.stringify({ at: new Date().toISOString(), usdInr, funds }))
  return true
}

/**
 * Adds a UCITS (or any) ETF by Yahoo ticker, ISIN or name: Yahoo's search finds the listing, which
 * must be an ETF with price history. Returns its screener code.
 */
export async function addGlobalEtf(db: Db, query: string, f: FetchFn): Promise<string> {
  const q = query.trim()
  if (q.length < 2) throw new Error('Type a ticker (e.g. CSPX.L), an ISIN or a name.')
  const found = (await findSymbols(q, f)).filter((x) => x.quoteType === 'ETF')
  if (!found.length) throw new Error(`Yahoo Finance has no ETF for "${q}". Try the ticker with its exchange, e.g. VWRA.L or EUNL.DE.`)
  const pick = found[0]
  const symbol = pick.symbol!
  const existing = storedGlobal(db).funds.find((x) => x.ticker === symbol)
  if (existing) return existing.code
  const hist = await yahooAdjusted(symbol, '5y', f)
  if (hist.prices.length < 30) throw new Error(`Yahoo Finance has too little price history for ${symbol}.`)
  const name = hist.name ?? pick.longname ?? pick.shortname ?? symbol
  const market: GlobalMarket = /\.[A-Z]{1,3}$/.test(symbol) ? 'UCITS' : 'US'
  const fund = globalFund(market, symbol, name, hist.currency, pick.exchange ?? '')
  const added = JSON.parse(getSetting(db, ADDED_KEY) ?? '[]') as UniverseFund[]
  setSetting(db, ADDED_KEY, JSON.stringify([...added.filter((x) => x.code !== fund.code), fund]))
  return fund.code
}

// ---------------- portfolios ----------------

export function portfolioSnapshots(db: Db, code: string): PortfolioSnapshot[] {
  const v = getSetting(db, SNAP_KEY(code))
  return v ? (JSON.parse(v) as PortfolioSnapshot[]) : []
}

/** Keeps one snapshot per source and month, the last eight months of each. */
export function savePortfolioSnapshot(db: Db, code: string, snap: PortfolioSnapshot): void {
  const key = (s: PortfolioSnapshot) => `${s.source}|${s.asOf.slice(0, 7)}`
  const list = portfolioSnapshots(db, code).filter((s) => key(s) !== key(snap))
  list.push(snap)
  list.sort((a, b) => a.asOf.localeCompare(b.asOf))
  const keep = (src: PortfolioSnapshot['source']) => list.filter((s) => s.source === src).slice(-8)
  setSetting(db, SNAP_KEY(code), JSON.stringify([...keep('NPORT'), ...keep('YAHOO')].sort((a, b) => a.asOf.localeCompare(b.asOf))))
}

/** Yahoo's names for sectors, in plain words. */
const SECTOR_NAMES: Record<string, string> = {
  realestate: 'Real estate',
  consumer_cyclical: 'Consumer discretionary',
  basic_materials: 'Materials',
  consumer_defensive: 'Consumer staples',
  technology: 'Technology',
  communication_services: 'Communication',
  financial_services: 'Financials',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare'
}

/** Yahoo's fund summary as a snapshot: the allocation, sectors (of the equity part) and top holdings. */
export function yahooSnapshot(fund: NonNullable<Awaited<ReturnType<YahooSession['fund']>>>, asOf: string): PortfolioSnapshot {
  const alloc: { label: AllocLabel; weight: number }[] = (
    [
      ['Equity', fund.stock],
      ['Debt', fund.bond],
      ['Cash & equivalents', fund.cash],
      ['Other', fund.other]
    ] as [AllocLabel, number][]
  )
    .filter(([, w]) => w > 0.0001)
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight)
  return {
    asOf,
    source: 'YAHOO',
    alloc,
    sectors: fund.sectorWeights.map((s) => ({ sector: SECTOR_NAMES[s.sector] ?? s.sector, weight: s.weight })).sort((a, b) => b.weight - a.weight),
    holdings: fund.holdings.map((h) => ({ name: h.name, isin: null, sector: null, assetType: fund.bond > 0.9 ? 'DEBT' : 'EQUITY', country: null, weight: h.weight }))
  }
}

// ---------------- SEC N-PORT (US ETFs) ----------------

/**
 * The contact the SEC asks for in each request's User-Agent (its fair-access policy): an address
 * set in Settings, else the first Google account connected for statements. Null when neither is.
 */
export function secContact(db: Db): string | null {
  const own = getSetting(db, SEC_CONTACT_KEY)?.trim()
  if (own) return own
  try {
    const accounts = JSON.parse(getSetting(db, 'google:accounts') ?? '[]') as { email?: string }[]
    return accounts.find((a) => a.email)?.email ?? null
  } catch {
    return null
  }
}

export function setSecContact(db: Db, email: string): void {
  const e = email.trim()
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('That doesn’t look like an email address.')
  setSetting(db, SEC_CONTACT_KEY, e)
}

/** The SEC's ticker → (CIK, series) list for funds and ETFs, kept a week. */
async function secSeries(db: Db, ticker: string, ua: string, f: FetchFn): Promise<{ cik: string; series: string } | null> {
  const stored = getSetting(db, SEC_TICKERS_KEY)
  let map: { at: string; m: Record<string, [number, string]> } | null = stored ? JSON.parse(stored) : null
  if (!map || Date.now() - Date.parse(map.at) > WEEK) {
    const j = await getJson<{ fields: string[]; data: (string | number)[][] }>('https://www.sec.gov/files/company_tickers_mf.json', { fetch: f, timeoutMs: 60_000, headers: { 'User-Agent': ua } })
    const [iCik, iSeries, iSym] = [j.fields.indexOf('cik'), j.fields.indexOf('seriesId'), j.fields.indexOf('symbol')]
    const m: Record<string, [number, string]> = {}
    for (const r of j.data) if (typeof r[iSym] === 'string') m[r[iSym] as string] = [Number(r[iCik]), String(r[iSeries])]
    map = { at: new Date().toISOString(), m }
    setSetting(db, SEC_TICKERS_KEY, JSON.stringify(map))
  }
  const hit = map.m[ticker.toUpperCase()]
  return hit ? { cik: String(hit[0]), series: hit[1] } : null
}

/**
 * A US ETF's latest N-PORT portfolio: the series' filings list, then the newest NPORT-P's
 * primary_doc.xml. Null when the SEC lists no series for the ticker (unit trusts like SPY and QQQ
 * don't file N-PORT) or no contact is set.
 */
export async function fetchNport(db: Db, ticker: string, f: FetchFn): Promise<PortfolioSnapshot | null> {
  const contact = secContact(db)
  if (!contact) return null
  const ua = `Family Portfolio personal desktop app ${contact}`
  const s = await secSeries(db, ticker, ua, f)
  if (!s) return null
  const atom = await getText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${s.series}&type=NPORT-P&dateb=&owner=include&count=10&output=atom`, {
    fetch: f,
    timeoutMs: 30_000,
    headers: { 'User-Agent': ua }
  })
  const latest = nportFilings(atom)[0]
  if (!latest) return null
  const xml = await getText(`https://www.sec.gov/Archives/edgar/data/${latest.cik}/${latest.accession}/primary_doc.xml`, { fetch: f, timeoutMs: 60_000, headers: { 'User-Agent': ua } })
  return parseNport(xml)
}
