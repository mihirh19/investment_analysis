// Decision-support figures for sectors and funds: facts to compare, not recommendations.
// Shared by main and renderer.

/** Returns in percent a year (simple for under a year), as AMFI publishes them. */
export interface PlanReturns {
  regular: number | null
  direct: number | null
  benchmark: number | null
}

/** One scheme as AMFI's fund-performance and TER pages describe it. */
export interface SchemeFacts {
  name: string
  /** AMFI sub-category, e.g. "Flexi Cap Fund", "Index Funds ETFs", "Sectoral/Thematic". */
  category: string
  categoryGroup: string
  benchmark: string | null
  /** Riskometer: Low … Very High. */
  risk: string | null
  /** Assets under management, ₹ crore. */
  aumCr: number | null
  navDate: string
  r1y: PlanReturns
  r3y: PlanReturns
  r5y: PlanReturns
  r10y: PlanReturns
  /** Total expense ratio, % a year. */
  terRegular: number | null
  terDirect: number | null
}

/** A sector index's record: past returns, today's valuation against its own history. */
export interface SectorIndexStats {
  key: string
  /** NSE's name, e.g. "Nifty Bank". */
  name: string
  asOf: string
  close: number
  /** Price returns, % a year (1y simple). */
  r1y: number | null
  r3y: number | null
  r5y: number | null
  high52w: number
  low52w: number
  /** How far below the 52-week high, 0..1. */
  belowHigh: number
  pe: number | null
  /** Ten-year median P/E and where today's sits among the ten years' daily values (0..1). */
  peMedian10y: number | null
  pePercentile: number | null
  pb: number | null
  divYield: number | null
  /** Month-end P/E for the last ten years, for a small chart. */
  peHistory: { date: string; pe: number }[]
}

/** A way to own a sector: an index fund or ETF tracking it, or an active sector fund. */
export interface SectorProduct {
  name: string
  kind: 'ETF' | 'INDEX_FUND' | 'ACTIVE'
  benchmark: string | null
  aumCr: number | null
  /** For the plan an investor would hold: Direct for funds; ETFs have one. */
  ter: number | null
  r1y: number | null
  r3y: number | null
  r5y: number | null
  /** Fund return minus its benchmark's over a year, percentage points (tracking difference). */
  vsBenchmark1y: number | null
  risk: string | null
}

export interface SectorRow {
  /** NSE industry, as in Sectors & exposure. */
  sector: string
  /** Your equity in it (directly and through funds), ₹ and share of your equity. */
  mineInr: number
  mineShare: number
  /** Its share of the Nifty 500 by market value. */
  marketShare: number
  /** Indices that follow it, with their record. */
  indices: SectorIndexStats[]
  products: SectorProduct[]
}

export interface SectorInsights {
  /** Your equity looked through funds (same total as the sector chart). */
  equityInr: number
  /** Not broken down by sector (funds without holdings loaded), excluded from the shares. */
  unknownInr: number
  sectors: SectorRow[]
  /** Nifty 500 and the half-year of the market-cap list the weights use. */
  marketBasis: { members: number; capPeriod: string | null } | null
  schemesAsOf: string | null
  indicesAsOf: string | null
  /** The broad market's own record, to read the sectors against. */
  market: SectorIndexStats | null
}

/** Two funds you hold that own many of the same companies, side by side. */
export interface FundPairComparison {
  overlap: number
  sharedCount: number
  /** Largest companies held by both, with each fund's weight. */
  shared: { name: string; weightA: number; weightB: number }[]
  funds: [FundFacts, FundFacts]
}

export interface FundFacts {
  instrumentId: number
  name: string
  plan: 'DIRECT' | 'REGULAR' | 'NOT_STATED' | 'ETF'
  valueInr: number
  category: string | null
  benchmark: string | null
  aumCr: number | null
  /** For the plan you hold. */
  ter: number | null
  r1y: number | null
  r3y: number | null
  r5y: number | null
  benchmark3y: number | null
  risk: string | null
  holdingsCount: number
  /** Share of this fund (by weight) in companies the other doesn't hold. */
  uniqueShare: number | null
  /** Found in AMFI's data. */
  matched: boolean
}

export interface FundComparisons {
  schemesAsOf: string | null
  pairs: FundPairComparison[]
}
