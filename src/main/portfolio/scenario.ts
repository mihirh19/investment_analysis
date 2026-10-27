import type { HoldingRow } from '@shared/types'
import type { ScenarioHolding, ScenarioMix } from '@shared/scenario'
import { schema, type Db } from '../db'
import { loadExposureInputs } from './exposure'
import { listHoldings } from './holdings'

type FundRow = typeof schema.fundHoldings.$inferSelect

const ZERO: ScenarioMix = { inEquity: 0, foreignEquity: 0, debt: 0, gold: 0, property: 0, crop: 0, crypto: 0, steady: 0 }
const only = (k: keyof ScenarioMix): ScenarioMix => ({ ...ZERO, [k]: 1 })

const GOLD = /\bgold|silver\b/i
const OVERSEAS = /international|global|overseas|world|nasdaq|s&p 500|us equity|u\.s\.|china|japan|europe|asean|emerging market|fof.*overseas/i
const DEBT = /debt|liquid|gilt|bond|money market|overnight|treasury|corporate|banking and psu|credit risk|duration|floater|income/i
const HYBRID = /hybrid|balanced|asset allocation|multi asset|arbitrage|equity savings/i

/** Years of interest-rate sensitivity for a fund's debt, guessed from its category name. */
function durationOf(name: string, category: string): number {
  const s = `${name} ${category}`
  if (/overnight|liquid|money market|arbitrage/i.test(s)) return 0.2
  if (/ultra short|low duration|floater/i.test(s)) return 0.8
  if (/short duration|banking and psu|corporate/i.test(s)) return 2.5
  if (/gilt|long duration|dynamic bond|constant maturity/i.test(s)) return 7
  return 3
}

/** A fund's mix from its disclosed holdings: Indian and foreign shares, debt, and the rest. */
function fromDisclosure(rows: FundRow[]): ScenarioMix {
  const m = { ...ZERO }
  const sum = rows.reduce((s, r) => s + r.weight, 0) || 1
  for (const r of rows) {
    const w = r.weight / sum
    const foreign = (r.country && !/^(IN|IND|INDIA)$/i.test(r.country)) || (r.isin && !r.isin.startsWith('IN') && !r.isin.startsWith('XS'))
    if (r.assetType === 'EQUITY') foreign ? (m.foreignEquity += w) : (m.inEquity += w)
    else if (r.assetType === 'DEBT') m.debt += w
    else if (GOLD.test(r.name)) m.gold += w
    else m.steady += w
  }
  return m
}

export function scenarioHoldings(rows: HoldingRow[], funds: Map<number, FundRow[]>, categories: Map<number, string>): ScenarioHolding[] {
  const out: ScenarioHolding[] = []
  for (const h of rows) {
    const v = h.marketValueInr ?? 0
    if (v <= 0) continue
    const cat = categories.get(h.instrumentId) ?? ''
    let mix: ScenarioMix
    let duration = 3
    switch (h.assetClass) {
      case 'EQUITY_IN':
        mix = only('inEquity')
        break
      case 'EQUITY_US':
        mix = only('foreignEquity')
        break
      case 'MF':
      case 'ETF': {
        const look = funds.get(h.instrumentId)
        if (GOLD.test(h.instrumentName)) mix = only('gold')
        else if (look && look.length) mix = fromDisclosure(look)
        else if (OVERSEAS.test(`${h.instrumentName} ${cat}`)) mix = only('foreignEquity')
        else if (HYBRID.test(`${h.instrumentName} ${cat}`)) mix = { ...ZERO, inEquity: 0.6, debt: 0.4 }
        else if (DEBT.test(`${h.instrumentName} ${cat}`)) mix = only('debt')
        else mix = only('inEquity')
        duration = durationOf(h.instrumentName, cat)
        break
      }
      case 'BOND':
        mix = only('debt')
        duration = 4
        break
      case 'GOLD':
        mix = only('gold')
        break
      case 'REAL_ESTATE':
      case 'REIT':
        mix = only('property')
        break
      case 'AGRI':
        mix = only('crop')
        break
      case 'CRYPTO':
        mix = only('crypto')
        break
      default:
        // Deposits, PPF, EPF, NPS, insurance, cash: valued at what is put in, so these shocks don't move them.
        mix = only('steady')
    }
    out.push({ name: h.instrumentName, assetClass: h.assetClass, valueInr: v, mix, duration })
  }
  return out
}

export function computeScenarioHoldings(db: Db, personId?: number): ScenarioHolding[] {
  const { funds, categories } = loadExposureInputs(db)
  return scenarioHoldings(listHoldings(db, personId), funds, categories)
}
