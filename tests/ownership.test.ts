import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { parseShpList, parseShpXbrl } from '../src/main/research/nse'
import { ownershipReport, ownershipView, saveShpDetail, saveShpList, shpDetailWanted, shpStale, markShpChecked } from '../src/main/research/store'
import { OWNER_GROUPS } from '../src/shared/research'

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'nse', f), 'utf8')

describe('shareholding patterns', () => {
  it('reads the list of filings', () => {
    const r = parseShpList(JSON.parse(fx('shp-list-tcs.json')))
    expect(r).toHaveLength(6)
    expect(r[0]).toEqual({
      symbol: 'TCS',
      asOf: '2026-09-30',
      promoter: 0.7177,
      url: 'https://nsearchives.nseindia.com/corporate/xbrl/SHP_1741905_19102026063741_WEB.xml',
      filedAt: '2026-10-19'
    })
    expect(parseShpList(JSON.parse(fx('shp-window.json')))).toHaveLength(25)
  })

  it('reads who owns the company from the XBRL pattern', () => {
    const x = parseShpXbrl(fx('shp-tcs.xml'))!
    expect(x.asOf).toBe('2026-09-30')
    expect(x.groups).toMatchObject({ promoter: 0.7177, fpi: 0.0901, mf: 0.0565, insurance: 0.068, retail: 0.0467, hni: 0.0023, corporate: 0.0026 })
    expect(x.groups.otherDii).toBeCloseTo(0.1357 - 0.0565 - 0.068, 6)
    expect(OWNER_GROUPS.reduce((s, g) => s + x.groups[g], 0)).toBeCloseTo(1, 4)
    expect(x.shareholders).toBe(2579099)
    expect(x.holders.map((h) => [h.name, h.kind, h.share])).toEqual([
      ['Tata Sons Private Limited', 'Promoter', 0.7174],
      ['LIC of India', 'Insurance', 0.0565],
      ['Sbi Nifty 50 Etf', 'Mutual fund', 0.0129]
    ])
    expect(parseShpXbrl('<xml/>')).toBeNull()
  })

  it('stores patterns and reports quarter-on-quarter changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-shp-'))
    const o = openDatabase(join(dir, 't.db'), '5'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      db.insert(schema.nseListings).values({ symbol: 'TCS', name: 'Tata Consultancy Services', isin: 'INE467B01029', kind: 'EQ', updatedAt: '2026-10-25' }).run()
      db.insert(schema.watchlists).values({ name: 'W', symbolsJson: JSON.stringify(['TCS']) }).run()
      expect(shpStale(db, ['TCS'])).toEqual(['TCS'])
      saveShpList(db, parseShpList(JSON.parse(fx('shp-list-tcs.json'))))
      markShpChecked(db, 'TCS')
      expect(shpStale(db, ['TCS'])).toEqual([])
      const wanted = shpDetailWanted(db, ['TCS'])
      expect(wanted.map((w) => w.asOf)).toEqual(['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30'])
      expect(ownershipView(db, 'tcs').waiting).toBe(true)

      const x = parseShpXbrl(fx('shp-tcs.xml'))!
      saveShpDetail(db, 'TCS', '2026-09-30', x, 1)
      // The quarter before, with foreign investors a point higher and funds a point lower.
      saveShpDetail(db, 'TCS', '2026-06-30', { ...x, asOf: '2026-06-30', groups: { ...x.groups, fpi: x.groups.fpi + 0.01, mf: x.groups.mf - 0.01 } }, 1)
      // A file that couldn't be read is tried again, but not forever.
      for (const w of wanted.slice(2)) saveShpDetail(db, 'TCS', w.asOf, null, 3)
      expect(shpDetailWanted(db, ['TCS'])).toEqual([])

      const v = ownershipView(db, 'TCS')
      expect(v.waiting).toBe(false)
      expect(v.quarters[0]).toMatchObject({ asOf: '2026-09-30', promoter: 0.7177, shareholders: 2579099 })
      expect(v.quarters[0].holders?.[0].name).toBe('Tata Sons Private Limited')
      expect(v.quarters[2].groups).toBeNull()

      const r = ownershipReport(db, '2026-10-25')
      expect(r.mine).toHaveLength(1)
      expect(r.mine[0]).toMatchObject({ symbol: 'TCS', company: 'Tata Consultancy Services', asOf: '2026-09-30', prevAsOf: '2026-06-30', watched: true, held: null })
      expect(r.mine[0].fpiChange).toBeCloseTo(-0.01)
      expect(r.mine[0].mfChange).toBeCloseTo(0.01)
      expect(r.mine[0].promoterChange).toBeCloseTo(0)
      // Promoters unchanged: not a market-wide move.
      expect(r.promoterMoves).toEqual([])

      saveShpList(db, [
        { symbol: 'ABC', asOf: '2026-06-30', promoter: 0.6, url: null, filedAt: '2026-07-20' },
        { symbol: 'ABC', asOf: '2026-09-30', promoter: 0.55, url: null, filedAt: '2026-10-20' },
        { symbol: 'OLD', asOf: '2026-06-30', promoter: 0.5, url: null, filedAt: '2026-07-10' },
        { symbol: 'OLD', asOf: '2026-03-31', promoter: 0.4, url: null, filedAt: '2026-04-10' }
      ])
      const moves = ownershipReport(db, '2026-10-25').promoterMoves
      expect(moves.map((m) => m.symbol)).toEqual(['ABC'])
      expect(moves[0].promoterChange).toBeCloseTo(-0.05)
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// FP_LIVE=1: one company's patterns from the real NSE, slowly.
describe.skipIf(!process.env.FP_LIVE)('live ownership', () => {
  it('fetches TCS', { timeout: 240_000 }, async () => {
    const { ResearchSync } = await import('../src/main/research/sync')
    const dir = mkdtempSync(join(tmpdir(), 'fp-shp-live-'))
    const o = openDatabase(join(dir, 't.db'), '4'.repeat(64), resolve('drizzle'))
    try {
      const sync = new ResearchSync(o.db, () => {}, fetch, 1000)
      sync.openOwnership('TCS')
      for (let i = 0; i < 200 && ownershipView(o.db, 'TCS').waiting; i++) await new Promise((r) => setTimeout(r, 1000))
      const v = ownershipView(o.db, 'TCS')
      console.log(JSON.stringify({ err: sync.status().lastError, n: v.quarters.length, detailed: v.quarters.filter((q) => q.groups).map((q) => [q.asOf, q.groups?.fpi, q.groups?.mf]) }))
      expect(v.waiting).toBe(false)
      expect(v.quarters.length).toBeGreaterThan(8)
      expect(v.quarters.filter((q) => q.groups).length).toBe(5)
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
