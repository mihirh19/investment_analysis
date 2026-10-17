// Checks the downloaders against the real sites:  FP_LIVE=1 npx vitest run tests/insights-live.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { fetchFundPerformance, fetchTer, refreshSchemeFacts, storedSchemeFacts } from '../src/main/market/amfiData'
import { refreshNifty500, refreshSectorIndices, storedSectorIndices } from '../src/main/market/sectorIndices'
import { productsFor } from '../src/main/portfolio/insights'

it.runIf(process.env.FP_LIVE)(
  'reads AMFI fund facts and NSE sector indices',
  async () => {
    const t0 = Date.now()
    const perf = await fetchFundPerformance()
    console.log('performance', perf.date, perf.schemes.length, `${Date.now() - t0}ms`)
    expect(perf.schemes.length).toBeGreaterThan(1000)
    const ter = await fetchTer()
    console.log('ter', ter.size, `${Date.now() - t0}ms`)
    expect(ter.size).toBeGreaterThan(1000)
    const exact = perf.schemes.filter((s) => ter.has(s.name)).length
    console.log('ter exact name matches', exact, 'of', perf.schemes.length)
    const banks = productsFor(perf.schemes, ['Nifty Bank'])
    console.log('Nifty Bank products', banks.length, banks.slice(0, 3))
    expect(banks.length).toBeGreaterThan(10)

    const dir = mkdtempSync(join(tmpdir(), 'fp-live-'))
    const { db, sqlite } = openDatabase(join(dir, 't.db'), '9'.repeat(64), resolve('drizzle'))
    const n = await refreshSectorIndices(db, fetch, true)
    const stats = storedSectorIndices(db)
    console.log('indices', n, `${Date.now() - t0}ms`, stats.map((s) => `${s.name}: pe ${s.pe} (median ${s.peMedian10y}, pct ${s.pePercentile?.toFixed(2)}) r1y ${s.r1y?.toFixed(1)} r5y ${s.r5y?.toFixed(1)}`).join('\n'))
    expect(n).toBeGreaterThan(15)
    expect(await refreshNifty500(db, fetch, true)).toBeGreaterThan(450)
    await refreshSchemeFacts(db, fetch, true)
    const withTer = storedSchemeFacts(db).schemes.filter((s) => s.terRegular !== null || s.terDirect !== null).length
    console.log('schemes with TER', withTer)
    expect(withTer).toBeGreaterThan(1800)
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  },
  600_000
)
