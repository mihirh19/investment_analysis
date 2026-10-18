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
