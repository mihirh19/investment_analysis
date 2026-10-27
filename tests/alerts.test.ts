import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { alertsReport, checkAuto, checkRules, markAlertsRead, ruleSymbols, saveAlertRule, setAutoAlerts } from '../src/main/alerts'
import { marketOpen, ruleHit } from '../src/shared/alerts'
import type { LiveQuote } from '../src/shared/research'

const quote = (symbol: string, price: number, prevClose: number): LiveQuote => ({ symbol, price, prevClose, change: price / prevClose - 1, time: '', points: [] })
// 25 Oct 2026, 11:00 IST (a Sunday) and the Monday after.
const SUN = Date.parse('2026-10-25T05:30:00Z')
const MON = Date.parse('2026-10-26T05:30:00Z')

describe('alert rules', () => {
  it('knows when a rule is met and when the market is open', () => {
    expect(ruleHit({ kind: 'above', value: 100 }, 100, null)).toBe(true)
    expect(ruleHit({ kind: 'below', value: 100 }, 101, null)).toBe(false)
    expect(ruleHit({ kind: 'moveUp', value: 5 }, 105, 100)).toBe(true)
    expect(ruleHit({ kind: 'moveDown', value: 5 }, 96, 100)).toBe(false)
    expect(ruleHit({ kind: 'moveDown', value: 5 }, 95, 100)).toBe(true)
    expect(marketOpen(new Date(SUN))).toBe(false)
    expect(marketOpen(new Date(MON))).toBe(true)
    expect(marketOpen(new Date(Date.parse('2026-10-26T11:00:00Z')))).toBe(false) // 16:30 IST
  })
})

describe('the alerts engine', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-alerts-'))
    const o = openDatabase(join(dir, 't.db'), '1'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fires a price level once, and a day’s move once a day', () => {
    const level = saveAlertRule(db, { symbol: 'infy', kind: 'above', value: 1500, note: 'trim?' })
    saveAlertRule(db, { symbol: 'TCS', kind: 'moveDown', value: 3 })
    expect(() => saveAlertRule(db, { symbol: 'TCS', kind: 'above', value: 0 })).toThrow()
    expect(ruleSymbols(db).sort()).toEqual(['INFY', 'TCS'])

    expect(checkRules(db, [quote('INFY', 1490, 1480), quote('TCS', 2500, 2510)], MON)).toEqual([])
    const fired = checkRules(db, [quote('INFY', 1510, 1480), quote('TCS', 2400, 2500)], MON)
    expect(fired.map((e) => e.kind).sort()).toEqual(['above', 'moveDown'])
    expect(fired.find((e) => e.kind === 'above')?.body).toContain('trim?')
    // Again the same day: nothing new; the level is now off.
    expect(checkRules(db, [quote('INFY', 1520, 1480), quote('TCS', 2390, 2500)], MON + 600_000)).toEqual([])
    expect(ruleSymbols(db)).toEqual(['TCS'])
    // The next day the move rule can fire again; the level only once set again.
    expect(checkRules(db, [quote('TCS', 2300, 2400)], MON + 86400_000).map((e) => e.symbol)).toEqual(['TCS'])
    saveAlertRule(db, { id: level.id, symbol: 'INFY', kind: 'above', value: 1500 })
    expect(checkRules(db, [quote('INFY', 1550, 1500)], MON + 86400_000 + 1000).map((e) => e.symbol)).toEqual(['INFY'])

    const r = alertsReport(db)
    expect(r.unread).toBe(4)
    markAlertsRead(db)
    expect(alertsReport(db).unread).toBe(0)
  })

  it('raises the automatic alerts once each, only the switched-on ones', () => {
    // A held company: a demat holding of TCS.
    const at = '2026-10-25T00:00:00Z'
    db.insert(schema.nseListings).values({ isin: 'INE467B01029', symbol: 'TCS', name: 'TCS', kind: 'EQ', updatedAt: at }).run()
    const person = db.insert(schema.persons).values({ name: 'Me', relation: 'SELF' }).returning().get()
    const account = db.insert(schema.accounts).values({ personId: person.id, name: 'Demat', platform: 'ZERODHA', kind: 'DEMAT' }).returning().get()
    const inst = db.insert(schema.instruments).values({ name: 'TCS', isin: 'INE467B01029', assetClass: 'EQUITY_IN', currency: 'INR' }).returning().get()
    db.insert(schema.transactions).values({ accountId: account.id, instrumentId: inst.id, date: '2026-01-01', type: 'BUY', quantity: 10, price: 3000, amount: -30_000, source: 'TEST', externalId: '1' }).run()

    db.insert(schema.researchEvents).values({ symbol: 'TCS', date: '2026-10-26', purpose: 'Financial Results', company: 'TCS', details: '' }).run()
    db.insert(schema.researchActions).values({ symbol: 'TCS', exDate: '2026-10-26', subject: 'Interim Dividend - Rs 12 Per Share', recordDate: null, kind: 'DIVIDEND', amount: 12 }).run()
    db.insert(schema.researchAnnouncements).values([
      { id: 'a1', symbol: 'TCS', company: 'TCS', at: new Date(SUN - 3600_000).toISOString(), category: 'Acquisition', tag: 'deal', text: 'Buys a company', url: null },
      { id: 'a2', symbol: 'TCS', company: 'TCS', at: new Date(SUN - 86400_000).toISOString(), category: 'Acquisition', tag: 'deal', text: 'Old news', url: null },
      { id: 'a3', symbol: 'TCS', company: 'TCS', at: new Date(SUN - 60_000).toISOString(), category: 'Trading Window', tag: 'routine', text: 'x', url: null }
    ]).run()

    const first = checkAuto(db, SUN)
    expect(first.map((e) => e.key).sort()).toEqual(['ex:TCS:2026-10-26:Interim Dividend - Rs 12 Per Share', 'news:a1', 'results:TCS:2026-10-26'])
    expect(first.find((e) => e.kind === 'exDates')?.body).toContain('₹120')
    expect(checkAuto(db, SUN + 300_000)).toEqual([])

    setAutoAlerts(db, { news: false })
    db.insert(schema.researchAnnouncements).values({ id: 'a4', symbol: 'TCS', company: 'TCS', at: new Date(SUN).toISOString(), category: 'Credit Rating', tag: 'rating', text: 'Upgraded', url: null }).run()
    expect(checkAuto(db, SUN + 600_000)).toEqual([])
    expect(alertsReport(db).auto.news).toBe(false)
  })
})
