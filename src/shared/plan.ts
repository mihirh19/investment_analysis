// The forecast: where today's money, SIPs and contributions lead, in rupees of then and of today,
// with inflation by spending category. Shared by main and renderer.

/** Where money grows, each at its own assumed rate. */
export const PLAN_BUCKETS = ['EQUITY', 'DEBT', 'GOLD', 'EPF', 'PPF', 'NPS', 'PROPERTY', 'CASH', 'OTHER'] as const
export type PlanBucket = (typeof PLAN_BUCKETS)[number]

/** Spending categories, each tied to an official CPI series for its default inflation. */
export const EXPENSE_KEYS = [
  'GROCERY',
  'RENT',
  'HEALTH',
  'EDUCATION',
  'TRANSPORT',
  'FUEL_POWER',
  'CLOTHING',
  'HOUSEHOLD',
  'PERSONAL',
  'LEISURE',
  'EMI',
  'OTHER'
] as const
export type ExpenseKey = (typeof EXPENSE_KEYS)[number]

export const EXPENSE_LABELS: Record<ExpenseKey, string> = {
  GROCERY: 'Groceries and food',
  RENT: 'Rent and housing',
  HEALTH: 'Health and medicines',
  EDUCATION: 'School and education',
  TRANSPORT: 'Transport, phone and internet',
  FUEL_POWER: 'Electricity, gas and cooking fuel',
  CLOTHING: 'Clothes and shoes',
  HOUSEHOLD: 'Household help and goods',
  PERSONAL: 'Personal care and jewellery',
  LEISURE: 'Outings, travel and fun',
  EMI: 'Loan EMIs (fixed)',
  OTHER: 'Everything else'
}

export const PLAN_BUCKET_LABELS: Record<PlanBucket, string> = {
  EQUITY: 'Shares and equity funds',
  DEBT: 'Debt funds, FDs and bonds',
  GOLD: 'Gold and silver',
  EPF: 'EPF',
  PPF: 'PPF and Sukanya',
  NPS: 'NPS',
  PROPERTY: 'Property',
  CASH: 'Savings accounts',
  OTHER: 'Crypto and other'
}

export interface PlanExpense {
  key: ExpenseKey
  /** Spent per month today, ₹. */
  monthly: number
  /** Inflation used, % a year; null follows the official CPI (10 years) for the category. */
  inflation: number | null
}

export interface PlanSip {
  id: string
  personId: number
  name: string
  monthly: number
  /** Raised by this much every year, %. */
  stepUpPct: number
  bucket: PlanBucket
  /** YYYY-MM it started (step-ups fall in this month each year). */
  start: string
  /** Last year it runs; null: until retirement (or the end of the forecast). */
  endYear: number | null
}

export interface PlanGoal {
  id: string
  name: string
  /** What it would cost today, ₹. */
  costToday: number
  year: number
  /** Which category's inflation it follows. */
  category: ExpenseKey | 'GENERAL'
  /** Paid out of the investments in that year (else just shown against them). */
  fromPortfolio: boolean
}

export interface Plan {
  targetYear: number
  /** Investing stops and living costs are drawn from the investments from this year. */
  retireYear: number | null
  /** Birth years, for ages on the timeline. */
  birthYears: Record<number, number>
  returns: Record<PlanBucket, number>
  /** General inflation for "today's money", % a year. */
  inflation: number
  /** Share of the investments that can be drawn each year in retirement, %. */
  withdrawalRate: number
  /** How much better or worse returns could be, ± percentage points, for the range. */
  spread: number
  /** EPF contributions rise this much a year with salary, %. */
  epfGrowth: number
  expenses: PlanExpense[]
  sips: PlanSip[]
  goals: PlanGoal[]
}

/** Official inflation for a category: All-India CPI (combined), base 2012. */
export interface CpiFigure {
  /** MoSPI series it comes from. */
  series: string
  tenYear: number
  fiveYear: number
  /** Year on year, latest month. */
  latest: number
}

export interface CpiSummary {
  /** Month of the latest index used, YYYY-MM. */
  asOf: string
  general: CpiFigure
  byCategory: Partial<Record<ExpenseKey, CpiFigure>>
  /** True when these are the figures built into the app (no download yet). */
  builtIn: boolean
}

export interface ForecastYear {
  year: number
  /** Value at the end of the year, ₹ of that year. */
  nominal: number
  /** The same in today's money (general inflation). */
  real: number
  /** In today's money by your own spending's inflation. */
  realPersonal: number
  low: number
  high: number
  /** Money put in so far (SIPs, EPF), ₹ of the time. */
  putIn: number
  /** Living costs for the year, ₹ of that year (household view). */
  yearlyCosts: number
  /** Drawn for goals and living costs that year. */
  drawn: number
  byBucket: Record<PlanBucket, number>
  ages: { personId: number; name: string; age: number }[]
}

export interface Forecast {
  plan: Plan
  cpi: CpiSummary
  /** Household figures (costs, goals, retirement draws) apply: the family view. */
  household: boolean
  startValue: number
  startByBucket: Record<PlanBucket, number>
  /** Monthly SIPs today, and the month's EPF contribution. */
  sipMonthly: number
  epfMonthly: number
  years: ForecastYear[]
  /** Weighted by your spending: the yearly rate at which your costs grow over the forecast. */
  personalInflation: number | null
  expenses: {
    key: ExpenseKey
    label: string
    monthly: number
    inflation: number
    /** Where the rate comes from. */
    source: 'CPI' | 'CUSTOM'
    cpi: CpiFigure | null
    /** Per month in the target year. */
    monthlyThen: number
  }[]
  goals: (PlanGoal & { costThen: number; funded: boolean | null })[]
  /** First year the investments could pay the year's living costs at the withdrawal rate. */
  freedomYear: number | null
  /** At retirement: what is needed (costs ÷ withdrawal rate) and what is projected. */
  retirement: { year: number; needed: number; projected: number; lastsUntil: number | null } | null
  /** SIPs seen in the mutual fund purchases of the last six months, not yet in the plan. */
  detectedSips: Omit<PlanSip, 'id'>[]
  notes: string[]
}
