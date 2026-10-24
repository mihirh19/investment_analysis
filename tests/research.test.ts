import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { companyView, marketMonitor, screenData, searchCompanies } from '../src/main/research/store'
import { parseResultsXbrl } from '../src/main/research/xbrl'
import { latestRefs, NseClient, nseDate, parseDayFiles, parseIndices, parseIntegratedList, parseLegacyList } from '../src/main/research/nse'
import { applyScreen, fundamentalsOf, NO_FUNDAMENTALS, PRESET_SCREENS, screenRow, sortRows, type ScreenRow } from '../src/shared/screener'
import { candidateDays, ResearchSync } from '../src/main/research/sync'
import { arrange, computeMetrics, fyLabel, quarterLabel, type Filing } from '../src/shared/research'

const fx = (f: string) => join(__dirname, 'fixtures', 'nse', f)
const text = (f: string) => readFileSync(fx(f), 'utf8')
const crore = 1e7

describe('results XBRL', () => {
  it('reads an integrated filing: quarter, half year, balance sheet and cash flow', () => {
    const f = parseResultsXbrl(text('tcs-2026-09-consolidated.xml'))!
    expect(f).toMatchObject({ symbol: 'TCS', periodEnd: '2026-09-30', basis: 'C', bank: false, months: 6 })
    expect(f.quarter.revenue).toBe(73188 * crore)
    expect(f.quarter.netProfit).toBe(13934 * crore)
    expect(f.quarter.ownersProfit).toBe(13884 * crore)
    expect(f.quarter.eps).toBe(38.37)
    // EBITDA: profit before one-offs and tax, plus interest and depreciation, less other income.
    expect(f.quarter.operatingProfit).toBe((18638 + 252 + 1262 - 1337) * crore)
    expect(f.ytd.revenue).toBe(145463 * crore)
    expect(f.ytd.exceptional).toBe(-668 * crore)
    expect(f.ytd.cfo).toBeGreaterThan(0)
    expect(f.balance).toMatchObject({ assets: 190782 * crore, equity: 118986 * crore, totalEquity: 119994 * crore, borrowings: 0 })
    expect(f.shareCapital).toBe(362 * crore)
    expect(f.faceValue).toBe(1)
  })

  it('reads the older BSE-format filing with full-year figures', () => {
    const f = parseResultsXbrl(text('tcs-2024-03-consolidated.xml'))!
    expect(f).toMatchObject({ symbol: 'TCS', periodEnd: '2024-03-31', basis: 'C', months: 12 })
    expect(f.ytd.revenue).toBeGreaterThan(f.quarter.revenue! * 3.5)
    expect(f.balance?.assets).toBeGreaterThan(0)
    expect(f.ytd.cfo).toBeGreaterThan(0)
  })

  it('reads a bank: income, operating profit before provisions, deposits', () => {
    const f = parseResultsXbrl(text('hdfcbank-2026-09-consolidated.xml'))!
    expect(f).toMatchObject({ symbol: 'HDFCBANK', bank: true, basis: 'C' })
    expect(f.quarter.revenue).toBe(129358.69 * crore)
    expect(f.quarter.operatingProfit).toBe(32871.54 * crore)
    expect(f.quarter.provisions).toBe(4209 * crore)
    expect(f.quarter.netProfit).toBe(20700.03 * crore)
    expect(f.balance).toMatchObject({ deposits: 3324146.36 * crore, advances: 3316057.54 * crore })
    expect(f.balance?.equity).toBeCloseTo((1541.86 + 601927.19) * crore, -2)
  })

  it('ignores files that are not results', () => {
    expect(parseResultsXbrl('<xbrl></xbrl>')).toBeNull()
  })
})

describe('NSE lists and daily files', () => {
  it('reads both filing lists', () => {
    const legacy = parseLegacyList(JSON.parse(text('tcs-legacy-list.json')))
    expect(legacy[0]).toMatchObject({ symbol: 'TCS', periodEnd: '2024-12-31', basis: 'C' })
    expect(legacy[1].basis).toBe('S')
    expect(legacy[0].filedAt).toBe('2025-01-09T21:39:43+05:30')
    const { refs, rows } = parseIntegratedList(JSON.parse(text('tcs-integrated-list.json')))
    expect(rows).toBe(6)
    // The "New" rows without a basis are left out.
    expect(refs.every((r) => r.url.endsWith('.xml'))).toBe(true)
    expect(refs[0]).toMatchObject({ periodEnd: '2026-09-30', basis: 'C' })
  })

  it('keeps the latest filing for a period', () => {
    const a = { symbol: 'X', periodEnd: '2026-06-30', basis: 'C' as const, url: 'a', filedAt: '2026-07-10T10:00:00+05:30' }
    expect(latestRefs([a, { ...a, url: 'b', filedAt: '2026-08-01T10:00:00+05:30' }])).toEqual([{ ...a, url: 'b', filedAt: '2026-08-01T10:00:00+05:30' }])
  })

  it('reads dates', () => {
    expect(nseDate('30-SEP-2026')).toBe('2026-09-30')
    expect(nseDate('1-Jan-2025 10:00')).toBe('2025-01-01')
    expect(nseDate('bad')).toBeNull()
  })

  it("reads the day's prices, market caps and P/E", () => {
    const q = parseDayFiles(readFileSync(fx('PR231026.zip')), '2026-10-23', text('PE_231026.csv'))
    const tcs = q.find((x) => x.symbol === 'TCS')!
    expect(tcs).toMatchObject({ close: 2530, prevClose: 2506.9, high52: 3350, low52: 1976.8, pe: 17.49 })
    expect(tcs.mcap).toBeCloseTo(9153761420540, 0)
    expect(q.find((x) => x.symbol === '20MICRONS')?.pe).toBeNull()
  })

  it('looks for the latest trading day, skipping weekends', () => {
    // Saturday 24 Oct 2026, 10 am IST: Friday first.
    expect(candidateDays(new Date('2026-10-24T10:00:00Z'), 3)).toEqual(['2026-10-23', '2026-10-22', '2026-10-21'])
    // Friday evening: Friday's files may be out.
    expect(candidateDays(new Date('2026-10-23T20:00:00Z'), 1)).toEqual(['2026-10-23'])
  })

  it('spaces requests out and backs off after a refusal', async () => {
    const calls: number[] = []
    let slept = 0
    const f = (async (url: string) => {
      calls.push(Date.now())
      return new Response(url.includes('refuse') ? 'no' : '{"ok":1}', { status: url.includes('refuse') ? 403 : 200 })
    }) as unknown as typeof fetch
    const nse = new NseClient(f, 50, async (ms) => {
      slept += ms
    })
    await nse.json('https://x.test/a')
    await expect(nse.json('https://x.test/refuse')).rejects.toThrow('403')
    await nse.json('https://x.test/b')
    expect(calls).toHaveLength(3)
    expect(slept).toBeGreaterThan(50_000)
  })

  it('treats a web page in place of data as an outage', async () => {
    const f = (async () => new Response('<html>busy</html>')) as unknown as typeof fetch
    await expect(new NseClient(f, 0).json('https://x.test/a')).rejects.toThrow('web page')
  })
})

describe('ratios', () => {
  const flow = (rev: number, profit: number, extra: object = {}) => ({ revenue: rev, operatingProfit: rev * 0.25, pbt: profit * 1.3, finance: 1, ownersProfit: profit, netProfit: profit, eps: profit / 10, ...extra })
  const filing = (periodEnd: string, rev: number, profit: number, more: Partial<Filing> = {}): Filing => ({
    symbol: 'ABC', periodEnd, basis: 'C', bank: false, months: 3, quarter: flow(rev, profit), ytd: {}, balance: null, shareCapital: 100, faceValue: 10, ...more
  })
  const year = (end: string, rev: number, profit: number, assets: number, equity: number, cfo: number) =>
    filing(end, rev / 4, profit / 4, {
      months: 12,
      ytd: flow(rev, profit, { cfo }),
      balance: { assets, equity, totalEquity: equity, borrowings: 20, currentAssets: 60, currentLiabilities: 30 }
    })
  const filings = [
    year('2023-03-31', 800, 80, 900, 500, 90),
    year('2024-03-31', 900, 90, 950, 550, 100),
    year('2025-03-31', 1000, 100, 1000, 600, 120),
    year('2026-03-31', 1200, 130, 1100, 680, 150),
    filing('2025-06-30', 280, 28),
    filing('2025-09-30', 290, 30),
    filing('2025-12-31', 300, 32),
    filing('2026-06-30', 320, 36),
    filing('2026-06-30', 300, 30, { basis: 'S' })
  ]

  it('lays out quarters and years and prefers consolidated', () => {
    const a = arrange(filings)
    expect(a.basis).toBe('C')
    expect(a.bases).toEqual(['C', 'S'])
    expect(a.quarters.map((q) => q.periodEnd).slice(0, 3)).toEqual(['2026-06-30', '2026-03-31', '2025-12-31'])
    expect(a.years.map((y) => fyLabel(y.periodEnd))).toEqual(['FY26', 'FY25', 'FY24', 'FY23'])
    expect(arrange(filings, 'S').quarters[0].revenue).toBe(300)
    expect(quarterLabel('2026-06-30')).toBe('Jun 26')
  })

  it('works out TTM, ROE, growth and the Piotroski score', () => {
    const a = arrange(filings)
    const m = computeMetrics(a, { symbol: 'ABC', date: '2026-10-23', close: 50, prevClose: 49, open: null, high: null, low: null, high52: null, low52: null, volume: null, mcap: null, pe: null }, { capital: 100, face: 10 })
    expect(m.shares).toBe(10)
    expect(m.mcap).toBe(500)
    expect(m.ttmRevenue).toBe(320 + 300 + 300 + 290)
    expect(m.ttmProfit).toBe(36 + 32.5 + 32 + 30)
    expect(m.pe).toBeCloseTo(500 / 130.5)
    expect(m.roe).toBeCloseTo(130 / 640)
    expect(m.salesGrowth3y).toBeCloseTo((1200 / 800) ** (1 / 3) - 1)
    expect(m.salesGrowthQ).toBeCloseTo(320 / 280 - 1)
    expect(m.piotroski?.year).toBe('FY26')
    expect(m.piotroski?.score).toBeGreaterThanOrEqual(6)
  })

  it('leaves out what can’t be worked out', () => {
    const m = computeMetrics(arrange([]), null, { capital: null, face: null })
    expect(m).toMatchObject({ mcap: null, pe: null, roe: null, piotroski: null, ttmRevenue: null })
  })
})

describe('the download, end to end', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-research-'))
    const o = openDatabase(join(dir, 't.db'), '6'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    const at = new Date().toISOString()
    db.insert(schema.nseListings).values([
      { isin: 'INE467B01029', symbol: 'TCS', name: 'Tata Consultancy Services Limited', kind: 'EQ', updatedAt: at },
      { isin: 'INE040A01034', symbol: 'HDFCBANK', name: 'HDFC Bank Limited', kind: 'EQ', updatedAt: at },
      { isin: 'INF204KB14I2', symbol: 'NIFTYBEES', name: 'Nippon Nifty ETF', kind: 'ETF', updatedAt: at }
    ]).run()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  // A stand-in for NSE: TCS has one filing in each list; HDFC Bank's list call fails.
  const legacyUrl = 'https://nsearchives.nseindia.com/corporate/xbrl/OLD.xml'
  const newUrl = 'https://nsearchives.nseindia.com/corporate/xbrl/NEW.xml'
  const requested: string[] = []
  const fakeNse = (async (url: string) => {
    requested.push(url)
    if (url.includes('corporates-financial-results') && url.includes('TCS'))
      return new Response(JSON.stringify([{ symbol: 'TCS', toDate: '31-Mar-2024', consolidated: 'Consolidated', broadCastDate: '12-Apr-2024 21:01:55', xbrl: legacyUrl }]))
    if (url.includes('integrated-filing-results') && url.includes('symbol=TCS'))
      return new Response(JSON.stringify({ data: [{ symbol: 'TCS', qe_Date: '30-SEP-2026', consolidated: 'Consolidated', type: 'Integrated Filing- Financials', broadcast_Date: '08-Oct-2026 22:07:33', xbrl: newUrl }], totalCount: 1 }))
    if (url === legacyUrl) return new Response(text('tcs-2024-03-consolidated.xml'))
    if (url === newUrl) return new Response(text('tcs-2026-09-consolidated.xml'))
    if (url.includes('integrated-filing-results') && url.includes('from_date')) return new Response(JSON.stringify({ data: [], totalCount: 0 }))
    if (url.includes('PR')) return new Response(readFileSync(fx('PR231026.zip')))
    if (url.includes('PE_')) return new Response(text('PE_231026.csv'))
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  it('opening a company fetches its filings and fills the page', async () => {
    const sync = new ResearchSync(db, () => {}, fakeNse, 0)
    expect(companyView(db, 'TCS')?.results.state).toBe('WAITING')
    await sync.open('TCS')
    const v = companyView(db, 'TCS')!
    expect(v.results).toMatchObject({ state: 'DONE', stored: 2 })
    expect(v.quarters.map((q) => q.periodEnd)).toEqual(['2026-09-30', '2024-03-31'])
    expect(v.years.map((y) => fyLabel(y.periodEnd))).toEqual(['FY24'])
    expect(v.balances).toHaveLength(2)
    expect(v.metrics.shares).toBe(362e7)
    // Opening it again asks NSE nothing new.
    const before = requested.length
    await sync.open('TCS')
    expect(requested.length).toBe(before)
  })

  it('works through the backlog, prices first, and can be paused', async () => {
    const sync = new ResearchSync(db, () => {}, fakeNse, 0)
    sync.setEnabled(false)
    await sync.run()
    expect(sync.status()).toMatchObject({ state: 'PAUSED', companiesDone: 0 })
    sync.setEnabled(true)
    await sync.run()
    const s = sync.status()
    expect(s.companies).toBe(2) // ETFs are left out
    expect(s.companiesDone).toBe(2)
    expect(s.filings).toBe(2)
    expect(s.pricesDate).not.toBeNull()
    expect(companyView(db, 'TCS')?.quote?.close).toBe(2530)
    // HDFC Bank's list failed: the company is marked with the error rather than retried forever.
    expect(companyView(db, 'HDFCBANK')?.results.error).toMatch(/404/)
    expect(searchCompanies(db, 'tata')[0]).toMatchObject({ symbol: 'TCS' })
    expect(searchCompanies(db, 'nifty')).toEqual([])
    // The screener and the monitor read what the download stored.
    const sd = screenData(db)
    expect(sd).toMatchObject({ companies: 2, withResults: 1 })
    const tcs = sd.rows.find((r) => r.symbol === 'TCS')!
    expect(tcs.roe).toBeGreaterThan(0.3)
    expect(tcs.pe).toBe(17.49)
    const mon = marketMonitor(db)
    expect(mon.indices.map((i) => i.name).slice(0, 3)).toEqual(['Nifty 50', 'Nifty Next 50', 'Nifty Bank'])
    expect(mon.breadth.up + mon.breadth.down + mon.breadth.flat).toBe(2)
  })
})

// FP_LIVE=1: one real company from NSE (about 35 requests, half a minute).
describe.skipIf(!process.env.FP_LIVE)('live NSE', () => {
  it('downloads and reads Infosys’s results', { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-research-live-'))
    const o = openDatabase(join(dir, 't.db'), '7'.repeat(64), resolve('drizzle'))
    o.db.insert(schema.nseListings).values({ isin: 'INE009A01021', symbol: 'INFY', name: 'Infosys Limited', kind: 'EQ', updatedAt: new Date().toISOString() }).run()
    const sync = new ResearchSync(o.db)
    await sync.open('INFY')
    const v = companyView(o.db, 'INFY')!
    expect(v.results.state).toBe('DONE')
    expect(v.results.stored).toBeGreaterThan(25)
    expect(v.quarters).toHaveLength(13) // the page shows three years of quarters
    expect(v.years.length).toBeGreaterThan(5)
    expect(v.metrics.roe).toBeGreaterThan(0.15)
    expect(v.metrics.piotroski).not.toBeNull()
    o.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('screener', () => {
  const row = (symbol: string, f: Partial<ScreenRow>): ScreenRow => ({
    ...screenRow({ symbol, name: symbol, industry: null, held: false }, NO_FUNDAMENTALS, null),
    ...f
  })

  it('works out price figures from fundamentals and the day', () => {
    const f = { ...NO_FUNDAMENTALS, shares: 100, equity: 5000, borrowings: 1000, cash: 500, ttmProfit: 800, ttmEbit: 1200, epsTtm: 8, dividendsFy: 200 }
    const q = { symbol: 'X', date: '2026-10-23', close: 100, prevClose: 95, open: null, high: null, low: null, high52: 125, low52: 80, volume: null, mcap: null, pe: null }
    const r = screenRow({ symbol: 'X', name: 'X Ltd', industry: 'IT', held: true }, f, q)
    expect(r.mcap).toBe(10000)
    expect(r.pe).toBe(12.5)
    expect(r.pb).toBe(2)
    expect(r.earningsYield).toBeCloseTo(1200 / 10500)
    expect(r.dividendYield).toBe(0.02)
    expect(r.fromHigh).toBeCloseTo(-0.2)
    expect(r.change).toBeCloseTo(100 / 95 - 1)
    expect(r.toGraham).toBeCloseTo(100 / Math.sqrt(22.5 * 8 * 50) - 1)
  })

  it('filters, leaves out lenders and missing figures, and ranks the Magic Formula', () => {
    const rows = [
      row('A', { mcap: 2e10, roce: 0.4, earningsYield: 0.05 }),
      row('B', { mcap: 2e10, roce: 0.2, earningsYield: 0.12 }),
      row('C', { mcap: 2e10, roce: 0.3, earningsYield: 0.1 }),
      row('BANK', { mcap: 2e10, roce: 0.5, earningsYield: 0.2, bank: true }),
      row('NOROCE', { mcap: 2e10, earningsYield: 0.3 })
    ]
    const magic = PRESET_SCREENS.find((s) => s.rank === 'magic')!
    // Banks, and companies missing a figure, are left out.
    const out = applyScreen(rows, magic).map((r) => r.symbol)
    expect([...out].sort()).toEqual(['A', 'B', 'C'])
    // Best on both counts comes first.
    expect(applyScreen([...rows, row('TOP', { mcap: 2e10, roce: 0.9, earningsYield: 0.15 })], magic)[0].symbol).toBe('TOP')
    const lowDebt = applyScreen([row('D', { debtToEquity: 0.05, roce: 0.25, mcap: 6e9 }), row('E', { debtToEquity: 0.5, roce: 0.3, mcap: 6e9 })], PRESET_SCREENS.find((s) => s.name === 'Low debt, high ROCE')!)
    expect(lowDebt.map((r) => r.symbol)).toEqual(['D'])
    expect(sortRows(rows, 'roce', 'desc').map((r) => r.symbol)).toEqual(['BANK', 'A', 'C', 'B', 'NOROCE'])
  })

  it('keeps the weakest five-year figures for the Coffee Can test', () => {
    const y = (end: string, rev: number, pbt: number, equity: number): Filing => ({
      symbol: 'Q', periodEnd: end, basis: 'C', bank: false, months: 12, quarter: {}, ytd: { revenue: rev, pbt, finance: 0, ownersProfit: pbt * 0.75 }, balance: { assets: equity * 1.5, equity, totalEquity: equity, borrowings: 0 }, shareCapital: 10, faceValue: 1
    })
    const f = fundamentalsOf([y('2022-03-31', 100, 30, 100), y('2023-03-31', 115, 35, 110), y('2024-03-31', 130, 40, 120), y('2025-03-31', 150, 45, 130), y('2026-03-31', 170, 50, 140)])
    expect(f.years).toBe(5)
    expect(f.salesGrowthMin5).toBeCloseTo(130 / 115 - 1)
    // The first year has no year-start balance sheet, so its ROCE is on year-end capital: 30 / 100.
    expect(f.roceMin5).toBeCloseTo(0.3)
  })

  it('reads index levels from the day file', () => {
    const idx = parseIndices(readFileSync(fx('PR231026.zip')), '2026-10-23')
    expect(idx.find((i) => i.name === 'Nifty 50')).toMatchObject({ close: 22600, prevClose: 22687.65, high52: 26373.2 })
    expect(idx.map((i) => i.name)).toContain('Nifty Bank')
  })
})
