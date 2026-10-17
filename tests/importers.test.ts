import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import Database from 'better-sqlite3'
import { openDatabase, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { CasHelperError, mapCasJson, runCasparser, type CamsCas, type DepositoryCas } from '../src/main/importers/cas'
import { createServices, type Services } from '../src/main/services'

const MIGRATIONS = resolve('drizzle')
const KEY = 'a'.repeat(64)
const CASPARSER_EXE = resolve('resources/bin/casparser.exe')

let dir: string
let db: Db
let close: () => void
let svc: Services
const ME = 1

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-test-'))
  const opened = openDatabase(join(dir, 'test.db'), KEY, MIGRATIONS)
  db = opened.db
  close = () => opened.sqlite.close()
  svc = createServices({ db, casparserExe: CASPARSER_EXE, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

// Shapes mirror casparser 1.4.1 JSON output (by_alias=True; Decimals serialise as strings).
const camsCas: CamsCas = {
  statement_period: { from: '01-Jan-2023', to: '31-Mar-2024' },
  file_type: 'CAMS',
  cas_type: 'DETAILED',
  folios: [
    {
      folio: '1234567 / 89',
      amc: 'PPFAS Mutual Fund',
      schemes: [
        {
          scheme: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          rta: 'CAMS',
          close: '30.000',
          valuation: { date: '2024-03-31', nav: '70.00', cost: '1600.00', value: '2100.00' },
          transactions: [
            {
              date: '2023-01-10',
              description: 'SIP Purchase',
              amount: '500.00',
              units: '10.000',
              nav: '50.00',
              balance: '10.000',
              type: 'PURCHASE_SIP'
            },
            {
              date: '2023-01-10',
              description: '*** Stamp Duty ***',
              amount: '0.03',
              units: null,
              nav: null,
              balance: null,
              type: 'STAMP_DUTY_TAX'
            },
            {
              date: '2023-02-10',
              description: 'SIP Purchase',
              amount: '1100.00',
              units: '20.000',
              nav: '55.00',
              balance: '30.000',
              type: 'PURCHASE_SIP'
            },
            {
              date: '2023-06-01',
              description: 'Redemption',
              amount: '-650.00',
              units: '-10.000',
              nav: '65.00',
              balance: '20.000',
              type: 'REDEMPTION'
            },
            {
              date: '2023-07-01',
              description: 'Purchase',
              amount: '600.00',
              units: '10.000',
              nav: '60.00',
              balance: '30.000',
              type: 'PURCHASE'
            }
          ]
        }
      ]
    }
  ]
}

const cdslCas: DepositoryCas = {
  statement_period: { from: '01-Mar-2024', to: '31-Mar-2024' },
  file_type: 'CDSL',
  accounts: [
    {
      name: 'ZERODHA BROKING LIMITED',
      type: 'CDSL Demat Account',
      dp_id: '12081600',
      client_id: '00123456',
      equities: [
        {
          name: 'INFOSYS LIMITED',
          isin: 'INE009A01021',
          num_shares: '15',
          price: '1500.00',
          value: '22500.00',
          symbol: 'INFY',
          exchange: 'NSE'
        },
        {
          name: 'NIPPON INDIA ETF NIFTY BEES',
          isin: 'INF204KB14I2',
          num_shares: '100',
          price: '250.00',
          value: '25000.00',
          symbol: 'NIFTYBEES',
          exchange: 'NSE'
        }
      ],
      mutual_funds: [
        {
          name: 'UTI NIFTY 50 INDEX FUND - DIRECT GROWTH',
          isin: 'INF789F1AUV1',
          amfi: '120716',
          type: 'EQUITY',
          balance: '40.5',
          nav: '150.00',
          value: '6075.00',
          total_cost: '5000.00',
          folio: null
        }
      ]
    },
    {
      name: 'Mutual Fund Folios',
      type: 'Mutual Fund Folios',
      dp_id: '',
      client_id: '',
      equities: [],
      mutual_funds: [
        {
          name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          balance: '30.000',
          nav: '70.00',
          value: '2100.00',
          total_cost: '1600.00',
          folio: '1234567 / 89'
        }
      ]
    }
  ],
  nps: {
    pran: 'XXXXXXXX1234',
    schemes: [
      { scheme: 'SBI PENSION FUND SCHEME E - TIER I', tier: 'I', units: '1000.5', nav: '45.10', value: '45122.55' }
    ]
  }
}

describe('database', () => {
  it('is encrypted at rest and rejects the wrong key', () => {
    close()
    const plain = new Database(join(dir, 'test.db'))
    expect(() => plain.prepare('select count(*) from persons').get()).toThrow()
    plain.close()

    expect(() => openDatabase(join(dir, 'test.db'), 'b'.repeat(64), MIGRATIONS)).toThrow()
    const again = openDatabase(join(dir, 'test.db'), KEY, MIGRATIONS)
    close = () => again.sqlite.close()
    expect(again.sqlite.prepare('select count(*) as n from persons').get()).toEqual({ n: 2 })
  })

  it('seeds Me and Dad once', () => {
    expect(svc.listPersons().map((p) => p.name)).toEqual(['Me', 'Dad'])
  })
})

describe('CAMS detailed CAS', () => {
  it('imports folios, transactions and valuation with FIFO cost', () => {
    const r = persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cams.pdf', bundle: mapCasJson(camsCas) })
    expect(r.accountsCreated).toBe(1)
    expect(r.transactionsAdded).toBe(5)
    expect(r.snapshotsAdded).toBe(1)

    const [h] = svc.listHoldings(ME)
    expect(h.quantity).toBe(30)
    expect(h.tradesQuantity).toBeNull()
    // FIFO: sold the first 10 @50 → remaining 20 @55 + 10 @60
    expect(h.invested).toBeCloseTo(1700)
    expect(h.avgCost).toBeCloseTo(56.667, 2)
    expect(h.realizedPnl).toBeCloseTo(150)
    expect(h.marketValue).toBeCloseTo(2100)
    expect(h.accountName).toContain('1234567/89')
  })

  it('skips duplicates on re-import and can be undone', () => {
    const first = persistBundle(db, {
      personId: ME,
      kind: 'CAS_PDF',
      fileName: 'cams.pdf',
      bundle: mapCasJson(camsCas)
    })
    const second = persistBundle(db, {
      personId: ME,
      kind: 'CAS_PDF',
      fileName: 'cams.pdf',
      bundle: mapCasJson(camsCas)
    })
    expect(second.transactionsAdded).toBe(0)
    expect(second.transactionsSkipped).toBe(5)

    svc.undoImport(first.batchId)
    expect(svc.listHoldings(ME)).toHaveLength(0)
    expect(svc.listImports()).toHaveLength(1)
  })
})

describe('CDSL CAS', () => {
  it('maps demat equities, ETFs, demat MFs, RTA folios and NPS', () => {
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cdsl.pdf', bundle: mapCasJson(cdslCas) })
    const holdings = svc.listHoldings(ME)
    const by = (isinOrName: string) =>
      holdings.find((h) => h.isin === isinOrName || h.instrumentName.startsWith(isinOrName))!

    expect(by('INE009A01021')).toMatchObject({
      platform: 'ZERODHA',
      assetClass: 'EQUITY_IN',
      symbol: 'INFY',
      quantity: 15,
      marketValue: 22500
    })
    expect(by('INF204KB14I2').assetClass).toBe('ETF')
    expect(by('INF789F1AUV1')).toMatchObject({ assetClass: 'MF', quantity: 40.5 })
    expect(by('INF789F1AUV1').avgCost).toBeCloseTo(5000 / 40.5)
    expect(by('INF879O01027')).toMatchObject({ platform: 'MF_RTA', quantity: 30 })
    expect(by('SBI PENSION')).toMatchObject({ platform: 'NPS', assetClass: 'NPS', quantity: 1000.5 })

    const zerodha = svc.listAccounts().find((a) => a.platform === 'ZERODHA')!
    expect(zerodha.externalId).toBe('12081600-00123456')
    expect(zerodha.name).toBe('Zerodha demat (CDSL)')
  })

  it('merges the RTA folio with the same folio from a CAMS CAS', () => {
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cdsl.pdf', bundle: mapCasJson(cdslCas) })
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cams.pdf', bundle: mapCasJson(camsCas) })
    const ppfas = svc.listHoldings(ME).filter((h) => h.isin === 'INF879O01027')
    expect(ppfas).toHaveLength(1)
    expect(ppfas[0].avgCost).toBeCloseTo(56.667, 2) // cost from CAMS transactions
  })
})

describe('broker trade files', () => {
  const tradebookCsv =
    'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time\n' +
    'INFY,INE009A01021,2023-05-02,NSE,EQ,EQ,buy,false,10.000000,1300.00,111,9001,2023-05-02T10:00:00\n' +
    'INFY,INE009A01021,2023-09-12,NSE,EQ,EQ,buy,false,10.000000,1450.00,112,9002,2023-09-12T10:00:00\n' +
    'INFY,INE009A01021,2024-01-15,NSE,EQ,EQ,sell,false,5.000000,1600.00,113,9003,2024-01-15T10:00:00\n' +
    'NIFTY24MARFUT,,2024-01-16,NFO,FO,,buy,false,50,21000,114,9004,2024-01-16T10:00:00\n'

  it('imports a Zerodha tradebook into the same account as the CAS', () => {
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cdsl.pdf', bundle: mapCasJson(cdslCas) })
    const file = join(dir, 'tradebook.csv')
    writeFileSync(file, tradebookCsv)
    return svc.runImport({ kind: 'ZERODHA_TRADEBOOK', personId: ME, filePath: file }).then((r) => {
      expect(r.transactionsAdded).toBe(3)
      expect(r.accountsCreated).toBe(0)
      expect(r.warnings.join(' ')).toMatch(/F&O, currency or commodity rows were skipped/)

      const infy = svc.listHoldings(ME).find((h) => h.isin === 'INE009A01021')!
      expect(infy.quantity).toBe(15)
      expect(infy.tradesQuantity).toBeNull() // 10 + 10 - 5 matches the CAS
      expect(infy.avgCost).toBeCloseTo((5 * 1300 + 10 * 1450) / 15) // FIFO: first lot partly sold
      expect(infy.realizedPnl).toBeCloseTo(5 * 300)
      expect(svc.listAccounts().filter((a) => a.platform === 'ZERODHA')).toHaveLength(1)
    })
  })

  it('flags holdings where trades and the statement disagree', async () => {
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'cdsl.pdf', bundle: mapCasJson(cdslCas) })
    const file = join(dir, 'tradebook.csv')
    writeFileSync(file, tradebookCsv.split('\n').slice(0, 3).join('\n')) // only 2 buys = 20 shares
    await svc.runImport({ kind: 'ZERODHA_TRADEBOOK', personId: ME, filePath: file })
    const infy = svc.listHoldings(ME).find((h) => h.isin === 'INE009A01021')!
    expect(infy.quantity).toBe(15) // statement wins
    expect(infy.tradesQuantity).toBe(20)
  })

  it('imports a Groww order history XLSX with title rows above the header', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Order History Report'],
      ['Client: XXXX'],
      [],
      [
        'Stock name',
        'Symbol',
        'ISIN',
        'Type',
        'Quantity',
        'Value',
        'Exchange',
        'Exchange Order Id',
        'Execution date and time',
        'Order status'
      ],
      ['Tata Motors', 'TATAMOTORS', 'INE155A01022', 'BUY', 4, 3200, 'NSE', 'A1', '12-02-2024 10:15 AM', 'Executed'],
      ['Tata Motors', 'TATAMOTORS', 'INE155A01022', 'BUY', 4, 3600, 'NSE', 'A2', '20-03-2024 11:00 AM', 'Executed'],
      ['Tata Motors', 'TATAMOTORS', 'INE155A01022', 'BUY', 4, 3600, 'NSE', 'A3', '21-03-2024 11:00 AM', 'Cancelled']
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Orders')
    const file = join(dir, 'groww.xlsx')
    writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

    const r = await svc.runImport({ kind: 'GROWW_ORDERS', personId: ME, filePath: file })
    expect(r.transactionsAdded).toBe(2)
    expect(r.warnings.join(' ')).toMatch(/cancelled/)
    const tm = svc.listHoldings(ME).find((h) => h.isin === 'INE155A01022')!
    expect(tm).toMatchObject({ platform: 'GROWW', quantity: 8 })
    expect(tm.avgCost).toBeCloseTo(850)
  })

  it('imports generic US trades for INDmoney in USD', async () => {
    const file = join(dir, 'us.csv')
    writeFileSync(
      file,
      'date,type,symbol,name,isin,quantity,price,fees,currency,market\n' +
        '2024-03-15,BUY,AAPL,Apple Inc,,2.5,172.40,0.5,USD,US\n' +
        '2024-06-20,DIVIDEND,AAPL,Apple Inc,,0,0.60,0,USD,US\n'
    )
    await svc.runImport({ kind: 'GENERIC_TRADES', personId: 2, filePath: file, platform: 'INDMONEY' })
    const [aapl] = svc.listHoldings(2)
    expect(aapl).toMatchObject({
      platform: 'INDMONEY',
      assetClass: 'EQUITY_US',
      currency: 'USD',
      symbol: 'AAPL',
      quantity: 2.5,
      dividends: 0.6
    })
    expect(aapl.invested).toBeCloseTo(2.5 * 172.4 + 0.5)
    expect(svc.listHoldings(ME)).toHaveLength(0) // Dad's data stays with Dad
  })

  it('records manual entries', () => {
    svc.addManualTransaction({
      personId: ME,
      platform: 'INDMONEY',
      date: '2024-01-05',
      type: 'BUY',
      assetClass: 'EQUITY_US',
      name: 'Microsoft',
      symbol: 'msft',
      quantity: 1,
      price: 370,
      currency: 'USD'
    })
    const [h] = svc.listHoldings(ME)
    expect(h).toMatchObject({ symbol: 'MSFT', quantity: 1, avgCost: 370, lastPrice: 370 })
  })

  it('rejects a file with no recognisable columns', async () => {
    const file = join(dir, 'junk.csv')
    writeFileSync(file, 'a,b,c\n1,2,3\n')
    await expect(svc.runImport({ kind: 'ZERODHA_TRADEBOOK', personId: ME, filePath: file })).rejects.toThrow(
      /expected columns/
    )
  })
})

describe.skipIf(!existsSync(CASPARSER_EXE))('bundled casparser.exe', () => {
  it('reports unreadable files as structured errors', async () => {
    const notCas = join(dir, 'x.pdf')
    writeFileSync(notCas, '%PDF-1.4\n%%EOF\n')
    await expect(runCasparser(CASPARSER_EXE, join(dir, 'missing.pdf'), 'x')).rejects.toMatchObject({
      code: 'file_not_found'
    })
    const err = await runCasparser(CASPARSER_EXE, notCas, 'x').catch((e) => e)
    expect(err).toBeInstanceOf(CasHelperError)
    expect(['parse_error', 'internal']).toContain(err.code)
  }, 60_000)
})
