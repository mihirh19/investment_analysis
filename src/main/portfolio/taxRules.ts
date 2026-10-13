import type { TaxKind } from '@shared/types'
import { addMonths, financialYearOf } from './dates'

export type { TaxKind }

// Indian capital-gains rules for what this app can hold, as an estimate. Hard-coded from the
// Finance Acts up to Budget 2024 (Finance (No. 2) Act 2024) and the 2025 change to "specified mutual
// funds". Not modelled: surcharge, indexation for pre-23-Jul-2024 sales of debt and US assets,
// brought-forward losses, the slab itself (shown as "at your slab"), and STT/cost-inflation details.

/** How a security is taxed. */
export type TaxClass =
  /** Listed shares, equity funds and equity ETFs, REIT/InvIT units: sections 111A / 112A. */
  | 'EQUITY'
  /** Debt funds and debt ETFs (more than 65% in debt). */
  | 'DEBT_FUND'
  /** Gold, silver, international and fund-of-fund schemes that are neither equity nor debt funds. */
  | 'OTHER_FUND'
  /** Listed non-fund securities other than shares: bonds, NCDs, SGBs bought on the exchange. */
  | 'LISTED_OTHER'
  /** Shares listed abroad (US stocks and ETFs): unlisted for Indian tax. */
  | 'FOREIGN'

// TaxKind: '111A' / '112A' listed-equity short / long term at fixed rates; 'SLAB' added to income;
// 'LT_OTHER' other long-term gains at a fixed rate.

export interface TaxTreatment {
  term: 'ST' | 'LT'
  kind: TaxKind
  /** Fixed rate, or null for slab. */
  rate: number | null
  /** The date from which a sale would be long-term, or null if it never becomes long-term. */
  longTermFrom: string | null
}

/** Budget 2024: new rates and holding periods for transfers on or after this date. */
export const BUDGET_2024 = '2024-07-23'
/** Finance Act 2023: debt funds bought on or after this date are always short-term (section 50AA). */
export const SPECIFIED_FUND_START = '2023-04-01'
/** Finance Act 2025: from this date only funds with more than 65% in debt count as specified. */
export const SPECIFIED_FUND_NARROWED = '2025-04-01'
/** Grandfathering for shares and equity funds bought before this date (section 112A). */
export const GRANDFATHER_DATE = '2018-01-31'

/** Exemption on long-term gains under 112A for the financial year of a sale. */
export function ltcgExemption(fyLabel: string): number {
  // FY25 (2024-25) onwards: ₹1.25 lakh for the whole year.
  return Number(fyLabel.slice(2)) >= 25 ? 125_000 : 100_000
}

const longTermAfter = (buy: string, months: number) => addMonths(buy, months)

/** Held for more than `months`: the sale is on or after the day after the anniversary. */
function isLong(buy: string, sell: string, months: number): boolean {
  return sell > longTermAfter(buy, months)
}

/** The first day a sale is long-term after `months`. */
function firstLongDay(buy: string, months: number): string {
  const d = new Date(`${longTermAfter(buy, months)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Tax treatment of selling a lot bought on `buy` on `sell`. */
export function treatment(cls: TaxClass, buy: string, sell: string): TaxTreatment {
  const post = sell >= BUDGET_2024
  const make = (months: number | null, ltKind: TaxKind, ltRate: number, stKind: TaxKind, stRate: number | null) => {
    const lt = months !== null && isLong(buy, sell, months)
    return {
      term: lt ? ('LT' as const) : ('ST' as const),
      kind: lt ? ltKind : stKind,
      rate: lt ? ltRate : stRate,
      longTermFrom: months === null ? null : firstLongDay(buy, months)
    }
  }
  switch (cls) {
    case 'EQUITY':
      return make(12, '112A', post ? 0.125 : 0.1, '111A', post ? 0.2 : 0.15)
    case 'DEBT_FUND':
      if (buy >= SPECIFIED_FUND_START) return make(null, 'SLAB', 0, 'SLAB', null)
      return make(post ? 24 : 36, 'LT_OTHER', post ? 0.125 : 0.2, 'SLAB', null)
    case 'OTHER_FUND':
      // Bought 1 Apr 2023 – 31 Mar 2025 and sold before 1 Apr 2025: still a specified fund (slab).
      if (buy >= SPECIFIED_FUND_START && sell < SPECIFIED_FUND_NARROWED) return make(null, 'SLAB', 0, 'SLAB', null)
      return make(post ? 24 : 36, 'LT_OTHER', post ? 0.125 : 0.2, 'SLAB', null)
    case 'LISTED_OTHER':
      return make(12, 'LT_OTHER', post ? 0.125 : 0.1, 'SLAB', null)
    case 'FOREIGN':
      return make(24, 'LT_OTHER', post ? 0.125 : 0.2, 'SLAB', null)
  }
}

/**
 * Cost for a long-term equity sale under the 112A grandfathering rule: for units bought before
 * 1 Feb 2018, the higher of actual cost and the lower of (31 Jan 2018 value, sale value).
 */
export function grandfatheredCost(cost: number, fmv31Jan2018: number | null, proceeds: number): number {
  if (fmv31Jan2018 === null) return cost
  return Math.max(cost, Math.min(fmv31Jan2018, proceeds))
}

// ---------------- classifying instruments ----------------

const GOLD = /\b(gold|silver)\b/i
const FOREIGN_THEME = /nasdaq|s&p ?500|hang seng|nyse|fang|international|global|overseas|world|u\.?s\.? |us equity|greater china|japan|taiwan|emerging market/i
const DEBT = /\bdebt\b|liquid|gilt|money market|overnight|\bbond\b|bharat bond|income fund|duration|credit risk|banking (and|&) psu|floater|floating rate|target maturity|g-?sec|\bsdl\b|corporate bond|conservative hybrid|ultra short|low duration|short term fund|crisil.*(debt|gilt)|psu bond/i
const EQUITY = /equity|elss|tax saver|arbitrage|aggressive hybrid|equity savings|flexi ?cap|large ?cap|mid ?cap|small ?cap|multi ?cap|focused|value fund|contra|dividend yield|sectoral|thematic|nifty|sensex|bse ?\d|index fund/i

export function taxClassOf(i: {
  assetClass: string
  name: string
  mfType?: string | null
  mfCategory?: string | null
}): TaxClass | null {
  const text = `${i.mfCategory ?? ''} ${i.mfType ?? ''} ${i.name}`
  switch (i.assetClass) {
    case 'EQUITY_IN':
    case 'REIT':
      return 'EQUITY'
    case 'EQUITY_US':
      return 'FOREIGN'
    case 'BOND':
    case 'GOLD':
      return 'LISTED_OTHER'
    case 'ETF':
    case 'MF': {
      if (GOLD.test(i.name) || /fund of funds|fof/i.test(text)) {
        // A domestic equity FoF is still taxed as an other fund (it holds fund units, not shares).
        return DEBT.test(i.name) ? 'DEBT_FUND' : 'OTHER_FUND'
      }
      if (FOREIGN_THEME.test(text)) return 'OTHER_FUND'
      // AMFI's category is the most reliable signal, then the statement's type, then the name.
      const cat = i.mfCategory ?? ''
      if (/debt scheme|conservative hybrid/i.test(cat)) return 'DEBT_FUND'
      if (/equity scheme|aggressive hybrid|arbitrage|equity savings|balanced advantage|dynamic asset/i.test(cat))
        return 'EQUITY'
      const type = i.mfType?.toUpperCase()
      if (type === 'DEBT' || type === 'LIQUID') return 'DEBT_FUND'
      if (type === 'EQUITY') return 'EQUITY'
      // "Equity & Debt Fund" is an aggressive hybrid (taxed as equity), so "equity" in the name wins over "debt".
      if (/\bequity\b|elss|tax saver|balanced advantage/i.test(i.name)) return 'EQUITY'
      if (DEBT.test(text)) return 'DEBT_FUND'
      if (EQUITY.test(text)) return 'EQUITY'
      // Equity ETFs are the norm on NSE; an unrecognised fund is treated as "other" rather than guessed.
      return i.assetClass === 'ETF' ? 'EQUITY' : 'OTHER_FUND'
    }
    default:
      return null
  }
}

export const TAX_CLASS_LABELS: Record<TaxClass, string> = {
  EQUITY: 'Listed shares & equity funds',
  DEBT_FUND: 'Debt funds',
  OTHER_FUND: 'Gold, international & other funds',
  LISTED_OTHER: 'Bonds, SGBs & other listed',
  FOREIGN: 'US & foreign shares'
}

// ---------------- one year's tax ----------------

export interface Gain {
  term: 'ST' | 'LT'
  kind: TaxKind
  rate: number | null
  amount: number
}

export interface YearTax {
  fy: string
  /** Net gain per bucket after setting off losses, before the 112A exemption. */
  buckets: { kind: TaxKind; rate: number | null; amount: number }[]
  shortTermGain: number
  longTermGain: number
  /** 112A gains covered by the yearly exemption. */
  exemptionUsed: number
  exemptionLimit: number
  /** Gains added to income and taxed at your slab. */
  slabGain: number
  /** Tax on the fixed-rate gains, before the 4% cess and any surcharge. */
  fixedRateTax: number
  /** Losses left over to carry forward (up to 8 years, if the return is filed on time). */
  carryForward: { shortTerm: number; longTerm: number }
}

/**
 * One person's tax on one financial year of sales. Short-term losses can be set off against any gain,
 * long-term losses only against long-term gains; both are applied to the highest-taxed gains first
 * (slab gains are assumed to be taxed at least as high as 20%).
 */
export function yearTax(fy: string, gains: Gain[]): YearTax {
  const key = (g: { kind: TaxKind; rate: number | null }) => `${g.kind}|${g.rate ?? 'slab'}`
  const pos = new Map<string, { kind: TaxKind; rate: number | null; amount: number }>()
  let stLoss = 0
  let ltLoss = 0
  for (const g of gains) {
    if (g.amount < 0) {
      if (g.term === 'ST') stLoss -= g.amount
      else ltLoss -= g.amount
      continue
    }
    const k = key(g)
    const b = pos.get(k) ?? { kind: g.kind, rate: g.rate, amount: 0 }
    b.amount += g.amount
    pos.set(k, b)
  }
  const buckets = [...pos.values()]
  const order = (kinds: TaxKind[]) =>
    buckets
      .filter((b) => kinds.includes(b.kind))
      .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (b.rate ?? 1) - (a.rate ?? 1))
  const absorb = (loss: number, into: typeof buckets) => {
    for (const b of into) {
      const used = Math.min(loss, b.amount)
      b.amount -= used
      loss -= used
    }
    return loss
  }
  stLoss = absorb(stLoss, order(['SLAB', '111A', 'LT_OTHER', '112A']))
  ltLoss = absorb(ltLoss, order(['LT_OTHER', '112A']))

  const limit = ltcgExemption(fy)
  let exemptLeft = limit
  // The exemption goes to the higher-rate 112A gains first (matters only in FY25's two-rate year).
  for (const b of order(['112A'])) {
    const used = Math.min(exemptLeft, b.amount)
    exemptLeft -= used
    ;(b as { exempt?: number }).exempt = used
  }
  const exemptionUsed = limit - exemptLeft
  const fixedRateTax = buckets.reduce(
    (s, b) => s + (b.rate === null ? 0 : (b.amount - ((b as { exempt?: number }).exempt ?? 0)) * b.rate),
    0
  )
  const sum = (kinds: TaxKind[]) => buckets.filter((b) => kinds.includes(b.kind)).reduce((s, b) => s + b.amount, 0)
  return {
    fy,
    buckets: buckets.map(({ kind, rate, amount }) => ({ kind, rate, amount })).filter((b) => b.amount > 0.005),
    shortTermGain: sum(['111A', 'SLAB']),
    longTermGain: sum(['112A', 'LT_OTHER']),
    exemptionUsed,
    exemptionLimit: limit,
    slabGain: sum(['SLAB']),
    fixedRateTax,
    carryForward: { shortTerm: stLoss, longTerm: ltLoss }
  }
}

export const fyLabelOf = (iso: string) => financialYearOf(iso).label
