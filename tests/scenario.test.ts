import { describe, expect, it } from 'vitest'
import { scenarioHoldings } from '../src/main/portfolio/scenario'
import { NO_SHOCK, runScenario, type ScenarioHolding } from '../src/shared/scenario'
import type { HoldingRow } from '../src/shared/types'

const row = (o: Partial<HoldingRow>): HoldingRow => ({ instrumentId: 1, instrumentName: 'x', isin: null, assetClass: 'EQUITY_IN', marketValueInr: 100, ...o }) as HoldingRow

describe('what if', () => {
  it('opens funds up and guesses the rest from the kind of holding', () => {
    const funds = new Map([
      [
        5,
        [
          { weight: 0.5, assetType: 'EQUITY', country: 'IN', isin: 'INE009A01021', name: 'Infosys' },
          { weight: 0.3, assetType: 'EQUITY', country: 'US', isin: 'US0378331005', name: 'Apple' },
          { weight: 0.2, assetType: 'DEBT', country: null, isin: 'IN0020230085', name: 'GOI 2033' }
        ] as never
      ]
    ])
    const h = scenarioHoldings(
      [
        row({ instrumentId: 1, assetClass: 'EQUITY_IN' }),
        row({ instrumentId: 5, assetClass: 'MF', instrumentName: 'Flexi Cap' }),
        row({ instrumentId: 6, assetClass: 'MF', instrumentName: 'Nippon Gold ETF FoF' }),
        row({ instrumentId: 7, assetClass: 'MF', instrumentName: 'HDFC Gilt Fund' }),
        row({ instrumentId: 8, assetClass: 'FD', instrumentName: 'SBI deposit' }),
        row({ instrumentId: 9, assetClass: 'AGRI', instrumentName: 'Groundnut in the godown' }),
        row({ instrumentId: 10, assetClass: 'MF', instrumentName: 'Zero value', marketValueInr: 0 })
      ],
      funds,
      new Map()
    )
    expect(h).toHaveLength(6)
    expect(h[1].mix).toMatchObject({ inEquity: 0.5, foreignEquity: 0.3, debt: 0.2 })
    expect(h[2].mix.gold).toBe(1)
    expect(h[3]).toMatchObject({ duration: 7, mix: { debt: 1 } })
    expect(h[4].mix.steady).toBe(1)
    expect(h[5].mix.crop).toBe(1)
  })

  it('applies the shocks, foreign shares in rupees', () => {
    const mix = (o: Partial<ScenarioHolding['mix']>): ScenarioHolding['mix'] => ({ inEquity: 0, foreignEquity: 0, debt: 0, gold: 0, property: 0, crop: 0, crypto: 0, steady: 0, ...o })
    const h: ScenarioHolding[] = [
      { name: 'A', assetClass: 'EQUITY_IN', valueInr: 1000, mix: mix({ inEquity: 1 }), duration: 3 },
      { name: 'B', assetClass: 'EQUITY_US', valueInr: 1000, mix: mix({ foreignEquity: 1 }), duration: 3 },
      { name: 'C', assetClass: 'MF', valueInr: 1000, mix: mix({ debt: 1 }), duration: 5 },
      { name: 'D', assetClass: 'FD', valueInr: 1000, mix: mix({ steady: 1 }), duration: 3 }
    ]
    const r = runScenario(h, { ...NO_SHOCK, inEquity: -0.2, usEquity: -0.1, usdInr: 0.1, rates: 1 })
    expect(r.before).toBe(4000)
    // A: -200. B: 1000 × (0.9 × 1.1 − 1) = −10. C: −5% = −50. D: nothing.
    expect(r.change).toBeCloseTo(-260)
    expect(r.byDriver.map((d) => d.key)).toEqual(['inEquity', 'usEquity', 'usdInr', 'rates'])
    expect(r.byDriver.find((d) => d.key === 'usdInr')!.change).toBeCloseTo(90)
    expect(r.holdings.map((x) => x.name)).toEqual(['A', 'C', 'B'])
    expect(runScenario(h, NO_SHOCK).change).toBe(0)
  })
})
