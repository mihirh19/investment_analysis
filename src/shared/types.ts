// Types shared by the main process (Node) and the renderer (React).

import type { AnalysisReport, DisclosureStatus, ManualAssetInput, ManualAssetView, MetalPrices } from './assets'

export type Relation = 'SELF' | 'PARENT' | 'SPOUSE' | 'CHILD' | 'OTHER'

export interface Person {
  id: number
  name: string
  relation: Relation
}

export const PLATFORMS = [
  'ZERODHA',
  'GROWW',
  'INDMONEY',
  'MF_RTA', // folios held directly with CAMS / KFintech (via any app)
  'DEMAT_OTHER',
  'EPF',
  'NPS',
  'INSURANCE',
  'BANK',
  'POST_OFFICE',
  'MANUAL',
  'OTHER'
] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  ZERODHA: 'Zerodha',
  GROWW: 'Groww',
  INDMONEY: 'INDmoney',
  MF_RTA: 'MF folio (CAMS/KFin)',
  DEMAT_OTHER: 'Other demat',
  EPF: 'EPF',
  NPS: 'NPS',
  INSURANCE: 'Insurance',
  BANK: 'Bank',
  POST_OFFICE: 'Post office',
  MANUAL: 'Entered by hand',
  OTHER: 'Other'
}

export type AccountKind = 'DEMAT' | 'MF_FOLIO' | 'US_BROKER' | 'EPF' | 'NPS' | 'INSURANCE' | 'MANUAL_ASSET' | 'OTHER'

export interface Account {
  id: number
  personId: number
  platform: Platform
  kind: AccountKind
  name: string
  externalId: string | null
  currency: string
}

export type AssetClass =
  | 'EQUITY_IN'
  | 'EQUITY_US'
  | 'MF'
  | 'ETF'
  | 'BOND'
  | 'FD'
  | 'PPF'
  | 'NPS'
  | 'EPF'
  | 'GOLD'
  | 'REAL_ESTATE'
  | 'REIT'
  | 'CRYPTO'
  | 'INSURANCE'
  | 'CASH'
  | 'OTHER'

export interface Instrument {
  id: number
  isin: string | null
  name: string
  assetClass: AssetClass
  symbolNse: string | null
  tickerUs: string | null
  amfiCode: string | null
  mfType: string | null
  currency: string
}

export type TxnType = 'BUY' | 'SELL' | 'DIVIDEND' | 'DIVIDEND_REINVEST' | 'BONUS' | 'SPLIT' | 'TAX' | 'OTHER'

export interface Transaction {
  id: number
  accountId: number
  instrumentId: number
  date: string // YYYY-MM-DD
  type: TxnType
  quantity: number // signed: +units in, -units out, 0 for cash-only rows
  price: number | null
  amount: number // signed cash flow from the investor's view: buy < 0, sell/dividend > 0
  fees: number
  currency: string
  description: string | null
  source: string
}

export interface HoldingRow {
  personId: number
  personName: string
  accountId: number
  accountName: string
  platform: Platform
  instrumentId: number
  instrumentName: string
  isin: string | null
  symbol: string | null
  assetClass: AssetClass
  currency: string
  quantity: number
  avgCost: number | null // per unit, from transactions (FIFO)
  invested: number | null
  lastPrice: number | null
  priceDate: string | null
  marketValue: number | null
  unrealizedPnl: number | null
  realizedPnl: number
  dividends: number
  /** Units the imported trades add up to at the statement date, when that disagrees with the statement. */
  tradesQuantity: number | null
  prevClose: number | null
  dayChange: number | null
  priceSource: PriceSource
  sector: string | null
  /** 1 for INR holdings; the live USD→INR rate for US holdings. */
  fxRate: number
  marketValueInr: number | null
  /** For US holdings, each purchase converted at the USD→INR rate on its date. */
  investedInr: number | null
  unrealizedPnlInr: number | null
  dayChangeInr: number | null
  /** Where the buy price came from; null when it isn't known. */
  costSource: CostSource | null
}

/**
 * TRADES: your trade history. STATEMENT: the statement printed the cost (MF folios).
 * BROKER: a broker's holdings file. MANUAL: typed in. EARLIER: an older statement's average cost.
 */
export type CostSource = 'TRADES' | 'STATEMENT' | 'BROKER' | 'MANUAL' | 'EARLIER'

/** Where a holding's price came from. */
export type PriceSource = 'LIVE' | 'NAV' | 'STATEMENT' | 'TRADE' | 'ESTIMATE' | 'MANUAL'

export interface MarketSourceStatus {
  key: string
  label: string
  lastSuccess: string | null
  lastError: string | null
  failed: string[]
}

export interface MarketStatus {
  lastRefresh: string | null
  refreshing: boolean
  nseOpen: boolean
  usOpen: boolean
  sources: MarketSourceStatus[]
}

export interface FxInfo {
  usdInr: number | null
  prevClose: number | null
  asOf: string | null
}

export interface PricePoint {
  date: string
  close: number
}

export interface DividendPayment {
  personId: number
  personName: string
  accountName: string
  instrumentId: number
  instrumentName: string
  symbol: string | null
  exDate: string
  perShare: number | null
  quantity: number | null
  gross: number
  /** US dividends: 25% withheld at source (claimable as foreign tax credit). */
  withholding: number
  net: number
  currency: string
  netInr: number
  /** RECORDED: from a statement, trades file or manual entry. ESTIMATED: units held × published dividend. */
  basis: 'RECORDED' | 'ESTIMATED'
}

export interface DividendOutlook {
  instrumentId: number
  instrumentName: string
  symbol: string | null
  currency: string
  /** Dividends per share paid in the last 12 months. */
  trailingPerShare: number
  quantity: number
  /** Last 12 months' payout repeated on today's units, in INR (after US withholding). */
  nextYearInr: number
  yieldOnPrice: number | null
}

export type ExposureAssetType = 'EQUITY' | 'DEBT' | 'GOLD' | 'REAL_ESTATE' | 'CRYPTO' | 'CASH' | 'OTHER'

/** SEBI market-cap band (AMFI list), or where a company falls outside it. */
export type CapBand = 'LARGE' | 'MID' | 'SMALL' | 'FOREIGN' | 'UNLISTED' | 'NOT_BROKEN_DOWN'

export type DebtType =
  | 'GSEC'
  | 'SDL'
  | 'TBILL'
  | 'CORPORATE'
  | 'SECURITISED'
  | 'MONEY_MARKET'
  | 'DEPOSIT'
  | 'SMALL_SAVINGS'
  | 'OTHER'
  | 'NOT_BROKEN_DOWN'
export type DebtRating = 'SOVEREIGN' | 'AAA' | 'AA' | 'A_BELOW' | 'DEPOSIT' | 'UNRATED' | 'NOT_BROKEN_DOWN'

export interface DebtItem {
  name: string
  isin: string | null
  issuer: string
  type: DebtType
  rating: DebtRating
  /** The rating text as the fund house printed it ("CRISIL AAA", "SOVEREIGN"). */
  ratingRaw: string | null
  valueInr: number
  directInr: number
  viaFundsInr: number
}

export interface ExposureReport {
  totalInr: number
  assetMix: { type: ExposureAssetType; valueInr: number }[]
  /** Equity only, after looking inside funds. "Not broken down" holds fund equity with no holdings imported. */
  sectors: { sector: string; valueInr: number; directInr: number; viaFundsInr: number }[]
  /** Every company held, directly or through funds, largest first. */
  companies: {
    name: string
    isin: string | null
    sector: string | null
    cap: CapBand
    valueInr: number
    directInr: number
    viaFundsInr: number
  }[]
  /** Equity by SEBI market-cap band. */
  marketCap: { cap: CapBand; valueInr: number; directInr: number; viaFundsInr: number }[]
  /** Half-year of AMFI's list in use (e.g. 2026-06-30), or null before it is loaded. */
  capListPeriod: string | null
  /** Debt held directly (bonds, deposits, EPF, PPF) and inside funds. */
  debt: {
    totalInr: number
    types: { type: DebtType; valueInr: number }[]
    ratings: { rating: DebtRating; valueInr: number }[]
    items: DebtItem[]
  }
  geography: { region: string; valueInr: number }[]
  funds: { instrumentId: number; name: string; valueInr: number; holdingsAsOf: string | null; source: string | null }[]
}

export interface EpfAccountView {
  accountId: number
  personId: number
  personName: string
  name: string
  uan: string | null
  monthlyContribution: number
  interestRate: number
  entries: { date: string; balance: number }[]
  estimatedBalance: number | null
}

export interface EpfInput {
  accountId?: number
  personId: number
  name: string
  uan?: string
  /** Employee + employer share going into EPF each month. */
  monthlyContribution: number
  /** Annual rate as a percentage, e.g. 8.25. */
  interestRate: number
}

export const POLICY_TYPES = ['TERM', 'ENDOWMENT', 'ULIP', 'MONEY_BACK', 'WHOLE_LIFE', 'HEALTH', 'OTHER'] as const
export type PolicyType = (typeof POLICY_TYPES)[number]
export const PREMIUM_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'SINGLE'] as const
export type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number]

export interface PolicyInput {
  accountId?: number
  personId: number
  insurer: string
  name: string
  policyNumber: string
  type: PolicyType
  sumAssured: number
  premium: number
  premiumFrequency: PremiumFrequency
  startDate?: string
  nextDueDate?: string
  maturityDate?: string
  /** Surrender or fund value today (endowment/ULIP); leave empty for term and health cover. */
  currentValue?: number
}

export interface PolicyView extends PolicyInput {
  accountId: number
  personName: string
  annualPremium: number
  valueDate: string | null
}

export interface NpsHoldingInput {
  personId: number
  pran?: string
  schemeCode: string
  schemeName: string
  units: number
  date: string
}

export type ImportKind =
  'CAS_PDF' | 'ZERODHA_TRADEBOOK' | 'GROWW_ORDERS' | 'GENERIC_TRADES' | 'BROKER_HOLDINGS' | 'FUND_PORTFOLIO' | 'MANUAL'

export interface ImportRequest {
  kind: ImportKind
  personId: number
  filePath: string
  /** Platform for GENERIC_TRADES files (e.g. INDMONEY for US stocks). */
  platform?: Platform
  password?: string
  rememberPassword?: boolean
}

export interface ImportResult {
  batchId: number
  kind: ImportKind
  fileName: string
  accountsCreated: number
  instrumentsCreated: number
  transactionsAdded: number
  transactionsSkipped: number
  snapshotsAdded: number
  warnings: string[]
  /** Informational lines, e.g. which funds a portfolio file was matched to. */
  notes?: string[]
}

export interface ImportBatch {
  id: number
  kind: ImportKind
  fileName: string
  personId: number
  personName: string
  importedAt: string
  summary: ImportResult | null
}

export interface ManualTxnInput {
  personId: number
  platform: Platform
  date: string
  type: Extract<TxnType, 'BUY' | 'SELL' | 'DIVIDEND'>
  assetClass: AssetClass
  name: string
  symbol: string // NSE symbol or US ticker
  isin?: string
  quantity: number
  price: number
  fees?: number
  currency: string
}

/** A market index (or fund) to compare with: weekly closes in rupees, oldest first. */
export interface BenchmarkSeries {
  key: string
  label: string
  /** True when the series includes reinvested dividends/interest; false for a price index. */
  totalReturn: boolean
  points: PricePoint[]
}

/** DIRECT / REGULAR from the scheme name; NOT_STATED for old names without a plan; ETF has no plans. */
export type FundPlan = 'DIRECT' | 'REGULAR' | 'NOT_STATED' | 'ETF'

export interface FundsReport {
  totalFundsInr: number
  funds: {
    instrumentId: number
    name: string
    shortName: string
    fundHouse: string | null
    categoryGroup: string
    category: string
    plan: FundPlan
    valueInr: number
    people: string[]
    holdingsAsOf: string | null
    holdingsSource: string | null
    holdingsCount: number
    /** For Regular plans: the Direct plan of the same scheme and what the difference cost last year. */
    directPlan: { code: string | null; name: string | null; gap1y: number | null; extraCostInr: number | null } | null
  }[]
  overlap: {
    /** Rows/columns of the matrix; id 0 is your directly held shares. */
    portfolios: { id: number; label: string }[]
    /** Share of holdings in common (0..1); null on the diagonal. */
    matrix: (number | null)[][]
    pairs: {
      a: number
      b: number
      overlap: number
      sharedCount: number
      shared: { name: string; isin: string | null; weightA: number; weightB: number }[]
    }[]
  }
  /** Companies reached through more than one route, largest first. */
  companies: { name: string; isin: string | null; valueInr: number; directInr: number; sources: { label: string; valueInr: number }[] }[]
  byHouse: { name: string; valueInr: number; funds: string[] }[]
  byCategory: { group: string; name: string; valueInr: number; funds: string[] }[]
  notes: string[]
}

export type TaxKind = '111A' | '112A' | 'SLAB' | 'LT_OTHER'

/** One sale matched to one purchase lot, with its tax treatment. */
export interface RealizedGain {
  personId: number
  personName: string
  accountName: string
  instrumentId: number
  name: string
  isin: string | null
  taxClass: string
  buyDate: string
  sellDate: string
  fy: string
  units: number
  /** Cost used for tax (grandfathered where that applies), INR. */
  costInr: number
  /** Actual purchase cost, INR. */
  actualCostInr: number
  proceedsInr: number
  gainInr: number
  term: 'ST' | 'LT'
  kind: TaxKind
  rate: number | null
  /** 31 Jan 2018 value per unit, for units bought before 1 Feb 2018. */
  fmv2018: number | null
  grandfathered: boolean
}

/** A purchase lot still held, valued today. */
export interface OpenLot {
  personId: number
  personName: string
  accountName: string
  accountId: number
  instrumentId: number
  name: string
  taxClass: string
  buyDate: string
  units: number
  costInr: number
  valueInr: number
  gainInr: number
  /** If sold today. */
  term: 'ST' | 'LT'
  kind: TaxKind
  /** First day a sale would be long-term (null: never, e.g. debt funds bought after Mar 2023). */
  longTermFrom: string | null
}

export interface TaxYearSummary {
  personId: number
  personName: string
  fy: string
  current: boolean
  shortTermGain: number
  longTermGain: number
  buckets: { kind: TaxKind; rate: number | null; amount: number }[]
  exemptionUsed: number
  exemptionLimit: number
  slabGain: number
  fixedRateTax: number
  carryForward: { shortTerm: number; longTerm: number }
  sales: number
}

export interface HarvestIdea {
  personId: number
  personName: string
  accountName: string
  name: string
  units: number
  valueInr: number
  gainInr: number
}

export interface TaxReport {
  currentFy: string
  years: TaxYearSummary[]
  realized: RealizedGain[]
  lots: OpenLot[]
  unrealized: { shortTermGain: number; shortTermLoss: number; longTermGain: number; longTermLoss: number }
  /** Unused 112A exemption this financial year, per person. */
  exemptionLeft: { personId: number; personName: string; left: number; limit: number }[]
  /** Long-term equity lots to sell (and buy back) to use the rest of this year's exemption. */
  harvest: HarvestIdea[]
  /** Lots in profit that turn long-term within 60 days: waiting lowers the tax. */
  soonLongTerm: OpenLot[]
  /** Lots at a loss: selling books a loss that can be set off against gains. */
  losses: OpenLot[]
  /** Holdings without a purchase-by-purchase history: gains here are estimates with no holding period. */
  estimateOnly: { personName: string; name: string; valueInr: number; gainInr: number | null }[]
  warnings: string[]
}

/** One calendar or financial year of the Performance page. */
export interface PerformanceYear {
  kind: 'CY' | 'FY'
  label: string
  start: string
  end: string
  /** History starts or ends inside this year. */
  partial: boolean
  /** Time-weighted return: what ₹100 held all year became, ignoring when money was added. */
  twr: number | null
  /** The same period's return for each benchmark (by key); null when the index doesn't cover it. */
  benchmarks: Record<string, number | null>
  opening: number
  added: number
  /** Sales and dividends paid out to you. */
  withdrawn: number
  /** Investment gain: price change plus dividends. */
  gain: number
  closing: number
}

export interface PerformanceReport {
  /** Share of today's value with a complete money trail (the part these figures describe). */
  coverage: number
  coveredValueInr: number
  totalValueInr: number
  /** Month-end dates; the last one is today. */
  dates: string[]
  /** Value of the covered holdings at each date. */
  values: number[]
  /** Money put in minus money taken out, cumulative, at each date. */
  netInvested: number[]
  /** Growth of ₹100 at the portfolio's time-weighted return. */
  growth: number[]
  /** Month-by-month return (one fewer than dates). */
  monthly: (number | null)[]
  drawdown: number[]
  maxDrawdown: { depth: number; peak: string; trough: string; recovered: string | null } | null
  /** Trailing 12-month return at each date (null for the first 11 months). */
  rolling12: (number | null)[]
  trailing: { key: '1Y' | '3Y' | '5Y' | 'ALL'; years: number; twr: number | null; benchmarks: Record<string, number | null> }[]
  years: PerformanceYear[]
  benchmarks: {
    key: string
    label: string
    totalReturn: boolean
    /** Growth of ₹100 on the same dates (null before the index starts). */
    growth: (number | null)[]
    /** Your actual money, put into this index on the same days. */
    sameMoney: (number | null)[]
  }[]
  xirr: {
    overall: number | null
    byAccount: { accountId: number; label: string; personName: string; xirr: number | null; valueInr: number }[]
    byHolding: {
      accountId: number
      instrumentId: number
      name: string
      personName: string
      platform: string
      xirr: number | null
      valueInr: number
      gainInr: number | null
    }[]
  }
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Everything the renderer can ask the main process to do (request/response over IPC). */
export interface RequestApi {
  listPersons(): Promise<ApiResult<Person[]>>
  savePerson(p: Omit<Person, 'id'> & { id?: number }): Promise<ApiResult<Person>>
  listAccounts(): Promise<ApiResult<Account[]>>
  listHoldings(personId?: number): Promise<ApiResult<HoldingRow[]>>
  listTransactions(filter: {
    personId?: number
    accountId?: number
    limit?: number
  }): Promise<ApiResult<(Transaction & { instrumentName: string; accountName: string })[]>>
  addManualTransaction(input: ManualTxnInput): Promise<ApiResult<number>>
  deleteTransaction(id: number): Promise<ApiResult<null>>
  pickFile(kind: ImportKind | 'BACKUP'): Promise<ApiResult<string | null>>
  hasSavedCasPassword(personId: number): Promise<ApiResult<boolean>>
  runImport(req: ImportRequest): Promise<ApiResult<ImportResult>>
  listImports(): Promise<ApiResult<ImportBatch[]>>
  undoImport(batchId: number): Promise<ApiResult<null>>

  getMarketStatus(): Promise<ApiResult<MarketStatus>>
  refreshMarket(): Promise<ApiResult<MarketStatus>>
  getFx(): Promise<ApiResult<FxInfo>>
  getPriceHistory(instrumentId: number, range: '1mo' | '6mo' | '1y' | '5y'): Promise<ApiResult<PricePoint[]>>
  listDividends(personId?: number): Promise<ApiResult<{ payments: DividendPayment[]; outlook: DividendOutlook[] }>>
  getExposure(personId?: number): Promise<ApiResult<ExposureReport>>

  listEpf(): Promise<ApiResult<EpfAccountView[]>>
  saveEpf(input: EpfInput): Promise<ApiResult<number>>
  addEpfEntry(accountId: number, date: string, balance: number): Promise<ApiResult<null>>
  deleteEpfEntry(accountId: number, date: string): Promise<ApiResult<null>>

  listPolicies(): Promise<ApiResult<PolicyView[]>>
  savePolicy(input: PolicyInput): Promise<ApiResult<number>>
  deletePolicy(accountId: number): Promise<ApiResult<null>>

  listNpsSchemes(): Promise<ApiResult<{ code: string; name: string }[]>>
  addNpsHolding(input: NpsHoldingInput): Promise<ApiResult<null>>

  listManualAssets(personId?: number): Promise<ApiResult<ManualAssetView[]>>
  saveManualAsset(input: ManualAssetInput): Promise<ApiResult<number>>
  deleteManualAsset(accountId: number): Promise<ApiResult<null>>
  addManualEntry(accountId: number, date: string, value: number): Promise<ApiResult<null>>
  deleteManualEntry(accountId: number, date: string): Promise<ApiResult<null>>
  getMetalPrices(): Promise<ApiResult<MetalPrices>>
  setGoldPremium(pct: number): Promise<ApiResult<MetalPrices>>
  getAnalysis(personId?: number): Promise<ApiResult<AnalysisReport>>
  /** Last ~13 weekly closes per instrument, for sparklines. */
  getSparklines(instrumentIds: number[]): Promise<ApiResult<Record<number, number[]>>>
  /** Weekly benchmark closes in rupees since a date (all stored history when omitted). */
  listBenchmarks(since?: string): Promise<ApiResult<BenchmarkSeries[]>>
  /** Time-weighted returns by year, vs benchmarks, drawdown and XIRR by account and holding. */
  getPerformance(personId?: number): Promise<ApiResult<PerformanceReport>>
  /** Capital gains by financial year, open lots by holding period, harvesting ideas. */
  getTax(personId?: number): Promise<ApiResult<TaxReport>>
  /** Fund overlap, fund houses and categories, Regular vs Direct plans. */
  getFunds(personId?: number): Promise<ApiResult<FundsReport>>
  /** Your own average buy price for a holding (null removes it). */
  setBuyPrice(input: {
    personId: number
    accountId: number
    instrumentId: number
    avgCost: number | null
  }): Promise<ApiResult<null>>

  getDisclosureStatus(): Promise<ApiResult<DisclosureStatus[]>>
  /** Checks fund houses for new monthly portfolios now; force re-downloads the current month. */
  syncDisclosures(force?: boolean): Promise<ApiResult<DisclosureStatus[]>>
  /** Opens an http(s) link in the default browser. */
  openExternal(url: string): Promise<ApiResult<null>>

  getRecoveryKey(): Promise<ApiResult<string>>
  backupDatabase(): Promise<ApiResult<string | null>>
  /** Replaces this computer's data with a backup and restarts the app. */
  restoreDatabase(filePath: string, recoveryKey: string): Promise<ApiResult<null>>
}

/** The bridge exposed as window.api: requests plus a push channel for fresh prices. */
export interface Api extends RequestApi {
  onMarketUpdate(listener: () => void): () => void
}
