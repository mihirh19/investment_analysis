import { BollingerBands, EMA, MACD, RSI, SMA, VWAP } from 'trading-signals'
import type { ChartBars } from './research'

// Series a price chart draws over its candles, worked out from the bars it already has.

export type Candle = ChartBars['bars'][number]
export interface Point {
  time: string | number
  value: number
}

/** Daily candles rolled up into weeks (starting Monday) or months. */
export function aggregate(bars: Candle[], to: 'W' | 'M'): Candle[] {
  const keyOf = (t: string | number) => {
    const d = typeof t === 'number' ? new Date(t * 1000) : new Date(`${t}T00:00:00Z`)
    if (to === 'M') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return monday.toISOString().slice(0, 10)
  }
  const out: Candle[] = []
  let key: string | null = null
  for (const b of bars) {
    const k = keyOf(b.time)
    const cur = out[out.length - 1]
    if (k !== key || !cur) {
      out.push({ ...b, time: k })
      key = k
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close
      cur.volume = cur.volume === null && b.volume === null ? null : (cur.volume ?? 0) + (b.volume ?? 0)
    }
  }
  return out
}

function run<R>(bars: Candle[], step: (b: Candle) => R | null, pick: (r: R) => number = (r) => r as number): Point[] {
  const out: Point[] = []
  for (const b of bars) {
    const r = step(b)
    if (r !== null && r !== undefined) {
      const v = pick(r)
      if (Number.isFinite(v)) out.push({ time: b.time, value: v })
    }
  }
  return out
}

export const smaSeries = (bars: Candle[], n: number) => {
  const sma = new SMA(n)
  return run(bars, (b) => sma.add(b.close))
}

export const emaSeries = (bars: Candle[], n: number) => {
  const ema = new EMA(n)
  // An EMA gives a figure from its first price; it only means something once it has seen n of them.
  return run(bars, (b) => {
    const r = ema.add(b.close)
    return ema.isStable ? r : null
  })
}

export function bollinger(bars: Candle[], n = 20, k = 2): { upper: Point[]; middle: Point[]; lower: Point[] } {
  const bb = new BollingerBands(n, k)
  const upper: Point[] = []
  const middle: Point[] = []
  const lower: Point[] = []
  for (const b of bars) {
    const r = bb.add(b.close)
    if (!r) continue
    upper.push({ time: b.time, value: r.upper })
    middle.push({ time: b.time, value: r.middle })
    lower.push({ time: b.time, value: r.lower })
  }
  return { upper, middle, lower }
}

export const rsiSeries = (bars: Candle[], n = 14) => {
  const rsi = new RSI(n)
  return run(bars, (b) => rsi.add(b.close))
}

export function macdSeries(bars: Candle[]): { macd: Point[]; signal: Point[]; histogram: Point[] } {
  const m = new MACD(new EMA(12), new EMA(26), new EMA(9))
  const macd: Point[] = []
  const signal: Point[] = []
  const histogram: Point[] = []
  for (const b of bars) {
    const r = m.add(b.close)
    if (!r) continue
    macd.push({ time: b.time, value: r.macd })
    signal.push({ time: b.time, value: r.signal })
    histogram.push({ time: b.time, value: r.histogram })
  }
  return { macd, signal, histogram }
}

/** Volume-weighted average price, starting afresh each trading day (for intraday bars). */
export function vwapSeries(bars: Candle[]): Point[] {
  const out: Point[] = []
  let day: number | null = null
  let vwap = new VWAP()
  for (const b of bars) {
    if (typeof b.time !== 'number') continue
    const d = Math.floor(b.time / 86400)
    if (d !== day) {
      day = d
      vwap = new VWAP()
    }
    const r = vwap.add({ high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })
    if (r !== null && Number.isFinite(r)) out.push({ time: b.time, value: r })
  }
  return out
}
