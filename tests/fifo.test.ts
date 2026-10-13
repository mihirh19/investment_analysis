import { describe, expect, it } from 'vitest'
import { computeFifo, type FifoTxn } from '../src/main/portfolio/fifo'

const buy = (date: string, qty: number, price: number, fees = 0): FifoTxn => ({
  date,
  type: 'BUY',
  quantity: qty,
  amount: -qty * price,
  fees
})
const sell = (date: string, qty: number, price: number, fees = 0): FifoTxn => ({
  date,
  type: 'SELL',
  quantity: -qty,
  amount: qty * price,
  fees
})

describe('computeFifo', () => {
  it('averages cost across buys', () => {
    const r = computeFifo([buy('2024-01-01', 10, 100), buy('2024-02-01', 10, 200)])
    expect(r.quantity).toBe(20)
    expect(r.invested).toBe(3000)
    expect(r.avgCost).toBe(150)
    expect(r.realizedPnl).toBe(0)
  })

  it('sells oldest lots first and books realized P&L', () => {
    const r = computeFifo([buy('2024-01-01', 10, 100), buy('2024-02-01', 10, 200), sell('2024-03-01', 15, 250)])
    // 10 @ 100 and 5 @ 200 sold at 250 → 1500 + 250
    expect(r.realizedPnl).toBeCloseTo(1750)
    expect(r.quantity).toBe(5)
    expect(r.avgCost).toBe(200)
    expect(r.openLots).toEqual([{ date: '2024-02-01', quantity: 5, costPerUnit: 200 }])
  })

  it('includes fees in cost and deducts them from proceeds', () => {
    const r = computeFifo([buy('2024-01-01', 10, 100, 20), sell('2024-02-01', 10, 110, 10)])
    // cost 1020, proceeds 1090
    expect(r.realizedPnl).toBeCloseTo(70)
    expect(r.quantity).toBe(0)
    expect(r.avgCost).toBeNull()
  })

  it('tracks dividends and tax rows without touching units', () => {
    const r = computeFifo([
      buy('2024-01-01', 10, 100),
      { date: '2024-06-01', type: 'DIVIDEND', quantity: 0, amount: 55, fees: 0 },
      { date: '2024-01-01', type: 'TAX', quantity: 0, amount: -0.05, fees: 0 }
    ])
    expect(r.dividends).toBe(55)
    expect(r.charges).toBeCloseTo(0.05)
    expect(r.quantity).toBe(10)
  })

  it('adds bonus units at zero cost, lowering average cost', () => {
    const r = computeFifo([
      buy('2024-01-01', 10, 100),
      { date: '2024-05-01', type: 'BONUS', quantity: 10, amount: 0, fees: 0 }
    ])
    expect(r.quantity).toBe(20)
    expect(r.invested).toBe(1000)
    expect(r.avgCost).toBe(50)
  })

  it('reports sells that have no matching purchase', () => {
    const r = computeFifo([buy('2024-01-01', 5, 100), sell('2024-02-01', 8, 120)])
    expect(r.unmatchedSellQuantity).toBe(3)
    expect(r.quantity).toBe(0)
  })

  it('handles fractional MF units without float residue', () => {
    const r = computeFifo([
      buy('2024-01-01', 12.345, 81.0),
      buy('2024-02-01', 7.891, 83.2),
      sell('2024-03-01', 20.236, 90)
    ])
    expect(r.quantity).toBe(0)
  })
})
