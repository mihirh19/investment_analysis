import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adjustBars, rankStrength, rsi, technicalsOf, type Bar, type Technicals } from '../src/shared/technicals'
import { parseDeliveryFile } from '../src/main/research/nse'
import { openDatabase, schema, type Db } from '../src/main/db'
import { barProgress, barsOf, screenData } from '../src/main/research/store'
import { ResearchSync } from '../src/main/research/sync'
import { applyScreen, PRESET_SCREENS } from '../src/shared/screener'

const fx = (f: string) => join(__dirname, 'fixtures', 'nse', f)

/** Weekday dates going back from 2026-10-23, oldest first. */
function weekdays(n: number): string[] {
  const out: string[] = []
  const d = new Date('2026-10-23T00:00:00Z')
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}
const series = (closes: number[], extra: Partial<Bar> = {}): Bar[] => {
  const dates = weekdays(closes.length)
  return closes.map((c, i) => ({ date: dates[i], open: c, high: c, low: c, close: c, prevClose: i ? closes[i - 1] : null, volume: 1000, delivPct: 40, ...extra }))
}

describe('price adjustments and indicators', () => {
  it('scales the bars before a 1:5 split so the chart has no cliff', () => {
    const bars = series([500, 510, 520, 104, 106])
    // On the ex-date NSE prints the previous close already divided by 5.
    bars[3].prevClose = 104
    const adj = adjustBars(bars)
    expect(adj.map((b) => Math.round(b.close))).toEqual([100, 102, 104, 104, 106])
    expect(adj[0].volume).toBe(5000)
    // Ordinary days (and dividends' small gaps) leave prices alone.
    expect(adjustBars(series([100, 101, 99])).map((b) => b.close)).toEqual([100, 101, 99])
  })

  it('works out RSI the way Wilder did', () => {
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toBe(100)
    expect(rsi([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10])).toBe(50)
    // Up 1, down 1, alternately: balanced.
    const zig = Array.from({ length: 40 }, (_, i) => 100 + (i % 2))
    expect(rsi(zig)!).toBeGreaterThan(45)
    expect(rsi(zig)!).toBeLessThan(55)
    expect(rsi([1, 2, 3])).toBeNull()
  })

  it('reads returns, averages, a fresh golden cross, volume spikes and a new high', () => {
    // 260 days falling, then 60 days rising hard: the 50-day crosses above the 200-day near the end.
    const closes = [...Array.from({ length: 260 }, (_, i) => 200 - i * 0.3), ...Array.from({ length: 60 }, (_, i) => 122 + i * 3)]
    const bars = series(closes)
    bars[bars.length - 1].volume = 3000
    bars[bars.length - 1].delivPct = 80
    const t = technicalsOf(bars)!
    expect(t.date).toBe('2026-10-23')
    expect(t.ret1w).toBeCloseTo(closes[319] / closes[314] - 1)
    expect(t.ret1y).toBeCloseTo(closes[319] / closes[69] - 1)
    expect(t.vsSma50).toBeGreaterThan(0)
    expect(t.sma50vs200).toBeGreaterThan(0)
    expect(t.crossDays).not.toBeNull()
    expect(t.crossDays!).toBeLessThan(30)
    expect(t.volumeSpike).toBeCloseTo(3)
    expect(t.delivSpike).toBeCloseTo(2)
    expect(t.newHigh).toBe(1)
    expect(t.rsi14).toBeGreaterThan(70)
    expect(t.drawdown1y).toBeLessThan(0)
  })

  it('ranks strength 1 to 99 across stocks', () => {
    const all = new Map<string, Technicals>()
    for (const [s, m] of [['A', -0.2], ['B', 0.1], ['C', 0.5]] as const) all.set(s, { momentum: m, rsRating: null } as Technicals)
    rankStrength(all)
    expect([...all.values()].map((t) => t.rsRating)).toEqual([1, 50, 99])
  })

  it('reads NSE’s delivery file', () => {
    const rows = parseDeliveryFile(readFileSync(fx('sec_bhavdata_full_23102026.csv'), 'utf8'))
    expect(rows.find((r) => r.symbol === 'TCS')).toMatchObject({
      date: '2026-10-23',
      prevClose: 2506.9,
      open: 2568,
      close: 2530,
      volume: 6857942,
      delivPct: 34.36
    })
    expect(rows).toHaveLength(4)
  })
})

describe('price history download', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-bars-'))
    const o = openDatabase(join(dir, 't.db'), '8'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    db.insert(schema.nseListings).values({ isin: 'INE467B01029', symbol: 'TCS', name: 'Tata Consultancy Services Limited', kind: 'EQ', updatedAt: new Date().toISOString() }).run()
    // Results and the day's file are already in; only price history is wanted here.
    db.insert(schema.researchCompanies).values({ symbol: 'TCS', checkedAt: new Date().toISOString(), error: null }).run()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fetches each missing trading day once, skips holidays, and fills the screener', async () => {
    const asked: string[] = []
    let price = 2000
    const f = (async (url: string) => {
      asked.push(url)
      const m = /sec_bhavdata_full_(\d\d)(\d\d)(\d{4})\.csv/.exec(url)
      if (m) {
        // Every Monday is a holiday in this made-up market.
        const date = `${m[3]}-${m[2]}-${m[1]}`
        if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) return new Response('not found', { status: 404 })
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]
        price -= 1
        return new Response(
          'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER\n' +
            `TCS, EQ, ${m[1]}-${mon}-${m[3]}, ${price + 1}, ${price}, ${price}, ${price}, ${price}, ${price}, ${price}, 1000, 1, 10, 500, 50.00\n`
        )
      }
      if (url.includes('integrated-filing-results')) return new Response(JSON.stringify({ data: [], totalCount: 0 }))
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const sync = new ResearchSync(db, () => {}, f, 0)
    await sync.run()
    const p = barProgress(db)
    // About two years of weekdays, less the Mondays.
    expect(p.days).toBeGreaterThan(380)
    expect(p.days).toBeLessThan(440)
    expect(barsOf(db, 'TCS')).toHaveLength(p.days)
    const fileAsks = asked.filter((u) => u.includes('sec_bhavdata')).length
    const row = screenData(db).rows.find((r) => r.symbol === 'TCS')!
    // Days are fetched newest first and the fake price falls as it goes back: a steady rise.
    expect(row.ret1m).toBeGreaterThan(0)
    expect(row.rsRating).toBe(50)
    expect(row.rsi14).toBe(100)
    // A second pass asks for nothing old again (only the last few days, which may not be out yet).
    asked.length = 0
    await sync.run()
    expect(asked.filter((u) => u.includes('sec_bhavdata')).length).toBeLessThanOrEqual(3)
    expect(fileAsks).toBeGreaterThan(500)
    // The quality-oversold screen needs ROE too, which TCS has no results for here.
    expect(applyScreen(screenData(db).rows, PRESET_SCREENS.find((s) => s.name === 'Quality, oversold')!)).toHaveLength(0)
  })
})
