// Price-based figures for every listed stock, from NSE's daily files. Pure functions: the main
// process feeds them stored bars, the screener reads the results.

/** One trading day for one stock, as NSE prints it (not adjusted for splits or bonuses). */
export interface Bar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  /** NSE's previous close, which it adjusts on the ex-date of a split or bonus. */
  prevClose: number | null
  volume: number | null
  /** Share of the traded quantity taken as delivery (0–100). */
  delivPct: number | null
}

/**
 * Bars made comparable across splits, bonuses and rights: where NSE's previous close for a day
 * differs from the actual close the day before, every earlier bar is scaled by that ratio.
 */
export function adjustBars(bars: Bar[]): Bar[] {
  const out = bars.map((b) => ({ ...b }))
  let factor = 1
  for (let i = out.length - 1; i > 0; i--) {
    const today = bars[i]
    const before = bars[i - 1]
    if (today.prevClose && before.close > 0) {
      const ratio = today.prevClose / before.close
      // Small gaps are rounding; a real split or bonus moves the base by far more.
      if (ratio < 0.97 || ratio > 1.03) factor *= ratio
    }
    if (factor !== 1) {
      const b = out[i - 1]
      const s = (v: number | null) => (v === null ? null : v * factor)
      out[i - 1] = { ...b, open: s(b.open), high: s(b.high), low: s(b.low), close: b.close * factor, volume: b.volume === null ? null : b.volume / factor }
    }
  }
  return out
}

export interface Technicals {
  date: string
  ret1w: number | null
  ret1m: number | null
  ret3m: number | null
  ret6m: number | null
  ret1y: number | null
  rsi14: number | null
  /** Price against its 50- and 200-day averages (0.05 = 5% above). */
  vsSma50: number | null
  vsSma200: number | null
  /** 50-day average against the 200-day: above 0 is a "golden cross" state. */
  sma50vs200: number | null
  /** Trading days since the 50-day average last crossed the 200-day (up or down). */
  crossDays: number | null
  /** Today's volume and delivery % against their 20-day averages. */
  volumeSpike: number | null
  delivPct: number | null
  delivSpike: number | null
  /** Average daily traded value over 20 days, in rupees. */
  turnover20: number | null
  /** 1 when today's close is the highest close of the past year. */
  newHigh: number | null
  /** Yearly volatility from daily moves. */
  volatility: number | null
  /** Worst fall from a peak during the past year. */
  drawdown1y: number | null
  /** Weighted 3/6/9/12-month return, ranked 1–99 against every stock (filled in afterwards). */
  rsRating: number | null
  momentum: number | null
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Wilder's RSI. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length <= n) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= n
  loss /= n
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (n - 1) + Math.max(d, 0)) / n
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n
  }
  if (loss === 0) return gain === 0 ? 50 : 100
  return 100 - 100 / (1 + gain / loss)
}

/** The figures for the last bar. Bars must be adjusted and in date order. */
export function technicalsOf(bars: Bar[]): Technicals | null {
  if (bars.length === 0) return null
  const closes = bars.map((b) => b.close)
  const last = closes.length - 1
  const close = closes[last]
  const back = (n: number) => (last - n >= 0 && closes[last - n] > 0 ? close / closes[last - n] - 1 : null)
  // Running sums, so each moving average at any day is one subtraction.
  const sums = [0]
  for (const c of closes) sums.push(sums[sums.length - 1] + c)
  const avg = (n: number, end: number) => (end >= n ? (sums[end] - sums[end - n]) / n : null)
  const s50 = avg(50, closes.length)
  const s200 = avg(200, closes.length)
  let crossDays: number | null = null
  if (s50 !== null && s200 !== null) {
    const side = Math.sign(s50 - s200)
    for (let k = 1; closes.length - k >= 200 && k <= 250; k++) {
      if (Math.sign(avg(50, closes.length - k)! - avg(200, closes.length - k)!) !== side) {
        crossDays = k - 1
        break
      }
    }
  }
  const prior = bars.slice(-21, -1)
  const vols = prior.map((b) => b.volume).filter((v): v is number => v !== null && v > 0)
  const delivs = prior.map((b) => b.delivPct).filter((v): v is number => v !== null && v > 0)
  const today = bars[last]
  const year = bars.slice(-251)
  const yearCloses = year.map((b) => b.close)
  const moves: number[] = []
  for (let i = 1; i < yearCloses.length; i++) if (yearCloses[i - 1] > 0) moves.push(Math.log(yearCloses[i] / yearCloses[i - 1]))
  let peak = -Infinity
  let worst = 0
  for (const c of yearCloses) {
    peak = Math.max(peak, c)
    worst = Math.min(worst, c / peak - 1)
  }
  const r3 = back(63)
  const r6 = back(126)
  const r9 = back(189)
  const r12 = back(250)
  const sd = moves.length >= 60 ? Math.sqrt(mean(moves.map((m) => (m - mean(moves)) ** 2))) * Math.sqrt(250) : null
  return {
    date: today.date,
    ret1w: back(5),
    ret1m: back(21),
    ret3m: r3,
    ret6m: r6,
    ret1y: r12,
    rsi14: rsi(closes.slice(-250)),
    vsSma50: s50 ? close / s50 - 1 : null,
    vsSma200: s200 ? close / s200 - 1 : null,
    sma50vs200: s50 && s200 ? s50 / s200 - 1 : null,
    crossDays,
    volumeSpike: today.volume !== null && vols.length >= 10 ? today.volume / mean(vols) : null,
    delivPct: today.delivPct,
    delivSpike: today.delivPct !== null && delivs.length >= 10 ? today.delivPct / mean(delivs) : null,
    turnover20: bars.length >= 20 ? mean(bars.slice(-20).map((b) => (b.volume ?? 0) * b.close)) : null,
    newHigh: year.length >= 200 ? (close >= Math.max(...yearCloses.slice(0, -1)) ? 1 : 0) : null,
    volatility: sd,
    drawdown1y: year.length >= 60 ? worst : null,
    rsRating: null,
    // IBD-style: the latest quarter counts double.
    momentum: r3 !== null && r6 !== null && r9 !== null && r12 !== null ? 0.4 * r3 + 0.2 * r6 + 0.2 * r9 + 0.2 * r12 : null
  }
}

/** Ranks momentum across all stocks into 1–99 (99 = stronger than 99% of them). */
export function rankStrength(all: Map<string, Technicals>): void {
  const ranked = [...all.values()].filter((t) => t.momentum !== null).sort((a, b) => a.momentum! - b.momentum!)
  ranked.forEach((t, i) => {
    t.rsRating = ranked.length > 1 ? Math.max(1, Math.min(99, Math.round((i / (ranked.length - 1)) * 98) + 1)) : 50
  })
}
