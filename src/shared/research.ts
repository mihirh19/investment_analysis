// The research desk: company financials from the results companies file with NSE (XBRL),
// plus NSE's daily price, market-cap and P/E files. All amounts are whole rupees.

/** Consolidated (group) or standalone (the listed company alone). */
export type Basis = 'C' | 'S'

/** Figures over a period: one quarter, or the year so far. Missing figures are left out. */
export interface Flow {
  revenue?: number
  otherIncome?: number
  totalIncome?: number
  expenses?: number
  /** Raw materials, goods bought for resale and the change in stock. */
  materials?: number
  employee?: number
  finance?: number
  depreciation?: number
  otherExpenses?: number
  /** Before interest, depreciation, other income and one-offs (EBITDA); for banks, before provisions. */
  operatingProfit?: number
  /** Banks only. */
  interestEarned?: number
  interestExpended?: number
  provisions?: number
  exceptional?: number
  pbt?: number
  tax?: number
  netProfit?: number
  /** Profit belonging to the company's own shareholders (after minority interest). */
  ownersProfit?: number
  eps?: number
  /** Cash flow, filed with half-year and full-year results. */
  cfo?: number
  cfi?: number
  cff?: number
  capex?: number
  dividendsPaid?: number
}

/** The balance sheet on the period's last day, filed with half-year and full-year results. */
export interface Balance {
  assets?: number
  currentAssets?: number
  cash?: number
  investments?: number
  inventories?: number
  receivables?: number
  fixedAssets?: number
  /** Belonging to the company's own shareholders. */
  equity?: number
  /** Including minority interest. */
  totalEquity?: number
  borrowings?: number
  currentLiabilities?: number
  payables?: number
  /** Banks only. */
  deposits?: number
  advances?: number
}

/** One results filing, read. */
export interface Filing {
  symbol: string
  periodEnd: string
  basis: Basis
  bank: boolean
  /** Months covered by `ytd` (3, 6, 9 or 12). */
  months: number
  quarter: Flow
  ytd: Flow
  balance: Balance | null
  shareCapital: number | null
  faceValue: number | null
}

/** One row of NSE's end-of-day files. */
export interface DayQuote {
  symbol: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  prevClose: number | null
  high52: number | null
  low52: number | null
  volume: number | null
  mcap: number | null
  pe: number | null
}

export interface QuarterRow extends Flow {
  periodEnd: string
  basis: Basis
}
export interface YearRow extends Flow {
  periodEnd: string
  basis: Basis
}
export interface BalanceRow extends Balance {
  periodEnd: string
  basis: Basis
}

export interface PiotroskiTest {
  label: string
  pass: boolean
}

export interface Metrics {
  mcap: number | null
  pe: number | null
  pb: number | null
  shares: number | null
  bookValue: number | null
  ttmRevenue: number | null
  ttmProfit: number | null
  epsTtm: number | null
  opm: number | null
  roe: number | null
  roce: number | null
  debtToEquity: number | null
  currentRatio: number | null
  interestCover: number | null
  salesGrowth3y: number | null
  profitGrowth3y: number | null
  /** The latest quarter against the same quarter a year earlier. */
  salesGrowthQ: number | null
  profitGrowthQ: number | null
  piotroski: { score: number; tests: PiotroskiTest[]; year: string } | null
}

export interface CompanyHeld {
  quantity: number
  valueInr: number
  people: string[]
}

export interface CompanyView {
  symbol: string
  name: string
  isin: string | null
  industry: string | null
  bank: boolean
  quote: DayQuote | null
  basis: Basis | null
  /** Bases with stored results; the page offers a switch when both exist. */
  bases: Basis[]
  quarters: QuarterRow[]
  years: YearRow[]
  balances: BalanceRow[]
  metrics: Metrics
  held: CompanyHeld | null
  /** Where this company's results download stands. */
  results: { state: 'DONE' | 'WAITING' | 'NONE'; stored: number; checkedAt: string | null; error: string | null }
}

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '1d'

export interface ChartBars {
  symbol: string
  interval: ChartInterval
  bars: { time: string | number; open: number; high: number; low: number; close: number; volume: number | null }[]
  currency: string
  /** Intraday bars come from Yahoo Finance with a delay. */
  delayed: boolean
}

/** A watchlist line: the latest price (delayed) and the day so far. */
export interface LiveQuote {
  symbol: string
  price: number
  prevClose: number | null
  change: number | null
  /** ISO time of the price. */
  time: string
  /** The day's 5-minute closes, for a sparkline. */
  points: number[]
}

/** A saved research workspace: its name and dockview's layout (panels, splits, tabs) as JSON. */
export interface SavedWorkspace {
  id: string
  name: string
  layout: unknown
}

export interface Watchlist {
  id: number
  name: string
  symbols: string[]
}

/** A sheet for Excel export: a header row, then data rows. */
export interface ExcelSheet {
  name: string
  rows: (string | number | null)[][]
}

export interface CompanyHit {
  symbol: string
  name: string
  held: boolean
}

export interface ResearchStatus {
  enabled: boolean
  state: 'RUNNING' | 'PAUSED' | 'DONE' | 'WAITING'
  companies: number
  companiesDone: number
  filings: number
  /** Minutes left at the current pace, while downloading. */
  etaMinutes: number | null
  pricesDate: string | null
  /** Daily price history: trading days stored, out of about `want`. */
  history: { days: number; first: string | null; last: string | null; want: number }
  lastError: string | null
  current: string | null
}

export interface ResearchRow {
  symbol: string
  name: string
  industry: string | null
  close: number | null
  change: number | null
  mcap: number | null
  pe: number | null
  roe: number | null
  salesGrowthQ: number | null
  held: CompanyHeld | null
}

export interface ResearchHome {
  status: ResearchStatus
  yours: ResearchRow[]
}

const sum = (...xs: (number | undefined)[]): number | undefined => {
  const vals = xs.filter((x): x is number => typeof x === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
}

/** Adds each figure across periods (the TTM or a missing year built from its quarters). */
export function addFlows(flows: Flow[]): Flow {
  const out: Flow = {}
  for (const f of flows)
    for (const [k, v] of Object.entries(f) as [keyof Flow, number][]) {
      if (k === 'eps') continue
      out[k] = (out[k] ?? 0) + v
    }
  const eps = flows.map((f) => f.eps)
  if (eps.every((e) => typeof e === 'number')) out.eps = sum(...eps)
  return out
}

/** Months between two month-end dates. */
export function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

/** "FY26" for a year ending 31 Mar 2026. */
export function fyLabel(periodEnd: string): string {
  const y = Number(periodEnd.slice(0, 4)) + (Number(periodEnd.slice(5, 7)) > 3 ? 1 : 0)
  return `FY${String(y).slice(2)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sep 26" for a quarter ending 30 Sep 2026. */
export function quarterLabel(periodEnd: string): string {
  return `${MONTHS[Number(periodEnd.slice(5, 7)) - 1]} ${periodEnd.slice(2, 4)}`
}

const profitOf = (f: Flow) => f.ownersProfit ?? f.netProfit
const revenueOf = (f: Flow) => f.revenue ?? f.totalIncome
const div = (a: number | undefined | null, b: number | undefined | null) =>
  typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : null
const cagr = (from: number | undefined, to: number | undefined, years: number) =>
  typeof from === 'number' && typeof to === 'number' && from > 0 && to > 0 ? (to / from) ** (1 / years) - 1 : null

/**
 * Picks one basis per period (consolidated where filed, else standalone) and lays the filings out
 * as quarters, years and balance sheets, newest first.
 */
export function arrange(filings: Filing[], prefer: Basis | null = null) {
  const bases = [...new Set(filings.map((f) => f.basis))].sort() as Basis[]
  const byPeriod = new Map<string, Filing>()
  const want = prefer ?? (bases.includes('C') ? 'C' : 'S')
  for (const f of filings) {
    const cur = byPeriod.get(f.periodEnd)
    if (!cur || (cur.basis !== want && f.basis === want)) byPeriod.set(f.periodEnd, f)
  }
  const chosen = [...byPeriod.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
  const quarters: QuarterRow[] = chosen
    .filter((f) => Object.keys(f.quarter).length > 0)
    .map((f) => ({ ...withoutCash(f.quarter), periodEnd: f.periodEnd, basis: f.basis }))
  const years: YearRow[] = []
  for (const f of chosen) {
    if (f.periodEnd.slice(5, 7) !== '03') continue
    if (f.months === 12 && Object.keys(f.ytd).length) {
      years.push({ ...f.ytd, periodEnd: f.periodEnd, basis: f.basis })
      continue
    }
    // No full-year figures in the filing: add up its four quarters when all were filed.
    const four = quarters.filter((q) => {
      const m = monthsBetween(q.periodEnd, f.periodEnd)
      return m >= 0 && m < 12
    })
    if (four.length === 4) years.push({ ...addFlows(four), periodEnd: f.periodEnd, basis: f.basis })
  }
  const balances: BalanceRow[] = chosen
    .filter((f) => f.balance && Object.keys(f.balance).length > 0)
    .map((f) => ({ ...f.balance!, periodEnd: f.periodEnd, basis: f.basis }))
  return { basis: chosen.length ? want : null, bases, quarters, years, balances, bank: chosen.some((f) => f.bank) }
}

function withoutCash(f: Flow): Flow {
  const { cfo: _o, cfi: _i, cff: _f, capex: _c, dividendsPaid: _d, ...rest } = f
  return rest
}

/** Ratios from the arranged filings and the day's quote. Anything that can't be worked out is null. */
export function computeMetrics(
  a: ReturnType<typeof arrange>,
  quote: DayQuote | null,
  share: { capital: number | null; face: number | null }
): Metrics {
  const { quarters, years, balances, bank } = a
  // The trailing twelve months: the latest four quarters, if they are consecutive.
  const last4 = quarters.slice(0, 4)
  const consecutive =
    last4.length === 4 && last4.every((q, i) => i === 0 || monthsBetween(q.periodEnd, last4[i - 1].periodEnd) === 3)
  const ttm = consecutive ? addFlows(last4) : null
  const bs = balances[0] ?? null
  const shares = div(share.capital, share.face)
  const mcap = quote?.mcap ?? (quote && shares ? quote.close * shares : null)
  const ttmProfit = ttm ? (profitOf(ttm) ?? null) : null
  const pe = quote?.pe ?? (mcap && ttmProfit && ttmProfit > 0 ? mcap / ttmProfit : null)

  const fy = years[0]
  const fyPrev = years[1]
  const bsAt = (end: string | undefined) => balances.find((b) => b.periodEnd === end)
  const avg = (x: number | undefined, y: number | undefined) =>
    typeof x === 'number' ? (typeof y === 'number' ? (x + y) / 2 : x) : undefined
  const bsFy = bsAt(fy?.periodEnd)
  const bsFyPrev = bsAt(fyPrev?.periodEnd)
  const roe = fy ? div(profitOf(fy), avg(bsFy?.equity, bsFyPrev?.equity)) : null
  const capital = (b: Balance | undefined) => (b ? sum(b.totalEquity ?? b.equity, b.borrowings) : undefined)
  const roce =
    !bank && fy && fy.pbt !== undefined
      ? div(fy.pbt + (fy.finance ?? 0), avg(capital(bsFy), capital(bsFyPrev)))
      : null

  const q0 = quarters[0]
  const qYearAgo = q0 ? quarters.find((q) => monthsBetween(q.periodEnd, q0.periodEnd) === 12) : undefined
  const growth = (now: number | undefined, then: number | undefined) =>
    typeof now === 'number' && typeof then === 'number' && then > 0 ? now / then - 1 : null
  const y3 = years.find((y) => fy && monthsBetween(y.periodEnd, fy.periodEnd) === 36)

  return {
    mcap,
    pe,
    pb: div(mcap, bs?.equity),
    shares,
    bookValue: div(bs?.equity, shares),
    ttmRevenue: ttm ? (revenueOf(ttm) ?? null) : null,
    ttmProfit,
    epsTtm: ttm?.eps ?? null,
    opm: ttm ? div(ttm.operatingProfit, revenueOf(ttm)) : null,
    roe,
    roce,
    debtToEquity: bank ? null : div(bs?.borrowings ?? 0, bs?.totalEquity ?? bs?.equity),
    currentRatio: bank ? null : div(bs?.currentAssets, bs?.currentLiabilities),
    interestCover:
      bank || !ttm || !ttm.finance || ttm.pbt === undefined ? null : (ttm.pbt + ttm.finance) / ttm.finance,
    salesGrowth3y: fy && y3 ? cagr(revenueOf(y3), revenueOf(fy), 3) : null,
    profitGrowth3y: fy && y3 ? cagr(profitOf(y3), profitOf(fy), 3) : null,
    salesGrowthQ: q0 && qYearAgo ? growth(revenueOf(q0), revenueOf(qYearAgo)) : null,
    profitGrowthQ: q0 && qYearAgo ? growth(profitOf(q0), profitOf(qYearAgo)) : null,
    piotroski: bank ? null : piotroski(fy, fyPrev, bsFy, bsFyPrev)
  }
}

/** Piotroski's nine yes/no checks of financial strength, comparing the last two years. */
export function piotroski(
  y: YearRow | undefined,
  p: YearRow | undefined,
  b: Balance | undefined,
  bp: Balance | undefined
): Metrics['piotroski'] {
  if (!y || !p || !b || !bp || !b.assets || !bp.assets) return null
  const ni = profitOf(y)
  const niP = profitOf(p)
  const rev = revenueOf(y)
  const revP = revenueOf(p)
  if (ni === undefined || niP === undefined || y.cfo === undefined || !rev || !revP) return null
  const roa = ni / b.assets
  const roaP = niP / bp.assets
  const lev = (b.borrowings ?? 0) / b.assets
  const levP = (bp.borrowings ?? 0) / bp.assets
  const cr = div(b.currentAssets, b.currentLiabilities)
  const crP = div(bp.currentAssets, bp.currentLiabilities)
  const m = div(y.operatingProfit, rev)
  const mP = div(p.operatingProfit, revP)
  const tests: PiotroskiTest[] = [
    { label: 'Made a profit', pass: ni > 0 },
    { label: 'Cash from operations was positive', pass: y.cfo > 0 },
    { label: 'Return on assets went up', pass: roa > roaP },
    { label: 'Cash from operations beat profit', pass: y.cfo > ni },
    { label: 'Debt fell against assets', pass: lev < levP || (lev === 0 && levP === 0) },
    { label: 'Current ratio went up', pass: cr !== null && crP !== null && cr > crP },
    { label: 'No new shares issued', pass: (b.equity ?? 0) > 0 && !sharesRose(y, p) },
    { label: 'Operating margin went up', pass: m !== null && mP !== null && m > mP },
    { label: 'Sales grew faster than assets', pass: rev / b.assets > revP / bp.assets }
  ]
  return { score: tests.filter((t) => t.pass).length, tests, year: fyLabel(y.periodEnd) }
}

// Shares issued shows up as a fall in EPS against profit; the filings carry share capital only per filing.
function sharesRose(y: YearRow, p: YearRow): boolean {
  const s = div(profitOf(y), y.eps)
  const sp = div(profitOf(p), p.eps)
  return s !== null && sp !== null && s > sp * 1.005
}
