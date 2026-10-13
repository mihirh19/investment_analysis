import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { dematClass, isInvit, reclassifyDemat } from '../src/main/importers/isin'
import { MarketData } from '../src/main/market/refresh'
import { listHoldings } from '../src/main/portfolio/holdings'
import { computeExposure } from '../src/main/portfolio/exposure'

describe('what a demat holding is, from its ISIN', () => {
  it('tells shares, ETFs, government paper, NCDs, REITs and InvITs apart', () => {
    expect(dematClass('INE040A01034', 'HDFC BANK LIMITED')).toBe('EQUITY_IN')
    expect(dematClass('INF204KB14I2', 'NIPPON INDIA ETF NIFTY 50 BEES')).toBe('ETF')
    expect(dematClass('IN0020060078', 'GOVT OF INDIA-10.18% GOI 2026-LOAN CODE 01010-RED DT 11.09.2026')).toBe('BOND')
    expect(dematClass('IN1520160087', 'SDL TAMIL NADU 2026')).toBe('BOND')
    expect(dematClass('IN0020200252', 'SGB 2.50% 2028 SR-VIII')).toBe('GOLD')
    expect(dematClass('INE0CCU25019', 'MINDSPACE BUSINESS PARKS REAL ESTATE INVESTMENT TRUST#REIT-PERPETUAL')).toBe(
      'REIT'
    )
    expect(dematClass('INE219X23014', 'INDIA GRID TRUST')).toBe('REIT')
    expect(dematClass('INE549K07CB4', 'MML 9.00 28022027')).toBe('BOND')
    expect(dematClass('INE00ZZ01017', '!! ORBIS FINANCIAL CORPORATION LIMITED # EQUITY SHARES')).toBe('EQUITY_IN')
  })

  it('knows an InvIT from a REIT', () => {
    expect(isInvit('INE219X23014', 'INDIA GRID TRUST')).toBe(true)
    expect(isInvit('INE0CCU25019', 'MINDSPACE BUSINESS PARKS REIT')).toBe(false)
  })
})

describe('holdings imported as shares by older versions', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-isin-'))
    const o = openDatabase(join(dir, 't.db'), '7'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const row = (name: string, isin: string, value: string) => ({
    name,
    isin,
    num_shares: '10',
    price: String(Number(value) / 10),
    value,
    symbol: null,
    exchange: null
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
          row('HDFC BANK LIMITED', 'INE040A01034', '20000'),
          row('GOVT OF INDIA-10.18% GOI 2026-LOAN CODE 01010', 'IN0020060078', '10000'),
          row('MINDSPACE BUSINESS PARKS REAL ESTATE INVESTMENT TRUST#REIT-PERPETUAL', 'INE0CCU25019', '3450'),
          row('MML 9.00 28022027', 'INE549K07CB4', '10000')
        ],
        mutual_funds: []
      }
    ],
    nps: null
  }

  const classes = () =>
    Object.fromEntries(
      db
        .select()
        .from(schema.instruments)
        .all()
        .map((i) => [i.isin, i.assetClass])
    )

  it('are imported with the right class now', () => {
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'c.pdf', bundle: mapCasJson(cas) })
    expect(classes()).toEqual({
      INE040A01034: 'EQUITY_IN',
      IN0020060078: 'BOND',
      INE0CCU25019: 'REIT',
      INE549K07CB4: 'BOND'
    })
  })

  it('are corrected on start, and count as debt and property in the asset mix', () => {
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'c.pdf', bundle: mapCasJson(cas) })
    // As an older version stored them.
    db.update(schema.instruments).set({ assetClass: 'EQUITY_IN', metaUpdatedAt: '2026-10-01T00:00:00Z' }).run()
    expect(reclassifyDemat(db)).toBe(3)
    expect(classes().INE0CCU25019).toBe('REIT')
    expect(
      db.select().from(schema.instruments).where(eq(schema.instruments.isin, 'INE0CCU25019')).get()!.metaUpdatedAt
    ).toBeNull()
    expect(reclassifyDemat(db)).toBe(0)

    const mix = Object.fromEntries(computeExposure(db).assetMix.map((m) => [m.type, m.valueInr]))
    expect(mix.DEBT).toBe(20000)
    expect(mix.REAL_ESTATE).toBe(3450)
    expect(mix.EQUITY).toBe(20000)
  })

  it('prices a REIT from the listing Yahoo still updates (MINDSPACE.NS stopped in 2024, .BO is live)', async () => {
    persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'c.pdf', bundle: mapCasJson(cas) })
    const chart = (price: number, time: number) =>
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: { currency: 'INR', regularMarketPrice: price, chartPreviousClose: price, regularMarketTime: time }
              }
            ],
            error: null
          }
        })
      )
    const now = Math.floor(Date.now() / 1000)
    const f = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/search?q=INE0CCU25019'))
        return new Response(JSON.stringify({ quotes: [{ symbol: 'MINDSPACE.BO' }] }))
      if (url.includes('/chart/MINDSPACE.NS')) return chart(345.06, 1721764800) // July 2024
      if (url.includes('/chart/MINDSPACE.BO')) return chart(492.88, now - 3600)
      if (url.includes('/chart/HDFCBANK.NS')) return chart(707.25, now - 3600)
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    await new MarketData(db, () => {}, f).refresh({ quotes: true })
    const reit = listHoldings(db).find((h) => h.isin === 'INE0CCU25019')!
    expect([reit.lastPrice, reit.priceSource]).toEqual([492.88, 'LIVE'])
    expect(
      db.select().from(schema.instruments).where(eq(schema.instruments.isin, 'INE0CCU25019')).get()!.yahooSymbol
    ).toBe('MINDSPACE.BO')
  })
})
