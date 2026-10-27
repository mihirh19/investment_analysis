// Portfolio X-ray: every company the family owns, directly and inside its funds, with where each
// rupee of it comes from, how concentrated the whole is, and how much the funds repeat each other.

export interface XrayCompany {
  isin: string
  name: string
  sector: string | null
  valueInr: number
  /** Share of all equity owned (direct shares plus funds' equity). */
  share: number
  directInr: number
  /** Each fund's part of this company, largest first. */
  via: { instrumentId: number; fund: string; valueInr: number }[]
}

export interface XrayReport {
  equityInr: number
  /** Equity in funds whose holdings aren't known, so it can't be looked into. */
  unknownInr: number
  companies: XrayCompany[]
  concentration: {
    top5: number
    top10: number
    top20: number
    /** Herfindahl index of company shares; 1/hhi is the number of equal-sized stocks it behaves like. */
    hhi: number
    effectiveStocks: number
  }
  /** Funds' equity holdings in common: the sum, over companies, of the smaller of the two weights. */
  overlap: { funds: { instrumentId: number; name: string; valueInr: number }[]; common: number[][] }
  /** Companies owned three or more ways (direct shares and funds). */
  repeated: { isin: string; name: string; ways: number; valueInr: number }[]
}
