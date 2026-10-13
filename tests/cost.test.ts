import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { openDatabase, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { parseBrokerHoldings } from '../src/main/importers/brokerHoldings'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { listHoldings } from '../src/main/portfolio/holdings'
import { createServices, type Services } from '../src/main/services'

const xlsx = (rows: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Holdings')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// Laid out like the real downloads: a block of account details, then the table.
const zerodhaEquity = () =>
  xlsx([
    ['Client ID', 'AB1234'],
    ['Equity Holdings Statement as on 2026-10-11'],
    [],
    [
      'Symbol',
      'ISIN',
      'Sector',
      'Quantity Available',
      'Quantity Discrepant',
      'Quantity Long Term',
      'Quantity Pledged (Margin)',
      'Quantity Pledged (Loan)',
      'Average Price',
      'Previous Closing Price',
      'Unrealized P&L',
      'Unrealized P&L Pct.'
    ],
    ['HDFCBANK', 'INE040A01034', 'Banks', 10, 0, 10, 0, 0, 1450.5, 1900, 4495, 31],
    ['NOTHELD', 'INE999Z01019', 'IT', 5, 0, 5, 0, 0, 100, 120, 100, 20]
  ])
const growwFunds = () =>
  xlsx([
    ['Name', 'Some Person'],
    ['Mutual Funds Holdings Statement'],
    [],
    [
      'Scheme Name',
      'AMC',
      'Category',
      'Sub-category',
      'Folio No.',
      'Source',
      'Units',
      'Invested Value',
      'Current Value',
      'Returns',
      'XIRR'
    ],
    [
      'Parag Parikh Flexi Cap Fund Direct Growth',
      'PPFAS',
      'Equity',
      'Flexi Cap',
      '123',
      'Groww',
      100,
      7500,
      9000,
      1500,
      '12%'
    ]
  ])

const cas = (date: string, units: string): DepositoryCas => ({
  statement_period: { from: '01-Sep-2026', to: date },
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
          num_shares: units,
          price: '1900',
          value: String(1900 * Number(units)),
          symbol: null,
          exchange: null
        }
      ],
      mutual_funds: [
        // Units held in demat: the statement prints no cost for these.
        {
          name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          balance: '100',
          nav: '90',
          value: '9000',
          total_cost: null,
          folio: null
        }
      ]
    }
  ],
  nps: null
})

describe('broker holdings files', () => {
  it('reads Zerodha’s and Groww’s layouts', () => {
    const z = parseBrokerHoldings(zerodhaEquity())
    expect(z.platform).toBe('ZERODHA')
    expect(z.rows[0]).toMatchObject({ isin: 'INE040A01034', symbol: 'HDFCBANK', quantity: 10, avgCost: 1450.5 })
    const g = parseBrokerHoldings(growwFunds())
    expect(g.platform).toBe('GROWW')
    expect(g.rows[0]).toMatchObject({
      name: 'Parag Parikh Flexi Cap Fund Direct Growth',
      quantity: 100,
      invested: 7500
    })
  })
})

describe('buy prices for holdings from statements without cost', () => {
  let dir: string
  let db: Db
  let close: () => void
  let svc: Services
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-cost-'))
    const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s })
    persistBundle(db, {
      personId: 1,
      kind: 'CAS_PDF',
      fileName: 'sep.pdf',
      bundle: mapCasJson(cas('30-Sep-2026', '10'))
    })
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })
  const row = (isin: string) => listHoldings(db, 1).find((h) => h.isin === isin)!
  const importFile = async (name: string, data: Buffer) => {
    const file = join(dir, name)
    writeFileSync(file, data)
    return svc.runImport({ kind: 'BROKER_HOLDINGS', personId: 1, filePath: file })
  }

  it('shows invested and gain once a broker file gives the buy price', async () => {
    expect(row('INE040A01034').investedInr).toBeNull()
    const r = await importFile('zerodha.xlsx', zerodhaEquity())
    expect(r.snapshotsAdded).toBe(1)
    expect(r.warnings[0]).toMatch(/1 line in the file match no holding.*NOTHELD/)
    const hdfc = row('INE040A01034')
    expect(hdfc).toMatchObject({ avgCost: 1450.5, investedInr: 14505, costSource: 'BROKER' })
    expect(hdfc.unrealizedPnlInr).toBeCloseTo(19000 - 14505)

    await importFile('groww-mf.xlsx', growwFunds())
    expect(row('INF879O01027')).toMatchObject({ investedInr: 7500, costSource: 'BROKER' })
  })

  it('keeps the price on later statements, scales it to new units, and lets a typed price win', async () => {
    const r = await importFile('zerodha.xlsx', zerodhaEquity())
    persistBundle(db, {
      personId: 1,
      kind: 'CAS_PDF',
      fileName: 'oct.pdf',
      bundle: mapCasJson(cas('31-Oct-2026', '12'))
    })
    expect(row('INE040A01034')).toMatchObject({ quantity: 12, investedInr: 1450.5 * 12 })

    const h = row('INE040A01034')
    await svc.setBuyPrice({ personId: 1, accountId: h.accountId, instrumentId: h.instrumentId, avgCost: 1500 })
    expect(row('INE040A01034')).toMatchObject({ avgCost: 1500, costSource: 'MANUAL' })
    await svc.setBuyPrice({ personId: 1, accountId: h.accountId, instrumentId: h.instrumentId, avgCost: null })
    expect(row('INE040A01034').costSource).toBe('BROKER')

    svc.undoImport(r.batchId)
    expect(row('INE040A01034').investedInr).toBeNull()
  })
})
