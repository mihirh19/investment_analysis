import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase, type Db } from '../src/main/db'
import { createServices, type Services } from '../src/main/services'

const KEY = 'e'.repeat(64)
let dir: string
let db: Db
let close: () => void
let svc: Services
let replaced: { file: string; key: string } | null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-assets-'))
  const o = openDatabase(join(dir, 't.db'), KEY, resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  replaced = null
  svc = createServices({
    db,
    casparserExe: '',
    encrypt: (s) => s,
    decrypt: (s) => s,
    dbKey: KEY,
    replaceDatabase: (file, key) => (replaced = { file, key })
  })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('EPF', () => {
  it('records passbook balances and estimates today’s balance', () => {
    const id = svc.saveEpf({
      personId: 1,
      name: 'Infosys',
      uan: '100200300400',
      monthlyContribution: 3600,
      interestRate: 8.25
    })
    svc.addEpfEntry(id, '2025-03-31', 500000)
    svc.addEpfEntry(id, '2026-03-31', 600000)

    const [epf] = svc.listEpf()
    expect(epf).toMatchObject({ name: 'Infosys', uan: '100200300400', monthlyContribution: 3600, interestRate: 8.25 })
    expect(epf.entries).toEqual([
      { date: '2025-03-31', balance: 500000 },
      { date: '2026-03-31', balance: 600000 }
    ])
    expect(epf.estimatedBalance).toBeGreaterThan(600000)

    const [h] = svc.listHoldings(1)
    expect(h).toMatchObject({
      assetClass: 'EPF',
      priceSource: 'ESTIMATE',
      quantity: 1,
      instrumentName: 'EPF · Infosys'
    })
    expect(h.marketValueInr).toBeCloseTo(epf.estimatedBalance!)
    expect(svc.getExposure(1).assetMix).toEqual([{ type: 'DEBT', valueInr: h.marketValueInr }])
  })

  it('rejects future dates and silly rates', () => {
    const id = svc.saveEpf({ personId: 1, name: 'EPF', monthlyContribution: 0, interestRate: 8.25 })
    expect(() => svc.addEpfEntry(id, '2999-01-01', 1)).toThrow(/future/)
    expect(() => svc.saveEpf({ personId: 1, name: 'EPF', monthlyContribution: 0, interestRate: 825 })).toThrow(
      /percentage/
    )
  })
})

describe('insurance', () => {
  it('counts savings policies at their value and keeps term cover out of net worth', () => {
    svc.savePolicy({
      personId: 2,
      insurer: 'LIC',
      name: 'Jeevan Anand',
      policyNumber: '123',
      type: 'ENDOWMENT',
      sumAssured: 500000,
      premium: 2500,
      premiumFrequency: 'MONTHLY',
      currentValue: 210000
    })
    svc.savePolicy({
      personId: 2,
      insurer: 'HDFC Life',
      name: 'Click 2 Protect',
      policyNumber: '456',
      type: 'TERM',
      sumAssured: 10000000,
      premium: 15000,
      premiumFrequency: 'YEARLY',
      currentValue: 99999
    })
    const policies = svc.listPolicies()
    expect(policies.map((p) => [p.name, p.annualPremium, p.currentValue ?? null])).toEqual([
      ['Jeevan Anand', 30000, 210000],
      ['Click 2 Protect', 15000, null]
    ])
    const holdings = svc.listHoldings(2)
    expect(holdings).toHaveLength(1)
    expect(holdings[0]).toMatchObject({ assetClass: 'INSURANCE', marketValueInr: 210000, priceSource: 'MANUAL' })

    svc.deletePolicy(policies[0].accountId)
    expect(svc.listHoldings(2)).toHaveLength(0)
    expect(svc.listPolicies()).toHaveLength(1)
  })
})

describe('backup and restore', () => {
  it('writes an encrypted copy that only the recovery key opens', () => {
    const file = join(dir, 'b.fpbackup')
    svc.backupTo(file)
    expect(existsSync(file)).toBe(true)
    const plain = new Database(file)
    expect(() => plain.prepare('select * from persons').get()).toThrow()
    plain.close()

    expect(svc.getRecoveryKey()).toBe(KEY)
    expect(() => svc.restoreDatabase(file, 'f'.repeat(64))).toThrow(/does not open/)
    expect(() => svc.restoreDatabase(file, 'not-a-key')).toThrow(/64 characters/)
    svc.restoreDatabase(file, KEY.toUpperCase())
    expect(replaced).toEqual({ file, key: KEY })
  })
})
