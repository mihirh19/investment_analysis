import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aspFormFields, parseAmfiMonthly, parseDealsCsv, parseFiiDii, parseNsdlYear, parseParticipantOi, parseSast } from '../src/main/flows/parse'
import { INSTITUTION, longShare } from '../src/shared/flows'

const fx = (f: string) => join(__dirname, 'fixtures', 'flows', f)
const text = (f: string) => readFileSync(fx(f), 'utf8')

describe('money-flow sources', () => {
  it('reads NSE’s FII and DII day', () => {
    const r = parseFiiDii(JSON.parse(text('fiidii.json')))
    expect(r).toEqual([
      { date: '2026-10-23', category: 'DII', buy: 19232.31, sell: 15996.95, net: 3235.36 },
      { date: '2026-10-23', category: 'FII', buy: 14445.54, sell: 13557.89, net: 887.65 }
    ])
  })

  it('reads F&O positions by type of trader', () => {
    const r = parseParticipantOi(text('fao_participant_oi_23102026.csv'), '2026-10-23')
    expect(r.map((x) => x.client)).toEqual(['Client', 'DII', 'FII', 'Pro'])
    const fii = r.find((x) => x.client === 'FII')!
    expect(fii).toMatchObject({ futIdxLong: 36986, futIdxShort: 317169, callIdxLong: 962005, putIdxShort: 714301 })
    expect(longShare(fii)).toBeCloseTo(36986 / (36986 + 317169))
  })

  it('reads NSDL’s foreign investment by month', () => {
    const r = parseNsdlYear(text('nsdl_yearwise.html'))
    expect(r).toHaveLength(10)
    expect(r[0]).toMatchObject({ month: '2026-01', equity: -35962, debt: -7308 + 60 + 13261, hybrid: 232, total: -29240 })
    expect(r[9]).toMatchObject({ month: '2026-10', equity: -48056, total: -39843 })
    expect(aspFormFields('<input type="hidden" name="__VIEWSTATE" value="a&amp;b" />')).toEqual({ __VIEWSTATE: 'a&b' })
  })

  it('reads AMFI’s monthly report by category', () => {
    const r = parseAmfiMonthly(readFileSync(fx('amsep2026repo.xls')), '2026-09')
    const mid = r.find((x) => x.category === 'Mid Cap Fund')!
    expect(mid).toMatchObject({ group: 'Equity', schemes: 34, folios: 26768077 })
    expect(mid.net).toBeCloseTo(7834.84, 1)
    expect(r.find((x) => x.category === 'Liquid Fund')?.group).toBe('Debt')
    expect(r.filter((x) => x.group === 'Equity')).toHaveLength(13)
  })

  it('reads bulk deals and takeover disclosures', () => {
    const deals = parseDealsCsv(text('bulk_hist.csv'), 'BULK')
    expect(deals[0]).toMatchObject({ date: '2026-10-01', symbol: 'ADVANCE', side: 'BUY', qty: 350000, price: 116.75, kind: 'BULK' })
    expect(deals.length).toBeGreaterThan(30)
    const s = parseSast(JSON.parse(text('sast.json')))
    expect(s[0]).toMatchObject({ symbol: 'TIKONA', side: 'SELL', changePct: 56.13, afterPct: 0, promoter: true })
    expect(s[1]).toMatchObject({ symbol: 'SAMHI', side: 'BUY', shares: 1175000, changePct: 0.53, afterPct: 5.06 })
    expect(INSTITUTION.test(s[1].party)).toBe(true)
    expect(INSTITUTION.test('GAURAV GOYAL')).toBe(false)
  })
})

// FP_LIVE=1: each source once against the real sites, most of the history marked as already fetched.
describe.skipIf(!process.env.FP_LIVE)('live flows', () => {
  it('fetches every source', { timeout: 240_000 }, async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { resolve } = await import('node:path')
    const { openDatabase, schema } = await import('../src/main/db')
    const { FlowsSync, flowsReport } = await import('../src/main/flows/sync')
    const { candidateDays } = await import('../src/main/research/sync')
    const dir = mkdtempSync(join(tmpdir(), 'fp-flows-live-'))
    const o = openDatabase(join(dir, 't.db'), '9'.repeat(64), resolve('drizzle'))
    const done = (key: string) => o.db.insert(schema.flowFetched).values({ key, status: 'DONE', at: '2000-01-01T00:00:00Z' }).run()
    for (const d of candidateDays(new Date(Date.now() + 19800_000), 250).slice(3)) done(`fo:${d}`)
    for (let y = 2015; y <= 2024; y++) done(`fpi:${y}`)
    for (let y = 2019; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
      const k = `${y}-${String(m).padStart(2, '0')}`
      if (k < '2026-08') done(`mf:${k}`)
    }
    const sync = new FlowsSync(o.db, () => {}, fetch, 1000)
    sync.setEnabled(true)
    await sync.run()
    const r = flowsReport(o.db, sync.status())
    console.log(JSON.stringify({ err: r.status.lastError, cash: r.cash.length, fo: r.fo.length, fpi: r.fpi.map((x) => x.month).join(','), mf: r.mf.length, mfMonths: r.mfEquityByMonth.map((x) => x.month), deals: r.deals.length, stakes: r.stakes.length }))
    expect(r.status.lastError).toBeNull()
    expect(r.fpi.some((m) => m.month.startsWith('2025'))).toBe(true)
    expect(r.fpi.some((m) => m.month.startsWith('2026'))).toBe(true)
    expect(r.mf.length).toBeGreaterThan(30)
    expect(r.deals.length).toBeGreaterThan(100)
    expect(r.stakes.length).toBeGreaterThan(10)
    expect(r.fo.length).toBeGreaterThan(3)
    o.sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
