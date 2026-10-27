import { describe, expect, it } from 'vitest'
import type { BalanceRow, QuarterRow, YearRow } from '../src/shared/research'
import { averageFcf, dcfValue, impliedGrowth, ttmProfits, valuationBands } from '../src/shared/valuation'

const q = (periodEnd: string, netProfit: number, ownersProfit?: number): QuarterRow => ({ periodEnd, basis: 'C', netProfit, ...(ownersProfit !== undefined ? { ownersProfit } : {}) })

describe('valuation history', () => {
  const quarters = [q('2024-03-31', 10), q('2024-06-30', 10), q('2024-09-30', 10), q('2024-12-31', 10), q('2025-03-31', 20, 18), q('2025-06-30', 20)]

  it('adds up four quarters in a row, owners’ share first', () => {
    expect(ttmProfits(quarters)).toEqual([
      { periodEnd: '2024-12-31', value: 40 },
      { periodEnd: '2025-03-31', value: 48 },
      { periodEnd: '2025-06-30', value: 58 }
    ])
    // A missing quarter breaks the run.
    expect(ttmProfits([q('2024-03-31', 1), q('2024-06-30', 1), q('2024-12-31', 1), q('2025-03-31', 1)])).toEqual([])
  })

  it('works out P/E and P/B from the price, counting results from six weeks after the quarter', () => {
    const prices = [
      { date: '2025-01-15', close: 1 }, // the December quarter isn't out yet
      { date: '2025-02-20', close: 2 },
      { date: '2025-05-20', close: 2 },
      { date: '2025-08-20', close: 4 }
    ]
    const balances: BalanceRow[] = [{ periodEnd: '2024-09-30', basis: 'C', equity: 100 }, { periodEnd: '2025-03-31', basis: 'C', equity: 200 }]
    const { pe, pb } = valuationBands(prices, 1000, quarters, balances)
    expect(pe.points).toEqual([
      { date: '2025-02-20', value: 2000 / 40 },
      { date: '2025-05-20', value: 2000 / 48 },
      { date: '2025-08-20', value: 4000 / 58 }
    ])
    expect(pb.points.map((p) => p.value)).toEqual([10, 20, 10, 20])
    expect(pb.median).toBe(15)
    expect(pb.current).toBe(20)
    expect(pb.rank).toBe(0.5)
    // Losses have no P/E.
    expect(valuationBands(prices, 1000, quarters.map((x) => ({ ...x, netProfit: -1, ownersProfit: undefined })), []).pe.points).toEqual([])
  })

  it('averages free cash flow over the last three years', () => {
    const years: YearRow[] = [
      { periodEnd: '2022-03-31', basis: 'C', cfo: 1000, capex: -1000 },
      { periodEnd: '2023-03-31', basis: 'C', cfo: 100, capex: -40 },
      { periodEnd: '2024-03-31', basis: 'C', cfo: 120, capex: -30 },
      { periodEnd: '2025-03-31', basis: 'C', cfo: 150, capex: -60 }
    ]
    expect(averageFcf(years)).toBe((60 + 90 + 90) / 3)
    expect(averageFcf([])).toBeNull()
  })
})

describe('reverse DCF', () => {
  it('values a growing cash flow', () => {
    // No growth years: the plain growing perpetuity.
    expect(dcfValue({ base: 100, growth: 0, years: 0, discount: 0.12, terminalGrowth: 0.05 })).toBeCloseTo(105 / 0.07)
    expect(dcfValue({ base: 100, growth: 0.1, years: 1, discount: 0.1, terminalGrowth: 0 })).toBeCloseTo(100 + 1000)
  })

  it('finds the growth the price assumes', () => {
    const input = { base: 100, years: 10, discount: 0.12, terminalGrowth: 0.05 }
    const value = dcfValue({ ...input, growth: 0.15 })
    expect(impliedGrowth(value, input)).toBeCloseTo(0.15, 6)
    expect(impliedGrowth(value, { ...input, base: -5 })).toBeNull()
    expect(impliedGrowth(value, { ...input, terminalGrowth: 0.12 })).toBeNull()
  })
})
