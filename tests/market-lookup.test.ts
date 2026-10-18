import { describe, expect, it } from 'vitest'
import type { SchemeFacts } from '../src/shared/insights'
import type { AmfiScheme } from '../src/main/market/funds'
import { calendarYears, fundHistory, fundLookup, nameMatches, returnOver, stockLookup, worstFall } from '../src/main/marketLookup'

const day = (iso: string, close: number) => ({ date: iso, close })

describe('returns from a price history', () => {
  const pts = [day('2021-10-15', 100), day('2023-10-16', 121), day('2024-10-15', 110), day('2025-10-15', 132), day('2026-09-15', 150), day('2026-10-15', 165)]
  it('is simple under a year and a yearly rate beyond', () => {
    expect(returnOver(pts, 30)).toBe(10)
    expect(returnOver(pts, 365)).toBe(25)
    // 100 → 165 over five years: 10.54% a year.
    expect(returnOver(pts, 5 * 365)).toBeCloseTo(10.54, 1)
    // Not enough history.
    expect(returnOver(pts, 10 * 365)).toBeNull()
  })
  it('finds the worst fall and calendar-year returns', () => {
    expect(worstFall(pts)).toEqual({ pct: -9.09, bottom: '2024-10-15' })
    expect(calendarYears(pts)).toEqual({ '2023': 21, '2024': -9.09, '2025': 20, '2026': 25 })
  })
})

describe('finding a fund', () => {
  const plr = (r: number) => ({ regular: r - 0.8, direct: r }) as never
  const fact = (name: string, aumCr: number): SchemeFacts => ({
    name,
    category: 'Flexi Cap Fund',
    categoryGroup: 'Equity',
    benchmark: 'NIFTY 500 TRI',
    risk: 'Very High',
    aumCr,
    navDate: '2026-10-16',
    r1y: plr(14),
    r3y: plr(18),
    r5y: plr(20),
    r10y: plr(16),
    terRegular: 1.3,
    terDirect: 0.6
  })
  const nav = (code: string, name: string): AmfiScheme => ({ code, name, nav: 90, date: '2026-10-16', isinGrowth: null, isinReinvest: null, fundHouse: 'PPFAS Mutual Fund', category: null, plan: null, option: null })

  it('matches every word of the name, ignoring plan words, biggest first', () => {
    expect(nameMatches('Parag Parikh Flexi Cap Fund - Direct Plan - Growth', 'parag parikh flexi')).toBe(true)
    expect(nameMatches('Parag Parikh Flexi Cap Fund', 'parag flexicap')).toBe(false)
    expect(nameMatches('HDFC Flexi Cap Fund', 'fund')).toBe(false)
    const r = fundLookup(
      'flexi cap',
      { date: '2026-10-16', schemes: [fact('HDFC Flexi Cap Fund', 70000), fact('Parag Parikh Flexi Cap Fund', 110000), fact('HDFC Mid Cap Fund', 80000)] },
      [nav('122640', 'Parag Parikh Flexi Cap Fund - Direct Plan - IDCW'), nav('122639', 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth')]
    )
    expect(r.funds.map((f) => f.name)).toEqual(['Parag Parikh Flexi Cap Fund', 'HDFC Flexi Cap Fund'])
    // Growth plans first.
    expect(r.plans.map((p) => p.code)).toEqual(['122639', '122640'])
    expect(fundLookup('nothing like this', { date: null, schemes: [] }, []).note).toMatch(/No fund/)
  })

  it('reads a scheme’s NAV record', async () => {
    const h = await fundHistory('122639', async () => [day('2025-10-16', 80), day('2026-10-16', 92)], new Date('2026-10-17'))
    expect(h).toMatchObject({ nav: 92, navDate: '2026-10-16', returnsPct: { '1 year': 15 }, byCalendarYear: { '2026': 15 } })
  })
})

describe('a stock or index', () => {
  it('tries the NSE symbol first and reads price, range and returns', async () => {
    const asked: string[] = []
    const f = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const symbol = decodeURIComponent(url.pathname.split('/').pop()!)
      asked.push(symbol)
      const range = url.searchParams.get('range')
      const day0 = Date.parse('2025-10-16T10:00:00Z') / 1000
      const ts = range === '1d' ? [day0 + 365 * 86400] : [day0, day0 + 200 * 86400, day0 + 365 * 86400]
      const close = range === '1d' ? [1650] : [1500, 1400, 1650]
      return new Response(
        JSON.stringify({
          chart: {
            result: [{ meta: { currency: 'INR', symbol, regularMarketPrice: 1650, chartPreviousClose: 1600, longName: 'Infosys Limited', gmtoffset: 19800 }, timestamp: ts, indicators: { quote: [{ close }] } }],
            error: null
          }
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }) as typeof fetch
    const r = await stockLookup('INFY', f)
    expect(asked[0]).toBe('INFY.NS')
    expect(r).toMatchObject({ symbol: 'INFY.NS', exchange: 'NSE', name: 'Infosys Limited', price: 1650, dayChangePct: 3.13, high52w: 1650, low52w: 1400 })
    expect(r.returnsPct['1 year']).toBe(10)
    expect((await stockLookup('Nifty 50', f)).symbol).toBe('^NSEI')
  })
})
