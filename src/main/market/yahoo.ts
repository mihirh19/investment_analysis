import { dateInOffset, getJson, request, type FetchFn } from './http'

// Yahoo Finance's public chart endpoint (no key). Unofficial: shapes are validated defensively.

interface ChartResponse {
  chart: {
    result:
      | {
          meta: {
            currency: string
            symbol: string
            regularMarketPrice?: number
            chartPreviousClose?: number
            previousClose?: number
            regularMarketTime?: number
            gmtoffset?: number
            longName?: string
            shortName?: string
            instrumentType?: string
          }
          timestamp?: number[]
          indicators?: {
            quote?: {
              open?: (number | null)[]
              high?: (number | null)[]
              low?: (number | null)[]
              close?: (number | null)[]
              volume?: (number | null)[]
            }[]
            adjclose?: { adjclose?: (number | null)[] }[]
          }
          events?: { dividends?: Record<string, { amount: number; date: number }> }
        }[]
      | null
    error: { code: string; description: string } | null
  }
}

export interface Quote {
  symbol: string
  price: number
  prevClose: number | null
  currency: string
  asOf: string // ISO
  name: string | null
}

export interface DividendEvent {
  exDate: string
  amount: number
}

export interface PricePoint {
  date: string
  close: number
}

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'

async function chart(symbol: string, params: string, f?: FetchFn) {
  const json = await getJson<ChartResponse>(`${BASE}${encodeURIComponent(symbol)}?${params}`, { fetch: f })
  const r = json.chart?.result?.[0]
  if (!r) throw new Error(json.chart?.error?.description ?? `No data for ${symbol}`)
  return r
}

export async function yahooQuote(symbol: string, f?: FetchFn): Promise<Quote> {
  const r = await chart(symbol, 'range=1d&interval=1d', f)
  const m = r.meta
  if (typeof m.regularMarketPrice !== 'number') throw new Error(`No price for ${symbol}`)
  return {
    symbol,
    price: m.regularMarketPrice,
    prevClose: m.chartPreviousClose ?? m.previousClose ?? null,
    currency: m.currency?.toUpperCase() ?? 'INR',
    asOf: new Date((m.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
    name: m.longName ?? m.shortName ?? null
  }
}

/** Daily closes plus dividend events in one request. */
export async function yahooHistory(
  symbol: string,
  range: '1mo' | '6mo' | '1y' | '5y' | '10y' | 'max',
  f?: FetchFn,
  interval: '1d' | '1wk' = range === '5y' || range === '10y' || range === 'max' ? '1wk' : '1d'
): Promise<{ prices: PricePoint[]; dividends: DividendEvent[]; currency: string }> {
  const r = await chart(symbol, `range=${range}&interval=${interval}&events=div`, f)
  const offset = r.meta.gmtoffset ?? 0
  const closes = r.indicators?.quote?.[0]?.close ?? []
  const prices: PricePoint[] = []
  ;(r.timestamp ?? []).forEach((t, i) => {
    const c = closes[i]
    if (typeof c === 'number' && Number.isFinite(c)) prices.push({ date: dateInOffset(t, offset), close: c })
  })
  return { prices, dividends: parseDividends(r.events?.dividends, offset), currency: r.meta.currency?.toUpperCase() }
}

export type BarInterval = '1m' | '5m' | '15m' | '1h' | '1d'

/** How far back each interval goes on Yahoo (its own limits: 1-minute bars only for the last 30 days). */
const BAR_SPAN: Record<BarInterval, string> = {
  '1m': 'range=7d&interval=1m',
  '5m': 'range=60d&interval=5m',
  '15m': 'range=60d&interval=15m',
  '1h': 'range=730d&interval=60m',
  '1d': 'interval=1d'
}

export interface OhlcBar {
  /** "YYYY-MM-DD" for daily bars; seconds since 1970 in exchange time (shifted) for intraday ones. */
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/**
 * Candles for a chart: the whole daily history (split-adjusted, as Yahoo gives it), or recent
 * intraday bars, which Yahoo serves delayed. Intraday times are shifted to exchange time so a chart
 * library showing UTC prints the market's own clock.
 */
export async function yahooBars(symbol: string, interval: BarInterval, f?: FetchFn): Promise<{ bars: OhlcBar[]; currency: string }> {
  const span = interval === '1d' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d` : BAR_SPAN[interval]
  const r = await chart(symbol, span, f)
  const offset = r.meta.gmtoffset ?? 0
  const q = r.indicators?.quote?.[0] ?? {}
  const bars: OhlcBar[] = []
  ;(r.timestamp ?? []).forEach((t, i) => {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (![o, h, l, c].every((v) => typeof v === 'number' && Number.isFinite(v))) return
    const time = interval === '1d' ? dateInOffset(t, offset) : t + offset
    // Yahoo can repeat the last day (a live bar and a closed one): keep the later.
    if (bars.length && bars[bars.length - 1].time === time) bars.pop()
    bars.push({ time, open: o!, high: h!, low: l!, close: c!, volume: q.volume?.[i] ?? null })
  })
  return { bars, currency: r.meta.currency?.toUpperCase() ?? 'INR' }
}

/** Yahoo's v7 spark for one day: each symbol's latest price, previous close and the day's closes. */
export function parseYahooQuotes(json: unknown): { symbol: string; price: number; prevClose: number | null; change: number | null; time: string; points: number[] }[] {
  type Spark = { symbol: string; response?: { meta?: Record<string, unknown>; indicators?: { quote?: { close?: (number | null)[] }[] } }[] }
  const results = (json as { spark?: { result?: Spark[] } })?.spark?.result ?? []
  const out = []
  for (const r of results) {
    const res = r.response?.[0]
    const m = res?.meta
    const price = Number(m?.regularMarketPrice)
    if (!m || !(price > 0)) continue
    const prev = Number(m.chartPreviousClose ?? m.previousClose)
    const time = Number(m.regularMarketTime)
    out.push({
      symbol: r.symbol,
      price,
      prevClose: prev > 0 ? prev : null,
      change: prev > 0 ? price / prev - 1 : null,
      time: new Date((Number.isFinite(time) ? time : Date.now() / 1000) * 1000).toISOString(),
      points: (res?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    })
  }
  return out
}

/** The day's high on one date (exchange time), or null if the symbol did not trade that day. */
export async function yahooHighOn(symbol: string, date: string, f?: FetchFn): Promise<number | null> {
  const t0 = Date.parse(`${date}T00:00:00Z`) / 1000 - 86400
  const r = await chart(symbol, `period1=${t0}&period2=${t0 + 3 * 86400}&interval=1d`, f)
  const offset = r.meta.gmtoffset ?? 0
  const highs = r.indicators?.quote?.[0]?.high ?? []
  const i = (r.timestamp ?? []).findIndex((t) => dateInOffset(t, offset) === date)
  const h = i >= 0 ? highs[i] : null
  return typeof h === 'number' && Number.isFinite(h) ? h : null
}

export async function yahooDividends(symbol: string, f?: FetchFn): Promise<DividendEvent[]> {
  // Monthly bars keep the payload small; dividend events are returned in full regardless.
  const r = await chart(symbol, 'range=10y&interval=1mo&events=div', f)
  return parseDividends(r.events?.dividends, r.meta.gmtoffset ?? 0)
}

function parseDividends(raw: Record<string, { amount: number; date: number }> | undefined, offset: number) {
  return Object.values(raw ?? {})
    .filter((d) => typeof d.amount === 'number' && d.amount > 0 && typeof d.date === 'number')
    .map((d) => ({ exDate: dateInOffset(d.date, offset), amount: d.amount }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate))
}

// ---- search: sector/industry/type without a session token ----

export interface YahooProfile {
  sector: string | null
  industry: string | null
  /** EQUITY, ETF, MUTUALFUND, … */
  quoteType: string | null
}

export async function yahooProfile(symbol: string, f?: FetchFn): Promise<YahooProfile> {
  const json = await getJson<{
    quotes?: { symbol?: string; sector?: string; industry?: string; quoteType?: string }[]
  }>(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`, {
    fetch: f
  })
  const q = (json.quotes ?? []).find((x) => x.symbol?.toUpperCase() === symbol.toUpperCase())
  if (!q) throw new Error(`Yahoo search has no exact match for ${symbol}`)
  return { sector: q.sector || null, industry: q.industry || null, quoteType: q.quoteType || null }
}

/** Finds the NSE (or BSE) Yahoo symbol for an Indian ISIN, e.g. INF204KB14I2 → NIFTYBEES.NS. */
export async function yahooSymbolForIsin(isin: string, f?: FetchFn): Promise<string | null> {
  const json = await getJson<{ quotes?: { symbol?: string }[] }>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`,
    { fetch: f }
  )
  const syms = (json.quotes ?? []).map((q) => q.symbol ?? '')
  return syms.find((s) => s.endsWith('.NS')) ?? syms.find((s) => s.endsWith('.BO')) ?? null
}

// ---- quoteSummary (needs a cookie + crumb) for ETF holdings ----

export interface FundBreakdown {
  sectorWeights: { sector: string; weight: number }[]
  holdings: { symbol: string | null; name: string; weight: number }[]
  stock: number
  bond: number
  cash: number
  other: number
}

/** Yahoo's quote list (v7) into prices with their time. */
export function parseYahooQuoteList(json: unknown): { symbol: string; price: number; prevClose: number | null; change: number | null; time: string }[] {
  const rows = (json as { quoteResponse?: { result?: Record<string, unknown>[] } } | null)?.quoteResponse?.result ?? []
  const out = []
  for (const r of rows) {
    const price = Number(r.regularMarketPrice)
    const t = Number(r.regularMarketTime)
    if (typeof r.symbol !== 'string' || !Number.isFinite(price) || price <= 0 || !Number.isFinite(t)) continue
    const prev = Number(r.regularMarketPreviousClose)
    const prevClose = Number.isFinite(prev) && prev > 0 ? prev : null
    out.push({ symbol: r.symbol, price, prevClose, change: prevClose ? price / prevClose - 1 : null, time: new Date(t * 1000).toISOString() })
  }
  return out
}

export class YahooSession {
  private cookie: string | null = null
  private crumb: string | null = null
  private pending: Promise<void> | null = null

  constructor(private readonly f: FetchFn = fetch) {}

  /** One cookie + crumb pair shared by all callers; concurrent callers wait for the same fetch. */
  private ensure(): Promise<void> {
    if (this.cookie && this.crumb) return Promise.resolve()
    this.pending ??= (async () => {
      try {
        const first = await this.f('https://fc.yahoo.com', { redirect: 'manual' }).catch(() => null)
        const cookie = (first?.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
        const res = await request('https://query1.finance.yahoo.com/v1/test/getcrumb', {
          fetch: this.f,
          headers: { Cookie: cookie }
        })
        const crumb = (await res.text()).trim()
        if (!crumb || crumb.includes('<')) throw new Error('Yahoo did not issue a session token')
        this.cookie = cookie
        this.crumb = crumb
      } finally {
        this.pending = null
      }
    })()
    return this.pending
  }

  private async summary(symbol: string, modules: string): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensure()
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(this.crumb!)}`
      const res = await this.f(url, { headers: { Cookie: this.cookie!, 'User-Agent': 'Mozilla/5.0' } })
      if (res.status === 401 || res.status === 403) {
        this.cookie = this.crumb = null
        continue
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Yahoo quoteSummary ${res.status}`)
      const json = (await res.json()) as { quoteSummary?: { result?: Record<string, unknown>[] | null } }
      return json.quoteSummary?.result?.[0] ?? null
    }
    throw new Error('Yahoo rejected the session token')
  }

  /**
   * Latest prices for up to 50 Yahoo symbols in one call (the session's quote list). Fresher than the
   * public spark endpoint, whose cached copies can run a minute or more behind.
   */
  async quotes(symbols: string[]): Promise<{ symbol: string; price: number; prevClose: number | null; change: number | null; time: string }[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensure()
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=regularMarketPrice,regularMarketTime,regularMarketPreviousClose&crumb=${encodeURIComponent(this.crumb!)}`
      const res = await this.f(url, { headers: { Cookie: this.cookie!, 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
      if (res.status === 401 || res.status === 403) {
        this.cookie = this.crumb = null
        continue
      }
      if (!res.ok) throw new Error(`Yahoo quote ${res.status}`)
      return parseYahooQuoteList(await res.json())
    }
    throw new Error('Yahoo rejected the session token')
  }

  async fund(symbol: string): Promise<FundBreakdown | null> {
    const r = await this.summary(symbol, 'topHoldings')
    const t = r?.topHoldings as
      | {
          stockPosition?: { raw?: number }
          bondPosition?: { raw?: number }
          cashPosition?: { raw?: number }
          otherPosition?: { raw?: number }
          sectorWeightings?: Record<string, { raw?: number }>[]
          holdings?: { symbol?: string; holdingName?: string; holdingPercent?: { raw?: number } }[]
        }
      | undefined
    if (!t) return null
    const sectorWeights = (t.sectorWeightings ?? []).flatMap((o) =>
      Object.entries(o).map(([sector, v]) => ({ sector, weight: v?.raw ?? 0 }))
    )
    if (sectorWeights.length === 0 && !(t.holdings?.length ?? 0)) return null
    return {
      sectorWeights: sectorWeights.filter((s) => s.weight > 0),
      holdings: (t.holdings ?? []).map((h) => ({
        symbol: h.symbol ?? null,
        name: h.holdingName ?? h.symbol ?? '?',
        weight: h.holdingPercent?.raw ?? 0
      })),
      stock: t.stockPosition?.raw ?? 0,
      bond: t.bondPosition?.raw ?? 0,
      cash: t.cashPosition?.raw ?? 0,
      other: t.otherPosition?.raw ?? 0
    }
  }
}
