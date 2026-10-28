import type { LiveQuote } from '@shared/research'
import { isMarketOpen } from './refresh'

/**
 * Live prices for what is on screen: the ticker, watchlists, charts and the commodity board. Each
 * screen says which symbols it shows; while a symbol's market is open they are asked for every few
 * seconds (Yahoo's NSE and US prices run a second or two behind the exchange) and every change is
 * pushed to the window at once. Markets that are shut are left alone; futures and currencies, which
 * trade nearly round the clock, are checked every quarter minute. A refusal pauses it for a minute.
 */

export type LiveMarket = 'NSE' | 'US' | 'ROUND' | 'OTHER'

/** Which market's hours a symbol keeps, as the app writes symbols (plain = NSE stock). */
export function marketOf(symbol: string): LiveMarket {
  const s = symbol.toUpperCase()
  if (/=F$|=X$|-USD$/.test(s)) return 'ROUND'
  if (/^\^(NSE|NSMIDCP|CNX|CRSLDX|BSESN|INDIAVIX)/.test(s) || /\.(NS|BO)$/.test(s) || !/[\^=.]/.test(s)) return 'NSE'
  if (/^\^(GSPC|IXIC|DJI|RUT|VIX|TNX|TYX|FVX)$/.test(s)) return 'US'
  return 'OTHER'
}

/** Seconds between looks at a market right now; null while it is shut. */
export function cadence(m: LiveMarket, now = new Date()): number | null {
  if (m === 'NSE') return isMarketOpen('NSE', now) ? 3 : null
  if (m === 'US') return isMarketOpen('US', now) ? 3 : null
  const day = now.getUTCDay()
  if (m === 'ROUND') return day === 6 ? null : 15
  return day === 0 || day === 6 ? null : 30
}

export class LiveFeed {
  private wanted = new Map<string, string[]>()
  private last = new Map<string, number>()
  private prices = new Map<string, { price: number; time: string }>()
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private pausedUntil = 0
  private lastError: string | null = null
  private counts = { ticks: 0, fetches: 0, pushes: 0 }

  constructor(
    private readonly fetchQuotes: (symbols: string[]) => Promise<LiveQuote[]>,
    private readonly push: (quotes: LiveQuote[]) => void,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** A screen's symbols (empty to stop); keyed by the screen so each can come and go. */
  watch(key: string, symbols: string[]): void {
    const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => /^[\^A-Z0-9&.=_-]{1,30}$/.test(s)))].slice(0, 80)
    if (clean.length) this.wanted.set(key, clean)
    else this.wanted.delete(key)
  }

  /** Symbols being watched, and whether any of their markets is open now. */
  status(): { symbols: number; live: boolean; error: string | null } {
    const all = this.symbols()
    return { symbols: all.length, live: all.some((s) => cadence(marketOf(s), this.now()) === 3), error: this.lastError, ...this.counts }
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private symbols(): string[] {
    return [...new Set([...this.wanted.values()].flat())]
  }

  /** One pass: the symbols whose time has come, in batches; only changed prices are pushed. */
  async tick(): Promise<void> {
    this.counts.ticks++
    if (this.busy) return
    const now = this.now()
    if (now.getTime() < this.pausedUntil) return
    // A market's symbols go together: when any is due (a screen just opened, or its time came), all
    // of that market's are asked for, so screens opened a second apart don't each cost a request.
    const all = this.symbols()
    const markets = new Set(
      all
        .filter((s) => {
          const every = cadence(marketOf(s), now)
          return every !== null && now.getTime() - (this.last.get(s) ?? 0) >= every * 1000
        })
        .map(marketOf)
    )
    const due = all.filter((s) => markets.has(marketOf(s)))
    if (due.length === 0) return
    this.busy = true
    try {
      const changed: LiveQuote[] = []
      for (let i = 0; i < due.length; i += 20) {
        const batch = due.slice(i, i + 20)
        const got = await this.fetchQuotes(batch)
        this.counts.fetches++
        for (const s of batch) this.last.set(s, now.getTime())
        for (const q of got) {
          // Yahoo answers from several caches, and one can be older than the last: never step back.
          const seen = this.prices.get(q.symbol)
          if (seen && (q.time < seen.time || (q.time === seen.time && q.price === seen.price))) continue
          if (seen?.price === q.price) {
            seen.time = q.time
            continue
          }
          this.prices.set(q.symbol, { price: q.price, time: q.time })
          changed.push(q)
        }
      }
      this.lastError = null
      if (changed.length) {
        this.counts.pushes++
        this.push(changed)
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      // Yahoo busy or refusing: a minute's rest rather than knocking every few seconds.
      this.pausedUntil = now.getTime() + 60_000
    } finally {
      this.busy = false
    }
  }
}
