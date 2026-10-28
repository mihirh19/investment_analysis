import { describe, expect, it } from 'vitest'
import { fundRank, fundScorecard } from '../src/shared/fundScorecard'
import { NO_METRICS, type FundRow } from '../src/shared/fundScreener'

const row = (code: string, o: Partial<FundRow> = {}): FundRow =>
  ({
    ...NO_METRICS,
    code,
    name: code,
    fundHouse: null,
    category: 'Flexi Cap Fund',
    group: 'Equity',
    isin: null,
    nav: 1,
    navDate: null,
    aumCr: 5000,
    ter: 0.7,
    risk: null,
    benchmark: null,
    index: 'Nifty 500',
    held: false,
    statsAt: 'x',
    years: 6,
    ret1y: 0.1,
    ret3y: 0.15,
    vol: 0.14,
    sharpe: 0.6,
    beatRate: 0.5,
    downCapture: 95,
    maxDrawdown: -0.18,
    ...o
  }) as FundRow

const peers = [row('B'), row('C', { ret3y: 0.14 }), row('D', { ret3y: 0.16 }), row('E', { category: 'Mid Cap Fund', ret3y: 0.4 })]
const card = (r: FundRow, key: string) => fundScorecard(r, [r, ...peers]).find((c) => c.key === key)!

describe('fund scorecard', () => {
  it('compares with the middle fund in the category', () => {
    const strong = row('A', { ret3y: 0.22, vol: 0.11, sharpe: 1.2, ter: 0.4, beatRate: 0.8, downCapture: 70 })
    const cards = fundScorecard(strong, [strong, ...peers])
    expect(cards.map((c) => [c.key, c.level, c.tone])).toEqual([
      ['returns', 'High', 'good'],
      ['risk', 'Low', 'good'],
      ['riskReturn', 'High', 'good'],
      ['cost', 'Low', 'good'],
      ['consistency', 'High', 'good'],
      ['downside', 'High', 'good'],
      ['flags', 'Low', 'good']
    ])
    expect(cards[0].text).toContain('22.0%')
    expect(cards[0].text).toContain('Flexi Cap Fund')
  })

  it('reads badly where the fund lags', () => {
    const weak = row('A', { ret3y: 0.08, vol: 0.2, sharpe: 0.2, ter: 1.6, beatRate: 0.2, downCapture: 120, aumCr: 40, maxDrawdown: -0.35 })
    expect(card(weak, 'returns').tone).toBe('bad')
    expect(card(weak, 'risk')).toMatchObject({ level: 'High', tone: 'bad' })
    expect(card(weak, 'cost')).toMatchObject({ level: 'High', tone: 'bad' })
    expect(card(weak, 'downside')).toMatchObject({ level: 'Low', tone: 'bad' })
    const flags = card(weak, 'flags')
    expect(flags).toMatchObject({ level: 'High', tone: 'bad' })
    expect(flags.text).toMatch(/small fund.*costs well above.*behind its index.*worst fall/)
  })

  it('says n/a without the figures', () => {
    const debt = row('A', { index: null, beatRate: null, downCapture: null })
    expect(card(debt, 'consistency')).toMatchObject({ level: 'None', tone: 'neutral' })
    expect(card(debt, 'consistency').text).toMatch(/share index/)
    // A category of one can't be compared.
    const lone = row('Z', { category: 'Dividend Yield Fund' })
    expect(fundScorecard(lone, [lone]).find((c) => c.key === 'returns')!.level).toBe('None')
  })

  it('ranks it in its category', () => {
    const a = row('A', { ret3y: 0.155 })
    expect(fundRank(a, [a, ...peers])).toEqual({ field: 'ret3y', label: '3-year return', rank: 2, of: 4 })
    expect(fundRank(row('Z', { category: 'Gilt Fund' }), peers)).toBeNull()
  })
})
