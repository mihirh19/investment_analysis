import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { benchFor, categoryOf, fundDetail, saveStats, setFollowed, universeFrom, type UniverseFund } from '../src/main/funds/screen'
import { savePortfolioSnapshot } from '../src/main/funds/global'
import type { AmfiScheme } from '../src/main/market/funds'
import { applyFundScreen, benchmarkFor, computeFundMetrics, missingIndexFigures, monthEnds, NO_METRICS, rollingReturns, rollingStats, type FundRow, type PricePt } from '../src/shared/fundScreener'

/** Business days from a start, with a value made by the function of the day's index. */
function series(days: number, step: (i: number) => number, start = '2021-10-01'): PricePt[] {
  const out: PricePt[] = []
  let v = 100
  let i = 0
  for (let d = Date.parse(start); out.length < days; d += 86400_000) {
    const wd = new Date(d).getUTCDay()
    if (wd === 0 || wd === 6) continue
    v *= 1 + step(i++)
    out.push({ date: new Date(d).toISOString().slice(0, 10), close: v })
  }
  return out
}

describe('fund ratios', () => {
  // An index that zigzags upward, and a fund that moves 1.2 times as much plus a little every day.
  const b = (i: number) => (i % 2 ? 0.01 : -0.008)
  const bench = series(1300, b)
  const fund = series(1300, (i) => 1.2 * b(i) + 0.0002)

  it('works out returns, risk, beta and alpha', () => {
    const m = computeFundMetrics(fund, bench)
    expect(m.years).toBeGreaterThan(4.9)
    expect(m.beta).toBeCloseTo(1.2, 3)
    expect(m.r2).toBeCloseTo(1, 3)
    expect(m.alpha).toBeGreaterThan(0.03)
    expect(m.vol).toBeGreaterThan(0.1)
    expect(m.sharpe).not.toBeNull()
    expect(m.sortino).not.toBeNull()
    expect(m.maxDrawdown).toBeLessThan(0)
    expect(m.ret1y).toBeCloseTo(fund.at(-1)!.close / fund.find((p) => p.date >= new Date(Date.parse(fund.at(-1)!.date) - 365 * 86400_000).toISOString().slice(0, 10))!.close - 1, 1)
    expect(m.upCapture).toBeGreaterThan(100)
    expect(m.beatRate).toBe(1)
  })

  it('needs enough history', () => {
    expect(computeFundMetrics(fund.slice(0, 10), bench)).toMatchObject({ ...NO_METRICS, years: expect.any(Number) })
    const young = computeFundMetrics(fund.slice(-200), bench)
    expect(young.ret1m).not.toBeNull()
    expect(young.ret3y).toBeNull()
    expect(young.vol).toBeNull()
    // No index: ratios that need one are left out.
    const alone = computeFundMetrics(fund, null)
    expect(alone.sharpe).not.toBeNull()
    expect(alone.beta).toBeNull()
  })

  it('keeps month ends', () => {
    expect(monthEnds(fund).every((p, i, a) => i === 0 || p.date.slice(0, 7) !== a[i - 1].date.slice(0, 7))).toBe(true)
  })

  it('picks a fair index for each kind of fund', () => {
    expect(benchmarkFor('Large Cap Fund', 'HDFC Top 100')?.symbol).toBe('^NSEI')
    expect(benchmarkFor('Mid Cap Fund', 'Axis Midcap')?.symbol).toBe('NIFTYMIDCAP150.NS')
    expect(benchmarkFor('Small Cap Fund', 'SBI Small Cap')?.symbol).toBe('NIFTYSMLCAP250.NS')
    expect(benchmarkFor('Index Funds', 'Motilal Oswal Nifty Midcap 150 Index Fund')?.symbol).toBe('NIFTYMIDCAP150.NS')
    expect(benchmarkFor('Index Funds', 'Bharat Bond ETF FOF April 2030')).toBeNull()
    expect(benchmarkFor('Index Funds', 'Edelweiss CRISIL IBX 50:50 Gilt Plus SDL Index Fund')).toBeNull()
    expect(benchmarkFor('FoF Domestic', 'SBI Gold Fund')).toBeNull()
    expect(benchmarkFor('Sectoral/ Thematic', 'ICICI Prudential Banking and Financial Services')?.symbol).toBe('^NSEBANK')
    expect(benchmarkFor('Flexi Cap Fund', 'Parag Parikh Flexi Cap')?.symbol).toBe('^CRSLDX')
    expect(benchmarkFor('Liquid Fund', 'HDFC Liquid')).toBeNull()
    expect(benchmarkFor('Index Funds', 'UTI Nifty 50 Index Fund')?.symbol).toBe('^NSEI')
  })

  it('redoes ratios saved without their index', () => {
    const flexi = benchmarkFor('Flexi Cap Fund', 'Parag Parikh Flexi Cap')
    const full = computeFundMetrics(fund, bench)
    const bare = computeFundMetrics(fund, null)
    expect(missingIndexFigures(full, '^CRSLDX', flexi)).toBe(false)
    expect(missingIndexFigures(bare, '^CRSLDX', flexi)).toBe(true)
    // Measured against an index the fund no longer uses.
    expect(missingIndexFigures(full, 'NIFTY_MIDCAP_100.NS', benchmarkFor('Mid Cap Fund', 'Axis Midcap'))).toBe(true)
    // Debt: no index, nothing missing; a young fund can't have them yet.
    expect(missingIndexFigures(bare, null, null)).toBe(false)
    expect(missingIndexFigures({ ...bare, years: 0.5 }, '^CRSLDX', flexi)).toBe(false)
  })
})

describe('the list of funds', () => {
  it('keeps open-ended Direct growth plans, one per fund', () => {
    expect(categoryOf('Open Ended Schemes(Equity Scheme - Flexi Cap Fund)')).toEqual({ open: true, group: 'Equity', category: 'Flexi Cap Fund' })
    expect(categoryOf('Close Ended Schemes(Debt Scheme - FMP)').open).toBe(false)
    expect(categoryOf('Equity Scheme - Flexi Cap Fund')).toEqual({ open: true, group: 'Equity', category: 'Flexi Cap Fund' })
    const s = (o: Partial<AmfiScheme>): AmfiScheme => ({ code: '1', isinGrowth: null, isinReinvest: null, name: 'X', nav: 10, date: '2026-10-27', fundHouse: 'X Mutual Fund', category: 'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)', plan: null, option: null, ...o })
    const u = universeFrom([
      s({ code: '1', name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', isinGrowth: 'INF879O01027' }),
      s({ code: '2', name: 'Parag Parikh Flexi Cap Fund - Regular Plan - Growth' }),
      s({ code: '3', name: 'Parag Parikh Flexi Cap Fund - Direct Plan - IDCW' }),
      s({ code: '4', name: 'Some FMP - Direct - Growth', category: 'Close Ended Schemes(Debt Scheme - FMP)' }),
      s({ code: '5', name: 'Nippon India ETF Nifty 50 BeES', plan: 'Direct Plan', category: 'Open Ended Schemes(Other Scheme - Other ETFs)' }),
      s({ code: '6', name: 'HDFC Mid Cap Opportunities Fund', plan: 'Direct Plan', option: 'Growth Option', category: 'Open Ended Schemes(Equity Scheme - Mid Cap Fund)' })
    ])
    expect(u.map((x) => [x.code, x.name, x.category])).toEqual([
      ['1', 'Parag Parikh Flexi Cap Fund', 'Flexi Cap Fund'],
      ['5', 'Nippon India ETF Nifty 50 BeES', 'Other ETFs'],
      ['6', 'HDFC Mid Cap Opportunities Fund', 'Mid Cap Fund']
    ])
    // ETFs have no Direct plan; they are kept, marked as ETFs.
    expect(u.find((x) => x.code === '5')!.vehicle).toBe('ETF')
    expect(u.find((x) => x.code === '1')!.vehicle).toBeUndefined()
  })

  it('filters and sorts a screen', () => {
    const row = (code: string, o: Partial<FundRow>): FundRow =>
      ({ ...NO_METRICS, code, name: code, fundHouse: null, category: 'Flexi Cap Fund', group: 'Equity', isin: null, nav: 1, navDate: null, aumCr: 1000, ter: 0.5, risk: null, benchmark: null, index: null, held: false, statsAt: 'x', ...o }) as FundRow
    const rows = [row('A', { sharpe: 1.4 }), row('B', { sharpe: 0.6 }), row('C', { sharpe: 1.1, group: 'Debt' }), row('D', { sharpe: null })]
    expect(applyFundScreen(rows, { group: 'Equity', filters: [{ field: 'sharpe', op: '>=', value: 1 }], sort: { field: 'sharpe', dir: 'desc' } }).map((r) => r.code)).toEqual(['A'])
    expect(applyFundScreen(rows, { filters: [], sort: { field: 'sharpe', dir: 'asc' } }).map((r) => r.code)).toEqual(['B', 'C', 'A', 'D'])
  })
})

describe('one fund’s page', () => {
  it('shows holdings, sectors and what changed since last month', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-fund-'))
    const o = openDatabase(join(dir, 't.db'), 'e'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      db.insert(schema.settings).values({ key: 'funds:universe', value: JSON.stringify({ at: new Date().toISOString(), funds: [{ code: '122639', name: 'Parag Parikh Flexi Cap Fund', fundHouse: 'PPFAS Mutual Fund', category: 'Flexi Cap Fund', group: 'Equity', isin: 'INF879O01027', nav: 90, navDate: '2026-10-27' }] }) }).run()
      const inst = db.insert(schema.instruments).values({ name: 'Parag Parikh Flexi Cap Fund - Direct Growth', isin: 'INF879O01027', assetClass: 'MF', currency: 'INR' }).returning().get()
      const h = (asOf: string, name: string, isin: string, sector: string, weight: number) => ({ fundInstrumentId: inst.id, asOf, source: 'AMC', name, isin, sector, assetType: 'EQUITY' as const, weight })
      db.insert(schema.fundHoldings).values([
        h('2026-08-31', 'HDFC Bank', 'INE040A01034', 'Financials', 0.08),
        h('2026-08-31', 'ITC', 'INE154A01025', 'FMCG', 0.05),
        h('2026-09-30', 'HDFC Bank', 'INE040A01034', 'Financials', 0.075),
        h('2026-09-30', 'Coal India', 'INE522F01014', 'Energy', 0.03)
      ]).run()
      saveStats(db, '122639', { ...NO_METRICS, sharpe: 1.2, years: 5 }, [{ date: '2026-08-31', close: 88 }, { date: '2026-09-30', close: 90 }], null, null)
      const d = fundDetail(db, '122639')!
      // A record with no units isn't a holding.
      expect(d.row).toMatchObject({ held: false, sharpe: 1.2 })
      expect(d.holdings).toMatchObject({ asOf: '2026-09-30', prevAsOf: '2026-08-31' })
      expect(d.holdings!.rows.map((r) => [r.name, r.change])).toEqual([
        ['HDFC Bank', expect.closeTo(-0.005, 6)],
        ['Coal India', null]
      ])
      expect(d.holdings!.exited).toEqual([{ name: 'ITC', weight: 0.05 }])
      expect(d.sectors.find((s) => s.sector === 'FMCG')).toBeUndefined()
      expect(d.sectors.find((s) => s.sector === 'Energy')).toMatchObject({ weight: 0.03, change: 0.03 })
      expect(d.growth.map((g) => Math.round(g.fund))).toEqual([100, 102])
      // Month by month: each holding's share in August and September, sold-out ones after the rest.
      expect(d.history!.months).toEqual(['2026-08-31', '2026-09-30'])
      expect(d.history!.rows.map((r) => [r.name, r.weights])).toEqual([
        ['HDFC Bank', [0.08, 0.075]],
        ['Coal India', [null, 0.03]],
        ['ITC', [0.05, null]]
      ])
      expect(d.history!.sectors).toEqual([
        { sector: 'Financials', weights: [0.08, 0.075] },
        { sector: 'Energy', weights: [0, 0.03] },
        { sector: 'FMCG', weights: [0.05, 0] }
      ])
      // The Portfolio view: allocation and sectors per month, against SEBI's flexi cap range.
      expect(d.portfolio!.target).toEqual([
        { label: 'Equity', min: 0.65, max: 1 },
        { label: 'Cash & equivalents', min: 0, max: expect.closeTo(0.35, 9) }
      ])
      expect(d.portfolio!.periods.map((p) => [p.asOf, p.alloc[0].weight, p.sectors[0].sector])).toEqual([
        ['2026-08-31', expect.closeTo(0.13, 9), 'Financials'],
        ['2026-09-30', expect.closeTo(0.105, 9), 'Financials']
      ])
      expect(d.row).toMatchObject({ market: 'IN', vehicle: 'MF', currency: 'INR' })
      expect(fundDetail(db, 'nope')).toBeNull()

      // A UCITS ETF from the shipped list, with a Yahoo snapshot of its portfolio.
      savePortfolioSnapshot(db, 'UC:CSPX.L', {
        asOf: '2026-10-28',
        source: 'YAHOO',
        alloc: [{ label: 'Equity', weight: 0.995 }, { label: 'Cash & equivalents', weight: 0.005 }],
        sectors: [{ sector: 'Technology', weight: 0.33 }, { sector: 'Financials', weight: 0.13 }],
        holdings: [{ name: 'NVIDIA Corp', isin: null, sector: null, assetType: 'EQUITY', country: null, weight: 0.08 }]
      })
      const g = fundDetail(db, 'UC:CSPX.L')!
      expect(g.row).toMatchObject({ market: 'UCITS', vehicle: 'ETF', ticker: 'CSPX.L', currency: 'USD', category: 'US large cap', index: 'S&P 500 (via VUAA.L)' })
      expect(g.holdings!.rows[0]).toMatchObject({ name: 'NVIDIA Corp', weight: 0.08 })
      expect(g.portfolio).toMatchObject({ target: null, periods: [{ asOf: '2026-10-28' }] })
      expect(g.sectors[0]).toMatchObject({ sector: 'Technology', weight: 0.33 })

      // Following uses the fund's existing record, and can be undone.
      setFollowed(db, '122639', true)
      expect(fundDetail(db, '122639')!.followed).toBe(true)
      expect(db.select().from(schema.instruments).all()).toHaveLength(1)
      expect(db.select().from(schema.instruments).get()!.amfiCode).toBe('122639')
      setFollowed(db, '122639', false)
      expect(fundDetail(db, '122639')!.followed).toBe(false)
      expect(() => setFollowed(db, '999', true)).toThrow()
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// FP_LIVE=1: the real fund list, and one fund measured from mfapi.in against Yahoo's Nifty 500.
describe.skipIf(!process.env.FP_LIVE)('live fund screener', () => {
  it('lists the funds and measures one', { timeout: 120_000 }, async () => {
    const { fetchNavAll, mfapiHistory } = await import('../src/main/market/funds')
    const { yahooHistory } = await import('../src/main/market/yahoo')
    const u = universeFrom(await fetchNavAll())
    const groups = new Map<string, number>()
    for (const f of u) groups.set(f.group, (groups.get(f.group) ?? 0) + 1)
    const pp = u.find((f) => /parag parikh flexi cap/i.test(f.name))!
    const nav = await mfapiHistory(pp.code, new Date(Date.now() - 5.1 * 365 * 86400_000).toISOString().slice(0, 10))
    const idx = (await yahooHistory('^CRSLDX', '5y', undefined, '1d')).prices
    const m = computeFundMetrics(nav, idx)
    console.log(JSON.stringify({ funds: u.length, groups: [...groups], pp: { code: pp.code, name: pp.name, cat: pp.category }, navPoints: nav.length, idxPoints: idx.length, m }, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)))
    expect(u.length).toBeGreaterThan(800)
    expect(m.beta).not.toBeNull()
  })
})

describe('rolling returns', () => {
  it('earns the same every window for a steady fund, and counts the spread', () => {
    // 12% a year, every calendar day.
    const s: PricePt[] = []
    for (let d = 0; d < 365 * 6; d++) s.push({ date: new Date(Date.parse('2019-01-01') + d * 86400_000).toISOString().slice(0, 10), close: 100 * 1.12 ** (d / 365.25) })
    const r = rollingReturns(s, 3, 30)
    expect(r.length).toBeGreaterThan(30)
    expect(r[0].date >= '2022-01-01').toBe(true)
    for (const p of r) expect(p.value).toBeCloseTo(0.12, 3)
    const half = r.map((p) => ({ ...p, value: 0.1 }))
    const st = rollingStats(r, half, 3)
    expect(st).toMatchObject({ years: 3, windows: r.length, negative: 0, beatIndex: 1 })
    expect(st.min).toBeCloseTo(0.12, 3)
    expect(st.buckets.find((b) => b.label === '12–15%')?.share ?? 0).toBeGreaterThan(0.4)
    expect(rollingReturns(s.slice(0, 300), 3)).toEqual([])
  })
})

describe('a fund’s index', () => {
  const etf = (ticker: string, name: string): UniverseFund => ({ code: `UC:${ticker}`, name, fundHouse: null, category: '', group: 'Equity', isin: null, nav: 1, navDate: null, market: 'UCITS', vehicle: 'ETF', ticker, currency: 'USD' })

  it('is never the fund itself: a second fund on the same index stands in, or none', () => {
    // CSPX.L is the dollar S&P 500 line used as the index, so it is measured against another one.
    expect(benchFor(etf('CSPX.L', 'iShares Core S&P 500 UCITS ETF'))).toMatchObject({ symbol: 'VUAA.L', label: 'S&P 500 (via VUAA.L)' })
    expect(benchFor(etf('IWDA.L', 'iShares Core MSCI World UCITS ETF'))?.symbol).toBe('XDWD.L')
    // No second dollar line for emerging markets: no index rather than a meaningless one.
    expect(benchFor(etf('EIMI.L', 'iShares Core MSCI EM IMI UCITS ETF'))).toBeNull()
    // Any other fund keeps the index its name points to.
    expect(benchFor(etf('VUAA.L', 'Vanguard S&P 500 UCITS ETF'))?.symbol).toBe('CSPX.L')
  })
})
