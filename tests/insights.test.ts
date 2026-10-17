import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SchemeFacts } from '../src/shared/insights'
import { openDatabase, schema, type Db } from '../src/main/db'
import { factsFor } from '../src/main/market/amfiData'
import { marketSectorWeights, statsFrom } from '../src/main/market/sectorIndices'
import { benchmarkKey, productsFor } from '../src/main/portfolio/insights'

const scheme = (name: string, over: Partial<SchemeFacts> = {}): SchemeFacts => ({
  name,
  category: 'Index Funds ETFs',
  categoryGroup: 'Other',
  benchmark: 'Nifty Bank TRI',
  risk: 'Very High',
  aumCr: 100,
  navDate: '15-Oct-2026',
  r1y: { regular: -1.5, direct: -1.2, benchmark: -1.0 },
  r3y: { regular: 8, direct: 8.4, benchmark: 8.6 },
  r5y: { regular: null, direct: null, benchmark: null },
  r10y: { regular: null, direct: null, benchmark: null },
  terRegular: 0.8,
  terDirect: 0.2,
  ...over
})

describe('matching funds to indices', () => {
  it('reads NSE short names and AMFI benchmark names alike', () => {
    expect(benchmarkKey('Nifty Bank TRI')).toBe('nifty bank')
    expect(benchmarkKey('NIFTY BANK')).toBe('nifty bank')
    expect(benchmarkKey('Nifty Private Bank TRI')).toBe(benchmarkKey('NIFTY PVT BANK'))
    expect(benchmarkKey('Nifty Financial Services TRI')).toBe(benchmarkKey('Nifty Financial Services'))
    expect(benchmarkKey('Nifty Oil & Gas TRI')).toBe(benchmarkKey('Nifty Oil & Gas'))
    expect(benchmarkKey('Nifty India Defence Index TRI')).toBe(benchmarkKey('Nifty India Defence'))
  })

  it('lists the funds and ETFs on a sector’s index, largest first, priced on the plan one would hold', () => {
    const list = productsFor(
      [
        scheme('Small Bank Index Fund', { aumCr: 50 }),
        scheme('Big Nifty Bank ETF', { aumCr: 8000, terRegular: 0.15, terDirect: null }),
        scheme('Banking & PSU Debt Fund', { category: 'Banking and PSU Fund', benchmark: 'Nifty Banking & PSU Debt Index' }),
        scheme('Private Bank ETF', { benchmark: 'Nifty Private Bank TRI' }),
        scheme('Active Banking Fund', { category: 'Sectoral/Thematic', aumCr: 3000 })
      ],
      ['Nifty Bank']
    )
    expect(list.map((p) => [p.name, p.kind])).toEqual([
      ['Big Nifty Bank ETF', 'ETF'],
      ['Active Banking Fund', 'ACTIVE'],
      ['Small Bank Index Fund', 'INDEX_FUND']
    ])
    // ETF: its single (Regular) figures; a fund: its Direct plan.
    expect(list[0]).toMatchObject({ ter: 0.15, r1y: -1.5 })
    expect(list[2]).toMatchObject({ ter: 0.2, r1y: -1.2 })
    expect(list[2].vsBenchmark1y).toBeCloseTo(-0.2, 9)
  })

  it('finds a held fund in AMFI’s list despite plan words', () => {
    const list = [scheme('Parag Parikh Flexi Cap Fund'), scheme('Parag Parikh Tax Saver Fund')]
    expect(factsFor(list, 'PARAG PARIKH FLEXI CAP FUND - DIRECT PLAN - GROWTH')?.name).toBe('Parag Parikh Flexi Cap Fund')
    expect(factsFor(list, 'Some Other Fund')).toBeNull()
  })
})

describe('a sector index’s record', () => {
  it('works out returns, the 52-week range and P/E against its own history', () => {
    const day = (y: number, m: number, d = 15) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const prices = [
      { date: day(2021, 10), close: 100 },
      { date: day(2023, 10), close: 120 },
      { date: day(2025, 10), close: 150 },
      { date: day(2026, 3), close: 180 },
      { date: day(2026, 10), close: 165 }
    ]
    const vals = [10, 12, 14, 16, 18, 20, 22, 24, 26, 13].map((pe, i) => ({ date: day(2017 + i, 6), pe, pb: 2, dy: 1 }))
    const s = statsFrom('NIFTY X', 'Nifty X', prices, vals)!
    expect(s.r1y).toBeCloseTo((165 / 150 - 1) * 100, 6)
    expect(s.r3y).toBeCloseTo(((165 / 120) ** (1 / 3) - 1) * 100, 6)
    expect(s.r5y).toBeCloseTo(((165 / 100) ** (1 / 5) - 1) * 100, 6)
    expect([s.high52w, s.low52w]).toEqual([180, 165])
    expect(s.belowHigh).toBeCloseTo(1 - 165 / 180, 9)
    expect(s.pe).toBe(13)
    expect(s.peMedian10y).toBe(18)
    expect(s.pePercentile).toBeCloseTo(0.2, 9) // above 10 and 12 only
    // A history too short for five years gives no five-year figure.
    expect(statsFrom('Y', 'Y', prices.slice(2), vals)!.r5y).toBeNull()
  })
})

describe('the market’s sector weights', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-ins-'))
    const o = openDatabase(join(dir, 't.db'), 'b'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('weights each industry by market value', () => {
    const members = [
      { isin: 'INE000000001', industry: 'Financial Services' },
      { isin: 'INE000000002', industry: 'Financial Services' },
      { isin: 'INE000000003', industry: 'Information Technology' },
      { isin: 'INE000000004', industry: 'Realty' } // no market cap known: left out
    ]
    db.insert(schema.settings).values({ key: 'sectors:nifty500', value: JSON.stringify({ at: '2026-10-01', members }) }).run()
    for (const [isin, cap] of [
      ['INE000000001', 300],
      ['INE000000002', 100],
      ['INE000000003', 600]
    ] as const)
      db.insert(schema.marketCaps).values({ isin, name: isin, category: 'LARGE', rank: 1, avgCapCr: cap, period: '2026-06-30', updatedAt: 'x' }).run()
    const w = marketSectorWeights(db)!
    expect(w.weights.get('Financial Services')).toBeCloseTo(0.4, 9)
    expect(w.weights.get('Information Technology')).toBeCloseTo(0.6, 9)
    expect(w.weights.has('Realty')).toBe(false)
    expect(w.capPeriod).toBe('2026-06-30')
  })
})
