import type { SchemeFacts } from '@shared/insights'
import { getJson, type FetchFn } from './market/http'
import type { AmfiScheme } from './market/funds'
import { yahooHistory, yahooQuote, type PricePoint } from './market/yahoo'

/**
 * Market look-ups for Ask your money: any listed stock, ETF or index (Yahoo's public chart data,
 * NSE first), and any mutual fund (AMFI's daily NAV file, AMFI's returns and costs, mfapi.in's NAV
 * history). Facts only: prices, past returns, costs and size.
 */

const INDEX_SYMBOLS: Record<string, string> = {
  'nifty': '^NSEI',
  'nifty 50': '^NSEI',
  'nifty50': '^NSEI',
  'sensex': '^BSESN',
  'bse sensex': '^BSESN',
  'bank nifty': '^NSEBANK',
  'nifty bank': '^NSEBANK',
  'banknifty': '^NSEBANK',
  'nifty it': '^CNXIT',
  'nifty pharma': '^CNXPHARMA',
  'nifty fmcg': '^CNXFMCG',
  'nifty auto': '^CNXAUTO',
  'nifty metal': '^CNXMETAL',
  'nifty realty': '^CNXREALTY',
  'nifty energy': '^CNXENERGY',
  'nifty next 50': '^NSMIDCP',
  'nifty midcap 100': 'NIFTY_MIDCAP_100.NS',
  'india vix': '^INDIAVIX'
}

/** % change from the close nearest before `days` ago to the last close; a year or more as % a year. */
export function returnOver(points: PricePoint[], days: number): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const target = Date.parse(last.date) - days * 86400000
  // The close nearest the target day; none within ten days (weekly data, holidays) means too short a history.
  let start: PricePoint | null = null
  for (const p of points)
    if (!start || Math.abs(Date.parse(p.date) - target) < Math.abs(Date.parse(start.date) - target)) start = p
  if (!start || start === last || Math.abs(Date.parse(start.date) - target) > 10 * 86400000) return null
  const growth = last.close / start.close
  const years = days / 365
  const r = years >= 1 ? Math.pow(growth, 1 / years) - 1 : growth - 1
  return Math.round(r * 10000) / 100
}

/** The deepest fall from a high, %, and when it bottomed. */
export function worstFall(points: PricePoint[]): { pct: number; bottom: string } | null {
  let peak = 0
  let worst: { pct: number; bottom: string } | null = null
  for (const p of points) {
    peak = Math.max(peak, p.close)
    const fall = (p.close / peak - 1) * 100
    if (!worst || fall < worst.pct) worst = { pct: Math.round(fall * 100) / 100, bottom: p.date }
  }
  return worst
}

/** Return in each calendar year, %, from the last close of the year before. */
export function calendarYears(points: PricePoint[]): Record<string, number> {
  const yearEnd = new Map<string, number>()
  for (const p of points) yearEnd.set(p.date.slice(0, 4), p.close)
  const years = [...yearEnd.keys()].sort()
  const out: Record<string, number> = {}
  for (let i = 1; i < years.length; i++) {
    const prev = yearEnd.get(years[i - 1])!
    out[years[i]] = Math.round((yearEnd.get(years[i])! / prev - 1) * 10000) / 100
  }
  return out
}

interface SearchQuote {
  symbol?: string
  shortname?: string
  longname?: string
  exchange?: string
  quoteType?: string
  sector?: string
  industry?: string
}

/** Yahoo symbols for a name or ticker, Indian listings first (NSE before BSE). */
export async function findSymbols(query: string, f?: FetchFn): Promise<SearchQuote[]> {
  const json = await getJson<{ quotes?: SearchQuote[] }>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`,
    { fetch: f }
  )
  const rank = (q: SearchQuote) => (q.symbol?.endsWith('.NS') ? 0 : q.symbol?.endsWith('.BO') ? 1 : q.symbol?.startsWith('^') ? 2 : 3)
  return (json.quotes ?? [])
    .filter((q) => q.symbol && ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND'].includes(q.quoteType ?? ''))
    .sort((a, b) => rank(a) - rank(b))
}

async function resolveSymbol(query: string, f?: FetchFn): Promise<{ symbol: string; info: SearchQuote | null }> {
  const q = query.trim()
  const alias = INDEX_SYMBOLS[q.toLowerCase()]
  if (alias) return { symbol: alias, info: null }
  if (/^\^|\.(NS|BO)$/i.test(q)) return { symbol: q.toUpperCase(), info: null }
  // A plain ticker: NSE first.
  if (/^[A-Z0-9&-]{2,20}$/.test(q)) {
    for (const suffix of ['.NS', '.BO']) {
      try {
        await yahooQuote(q + suffix, f)
        return { symbol: q + suffix, info: null }
      } catch {
        /* not listed there */
      }
    }
  }
  const found = await findSymbols(q, f)
  if (!found.length) throw new Error(`No listed stock, ETF or index found for "${query}". Try the NSE symbol, e.g. INFY.`)
  return { symbol: found[0].symbol!, info: found[0] }
}

/** Today's price and day change, the 52-week range, and past returns for a stock, ETF or index. */
export async function stockLookup(query: string, f?: FetchFn) {
  const { symbol, info } = await resolveSymbol(query, f)
  const [quote, year, five] = await Promise.all([
    yahooQuote(symbol, f),
    yahooHistory(symbol, '1y', f),
    yahooHistory(symbol, '5y', f).catch(() => null)
  ])
  const closes = year.prices.map((p) => p.close)
  const long = five?.prices ?? year.prices
  return {
    symbol,
    name: quote.name ?? info?.longname ?? info?.shortname ?? null,
    exchange: symbol.endsWith('.NS') ? 'NSE' : symbol.endsWith('.BO') ? 'BSE' : symbol.startsWith('^') ? 'index' : info?.exchange ?? null,
    sector: info?.sector ?? null,
    industry: info?.industry ?? null,
    currency: quote.currency,
    price: quote.price,
    asOf: quote.asOf,
    dayChangePct: quote.prevClose ? Math.round((quote.price / quote.prevClose - 1) * 10000) / 100 : null,
    high52w: closes.length ? Math.max(...closes) : null,
    low52w: closes.length ? Math.min(...closes) : null,
    returnsPct: {
      '1 month': returnOver(year.prices, 30),
      '6 months': returnOver(year.prices, 182),
      '1 year': returnOver(year.prices, 365),
      '3 years (a year)': returnOver(long, 3 * 365),
      '5 years (a year)': returnOver(long, 5 * 365 - 7)
    },
    worstFall5y: worstFall(long),
    dividendsLastYear: year.dividends.reduce((s, d) => s + d.amount, 0) || null
  }
}

const STOP = new Set(['fund', 'plan', 'direct', 'regular', 'growth', 'option', 'mutual', 'mf', 'scheme', 'the', 'of', '-'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))

/** Whether every word of the query (plan words ignored) appears in the name. */
export function nameMatches(name: string, query: string): boolean {
  const n = new Set(words(name))
  const q = words(query)
  return q.length > 0 && q.every((w) => n.has(w) || [...n].some((x) => x.startsWith(w) && w.length >= 3))
}

/**
 * Funds whose names match: AMFI's returns (Direct and Regular), expense ratios, size and risk, plus
 * each plan's scheme code and latest NAV (codes are what the NAV history needs).
 */
export function fundLookup(query: string, facts: { date: string | null; schemes: SchemeFacts[] }, navs: AmfiScheme[]) {
  const matched = facts.schemes
    .filter((s) => nameMatches(s.name, query))
    .sort((a, b) => (b.aumCr ?? 0) - (a.aumCr ?? 0))
    .slice(0, 8)
  // Newer AMFI files give plan and option in their own columns; older ones only in the name.
  const label = (s: AmfiScheme) => [s.name, s.plan, s.option].filter(Boolean).join(' - ')
  const payout = (s: AmfiScheme) => Number(/idcw|dividend|bonus/i.test(label(s)))
  const regular = (s: AmfiScheme) => Number(!/direct/i.test(label(s)))
  const plans = navs
    .filter((s) => nameMatches(s.name, query))
    // Growth plans first (they show the fund's real return), Direct before Regular.
    .sort((a, b) => payout(a) - payout(b) || regular(a) - regular(b))
    .slice(0, 12)
    .map((s) => ({ code: s.code, name: label(s), nav: s.nav, navDate: s.date, fundHouse: s.fundHouse, category: s.category }))
  return { returnsAsOf: facts.date, funds: matched, plans, note: matched.length || plans.length ? undefined : `No fund matches "${query}".` }
}

/** A fund's NAV record: returns over periods, by calendar year, and its worst fall. */
export async function fundHistory(code: string, history: (code: string, since: string) => Promise<PricePoint[]>, today = new Date()) {
  const since = new Date(today.getTime() - 10.2 * 365 * 86400000).toISOString().slice(0, 10)
  const points = await history(code, since)
  if (!points.length) throw new Error(`No NAV history for scheme code ${code}.`)
  const last = points[points.length - 1]
  return {
    code,
    nav: last.close,
    navDate: last.date,
    since: points[0].date,
    returnsPct: {
      '1 month': returnOver(points, 30),
      '6 months': returnOver(points, 182),
      '1 year': returnOver(points, 365),
      '3 years (a year)': returnOver(points, 3 * 365),
      '5 years (a year)': returnOver(points, 5 * 365),
      '10 years (a year)': returnOver(points, 10 * 365)
    },
    byCalendarYear: calendarYears(points),
    worstFall: worstFall(points)
  }
}
