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
            quote?: { close?: (number | null)[]; high?: (number | null)[] }[]
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
