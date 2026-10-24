import {
  addFlows,
  arrange,
  computeMetrics,
  monthsBetween,
  type Balance,
  type DayQuote,
  type Filing,
  type Flow
} from './research'
import type { Technicals } from './technicals'

// The screener: a few figures per company from its filings (no price in them: that changes daily),
// combined with the day's price, then filtered.

/** What the screener keeps per company from its filings. */
export interface Fundamentals {
  bank: boolean
  latestPeriod: string | null
  years: number
  shares: number | null
  equity: number | null
  borrowings: number | null
  cash: number | null
  ttmRevenue: number | null
  ttmProfit: number | null
  /** Profit before interest and tax over the last four quarters. */
  ttmEbit: number | null
  epsTtm: number | null
  opm: number | null
  roe: number | null
  roce: number | null
  debtToEquity: number | null
  currentRatio: number | null
  interestCover: number | null
  salesGrowth3y: number | null
  profitGrowth3y: number | null
  salesGrowthQ: number | null
  profitGrowthQ: number | null
  piotroski: number | null
  /** The weakest ROCE and the slowest yearly sales growth over the last five years (three at least). */
  roceMin5: number | null
  salesGrowthMin5: number | null
  dividendsFy: number | null
}

const num = (x: number | undefined) => (typeof x === 'number' ? x : undefined)
const plus = (a: number | undefined, b: number | undefined) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
const div = (a: number | undefined | null, b: number | undefined | null) =>
  typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : null
const profitOf = (f: Flow) => f.ownersProfit ?? f.netProfit
const revenueOf = (f: Flow) => f.revenue ?? f.totalIncome

/** ROCE, ROE and sales growth for each year, newest first. */
export function yearlyRatios(a: ReturnType<typeof arrange>) {
  const bsAt = (end: string) => a.balances.find((b) => b.periodEnd === end)
  const capital = (b: Balance | undefined) => (b ? plus(b.totalEquity ?? b.equity, b.borrowings) : undefined)
  return a.years.map((y, i) => {
    const prev = a.years[i + 1]
    const yearBefore = prev && monthsBetween(prev.periodEnd, y.periodEnd) === 12 ? prev : undefined
    const b = bsAt(y.periodEnd)
    const bp = yearBefore ? bsAt(yearBefore.periodEnd) : undefined
    const avg = (f: (x: Balance | undefined) => number | undefined) => {
      const x = f(b)
      const z = f(bp)
      return typeof x === 'number' ? (typeof z === 'number' ? (x + z) / 2 : x) : undefined
    }
    const rev = revenueOf(y)
    const revPrev = yearBefore ? revenueOf(yearBefore) : undefined
    return {
      periodEnd: y.periodEnd,
      roce: a.bank || y.pbt === undefined ? null : div(y.pbt + (y.finance ?? 0), avg(capital)),
      roe: div(profitOf(y), avg((x) => num(x?.equity))),
      salesGrowth: typeof rev === 'number' && typeof revPrev === 'number' && revPrev > 0 ? rev / revPrev - 1 : null
    }
  })
}

export function fundamentalsOf(filings: Filing[]): Fundamentals {
  const a = arrange(filings)
  const latest = filings.filter((f) => f.basis === a.basis).sort((x, y) => y.periodEnd.localeCompare(x.periodEnd))[0]
  const m = computeMetrics(a, null, { capital: latest?.shareCapital ?? null, face: latest?.faceValue ?? null })
  const last4 = a.quarters.slice(0, 4)
  const consecutive =
    last4.length === 4 && last4.every((q, i) => i === 0 || monthsBetween(q.periodEnd, last4[i - 1].periodEnd) === 3)
  const ttm = consecutive ? addFlows(last4) : null
  const yr = yearlyRatios(a).slice(0, 5)
  const worst = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null)
    return v.length >= 3 ? Math.min(...v) : null
  }
  const bs = a.balances[0]
  const lastYear = a.years[0]
  return {
    bank: a.bank,
    latestPeriod: a.quarters[0]?.periodEnd ?? null,
    years: a.years.length,
    shares: m.shares,
    equity: bs?.equity ?? null,
    borrowings: bs ? (bs.borrowings ?? 0) : null,
    cash: bs?.cash ?? null,
    ttmRevenue: m.ttmRevenue,
    ttmProfit: m.ttmProfit,
    ttmEbit: ttm && ttm.pbt !== undefined ? ttm.pbt + (ttm.finance ?? 0) : null,
    epsTtm: m.epsTtm,
    opm: m.opm,
    roe: m.roe,
    roce: m.roce,
    debtToEquity: m.debtToEquity,
    currentRatio: m.currentRatio,
    interestCover: m.interestCover,
    salesGrowth3y: m.salesGrowth3y,
    profitGrowth3y: m.profitGrowth3y,
    salesGrowthQ: m.salesGrowthQ,
    profitGrowthQ: m.profitGrowthQ,
    piotroski: m.piotroski?.score ?? null,
    roceMin5: worst(yr.map((y) => y.roce)),
    salesGrowthMin5: worst(yr.map((y) => y.salesGrowth)),
    dividendsFy: lastYear?.dividendsPaid !== undefined ? Math.abs(lastYear.dividendsPaid) : null
  }
}

/** The price-history figures a screener row carries (all null until the history is downloaded). */
export type TechFields = Omit<Technicals, 'date' | 'momentum'>
export const NO_TECHNICALS: TechFields = {
  ret1w: null,
  ret1m: null,
  ret3m: null,
  ret6m: null,
  ret1y: null,
  rsi14: null,
  vsSma50: null,
  vsSma200: null,
  sma50vs200: null,
  crossDays: null,
  volumeSpike: null,
  delivPct: null,
  delivSpike: null,
  turnover20: null,
  newHigh: null,
  volatility: null,
  drawdown1y: null,
  rsRating: null
}

/** One company in the screener: its fundamentals and price history with the day's price worked in. */
export interface ScreenRow extends Fundamentals, TechFields {
  symbol: string
  name: string
  industry: string | null
  held: boolean
  close: number | null
  change: number | null
  mcap: number | null
  pe: number | null
  pb: number | null
  /** EBIT against enterprise value (market cap plus debt less cash): Greenblatt's earnings yield. */
  earningsYield: number | null
  dividendYield: number | null
  /** How far below the 52-week high (negative). */
  fromHigh: number | null
  /** Price against Graham's number, √(22.5 × EPS × book value a share): below 0 is under it. */
  toGraham: number | null
}

export function screenRow(
  base: { symbol: string; name: string; industry: string | null; held: boolean },
  f: Fundamentals,
  q: DayQuote | null,
  t: Technicals | null = null
): ScreenRow {
  const tech: TechFields = { ...NO_TECHNICALS }
  if (t) for (const k of Object.keys(NO_TECHNICALS) as (keyof TechFields)[]) tech[k] = t[k]
  const close = q?.close ?? null
  const mcap = q?.mcap ?? (close !== null && f.shares ? close * f.shares : null)
  const pe = q?.pe ?? (mcap && f.ttmProfit && f.ttmProfit > 0 ? mcap / f.ttmProfit : null)
  const ev = mcap !== null && !f.bank ? mcap + (f.borrowings ?? 0) - (f.cash ?? 0) : null
  const bv = f.equity && f.shares ? f.equity / f.shares : null
  const graham = f.epsTtm && f.epsTtm > 0 && bv && bv > 0 ? Math.sqrt(22.5 * f.epsTtm * bv) : null
  return {
    ...base,
    ...f,
    ...tech,
    close,
    change: q?.prevClose && close !== null ? close / q.prevClose - 1 : null,
    mcap,
    pe,
    pb: mcap && f.equity && f.equity > 0 ? mcap / f.equity : null,
    earningsYield: ev && ev > 0 && f.ttmEbit !== null ? f.ttmEbit / ev : null,
    dividendYield: mcap && f.dividendsFy !== null ? f.dividendsFy / mcap : null,
    fromHigh: close !== null && q?.high52 ? close / q.high52 - 1 : null,
    toGraham: close !== null && graham ? close / graham - 1 : null
  }
}

/** Fundamentals for a company with no results stored: price-only figures still screen. */
export const NO_FUNDAMENTALS: Fundamentals = {
  bank: false,
  latestPeriod: null,
  years: 0,
  shares: null,
  equity: null,
  borrowings: null,
  cash: null,
  ttmRevenue: null,
  ttmProfit: null,
  ttmEbit: null,
  epsTtm: null,
  opm: null,
  roe: null,
  roce: null,
  debtToEquity: null,
  currentRatio: null,
  interestCover: null,
  salesGrowth3y: null,
  profitGrowth3y: null,
  salesGrowthQ: null,
  profitGrowthQ: null,
  piotroski: null,
  roceMin5: null,
  salesGrowthMin5: null,
  dividendsFy: null
}

export type FieldKey = keyof ScreenRow
export type FieldKind = 'pct' | 'times' | 'money' | 'rs' | 'score' | 'ratio' | 'count'
export interface ScreenField {
  key: FieldKey
  label: string
  /** Column heading. */
  short: string
  kind: FieldKind
  /** Which way is better, for sorting a column the first time. */
  better: 'high' | 'low'
  help: string
}

export const SCREEN_FIELDS: ScreenField[] = [
  { key: 'mcap', label: 'Market cap', short: 'M cap', kind: 'money', better: 'high', help: 'Price times shares, from NSE' },
  { key: 'close', label: 'Price', short: 'Price', kind: 'rs', better: 'high', help: 'Last close' },
  { key: 'change', label: 'Change today', short: 'Day', kind: 'pct', better: 'high', help: 'Against the previous close' },
  { key: 'pe', label: 'P/E', short: 'P/E', kind: 'times', better: 'low', help: 'Price against the last four quarters’ profit' },
  { key: 'pb', label: 'Price to book', short: 'P/B', kind: 'times', better: 'low', help: 'Market cap against shareholders’ equity' },
  { key: 'earningsYield', label: 'Earnings yield (EBIT/EV)', short: 'EY', kind: 'pct', better: 'high', help: 'Profit before interest and tax against market cap plus debt less cash' },
  { key: 'dividendYield', label: 'Dividend yield', short: 'Div', kind: 'pct', better: 'high', help: 'Last year’s dividends paid against market cap' },
  { key: 'roe', label: 'ROE', short: 'ROE', kind: 'pct', better: 'high', help: 'Last year’s profit against shareholders’ equity' },
  { key: 'roce', label: 'ROCE', short: 'ROCE', kind: 'pct', better: 'high', help: 'Profit before interest and tax against equity plus debt' },
  { key: 'roceMin5', label: 'ROCE, weakest of 5 years', short: 'ROCE 5y min', kind: 'pct', better: 'high', help: 'The lowest yearly ROCE in the last five years' },
  { key: 'opm', label: 'Operating margin', short: 'OPM', kind: 'pct', better: 'high', help: 'Last four quarters' },
  { key: 'debtToEquity', label: 'Debt to equity', short: 'D/E', kind: 'ratio', better: 'low', help: 'Borrowings against equity' },
  { key: 'currentRatio', label: 'Current ratio', short: 'CR', kind: 'ratio', better: 'high', help: 'Current assets against current liabilities' },
  { key: 'interestCover', label: 'Interest cover', short: 'Int cov', kind: 'times', better: 'high', help: 'Profit before interest and tax against interest' },
  { key: 'salesGrowthQ', label: 'Sales growth, latest quarter', short: 'Sales Q', kind: 'pct', better: 'high', help: 'Against the same quarter a year before' },
  { key: 'profitGrowthQ', label: 'Profit growth, latest quarter', short: 'Profit Q', kind: 'pct', better: 'high', help: 'Against the same quarter a year before' },
  { key: 'salesGrowth3y', label: 'Sales growth, 3 years', short: 'Sales 3y', kind: 'pct', better: 'high', help: 'A year, compounded' },
  { key: 'profitGrowth3y', label: 'Profit growth, 3 years', short: 'Profit 3y', kind: 'pct', better: 'high', help: 'A year, compounded' },
  { key: 'salesGrowthMin5', label: 'Sales growth, slowest of 5 years', short: 'Sales 5y min', kind: 'pct', better: 'high', help: 'The slowest year’s sales growth in the last five' },
  { key: 'piotroski', label: 'Piotroski score', short: 'F-score', kind: 'score', better: 'high', help: 'Nine checks of financial strength, 0 to 9' },
  { key: 'ttmRevenue', label: 'Sales, last 4 quarters', short: 'Sales', kind: 'money', better: 'high', help: 'Total income for banks' },
  { key: 'ttmProfit', label: 'Profit, last 4 quarters', short: 'Profit', kind: 'money', better: 'high', help: 'Belonging to the company’s shareholders' },
  { key: 'fromHigh', label: 'From 52-week high', short: 'vs high', kind: 'pct', better: 'low', help: 'Negative: below the high' },
  { key: 'toGraham', label: 'Price against Graham number', short: 'vs Graham', kind: 'pct', better: 'low', help: 'Below 0: priced under √(22.5 × EPS × book value)' },
  { key: 'years', label: 'Years of results', short: 'Years', kind: 'count', better: 'high', help: 'Full years filed with NSE as XBRL' },
  // From the daily price history.
  { key: 'ret1w', label: 'Return, 1 week', short: '1W', kind: 'pct', better: 'high', help: 'Price change over 5 trading days, adjusted for splits and bonuses' },
  { key: 'ret1m', label: 'Return, 1 month', short: '1M', kind: 'pct', better: 'high', help: 'Over 21 trading days' },
  { key: 'ret3m', label: 'Return, 3 months', short: '3M', kind: 'pct', better: 'high', help: 'Over 63 trading days' },
  { key: 'ret6m', label: 'Return, 6 months', short: '6M', kind: 'pct', better: 'high', help: 'Over 126 trading days' },
  { key: 'ret1y', label: 'Return, 1 year', short: '1Y', kind: 'pct', better: 'high', help: 'Over 250 trading days' },
  { key: 'rsRating', label: 'Relative strength (1–99)', short: 'RS', kind: 'score', better: 'high', help: 'The last year’s return, latest quarter counting double, ranked against every stock' },
  { key: 'rsi14', label: 'RSI (14 days)', short: 'RSI', kind: 'times', better: 'low', help: 'Below 30 is usually read as oversold, above 70 as overbought' },
  { key: 'vsSma50', label: 'Price vs 50-day average', short: 'vs 50D', kind: 'pct', better: 'high', help: 'Above 0: trading above its 50-day average' },
  { key: 'vsSma200', label: 'Price vs 200-day average', short: 'vs 200D', kind: 'pct', better: 'high', help: 'Above 0: trading above its 200-day average' },
  { key: 'sma50vs200', label: '50-day vs 200-day average', short: '50/200', kind: 'pct', better: 'high', help: 'Above 0: the 50-day average is over the 200-day (a golden-cross state)' },
  { key: 'crossDays', label: 'Days since the 50/200 cross', short: 'Cross d', kind: 'count', better: 'low', help: 'Trading days since the 50-day average last crossed the 200-day' },
  { key: 'volumeSpike', label: 'Volume vs 20-day average', short: 'Vol ×', kind: 'ratio', better: 'high', help: '2 means twice the usual volume today' },
  { key: 'delivPct', label: 'Delivery %', short: 'Deliv', kind: 'times', better: 'high', help: 'Share of today’s traded quantity taken as delivery' },
  { key: 'delivSpike', label: 'Delivery % vs 20-day average', short: 'Deliv ×', kind: 'ratio', better: 'high', help: 'Above 1: more delivery than usual' },
  { key: 'turnover20', label: 'Traded value a day (20-day average)', short: 'Value/day', kind: 'money', better: 'high', help: 'How easily the stock can be bought and sold' },
  { key: 'newHigh', label: 'At a 52-week closing high', short: '52W high', kind: 'count', better: 'high', help: '1 when today’s close is the highest of the past year' },
  { key: 'volatility', label: 'Volatility (yearly)', short: 'Volatility', kind: 'pct', better: 'low', help: 'Spread of daily moves over the past year, scaled to a year' },
  { key: 'drawdown1y', label: 'Worst fall in the past year', short: 'Max fall', kind: 'pct', better: 'high', help: 'Deepest drop from a peak in the last 12 months' }
]

export interface ScreenFilter {
  field: FieldKey
  op: '>=' | '<='
  /** In the field's own terms: a fraction for percentages (0.15 = 15%), rupees for money. */
  value: number
}

export interface Screen {
  name: string
  about: string
  filters: ScreenFilter[]
  sort: { field: FieldKey; dir: 'asc' | 'desc' }
  /** Leave out banks and other lenders (their debt is their business). */
  noLenders?: boolean
  /** Greenblatt's ranking: earnings yield rank plus ROCE rank. */
  rank?: 'magic'
}

const CR = 1e7
export const PRESET_SCREENS: Screen[] = [
  {
    name: 'Piotroski 7 and up',
    about: 'Strong on at least seven of Piotroski’s nine checks: profitable, cash-generating, less debt, better margins.',
    filters: [
      { field: 'piotroski', op: '>=', value: 7 },
      { field: 'mcap', op: '>=', value: 500 * CR }
    ],
    sort: { field: 'piotroski', dir: 'desc' }
  },
  {
    name: 'Magic Formula',
    about: 'Greenblatt: good businesses (high ROCE) at low prices (high earnings yield), ranked on both. Lenders left out.',
    filters: [
      { field: 'mcap', op: '>=', value: 1000 * CR },
      { field: 'roce', op: '>=', value: 0 },
      { field: 'earningsYield', op: '>=', value: 0 }
    ],
    sort: { field: 'earningsYield', dir: 'desc' },
    noLenders: true,
    rank: 'magic'
  },
  {
    name: 'Coffee Can',
    about: 'Sales up 10% or more every year and ROCE of 15% or more every year, over five years.',
    filters: [
      { field: 'salesGrowthMin5', op: '>=', value: 0.1 },
      { field: 'roceMin5', op: '>=', value: 0.15 },
      { field: 'mcap', op: '>=', value: 1000 * CR }
    ],
    sort: { field: 'roceMin5', dir: 'desc' },
    noLenders: true
  },
  {
    name: 'Low debt, high ROCE',
    about: 'Almost no borrowing and a return on capital of 20% or more.',
    filters: [
      { field: 'debtToEquity', op: '<=', value: 0.1 },
      { field: 'roce', op: '>=', value: 0.2 },
      { field: 'mcap', op: '>=', value: 500 * CR }
    ],
    sort: { field: 'roce', dir: 'desc' },
    noLenders: true
  },
  {
    name: 'Quality at a fair price',
    about: 'ROE of 15% or more and profit growing 12% a year, at a P/E of 25 or less with modest debt.',
    filters: [
      { field: 'roe', op: '>=', value: 0.15 },
      { field: 'profitGrowth3y', op: '>=', value: 0.12 },
      { field: 'pe', op: '>=', value: 0.1 },
      { field: 'pe', op: '<=', value: 25 },
      { field: 'debtToEquity', op: '<=', value: 0.5 }
    ],
    sort: { field: 'roe', dir: 'desc' }
  },
  {
    name: 'Graham value',
    about: 'Graham’s defensive tests: P/E of 15 or less, price under 1.5 times book, current ratio of 1.5 or more.',
    filters: [
      { field: 'pe', op: '>=', value: 0.1 },
      { field: 'pe', op: '<=', value: 15 },
      { field: 'pb', op: '<=', value: 1.5 },
      { field: 'currentRatio', op: '>=', value: 1.5 }
    ],
    sort: { field: 'toGraham', dir: 'asc' },
    noLenders: true
  },
  {
    name: 'Fast growers',
    about: 'Sales and profit both up 20% or more on the same quarter last year.',
    filters: [
      { field: 'salesGrowthQ', op: '>=', value: 0.2 },
      { field: 'profitGrowthQ', op: '>=', value: 0.2 },
      { field: 'mcap', op: '>=', value: 500 * CR }
    ],
    sort: { field: 'profitGrowthQ', dir: 'desc' }
  },
  {
    name: 'Strong but well off the high',
    about: 'ROE of 15% or more and little debt, priced 30% or more below the 52-week high.',
    filters: [
      { field: 'fromHigh', op: '<=', value: -0.3 },
      { field: 'roe', op: '>=', value: 0.15 },
      { field: 'debtToEquity', op: '<=', value: 0.5 }
    ],
    sort: { field: 'fromHigh', dir: 'asc' }
  },
  {
    name: 'Momentum leaders',
    about: 'Relative strength of 85 or more, above the 200-day average, and traded enough to buy and sell easily.',
    filters: [
      { field: 'rsRating', op: '>=', value: 85 },
      { field: 'vsSma200', op: '>=', value: 0 },
      { field: 'turnover20', op: '>=', value: 5 * CR }
    ],
    sort: { field: 'rsRating', dir: 'desc' }
  },
  {
    name: '52-week high on volume',
    about: 'Closed at a one-year high today on at least one and a half times the usual volume.',
    filters: [
      { field: 'newHigh', op: '>=', value: 1 },
      { field: 'volumeSpike', op: '>=', value: 1.5 },
      { field: 'mcap', op: '>=', value: 500 * CR }
    ],
    sort: { field: 'volumeSpike', dir: 'desc' }
  },
  {
    name: 'Fresh golden cross',
    about: 'The 50-day average crossed above the 200-day within the last 10 trading days.',
    filters: [
      { field: 'sma50vs200', op: '>=', value: 0 },
      { field: 'crossDays', op: '<=', value: 10 },
      { field: 'mcap', op: '>=', value: 500 * CR }
    ],
    sort: { field: 'crossDays', dir: 'asc' }
  },
  {
    name: 'Quality, oversold',
    about: 'ROE of 15% or more and little debt, with RSI under 35 after a fall.',
    filters: [
      { field: 'rsi14', op: '<=', value: 35 },
      { field: 'roe', op: '>=', value: 0.15 },
      { field: 'debtToEquity', op: '<=', value: 0.5 }
    ],
    sort: { field: 'rsi14', dir: 'asc' }
  },
  {
    name: 'Delivery build-up',
    about: 'Delivery % well above its usual level on higher volume: shares changing hands to be held.',
    filters: [
      { field: 'delivSpike', op: '>=', value: 1.5 },
      { field: 'volumeSpike', op: '>=', value: 1.5 },
      { field: 'turnover20', op: '>=', value: 2 * CR }
    ],
    sort: { field: 'delivSpike', dir: 'desc' }
  },
  {
    name: 'Dividend payers',
    about: 'Dividend yield of 2.5% or more from companies earning 12% or more on equity.',
    filters: [
      { field: 'dividendYield', op: '>=', value: 0.025 },
      { field: 'roe', op: '>=', value: 0.12 }
    ],
    sort: { field: 'dividendYield', dir: 'desc' }
  }
]

export const isLender = (r: Pick<ScreenRow, 'bank' | 'industry'>) =>
  r.bank || /financ|bank|nbfc|insurance/i.test(r.industry ?? '')

/** The rows passing every filter, sorted (or ranked, for the Magic Formula). A missing figure fails its filter. */
export function applyScreen(rows: ScreenRow[], s: Pick<Screen, 'filters' | 'sort' | 'noLenders' | 'rank'>): ScreenRow[] {
  const passed = rows.filter((r) => {
    if (s.noLenders && isLender(r)) return false
    return s.filters.every((f) => {
      const v = r[f.field]
      if (typeof v !== 'number' || !Number.isFinite(v)) return false
      return f.op === '>=' ? v >= f.value : v <= f.value
    })
  })
  if (s.rank === 'magic') {
    const rankBy = (k: 'earningsYield' | 'roce') =>
      new Map([...passed].sort((a, b) => (b[k] ?? -Infinity) - (a[k] ?? -Infinity)).map((r, i) => [r.symbol, i]))
    const ey = rankBy('earningsYield')
    const rc = rankBy('roce')
    return passed.sort((a, b) => ey.get(a.symbol)! + rc.get(a.symbol)! - (ey.get(b.symbol)! + rc.get(b.symbol)!))
  }
  return sortRows(passed, s.sort.field, s.sort.dir)
}

export function sortRows(rows: ScreenRow[], field: FieldKey, dir: 'asc' | 'desc'): ScreenRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[field]
    const y = b[field]
    if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * sign
    if (typeof x !== 'number' || !Number.isFinite(x)) return typeof y === 'number' && Number.isFinite(y) ? 1 : 0
    if (typeof y !== 'number' || !Number.isFinite(y)) return -1
    return (x - y) * sign
  })
}

export interface ScreenData {
  rows: ScreenRow[]
  /** Listed companies, and how many have results stored so far. */
  companies: number
  withResults: number
  pricesDate: string | null
}

/** Index levels from NSE's daily file. */
export interface IndexLevel {
  name: string
  date: string
  close: number
  prevClose: number | null
  high52: number | null
  low52: number | null
}

export interface MarketMonitor {
  date: string | null
  indices: IndexLevel[]
  breadth: { up: number; down: number; flat: number; atHigh: number; atLow: number }
  gainers: ScreenRow[]
  losers: ScreenRow[]
  /** Nifty 500 industries: market cap and the day's move, weighted by market cap. */
  sectors: { name: string; mcap: number; change: number | null; count: number }[]
  yours: ScreenRow[]
}

export interface WorldSeries {
  key: string
  label: string
  points: { date: string; close: number }[]
}
