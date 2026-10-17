import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { addNpsAccount, pickNpsScheme, removeHolding } from '../src/main/assets'
import { listHoldings } from '../src/main/portfolio/holdings'

// As npsnav.in lists them (October 2026).
const SCHEMES = [
  ['SM008001', 'HDFC PENSION MANAGEMENT COMPANY LIMITED SCHEME E - TIER I'],
  ['SM008002', 'HDFC PENSION MANAGEMENT COMPANY LIMITED SCHEME C - TIER I'],
  ['SM008003', 'HDFC PENSION MANAGEMENT COMPANY LIMITED SCHEME G - TIER I'],
  ['SM008004', 'HDFC PENSION MANAGEMENT COMPANY LIMITED SCHEME E - TIER II'],
  ['SM008013', 'NPS TRUST A/C - HDFC PF NPS EQUITY ADVANTAGE FUND - TIER I'],
  ['SM008015', 'NPS TRUST A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME E - TIER I GS'],
  ['SM008018', 'NPS TRUST A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME E - TIER I DIRECT'],
  ['SM001001', 'SBI PENSION FUNDS PRIVATE LIMITED SCHEME E - TIER I']
].map(([code, name]) => ({ code, name }))

describe('picking the NPS scheme', () => {
  it('tells the POP, direct and government versions apart', () => {
    const pick = (letter: string, tier: 'I' | 'II', route: 'POP' | 'DIRECT' | 'GS') =>
      pickNpsScheme(SCHEMES, { manager: 'HDFC', letter, tier, route })?.code
    expect(pick('E', 'I', 'POP')).toBe('SM008001')
    expect(pick('E', 'I', 'DIRECT')).toBe('SM008018')
    expect(pick('E', 'I', 'GS')).toBe('SM008015')
    expect(pick('E', 'II', 'POP')).toBe('SM008004')
    expect(pick('G', 'I', 'POP')).toBe('SM008003')
    expect(pick('A', 'I', 'POP')).toBeUndefined()
    expect(pickNpsScheme(SCHEMES, { manager: 'SBI', letter: 'E', tier: 'I', route: 'POP' })?.code).toBe('SM001001')
  })
})

describe('NPS from a POP’s screen', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-nps-'))
    const o = openDatabase(join(dir, 't.db'), '6'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const market = {
    schemes: async () => SCHEMES,
    latest: async (code: string) => ({ nav: code === 'SM008001' ? 50 : 40, date: '2026-10-16' })
  }

  it('adds each scheme with units from the NAV and the amount invested', async () => {
    const added = await addNpsAccount(
      db,
      {
        personId: 1,
        manager: 'HDFC',
        tier: 'I',
        route: 'POP',
        rows: [
          { letter: 'E', value: 2045.3, invested: 2178.74 },
          { letter: 'C', value: 290.48, invested: 290.41 },
          { letter: 'G', value: 424.55, invested: 435.51 }
        ]
      },
      market
    )
    expect(added).toHaveLength(3)
    const rows = listHoldings(db, 1).filter((h) => h.assetClass === 'NPS')
    const e = rows.find((r) => r.instrumentName.includes('SCHEME E'))!
    expect(e.quantity).toBeCloseTo(2045.3 / 50, 9)
    expect(e.investedInr).toBeCloseTo(2178.74, 6)
    expect(e.marketValueInr).toBeCloseTo(2045.3, 6)
    expect(db.select().from(schema.instruments).all().find((i) => i.name === e.instrumentName)?.npsCode).toBe('SM008001')

    // Remove one; the account stays while it holds the others, and goes with the last.
    for (const r of rows) removeHolding(db, r.accountId, r.instrumentId)
    expect(listHoldings(db, 1).filter((h) => h.assetClass === 'NPS')).toHaveLength(0)
    expect(db.select().from(schema.accounts).all().filter((a) => a.kind === 'NPS')).toHaveLength(0)
  })

  it('asks for at least one value', async () => {
    await expect(
      addNpsAccount(db, { personId: 1, manager: 'HDFC', tier: 'I', route: 'POP', rows: [{ letter: 'E', value: 0 }] }, market)
    ).rejects.toThrow(/current value/)
  })
})
