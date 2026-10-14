// Hand-maintained assets (deposits, small savings, bonds, gold, property, crypto, cash, other)
// and the analysis results built on top of every holding. Shared by main and renderer.

import type { PriceSource } from './types'

export const MANUAL_KINDS = [
  'DEPOSIT',
  'RD',
  'PPF',
  'BOND',
  'SGB',
  'METAL',
  'PROPERTY',
  'CRYPTO',
  'CASH',
  'OTHER'
] as const
export type ManualKind = (typeof MANUAL_KINDS)[number]

export const DEPOSIT_SUBTYPES = [
  'BANK_FD',
  'CORPORATE_FD',
  'POST_OFFICE_TD',
  'NSC',
  'KVP',
  'SCSS',
  'POMIS',
  'RBI_BOND',
  'OTHER'
] as const
export type DepositSubtype = (typeof DEPOSIT_SUBTYPES)[number]

export const COMPOUNDING = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'SIMPLE'] as const
export type Compounding = (typeof COMPOUNDING)[number]
export const PAYOUTS = ['CUMULATIVE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const
export type Payout = (typeof PAYOUTS)[number]
export const COUPON_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ZERO'] as const
export type CouponFrequency = (typeof COUPON_FREQUENCIES)[number]

interface Common {
  /** What the person calls it, e.g. "SBI FD 2027" or "Flat in Pune". */
  name: string
  institution?: string
  notes?: string
}

export interface DepositMeta extends Common {
  kind: 'DEPOSIT'
  subtype: DepositSubtype
  principal: number
  /** Annual rate in percent, e.g. 7.25 */
  rate: number
  startDate: string
  maturityDate: string
  compounding: Compounding
  payout: Payout
}

export interface RdMeta extends Common {
  kind: 'RD'
  installment: number
  rate: number
  startDate: string
  months: number
}

export interface PpfMeta extends Common {
  kind: 'PPF'
  scheme: 'PPF' | 'SSY'
  openDate: string
  rate: number
  yearlyContribution: number
}

export interface BondMeta extends Common {
  kind: 'BOND'
  isin?: string
  faceValue: number
  units: number
  couponRate: number
  couponFrequency: CouponFrequency
  /** Price paid per unit. */
  purchasePrice: number
  purchaseDate: string
  maturityDate: string
  /** Latest traded price per unit, if the bond is listed and you track it. */
  marketPrice?: number
}

export interface SgbMeta extends Common {
  kind: 'SGB'
  grams: number
  /** RBI issue price per gram (interest is paid on this). */
  issuePrice: number
  issueDate: string
  /** What you paid per gram, if bought on the exchange rather than at issue. */
  purchasePrice?: number
  purchaseDate?: string
}

export interface MetalMeta extends Common {
  kind: 'METAL'
  metal: 'GOLD' | 'SILVER'
  form: 'PHYSICAL' | 'DIGITAL' | 'JEWELLERY'
  grams: number
  /** Fineness as a fraction: 0.999 (24K), 0.916 (22K), 0.75 (18K). */
  purity: number
  cost: number
  purchaseDate: string
}

export interface PropertyMeta extends Common {
  kind: 'PROPERTY'
  propertyType: 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'OTHER'
  purchasePrice: number
  purchaseDate: string
  /** Optional yearly growth used between your own estimates, in percent. */
  appreciation?: number
  monthlyRent?: number
}

export interface CryptoMeta extends Common {
  kind: 'CRYPTO'
  /** Ticker such as BTC, ETH, SOL. */
  symbol: string
  quantity: number
  cost: number
  purchaseDate: string
}

export interface CashMeta extends Common {
  kind: 'CASH'
  /** Savings interest rate in percent, used for interest income estimates. */
  rate?: number
}

export interface OtherMeta extends Common {
  kind: 'OTHER'
  cost?: number
  purchaseDate?: string
}

export type ManualMeta =
  DepositMeta | RdMeta | PpfMeta | BondMeta | SgbMeta | MetalMeta | PropertyMeta | CryptoMeta | CashMeta | OtherMeta

/** Kinds whose value is kept as dated entries typed by the person (balances or estimates). */
export const ENTRY_KINDS: ManualKind[] = ['PPF', 'PROPERTY', 'CASH', 'OTHER']

export interface ManualAssetInput {
  accountId?: number
  personId: number
  meta: ManualMeta
}

export type Liquidity = 'LIQUID' | 'BREAKABLE' | 'LOCKED' | 'ILLIQUID'

export interface CashEvent {
  date: string
  label: string
  /** Positive = money to you; negative = money you pay in (e.g. an RD instalment). */
  amount: number
  kind: 'INTEREST' | 'COUPON' | 'MATURITY' | 'INSTALMENT' | 'RENT' | 'DIVIDEND'
}

export interface ManualAssetView {
  accountId: number
  instrumentId: number
  personId: number
  personName: string
  meta: ManualMeta
  entries: { date: string; value: number }[]
  value: number | null
  invested: number | null
  priceSource: PriceSource
  maturityDate: string | null
  maturityValue: number | null
  matured: boolean
  liquidity: Liquidity
  lockedUntil: string | null
  nextEvent: CashEvent | null
  /** Points from start to maturity (or a few years ahead) for a growth chart. */
  projection: { date: string; value: number }[]
}

export interface MetalPrices {
  goldPerGram: number | null
  silverPerGram: number | null
  /** Import duty and other India premium applied on top of the international price, in percent. */
  premiumPct: number
  asOf: string | null
}

// ---------------- analysis ----------------

export const CHART_GROUPS = [
  'STOCKS',
  'FUNDS',
  'US',
  'GOLD',
  'DEBT',
  'RETIREMENT',
  'PROPERTY',
  'CRYPTO',
  'OTHER'
] as const
export type ChartGroup = (typeof CHART_GROUPS)[number]

export interface AssetClassScore {
  assetClass: string
  valueInr: number
  investedInr: number | null
  gainInr: number | null
  xirr: number | null
  /** Share of this class's value that has dated cash flows behind its XIRR. */
  xirrCoverage: number
  incomeThisFy: number
  holdings: number
}

export interface AnalysisReport {
  totalInr: number
  xirr: {
    overall: number | null
    coverage: number
    byPerson: { personName: string; xirr: number | null; coverage: number }[]
  }
  scorecard: AssetClassScore[]
  history: { months: string[]; series: { group: ChartGroup; values: number[] }[] }
  income: { fy: string; dividends: number; interest: number; rent: number }[]
  upcoming: (CashEvent & { holding: string; personName: string })[]
  maturities: { year: string; amount: number; items: { name: string; date: string; amount: number }[] }[]
  liquidity: { bucket: Liquidity; valueInr: number }[]
  concentration: { top10Share: number; largest: { name: string; share: number } | null }
  treemap: { instrumentId: number; name: string; group: ChartGroup; valueInr: number; gainPct: number | null }[]
  movers: { name: string; gainInr: number; gainPct: number | null }[]
}

/** Which chart group (and colour) each asset class belongs to; at most eight groups plus Other. */
export const GROUP_OF: Record<import('./types').AssetClass, ChartGroup> = {
  EQUITY_IN: 'STOCKS',
  ETF: 'STOCKS',
  MF: 'FUNDS',
  EQUITY_US: 'US',
  GOLD: 'GOLD',
  FD: 'DEBT',
  BOND: 'DEBT',
  EPF: 'RETIREMENT',
  PPF: 'RETIREMENT',
  NPS: 'RETIREMENT',
  REAL_ESTATE: 'PROPERTY',
  REIT: 'PROPERTY',
  CRYPTO: 'CRYPTO',
  CASH: 'OTHER',
  INSURANCE: 'OTHER',
  OTHER: 'OTHER'
}

/** Result of the automatic monthly portfolio download for one fund house. */
export interface DisclosureStatus {
  amcId: string | null
  amc: string
  page: string | null
  /** Month of the newest disclosure found, YYYY-MM. */
  period: string | null
  state: 'UPDATED' | 'UP_TO_DATE' | 'NOT_FOUND' | 'NO_PAGE' | 'ERROR'
  message: string | null
  files: string[]
  /** Your funds the file was matched to. */
  funds: string[]
  /** Your funds from this house that no sheet matched. */
  unmatched: string[]
  checkedAt: string
}
