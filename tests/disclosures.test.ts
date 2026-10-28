import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { zipSync } from 'fflate'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { BUNDLED_AMC_REGISTRY } from '../src/main/market/amcRegistry'
import {
  extractLinks,
  findAmc,
  getDisclosureStatus,
  latestPossiblePeriod,
  linksFromJson,
  type RenderPlan,
  parseAmfiRegistry,
  periodOf,
  pickFiles,
  syncDisclosures,
  workbooksIn
} from '../src/main/market/disclosures'
import { parseNseListing } from '../src/main/market/funds'
import { MarketData } from '../src/main/market/refresh'
import { createServices } from '../src/main/services'

describe('reading months from links', () => {
  it.each([
    ['All Schemes Monthly Portfolio - as on 30th September 2026', '2026-09'],
    ['PPFAS_Monthly_Portfolio_Report_September_30_2026.xls', '2026-09'],
    ['NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls', '2026-09'],
    ['Monthly%20Portfolio-%20Sep%2030%202026.xlsx', '2026-09'],
    ['mafcf_sept2026.xlsx', '2026-09'],
    ['IN_MF_Portfolio_Monthly_OvernightFund_30092026_1791188043.xlsx', '2026-09'],
    ['BOBBNPMF_Monthly_Portfolio_30-09-2026_20376.xls', '2026-09'],
    ['/month-end-portfolio/2026/oct/scheme portfolio details september 2026.xlsx', '2026-09'],
    ['Monthly HDFC Retirement Fund - Equity Plan - 30 September 2026.xlsx', '2026-09'],
    ['portfolio_2026-08-31.xlsx', '2026-08']
  ])('%s → %s', (text, expected) => {
    expect(periodOf(text)).toBe(expected)
  })

  it('returns null when there is no date', () => {
    expect(periodOf('CAMS-Branches.xlsx')).toBeNull()
  })
})

describe('finding links and choosing files', () => {
  const sbiLike = [
    {
      url: 'https://x/docs/all-schemes-monthly-portfolio---as-on-30th-september-2026.xlsx',
      text: 'All Schemes Monthly Portfolio - as on 30th September 2026'
    },
    {
      url: 'https://x/docs/all-schemes-monthly-portfolio---as-on-31st-august-2026.xlsx',
      text: 'All Schemes Monthly Portfolio - as on 31st August 2026'
    },
    { url: 'https://x/docs/fortnightly-debt-portfolio-30-sep-2026.xlsx', text: 'Fortnightly portfolio 30 Sep 2026' },
    { url: 'https://x/docs/half-yearly-portfolio-march-2026.xlsx', text: 'Half yearly portfolio March 2026' },
    { url: 'https://x/docs/Product_Dashboard_Sept_2026.xlsx', text: 'Product dashboard' }
  ]

  it('takes the newest monthly file and skips fortnightly, half-yearly and dashboards', () => {
    const p = pickFiles(sbiLike, ['SBI Small Cap Fund'])!
    expect(p.period).toBe('2026-09')
    expect(p.files.map((f) => f.url)).toEqual([sbiLike[0].url])
  })

  it('picks only your schemes when a house publishes one file per scheme', () => {
    const schemes = [
      'Flexi Cap',
      'Large Cap',
      'Midcap',
      'Small Cap',
      'ELSS Tax Saver',
      'Nifty 50 ETF',
      'Liquid',
      'Overnight'
    ]
    const links = schemes.map((s, i) => ({
      url: `https://m/docs/portfolios/s${i}_sept2026.xlsx`,
      text: `Portfolio Details as on 30th September 2026 for Mirae Asset ${s} Fund`
    }))
    const p = pickFiles(links, [
      'Mirae Asset Flexi Cap Fund - Direct Plan - Growth',
      'Mirae Asset ELSS Tax Saver Fund - Direct'
    ])!
    expect(p.files.map((f) => f.url)).toEqual([links[0].url, links[4].url])
  })

  it('extracts spreadsheet links from HTML with their text, including script-built ones', () => {
    const html = `
      <table><tr><td>Monthly Portfolio as on 30 Sep 2026</td>
      <td><a href="/downloads/NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls">Download</a></td></tr></table>
      <a href="report.pdf">PDF</a>
      <script>window.__DATA__={"file":"https://cdn.example.com/a/Monthly%20Portfolio-%20Sep%2030%202026.xlsx"}</script>`
    const links = extractLinks(html, 'https://mf.example.com/investor/downloads/')
    expect(links.map((l) => l.url)).toEqual([
      'https://mf.example.com/downloads/NIMF-MONTHLY-PORTFOLIO-30-Sep-26.xls',
      'https://cdn.example.com/a/Monthly%20Portfolio-%20Sep%2030%202026.xlsx'
    ])
    expect(links[0].text).toBe('Download')
    expect(links[0].context).toMatch(/Monthly Portfolio as on 30 Sep 2026/)
  })

  it('takes the consolidated file when per-scheme files do not name your fund (PPFAS)', () => {
    const base = 'https://amc.ppfas.com/downloads/portfolio-disclosure/2026/'
    const codes = ['PPLF', 'PPTSF', 'PPCHF', 'PPAF', 'PPDAAF']
    const links = [
      ...codes.map((c) => ({
        url: `${base}${c}_PPFAS_Monthly_Portfolio_Report_September_30_2026.xls`,
        text: 'Download',
        // Static pages: the text before a link is the previous row, naming another scheme.
        context: 'Parag Parikh Flexi Cap Fund September 2026'
      })),
      { url: `${base}PPFAS_Monthly_Portfolio_Report_September_30_2026.xls`, text: 'Download', context: '' },
      { url: `${base}PPFAS_Monthly_Portfolio_Report_August_31_2026.xls`, text: 'Download', context: '' }
    ]
    const p = pickFiles(links, ['Parag Parikh Flexi Cap Fund - Direct Plan - Growth'])!
    expect(p.period).toBe('2026-09')
    expect(p.files.map((f) => f.url)).toEqual([`${base}PPFAS_Monthly_Portfolio_Report_September_30_2026.xls`])
  })

  it('takes every file of a small month when none names your fund', () => {
    const links = ['a', 'b', 'c', 'd'].map((x) => ({ url: `https://h/${x}-portfolio-sep-2026.xlsx`, text: '' }))
    expect(pickFiles(links, ['Some Fund Growth'])!.files).toHaveLength(4)
  })

  it('reads file listings from JSON (ICICI Prudential and UTI)', () => {
    const icici = {
      success: {
        data: {
          files: [
            {
              title: {
                code: 'Monthly Portfolio Disclosure September 2026',
                text: 'Monthly Portfolio Disclosure September 2026'
              },
              fileType: 'Document',
              url: '/downloads/Files/Monthly Portfolio Disclosures/2026/Sep/Monthly-Portfolio-Disclosure-September-2026.zip',
              FINANCIAL_YEAR: ['2025-2026']
            },
            {
              title: {
                code: 'Monthly Portfolio Disclosure August 2026',
                text: 'Monthly Portfolio Disclosure August 2026'
              },
              url: '/downloads/Files/Monthly Portfolio Disclosures/2026/Aug/Monthly-Portfolio-Disclosure-August-2026.zip'
            }
          ]
        }
      }
    }
    const links = linksFromJson(icici, 'https://www.icicipruamc.com/media-center/downloads?x=1')
    expect(links[0]).toEqual({
      url: 'https://www.icicipruamc.com/blob/downloads/Files/Monthly%20Portfolio%20Disclosures/2026/Sep/Monthly-Portfolio-Disclosure-September-2026.zip',
      text: 'Monthly Portfolio Disclosure September 2026 Document'
    })
    expect(pickFiles(links, ['ICICI Prudential Bluechip Fund'])!.files.map((f) => f.url)).toEqual([links[0].url])

    const uti = {
      rows: [
        {
          doc: 'https://d3.cloudfront.net/static/generic-zip/Oct-26/UTI_SCHEME_PORTFOLIOS_-_30.09.2026_.zip',
          name: 'Consolidated Portfolio September 2026',
          url: 'https://d3.cloudfront.net/static/generic-zip/Oct-26/UTI_SCHEME_PORTFOLIOS_-_30.09.2026_.zip',
          month: 'September',
          year: '2026'
        }
      ]
    }
    const u = linksFromJson(uti, 'https://www.utimf.com/api/x')
    expect(u).toHaveLength(1)
    expect(pickFiles(u, ['UTI Nifty 50 Index Fund'])!.period).toBe('2026-09')
  })

  it('opens only the workbooks named after your funds in a zip of one file per scheme', () => {
    const names = ['Balanced Advantage', 'Bluechip', 'Nifty 50 ETF', 'Nifty 50 ETF FOF', 'Liquid']
    const zip = zipSync(
      Object.fromEntries(names.map((n, i) => [`ICICI Prudential ${n} Fund.xlsx`, new Uint8Array([i])]))
    )
    const pick = (funds: string[]) => workbooksIn('https://x/all.zip', Buffer.from(zip), funds).map((b) => b[0])
    expect(pick(['ICICI Prudential Bluechip Fund - Direct Plan - Growth'])).toEqual([1])
    // A renamed scheme is found by its current name; shared words alone ("and", "Debt") are not enough.
    const renamed = zipSync({
      'ICICI Prudential Aggressive Hybrid Fund.xlsx': new Uint8Array([1]),
      'ICICI Prudential Banking and PSU Debt Fund.xlsx': new Uint8Array([2]),
      'ICICI Prudential Strategic Metal and Energy Equity Fund of Fund.xlsx': new Uint8Array([3]),
      'ICICI Prudential Liquid Fund.xlsx': new Uint8Array([4])
    })
    const open = (funds: (string | string[])[]) =>
      workbooksIn('https://x/all.zip', Buffer.from(renamed), funds).map((b) => b[0])
    expect(
      open([['ICICI PRUDENTIAL EQUITY & DEBT FUND - DIRECT - GROWTH', 'ICICI Prudential Aggressive Hybrid Fund']])
    ).toEqual([1])
    expect(open(['ICICI PRUDENTIAL EQUITY & DEBT FUND - DIRECT - GROWTH'])).toHaveLength(4)
    // A fund with no file named after it: open them all and let the sheets decide.
    expect(pick(['ICICI Prudential Bluechip Fund', 'ICICI Prudential Large Cap Fund'])).toHaveLength(5)
  })

  it('unpacks spreadsheets from a zip archive', () => {
    const zip = zipSync({
      'a.xlsx': new Uint8Array([1, 2, 3]),
      'notes.txt': new Uint8Array([4]),
      'b.xls': new Uint8Array([5])
    })
    expect(workbooksIn('https://x/all.zip', Buffer.from(zip)).map((b) => [...b])).toEqual([[1, 2, 3], [5]])
    expect(workbooksIn('https://x/file.xlsx', Buffer.from([9]))).toHaveLength(1)
  })
})

describe('AMFI directory', () => {
  it('reads fund houses and their monthly pages from the page data', () => {
    const html =
      '<script>self.__next_f.push([1,"[{\\"mf_id\\":\\"64\\",\\"mf_name\\":\\"PPFAS Mutual Fund\\",\\"amc_name\\":\\"PPFAS AMC\\",' +
      '\\"amc_monthly_portfolio_disclosure\\":\\"https://amc.ppfas.com/downloads/portfolio-disclosure/\\",\\"x\\":1},' +
      '{\\"mf_id\\":\\"20\\",\\"mf_name\\":\\"ICICI Prudential Mutual Fund\\",\\"amc_monthly_portfolio_disclosure\\":\\"https://www.icicipruamc.com/d?a=1\\u0026b=2\\"}]"])</script>'
    expect(parseAmfiRegistry(html)).toEqual([
      { id: '64', name: 'PPFAS Mutual Fund', monthlyUrl: 'https://amc.ppfas.com/downloads/portfolio-disclosure/' },
      { id: '20', name: 'ICICI Prudential Mutual Fund', monthlyUrl: 'https://www.icicipruamc.com/d?a=1&b=2' }
    ])
  })

  it('maps fund house names from the NAV file to directory entries', () => {
    expect(findAmc('Nippon India Mutual Fund', BUNDLED_AMC_REGISTRY)?.id).toBe('21')
    expect(findAmc('ICICI Prudential Mutual Fund', BUNDLED_AMC_REGISTRY)?.id).toBe('20')
    expect(findAmc('Aditya Birla Sun Life Mutual Fund', BUNDLED_AMC_REGISTRY)?.id).toBe('3')
    expect(findAmc('Some Unknown House', BUNDLED_AMC_REGISTRY)).toBeNull()
    expect(BUNDLED_AMC_REGISTRY.length).toBeGreaterThan(50)
  })

  it('knows a disclosure can only exist for a month that has ended', () => {
    expect(latestPossiblePeriod(new Date('2026-10-11T00:00:00Z'))).toBe('2026-09')
    expect(latestPossiblePeriod(new Date('2026-01-03T00:00:00Z'))).toBe('2025-12')
  })
})

// ---------------- end to end against a database ----------------

function disclosureWorkbook(asOn = 'September 30,2026', hdfc = 60): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['PPFAS Mutual Fund'],
      ['Parag Parikh Flexi Cap Fund (An open-ended dynamic equity scheme)'],
      [`Monthly Portfolio Statement as on ${asOn}`],
      ['Name of the Instrument', 'ISIN', 'Industry / Rating', 'Quantity', 'Market Value', '% to Net Assets'],
      ['HDFC Bank Limited', 'INE040A01034', 'Banks', 1, 1, hdfc],
      ['TREPS', '', '', '', 1, 100 - hdfc]
    ]),
    'PPFCF'
  )
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

const cas: DepositoryCas = {
  statement_period: { from: '01-Sep-2026', to: '30-Sep-2026' },
  file_type: 'CDSL',
  accounts: [
    {
      name: 'ZERODHA BROKING LIMITED',
      type: 'CDSL Demat Account',
      dp_id: '1',
      client_id: '2',
      equities: [
        {
          name: 'NIPPON INDIA ETF NIFTY 50 BEES',
          isin: 'INF204KB14I2',
          num_shares: '100',
          price: '250',
          value: '25000',
          symbol: null,
          exchange: null
        }
      ],
      mutual_funds: [
        {
          name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          balance: '100',
          nav: '90',
          value: '9000',
          total_cost: '8000',
          folio: null
        }
      ]
    }
  ],
  nps: null
}

describe('automatic monthly disclosures and ETF prices', () => {
  let dir: string
  let db: Db
  let close: () => void
  let calls: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-disc-'))
    const o = openDatabase(join(dir, 't.db'), '9'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    calls = []
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'c.pdf', bundle: mapCasJson(cas) })
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
  const navAll =
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\n' +
    'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)\nPPFAS Mutual Fund\n' +
    '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;92.5;09-Oct-2026\n' +
    'Open Ended Schemes(Exchange Traded Funds (ETFs) - Other ETF)\nNippon India Mutual Fund\n' +
    '140084;INF204KB14I2;-;Nippon India ETF Nifty 50 BeES;Direct Plan;;256.86;09-Oct-2026\n'

  function fakeFetch(opts: { yahooEtf: boolean }): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('NAVAll.txt')) return new Response(navAll)
      if (url.includes('eq_etfseclist.csv'))
        return new Response(
          'Symbol,Underlying Asset,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue\nNIFTYBEES,Nifty 50,NIPINDETFNIFTYBEES,08-Jan-02,1,INF204KB14I2,1\n'
        )
      if (url.includes('EQUITY_L.csv'))
        return new Response(
          'SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\n' +
            Array.from(
              { length: 600 },
              (_, i) => `S${i},Co ${i},EQ,01-JAN-2000,1,1,INE${String(i).padStart(3, '0')}Z01011,1`
            ).join('\n')
        )
      if (url.includes('/chart/NIFTYBEES.NS') && opts.yahooEtf)
        return json({
          chart: {
            result: [
              {
                meta: {
                  currency: 'INR',
                  regularMarketPrice: 257.35,
                  chartPreviousClose: 254,
                  regularMarketTime: 1791539100
                }
              }
            ],
            error: null
          }
        })
      if (url.includes('api.mfapi.in'))
        return json({
          meta: { scheme_category: 'Equity Scheme - Flexi Cap Fund' },
          data: [{ date: '09-10-2026', nav: '92.5' }]
        })
      if (url.includes('amfiindia.com/online-center/portfolio-disclosure'))
        return new Response('nothing useful', { status: 200 })
      if (url === 'https://amc.ppfas.com/downloads/portfolio-disclosure/')
        return new Response(
          '<a href="/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_September_30_2026.xls">Monthly portfolio September 2026</a>' +
            '<a href="/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_August_31_2026.xls">Monthly portfolio August 2026</a>' +
            '<a href="/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_July_31_2026.xls">Monthly portfolio July 2026</a>' +
            '<a href="/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_June_30_2026.xls">Monthly portfolio June 2026</a>' +
            '<a href="/downloads/portfolio-disclosure/2026/PPFAS_Monthly_Portfolio_Report_May_31_2026.xls">Monthly portfolio May 2026</a>'
        )
      if (url.includes('PPFAS_Monthly_Portfolio_Report_September_30_2026.xls'))
        return new Response(new Uint8Array(disclosureWorkbook()))
      if (url.includes('PPFAS_Monthly_Portfolio_Report_July_31_2026.xls'))
        return new Response(new Uint8Array(disclosureWorkbook('July 31,2026', 70)))
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  }

  it('prices an ETF that arrived without a ticker, via NSE’s ETF list', async () => {
    const market = new MarketData(db, () => {}, fakeFetch({ yahooEtf: true }))
    await market.refresh({ full: true })
    const svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, market })
    const etf = svc.listHoldings(1).find((h) => h.isin === 'INF204KB14I2')!
    expect(etf).toMatchObject({ assetClass: 'ETF', lastPrice: 257.35, priceSource: 'LIVE' })
    expect(
      db
        .select()
        .from(schema.instruments)
        .all()
        .find((i) => i.isin === 'INF204KB14I2')
    ).toMatchObject({
      yahooSymbol: 'NIFTYBEES.NS',
      fundHouse: 'Nippon India Mutual Fund'
    })
  })

  it('falls back to the ETF’s NAV when no market price is available', async () => {
    const market = new MarketData(db, () => {}, fakeFetch({ yahooEtf: false }))
    await market.refresh({ full: true })
    const svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, market })
    expect(svc.listHoldings(1).find((h) => h.isin === 'INF204KB14I2')).toMatchObject({
      lastPrice: 256.86,
      priceSource: 'NAV'
    })
  })

  it('downloads the newest monthly portfolio for each held fund house and stores it', async () => {
    const f = fakeFetch({ yahooEtf: true })
    const market = new MarketData(db, () => {}, f)
    await market.refresh({ funds: true }) // records fund houses from the NAV file
    const notFound = await syncDisclosures(db, { fetch: f, now: new Date('2026-10-11T00:00:00Z') })

    const status = getDisclosureStatus(db)
    const ppfas = status.find((s) => s.amc === 'PPFAS Mutual Fund')!
    expect(ppfas).toMatchObject({
      state: 'UPDATED',
      period: '2026-09',
      funds: ['Parag Parikh Flexi Cap Fund - Direct Plan - Growth']
    })
    expect(ppfas.files[0]).toMatch(/September_30_2026\.xls$/)
    // Earlier months for the fund page's history: three per run, newest first. August's file is
    // missing (nothing stored), July's is read, June's too (missing), May waits for the next run.
    expect(['August_31', 'July_31', 'June_30', 'May_31'].map((m) => calls.filter((u) => u.includes(m)).length)).toEqual([1, 1, 1, 0])

    const rows = db.select().from(schema.fundHoldings).all()
    expect(rows.map((r) => [r.name, r.source, r.asOf, r.weight])).toEqual([
      ['HDFC Bank Limited', 'AMC_AUTO', '2026-09-30', 0.6],
      ['TREPS', 'AMC_AUTO', '2026-09-30', 0.4],
      ['HDFC Bank Limited', 'AMC_AUTO', '2026-07-31', 0.7],
      ['TREPS', 'AMC_AUTO', '2026-07-31', 0.3]
    ])
    // Nippon's page isn't served by the fake, so it is reported, not fatal.
    expect(notFound).toContain('Nippon India Mutual Fund')

    // The next run fetches only the month still to look for, not September again.
    calls = []
    await syncDisclosures(db, { fetch: f, now: new Date('2026-10-12T00:00:00Z') })
    expect(calls.filter((u) => u.includes('ppfas')).map((u) => u.split('/').pop())).toEqual(['', 'PPFAS_Monthly_Portfolio_Report_May_31_2026.xls'])

    // After that, nothing more this month: files missing from the page aren't asked for again.
    calls = []
    await syncDisclosures(db, { fetch: f, now: new Date('2026-10-13T00:00:00Z') })
    expect(calls.filter((u) => u.includes('ppfas'))).toEqual([])
    expect(getDisclosureStatus(db).find((s) => s.amc === 'PPFAS Mutual Fund')?.state).toBe('UP_TO_DATE')
  })

  it('finds UTI’s consolidated zip through its month API and stores the matching scheme', async () => {
    const utiCas: DepositoryCas = {
      ...cas,
      accounts: [
        {
          ...cas.accounts[0],
          equities: [],
          mutual_funds: [
            {
              name: 'UTI Nifty 50 Index Fund - Direct Plan - Growth',
              isin: 'INF789F1AUX7',
              amfi: '120716',
              type: 'EQUITY',
              balance: '10',
              nav: '170',
              value: '1700',
              total_cost: '1500',
              folio: null
            }
          ]
        }
      ]
    }
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'u.pdf', bundle: mapCasJson(utiCas) })
    const wb = XLSX.utils.book_new()
    for (const [sheet, title] of [
      ['NIFTY', 'UTI Nifty 50 Index Fund'],
      ['MMF', 'UTI Money Market Fund']
    ])
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['UTI Mutual Fund'],
          [title],
          ['Portfolio as on 30-Sep-2026'],
          ['Name of the Instrument', 'ISIN', 'Industry', 'Quantity', 'Market Value', '% to Net Assets'],
          ['Reliance Industries Limited', 'INE002A01018', 'Petroleum Products', 1, 1, 100]
        ]),
        sheet
      )
    const zip = zipSync({
      'UTI_SCHEME_PORTFOLIOS_30.09.2026.xlsx': new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    })
    const zipUrl = 'https://d3.cloudfront.net/static/generic-zip/Oct-26/UTI_SCHEME_PORTFOLIOS_-_30.09.2026_.zip'
    const base = fakeFetch({ yahooEtf: true })
    const f = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('NAVAll.txt'))
        return new Response(
          navAll +
            'Open Ended Schemes(Other Scheme - Index Funds)\nUTI Mutual Fund\n120716;INF789F1AUX7;-;UTI Nifty 50 Index Fund;Direct Plan;Growth;170;09-Oct-2026\n'
        )
      if (url.includes('utimf.com/api/get-consolidate-portfolio-disclosure')) {
        calls.push(url)
        return url.includes('month=September')
          ? json({
              rows: [{ name: 'Consolidated Portfolio September 2026', url: zipUrl, month: 'September', year: '2026' }]
            })
          : json({ rows: [] })
      }
      if (url === zipUrl) return new Response(zip)
      return base(input)
    }) as typeof fetch
    await new MarketData(db, () => {}, f).refresh({ funds: true })
    await syncDisclosures(db, { fetch: f, now: new Date('2026-10-11T00:00:00Z') })

    const uti = getDisclosureStatus(db).find((s) => s.amc === 'UTI Mutual Fund')!
    expect(uti).toMatchObject({
      state: 'UPDATED',
      period: '2026-09',
      files: [zipUrl],
      funds: ['UTI Nifty 50 Index Fund - Direct Plan - Growth']
    })
    expect(calls.some((u) => u.includes('utimf.com/downloads'))).toBe(false) // the page itself was not needed
    const fundId = db
      .select()
      .from(schema.instruments)
      .all()
      .find((i) => i.isin === 'INF789F1AUX7')!.id
    expect(
      db
        .select()
        .from(schema.fundHoldings)
        .all()
        .filter((r) => r.fundInstrumentId === fundId)
        .map((r) => [r.name, r.asOf, r.weight])
    ).toEqual([['Reliance Industries Limited', '2026-09-30', 1]])
  })

  it('opens Axis’s Portfolios section and asks for recent months; leaves Kotak to you', async () => {
    const twoHouses: DepositoryCas = {
      ...cas,
      accounts: [
        {
          ...cas.accounts[0],
          equities: [],
          mutual_funds: [
            {
              name: 'Axis Small Cap Fund - Direct Growth',
              isin: 'INF846K01K35',
              amfi: '125354',
              type: 'EQUITY',
              balance: '10',
              nav: '100',
              value: '1000',
              total_cost: '900',
              folio: null
            },
            {
              name: 'Kotak Flexicap Fund - Direct Growth',
              isin: 'INF174K01LS2',
              amfi: '120166',
              type: 'EQUITY',
              balance: '10',
              nav: '80',
              value: '800',
              total_cost: '700',
              folio: null
            }
          ]
        }
      ]
    }
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'ak.pdf', bundle: mapCasJson(twoHouses) })
    const navAk =
      navAll +
      'Open Ended Schemes(Equity Scheme - Small Cap Fund)\nAxis Mutual Fund\n125354;INF846K01K35;-;Axis Small Cap Fund;Direct Plan;Growth;100;09-Oct-2026\n' +
      'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)\nKotak Mahindra Mutual Fund\n120166;INF174K01LS2;-;Kotak Flexicap Fund;Direct Plan;Growth;80;09-Oct-2026\n'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['AXISSCF'],
        ['Axis Small Cap Fund'],
        ['Monthly Portfolio Statement as on September 30, 2026'],
        ['Name of the Instrument', 'ISIN', 'Industry', 'Quantity', 'Market Value', '% to Net Assets'],
        ['Blue Star Limited', 'INE472A01039', 'Consumer Durables', 1, 1, 100]
      ]),
      'AXISSCF'
    )
    const fileUrl = 'https://www.axismf.com/1/5/464/Monthly_Portfolio_30_09_2026_abc.xlsx'
    const base = fakeFetch({ yahooEtf: true })
    const f = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('NAVAll.txt')) return new Response(navAk)
      if (url === fileUrl) return new Response(new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })))
      calls.push(url)
      if (url.includes('axismf.com') || url.includes('kotakmf.com')) return new Response('<html>app shell</html>')
      return base(input)
    }) as typeof fetch
    const rendered: { url: string; plan?: RenderPlan }[] = []
    const renderLinks = async (url: string, plan?: RenderPlan) => {
      rendered.push({ url, plan })
      // What the repeated requests return: the month's monthly file beside weekly and ad hoc ones.
      return linksFromJson(
        {
          data: {
            documentList: [
              { docuementURL: fileUrl, documentName: 'Monthly Portfolio 30-09-2026', documentPostedDate: '2026-09-30' },
              {
                docuementURL: 'https://www.axismf.com/1/w.xlsx',
                documentName: 'Weekly Portfolios - Income+Arb - 25Sep26'
              },
              { docuementURL: 'https://www.axismf.com/1/a.xlsx', documentName: 'Adhoc Portfolio - 15Sep26' }
            ]
          }
        },
        url
      )
    }
    await new MarketData(db, () => {}, f).refresh({ funds: true })
    await syncDisclosures(db, { fetch: f, renderLinks, now: new Date('2026-10-11T00:00:00Z') })

    const status = getDisclosureStatus(db)
    expect(status.find((s) => s.amc === 'Axis Mutual Fund')).toMatchObject({
      state: 'UPDATED',
      period: '2026-09',
      files: [fileUrl]
    })
    const kotak = status.find((s) => s.amc === 'Kotak Mahindra Mutual Fund')!
    expect(kotak.state).toBe('NOT_FOUND')
    expect(kotak.message).toMatch(/blocks automated downloads/)
    const axis = rendered.filter((r) => r.url.includes('axismf.com'))
    expect(axis.map((r) => r.url)).toEqual(['https://www.axismf.com/statutory-disclosures'])
    expect(rendered.some((r) => r.url.includes('kotakmf.com'))).toBe(false)
    expect(calls.some((u) => u.includes('kotakmf.com'))).toBe(false)

    const plan = axis[0].plan!
    expect('8. Portfolios').toMatch(new RegExp(plan.click!, 'i'))
    const sent = {
      sdType: 'yearMonthSchemeDocs',
      sdID: 'sdMonthSchemePortfolio',
      year: '2026',
      month: 'October',
      schemeCode: 'Consolidated'
    }
    expect(plan.repeat!.bodies(sent).map((b) => [b.year, b.month, b.schemeCode, b.sdID])).toEqual([
      ['2026', 'September', 'Consolidated', 'sdMonthSchemePortfolio'],
      ['2026', 'August', 'Consolidated', 'sdMonthSchemePortfolio'],
      ['2026', 'July', 'Consolidated', 'sdMonthSchemePortfolio']
    ])
  })

  it('reads NSE listings for stocks and ETFs', () => {
    const etf = parseNseListing(
      'Symbol,Underlying Asset,SecurityName,DateofListing,MarketLot,ISINNumber\nGOLDBEES,Gold,NIP GOLD,1,1,INF204KB17I5\n',
      'ETF'
    )
    expect(etf).toEqual([{ isin: 'INF204KB17I5', symbol: 'GOLDBEES', name: 'Gold', kind: 'ETF' }])
  })
})
