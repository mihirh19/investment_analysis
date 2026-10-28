import type { ScreenRow } from './screener'

// A stock's scorecard in plain words, the way investing apps show one: how it has done, how it is
// priced, how it grows and earns, where the price sits now, and anything that looks wrong. Each
// compares the company with the others in its industry (or the whole market), from the app's own
// downloads of NSE results and prices. It describes; it does not recommend buying or selling.

export type Level = 'High' | 'Avg' | 'Low' | 'None'
/** Whether a level reads well (green), badly (red) or neither for this card. */
export type Tone = 'good' | 'bad' | 'neutral'

export interface ScoreCard {
  key: 'performance' | 'valuation' | 'growth' | 'profitability' | 'entry' | 'flags'
  title: string
  level: Level
  tone: Tone
  text: string
}

export interface StockContext {
  /** Companies in the same industry with figures, the stock itself included. */
  peers: number
  industryPe: number | null
  industryPb: number | null
  /** Rank by market cap among listed companies, and its band (SEBI: top 100, next 150, the rest). */
  capRank: number | null
  capBand: 'Largecap' | 'Midcap' | 'Smallcap' | null
  /** Share of listed companies that move less from day to day. */
  volatilityPercentile: number | null
}

export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** How the stock compares with its industry and the market: the numbers behind the cards. */
export function stockContext(row: ScreenRow, all: ScreenRow[]): StockContext {
  const peers = row.industry ? all.filter((r) => r.industry === row.industry) : [row]
  const byCap = all.filter((r) => r.mcap !== null).sort((a, b) => b.mcap! - a.mcap!)
  const rank = row.mcap === null ? -1 : byCap.findIndex((r) => r.symbol === row.symbol)
  const vols = all.map((r) => r.volatility).filter((v): v is number => v !== null)
  return {
    peers: peers.length,
    industryPe: median(peers.map((r) => (r.pe !== null && r.pe > 0 ? r.pe : null))),
    industryPb: median(peers.map((r) => (r.pb !== null && r.pb > 0 ? r.pb : null))),
    capRank: rank >= 0 ? rank + 1 : null,
    capBand: rank < 0 ? null : rank < 100 ? 'Largecap' : rank < 250 ? 'Midcap' : 'Smallcap',
    volatilityPercentile: row.volatility === null || !vols.length ? null : vols.filter((v) => v < row.volatility!).length / vols.length
  }
}

/** Above, near or below a reference: more than a quarter over is High, more than a fifth under is Low. */
function against(value: number | null, ref: number | null): Level {
  if (value === null || ref === null || ref === 0) return 'None'
  const r = value / ref
  return r > 1.25 ? 'High' : r < 0.8 ? 'Low' : 'Avg'
}
const toneOf = (level: Level, highIsGood: boolean): Tone => (level === 'None' || level === 'Avg' ? 'neutral' : (level === 'High') === highIsGood ? 'good' : 'bad')
const p = (v: number) => `${(v * 100).toFixed(0)}%`

export function scorecard(row: ScreenRow, all: ScreenRow[], bank = false): ScoreCard[] {
  const peers = row.industry ? all.filter((r) => r.industry === row.industry) : []
  const ctx = stockContext(row, all)
  const cards: ScoreCard[] = []

  // How the price has done over the year, ranked against every stock (1–99).
  const rs = row.rsRating
  const perf: Level = rs === null ? 'None' : rs >= 70 ? 'High' : rs <= 30 ? 'Low' : 'Avg'
  cards.push({
    key: 'performance',
    title: 'Performance',
    level: perf,
    tone: toneOf(perf, true),
    text:
      rs === null
        ? 'Not enough price history yet.'
        : perf === 'High'
          ? `Has done better than ${rs}% of listed stocks over the past year.`
          : perf === 'Low'
            ? `Has done worse than ${100 - rs}% of listed stocks over the past year.`
            : 'Has done about as well as most listed stocks over the past year.'
  })

  // Price against earnings (or book, for a loss-maker), next to the industry's middle company.
  const usePe = row.pe !== null && row.pe > 0 && ctx.industryPe !== null
  const val = usePe ? against(row.pe, ctx.industryPe) : against(row.pb, ctx.industryPb)
  cards.push({
    key: 'valuation',
    title: 'Valuation',
    level: val,
    tone: toneOf(val, false),
    text:
      val === 'None'
        ? 'No earnings or book value to compare yet.'
        : `${usePe ? `P/E ${row.pe!.toFixed(1)} against ${ctx.industryPe!.toFixed(1)}` : `Price to book ${row.pb!.toFixed(1)} against ${ctx.industryPb!.toFixed(1)}`} for the middle company in its industry: ${
            val === 'High' ? 'priced above most of its industry' : val === 'Low' ? 'priced below most of its industry' : 'priced like its industry'
          }.`
  })

  // Sales and profit growth over three years, against the industry's middle.
  const g = row.salesGrowth3y ?? row.profitGrowth3y
  const gRef = row.salesGrowth3y !== null ? median(peers.map((r) => r.salesGrowth3y)) : median(peers.map((r) => r.profitGrowth3y))
  const growth: Level = g === null || gRef === null ? 'None' : g > gRef + 0.03 ? 'High' : g < gRef - 0.03 ? 'Low' : 'Avg'
  cards.push({
    key: 'growth',
    title: 'Growth',
    level: growth,
    tone: toneOf(growth, true),
    text:
      growth === 'None'
        ? 'Needs three years of results.'
        : `${row.salesGrowth3y !== null ? (bank ? 'Income' : 'Sales') : 'Profit'} grew ${p(g!)} a year over three years, against ${p(gRef!)} for its industry.`
  })

  // Return on equity (or on capital), against the industry's middle.
  const roe = row.roe
  const roeRef = median(peers.map((r) => r.roe))
  const prof: Level = roe === null || roeRef === null ? 'None' : roe > roeRef + 0.03 ? 'High' : roe < roeRef - 0.03 ? 'Low' : 'Avg'
  cards.push({
    key: 'profitability',
    title: 'Profitability',
    level: prof,
    tone: toneOf(prof, true),
    text: prof === 'None' ? 'Needs a full year of results.' : `Earns ${p(roe!)} on shareholders’ money, against ${p(roeRef!)} for its industry.`
  })

  // Where the price sits after its recent moves: the 14-day RSI.
  const rsi = row.rsi14
  const entry: Level = rsi === null ? 'None' : rsi >= 70 ? 'High' : rsi <= 30 ? 'Low' : 'Avg'
  cards.push({
    key: 'entry',
    title: 'Price momentum',
    level: entry,
    tone: 'neutral',
    text:
      rsi === null
        ? 'Not enough price history yet.'
        : entry === 'High'
          ? `RSI ${rsi.toFixed(0)}: the price has risen sharply of late (above 70).`
          : entry === 'Low'
            ? `RSI ${rsi.toFixed(0)}: the price has fallen sharply of late (below 30).`
            : `RSI ${rsi.toFixed(0)}: no sharp run either way of late.`
  })

  // Things that often go with trouble.
  const flags: string[] = []
  if (!bank && row.debtToEquity !== null && row.debtToEquity > 2) flags.push(`debt is ${row.debtToEquity.toFixed(1)} times equity`)
  if (!bank && row.interestCover !== null && row.interestCover < 1.5) flags.push(`profit covers interest only ${row.interestCover.toFixed(1)} times`)
  if (row.ttmProfit !== null && row.ttmProfit < 0) flags.push('a loss over the last four quarters')
  if (row.piotroski !== null && row.piotroski <= 3) flags.push(`Piotroski score ${row.piotroski} of 9`)
  const known = row.debtToEquity !== null || row.ttmProfit !== null || row.piotroski !== null
  cards.push({
    key: 'flags',
    title: 'Red flags',
    level: !known ? 'None' : flags.length >= 2 ? 'High' : flags.length === 1 ? 'Avg' : 'Low',
    tone: !known ? 'neutral' : flags.length ? 'bad' : 'good',
    text: !known ? 'Needs results to check.' : flags.length ? `Worth checking: ${flags.join('; ')}.` : 'No red flags in the results.'
  })
  return cards
}
