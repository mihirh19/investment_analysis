import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { matchNpsScheme, parseNavAll, parseNseIndexCsv } from '../src/main/market/funds'
import { isMarketOpen, MarketData } from '../src/main/market/refresh'
import { fromIndustryText, fromNseIndustry, fromYahoo, looksLikeRating } from '../src/main/market/sectors'
import { yahooHistory, yahooQuote } from '../src/main/market/yahoo'
import { estimateEpfBalance } from '../src/main/portfolio/epf'
import { FxTable } from '../src/main/portfolio/fx'
import { createServices, type Services } from '../src/main/services'

// ---------------- canned responses ----------------

const chart = (symbol: string, price: number, prev: number, currency = 'INR', extra: object = {}) => ({
  chart: {
    result: [
      {
        meta: {
          symbol,
          currency,
          regularMarketPrice: price,
          chartPreviousClose: prev,
          regularMarketTime: 1791539100,
          gmtoffset: 19800,
          longName: symbol
        },
        ...extra
      }
    ],
    error: null
  }
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const text = (body: string) => new Response(body, { status: 200 })

const NSE_CSV =
  'Company Name,Industry,Symbol,Series,ISIN Code\n' +
  'Infosys Ltd.,Information Technology,INFY,EQ,INE009A01021\n' +
  'HDFC Bank Ltd.,Financial Services,HDFCBANK,EQ,INE040A01034\n' +
  '"Larsen & Toubro, Ltd.",Construction,LT,EQ,INE018A01030\n' +
  // Tata Motors' listed entity kept its ISIN but trades as TMPV after the 2025 demerger.
  'Tata Motors Passenger Vehicles Ltd.,Automobile and Auto Components,TMPV,EQ,INE155A01022\n' +
  Array.from({ length: 120 }, (_, i) => `Filler ${i},Services,F${i},EQ,INE${String(i).padStart(3, '0')}Z01011`).join(
    '\n'
  )

function fakeFetch(calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/chart/INFY.NS'))
      return json(
        chart('INFY.NS', 1500, 1480, 'INR', {
          events: {
            dividends: {
              a: { amount: 20, date: Date.parse('2026-05-30T04:00:00Z') / 1000 },
              b: { amount: 22, date: Date.parse('2026-01-24T04:00:00Z') / 1000 }
            }
          }
        })
      )
    if (url.includes('/chart/TMPV.NS')) return json(chart('TMPV.NS', 400, 395))
    if (url.includes('/chart/AAPL'))
      return json(
        chart('AAPL', 200, 198, 'USD', {
          events: { dividends: { a: { amount: 0.25, date: Date.parse('2026-08-11T13:30:00Z') / 1000 } } }
        })
      )
    if (url.includes('/chart/USDINR%3DX') || url.includes('/chart/USDINR=X')) {
      return json(
        chart('USDINR=X', 90, 89.5, 'INR', {
          timestamp: [Date.parse('2024-03-15T00:00:00Z') / 1000, Date.parse('2026-08-11T00:00:00Z') / 1000],
          indicators: { quote: [{ close: [83, 88] }] }
        })
      )
    }
    if (url.includes('/chart/'))
      return json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }, 404)
    if (url.includes('api.mfapi.in/mf/120716'))
      return json({
        meta: { scheme_category: 'Equity Scheme - Index Funds' },
        data: [
          { date: '09-10-2026', nav: '180.00' },
          { date: '08-10-2026', nav: '178.00' }
        ]
      })
    if (url.includes('npsnav.in/api/schemes'))
      return json({
        data: [
          ['SM001003', 'SBI PENSION FUND SCHEME E - TIER I'],
          ['SM001004', 'SBI PENSION FUND SCHEME C - TIER I']
        ]
      })
    if (url.includes('npsnav.in/api/historical/SM001003'))
      return json({
        data: [
          { date: '09-10-2026', nav: 60 },
          { date: '08-10-2026', nav: 59 }
        ]
      })
    if (url.includes('ind_niftytotalmarket_list.csv')) return text(NSE_CSV)
    if (url.includes('fc.yahoo.com'))
      return new Response('', { status: 404, headers: { 'set-cookie': 'A3=x; Path=/' } })
    if (url.includes('getcrumb')) return text('crumb123')
    if (url.includes('/v1/finance/search') && url.includes('q=AAPL'))
      return json({
        quotes: [{ symbol: 'AAPL', quoteType: 'EQUITY', sector: 'Technology', industry: 'Consumer Electronics' }]
      })
    if (url.includes('quoteSummary/AAPL'))
      return json({
        quoteSummary: { result: [{ assetProfile: { sector: 'Technology', industry: 'Consumer Electronics' } }] }
      })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

// ---------------- pure parsers ----------------

describe('market data parsers', () => {
  it('reads a Yahoo quote with previous close', async () => {
    const q = await yahooQuote('INFY.NS', fakeFetch())
    expect(q).toMatchObject({ price: 1500, prevClose: 1480, currency: 'INR' })
  })

  it('reads dividend events in exchange-local dates', async () => {
    const h = await yahooHistory('INFY.NS', '1y', fakeFetch())
    expect(h.dividends).toEqual([
      { exDate: '2026-01-24', amount: 22 },
      { exDate: '2026-05-30', amount: 20 }
    ])
  })

  it('surfaces Yahoo errors for unknown symbols', async () => {
    await expect(yahooQuote('NOPE.NS', fakeFetch())).rejects.toThrow()
  })

  it('parses AMFI NAVAll.txt', () => {
    const rows = parseNavAll(
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\r\n\r\nOpen Ended Schemes(Equity Scheme - Flexi Cap Fund)\r\n' +
        '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;88.9258;09-Oct-2026\r\n' +
        '999999;-;-;Broken;N.A.;09-Oct-2026\r\n'
    )
    expect(rows).toEqual([
      {
        code: '122639',
        isinGrowth: 'INF879O01027',
        isinReinvest: null,
        name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
        nav: 88.9258,
        date: '2026-10-09',
        fundHouse: null,
        category: 'Equity Scheme - Flexi Cap Fund',
        plan: null,
        option: null
      }
    ])
  })

  it('parses the current 8-column NAVAll with fund house headings (ETFs included)', () => {
    const rows = parseNavAll(
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\n \n' +
        'Open Ended Schemes(Exchange Traded Funds (ETFs) - Other ETF)\n \nNippon India Mutual Fund\n \n' +
        '140084;INF204KB14I2;-;Nippon India ETF Nifty 50 BeES;Direct Plan;;256.8604;09-Oct-2026\n \nAxis Mutual Fund\n \n' +
        '135762;INF846K01WO1;-;Axis Children\'s Fund;Direct Plan;Growth Option;29.0745;09-Oct-2026\n'
    )
    expect(rows.map((r) => [r.isinGrowth, r.nav, r.fundHouse, r.category, r.plan, r.option])).toEqual([
      ['INF204KB14I2', 256.8604, 'Nippon India Mutual Fund', 'Exchange Traded Funds (ETFs) - Other ETF', 'Direct Plan', null],
      ['INF846K01WO1', 29.0745, 'Axis Mutual Fund', 'Exchange Traded Funds (ETFs) - Other ETF', 'Direct Plan', 'Growth Option']
    ])
  })

  it('parses NSE index CSVs including quoted names', () => {
    const rows = parseNseIndexCsv(NSE_CSV)
    expect(rows.find((r) => r.symbol === 'LT')).toEqual({
      isin: 'INE018A01030',
      symbol: 'LT',
      name: 'Larsen & Toubro, Ltd.',
      industry: 'Construction'
    })
  })

  it('matches CAS NPS scheme names to npsnav codes, respecting tier', () => {
    const schemes = [
      { code: 'SM001003', name: 'SBI PENSION FUND SCHEME E - TIER I' },
      { code: 'SM001006', name: 'SBI PENSION FUND SCHEME E - TIER II' },
      { code: 'SM001004', name: 'SBI PENSION FUND SCHEME C - TIER I' },
      { code: 'SM008001', name: 'HDFC PENSION FUND SCHEME E - TIER I' }
    ]
    expect(matchNpsScheme('SBI PENSION FUND SCHEME E (Tier I)', schemes)).toBe('SM001003')
    expect(matchNpsScheme('SBI PENSION FUND SCHEME E - TIER II', schemes)).toBe('SM001006')
    expect(matchNpsScheme('SBI PENSION FUND SCHEME C (Tier I)', schemes)).toBe('SM001004')
    expect(matchNpsScheme('KOTAK PENSION FUND SCHEME G (Tier I)', schemes)).toBeNull()
  })

  it('knows NSE and US trading hours', () => {
    expect(isMarketOpen('NSE', new Date('2026-10-09T05:00:00Z'))).toBe(true) // Fri 10:30 IST
    expect(isMarketOpen('NSE', new Date('2026-10-09T11:00:00Z'))).toBe(false) // Fri 16:30 IST
    expect(isMarketOpen('NSE', new Date('2026-10-10T05:00:00Z'))).toBe(false) // Saturday
    expect(isMarketOpen('US', new Date('2026-10-09T15:00:00Z'))).toBe(true) // Fri 11:00 EDT
    expect(isMarketOpen('US', new Date('2026-10-09T21:00:00Z'))).toBe(false) // Fri 17:00 EDT
  })
})

describe('sector vocabulary', () => {
  it('maps every source onto NSE industries', () => {
    expect(fromNseIndustry('Financial Services')).toBe('Financial Services')
    expect(fromYahoo('Technology', 'Consumer Electronics')).toBe('Information Technology')
    expect(fromYahoo('consumer_defensive')).toBe('Fast Moving Consumer Goods')
    expect(fromYahoo('Consumer Cyclical', 'Auto Manufacturers')).toBe('Automobile and Auto Components')
    expect(fromIndustryText('Banks')).toBe('Financial Services')
    expect(fromIndustryText('IT - Software')).toBe('Information Technology')
    expect(fromIndustryText('Pharmaceuticals & Biotechnology')).toBe('Healthcare')
    expect(fromIndustryText('Cement & Cement Products')).toBe('Construction Materials')
    expect(fromIndustryText('Petroleum Products')).toBe('Oil Gas & Consumable Fuels')
    expect(fromIndustryText('Something new')).toBe('Other')
  })

  it('recognises credit ratings', () => {
    expect(looksLikeRating('CRISIL AAA')).toBe(true)
    expect(looksLikeRating('SOVEREIGN')).toBe(true)
    expect(looksLikeRating('ICRA A1+')).toBe(true)
    expect(looksLikeRating('Banks')).toBe(false)
    expect(looksLikeRating('Auto Components')).toBe(false)
  })
})

describe('FX and EPF maths', () => {
  it('looks up the rate on or before a date', () => {
    const fx = FxTable.of(
      [
        { date: '2024-03-14', rate: 82.9 },
        { date: '2024-03-15', rate: 83.0 },
        { date: '2024-03-18', rate: 83.1 }
      ],
      90
    )
    expect(fx.on('2024-03-16')).toBe(83.0) // weekend → Friday
    expect(fx.on('2024-03-18')).toBe(83.1)
    expect(fx.on('2020-01-01')).toBe(82.9)
    expect(fx.latest()).toBe(90)
  })

  it('projects EPF with monthly contributions and yearly interest credit', () => {
    const meta = { monthlyContribution: 10000, interestRate: 12 } // 1% a month for easy numbers
    expect(estimateEpfBalance(100000, '2026-01-15', '2026-01-20', meta)).toBe(100000)
    // Feb: 110000 → +1100; Mar: 120000 → +1200, credited at March end → 122300
    expect(estimateEpfBalance(100000, '2026-01-15', '2026-03-15', meta)).toBeCloseTo(122300)
    // Apr: 132300 → +1323 accrued, not yet credited
    expect(estimateEpfBalance(100000, '2026-01-15', '2026-04-15', meta)).toBeCloseTo(132300 + 1323)
  })
})

// ---------------- refresh pipeline against a real database ----------------

const cas: DepositoryCas = {
  statement_period: { from: '01-Sep-2026', to: '30-Sep-2026' },
  file_type: 'CDSL',
  accounts: [
    {
      name: 'ZERODHA BROKING LIMITED',
      type: 'CDSL Demat Account',
      dp_id: '12081600',
      client_id: '1',
      equities: [
        {
          name: 'INFOSYS LIMITED',
          isin: 'INE009A01021',
          num_shares: '10',
          price: '1400',
          value: '14000',
          symbol: 'INFY',
          exchange: 'NSE'
        }
      ],
      mutual_funds: [
        {
          name: 'UTI NIFTY 50 INDEX FUND',
          isin: 'INF789F1AUV1',
          amfi: '120716',
          type: 'EQUITY',
          balance: '100',
          nav: '170',
          value: '17000',
          total_cost: '15000',
          folio: null
        }
      ]
    }
  ],
  nps: {
    pran: '1234',
    schemes: [{ scheme: 'SBI PENSION FUND SCHEME E', tier: 'I', units: '1000', nav: '55', value: '55000' }]
  }
}

let dir: string
let db: Db
let close: () => void
let svc: Services
let calls: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-mkt-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  calls = []
  const market = new MarketData(db, () => {}, fakeFetch(calls))
  svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, market, fetch: fakeFetch(calls) })
  persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'cas.pdf', bundle: mapCasJson(cas) })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('MarketData.refresh', () => {
  it('follows a renamed ticker through NSE’s current symbol for the ISIN', async () => {
    persistBundle(db, {
      personId: 1,
      kind: 'CAS_PDF',
      fileName: 'old.pdf',
      bundle: mapCasJson({
        ...cas,
        accounts: [
          {
            ...cas.accounts[0],
            equities: [
              {
                name: 'TATA MOTORS LIMITED',
                isin: 'INE155A01022',
                num_shares: '50',
                price: '712.30',
                value: '35615',
                symbol: 'TATAMOTORS',
                exchange: 'NSE'
              }
            ],
            mutual_funds: []
          }
        ],
        nps: null
      })
    })
    await svc.refreshMarket() // a full refresh loads NSE's list before pricing
    const tm = svc.listHoldings(1).find((h) => h.isin === 'INE155A01022')!
    expect(tm).toMatchObject({ lastPrice: 400, priceSource: 'LIVE', marketValue: 20000 })
    const i = db
      .select()
      .from(schema.instruments)
      .all()
      .find((x) => x.isin === 'INE155A01022')!
    expect(i.yahooSymbol).toBe('TMPV.NS')
    expect(svc.getMarketStatus().sources.find((s) => s.key === 'stocks')).toMatchObject({ lastError: null, failed: [] })
  })

  it('prices stocks live, funds and NPS at the latest NAV, with day change', async () => {
    await svc.refreshMarket()
    const h = svc.listHoldings(1)
    const by = (cls: string) => h.find((r) => r.assetClass === cls)!

    expect(by('EQUITY_IN')).toMatchObject({
      lastPrice: 1500,
      prevClose: 1480,
      priceSource: 'LIVE',
      marketValue: 15000,
      dayChange: 200
    })
    expect(by('MF')).toMatchObject({
      lastPrice: 180,
      priceSource: 'NAV',
      marketValue: 18000,
      dayChange: 200,
      priceDate: '2026-10-09'
    })
    expect(by('NPS')).toMatchObject({ lastPrice: 60, priceSource: 'NAV', marketValue: 60000 })

    const instruments = db.select().from(schema.instruments).all()
    expect(instruments.find((i) => i.assetClass === 'NPS')?.npsCode).toBe('SM001003')
    expect(instruments.find((i) => i.assetClass === 'EQUITY_IN')).toMatchObject({
      yahooSymbol: 'INFY.NS',
      sector: 'Information Technology'
    })
    expect(instruments.find((i) => i.assetClass === 'MF')?.mfCategory).toBe('Equity Scheme - Index Funds')
  })

  it('reports per-source status and does not throw when a source is down', async () => {
    const market = new MarketData(db, () => {}, (async () => new Response('down', { status: 503 })) as typeof fetch)
    await market.refresh({ full: true })
    const s = market.getStatus()
    expect(s.sources.find((x) => x.key === 'stocks')?.lastError).toMatch(/no prices|503/i)
    expect(svc.listHoldings(1).find((r) => r.assetClass === 'EQUITY_IN')).toMatchObject({
      priceSource: 'STATEMENT',
      lastPrice: 1400
    })
  })

  it('values US stocks in INR, with cost at the purchase-date rate', async () => {
    svc.addManualTransaction({
      personId: 1,
      platform: 'INDMONEY',
      date: '2024-03-15',
      type: 'BUY',
      assetClass: 'EQUITY_US',
      name: 'Apple',
      symbol: 'AAPL',
      quantity: 10,
      price: 150,
      currency: 'USD'
    })
    await svc.refreshMarket()
    const aapl = svc.listHoldings(1).find((r) => r.symbol === 'AAPL')!
    expect(aapl).toMatchObject({ lastPrice: 200, fxRate: 90, marketValue: 2000, marketValueInr: 180000 })
    expect(aapl.investedInr).toBeCloseTo(1500 * 83) // rate on 2024-03-15
    expect(aapl.unrealizedPnlInr).toBeCloseTo(180000 - 124500)
    expect(aapl.sector).toBe('Information Technology')
  })

  it('estimates dividends from units held before each ex-date, net of US withholding', async () => {
    svc.addManualTransaction({
      personId: 1,
      platform: 'INDMONEY',
      date: '2024-03-15',
      type: 'BUY',
      assetClass: 'EQUITY_US',
      name: 'Apple',
      symbol: 'AAPL',
      quantity: 10,
      price: 150,
      currency: 'USD'
    })
    await svc.refreshMarket()
    const { payments, outlook } = svc.listDividends(1)
    // INFY: CAS from 30 Sep 2026 → only dividends after the statement date are known; both ex-dates are before it.
    expect(payments.filter((p) => p.symbol === 'INFY')).toHaveLength(0)
    const aapl = payments.find((p) => p.symbol === 'AAPL')!
    expect(aapl).toMatchObject({
      exDate: '2026-08-11',
      perShare: 0.25,
      quantity: 10,
      gross: 2.5,
      withholding: 0.625,
      net: 1.875,
      basis: 'ESTIMATED'
    })
    expect(aapl.netInr).toBeCloseTo(1.875 * 88)
    expect(outlook.find((o) => o.symbol === 'INFY')).toMatchObject({
      trailingPerShare: 42,
      quantity: 10,
      nextYearInr: 420
    })
  })

  it('builds exposure across stocks, funds without holdings and NPS', async () => {
    await svc.refreshMarket()
    const e = svc.getExposure(1)
    expect(e.totalInr).toBeCloseTo(15000 + 18000 + 60000)
    expect(e.sectors.find((s) => s.sector === 'Information Technology')?.directInr).toBeCloseTo(15000)
    expect(e.sectors.find((s) => s.sector === 'Not broken down')?.viaFundsInr).toBeCloseTo(18000 + 60000)
    expect(e.funds[0]).toMatchObject({ holdingsAsOf: null })
  })
})
