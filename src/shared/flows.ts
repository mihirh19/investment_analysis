// Institutional money flows: foreign (FII/FPI) and domestic (DII) investors' buying and selling,
// their F&O positions, mutual fund flows by category, and big deals. Amounts in ₹ crore unless
// noted; quantities in shares or contracts.

/** One day's cash-market buying and selling (NSE's provisional figures). */
export interface CashFlow {
  date: string
  category: 'FII' | 'DII'
  buy: number
  sell: number
  net: number
}

/** Open F&O contracts by type of trader at one day's close. */
export interface FoPosition {
  date: string
  client: 'Client' | 'DII' | 'FII' | 'Pro'
  futIdxLong: number
  futIdxShort: number
  futStkLong: number
  futStkShort: number
  callIdxLong: number
  putIdxLong: number
  callIdxShort: number
  putIdxShort: number
}

/** Foreign portfolio investors' net investment in one month (NSDL, from custodians' reports). */
export interface FpiMonth {
  month: string
  equity: number
  debt: number
  hybrid: number
  mutualFunds: number
  aif: number
  total: number
}

/** One mutual fund category in one month (AMFI). */
export interface MfCategoryMonth {
  month: string
  group: string
  category: string
  schemes: number
  folios: number
  raised: number
  redeemed: number
  net: number
  aum: number | null
}

export interface DealRow {
  date: string
  kind: 'BULK' | 'BLOCK'
  symbol: string
  company: string
  client: string
  side: 'BUY' | 'SELL'
  qty: number
  price: number
}

/** A disclosure under the takeover code: someone crossed or moved within 5%+ of a company. */
export interface StakeDisclosure {
  id: string
  date: string
  symbol: string
  company: string
  party: string
  side: 'BUY' | 'SELL'
  shares: number | null
  /** The stake bought or sold, and held after, as % of the company. */
  changePct: number | null
  afterPct: number | null
  mode: string | null
  promoter: boolean
}

export interface FlowsReport {
  cash: CashFlow[]
  fo: FoPosition[]
  fpi: FpiMonth[]
  mf: MfCategoryMonth[]
  /** Latest month first: total net inflow into equity schemes (active and index) per month. */
  mfEquityByMonth: { month: string; equity: number; debt: number; hybrid: number; total: number }[]
  deals: DealRow[]
  stakes: StakeDisclosure[]
  status: FlowsStatus
}

export interface FlowsStatus {
  enabled: boolean
  refreshing: boolean
  lastError: string | null
  sources: { key: string; label: string; latest: string | null }[]
}

/** Institutions in deal lists: fund houses, insurers, foreign funds, banks. */
export const INSTITUTION = /mutual fund|\bmf\b|insurance|life|\bfund\b|funds|asset management|\bamc\b|capital|investments? (ltd|limited|pte)|pte\.? ltd|\bplc\b|\bllc\b|\bl\.?p\.?\b|bank|trust|pension|sicav|morgan|goldman|societe|nomura|citigroup|bnp|ubs|vanguard|blackrock|fidelity|fmr|government of singapore|abu dhabi|norges/i

/** FII share of index futures held long: the usual "FII long %" read on the market's mood. */
export const longShare = (p: Pick<FoPosition, 'futIdxLong' | 'futIdxShort'>) =>
  p.futIdxLong + p.futIdxShort > 0 ? p.futIdxLong / (p.futIdxLong + p.futIdxShort) : null
