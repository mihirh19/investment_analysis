import type {
  FundComparisons,
  FundFacts,
  SchemeFacts,
  SectorInsights,
  SectorProduct,
  SectorRow
} from '@shared/insights'
import type { Db } from '../db'
import { factsFor, storedSchemeFacts } from '../market/amfiData'
import { MARKET_INDEX, marketSectorWeights, SECTOR_INDICES, storedSectorIndices } from '../market/sectorIndices'
import { computeExposure, NOT_BROKEN_DOWN } from './exposure'
import { computeFunds } from './fundInsights'

/**
 * Facts for deciding, not advice: how your sectors compare with the market, each sector's record
 * and valuation, the funds and ETFs that track it, and your overlapping funds side by side.
 */

/** "Nifty Bank TRI", "NIFTY BANK", "Nifty Bank Index" → "nifty bank". */
export const benchmarkKey = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(total return index|tri|index|price return|pri)\b/g, ' ')
    .replace(/\bfin service\b/g, 'financial services')
    .replace(/\bpvt\b/g, 'private')
    .replace(/\bconsr durbl\b/g, 'consumer durables')
    .replace(/\bind\b/g, 'india')
    .replace(/\bcapital mkt\b/g, 'capital markets')
    .replace(/\bserv sector\b/g, 'services sector')
    .replace(/\binfra\b/g, 'infrastructure')
    .replace(/\bconsumption\b/g, 'india consumption')
    .replace(/\bindia india\b/g, 'india')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The index funds, ETFs and active sector funds benchmarked to one of these indices. */
export function productsFor(schemes: SchemeFacts[], indexNames: string[]): SectorProduct[] {
  const keys = new Set(indexNames.map(benchmarkKey))
  return schemes
    .filter((s) => s.benchmark && keys.has(benchmarkKey(s.benchmark)))
    .filter((s) => /index funds|etf|sectoral|thematic/i.test(s.category))
    .map((s) => {
      const etf = /\betf\b|exchange traded/i.test(s.name)
      const kind: SectorProduct['kind'] = etf ? 'ETF' : /index/i.test(s.category) || /\bindex\b/i.test(s.name) ? 'INDEX_FUND' : 'ACTIVE'
      // ETFs have a single plan, reported under Regular; funds are compared on their Direct plans.
      const pick = (r: SchemeFacts['r1y']) => (etf ? (r.regular ?? r.direct) : (r.direct ?? r.regular))
      const r1 = pick(s.r1y)
      return {
        name: s.name,
        kind,
        benchmark: s.benchmark,
        aumCr: s.aumCr,
        ter: etf ? (s.terRegular ?? s.terDirect) : (s.terDirect ?? s.terRegular),
        r1y: r1,
        r3y: pick(s.r3y),
        r5y: pick(s.r5y),
        vsBenchmark1y: r1 !== null && s.r1y.benchmark !== null ? r1 - s.r1y.benchmark : null,
        risk: s.risk
      }
    })
    .sort((a, b) => (b.aumCr ?? 0) - (a.aumCr ?? 0))
}

export function computeSectorInsights(db: Db, personId?: number): SectorInsights {
  const exposure = computeExposure(db, personId)
  const indian = exposure.companies.filter((c) => c.cap !== 'FOREIGN')
  const mine = new Map<string, number>()
  let unknown = 0
  for (const c of indian) {
    if (!c.sector || c.sector === 'Other' || c.sector === NOT_BROKEN_DOWN) unknown += c.valueInr
    else mine.set(c.sector, (mine.get(c.sector) ?? 0) + c.valueInr)
  }
  // Fund equity with no holdings loaded is not in the company list.
  unknown += exposure.sectors.find((s) => s.sector === NOT_BROKEN_DOWN)?.valueInr ?? 0
  const known = [...mine.values()].reduce((a, b) => a + b, 0)

  const market = marketSectorWeights(db)
  const indices = storedSectorIndices(db)
  const { date: schemesAsOf, schemes } = storedSchemeFacts(db)
  const sectorNames = new Set([...mine.keys(), ...(market ? market.weights.keys() : [])])
  const sectors: SectorRow[] = [...sectorNames]
    .map((sector) => {
      const idx = SECTOR_INDICES.filter((s) => s.industries.includes(sector))
        .map((s) => indices.find((i) => i.key === s.key))
        .filter((i): i is NonNullable<typeof i> => !!i)
      return {
        sector,
        mineInr: mine.get(sector) ?? 0,
        mineShare: known > 0 ? (mine.get(sector) ?? 0) / known : 0,
        marketShare: market?.weights.get(sector) ?? 0,
        indices: idx,
        products: productsFor(
          schemes,
          idx.map((i) => i.name)
        )
      }
    })
    .sort((a, b) => b.marketShare + b.mineShare - (a.marketShare + a.mineShare))

  return {
    equityInr: known + unknown,
    unknownInr: unknown,
    sectors,
    marketBasis: market ? { members: market.members, capPeriod: market.capPeriod } : null,
    schemesAsOf,
    indicesAsOf: indices[0]?.asOf ?? null,
    market: indices.find((i) => i.key === MARKET_INDEX) ?? null
  }
}

export function computeFundComparisons(db: Db, personId?: number): FundComparisons {
  const report = computeFunds(db, personId)
  const { date: schemesAsOf, schemes } = storedSchemeFacts(db)
  const byId = new Map(report.funds.map((f) => [f.instrumentId, f]))
  const facts = (id: number, uniqueShare: number | null): FundFacts | null => {
    const f = byId.get(id)
    if (!f) return null
    const s = factsFor(schemes, f.name)
    // An ETF has one plan (AMFI reports it as Regular); otherwise the plan held, Regular when unstated.
    const direct = f.plan === 'DIRECT'
    const pick = (r: SchemeFacts['r1y'] | undefined) => (r ? (direct ? (r.direct ?? r.regular) : (r.regular ?? r.direct)) : null)
    return {
      instrumentId: id,
      name: f.shortName || f.name,
      plan: f.plan,
      valueInr: f.valueInr,
      category: s?.category ?? f.category,
      benchmark: s?.benchmark ?? null,
      aumCr: s?.aumCr ?? null,
      ter: s ? (direct ? (s.terDirect ?? s.terRegular) : (s.terRegular ?? s.terDirect)) : null,
      r1y: pick(s?.r1y),
      r3y: pick(s?.r3y),
      r5y: pick(s?.r5y),
      benchmark3y: s?.r3y.benchmark ?? null,
      risk: s?.risk ?? null,
      holdingsCount: f.holdingsCount,
      uniqueShare,
      matched: !!s
    }
  }
  const pairs = report.overlap.pairs
    // id 0 is shares held directly: not a fund to compare.
    .filter((p) => p.a !== 0 && p.b !== 0 && p.overlap >= 0.25)
    .map((p) => {
      const a = facts(p.a, Math.max(0, 1 - p.sharedWeightA))
      const b = facts(p.b, Math.max(0, 1 - p.sharedWeightB))
      if (!a || !b) return null
      return {
        overlap: p.overlap,
        sharedCount: p.sharedCount,
        shared: [...p.shared]
          .sort((x, y) => Math.min(y.weightA, y.weightB) - Math.min(x.weightA, x.weightB))
          .slice(0, 8)
          .map((x) => ({ name: x.name, weightA: x.weightA, weightB: x.weightB })),
        funds: [a, b] as [FundFacts, FundFacts]
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => y.overlap - x.overlap)
  return { schemesAsOf, pairs }
}
