import { useMemo } from 'react'
import type { LiveQuote } from '@shared/research'
import type { HoldingRow } from '@shared/types'
import { useQuotes } from './api'

/**
 * Live prices for whatever a screen shows: the symbols are watched while it is on screen (every few
 * seconds while their market is open) and the latest quote for each comes back by symbol. Screens
 * overlay these on their own figures, which stay as they are when a symbol has no live price.
 */
export function useLive(symbols: (string | null | undefined)[]): Map<string, LiveQuote> {
  const list = useMemo(() => [...new Set(symbols.filter((s): s is string => !!s).map((s) => s.toUpperCase()))].slice(0, 60), [symbols.join(',')])
  const q = useQuotes(list)
  return useMemo(() => new Map((q.data ?? []).map((x) => [x.symbol.toUpperCase(), x])), [q.data])
}

/** NSE-listed holdings (Indian shares and ETFs) take their live price; everything else stays as stored. */
const liveSymbol = (r: HoldingRow) => ((r.assetClass === 'EQUITY_IN' || r.assetClass === 'ETF') && r.currency === 'INR' && r.symbol ? r.symbol.toUpperCase() : null)

/** Holdings with live prices worked in: value, gain and the day's change follow the price. */
export function useLiveHoldings(rows: HoldingRow[] | undefined): HoldingRow[] | undefined {
  const live = useLive((rows ?? []).map(liveSymbol))
  return useMemo(() => {
    if (!rows || live.size === 0) return rows
    return rows.map((r) => {
      const sym = liveSymbol(r)
      const q = sym ? live.get(sym) : undefined
      if (!q || q.price === r.lastPrice) return r
      const value = r.quantity * q.price
      const prev = q.prevClose ?? r.prevClose
      const dayChange = prev ? r.quantity * (q.price - prev) : r.dayChange
      return {
        ...r,
        lastPrice: q.price,
        prevClose: prev,
        priceSource: 'LIVE' as const,
        priceDate: q.time.slice(0, 10),
        marketValue: value,
        marketValueInr: value,
        unrealizedPnl: r.invested !== null ? value - r.invested : r.unrealizedPnl,
        unrealizedPnlInr: r.investedInr !== null ? value - r.investedInr : r.unrealizedPnlInr,
        dayChange,
        dayChangeInr: dayChange
      }
    })
  }, [rows, live])
}
