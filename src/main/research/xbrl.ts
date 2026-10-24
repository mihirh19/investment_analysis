import type { Balance, Basis, Filing, Flow } from '@shared/research'

// Reads the XBRL file a company files with its quarterly results. Two taxonomies are in use: BSE's
// "in-bse-fin" (to Dec 2024) and SEBI's integrated filing "in-capmkt" (Mar 2025 on); the tag names
// match, so tags are read by local name. Contexts: OneD = the quarter, FourD = the year so far,
// OneI = the balance sheet date. Banks file a different set of tags (interest earned, provisions…).

type Facts = Map<string, number>

const TAG = /<([\w-]+):(\w+)\b([^>]*?)>([^<]*)<\/\1:\2>/g
const CONTEXT = /contextRef="([^"]+)"/

/** Reads one results filing; null when the file is not a results filing at all. */
export function parseResultsXbrl(xml: string): Filing | null {
  const ctx: Record<'OneD' | 'FourD' | 'OneI', Facts> = { OneD: new Map(), FourD: new Map(), OneI: new Map() }
  const text = new Map<string, string>()
  for (const m of xml.matchAll(TAG)) {
    const c = CONTEXT.exec(m[3])?.[1]
    if (c !== 'OneD' && c !== 'FourD' && c !== 'OneI') continue
    const name = m[2]
    const raw = m[4].trim()
    const n = Number(raw)
    if (raw !== '' && Number.isFinite(n)) {
      if (!ctx[c].has(name)) ctx[c].set(name, n)
    } else if (c === 'OneD' && !text.has(name)) text.set(name, raw)
    if (c === 'FourD' && name === 'DateOfStartOfReportingPeriod') text.set('YtdStart', raw)
  }
  const symbol = text.get('Symbol')
  const periodEnd = text.get('DateOfEndOfReportingPeriod')
  if (!symbol || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return null
  const nature = (text.get('NatureOfReportStandaloneConsolidated') ?? '').toLowerCase()
  const basis: Basis = nature.startsWith('consolidated') ? 'C' : 'S'
  const bank = ctx.OneD.has('InterestEarned') || text.has('NameOfBank')
  const ytdStart = text.get('YtdStart')
  const months = ytdStart ? monthsCovered(ytdStart, periodEnd) : 3
  const shareCapital = ctx.OneD.get('PaidUpValueOfEquityShareCapital') ?? null
  const faceValue = ctx.OneD.get('FaceValueOfEquityShareCapital') ?? null
  return {
    symbol: symbol.toUpperCase(),
    periodEnd,
    basis,
    bank,
    months,
    quarter: flow(ctx.OneD, bank),
    ytd: ctx.FourD.size ? flow(ctx.FourD, bank) : {},
    balance: ctx.OneI.size ? balance(ctx.OneI, bank) : null,
    shareCapital: shareCapital || null,
    faceValue: faceValue || null
  }
}

function monthsCovered(start: string, end: string): number {
  const m = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1
  return m > 0 && m <= 12 ? m : 3
}

const sum = (m: Facts, ...keys: string[]): number | undefined => {
  const vals = keys.map((k) => m.get(k)).filter((v): v is number => v !== undefined)
  return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
}
/** The first tag present; a zero is skipped when a later tag has a figure (standalone files fill some with 0). */
const first = (m: Facts, ...keys: string[]): number | undefined => {
  let zero: number | undefined
  for (const k of keys) {
    const v = m.get(k)
    if (v === undefined) continue
    if (v !== 0) return v
    zero = 0
  }
  return zero
}

function flow(m: Facts, bank: boolean): Flow {
  const otherIncome = m.get('OtherIncome')
  const finance = bank ? undefined : m.get('FinanceCosts')
  const depreciation = m.get('DepreciationDepletionAndAmortisationExpense')
  const pbt = first(m, 'ProfitBeforeTax', 'ProfitLossFromOrdinaryActivitiesBeforeTax')
  const exceptional = first(m, 'ExceptionalItemsBeforeTax', 'ExceptionalItems')
  const beforeOneOffs = m.get('ProfitBeforeExceptionalItemsAndTax') ?? (pbt !== undefined ? pbt - (exceptional ?? 0) : undefined)
  const operatingProfit = bank
    ? m.get('OperatingProfitBeforeProvisionAndContingencies')
    : beforeOneOffs !== undefined
      ? beforeOneOffs + (finance ?? 0) + (depreciation ?? 0) - (otherIncome ?? 0)
      : undefined
  const netProfit = first(m, 'ProfitLossForPeriod', 'ProfitLossForThePeriod')
  const out: Flow = {
    revenue: bank ? m.get('Income') : m.get('RevenueFromOperations'),
    otherIncome,
    totalIncome: m.get('Income'),
    expenses: first(m, 'Expenses', 'ExpenditureExcludingProvisionsAndContingencies'),
    materials: sum(m, 'CostOfMaterialsConsumed', 'PurchasesOfStockInTrade', 'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade'),
    employee: first(m, 'EmployeeBenefitExpense', 'EmployeesCost'),
    finance,
    depreciation,
    otherExpenses: first(m, 'OtherExpenses', 'OtherOperatingExpenses'),
    operatingProfit,
    interestEarned: bank ? m.get('InterestEarned') : undefined,
    interestExpended: bank ? m.get('InterestExpended') : undefined,
    provisions: bank ? m.get('ProvisionsOtherThanTaxAndContingencies') : undefined,
    exceptional,
    pbt,
    tax: m.get('TaxExpense'),
    netProfit,
    ownersProfit:
      first(m, 'ProfitOrLossAttributableToOwnersOfParent', 'ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates') ||
      netProfit,
    eps: first(
      m,
      'BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations',
      'BasicEarningsPerShareAfterExtraordinaryItems',
      'BasicEarningsLossPerShareFromContinuingOperations'
    ),
    cfo: m.get('CashFlowsFromUsedInOperatingActivities'),
    cfi: m.get('CashFlowsFromUsedInInvestingActivities'),
    cff: m.get('CashFlowsFromUsedInFinancingActivities'),
    capex: sum(m, 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities'),
    dividendsPaid: m.get('DividendsPaidClassifiedAsFinancingActivities')
  }
  return clean(out)
}

function balance(m: Facts, bank: boolean): Balance {
  const equity = first(m, 'EquityAttributableToOwnersOfParent', 'Equity') || sum(m, 'Capital', 'ReservesAndSurplus')
  const out: Balance = bank
    ? {
        assets: m.get('Assets'),
        cash: sum(m, 'CashAndBalancesWithReserveBankOfIndia', 'BalancesWithBanksAndMoneyAtCallAndShortNotice'),
        investments: m.get('Investments'),
        fixedAssets: m.get('FixedAssets'),
        equity,
        totalEquity: equity,
        borrowings: m.get('Borrowings'),
        deposits: m.get('Deposits'),
        advances: m.get('Advances')
      }
    : {
        assets: m.get('Assets'),
        currentAssets: m.get('CurrentAssets'),
        cash: sum(m, 'CashAndCashEquivalents', 'BankBalanceOtherThanCashAndCashEquivalents'),
        investments: sum(m, 'CurrentInvestments', 'NoncurrentInvestments'),
        inventories: m.get('Inventories'),
        receivables: sum(m, 'TradeReceivablesCurrent', 'TradeReceivablesNoncurrent'),
        fixedAssets: sum(m, 'PropertyPlantAndEquipment', 'CapitalWorkInProgress', 'OtherIntangibleAssets', 'IntangibleAssetsUnderDevelopment'),
        equity,
        totalEquity: m.get('Equity') || equity,
        borrowings: sum(m, 'BorrowingsCurrent', 'BorrowingsNoncurrent'),
        currentLiabilities: m.get('CurrentLiabilities'),
        payables:
          m.get('TradePayablesCurrent') ??
          sum(m, 'TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterpriseCurrent', 'TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseCurrent')
      }
  // Every balance sheet has total assets; segment-only figures under OneI are not a balance sheet.
  return out.assets ? clean(out) : {}
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}
