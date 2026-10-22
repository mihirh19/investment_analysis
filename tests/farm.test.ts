import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toQuintals } from '../src/shared/farm'
import { openDatabase, schema, type Db } from '../src/main/db'
import { cropPrice, deleteSeason, farmHoldings, farmReport, mandiKey, newlyReachedTargets, saveEntry, saveSeason, setPriceTarget } from '../src/main/farm'
import { listHoldings } from '../src/main/portfolio/holdings'

describe('the farm', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-farm-'))
    const o = openDatabase(join(dir, 't.db'), '5'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const price = (crop: 'GROUNDNUT' | 'WHEAT', date: string, modal: number, market = 'Rajkot') =>
    db.insert(schema.priceHistory).values({ key: mandiKey(crop, market), date, close: modal }).run()

  it('keeps a season’s costs, harvest and sales, and values what is left at the mandi price', () => {
    const s = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', season: 'KHARIF', year: 2026, areaAcres: 10, expectedQtl: 120, status: 'GROWING' })
    saveEntry(db, { seasonId: s, date: '2026-06-20', type: 'COST', costKind: 'SEED', quantityQtl: null, rate: null, amount: 60000, charges: null, mandi: null, note: null })
    saveEntry(db, { seasonId: s, date: '2026-07-10', type: 'COST', costKind: 'FERTILISER', quantityQtl: null, rate: null, amount: 30000, charges: null, mandi: null, note: null })
    price('GROUNDNUT', '2026-10-15', 6800)
    price('GROUNDNUT', '2026-10-21', 7000)

    // Still in the field: shown at the expected yield, but not part of net worth.
    let r = farmReport(db, undefined, '2026-10-22')
    expect(r.growing).toMatchObject([{ crop: 'GROUNDNUT', expectedQtl: 120, expectedValue: 840000 }])
    expect(r.stock).toEqual([])
    expect(farmHoldings(db)).toEqual([])

    // Quantities can be typed in man (20 kg): 150 man is 3,000 kg, 30 quintals.
    expect(toQuintals(150, 'MAN')).toBe(30)
    saveEntry(db, { seasonId: s, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 100, rate: null, amount: 0, charges: null, mandi: null, note: null })
    saveEntry(db, { seasonId: s, date: '2026-10-21', type: 'SALE', costKind: null, quantityQtl: 40, rate: 7100, amount: 0, charges: 2400, mandi: 'Rajkot', note: null })
    expect(() =>
      saveEntry(db, { seasonId: s, date: '2026-10-21', type: 'SALE', costKind: null, quantityQtl: 70, rate: 7100, amount: 0, charges: null, mandi: null, note: null })
    ).toThrow(/Only 60 quintals/)

    r = farmReport(db, undefined, '2026-10-22')
    const v = r.seasons[0]
    expect(v).toMatchObject({ status: 'HARVESTED', costs: 90000, harvestedQtl: 100, soldQtl: 40, inStockQtl: 60, costPerQtl: 900, salesNet: 281600, stockValue: 420000, price: 7000 })
    // Sales after charges + what is left at today's price − costs.
    expect(v.profit).toBe(281600 + 420000 - 90000)
    expect(v.profitPerAcre).toBe(61160)
    expect(r.stock).toMatchObject([{ personId: 2, crop: 'GROUNDNUT', quantityQtl: 60, price: 7000, priceDate: '2026-10-21', value: 420000, cost: 54000 }])
    expect(r.thisFy).toMatchObject({ fy: 'FY27', sales: 281600, costs: 90000 })

    // In net worth, as farm produce, for Dad only.
    const rows = listHoldings(db).filter((h) => h.assetClass === 'AGRI')
    expect(rows).toMatchObject([{ personId: 2, quantity: 60, lastPrice: 7000, marketValueInr: 420000, investedInr: 54000, unrealizedPnlInr: 366000 }])
    expect(listHoldings(db, 1).filter((h) => h.assetClass === 'AGRI')).toEqual([])
    // Asking twice doesn't make a second account.
    listHoldings(db)
    expect(db.select().from(schema.accounts).all().filter((a) => a.kind === 'FARM')).toHaveLength(1)

    // Selling the rest closes the season.
    saveEntry(db, { seasonId: s, date: '2026-10-22', type: 'SALE', costKind: null, quantityQtl: 60, rate: 7000, amount: 0, charges: null, mandi: null, note: null })
    expect(farmReport(db).seasons[0].status).toBe('CLOSED')
    expect(listHoldings(db).filter((h) => h.assetClass === 'AGRI')).toEqual([])

    deleteSeason(db, s)
    expect(farmReport(db).seasons).toEqual([])
    expect(db.select().from(schema.farmEntries).all()).toEqual([])
  })

  it('compares today’s price with the last months, a year ago, MSP and a target', () => {
    price('WHEAT', '2025-10-20', 2500)
    price('WHEAT', '2026-07-01', 2600)
    price('WHEAT', '2026-10-01', 2700)
    price('WHEAT', '2026-10-21', 2900)
    setPriceTarget(db, 'WHEAT', 2850)
    const p = cropPrice(db, 'WHEAT', 'Rajkot', '2026-10-22')
    expect(p.latest).toMatchObject({ date: '2026-10-21', modal: 2900 })
    expect(p.avg30).toBe(2800)
    expect(p.yearAgo).toBe(2500)
    expect(p.targetReached).toBe(true)
    // A target shows the crop's price even with no season recorded.
    expect(farmReport(db, undefined, '2026-10-22').prices.map((x) => x.crop)).toEqual(['WHEAT'])
    setPriceTarget(db, 'WHEAT', null)
    expect(cropPrice(db, 'WHEAT', 'Rajkot', '2026-10-22').target).toBeNull()
  })

  it('says once when a price reaches its target, and again only after it fell back and returned', () => {
    setPriceTarget(db, 'GROUNDNUT', 7500)
    price('GROUNDNUT', '2026-10-20', 7400)
    expect(newlyReachedTargets(db)).toEqual([])
    price('GROUNDNUT', '2026-10-21', 7600)
    expect(newlyReachedTargets(db)).toEqual([{ crop: 'GROUNDNUT', price: 7600, target: 7500, market: 'Rajkot' }])
    expect(newlyReachedTargets(db)).toEqual([])
    price('GROUNDNUT', '2026-10-22', 7450)
    expect(newlyReachedTargets(db)).toEqual([])
    price('GROUNDNUT', '2026-10-23', 7550)
    expect(newlyReachedTargets(db)).toHaveLength(1)
  })

  it('checks what is typed', () => {
    expect(() => saveSeason(db, { personId: 1, crop: 'GROUNDNUT', season: 'KHARIF', year: 26, status: 'GROWING' })).toThrow(/harvest year/)
    const s = saveSeason(db, { personId: 1, crop: 'WHEAT', season: 'RABI', year: 2027, status: 'GROWING' })
    expect(() => saveEntry(db, { seasonId: s, date: '2026-12-01', type: 'COST', costKind: null, quantityQtl: null, rate: null, amount: 500, charges: null, mandi: null, note: null })).toThrow(/what the cost was for/)
    expect(() => saveEntry(db, { seasonId: s, date: '2026-12-01', type: 'HARVEST', costKind: null, quantityQtl: 0, rate: null, amount: 0, charges: null, mandi: null, note: null })).toThrow(/how much/)
  })
})
