import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { buildXray } from '../src/main/portfolio/xray'
import { parseCorporateActions, parseEventCalendar } from '../src/main/research/nse'
import { calendarReport, saveActions, saveEvents } from '../src/main/research/store'
import type { HoldingRow } from '../src/shared/types'

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'nse', f), 'utf8'))

type FundRow = typeof schema.fundHoldings.$inferSelect
const row = (o: Partial<HoldingRow>): HoldingRow => ({ instrumentId: 1, instrumentName: '', isin: null, assetClass: 'EQUITY_IN', marketValueInr: 0, sector: null, ...o }) as HoldingRow
const fundRow = (fund: number, isin: string | null, name: string, weight: number, assetType: FundRow['assetType'] = 'EQUITY'): FundRow =>
  ({ id: 0, fundInstrumentId: fund, asOf: '2026-09-30', source: 'test', name, isin, sector: null, industryRaw: null, assetType, country: 'IN', weight, importBatchId: null })

describe('portfolio X-ray', () => {
  const rows = [
    row({ instrumentId: 1, instrumentName: 'HDFC Bank', isin: 'INE040A01034', marketValueInr: 50_000, sector: 'Financials' }),
    // The same shares in a second account count with the first.
    row({ instrumentId: 1, instrumentName: 'HDFC Bank', isin: 'INE040A01034', marketValueInr: 10_000, sector: 'Financials' }),
    row({ instrumentId: 10, instrumentName: 'Flexi Cap Fund', assetClass: 'MF', marketValueInr: 100_000 }),
    row({ instrumentId: 11, instrumentName: 'Large Cap Fund', assetClass: 'MF', marketValueInr: 100_000 }),
    row({ instrumentId: 12, instrumentName: 'Small Cap Fund', assetClass: 'MF', marketValueInr: 40_000 }),
    row({ instrumentId: 13, instrumentName: 'Liquid Fund', assetClass: 'MF', marketValueInr: 30_000 })
  ]
  const funds = new Map<number, FundRow[]>([
    [10, [fundRow(10, 'INE040A01034', 'HDFC Bank Ltd', 0.5), fundRow(10, 'INE009A01021', 'Infosys Ltd', 0.4), fundRow(10, null, 'TREPS', 0.1, 'CASH')]],
    [11, [fundRow(11, 'INE040A01034', 'HDFC Bank Ltd', 0.3), fundRow(11, 'INE009A01021', 'Infosys Ltd', 0.7)]]
  ])
  const x = buildXray(rows, funds)

  it('adds a company up across shares and funds', () => {
    const hdfc = x.companies.find((c) => c.isin === 'INE040A01034')!
    expect(hdfc.valueInr).toBeCloseTo(60_000 + 50_000 + 30_000)
    expect(hdfc.directInr).toBe(60_000)
    expect(hdfc.via.map((v) => [v.instrumentId, Math.round(v.valueInr)])).toEqual([[10, 50_000], [11, 30_000]])
    expect(hdfc.sector).toBe('Financials')
    expect(x.companies[0].isin).toBe('INE040A01034')
    expect(x.equityInr).toBeCloseTo(140_000 + 110_000)
    expect(x.repeated.map((r) => [r.isin, r.ways])).toEqual([['INE040A01034', 3]])
  })

  it('measures concentration and fund overlap', () => {
    const a = 140_000 / 250_000
    const b = 110_000 / 250_000
    expect(x.concentration.hhi).toBeCloseTo(a * a + b * b)
    expect(x.concentration.effectiveStocks).toBeCloseTo(1 / (a * a + b * b))
    expect(x.concentration.top5).toBeCloseTo(1)
    expect(x.overlap.funds.map((f) => f.instrumentId)).toEqual([10, 11])
    // min(0.5, 0.3) + min(0.4, 0.7)
    expect(x.overlap.common[0][1]).toBeCloseTo(0.7)
    expect(x.overlap.common[1][0]).toBeCloseTo(0.7)
  })

  it('counts equity funds with no holdings on file, but not debt funds', () => {
    expect(x.unknownInr).toBe(40_000)
  })
})

describe('results and dividends calendar', () => {
  it('reads NSE’s board meetings', () => {
    const r = parseEventCalendar(fx('event-calendar.json'))
    expect(r).toHaveLength(12)
    expect(r[1]).toMatchObject({ symbol: 'RAILTEL', date: '2026-10-25', purpose: 'Financial Results/Dividend' })
  })

  it('reads corporate actions and the rupees a share', () => {
    const r = parseCorporateActions(fx('corporate-actions.json'))
    const by = (s: string) => r.find((a) => a.symbol === s)!
    expect(by('IGL')).toEqual({ symbol: 'IGL', exDate: '2026-10-01', recordDate: '2026-10-01', subject: 'Dividend - Rs 1.50 Per Share', kind: 'DIVIDEND', amount: 1.5 })
    expect(by('NMDC').amount).toBe(1)
    expect(by('MOLDTECH').kind).toBe('BONUS')
    expect(by('BLSE').kind).toBe('SPLIT')
    expect(by('NATCOPHARM')).toMatchObject({ kind: 'RIGHTS', amount: null })
    expect(by('SHARDUL').kind).toBe('BUYBACK')
    expect(by('KMSUGAR').kind).toBe('DEMERGER')
  })

  it('keeps the window around today and flags watched stocks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-cal-'))
    const o = openDatabase(join(dir, 't.db'), '8'.repeat(64), resolve('drizzle'))
    try {
      saveEvents(o.db, parseEventCalendar(fx('event-calendar.json')))
      saveActions(o.db, parseCorporateActions(fx('corporate-actions.json')))
      // Saving twice keeps one row each.
      saveActions(o.db, parseCorporateActions(fx('corporate-actions.json')))
      o.db.insert(schema.watchlists).values({ name: 'W', symbolsJson: JSON.stringify(['TCS']) }).run()
      const c = calendarReport(o.db, '2026-10-20')
      expect(c.results.length).toBe(12)
      expect(c.actions.every((a) => a.exDate >= '2026-09-20')).toBe(true)
      expect(c.actions.filter((a) => a.symbol === 'IGL')).toHaveLength(1)
      const tcs = c.actions.find((a) => a.symbol === 'TCS')!
      expect(tcs).toMatchObject({ watched: true, held: null, expectedInr: null, amount: 12 })
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
