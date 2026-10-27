import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { parseSymbolData } from '../src/main/research/nse'
import { industryMap, industryWanted, saveIndustry, screenData } from '../src/main/research/store'
import { NO_FUNDAMENTALS, NO_TECHNICALS, type ScreenRow } from '../src/shared/screener'
import { groupRows, rowsUnder, type IndustryClass } from '../src/shared/sectors'

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'nse', f), 'utf8'))

describe('NSE classification', () => {
  it('reads a company’s sector and industry', () => {
    expect(parseSymbolData(fx('symbol-data-tcs.json'))).toMatchObject({
      symbol: 'TCS',
      macro: 'Information Technology',
      sector: 'Information Technology',
      industry: 'IT - Software',
      basicIndustry: 'Computers - Software & Consulting',
      sectorIndex: 'NIFTY IT',
      sectorPe: 16.52,
      symbolPe: 17.49,
      listedOn: '2004-08-25'
    })
    expect(parseSymbolData(fx('symbol-data-tcs.json'))!.indices).toContain('NIFTY 50')
    expect(parseSymbolData({})).toBeNull()
  })

  it('adds the market up by sector, industry and basic industry', () => {
    const row = (symbol: string, mcap: number, change: number, pe: number | null, held = false): ScreenRow =>
      ({ ...NO_FUNDAMENTALS, ...NO_TECHNICALS, symbol, name: symbol, industry: null, held, close: 1, change, mcap, pe, pb: null, earningsYield: null, dividendYield: null, fromHigh: null, toGraham: null, ret1y: change * 10 }) as ScreenRow
    const rows = [row('A', 300, 0.01, 20, true), row('B', 100, -0.03, 30), row('C', 50, 0.02, null), row('D', 10, 0.05, 10)]
    const cls = (symbol: string, sector: string, industry: string, basicIndustry: string): IndustryClass => ({ symbol, macro: sector, sector, industry, basicIndustry })
    const classOf = new Map([cls('A', 'IT', 'Software', 'Consulting'), cls('B', 'IT', 'Software', 'Products'), cls('C', 'IT', 'Hardware', 'Chips'), cls('D', 'Banks', 'Banks', 'Private')].map((c) => [c.symbol, c]))
    const sectors = groupRows(rows, classOf, 'sector')
    expect(sectors.map((s) => s.name)).toEqual(['IT', 'Banks'])
    const it0 = sectors[0]
    expect(it0).toMatchObject({ companies: 3, held: 1, mcap: 450, medianPe: 25, leaders: ['A', 'B', 'C'] })
    expect(it0.change).toBeCloseTo((300 * 0.01 - 100 * 0.03 + 50 * 0.02) / 450)
    expect(it0.breadth).toBeCloseTo(2 / 3)
    const software = rowsUnder(rows, classOf, ['IT', 'Software'])
    expect(software.map((r) => r.symbol)).toEqual(['A', 'B'])
    expect(groupRows(software, classOf, 'basicIndustry').map((g) => g.name)).toEqual(['Consulting', 'Products'])
  })

  it('classifies held and watched companies first, then the biggest, and fills the screener', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-ind-'))
    const o = openDatabase(join(dir, 't.db'), '3'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      const at = '2026-10-25'
      db.insert(schema.nseListings).values([
        { isin: 'I1', symbol: 'BIG', name: 'Big', kind: 'EQ', updatedAt: at },
        { isin: 'I2', symbol: 'SMALL', name: 'Small', kind: 'EQ', updatedAt: at },
        { isin: 'I3', symbol: 'MINE', name: 'Mine', kind: 'EQ', updatedAt: at }
      ]).run()
      const quote = (symbol: string, mcap: number) => ({ symbol, date: at, close: 10, mcap, open: null, high: null, low: null, prevClose: 10, high52: null, low52: null, volume: null, pe: null })
      db.insert(schema.researchQuotes).values([quote('BIG', 1e12), quote('SMALL', 1e9), quote('MINE', 1e8)] as never).run()
      db.insert(schema.watchlists).values({ name: 'W', symbolsJson: JSON.stringify(['MINE']) }).run()
      expect(industryWanted(db, 5)).toEqual(['MINE', 'BIG', 'SMALL'])
      saveIndustry(db, 'MINE', parseSymbolData(fx('symbol-data-tcs.json')))
      saveIndustry(db, 'BIG', null)
      expect(industryWanted(db, 5)).toEqual(['SMALL'])
      expect(industryMap(db)).toMatchObject({ companies: 3, classified: 1 })
      expect(screenData(db).rows.find((r) => r.symbol === 'MINE')?.industry).toBe('Information Technology')
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
