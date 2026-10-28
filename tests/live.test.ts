import { describe, expect, it } from 'vitest'
import { cadence, LiveFeed, marketOf } from '../src/main/market/live'
import { maxAge } from '../src/main/market/mandi'
import type { LiveQuote } from '../src/shared/research'

// Tuesday 27 Oct 2026 at 10:00 IST: NSE open, US shut. And a Sunday.
const NSE_OPEN = new Date('2026-10-27T04:30:00Z')
const SUNDAY = new Date('2026-10-25T06:00:00Z')

const q = (symbol: string, price: number): LiveQuote => ({ symbol, price, prevClose: 100, change: price / 100 - 1, time: '', points: [] })

describe('live prices', () => {
  it('knows which market a symbol follows', () => {
    expect(marketOf('RELIANCE')).toBe('NSE')
    expect(marketOf('^NSEI')).toBe('NSE')
    expect(marketOf('^BSESN')).toBe('NSE')
    expect(marketOf('^GSPC')).toBe('US')
    expect(marketOf('BZ=F')).toBe('ROUND')
    expect(marketOf('USDINR=X')).toBe('ROUND')
    expect(marketOf('^N225')).toBe('OTHER')
  })

  it('looks every few seconds while a market is open, not at all when shut', () => {
    expect(cadence('NSE', NSE_OPEN)).toBe(3)
    expect(cadence('US', NSE_OPEN)).toBeNull()
    expect(cadence('NSE', SUNDAY)).toBeNull()
    expect(cadence('ROUND', NSE_OPEN)).toBe(15)
  })

  it('asks only for what is on screen and pushes only what changed', async () => {
    let now = NSE_OPEN
    const asked: string[][] = []
    let price = 101
    const pushed: LiveQuote[][] = []
    const feed = new LiveFeed(
      async (symbols) => (asked.push(symbols), symbols.map((s) => q(s, s === 'INFY' ? price : 50))),
      (x) => pushed.push(x),
      () => now
    )
    await feed.tick()
    expect(asked).toEqual([])
    feed.watch('watchlist', ['infy', 'TCS', '^GSPC'])
    feed.watch('chart', ['INFY'])
    expect(feed.status()).toMatchObject({ symbols: 3, live: true, error: null })
    await feed.tick()
    expect(asked).toEqual([['INFY', 'TCS']]) // the US market is shut
    expect(pushed.at(-1)!.map((x) => x.symbol)).toEqual(['INFY', 'TCS'])
    // Too soon: nothing asked.
    now = new Date(NSE_OPEN.getTime() + 1000)
    await feed.tick()
    expect(asked).toHaveLength(1)
    // Three seconds on: asked again, and only the price that moved is pushed.
    now = new Date(NSE_OPEN.getTime() + 3000)
    price = 102
    await feed.tick()
    expect(pushed.at(-1)!.map((x) => [x.symbol, x.price])).toEqual([['INFY', 102]])
    feed.watch('watchlist', [])
    feed.watch('chart', [])
    expect(feed.status().symbols).toBe(0)
  })

  it('never steps back to an older answer from another cache', async () => {
    let now = NSE_OPEN
    const answers = [
      [1194.2, '04:46:24'],
      [1194.0, '04:46:31'],
      [1194.2, '04:46:24'], // an older cache
      [1194.0, '04:46:37'], // same price, newer: nothing to show
      [1195.0, '04:46:44']
    ] as const
    let i = 0
    const pushed: number[] = []
    const feed = new LiveFeed(
      async () => {
        const [price, t] = answers[i++]
        return [{ ...q('RELIANCE', price), time: `2026-10-27T${t}.000Z` }]
      },
      (x) => pushed.push(...x.map((y) => y.price)),
      () => now
    )
    feed.watch('w', ['RELIANCE'])
    for (let k = 0; k < answers.length; k++) {
      now = new Date(NSE_OPEN.getTime() + k * 3000)
      await feed.tick()
    }
    expect(pushed).toEqual([1194.2, 1194.0, 1195.0])
  })

  it('rests a minute when the source refuses', async () => {
    let now = NSE_OPEN
    let calls = 0
    const feed = new LiveFeed(
      async () => {
        calls++
        throw new Error('429')
      },
      () => {},
      () => now
    )
    feed.watch('w', ['INFY'])
    await feed.tick()
    now = new Date(NSE_OPEN.getTime() + 30_000)
    await feed.tick()
    expect(calls).toBe(1)
    now = new Date(NSE_OPEN.getTime() + 61_000)
    await feed.tick()
    expect(calls).toBe(2)
  })

  it('checks mandi prices more often while yards are trading', () => {
    expect(maxAge(new Date('2026-10-27T06:00:00Z'))).toBe(2 * 3600_000) // 11:30 IST
    expect(maxAge(new Date('2026-10-27T17:00:00Z'))).toBe(6 * 3600_000) // 22:30 IST
  })
})
