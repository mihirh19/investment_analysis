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
  /** What kind of home or place it is. */
  subtype?: PropertySubtype
  purchasePrice: number
  purchaseDate: string
  /** Stamp duty, registration, brokerage and other buying costs (part of the cost for tax). */
  buyingCosts?: number
  /** Optional yearly growth used between your own estimates, in percent. */
  appreciation?: number
  /** Legacy single rent figure; tenancies below supersede it. */
  monthlyRent?: number

  /** Where it is: a RESIDEX city (for the live price), and the locality in words. */
  cityId?: number
  cityName?: string
  locality?: string
  /** Carpet area in sq ft (what RESIDEX size bands use). */
  carpetAreaSqft?: number
  /** Built-up or plot area in sq ft, for reference. */
  builtUpAreaSqft?: number
  /**
   * How today's value is worked out: INDEX grows your last estimate (or the purchase) with the
   * city's price index; AREA is carpet area × the city's average price per sq ft, adjusted by
   * premium; MANUAL uses only your own estimates (with appreciation, if set).
   */
  valuation?: 'INDEX' | 'AREA' | 'MANUAL'
  /** For AREA: how much above (+) or below (−) the city average this locality is, in percent. */
  premiumPct?: number
  /** Government guideline value (Jantri) and when it was looked up. */
  jantriValue?: number
  jantriDate?: string

  tenancies?: Tenancy[]
  rentPayments?: RentPayment[]
  expenses?: PropertyExpense[]
}

export const PROPERTY_SUBTYPES = [
  'FLAT',
  'TENEMENT',
  'BUNGALOW',
  'ROW_HOUSE',
  'SHOP',
  'OFFICE',
  'PLOT',
  'LAND',
  'OTHER'
] as const
export type PropertySubtype = (typeof PROPERTY_SUBTYPES)[number]

/** One letting: who, how much, from when to when. */
export interface Tenancy {
  id: string
  tenant: string
  startDate: string
  /** Agreement end (usually 11 months); null while open-ended. */
  endDate?: string | null
  monthlyRent: number
  /** Day of the month rent is due. */
  dueDay?: number
  deposit?: number
  phone?: string
}

export interface RentPayment {
  id: string
  /** When the money came in. */
  date: string
  /** The month it pays for, YYYY-MM. */
  forMonth: string
  amount: number
  tenancyId?: string
  note?: string
}

export const PROPERTY_EXPENSE_KINDS = ['PROPERTY_TAX', 'MAINTENANCE', 'REPAIR', 'INSURANCE', 'LOAN_INTEREST', 'OTHER'] as const
export type PropertyExpenseKind = (typeof PROPERTY_EXPENSE_KINDS)[number]

export interface PropertyExpense {
  id: string
  date: string
  kind: PropertyExpenseKind
  amount: number
  note?: string
}

export type RentStatus = 'PAID' | 'PART' | 'DUE' | 'OVERDUE'

/** One property as the Property page shows it. */
export interface PropertyView {
  accountId: number
  personId: number
  personName: string
  meta: PropertyMeta
  value: number | null
  invested: number
  gain: number | null
  /** Yearly growth of the value since purchase (rent not included). */
  cagr: number | null
  /** XIRR including rent received and expenses paid. */
  totalReturn: number | null
  mode: 'INDEX' | 'AREA' | 'MANUAL'
  /** How the value was worked out, in words. */
  valuationNote: string
  /** Your latest own estimate, if any. */
  lastEstimate: { date: string; value: number } | null
  market: (PropertyMarket & { latest: { date: string; close: number } | null; yoyPct: number | null }) | null
  /** Carpet area × the city's average price for this size of home. */
  areaCheck: { pricePerSqft: number; value: number } | null
  rent: {
    current: Tenancy | null
    /** This financial year's due months, through next month. */
    months: (RentDueMonth & { status: RentStatus })[]
    overdue: number
    overdueMonths: number
    receivedThisFy: number
    receivedLast12m: number
    /** Days until the current agreement ends (negative once ended). */
    endsInDays: number | null
    /** True while rent is assumed (no payments recorded yet). */
    assumed: boolean
  } | null
  /** This financial year, as for "Income from house property". */
  fy: {
    label: string
    rentReceived: number
    propertyTax: number
    otherExpenses: number
    loanInterest: number
    /** Rent − property tax − 30% standard deduction − loan interest (let-out property). */
    taxableIncome: number | null
  }
  yield: { gross: number; net: number } | null
}

export interface RentDueMonth {
  month: string
  dueDate: string
  amount: number
  paid: number
  tenancyId: string
  tenant: string
}

/** A city NHB RESIDEX reports home prices for. */
export interface HousingCity {
  id: number
  name: string
  state: string
}

/** A property's place in its city's housing market, for the Property page. */
export interface PropertyMarket {
  cityId: number
  cityName: string
  /** Size band used for this home, and the city's price per sq ft in it by quarter. */
  band: 'ALL' | 'LT60' | '60TO110' | 'GT110'
  series: { date: string; close: number }[]
  /** Overall city price per sq ft by quarter, for comparison. */
  cityAll: { date: string; close: number }[]
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
