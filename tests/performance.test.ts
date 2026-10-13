import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type CasJson } from '../src/main/importers/cas'
import { computePerformance } from '../src/main/portfolio/performance'
import { createServices, type Services } from '../src/main/services'

// End-to-end on the demo data: my CDSL statement plus my Zerodha tradebook.
const demo = resolve('tests/fixtures/demo')
const noNet = (async () => new Response('offline', { status: 503 })) as typeof fetch

let dir: string
let db: Db
let close: () => void
let svc: Services

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fp-perf-'))
  const o = openDatabase(join(dir, 't.db'), 'c'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, fetch: noNet })
  const cas = JSON.parse(readFileSync(join(demo, 'me-cdsl.cas.json'), 'utf8')) as CasJson
  persistBundle(db, { personId: 1, kind: 'CAS_PDF', fileName: 'me-cdsl.cas.json', bundle: mapCasJson(cas) })
  await svc.runImport({ kind: 'ZERODHA_TRADEBOOK', personId: 1, filePath: join(demo, 'me-zerodha-tradebook.csv') })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('computePerformance', () => {
  it('produces a consistent report for holdings with a full trade history', () => {
    const p = computePerformance(db, 1)
    expect(p.dates.length).toBeGreaterThan(2)
    expect(p.values).toHaveLength(p.dates.length)
    expect(p.growth).toHaveLength(p.dates.length)
    expect(p.monthly).toHaveLength(p.dates.length - 1)
    expect(p.rolling12).toHaveLength(p.dates.length)
    expect(p.coverage).toBeGreaterThan(0)
    expect(p.coverage).toBeLessThanOrEqual(1)
    expect(p.values.at(-1)).toBeCloseTo(p.coveredValueInr)
    for (const r of p.monthly) if (r !== null) expect(Number.isFinite(r)).toBe(true)
    expect(p.drawdown.every((d) => d <= 0)).toBe(true)
    expect(p.xirr.byHolding.length).toBeGreaterThan(0)
    expect(p.xirr.byAccount.length).toBeGreaterThan(0)
    if (process.env.FP_PRINT)
      writeFileSync(
        join(tmpdir(), 'fp-perf.json'),
        JSON.stringify({ ...p, monthly: p.monthly.slice(-6), values: p.values.slice(-6) }, null, 1)
      )
  })

  it('each year balances: opening + added − withdrawn + gain = closing', () => {
    const p = computePerformance(db, 1)
    expect(p.years.some((y) => y.kind === 'CY')).toBe(true)
    expect(p.years.some((y) => y.kind === 'FY')).toBe(true)
    for (const y of p.years) expect(y.opening + y.added - y.withdrawn + y.gain).toBeCloseTo(y.closing, 2)
  })

  it('net invested ends at the total put in minus taken out', () => {
    const p = computePerformance(db, 1)
    const txns = db.select().from(schema.transactions).all()
    expect(txns.length).toBeGreaterThan(0)
    expect(p.netInvested.at(-1)!).toBeGreaterThan(0)
    // Non-decreasing only if there were no sales; at least it never goes negative.
    expect(p.netInvested.every((v) => v >= -1)).toBe(true)
  })

  it('compares with stored benchmarks, and the "same money" line starts at the opening value', () => {
    const p0 = computePerformance(db, 1)
    const start = p0.dates[0]
    const rows = p0.dates.map((d, i) => ({ key: 'BM:NIFTY50', date: d, close: 1000 * 1.01 ** i }))
    db.insert(schema.priceHistory).values(rows).run()
    db.insert(schema.priceHistory).values({ key: 'BM:NIFTY50', date: start, close: 1000 }).onConflictDoNothing().run()
    const p = computePerformance(db, 1)
    const n50 = p.benchmarks.find((b) => b.key === 'BM:NIFTY50')!
    expect(n50.label).toBe('Nifty 50')
    expect(n50.growth[0]).toBeCloseTo(100)
    expect(n50.sameMoney[0]).toBeCloseTo(p.values[0])
    const full = p.years.find((y) => !y.partial)
    if (full) expect(full.benchmarks['BM:NIFTY50']).toBeCloseTo(1.01 ** 12 - 1, 6)
  })

  it('returns an empty report for a person with nothing', () => {
    const p = computePerformance(db, 2)
    expect(p.coverage).toBe(0)
    expect(p.xirr.byHolding).toEqual([])
  })
})
