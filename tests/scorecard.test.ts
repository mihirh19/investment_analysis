import { describe, expect, it } from 'vitest'
import { NO_TECHNICALS, type ScreenRow } from '../src/shared/screener'
import { median, scorecard, stockContext } from '../src/shared/scorecard'

const row = (symbol: string, o: Partial<ScreenRow> = {}): ScreenRow =>
  ({
    ...NO_TECHNICALS,
    symbol,
    name: symbol,
    industry: 'IT',
    held: false,
    close: 100,
    change: 0,
    mcap: 1e11,
    pe: 20,
    pb: 4,
    roe: 0.2,
    salesGrowth3y: 0.1,
    profitGrowth3y: 0.1,
    debtToEquity: 0.1,
    interestCover: 20,
    ttmProfit: 1e9,
    piotroski: 7,
    ...o
  }) as ScreenRow

describe('stock scorecard', () => {
  const peers = [row('A', { pe: 18 }), row('B', { pe: 20 }), row('C', { pe: 22 }), row('D', { mcap: 5e9 })]

  it('compares with the industry’s middle company', () => {
    expect(median([3, 1, 2, null])).toBe(2)
    const dear = row('X', { pe: 40, roe: 0.35, salesGrowth3y: 0.25, rsRating: 90, rsi14: 75 })
    const cards = Object.fromEntries(scorecard(dear, [...peers, dear]).map((c) => [c.key, c]))
    expect(cards.valuation).toMatchObject({ level: 'High', tone: 'bad' })
    expect(cards.valuation.text).toContain('P/E 40.0 against 20.0')
    expect(cards.performance).toMatchObject({ level: 'High', tone: 'good' })
    expect(cards.growth).toMatchObject({ level: 'High', tone: 'good' })
    expect(cards.profitability).toMatchObject({ level: 'High', tone: 'good' })
    expect(cards.entry).toMatchObject({ level: 'High', tone: 'neutral' })
    expect(cards.flags).toMatchObject({ level: 'Low', tone: 'good', text: 'No red flags in the results.' })
  })

  it('lists red flags and says when figures are missing', () => {
    const shaky = row('Y', { debtToEquity: 3, interestCover: 1.1, ttmProfit: -5e8, piotroski: 2, pe: null, pb: null, rsRating: null, rsi14: null })
    const cards = Object.fromEntries(scorecard(shaky, [...peers, shaky]).map((c) => [c.key, c]))
    expect(cards.flags).toMatchObject({ level: 'High', tone: 'bad' })
    expect(cards.flags.text).toContain('debt is 3.0 times equity')
    expect(cards.valuation.level).toBe('None')
    expect(cards.performance.text).toBe('Not enough price history yet.')
    // A bank's debt is its business: no flag for it.
    expect(scorecard(row('Z', { debtToEquity: 9 }), peers, true).find((c) => c.key === 'flags')!.level).toBe('Low')
  })

  it('places the company by size and steadiness', () => {
    const all = [...peers, row('E', { mcap: 1, volatility: 0.5 }), row('F', { volatility: 0.2 }), row('G', { volatility: 0.3 })]
    const ctx = stockContext(all[0], all)
    expect(ctx).toMatchObject({ peers: 7, industryPe: 20, capBand: 'Largecap' })
    expect(stockContext(all[5], all).volatilityPercentile).toBe(0)
    expect(stockContext(all[4], all).volatilityPercentile).toBeCloseTo(2 / 3)
  })
})
