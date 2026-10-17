import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { listHoldings } from '../src/main/portfolio/holdings'
import { computeTax } from '../src/main/portfolio/tax'
import { createServices, type Services } from '../src/main/services'

const xls = (sheet: string, rows: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet)
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
}
const disclaimer = [['Disclaimer:-'], ['* This Profit and Loss report is for informational purposes only.']]

// Laid out like INDmoney's reports: an account block, a blank gap, the table, then a disclaimer.
const indHoldings = () =>
  xls('HOLDINGS_BOOK', [
    ['Account Details'],
    ['Broker Name', 'DriveWealth'],
    ['Broker Account', 'X1'],
    ['Holdings as on', '2026-10-11'],
    [],
    [],
    [],
    ['Stock Symbol', 'Holding Since', 'Quantity', 'Avg. Price ($)', 'Total Value ($)'],
    ['AAPL', '21 Jul 2025, 11:16 PM', 0.05, 200, 10],
    ['MSFT', '27 Apr 2026, 07:15 PM', 0.02, 400, 8],
    [],
    ...disclaimer
  ])
const indOrders = () =>
  xls('ORDER_BOOK', [
    ['Account Details'],
    ['Broker Name', 'DriveWealth'],
    ['Broker Account', 'X1'],
    ['Period From', '2019-01-01'],
    ['Period To', '2026-10-11'],
    ['Total Buy Amount ($)', 18],
    ['Total Sell Amount ($)', 0],
    [],
    [],
    [],
    [
      'Stock Name',
      'Stock Symbol',
      'Order Placed Time',
      'Order Execution Time',
      'Broker Reference Id',
      'Transaction Type',
      'Order Type',
      'Quantity',
      'Price ($)',
      'Order Amount ($)',
      'Brokerage ($)'
    ],
    [
      'Apple Inc. Common Stock',
      'AAPL',
      '21 Jul 2025, 11:16 PM',
      '21 Jul 2025, 11:16 PM',
      'MG.1',
      'BUY',
      'market',
      0.05,
      200,
      10,
      0.01
    ],
    [
      'Microsoft Corporation',
      'MSFT',
      '27 Apr 2026, 07:15 PM',
      '27 Apr 2026, 07:15 PM',
      'MG.2',
      'BUY',
      'market',
      0.02,
      400,
      8,
      0.01
    ],
    [],
    ...disclaimer
  ])

describe('holdings with no trade history still get tax lots', () => {
  let dir: string
  let db: Db
  let close: () => void
  let svc: Services
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-lots-'))
    const o = openDatabase(join(dir, 't.db'), 'd'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s })
    // A day of USD→INR so US costs and values convert.
    db.insert(schema.fxRates)
      .values({ pair: 'USDINR', rate: 85, prevClose: 85, asOf: '2026-10-11', fetchedAt: '2026-10-11' })
      .run()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })
  const priceUs = () => {
    db.insert(schema.fxHistory).values({ pair: 'USDINR', date: '2025-01-01', rate: 84 }).run()
    for (const i of db.select().from(schema.instruments).all())
      if (i.assetClass === 'EQUITY_US')
        db.insert(schema.quotes)
          .values({
            instrumentId: i.id,
            price: i.tickerUs === 'AAPL' ? 250 : 420,
            prevClose: null,
            currency: 'USD',
            asOf: '2026-10-11T20:00:00Z',
            source: 'YAHOO',
            fetchedAt: 'x'
          })
          .onConflictDoNothing()
          .run()
  }
  const importFile = (name: string, data: Buffer, kind: 'INDMONEY_US' | 'GENERIC_TRADES' | 'BROKER_HOLDINGS') => {
    const file = join(dir, name)
    writeFileSync(file, data)
    return svc.runImport({ kind, personId: 1, filePath: file })
  }

  it('reads INDmoney’s holdings and order reports, whichever import is chosen', async () => {
    await importFile('IND-HOLDINGS.xls', indHoldings(), 'INDMONEY_US')
    // Picked as a trades file by mistake: still recognised.
    const orders = await importFile('IND-ORDERS.xls', indOrders(), 'GENERIC_TRADES')
    expect(orders.kind).toBe('INDMONEY_US')
    expect(orders.transactionsAdded).toBe(2)
    const rows = listHoldings(db, 1)
    expect(rows.map((r) => [r.symbol, r.assetClass, r.quantity, r.avgCost]).sort()).toEqual([
      ['AAPL', 'EQUITY_US', 0.05, 200.2],
      ['MSFT', 'EQUITY_US', 0.02, 400.5]
    ])
  })

  it('dates US lots from INDmoney’s "Holding Since" when trades and holdings differ', async () => {
    await importFile('IND-HOLDINGS.xls', indHoldings(), 'INDMONEY_US')
    priceUs()
    const tax = computeTax(db, 1, '2026-10-11')
    const lots = tax.lots.map((l) => [l.name, l.buyDate, l.estimatedFrom, l.term])
    expect(lots).toContainEqual(['AAPL', '2025-07-21', 'HELD_SINCE', 'ST']) // foreign shares: long-term after 24 months
    expect(lots).toContainEqual(['MSFT', '2026-04-27', 'HELD_SINCE', 'ST'])
    expect(tax.estimateOnly).toHaveLength(0)
  })

  it('splits a CAS holding into over-a-year and recent lots from Zerodha’s long-term quantity', async () => {
    const cas: DepositoryCas = {
      statement_period: { from: '01-Mar-2026', to: '31-Mar-2026' },
      file_type: 'CDSL',
      accounts: [
        {
          name: 'ZERODHA BROKING LIMITED',
          type: 'CDSL Demat Account',
          dp_id: '1',
          client_id: '2',
          equities: [
            {
              name: 'INFOSYS LIMITED',
              isin: 'INE009A01021',
              num_shares: '10',
              price: '1500',
              value: '15000',
              symbol: null,
              exchange: null
            }
          ],
          mutual_funds: []
        }
      ],
      nps: null
    }
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'mar.pdf', bundle: mapCasJson(cas) })
    const zerodha = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      zerodha,
      XLSX.utils.aoa_to_sheet([
        ['Client ID', 'AB1'],
        ['Equity Holdings Statement as on 2026-10-15'],
        [],
        [
          'Symbol',
          'ISIN',
          'Sector',
          'Quantity Available',
          'Quantity Discrepant',
          'Quantity Long Term',
          'Average Price'
        ],
        ['INFY', 'INE009A01021', 'IT', 10, 0, 6, 1000]
      ]),
      'Equity'
    )
    const data = XLSX.write(zerodha, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    await importFile('holdings.xlsx', data, 'BROKER_HOLDINGS')

    const tax = computeTax(db, 1, '2026-10-15')
    const infy = tax.lots.filter((l) => l.name.startsWith('INFOSYS'))
    expect(infy.map((l) => [l.estimatedFrom, l.units, l.term])).toEqual([
      ['OVER_A_YEAR', 6, 'LT'],
      ['WITHIN_A_YEAR', 4, 'ST']
    ])
    expect(infy[0].buyDate <= '2025-10-14').toBe(true)
    expect(tax.warnings.some((w) => /estimated from the broker's long-term quantity/.test(w))).toBe(true)
    // Long-term gains now count toward the yearly exemption and harvesting ideas.
    expect(tax.harvest.map((h) => h.name)).toContain(infy[0].name)
  })

  it('uses a first-bought date typed in for a holding', async () => {
    await importFile('IND-HOLDINGS.xls', indHoldings(), 'INDMONEY_US')
    priceUs()
    const msft = listHoldings(db, 1).find((r) => r.symbol === 'MSFT')!
    await svc.setBuyPrice({
      personId: 1,
      accountId: msft.accountId,
      instrumentId: msft.instrumentId,
      avgCost: 390,
      heldSince: '2024-01-10'
    })
    expect(listHoldings(db, 1).find((r) => r.symbol === 'MSFT')).toMatchObject({
      avgCost: 390,
      heldSince: '2024-01-10'
    })
    const lot = computeTax(db, 1, '2026-10-11').lots.find((l) => l.name === 'MSFT')!
    expect([lot.buyDate, lot.term]).toEqual(['2024-01-10', 'LT'])
  })

  it('dates Coin mutual funds from Zerodha’s MF tradebook, and says what to import for the rest', async () => {
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
              name: 'SUZLON ENERGY LIMITED',
              isin: 'INE040H01021',
              num_shares: '100',
              price: '40',
              value: '4000',
              symbol: null,
              exchange: null
            }
          ],
          mutual_funds: [
            {
              name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
              isin: 'INF879O01027',
              amfi: null,
              type: null,
              balance: '10',
              nav: '90',
              value: '900',
              total_cost: null,
              folio: null
            }
          ]
        }
      ],
      nps: null
    }
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'sep.pdf', bundle: mapCasJson(cas) })
    const file = join(dir, 'tradebook-MF.csv')
    writeFileSync(
      file,
      'symbol,isin,trade_date,exchange,segment,series,trade_type,quantity,price,trade_id\n' +
        'PARAG PARIKH FLEXI CAP FUND - DIRECT PLAN,INF879O01027,2023-05-10,,MF,,buy,6,55,T1\n' +
        'PARAG PARIKH FLEXI CAP FUND - DIRECT PLAN,INF879O01027,2026-02-10,,MF,,buy,4,80,T2\n'
    )
    const r = await svc.runImport({ kind: 'ZERODHA_TRADEBOOK', personId: 1, filePath: file })
    expect(r.transactionsAdded).toBe(2)
    const tax = computeTax(db, 1, '2026-10-15')
    expect(tax.lots.filter((l) => l.name.startsWith('Parag')).map((l) => [l.buyDate, l.units, l.term])).toEqual([
      ['2023-05-10', 6, 'LT'],
      ['2026-02-10', 4, 'ST']
    ])
    // Suzlon has no dates yet: the row says which Zerodha file adds them.
    expect(tax.estimateOnly.find((e) => e.name.startsWith('SUZLON'))!.fix).toMatch(/Zerodha holdings file/)
  })
})

describe('the date a holdings statement is as on', () => {
  it('reads the common ways brokers write it', async () => {
    const { statementDate } = await import('../src/main/importers/brokerHoldings')
    expect(statementDate('equity holdings statement as on 2026-10-15')).toBe('2026-10-15')
    expect(statementDate('holdings as on 15-10-2026')).toBe('2026-10-15')
    expect(statementDate('portfolio as of 15 oct 2026')).toBe('2026-10-15')
    expect(statementDate('holdings statement')).toBeNull()
  })
})
