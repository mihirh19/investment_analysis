// The mutual fund screener: every open-ended Direct Growth plan with AMFI's facts (size, costs,
// returns, riskometer) and figures worked out from its NAV history against an index that suits its
// category: volatility, Sharpe and Sortino ratios, beta, alpha, R², worst fall, up and down capture,
// and how often it beat the index over rolling years. Information for comparing funds, not advice.

export interface PricePt {
  date: string
  close: number
}

/** The yearly return a risk-free deposit is assumed to earn (about the 91-day T-bill). */
export const RISK_FREE = 0.065

export interface FundMetrics {
  /** Simple returns for a month to a year, then yearly (CAGR) for 3 and 5 years. */
  ret1m: number | null
  ret3m: number | null
  ret6m: number | null
  ret1y: number | null
  ret3y: number | null
  ret5y: number | null
  /** Yearly volatility of daily returns over (up to) three years. */
  vol: number | null
  sharpe: number | null
  sortino: number | null
  /** Worst fall from a peak over (up to) five years, negative. */
  maxDrawdown: number | null
  beta: number | null
  /** Jensen's alpha, a year: return beyond what its beta to the index explains. */
  alpha: number | null
  r2: number | null
  /** Months the index rose (fell): the fund's average move as a share of the index's, ×100. */
  upCapture: number | null
  downCapture: number | null
  /** Share of rolling one-year periods (last three years) in which the fund beat the index. */
  beatRate: number | null
  /** Years of NAV history used. */
  years: number
}

export const NO_METRICS: FundMetrics = {
  ret1m: null,
  ret3m: null,
  ret6m: null,
  ret1y: null,
  ret3y: null,
  ret5y: null,
  vol: null,
  sharpe: null,
  sortino: null,
  maxDrawdown: null,
  beta: null,
  alpha: null,
  r2: null,
  upCapture: null,
  downCapture: null,
  beatRate: null,
  years: 0
}

const DAY = 86400_000
const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY)

/** The last point on or before a date. */
function at(series: PricePt[], date: string): PricePt | null {
  let lo = 0
  let hi = series.length - 1
  let hit: PricePt | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid].date <= date) {
      hit = series[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit
}

const back = (iso: string, days: number) => new Date(Date.parse(iso) - days * DAY).toISOString().slice(0, 10)

function retOver(s: PricePt[], days: number, yearly: boolean): number | null {
  const last = s.at(-1)
  if (!last) return null
  const start = at(s, back(last.date, days))
  // The history must reach back that far (a week's slack for holidays).
  if (!start || Date.parse(last.date) - Date.parse(s[0].date) < (days - 7) * DAY) return null
  const r = last.close / start.close
  const yrs = yearsBetween(start.date, last.date)
  return yearly && yrs > 0 ? r ** (1 / yrs) - 1 : r - 1
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

/** Month-end values (the last point of each month), oldest first. */
export function monthEnds(s: PricePt[]): PricePt[] {
  const out: PricePt[] = []
  for (const p of s) {
    if (out.length && out.at(-1)!.date.slice(0, 7) === p.date.slice(0, 7)) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

export function computeFundMetrics(navIn: PricePt[], benchIn: PricePt[] | null, rf = RISK_FREE): FundMetrics {
  const nav = navIn.filter((p) => p.close > 0)
  if (nav.length < 30) return { ...NO_METRICS, years: nav.length ? yearsBetween(nav[0].date, nav.at(-1)!.date) : 0 }
  const last = nav.at(-1)!
  const years = yearsBetween(nav[0].date, last.date)
  const m: FundMetrics = {
    ...NO_METRICS,
    years,
    ret1m: retOver(nav, 30, false),
    ret3m: retOver(nav, 91, false),
    ret6m: retOver(nav, 182, false),
    ret1y: retOver(nav, 365, false),
    ret3y: retOver(nav, 3 * 365, true),
    ret5y: retOver(nav, 5 * 365, true)
  }

  // Worst fall over up to five years.
  const from5 = back(last.date, 5 * 365)
  let peak = 0
  let worst = 0
  for (const p of nav) {
    if (p.date < from5) continue
    peak = Math.max(peak, p.close)
    worst = Math.min(worst, p.close / peak - 1)
  }
  m.maxDrawdown = worst

  // Risk over up to three years of daily returns (at least one year needed).
  const from3 = back(last.date, 3 * 365)
  const recent = nav.filter((p) => p.date >= from3)
  if (yearsBetween(recent[0].date, last.date) < 0.95) return m
  const rets: number[] = []
  for (let i = 1; i < recent.length; i++) rets.push(recent[i].close / recent[i - 1].close - 1)
  const perYear = rets.length / yearsBetween(recent[0].date, last.date)
  m.vol = sd(rets) * Math.sqrt(perYear)
  const yearly = (last.close / recent[0].close) ** (1 / yearsBetween(recent[0].date, last.date)) - 1
  if (m.vol > 0) m.sharpe = (yearly - rf) / m.vol
  const dailyRf = (1 + rf) ** (1 / perYear) - 1
  const downs = rets.map((r) => Math.min(0, r - dailyRf))
  const downside = Math.sqrt(downs.reduce((a, b) => a + b * b, 0) / downs.length) * Math.sqrt(perYear)
  if (downside > 0) m.sortino = (yearly - rf) / downside

  if (!benchIn || benchIn.length < 30) return m
  const bench = benchIn.filter((p) => p.close > 0)
  // Daily returns on the days both have a price.
  const bBy = new Map(bench.map((p) => [p.date, p.close]))
  const common = recent.filter((p) => bBy.has(p.date))
  if (common.length < 120) return m
  const fr: number[] = []
  const br: number[] = []
  for (let i = 1; i < common.length; i++) {
    fr.push(common[i].close / common[i - 1].close - 1)
    br.push(bBy.get(common[i].date)! / bBy.get(common[i - 1].date)! - 1)
  }
  const mf = mean(fr)
  const mb = mean(br)
  let cov = 0
  let vb = 0
  let vf = 0
  for (let i = 0; i < fr.length; i++) {
    cov += (fr[i] - mf) * (br[i] - mb)
    vb += (br[i] - mb) ** 2
    vf += (fr[i] - mf) ** 2
  }
  if (vb > 0) {
    m.beta = cov / vb
    m.r2 = vf > 0 ? (cov * cov) / (vb * vf) : null
    const span = yearsBetween(common[0].date, common.at(-1)!.date)
    const fy = (common.at(-1)!.close / common[0].close) ** (1 / span) - 1
    const by = (bBy.get(common.at(-1)!.date)! / bBy.get(common[0].date)!) ** (1 / span) - 1
    m.alpha = fy - rf - m.beta * (by - rf)
  }

  // Up and down capture from monthly returns.
  const fMonths = monthEnds(common)
  const up: [number, number][] = []
  const down: [number, number][] = []
  for (let i = 1; i < fMonths.length; i++) {
    const f = fMonths[i].close / fMonths[i - 1].close - 1
    const b = bBy.get(fMonths[i].date)! / bBy.get(fMonths[i - 1].date)! - 1
    if (b > 0) up.push([f, b])
    else if (b < 0) down.push([f, b])
  }
  if (up.length >= 3) m.upCapture = (mean(up.map((x) => x[0])) / mean(up.map((x) => x[1]))) * 100
  if (down.length >= 3) m.downCapture = (mean(down.map((x) => x[0])) / mean(down.map((x) => x[1]))) * 100

  // Rolling one-year periods, a month apart, over the last three years.
  let wins = 0
  let n = 0
  for (const end of fMonths) {
    const start = back(end.date, 365)
    if (start < common[0].date) continue
    const fs = at(common, start)
    if (!fs) continue
    const bs = bBy.get(fs.date)
    if (!bs) continue
    n++
    if (end.close / fs.close > bBy.get(end.date)! / bs) wins++
  }
  if (n >= 6) m.beatRate = wins / n
  return m
}

// ---------------- the index each category is measured against ----------------

export interface Benchmark {
  symbol: string
  label: string
}

/** A fair index for a fund, from its AMFI category and name; null for debt and other funds where an equity index means nothing. */
export function benchmarkFor(category: string, name: string): Benchmark | null {
  const c = category.toLowerCase()
  const n = name.toLowerCase()
  if (/debt|liquid|gilt|money market|overnight|duration|credit|banking and psu|corporate bond|floater|arbitrage|fund of funds.*overseas|fof.*overseas|solution oriented|retirement/i.test(c) && !/equity|hybrid/.test(c))
    return null
  // Sector and theme funds against their sector.
  if (/sectoral|thematic|index|etf/.test(c)) {
    if (/bank|financial/.test(n)) return { symbol: '^NSEBANK', label: 'Nifty Bank' }
    if (/\bit\b|technology|digital|tech/.test(n)) return { symbol: '^CNXIT', label: 'Nifty IT' }
    if (/pharma|health/.test(n)) return { symbol: '^CNXPHARMA', label: 'Nifty Pharma' }
    if (/infra/.test(n)) return { symbol: '^CNXINFRA', label: 'Nifty Infra' }
    if (/fmcg|consum/.test(n)) return { symbol: '^CNXFMCG', label: 'Nifty FMCG' }
    if (/auto/.test(n)) return { symbol: '^CNXAUTO', label: 'Nifty Auto' }
    if (/psu|public sector/.test(n)) return { symbol: '^CNXPSUBANK', label: 'Nifty PSU Bank' }
    if (/next 50|junior/.test(n)) return { symbol: '^NSMIDCP', label: 'Nifty Next 50' }
    if (/small/.test(n)) return { symbol: '^CNXSC', label: 'Nifty Smallcap 100' }
    if (/mid/.test(n)) return { symbol: 'NIFTY_MIDCAP_100.NS', label: 'Nifty Midcap 100' }
    if (/nifty 50|nifty50|sensex|bse 100|nifty 100/.test(n)) return { symbol: '^NSEI', label: 'Nifty 50' }
    if (/nasdaq|s&p|us |global|world|international/.test(n)) return { symbol: '^GSPC', label: 'S&P 500 (in dollars)' }
  }
  if (/large cap/.test(c) && !/mid/.test(c)) return { symbol: '^NSEI', label: 'Nifty 50' }
  if (/mid cap/.test(c) && !/large/.test(c)) return { symbol: 'NIFTY_MIDCAP_100.NS', label: 'Nifty Midcap 100' }
  if (/small cap/.test(c)) return { symbol: '^CNXSC', label: 'Nifty Smallcap 100' }
  if (/aggressive hybrid|balanced advantage|dynamic asset|multi asset|equity savings|conservative hybrid/.test(c)) return { symbol: '^NSEI', label: 'Nifty 50' }
  if (/overseas|international/.test(c) || /nasdaq|s&p|us equity/.test(n)) return { symbol: '^GSPC', label: 'S&P 500 (in dollars)' }
  // Flexi, multi, large & mid, ELSS, value, contra, focused, dividend yield and the rest of equity.
  return { symbol: '^CRSLDX', label: 'Nifty 500' }
}

// ---------------- the screen ----------------

export interface FundRow extends FundMetrics {
  code: string
  name: string
  fundHouse: string | null
  /** AMFI's sub-category, e.g. "Flexi Cap Fund". */
  category: string
  /** Equity, Debt, Hybrid, Solution Oriented, Other. */
  group: string
  isin: string | null
  nav: number | null
  navDate: string | null
  aumCr: number | null
  /** Total expense ratio of the Direct plan, % a year. */
  ter: number | null
  risk: string | null
  benchmark: string | null
  /** The index the ratios are measured against. */
  index: string | null
  held: boolean
  statsAt: string | null
}

export interface FundScreenStatus {
  enabled: boolean
  funds: number
  measured: number
  running: boolean
  current: string | null
  lastError: string | null
}

export interface FundScreenData {
  rows: FundRow[]
  status: FundScreenStatus
  /** AMFI's date for the returns, size and costs. */
  factsAsOf: string | null
}

export type FundField = keyof FundRow

export interface FundFieldDef {
  key: FundField
  label: string
  short: string
  kind: 'pct' | 'num' | 'cr' | 'ratio' | 'capture' | 'years'
  /** Which way is better, for sorting presets and colour. */
  better: 'high' | 'low'
  help: string
}

export const FUND_FIELDS: FundFieldDef[] = [
  { key: 'aumCr', label: 'Fund size', short: 'AUM', kind: 'cr', better: 'high', help: 'Assets under management, ₹ crore (AMFI)' },
  { key: 'ter', label: 'Expense ratio', short: 'TER', kind: 'num', better: 'low', help: 'Direct plan, % a year (AMFI)' },
  { key: 'ret1m', label: 'Return, 1 month', short: '1M', kind: 'pct', better: 'high', help: 'From the NAV' },
  { key: 'ret3m', label: 'Return, 3 months', short: '3M', kind: 'pct', better: 'high', help: 'From the NAV' },
  { key: 'ret6m', label: 'Return, 6 months', short: '6M', kind: 'pct', better: 'high', help: 'From the NAV' },
  { key: 'ret1y', label: 'Return, 1 year', short: '1Y', kind: 'pct', better: 'high', help: 'From the NAV' },
  { key: 'ret3y', label: 'Return, 3 years a year', short: '3Y', kind: 'pct', better: 'high', help: 'Yearly (CAGR), from the NAV' },
  { key: 'ret5y', label: 'Return, 5 years a year', short: '5Y', kind: 'pct', better: 'high', help: 'Yearly (CAGR), from the NAV' },
  { key: 'vol', label: 'Volatility', short: 'Vol', kind: 'pct', better: 'low', help: 'Yearly standard deviation of daily returns, 3 years' },
  { key: 'sharpe', label: 'Sharpe ratio', short: 'Sharpe', kind: 'ratio', better: 'high', help: 'Return above a 6.5% risk-free rate per unit of volatility, 3 years' },
  { key: 'sortino', label: 'Sortino ratio', short: 'Sortino', kind: 'ratio', better: 'high', help: 'Like Sharpe, counting only the downside, 3 years' },
  { key: 'maxDrawdown', label: 'Worst fall', short: 'Max DD', kind: 'pct', better: 'high', help: 'Largest fall from a peak, 5 years' },
  { key: 'beta', label: 'Beta', short: 'Beta', kind: 'ratio', better: 'low', help: 'How much it moves with its index (1 = as much), 3 years' },
  { key: 'alpha', label: 'Alpha', short: 'Alpha', kind: 'pct', better: 'high', help: 'Yearly return beyond what its beta explains, 3 years' },
  { key: 'r2', label: 'R-squared', short: 'R²', kind: 'ratio', better: 'high', help: 'How much of its moves the index explains (0–1)' },
  { key: 'upCapture', label: 'Up capture', short: 'Up cap', kind: 'capture', better: 'high', help: 'Average move in up months, as % of the index’s' },
  { key: 'downCapture', label: 'Down capture', short: 'Down cap', kind: 'capture', better: 'low', help: 'Average move in down months, as % of the index’s' },
  { key: 'beatRate', label: 'Beat the index', short: 'Beat %', kind: 'pct', better: 'high', help: 'Share of rolling 1-year periods ahead of the index, 3 years' },
  { key: 'years', label: 'History', short: 'Yrs', kind: 'years', better: 'high', help: 'Years of NAV history' }
]

export const fundField = (k: FundField) => FUND_FIELDS.find((f) => f.key === k)

export interface FundFilter {
  field: FundField
  op: '>=' | '<='
  value: number
}

export interface FundScreen {
  key: string
  label: string
  note: string
  group?: string
  category?: string
  filters: FundFilter[]
  sort: { field: FundField; dir: 'asc' | 'desc' }
}

export const FUND_PRESETS: FundScreen[] = [
  {
    key: 'consistent',
    label: 'Consistent equity funds',
    note: 'Sharpe of 1 or more, beat the index in most rolling years, and fell less than it in down months.',
    group: 'Equity',
    filters: [
      { field: 'sharpe', op: '>=', value: 1 },
      { field: 'beatRate', op: '>=', value: 0.6 },
      { field: 'downCapture', op: '<=', value: 95 },
      { field: 'years', op: '>=', value: 3 }
    ],
    sort: { field: 'sortino', dir: 'desc' }
  },
  {
    key: 'alpha',
    label: 'Highest alpha',
    note: 'Return beyond what the market explains, among equity funds with three years of history and ₹500 crore or more.',
    group: 'Equity',
    filters: [
      { field: 'years', op: '>=', value: 3 },
      { field: 'aumCr', op: '>=', value: 500 }
    ],
    sort: { field: 'alpha', dir: 'desc' }
  },
  {
    key: 'cheap-index',
    label: 'Low-cost index funds',
    note: 'Index funds with an expense ratio of 0.25% or less, closest to their index first.',
    category: 'Index Funds',
    filters: [{ field: 'ter', op: '<=', value: 0.25 }],
    sort: { field: 'r2', dir: 'desc' }
  },
  {
    key: 'defensive',
    label: 'Gentle on the way down',
    note: 'Equity and hybrid funds with the smallest worst falls and low down capture.',
    filters: [
      { field: 'years', op: '>=', value: 3 },
      { field: 'downCapture', op: '<=', value: 80 }
    ],
    sort: { field: 'maxDrawdown', dir: 'desc' }
  },
  {
    key: 'big-and-cheap',
    label: 'Large and low-cost',
    note: '₹10,000 crore or more, expense ratio 0.75% or less.',
    filters: [
      { field: 'aumCr', op: '>=', value: 10_000 },
      { field: 'ter', op: '<=', value: 0.75 }
    ],
    sort: { field: 'ret3y', dir: 'desc' }
  }
]

export function applyFundScreen(rows: FundRow[], s: Pick<FundScreen, 'group' | 'category' | 'filters' | 'sort'>): FundRow[] {
  return rows
    .filter((r) => (!s.group || r.group === s.group) && (!s.category || r.category.toLowerCase() === s.category.toLowerCase()))
    .filter((r) =>
      s.filters.every((f) => {
        const v = r[f.field]
        return typeof v === 'number' && Number.isFinite(v) && (f.op === '>=' ? v >= f.value : v <= f.value)
      })
    )
    .sort((a, b) => {
      const x = a[s.sort.field] as number | null
      const y = b[s.sort.field] as number | null
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return s.sort.dir === 'asc' ? x - y : y - x
    })
}

// ---------------- one fund ----------------

export interface FundHoldingRow {
  name: string
  isin: string | null
  sector: string | null
  assetType: string
  weight: number
  /** Change in weight since the month before (null when the holding is new). */
  change: number | null
}

export interface FundDetail {
  row: FundRow
  /** Month-end NAVs for the chart, and the index's, oldest first (both start at 100). */
  growth: { date: string; fund: number; index: number | null }[]
  /** The category's averages, for comparison. */
  categoryAvg: Partial<Record<FundField, number>>
  categoryCount: number
  /** The latest disclosed portfolio, its month, and what changed from the month before. */
  holdings: { asOf: string; prevAsOf: string | null; rows: FundHoldingRow[]; exited: { name: string; weight: number }[] } | null
  sectors: { sector: string; weight: number; change: number | null }[]
  assetMix: { type: string; weight: number }[]
  /**
   * The portfolio month by month (up to six month-ends, oldest first): each holding's and each
   * sector's share of the fund in each month, null where the holding wasn't there. Null with fewer
   * than two months on file.
   */
  history: {
    months: string[]
    rows: { name: string; isin: string | null; sector: string | null; assetType: string; weights: (number | null)[] }[]
    sectors: { sector: string; weights: number[] }[]
  } | null
  /** Why there are no holdings, when there aren't. */
  holdingsNote: string | null
  /** Followed from the screener: its monthly portfolio is fetched though no one holds it. */
  followed: boolean
}

// ---------------- rolling returns ----------------

/**
 * The yearly return (CAGR) over every window of `years` ending on each date, a point every `step`
 * trading days: what someone who stayed in for that long would have earned, whenever they started.
 */
export function rollingReturns(s: PricePt[], years: number, step = 5): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = []
  if (s.length < 2) return out
  const days = Math.round(years * 365.25)
  for (let i = s.length - 1; i >= 0; i -= step) {
    const end = s[i]
    const start = at(s, back(end.date, days))
    if (!start || Date.parse(end.date) - Date.parse(s[0].date) < (days - 7) * DAY) break
    const span = yearsBetween(start.date, end.date)
    if (span <= 0) continue
    out.push({ date: end.date, value: (end.close / start.close) ** (1 / span) - 1 })
  }
  return out.reverse()
}

export interface RollingStats {
  years: number
  windows: number
  from: string | null
  to: string | null
  min: number | null
  max: number | null
  avg: number | null
  median: number | null
  /** Share of windows that lost money. */
  negative: number | null
  /** Share of windows ahead of the index over the same window (null without one). */
  beatIndex: number | null
  /** How the windows' yearly returns were spread. */
  buckets: { label: string; share: number }[]
}

const BUCKETS: [string, number, number][] = [
  ['Below 0%', -Infinity, 0],
  ['0–8%', 0, 0.08],
  ['8–12%', 0.08, 0.12],
  ['12–15%', 0.12, 0.15],
  ['15–20%', 0.15, 0.2],
  ['20% and up', 0.2, Infinity]
]

export function rollingStats(fund: { date: string; value: number }[], index: { date: string; value: number }[] | null, years: number): RollingStats {
  const vals = fund.map((p) => p.value)
  const sorted = [...vals].sort((a, b) => a - b)
  const n = vals.length
  const idx = index ? new Map(index.map((p) => [p.date, p.value])) : null
  const paired = idx ? fund.filter((p) => idx.has(p.date)) : []
  return {
    years,
    windows: n,
    from: fund[0]?.date ?? null,
    to: fund.at(-1)?.date ?? null,
    min: n ? sorted[0] : null,
    max: n ? sorted[n - 1] : null,
    avg: n ? vals.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null,
    negative: n ? vals.filter((v) => v < 0).length / n : null,
    beatIndex: paired.length >= 5 ? paired.filter((p) => p.value > idx!.get(p.date)!).length / paired.length : null,
    buckets: n ? BUCKETS.map(([label, lo, hi]) => ({ label, share: vals.filter((v) => v >= lo && v < hi).length / n })) : []
  }
}

/** A fund's whole NAV history and its index's, for the full chart and rolling returns. */
export interface FundChartData {
  nav: PricePt[]
  index: PricePt[] | null
  indexLabel: string | null
}
