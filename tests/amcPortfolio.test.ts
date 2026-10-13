import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { openDatabase, schema, type Db } from '../src/main/db'
import { classifyIsin, fundNameVariants, matchPortfolios, parseAmcWorkbook } from '../src/main/importers/amcPortfolio'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { createServices, type Services } from '../src/main/services'

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  // Percentages printed as numbers (e.g. 7.85 = 7.85%), like most AMC files.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['PPFAS Mutual Fund'],
      ['PORTFOLIO STATEMENT OF PARAG PARIKH FLEXI CAP FUND AS ON SEPTEMBER 30, 2026'],
      [],
      [
        'Name of the Instrument',
        'ISIN',
        'Industry / Rating',
        'Quantity',
        'Market/Fair Value (Rs. in Lacs)',
        '% to Net Assets'
      ],
      ['Equity & Equity related', '', '', '', '', ''],
      ['HDFC Bank Limited', 'INE040A01034', 'Banks', 1000, 1874, 8.0],
      ['Bajaj Holdings & Investment Limited', 'INE118A01012', 'Finance', 500, 900, 6.0],
      ['ITC Limited', 'INE154A01025', 'Diversified FMCG', 2000, 800, 5.0],
      ['Alphabet Inc A', 'US02079K3059', 'Interactive Media & Services', 300, 1200, 7.0],
      ['Sub Total', '', '', '', '', 26.0],
      ['Debt Instruments', '', '', '', '', ''],
      ['7.18% Government of India 2033', 'IN0020230085', 'SOVEREIGN', 100, 500, 4.0],
      ['Bajaj Finance Ltd NCD', 'INE296A07RX7', 'CRISIL AAA', 50, 300, 2.0],
      ['TREPS', '', '', '', 3000, 66.5],
      ['Net Receivables / (Payables)', '', '', '', 50, 1.5],
      ['GRAND TOTAL', '', '', '', 9000, 100.0]
    ]),
    'PPFCF'
  )
  // Fractions (cells formatted as %), a different column header and title.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Scheme Name: Parag Parikh Tax Saver Fund'],
      ['Portfolio as on 30-Sep-2026'],
      ['Name of Instrument', 'ISIN Code', 'Rating/Industry', 'Quantity', 'Market Value', '% of NAV'],
      ['Infosys Limited', 'INE009A01021', 'IT - Software', 10, 10, 0.6],
      ['TREPS', '', '', '', 1, 0.4]
    ]),
    'PPTSF'
  )
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('AMC portfolio parsing', () => {
  it('classifies holdings by ISIN structure and rating', () => {
    expect(classifyIsin('INE040A01034', 'Banks')).toBe('EQUITY')
    expect(classifyIsin('INE296A07RX7', 'Finance')).toBe('DEBT') // security type 07 = debenture
    expect(classifyIsin('IN0020230085', null)).toBe('DEBT') // government security
    expect(classifyIsin('INE040A01034', 'CRISIL AAA')).toBe('DEBT')
    expect(classifyIsin('US02079K3059', 'Interactive Media')).toBe('EQUITY')
    expect(classifyIsin('INF204KB14I2', null)).toBe('OTHER')
  })

  it('reads every scheme sheet with weights as fractions', () => {
    const [flexi, tax] = parseAmcWorkbook(workbook())
    expect(flexi.asOf).toBe('2026-09-30')
    expect(flexi.holdings.map((h) => [h.name, h.assetType, h.weight])).toEqual([
      ['HDFC Bank Limited', 'EQUITY', 0.08],
      ['Bajaj Holdings & Investment Limited', 'EQUITY', 0.06],
      ['ITC Limited', 'EQUITY', 0.05],
      ['Alphabet Inc A', 'EQUITY', 0.07],
      ['7.18% Government of India 2033', 'DEBT', 0.04],
      ['Bajaj Finance Ltd NCD', 'DEBT', 0.02],
      ['TREPS', 'CASH', 0.665],
      ['Net Receivables / (Payables)', 'CASH', 0.015]
    ])
    expect(tax.asOf).toBe('2026-09-30')
    expect(tax.holdings.map((h) => h.weight)).toEqual([0.6, 0.4])
  })

  it('matches sheets to held funds by name, ignoring plan/option words', () => {
    const ps = parseAmcWorkbook(workbook())
    const m = matchPortfolios(ps, [
      { id: 1, name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth' },
      // Renamed from "Tax Saver" to "ELSS Tax Saver": still the same scheme.
      { id: 2, name: 'Parag Parikh ELSS Tax Saver Fund - Direct Growth' },
      { id: 3, name: 'UTI Nifty 50 Index Fund - Direct Plan - Growth' },
      { id: 4, name: 'Parag Parikh Liquid Fund - Direct Plan - Growth' }
    ])
    expect(m.map((x) => [x.fundId, x.portfolio.sheet])).toEqual([
      [1, 'PPFCF'],
      [2, 'PPTSF']
    ])
  })
})

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
          name: 'HDFC BANK LIMITED',
          isin: 'INE040A01034',
          num_shares: '10',
          price: '1000',
          value: '10000',
          symbol: 'HDFCBANK',
          exchange: 'NSE'
        }
      ],
      mutual_funds: [
        {
          name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          balance: '1000',
          nav: '100',
          value: '100000',
          total_cost: '80000',
          folio: null
        }
      ]
    }
  ],
  nps: null
}

describe('AMC sheet layouts', () => {
  const book = (sheets: Record<string, unknown[][]>) => {
    const wb = XLSX.utils.book_new()
    for (const [name, rows] of Object.entries(sheets))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }
  const HEAD = ['NAME OF THE INSTRUMENT', 'RATING/INDUSTRY', 'QUANTITY', 'MARKET-VALUE', '% TO NAV', 'ISIN']

  it('splits a sheet with every scheme stacked on it (UTI), reading "as of" dates', () => {
    const block = (code: string, scheme: string, rows: unknown[][]) => [
      [`SCHEME CODE${code}STARTS`],
      ['UTI MUTUAL FUND'],
      [`SCHEME: ${scheme}`],
      ['PROVISIONAL AND UNAUDITED PORTFOLIO DISCLOSURE AS OF 30/09/2026 (Market value in Lacs)'],
      [],
      HEAD,
      ['EQUITY AND EQUITY RELATED'],
      ...rows,
      ['This scheme has exposure to floating rate instruments.'],
      [`SCHEME CODE${code}ENDS`]
    ]
    const ps = parseAmcWorkbook(
      book({
        EXPOSURE: [
          ...block('017', 'UTI - Large Cap Fund', [
            ['EQ - HDFC BANK LIMITED', 'Banks', 10, 600, 60, 'INE040A01034'],
            ['EQ - ICICI BANK LTD', 'Banks', 10, 400, 40, 'INE090A01021']
          ]),
          ...block('090', 'UTI - Nifty 50 Index Fund', [
            ['EQ - RELIANCE INDUSTRIES LTD', 'Petroleum Products', 10, 1000, 100, 'INE002A01018']
          ])
        ]
      })
    )
    expect(ps.map((p) => [p.asOf, p.holdings.length, p.holdings.reduce((a, h) => a + h.weight, 0)])).toEqual([
      ['2026-09-30', 2, 1],
      ['2026-09-30', 1, 1]
    ])
    const m = matchPortfolios(ps, [{ id: 7, name: 'UTI NIFTY 50 INDEX FUND - DIRECT PLAN - GROWTH' }])
    expect(m.map((x) => x.portfolio.holdings[0].isin)).toEqual(['INE002A01018'])
  })

  it('keeps a scheme whole when only a section repeats the column headings', () => {
    const ps = parseAmcWorkbook(
      book({
        S1: [
          ['ABC Flexi Cap Fund'],
          ['Portfolio as on 30-Sep-2026'],
          HEAD,
          ['HDFC BANK LIMITED', 'Banks', 1, 1, 70, 'INE040A01034'],
          ['Debt Instruments'],
          HEAD,
          ['GOI 2033', 'SOVEREIGN', 1, 1, 30, 'IN0020230085']
        ]
      })
    )
    expect(ps).toHaveLength(1)
    expect(ps[0].holdings).toHaveLength(2)
  })

  it('matches a title whose row repeats the scheme name across cells (HDFC)', () => {
    const ps = parseAmcWorkbook(
      book({
        HDFCLI: [
          [
            'HDFC Liquid Fund (An Open ended Liquid scheme)',
            '',
            'HDFC Liquid Fund (An Open ended Liquid scheme)',
            'Income',
            'Hybrid'
          ],
          ['Portfolio as on September 30, 2026'],
          HEAD,
          ['TREPS', '', '', '', 100, '']
        ]
      })
    )
    expect(matchPortfolios(ps, [{ id: 1, name: 'HDFC LIQUID FUND - DIRECT PLAN - GROWTH' }])).toHaveLength(1)
  })
})

describe('fund look-through after importing a disclosure', () => {
  let dir: string
  let db: Db
  let close: () => void
  let svc: Services

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-amc-'))
    const o = openDatabase(join(dir, 't.db'), 'd'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    // AMFI's NAV file, for current scheme names (the statement may carry an old one).
    const navAll =
      'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\n' +
      'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)\nPPFAS Mutual Fund\n' +
      '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;92.5;09-Oct-2026\n'
    const fetch = (async (input: string | URL | Request) =>
      String(input).includes('NAVAll.txt')
        ? new Response(navAll)
        : new Response('', { status: 404 })) as typeof globalThis.fetch
    svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, fetch })
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'cas.pdf', bundle: mapCasJson(cas) })
    db.insert(schema.sectorMap)
      .values({
        isin: 'INE040A01034',
        symbol: 'HDFCBANK',
        name: 'HDFC Bank',
        industry: 'Financial Services',
        source: 'NSE',
        updatedAt: '2026-10-01'
      })
      .run()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('splits the fund into asset types, sectors and underlying companies', async () => {
    const file = join(dir, 'ppfas.xlsx')
    writeFileSync(file, workbook())
    const r = await svc.runImport({ kind: 'FUND_PORTFOLIO', personId: 1, filePath: file })
    expect(r.snapshotsAdded).toBe(8)
    expect(r.notes?.[0]).toMatch(/Parag Parikh Flexi Cap.*8 holdings as of 2026-09-30.*26% equity/)

    const e = svc.getExposure(1)
    expect(e.totalInr).toBe(110000)
    const mix = Object.fromEntries(e.assetMix.map((a) => [a.type, a.valueInr]))
    expect(mix.EQUITY).toBeCloseTo(10000 + 26000)
    expect(mix.DEBT).toBeCloseTo(6000)
    expect(mix.CASH).toBeCloseTo(68000)

    // HDFC Bank held directly and through the fund appears once, with both parts.
    const hdfc = e.companies.find((c) => c.isin === 'INE040A01034')!
    expect(hdfc).toMatchObject({ directInr: 10000, sector: 'Financial Services' })
    expect(hdfc.viaFundsInr).toBeCloseTo(8000)

    const fin = e.sectors.find((s) => s.sector === 'Financial Services')!
    expect(fin.valueInr).toBeCloseTo(10000 + 8000 + 6000) // HDFC direct + HDFC via fund + Bajaj Holdings
    expect(e.sectors.find((s) => s.sector === 'Information Technology')?.viaFundsInr).toBeCloseTo(7000) // Alphabet
    expect(e.geography.find((g) => g.region === 'US')?.valueInr).toBeCloseTo(7000)
    expect(e.funds[0]).toMatchObject({ holdingsAsOf: '2026-09-30', source: 'AMC' })
  })

  it('can be undone like any import', async () => {
    const file = join(dir, 'ppfas.xlsx')
    writeFileSync(file, workbook())
    const r = await svc.runImport({ kind: 'FUND_PORTFOLIO', personId: 1, filePath: file })
    svc.undoImport(r.batchId)
    expect(db.select().from(schema.fundHoldings).all()).toHaveLength(0)
  })

  it('explains when no sheet matches a held fund', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Portfolio of Some Other Small Cap Fund as on 30-Sep-2026'],
        ['Name of the Instrument', 'ISIN', 'Industry', '% to Net Assets'],
        ['X Ltd', 'INE111A01011', 'Banks', 100]
      ]),
      'S1'
    )
    const file = join(dir, 'other.xlsx')
    writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    await expect(svc.runImport({ kind: 'FUND_PORTFOLIO', personId: 1, filePath: file })).rejects.toThrow(
      /none match.*Closest: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" → closest is "Some Other Small Cap Fund"/
    )
  })

  it('matches a statement that still uses a scheme’s old name, through AMFI’s current name', async () => {
    // Parag Parikh Flexi Cap Fund was called PPFAS Long Term Equity Fund until 2020.
    db.update(schema.instruments)
      .set({ name: 'PPFAS LONG TERM EQUITY FUND - DIRECT PLAN - GROWTH' })
      .where(eq(schema.instruments.isin, 'INF879O01027'))
      .run()
    const file = join(dir, 'ppfas.xlsx')
    writeFileSync(file, workbook())
    const r = await svc.runImport({ kind: 'FUND_PORTFOLIO', personId: 1, filePath: file })
    expect(r.snapshotsAdded).toBe(8)
    expect(
      db.select().from(schema.instruments).where(eq(schema.instruments.isin, 'INF879O01027')).get()!.schemeName
    ).toBe('Parag Parikh Flexi Cap Fund')
  })

  it('reads a fund name with its former name in brackets', () => {
    expect(fundNameVariants('KOTAK FLEXICAP FUND - DIRECT GROWTH (ERSTWHILE KOTAK STANDARD MULTICAP FUND)')).toEqual([
      'KOTAK FLEXICAP FUND - DIRECT GROWTH',
      'KOTAK STANDARD MULTICAP FUND'
    ])
  })
})
