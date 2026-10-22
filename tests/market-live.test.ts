// Checks the chat's market look-ups against the real sites:  FP_LIVE=1 npx vitest run tests/market-live.test.ts
import { expect, it } from 'vitest'
import { fetchFundPerformance } from '../src/main/market/amfiData'
import { fetchNavAll, mfapiHistory } from '../src/main/market/funds'
import { yahooHighOn } from '../src/main/market/yahoo'
import { fundHistory, fundLookup, stockLookup } from '../src/main/marketLookup'

it.runIf(process.env.FP_LIVE)(
  'looks up stocks, indices and funds',
  async () => {
    for (const q of ['INFY', 'Nifty 50', 'Sensex', 'Bank Nifty', 'HDFC Bank', 'NIFTYBEES']) {
      const r = await stockLookup(q)
      console.log(q, '→', r.symbol, r.name, r.price, r.returnsPct)
      expect(r.price).toBeGreaterThan(0)
    }
    const perf = await fetchFundPerformance()
    const navs = await fetchNavAll()
    const found = fundLookup('parag parikh flexi', { date: perf.date, schemes: perf.schemes }, navs)
    console.log(found.funds.map((f) => f.name), found.plans.slice(0, 3))
    expect(found.funds.length).toBeGreaterThan(0)
    const code = found.plans.find((p) => /direct/i.test(p.name) && /growth/i.test(p.name))!.code
    const h = await fundHistory(code, (c, since) => mfapiHistory(c, since))
    console.log(code, h.returnsPct, h.worstFall)
    expect(h.returnsPct['1 year']).not.toBeNull()
    // The grandfathering price (31 Jan 2018 high) now asks Yahoo for the right day.
    const gf = await yahooHighOn('INFY.NS', '2018-01-31')
    console.log('INFY high on 2018-01-31', gf)
    expect(gf).toBeGreaterThan(0)
  },
  120000
)

it.runIf(process.env.FP_LIVE)(
  'reads Rajkot mandi prices from Agmarknet',
  async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const { openDatabase } = await import('../src/main/db')
    const { cropPrice, saveSeason } = await import('../src/main/farm')
    const { refreshMandiPrices } = await import('../src/main/market/mandi')
    const dir = mkdtempSync(join(tmpdir(), 'fp-mandi-live-'))
    const { db, sqlite } = openDatabase(join(dir, 't.db'), '7'.repeat(64), resolve('drizzle'))
    saveSeason(db, { personId: 2, crop: 'GROUNDNUT', season: 'KHARIF', year: 2026, status: 'HARVESTED' })
    saveSeason(db, { personId: 2, crop: 'WHEAT', season: 'RABI', year: 2027, status: 'GROWING' })
    const missed = await refreshMandiPrices(db, undefined, true)
    for (const c of ['GROUNDNUT', 'WHEAT'] as const) {
      const p = cropPrice(db, c, 'Rajkot')
      console.log(c, p.latest?.modal, p.varieties.map((v) => `${v.name} ${v.modal} ${v.min ?? ''}-${v.max ?? ''} ${v.source}`).join(' | '))
    }
    console.log('missed', missed)
    expect(cropPrice(db, 'GROUNDNUT', 'Rajkot').latest?.modal).toBeGreaterThan(1000)
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  },
  180000
)
