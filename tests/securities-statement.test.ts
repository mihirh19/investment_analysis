import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatementRead } from '../src/shared/ai'
import { openDatabase, schema, type Db } from '../src/main/db'
import { emptyBundle, persistBundle } from '../src/main/importers/bundle'
import { importSecurityBalances } from '../src/main/importers/securities'
import { createServices, type Services } from '../src/main/services'
import { saveStatement } from '../src/main/statements'

let dir: string
let db: Db
let close: () => void
let svc: Services

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-sec-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s })
  // Holdings as the September CAS left them: a Zerodha demat account with its depository id.
  const b = emptyBundle()
  b.accounts.push({ key: 'Z', platform: 'ZERODHA', kind: 'DEMAT', name: 'ZERODHA BROKING LIMITED', externalId: '12081600-00126347', currency: 'INR' })
  for (const [key, isin, name] of [['INFY', 'INE009A01021', 'INFOSYS LIMITED'], ['ITC', 'INE154A01025', 'ITC LIMITED']] as const)
    b.instruments.push({ key, isin, name, assetClass: 'EQUITY_IN', symbolNse: key, currency: 'INR' })
  b.snapshots.push(
    { accountKey: 'Z', instrumentKey: 'INFY', date: '2026-09-30', quantity: 40, price: 1500, value: 60000, cost: null, source: 'CAS' },
    { accountKey: 'Z', instrumentKey: 'ITC', date: '2026-09-30', quantity: 150, price: 260, value: 39000, cost: null, source: 'CAS' }
  )
  persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'sep.pdf', bundle: b })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const statement = (over: Partial<StatementRead> = {}): StatementRead => ({
  kind: 'SECURITIES',
  institution: 'Zerodha',
  accountName: 'Statement of Accounts of Securities',
  last4: '6347',
  holderName: null,
  periodFrom: '2026-10-12',
  periodTo: '2026-10-17',
  statementDate: '2026-10-19',
  dueDate: null,
  totalDue: null,
  minimumDue: null,
  creditLimit: null,
  openingBalance: null,
  closingBalance: null,
  rewardPoints: null,
  transactions: [],
  trades: [],
  holdings: [
    // Free and pledged lines of one security are added.
    { name: 'INFOSYS LIMITED', isin: 'INE009A01021', symbol: null, quantity: 30, price: null, value: null },
    { name: 'INFOSYS LIMITED', isin: 'INE009A01021', symbol: null, quantity: 15, price: null, value: null },
    // Sold out this week.
    { name: 'ITC LIMITED', isin: 'INE154A01025', symbol: 'ITC', quantity: 0, price: null, value: null },
    // Bought this week: a security the CAS had not listed.
    { name: 'TATA CONSULTANCY SERVICES LIMITED', isin: 'INE467B01029', symbol: 'TCS', quantity: 12, price: 3000, value: null }
  ],
  ...over
})

describe('a broker’s securities statement', () => {
  it('updates holdings on the broker’s existing demat account, with sold-out and new securities', () => {
    expect(svc.listHoldings(1).map((h) => [h.instrumentName, h.quantity])).toEqual(expect.arrayContaining([['INFOSYS LIMITED', 40], ['ITC LIMITED', 150]]))

    const added = importSecurityBalances(db, 1, 'gmail:m1', statement())
    expect(added).toBe(3)
    // The same depository account, not a second Zerodha demat.
    expect(db.select().from(schema.accounts).all().filter((a) => a.platform === 'ZERODHA')).toHaveLength(1)

    const held = new Map(svc.listHoldings(1).map((h) => [h.instrumentName, h]))
    expect(held.get('INFOSYS LIMITED')?.quantity).toBe(45)
    expect(held.get('ITC LIMITED')).toBeUndefined() // closing balance zero: gone
    expect(held.get('TATA CONSULTANCY SERVICES LIMITED')).toMatchObject({ quantity: 12, symbol: 'TCS' })
  })

  it('does nothing twice, and ignores rows it cannot place', () => {
    expect(importSecurityBalances(db, 1, 'a', statement())).toBe(3)
    expect(importSecurityBalances(db, 1, 'a', statement())).toBe(0)
    // No date, or no ISIN and no symbol: nothing to record.
    expect(importSecurityBalances(db, 1, 'b', statement({ periodTo: null, statementDate: null }))).toBe(0)
    expect(importSecurityBalances(db, 1, 'c', statement({ periodTo: '2026-10-24', holdings: [{ name: 'MYSTERY', isin: null, symbol: null, quantity: 5, price: null, value: null }] }))).toBe(0)
  })

  it('says what happened in the Gmail log', () => {
    const r = saveStatement(db, 1, statement(), 'x', undefined, (s) => importSecurityBalances(db, 1, 'x', s))
    expect(r.message).toBe('3 holdings updated as of 2026-10-17.')
    expect(saveStatement(db, 1, statement(), 'x', undefined, (s) => importSecurityBalances(db, 1, 'x', s)).message).toBe('3 holdings read, all already recorded.')
    expect(saveStatement(db, 1, statement({ holdings: [] }), 'x').message).toBe('No securities found in this statement.')
  })

  it('tells a contract note with no trades from one whose trades are already in', () => {
    const note = (trades: StatementRead['trades']) => statement({ kind: 'CONTRACT_NOTE', accountName: 'Contract note', holdings: [], trades })
    const trade = { date: '2026-10-05', symbol: 'INFY', isin: 'INE009A01021', side: 'BUY' as const, quantity: 5, price: 1500, exchange: 'NSE', tradeId: '1' }
    expect(saveStatement(db, 1, note([]), 'n').message).toBe('No trades found in this contract note.')
    expect(saveStatement(db, 1, note([trade]), 'n', () => 0).message).toBe('1 trade read, all already in your trade history.')
    expect(saveStatement(db, 1, note([trade]), 'n', () => 1).message).toBe('1 trade added to your trade history.')
  })

  it('names what was skipped when it is a funds ledger', () => {
    const r = saveStatement(db, 1, statement({ kind: 'OTHER', accountName: 'Trading Ledger', holdings: [] }), 'l')
    expect(r.message).toMatch(/funds ledger or similar/)
  })
})

describe('a broker’s funds ledger', () => {
  it('is told from its heading, so it is not sent to Claude, but a securities statement is not mistaken for one', async () => {
    const { isBrokerLedger } = await import('../src/main/statements')
    expect(isBrokerLedger('ZERODHA BROKING LTD\nStatement of Accounts of Funds\nClient ID TYB529\n01-10-2026 Opening balance')).toBe(true)
    expect(isBrokerLedger('Trading Ledger (NSE-EQ)\nFrom 01-04-2026')).toBe(true)
    expect(isBrokerLedger('Retention Statement and Retention Account Statement - Quarter 3')).toBe(true)
    expect(isBrokerLedger('ZERODHA BROKING LTD\nStatement of Accounts of Securities\nISIN INE009A01021 INFOSYS')).toBe(false)
    // Both in one file: it still carries the holdings, so it is read.
    expect(isBrokerLedger('Statement of Accounts of Funds ... Statement of Accounts of Securities ...')).toBe(false)
    expect(isBrokerLedger('HDFC Bank Credit Card Statement')).toBe(false)
  })
})
