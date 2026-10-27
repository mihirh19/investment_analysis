// What-if: shocks to markets (Indian and US shares, the rupee, gold, interest rates, crop prices,
// property, crypto) applied to what the family holds, funds opened up into what they own. A rough
// stress test, not a forecast.

export interface ScenarioMix {
  /** Fractions of the holding's value; they add up to 1. */
  inEquity: number
  foreignEquity: number
  debt: number
  gold: number
  property: number
  crop: number
  crypto: number
  /** Cash, deposits, PPF/EPF and anything priced at a fixed value: not moved by these shocks. */
  steady: number
}

export interface ScenarioHolding {
  name: string
  assetClass: string
  valueInr: number
  mix: ScenarioMix
  /** Years: how much a 1-point rise in rates takes off the debt part (in %). */
  duration: number
}

export interface Shocks {
  /** Fractions: -0.2 is a 20% fall. */
  inEquity: number
  usEquity: number
  /** The rupee price of a dollar: 0.05 is the rupee 5% weaker. */
  usdInr: number
  gold: number
  /** Percentage points: 1 is rates up by one point. */
  rates: number
  crop: number
  property: number
  crypto: number
}

export const NO_SHOCK: Shocks = { inEquity: 0, usEquity: 0, usdInr: 0, gold: 0, rates: 0, crop: 0, property: 0, crypto: 0 }

export const PRESETS: { key: string; label: string; note: string; shocks: Shocks }[] = [
  {
    key: 'covid',
    label: 'A crash like March 2020',
    note: 'Nifty fell about 38% in five weeks; gold held up and the rupee slipped.',
    shocks: { ...NO_SHOCK, inEquity: -0.38, usEquity: -0.34, usdInr: 0.05, gold: 0.03, rates: -0.75, crypto: -0.5 }
  },
  {
    key: 'gfc',
    label: 'A year like 2008',
    note: 'Indian shares more than halved; the rupee fell about a fifth; gold rose.',
    shocks: { ...NO_SHOCK, inEquity: -0.52, usEquity: -0.38, usdInr: 0.22, gold: 0.25, rates: -2, property: -0.1 }
  },
  { key: 'correction', label: 'A 15% market correction', note: 'A common fall that happens every few years.', shocks: { ...NO_SHOCK, inEquity: -0.15, usEquity: -0.1 } },
  { key: 'rupee', label: 'The rupee falls 10%', note: 'Imported inflation; foreign holdings and gold gain in rupees.', shocks: { ...NO_SHOCK, usdInr: 0.1, gold: 0.1 } },
  { key: 'rates', label: 'Interest rates up 1.5 points', note: 'Bond funds lose value; new deposits pay more.', shocks: { ...NO_SHOCK, rates: 1.5, inEquity: -0.05 } },
  { key: 'crop', label: 'A bad price year for crops', note: 'Mandi prices 20% lower for what is in the godown.', shocks: { ...NO_SHOCK, crop: -0.2 } }
]

export interface ScenarioResult {
  before: number
  after: number
  change: number
  /** By what moved it, biggest effect first. */
  byDriver: { key: keyof Shocks; label: string; exposed: number; change: number }[]
  /** Holdings that move most, in rupees. */
  holdings: { name: string; assetClass: string; before: number; change: number }[]
}

const DRIVER_LABEL: Record<keyof Shocks, string> = {
  inEquity: 'Indian shares',
  usEquity: 'Foreign shares',
  usdInr: 'The rupee against the dollar',
  gold: 'Gold and silver',
  rates: 'Interest rates (bonds and debt funds)',
  crop: 'Crops in the godown',
  property: 'Property',
  crypto: 'Crypto'
}

export function runScenario(holdings: ScenarioHolding[], s: Shocks): ScenarioResult {
  const drivers = new Map<keyof Shocks, { exposed: number; change: number }>()
  const add = (k: keyof Shocks, exposed: number, change: number) => {
    const d = drivers.get(k) ?? { exposed: 0, change: 0 }
    d.exposed += exposed
    d.change += change
    drivers.set(k, d)
  }
  let before = 0
  let change = 0
  const rows = holdings.map((h) => {
    const v = h.valueInr
    before += v
    const m = h.mix
    const inEq = v * m.inEquity * s.inEquity
    // Foreign shares move with their market, then with the rupee on the new value.
    const fgnLocal = v * m.foreignEquity * s.usEquity
    const fgnFx = v * m.foreignEquity * (1 + s.usEquity) * s.usdInr
    const debt = v * m.debt * (-h.duration * s.rates) / 100
    const gold = v * m.gold * s.gold
    const prop = v * m.property * s.property
    const crop = v * m.crop * s.crop
    const crypto = v * m.crypto * s.crypto
    add('inEquity', v * m.inEquity, inEq)
    add('usEquity', v * m.foreignEquity, fgnLocal)
    add('usdInr', v * m.foreignEquity, fgnFx)
    add('rates', v * m.debt, debt)
    add('gold', v * m.gold, gold)
    add('property', v * m.property, prop)
    add('crop', v * m.crop, crop)
    add('crypto', v * m.crypto, crypto)
    const c = inEq + fgnLocal + fgnFx + debt + gold + prop + crop + crypto
    change += c
    return { name: h.name, assetClass: h.assetClass, before: v, change: c }
  })
  return {
    before,
    after: before + change,
    change,
    byDriver: [...drivers]
      .filter(([, d]) => d.exposed > 0)
      .map(([key, d]) => ({ key, label: DRIVER_LABEL[key], ...d }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.exposed - a.exposed),
    holdings: rows.filter((r) => Math.abs(r.change) >= 1).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 12)
  }
}
