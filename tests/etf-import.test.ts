import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { isEtfName, reclassifyDemat, tidyListedNames } from '../src/main/importers/isin'
import { createServices } from '../src/main/services'

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
          name: 'AFTER SUB-DIVISION GRASIM INDUSTRIES LIMITED # NEW EQ SH WITH FV RE 2/-',
          isin: 'INE047A01021',
          num_shares: '5',
          price: '2500',
          value: '12500',
          symbol: null,
          exchange: null
        }
      ],
      // CDSL lists demat ETF units with the account's mutual funds.
      mutual_funds: [
        {
          name: 'NIPPON LIFE INDIA AM LTD#NIPPON INDIA MF-NIPPON INDIA ETF NIFTY 50 BEES',
          isin: 'INF204KB14I2',
          amfi: null,
          type: null,
          balance: '10',
          nav: '250',
          value: '2500',
          total_cost: null,
          folio: null
        },
        {
          name: 'ICICI PRUDENTIAL NIFTY 50 ETF FOF - DIRECT GROWTH',
          isin: 'INF109KC1Q72',
          amfi: null,
          type: null,
          balance: '10',
          nav: '20',
          value: '200',
          total_cost: null,
          folio: null
        }
      ]
    }
  ],
  nps: null
}

describe('ETF units a statement files as mutual funds', () => {
  it('knows an ETF by name, but not a fund of funds that buys ETFs', () => {
    expect(isEtfName('NIPPON INDIA ETF NIFTY 50 BEES')).toBe(true)
    expect(isEtfName('MOTILAL OSWAL NIFTY MIDCAP 100 ETF')).toBe(true)
    expect(isEtfName('ICICI PRUDENTIAL NIFTY 50 ETF FOF - DIRECT GROWTH')).toBe(false)
    expect(isEtfName('Parag Parikh Flexi Cap Fund')).toBe(false)
  })
})

describe('importing a statement', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-etf-'))
    const o = openDatabase(join(dir, 't.db'), 'f'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })
  const classOf = (isin: string) =>
    db
      .select()
      .from(schema.instruments)
      .all()
      .find((i) => i.isin === isin)!

  it('records demat ETFs as ETFs, and fixes ones an older version recorded as funds', () => {
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'mar.pdf', bundle: mapCasJson(cas) })
    expect(classOf('INF204KB14I2').assetClass).toBe('ETF')
    expect(classOf('INF109KC1Q72').assetClass).toBe('MF')

    db.update(schema.instruments).set({ assetClass: 'MF' }).run()
    reclassifyDemat(db)
    expect(classOf('INF204KB14I2').assetClass).toBe('ETF')
  })

  it('shows NSE’s plain company name and the AMFI scheme name instead of statement notes', () => {
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'mar.pdf', bundle: mapCasJson(cas) })
    db.insert(schema.nseListings)
      .values({ isin: 'INE047A01021', symbol: 'GRASIM', name: 'Grasim Industries Limited', kind: 'EQ', updatedAt: 'x' })
      .run()
    db.update(schema.instruments).set({ schemeName: 'Nippon India ETF Nifty 50 BeES' }).run()
    tidyListedNames(db)
    expect(classOf('INE047A01021').name).toBe('Grasim Industries Limited')
    expect(classOf('INF204KB14I2').name).toBe('Nippon India ETF Nifty 50 BeES')
    // A clean name is left alone.
    expect(classOf('INF109KC1Q72').name).toBe('ICICI PRUDENTIAL NIFTY 50 ETF FOF - DIRECT GROWTH')
  })

  it('fetches prices and NAVs straight after an import', async () => {
    let refreshes = 0
    const market = { getStatus: () => ({}), refresh: async () => void refreshes++ }
    const svc = createServices({
      db,
      casparserExe: '',
      encrypt: (s) => s,
      decrypt: (s) => s,
      market: market as never
    })
    const file = join(dir, 'trades.csv')
    writeFileSync(
      file,
      'date,type,symbol,name,isin,quantity,price,fees,currency,market\n2026-03-15,BUY,AAPL,Apple Inc,,1,170,0,USD,US\n'
    )
    await svc.runImport({ kind: 'GENERIC_TRADES', personId: 1, filePath: file, platform: 'INDMONEY' })
    expect(refreshes).toBe(1)
  })
})
