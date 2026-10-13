import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { BENCHMARKS, refreshBenchmarks, refreshDaily, seriesFor, toInr } from '../src/main/market/benchmarks'
import { FxTable } from '../src/main/portfolio/fx'
import { createServices } from '../src/main/services'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const ts = (iso: string) => Date.parse(`${iso}T09:30:00Z`) / 1000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`

function yahooChart(dates: string[], closes: number[], currency = 'INR') {
  return json({
    chart: {
      result: [
        {
          meta: { symbol: 'X', currency, regularMarketPrice: closes[closes.length - 1], gmtoffset: 0 },
          timestamp: dates.map(ts),
          indicators: { quote: [{ close: closes }] }
        }
      ],
      error: null
    }
  })
}

/** Canned Yahoo + mfapi responses; records every URL asked for. */
function fakeFetch(calls: string[], opts: { failSymbol?: string } = {}): typeof fetch {
  const recent = [iso(9), iso(2)]
  return (async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input))
    calls.push(url)
    if (opts.failSymbol && url.includes(`/chart/${opts.failSymbol}`)) return new Response('no', { status: 404 })
    if (url.includes('/chart/^GSPC')) return yahooChart(recent, [5000, 5100], 'USD')
    if (url.includes('/chart/')) return yahooChart(recent, [100, 110])
    if (url.includes('api.mfapi.in/mf/119091'))
      return json({ meta: {}, data: recent.map((d, i) => ({ date: dmy(d), nav: String(5000 + i * 10) })) })
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
}

let dir: string
let db: Db
let close: () => void

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-bm-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  db.insert(schema.fxRates).values({ pair: 'USDINR', rate: 90, prevClose: 89, asOf: iso(0), fetchedAt: iso(0) }).run()
  db.insert(schema.fxHistory)
    .values([
      { pair: 'USDINR', date: iso(30), rate: 80 },
      { pair: 'USDINR', date: iso(5), rate: 85 }
    ])
    .run()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('toInr', () => {
  it('uses the rate on or before each date, and the earliest rate for older dates', () => {
    const fx = FxTable.of(
      [
        { date: '2024-01-01', rate: 80 },
        { date: '2024-06-01', rate: 85 }
      ],
      90
    )
    expect(
      toInr(
        [
          { date: '2023-12-01', close: 10 },
          { date: '2024-03-15', close: 10 },
          { date: '2024-07-01', close: 10 }
        ],
        fx
      )
    ).toEqual([
      { date: '2023-12-01', close: 800 },
      { date: '2024-03-15', close: 800 },
      { date: '2024-07-01', close: 850 }
    ])
  })

  it('drops points when no rate is known at all', () => {
    expect(toInr([{ date: '2024-01-01', close: 10 }], FxTable.of([], null))).toEqual([])
  })
})

describe('refreshBenchmarks', () => {
  it('stores every benchmark, converting the S&P 500 to rupees', async () => {
    const calls: string[] = []
    const failed = await refreshBenchmarks(db, fakeFetch(calls))
    expect(failed).toEqual([])
    for (const b of BENCHMARKS) expect(seriesFor(db, b.key).length).toBeGreaterThan(0)

    // Closes from 9 and 2 days ago: the first uses the rate from 30 days ago (80), the second the one from 5 days ago (85).
    const sp = seriesFor(db, 'BM:SP500_INR')
    expect(sp.map((p) => p.close)).toEqual([5000 * 80, 5100 * 85])
    expect(seriesFor(db, 'BM:NIFTY50').map((p) => p.close)).toEqual([100, 110])
    expect(calls.some((u) => u.includes('range=10y') && u.includes('interval=1wk'))).toBe(true)
  })

  it('skips series refreshed within six days', async () => {
    await refreshBenchmarks(db, fakeFetch([]))
    const calls: string[] = []
    await refreshBenchmarks(db, fakeFetch(calls))
    expect(calls).toEqual([])
  })

  it('reports a benchmark that cannot be fetched without losing the others', async () => {
    const failed = await refreshBenchmarks(db, fakeFetch([], { failSymbol: '^CRSLDX' }))
    expect(failed).toEqual(['Nifty 500'])
    expect(seriesFor(db, 'BM:NIFTY50').length).toBe(2)
    expect(seriesFor(db, 'BM:NIFTY500').length).toBe(0)
  })
})

describe('refreshDaily', () => {
  it('fills daily closes for benchmarks and prunes rows older than ~13 months', async () => {
    db.insert(schema.priceDaily).values({ key: 'BM:NIFTY50', date: iso(500), close: 1 }).run()
    const calls: string[] = []
    const failed = await refreshDaily(db, fakeFetch(calls))
    expect(failed).toEqual([])
    expect(calls.some((u) => u.includes('range=1y') && u.includes('interval=1d'))).toBe(true)
    const n50 = seriesFor(db, 'BM:NIFTY50', { daily: true })
    expect(n50.map((p) => p.date)).toEqual([iso(9), iso(2)])
  })

  it('does not refetch a series that is already current', async () => {
    await refreshDaily(db, fakeFetch([]))
    const calls: string[] = []
    await refreshDaily(db, fakeFetch(calls))
    expect(calls).toEqual([])
  })
})

describe('listBenchmarks service', () => {
  it('returns stored series with labels, filtered by date, and hides empty ones', async () => {
    await refreshBenchmarks(db, fakeFetch([], { failSymbol: '^CRSLDX' }))
    const svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, fetch: fakeFetch([]) })
    const all = svc.listBenchmarks()
    expect(all.map((b) => b.key)).not.toContain('BM:NIFTY500')
    expect(all.find((b) => b.key === 'BM:LIQUID')?.totalReturn).toBe(true)
    expect(all.find((b) => b.key === 'BM:NIFTY50')?.label).toBe('Nifty 50')
    const recent = svc.listBenchmarks(iso(5))
    expect(recent.find((b) => b.key === 'BM:NIFTY50')?.points).toHaveLength(1)
  })
})
