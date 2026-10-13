import type { TxnType } from '@shared/types'

export interface FifoTxn {
  date: string
  type: TxnType
  quantity: number // signed units
  amount: number // signed cash flow (buy < 0, sell/dividend > 0)
  fees: number
}

export interface Lot {
  date: string
  quantity: number
  costPerUnit: number
}

/** One sale matched against one purchase lot (a sale spanning two lots gives two records). */
export interface LotSale {
  buyDate: string
  sellDate: string
  quantity: number
  /** Purchase cost of these units, buy fees included. */
  cost: number
  /** Sale proceeds for these units, sale fees deducted. */
  proceeds: number
}

export interface FifoResult {
  quantity: number
  invested: number // cost of the units still held
  avgCost: number | null
  realizedPnl: number
  dividends: number
  charges: number
  openLots: Lot[]
  sales: LotSale[]
  /** Units sold that had no matching purchase in the data (history starts too late). */
  unmatchedSellQuantity: number
}

const EPS = 1e-6

/**
 * Computes the position for one account + instrument using FIFO lot matching.
 * Transactions must be sorted oldest first.
 *
 * Bonus and split rows arrive as zero-cost unit additions. That keeps the total
 * invested amount and average cost correct; per-lot holding periods for those
 * units are approximate until corporate actions are applied to lots directly.
 */
export function computeFifo(txns: FifoTxn[]): FifoResult {
  const lots: Lot[] = []
  let realizedPnl = 0
  let dividends = 0
  let charges = 0
  let unmatchedSellQuantity = 0
  const sales: LotSale[] = []

  for (const t of txns) {
    if (t.type === 'DIVIDEND') {
      dividends += t.amount
      charges += t.fees
      continue
    }
    if (t.type === 'TAX') {
      charges += Math.abs(t.amount) + t.fees
      continue
    }

    if (t.quantity > EPS) {
      const cost = t.type === 'BONUS' || t.type === 'SPLIT' ? 0 : Math.abs(t.amount) + t.fees
      lots.push({ date: t.date, quantity: t.quantity, costPerUnit: cost / t.quantity })
    } else if (t.quantity < -EPS) {
      let toSell = -t.quantity
      const proceeds = Math.abs(t.amount) - t.fees
      const pricePerUnit = proceeds / toSell
      while (toSell > EPS && lots.length > 0) {
        const lot = lots[0]
        const used = Math.min(lot.quantity, toSell)
        realizedPnl += used * (pricePerUnit - lot.costPerUnit)
        sales.push({
          buyDate: lot.date,
          sellDate: t.date,
          quantity: used,
          cost: used * lot.costPerUnit,
          proceeds: used * pricePerUnit
        })
        lot.quantity -= used
        toSell -= used
        if (lot.quantity <= EPS) lots.shift()
      }
      if (toSell > EPS) unmatchedSellQuantity += toSell
    } else {
      charges += t.fees
    }
  }

  const quantity = lots.reduce((s, l) => s + l.quantity, 0)
  const invested = lots.reduce((s, l) => s + l.quantity * l.costPerUnit, 0)
  return {
    quantity: Math.abs(quantity) < EPS ? 0 : quantity,
    invested,
    avgCost: quantity > EPS ? invested / quantity : null,
    realizedPnl,
    dividends,
    charges,
    openLots: lots,
    sales,
    unmatchedSellQuantity
  }
}
