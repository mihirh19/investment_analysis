import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PropertyMeta } from '../src/shared/assets'
import { openDatabase, schema, type Db } from '../src/main/db'
import { saveManualAsset } from '../src/main/manualAssets'
import { joinSeries, quarterEnd, residexKey, sizeBandOf } from '../src/main/market/residex'
import { computeProperties } from '../src/main/portfolio/property'
import { rentMonths } from '../src/main/portfolio/rent'

describe('NHB RESIDEX series', () => {
  it('reads quarter labels and size bands', () => {
    expect(quarterEnd('Jun 2025')).toBe('2025-06-30')
    expect(quarterEnd('Mar 2026')).toBe('2026-03-31')
    expect(sizeBandOf(500)).toBe('LT60') // 46 m²
    expect(sizeBandOf(900)).toBe('60TO110') // 84 m²
    expect(sizeBandOf(1400)).toBe('GT110') // 130 m²
    expect(sizeBandOf(null)).toBe('ALL')
  })

  it('joins the older base-year series to the newer one without a step', () => {
    const row = (q: string, v: number) => ({
      QTR_YEAR: q,
      WTAVG_COMPOSITE: v,
      WTAVG_LESSTHAN60: v,
      WTAVG_60TO110: v,
      WTAVG_GREATER110: v
    })
    const s = joinSeries([row('Mar 2025', 7000), row('Jun 2025', 7200)], [row('Jun 2025', 7524), row('Sep 2025', 7624)])
    expect(s.ALL.map((p) => [p.date, Math.round(p.close)])).toEqual([
      ['2025-03-31', Math.round((7000 * 7524) / 7200)],
      ['2025-06-30', 7524],
      ['2025-09-30', 7624]
    ])
  })
})

describe('rent', () => {
  const m: PropertyMeta = {
    kind: 'PROPERTY',
    name: 'Flat',
    propertyType: 'RESIDENTIAL',
    purchasePrice: 4000000,
    purchaseDate: '2020-01-01',
    tenancies: [
      { id: 't1', tenant: 'Rakesh', startDate: '2026-04-01', endDate: '2027-02-28', monthlyRent: 15000, dueDay: 5 }
    ],
    rentPayments: [
      { id: 'p1', date: '2026-04-05', forMonth: '2026-04', amount: 15000, tenancyId: 't1' },
      { id: 'p2', date: '2026-05-07', forMonth: '2026-05', amount: 15000, tenancyId: 't1' },
      { id: 'p3', date: '2026-06-10', forMonth: '2026-06', amount: 10000, tenancyId: 't1' }
    ]
  }

  it('marks each month paid, part-paid, overdue or due', () => {
    const months = rentMonths(m, '2026-04-01', '2026-08-31', '2026-07-20')
    expect(months.map((x) => [x.month, x.status])).toEqual([
      ['2026-04', 'PAID'],
      ['2026-05', 'PAID'],
      ['2026-06', 'PART'],
      ['2026-07', 'OVERDUE'],
      ['2026-08', 'DUE']
    ])
  })
})

describe('the Property page', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-prop-'))
    const o = openDatabase(join(dir, 't.db'), '3'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
    // Ahmedabad's price per sq ft: 5,000 at the start of 2022, 6,000 a year later, 7,500 in 2026.
    for (const band of ['ALL', '60TO110'] as const)
      for (const [date, close] of [
        ['2021-12-31', 5000],
        ['2022-12-31', 6000],
        ['2026-06-30', 7500]
      ] as const)
        db.insert(schema.priceHistory)
          .values({ key: residexKey(28, band), date, close })
          .run()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const flat = (over: Partial<PropertyMeta> = {}): PropertyMeta => ({
    kind: 'PROPERTY',
    name: 'Flat in Satellite',
    propertyType: 'RESIDENTIAL',
    subtype: 'FLAT',
    purchasePrice: 5000000,
    purchaseDate: '2021-12-31',
    buyingCosts: 300000,
    cityId: 28,
    cityName: 'Ahmedabad',
    carpetAreaSqft: 900,
    ...over
  })

  it('grows the purchase price with the city’s home prices', () => {
    saveManualAsset(db, { personId: 1, meta: flat() })
    const [p] = computeProperties(db, 1, '2026-10-17')
    expect(p.mode).toBe('INDEX')
    expect(p.value).toBeCloseTo(5000000 * (7500 / 5000), 0)
    expect(p.invested).toBe(5300000)
    expect(p.market?.latest).toEqual({ date: '2026-06-30', close: 7500 })
    expect(p.areaCheck).toEqual({ pricePerSqft: 7500, value: 900 * 7500 })
    expect(p.valuationNote).toMatch(/purchase price of ₹50,00,000, grown with Ahmedabad's home prices/)
  })

  it('values by area × the city price with a locality premium', () => {
    saveManualAsset(db, { personId: 1, meta: flat({ valuation: 'AREA', premiumPct: 10 }) })
    const [p] = computeProperties(db, 1, '2026-10-17')
    expect(p.value).toBeCloseTo(900 * 7500 * 1.1, 0)
  })

  it('works out this year’s house-property income and the rental yield', () => {
    saveManualAsset(db, {
      personId: 1,
      meta: flat({
        tenancies: [{ id: 't1', tenant: 'Rakesh', startDate: '2026-04-01', monthlyRent: 20000, dueDay: 5 }],
        rentPayments: [
          { id: 'a', date: '2026-04-05', forMonth: '2026-04', amount: 20000, tenancyId: 't1' },
          { id: 'b', date: '2026-05-05', forMonth: '2026-05', amount: 20000, tenancyId: 't1' }
        ],
        expenses: [{ id: 'x', date: '2026-06-01', kind: 'PROPERTY_TAX', amount: 6000 }]
      })
    })
    const [p] = computeProperties(db, 1, '2026-10-17')
    expect(p.rent?.receivedThisFy).toBe(40000)
    expect(p.rent?.overdueMonths).toBe(5) // June to October unpaid
    expect(p.fy.propertyTax).toBe(6000)
    // (40,000 − 6,000) less the 30% standard deduction.
    expect(p.fy.taxableIncome).toBeCloseTo(34000 * 0.7, 6)
    expect(p.yield?.gross).toBeCloseTo(40000 / p.value!, 9)
  })

  it('rejects a tenancy that ends before it starts', () => {
    expect(() =>
      saveManualAsset(db, {
        personId: 1,
        meta: flat({
          tenancies: [{ id: 't', tenant: 'A', startDate: '2026-05-01', endDate: '2026-04-01', monthlyRent: 1 }]
        })
      })
    ).toThrow(/ends before it starts/)
  })
})
