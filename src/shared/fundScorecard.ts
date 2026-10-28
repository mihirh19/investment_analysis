import type { FundRow } from './fundScreener'
import { median, type Level, type Tone } from './scorecard'

// A fund's scorecard in plain words, like the stock one: how it has returned, how much it swings,
// what it earned for that risk, what it costs, how steadily it kept up with its index, how it held
// up in falls, and anything that looks wrong. Each compares the fund with the others in its AMFI
// category, from AMFI's facts and the fund's own NAVs. It describes; it does not recommend.

export interface FundScoreCard {
  key: 'returns' | 'risk' | 'riskReturn' | 'cost' | 'consistency' | 'downside' | 'flags'
  title: string
  level: Level
  tone: Tone
  text: string
}

export interface FundRank {
  field: 'ret1y' | 'ret3y' | 'ret5y'
  label: string
  /** 1 is the best in the category. */
  rank: number
  of: number
}

const p0 = (v: number) => `${(v * 100).toFixed(0)}%`
const p1 = (v: number) => `${(v * 100).toFixed(1)}%`
const toneOf = (level: Level, highIsGood: boolean): Tone => (level === 'None' || level === 'Avg' ? 'neutral' : (level === 'High') === highIsGood ? 'good' : 'bad')
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The fund's place in its category for the longest return it has (1 = highest). */
export function fundRank(row: FundRow, all: FundRow[]): FundRank | null {
  const peers = all.filter((r) => r.category === row.category)
  for (const [field, label] of [
    ['ret3y', '3-year return'],
    ['ret5y', '5-year return'],
    ['ret1y', '1-year return']
  ] as const) {
    const v = row[field]
    if (!num(v)) continue
    const vals = peers.map((r) => r[field]).filter(num)
    if (vals.length < 3) continue
    return { field, label, rank: vals.filter((x) => x > v).length + 1, of: vals.length }
  }
  return null
}

/** Within a band around the category's middle fund is Avg; above it High, below it Low. */
function band(value: number | null, ref: number | null, width: number): Level {
  if (!num(value) || !num(ref)) return 'None'
  return value > ref + width ? 'High' : value < ref - width ? 'Low' : 'Avg'
}

export function fundScorecard(row: FundRow, all: FundRow[]): FundScoreCard[] {
  const peers = all.filter((r) => r.category === row.category)
  // The category's middle fund, once at least three funds have the figure.
  const mid = (k: keyof FundRow) => {
    const vals = peers.map((r) => r[k]).filter(num)
    return vals.length >= 3 ? median(vals) : null
  }
  const cards: FundScoreCard[] = []

  // Returns: the longest period it has, against the category's middle fund.
  const rk = row.ret3y !== null ? 'ret3y' : row.ret5y !== null ? 'ret5y' : 'ret1y'
  const rv = row[rk]
  const rRef = mid(rk)
  const rLevel = band(rv, rRef, 0.015)
  const period = rk === 'ret1y' ? 'over the last year' : `a year over ${rk === 'ret3y' ? 'three' : 'five'} years`
  cards.push({
    key: 'returns',
    title: 'Returns',
    level: rLevel,
    tone: toneOf(rLevel, true),
    text:
      rLevel === 'None'
        ? 'Not enough history, or too few funds in its category, to compare.'
        : `Returned ${p1(rv!)} ${period}, against ${p1(rRef!)} for the middle fund in ${row.category}.`
  })

  // Risk: how much the NAV swings.
  const vRef = mid('vol')
  const vLevel = !num(row.vol) || !num(vRef) ? 'None' : row.vol > vRef * 1.15 ? 'High' : row.vol < vRef * 0.85 ? 'Low' : 'Avg'
  cards.push({
    key: 'risk',
    title: 'Risk',
    level: vLevel,
    tone: toneOf(vLevel, false),
    text:
      vLevel === 'None'
        ? 'Needs a year of NAVs, and three measured funds in its category.'
        : `Its NAV swings ${p1(row.vol!)} a year, against ${p1(vRef!)} for its category: ${vLevel === 'High' ? 'bumpier than most' : vLevel === 'Low' ? 'steadier than most' : 'about as bumpy as most'}.`
  })

  // Return for the risk: the Sharpe ratio.
  const sRef = mid('sharpe')
  const sLevel = band(row.sharpe, sRef, 0.1)
  cards.push({
    key: 'riskReturn',
    title: 'Return for the risk',
    level: sLevel,
    tone: toneOf(sLevel, true),
    text: sLevel === 'None' ? 'Needs a year of NAVs, and three measured funds in its category.' : `Sharpe ratio ${row.sharpe!.toFixed(2)} against ${sRef!.toFixed(2)} for its category: ${sLevel === 'High' ? 'more return for each unit of swing than most' : sLevel === 'Low' ? 'less return for each unit of swing than most' : 'about as much as most'}.`
  })

  // Cost: the expense ratio.
  const tRef = mid('ter')
  const tLevel = !num(row.ter) || !num(tRef) ? 'None' : row.ter > tRef * 1.2 + 0.05 ? 'High' : row.ter < tRef * 0.8 - 0.05 ? 'Low' : 'Avg'
  cards.push({
    key: 'cost',
    title: 'Expense ratio',
    level: tLevel,
    tone: toneOf(tLevel, false),
    text: tLevel === 'None' ? (row.market && row.market !== 'IN' ? 'Expense ratios of ETFs listed abroad aren’t in the app’s data; see the issuer’s page.' : 'Needs AMFI’s costs for it and at least three funds in its category.') : `Charges ${row.ter!.toFixed(2)}% a year, against ${tRef!.toFixed(2)}% for the middle fund in its category.`
  })

  // Index funds and ETFs: how closely they follow their index, in place of beating it.
  const b = row.beatRate
  const passive = row.vehicle === 'ETF' || /index/i.test(row.category) || /\bindex\b/i.test(row.name)
  if (passive && num(row.trackingError)) {
    const te = row.trackingError
    const level: Level = te <= 0.01 ? 'Low' : te >= 0.04 ? 'High' : 'Avg'
    cards.push({
      key: 'consistency',
      title: 'Tracking error',
      level,
      tone: toneOf(level, false),
      text: `Its daily returns stray ${p1(te)} a year from ${row.index ?? 'its index'}${level === 'Low' ? ': it follows the index closely' : level === 'High' ? ': it follows the index loosely, or is measured against a near index' : ''}.`
    })
  } else {
  const cLevel: Level = !num(b) ? 'None' : b >= 0.65 ? 'High' : b <= 0.35 ? 'Low' : 'Avg'
  cards.push({
    key: 'consistency',
    title: 'Consistency',
    level: cLevel,
    tone: toneOf(cLevel, true),
    text: !num(b)
      ? row.index
        ? 'Needs about two years of NAVs next to its index.'
        : 'Not measured against a share index (debt and similar funds).'
      : `Ahead of ${row.index ?? 'its index'} in ${p0(b)} of rolling one-year periods over the last three years.`
  })
  }

  // Downside: how much of the index's fall it took in down months.
  const dc = row.downCapture
  const dLevel: Level = !num(dc) ? 'None' : dc <= 85 ? 'High' : dc >= 105 ? 'Low' : 'Avg'
  cards.push({
    key: 'downside',
    title: 'Protection in falls',
    level: dLevel,
    tone: toneOf(dLevel, true),
    text: !num(dc)
      ? row.index
        ? 'Needs more months next to its index.'
        : 'Not measured against a share index.'
      : `In months ${row.index ?? 'its index'} fell, it fell ${dc.toFixed(0)}% as much${num(row.maxDrawdown) ? `; its worst fall was ${p1(row.maxDrawdown)}` : ''}.`
  })

  // Things worth a second look.
  const flags: string[] = []
  if (num(row.aumCr) && row.aumCr < 100) flags.push(`a small fund (₹${Math.round(row.aumCr)} Cr)`)
  if (row.years > 0 && row.years < 3) flags.push(`only ${row.years.toFixed(1)} years of history`)
  if (num(row.ter) && num(tRef) && row.ter > tRef * 1.5 && row.ter - tRef > 0.3) flags.push('costs well above its category')
  if (num(b) && b < 0.3) flags.push(`behind its index in ${p0(1 - b)} of rolling years`)
  const ddRef = mid('maxDrawdown')
  if (num(row.maxDrawdown) && num(ddRef) && row.maxDrawdown < ddRef - 0.08) flags.push(`a worst fall of ${p1(row.maxDrawdown)} against ${p1(ddRef)} for its category`)
  const known = row.statsAt !== null || num(row.aumCr)
  cards.push({
    key: 'flags',
    title: 'Red flags',
    level: !known ? 'None' : flags.length >= 2 ? 'High' : flags.length === 1 ? 'Avg' : 'Low',
    tone: !known ? 'neutral' : flags.length ? 'bad' : 'good',
    text: !known ? 'Not worked out yet.' : flags.length ? `Worth checking: ${flags.join('; ')}.` : 'Nothing stands out: a fair size, enough history and ordinary costs.'
  })
  return cards
}
