import { GROUP_OF, type ChartGroup, type DepositSubtype, type Liquidity, type ManualKind } from '@shared/assets'
import type {
  AssetClass,
  CapBand,
  CostSource,
  DebtRating,
  DebtType,
  ExposureAssetType,
  PriceSource,
  TxnType
} from '@shared/types'

export const ASSET_LABELS: Record<AssetClass, string> = {
  EQUITY_IN: 'Indian stocks',
  ETF: 'ETFs',
  MF: 'Mutual funds',
  EQUITY_US: 'US stocks',
  GOLD: 'Gold & silver',
  FD: 'Deposits',
  BOND: 'Bonds',
  EPF: 'EPF',
  PPF: 'PPF & SSY',
  NPS: 'NPS',
  REAL_ESTATE: 'Property',
  REIT: 'REITs & InvITs',
  CRYPTO: 'Crypto',
  INSURANCE: 'Insurance',
  CASH: 'Cash & savings',
  OTHER: 'Other'
}

export const ASSET_ORDER: AssetClass[] = [
  'EQUITY_IN',
  'ETF',
  'MF',
  'EQUITY_US',
  'GOLD',
  'FD',
  'BOND',
  'EPF',
  'PPF',
  'NPS',
  'REAL_ESTATE',
  'REIT',
  'CRYPTO',
  'INSURANCE',
  'CASH',
  'OTHER'
]

// Chart groups take the eight validated series slots in their reference order; everything
// else shares the neutral "other" ink rather than a ninth hue.
export const GROUP_LABELS: Record<ChartGroup, string> = {
  STOCKS: 'Stocks & ETFs',
  FUNDS: 'Mutual funds',
  US: 'US stocks',
  GOLD: 'Gold & silver',
  DEBT: 'Deposits & bonds',
  RETIREMENT: 'EPF, PPF & NPS',
  PROPERTY: 'Property',
  CRYPTO: 'Crypto',
  OTHER: 'Cash & other'
}

export const GROUP_COLORS: Record<ChartGroup, string> = {
  STOCKS: 'var(--series-1)',
  FUNDS: 'var(--series-2)',
  US: 'var(--series-3)',
  GOLD: 'var(--series-4)',
  DEBT: 'var(--series-5)',
  RETIREMENT: 'var(--series-6)',
  PROPERTY: 'var(--series-7)',
  CRYPTO: 'var(--series-8)',
  OTHER: 'var(--series-other)'
}

/** An asset class wears its chart group's colour, so it matches across every chart. */
export const ASSET_COLORS = Object.fromEntries(
  (Object.keys(ASSET_LABELS) as AssetClass[]).map((c) => [c, GROUP_COLORS[GROUP_OF[c]]])
) as Record<AssetClass, string>

export const MIX_LABELS: Record<ExposureAssetType, string> = {
  EQUITY: 'Equity',
  CASH: 'Cash',
  GOLD: 'Gold & silver',
  DEBT: 'Debt',
  REAL_ESTATE: 'Property',
  CRYPTO: 'Crypto',
  OTHER: 'Other'
}
/** Increasing series-slot order keeps neighbours distinguishable (validated). */
export const MIX_ORDER: ExposureAssetType[] = ['EQUITY', 'CASH', 'GOLD', 'DEBT', 'REAL_ESTATE', 'CRYPTO', 'OTHER']
export const MIX_COLORS: Record<ExposureAssetType, string> = {
  EQUITY: 'var(--series-1)',
  CASH: 'var(--series-3)',
  GOLD: 'var(--series-4)',
  DEBT: 'var(--series-5)',
  REAL_ESTATE: 'var(--series-7)',
  CRYPTO: 'var(--series-8)',
  OTHER: 'var(--series-other)'
}

export const CAP_LABELS: Record<CapBand, { label: string; detail: string }> = {
  LARGE: { label: 'Large cap', detail: 'Top 100 companies by market value' },
  MID: { label: 'Mid cap', detail: 'Companies ranked 101–250' },
  SMALL: { label: 'Small cap', detail: 'Companies ranked 251 and below' },
  FOREIGN: { label: 'Foreign', detail: 'Companies listed outside India' },
  UNLISTED: { label: 'Unlisted or unranked', detail: "Not in AMFI's list (unlisted, newly listed or delisted)" },
  NOT_BROKEN_DOWN: { label: 'Not broken down', detail: 'Fund equity whose holdings aren’t known yet' }
}
/** Size order, then the rest; the three bands take the first validated series slots. */
export const CAP_ORDER: CapBand[] = ['LARGE', 'MID', 'SMALL', 'FOREIGN', 'UNLISTED', 'NOT_BROKEN_DOWN']
export const CAP_COLORS: Record<CapBand, string> = {
  LARGE: 'var(--series-1)',
  MID: 'var(--series-2)',
  SMALL: 'var(--series-3)',
  FOREIGN: 'var(--series-4)',
  UNLISTED: 'var(--series-other)',
  NOT_BROKEN_DOWN: 'var(--rule-strong)'
}

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  GSEC: 'Central government bonds',
  SDL: 'State government loans',
  TBILL: 'Treasury bills',
  CORPORATE: 'Corporate bonds & NCDs',
  SECURITISED: 'Securitised debt',
  MONEY_MARKET: 'Money market (CP & CD)',
  DEPOSIT: 'Bank & company deposits',
  SMALL_SAVINGS: 'EPF, PPF & small savings',
  OTHER: 'Other debt',
  NOT_BROKEN_DOWN: 'Debt funds not broken down'
}
export const RATING_LABELS: Record<DebtRating, { label: string; detail: string }> = {
  SOVEREIGN: { label: 'Sovereign', detail: 'Owed by the central or a state government' },
  AAA: { label: 'AAA & A1+', detail: 'Highest rating, long and short term' },
  AA: { label: 'AA', detail: 'High safety' },
  A_BELOW: { label: 'A and below', detail: 'Adequate safety or weaker' },
  DEPOSIT: { label: 'Deposits', detail: 'Bank and company deposits (not rated like bonds)' },
  UNRATED: { label: 'Unrated', detail: 'No rating given in the disclosure' },
  NOT_BROKEN_DOWN: { label: 'Not broken down', detail: 'Debt funds whose holdings aren’t known yet' }
}
export const RATING_ORDER: DebtRating[] = ['SOVEREIGN', 'AAA', 'AA', 'A_BELOW', 'DEPOSIT', 'UNRATED', 'NOT_BROKEN_DOWN']

export const LIQUIDITY_LABELS: Record<Liquidity, { label: string; detail: string }> = {
  LIQUID: { label: 'Available in days', detail: 'Stocks, funds, crypto, savings, matured deposits' },
  BREAKABLE: { label: 'Can be broken early', detail: 'FDs, bonds, SGBs, gold, with a penalty or a price' },
  LOCKED: { label: 'Locked in', detail: 'EPF, PPF, NPS, NSC and KVP until their dates' },
  ILLIQUID: { label: 'Hard to sell quickly', detail: 'Property and other holdings' }
}
export const LIQUIDITY_ORDER: Liquidity[] = ['LIQUID', 'BREAKABLE', 'LOCKED', 'ILLIQUID']
export const LIQUIDITY_COLORS: Record<Liquidity, string> = {
  LIQUID: 'var(--series-1)',
  BREAKABLE: 'var(--series-3)',
  LOCKED: 'var(--series-4)',
  ILLIQUID: 'var(--series-5)'
}

export const KIND_LABELS: Record<ManualKind, { label: string; plural: string }> = {
  DEPOSIT: { label: 'Fixed deposit or post office scheme', plural: 'Deposits' },
  RD: { label: 'Recurring deposit', plural: 'Recurring deposits' },
  PPF: { label: 'PPF or Sukanya Samriddhi', plural: 'PPF & SSY' },
  BOND: { label: 'Bond or NCD', plural: 'Bonds' },
  SGB: { label: 'Sovereign Gold Bond', plural: 'Sovereign Gold Bonds' },
  METAL: { label: 'Gold or silver', plural: 'Gold & silver' },
  PROPERTY: { label: 'Property', plural: 'Property' },
  CRYPTO: { label: 'Crypto', plural: 'Crypto' },
  CASH: { label: 'Savings or cash', plural: 'Savings & cash' },
  OTHER: { label: 'Something else', plural: 'Other' }
}

export const DEPOSIT_LABELS: Record<DepositSubtype, string> = {
  BANK_FD: 'Bank FD',
  CORPORATE_FD: 'Company FD',
  POST_OFFICE_TD: 'Post Office Time Deposit',
  NSC: 'National Savings Certificate',
  KVP: 'Kisan Vikas Patra',
  SCSS: 'Senior Citizens Savings Scheme',
  POMIS: 'Post Office Monthly Income Scheme',
  RBI_BOND: 'RBI Floating Rate Savings Bond',
  OTHER: 'Other deposit'
}

export const TXN_LABELS: Record<TxnType, string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  DIVIDEND: 'Dividend',
  DIVIDEND_REINVEST: 'Dividend reinvested',
  BONUS: 'Bonus',
  SPLIT: 'Split',
  TAX: 'Tax / duty',
  OTHER: 'Other'
}

export const COST_SOURCE_LABELS: Record<CostSource, string> = {
  TRADES: 'your trades',
  STATEMENT: 'your statement',
  BROKER: 'your broker’s holdings file',
  MANUAL: 'entered by you',
  EARLIER: 'an earlier statement'
}

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  LIVE: 'Live',
  NAV: 'NAV',
  STATEMENT: 'Statement',
  TRADE: 'Last trade',
  ESTIMATE: 'Calculated',
  MANUAL: 'Your estimate'
}
