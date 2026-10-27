import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { checkAuto, setAutoAlerts } from '../src/main/alerts'
import { countryOf, moneyByCountry } from '../src/main/world/money'
import { savePlaces, saveTraffic } from '../src/main/world/store'
import { summarise } from '../src/shared/commodities'

const open = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-wm-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  return { db: o.db, done: () => (o.sqlite.close(), rmSync(dir, { recursive: true, force: true })) }
}

describe('your money by country', () => {
  it('reads country codes and names', () => {
    expect(countryOf('US')).toBe('USA')
    expect(countryOf('TWN')).toBe('TWN')
    expect(countryOf('United States of America')).toBe('USA')
    expect(countryOf('Atlantis')).toBeNull()
  })

  it('places shares by listing and funds by what they hold', () => {
    const { db, done } = open()
    try {
      const me = db.insert(schema.persons).values({ name: 'Me', relation: 'SELF' }).returning().get()
      const acct = db.insert(schema.accounts).values({ personId: me.id, name: 'Demat', platform: 'ZERODHA', kind: 'DEMAT' }).returning().get()
      const buy = (name: string, isin: string, assetClass: 'EQUITY_IN' | 'EQUITY_US' | 'MF', price: number, currency = 'INR') => {
        const i = db.insert(schema.instruments).values({ name, isin, assetClass, currency }).returning().get()
        db.insert(schema.transactions).values({ accountId: acct.id, instrumentId: i.id, date: '2026-01-01', type: 'BUY', quantity: 1, price, amount: -price, source: 'TEST', externalId: name, currency }).run()
        db.insert(schema.quotes).values({ instrumentId: i.id, price, prevClose: price, currency, asOf: '2026-10-20T10:00:00Z', source: 'TEST', fetchedAt: '2026-10-20T10:00:00Z' }).run()
        return i
      }
      buy('INFY', 'INE009A01021', 'EQUITY_IN', 100_000)
      const fund = buy('Global Fund of Funds', 'INF000G01001', 'MF', 50_000)
      buy('Nasdaq Fund of Funds', 'INF000N01001', 'MF', 20_000) // overseas, no holdings on file
      db.insert(schema.fundHoldings).values([
        { fundInstrumentId: fund.id, asOf: '2026-09-30', source: 'TEST', name: 'Apple', isin: 'US0378331005', assetType: 'EQUITY', country: 'US', weight: 0.6 },
        { fundInstrumentId: fund.id, asOf: '2026-09-30', source: 'TEST', name: 'TSMC', isin: 'US8740391003', assetType: 'EQUITY', country: 'Taiwan', weight: 0.3 },
        { fundInstrumentId: fund.id, asOf: '2026-09-30', source: 'TEST', name: 'TREPS', isin: null, assetType: 'CASH', country: null, weight: 0.1 }
      ]).run()
      const m = moneyByCountry(db)
      expect(m.totalInr).toBe(170_000)
      expect(m.unknownInr).toBe(20_000)
      const by = Object.fromEntries(m.countries.map((c) => [c.iso3, c]))
      expect(by.IND).toMatchObject({ direct: 100_000 })
      expect(by.IND.viaFunds).toBeCloseTo(5_000) // the fund's cash, at home
      expect(by.USA.viaFunds).toBeCloseTo(30_000)
      expect(by.TWN.valueInr).toBeCloseTo(15_000)
      expect(by.TWN.share).toBeCloseTo(15_000 / 170_000)
      expect(m.countries[0].iso3).toBe('IND')
    } finally {
      done()
    }
  })
})

describe('commodities', () => {
  it('works out the day, month and year changes', () => {
    const closes = Array.from({ length: 251 }, (_, i) => 100 + i)
    const s = summarise(closes)
    expect(s.last).toBe(350)
    expect(s.change1d).toBeCloseTo(350 / 349 - 1)
    expect(s.change1m).toBeCloseTo(350 / 329 - 1)
    expect(s.change1y).toBeCloseTo(2.5)
    expect(summarise([5])).toEqual({ last: 5, change1d: null, change1m: null, change1y: null })
  })
})

describe('chokepoint alerts', () => {
  it('fires when a sea route carries 30% fewer ships than a year ago, once a fortnight', () => {
    const { db, done } = open()
    try {
      setAutoAlerts(db, { results: false, exDates: false, news: false, stakes: false, highs: false, weather: false })
      savePlaces(db, [{ id: 'cp1', kind: 'chokepoint', name: 'Strait of Hormuz', iso3: null, lat: 26.5, lon: 56.3, locode: null, vessels: 30000 }])
      const now = Date.parse('2026-10-27T06:00:00Z')
      const day = (back: number) => new Date(now - back * 86400_000).toISOString().slice(0, 10)
      const rows = []
      for (let i = 1; i <= 7; i++) rows.push({ id: 'cp1', date: day(i), total: 40, tanker: 20, container: 10, dryBulk: 10, imports: null, exports: null })
      for (let i = 365; i <= 372; i++) rows.push({ id: 'cp1', date: day(i), total: 100, tanker: 50, container: 25, dryBulk: 25, imports: null, exports: null })
      saveTraffic(db, rows)
      const e = checkAuto(db, now)
      expect(e.map((x) => x.kind)).toEqual(['chokepoints'])
      expect(e[0].title).toMatch(/Strait of Hormuz: 60% fewer ships/)
      expect(checkAuto(db, now + 3600_000)).toEqual([])
    } finally {
      done()
    }
  })
})
