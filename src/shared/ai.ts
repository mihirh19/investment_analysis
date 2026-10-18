// Claude features: reading statements into spending, and answering questions about the books.
// Shared by main and renderer.

export interface AiFeatures {
  statements?: boolean
  chat?: boolean
  chatMail?: boolean
}

export interface AiStatus {
  hasKey: boolean
  keyEnding: string | null
  /** Each feature is switched on separately: it sends something off this computer. */
  statements: boolean
  chat: boolean
  /** Ask your money may search and read the connected Gmail accounts. */
  chatMail: boolean
  model: string
  /** This calendar month's use and its approximate cost at list prices. */
  month: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number }
}

export const SPEND_CATEGORIES = [
  'GROCERIES',
  'FOOD_DINING',
  'FUEL',
  'TRANSPORT',
  'SHOPPING',
  'TRAVEL',
  'BILLS_UTILITIES',
  'RENT',
  'EDUCATION',
  'HEALTH',
  'ENTERTAINMENT',
  'PERSONAL_CARE',
  'INSURANCE',
  'EMI_LOAN',
  'INVESTMENT',
  'TAX',
  'FEES_CHARGES',
  'CASH_WITHDRAWAL',
  'TRANSFER',
  'CARD_PAYMENT',
  'SALARY_INCOME',
  'INTEREST_INCOME',
  'REFUND_CASHBACK',
  'OTHER'
] as const
export type SpendCategory = (typeof SPEND_CATEGORIES)[number]

export const SPEND_CATEGORY_LABELS: Record<SpendCategory, string> = {
  GROCERIES: 'Groceries',
  FOOD_DINING: 'Food and dining out',
  FUEL: 'Fuel',
  TRANSPORT: 'Cabs, trains and transport',
  SHOPPING: 'Shopping',
  TRAVEL: 'Travel and hotels',
  BILLS_UTILITIES: 'Bills: power, phone, internet',
  RENT: 'Rent',
  EDUCATION: 'Education',
  HEALTH: 'Health and medicines',
  ENTERTAINMENT: 'Entertainment and subscriptions',
  PERSONAL_CARE: 'Personal care',
  INSURANCE: 'Insurance premiums',
  EMI_LOAN: 'EMIs and loans',
  INVESTMENT: 'Investments (SIPs, brokers)',
  TAX: 'Taxes',
  FEES_CHARGES: 'Bank fees and charges',
  CASH_WITHDRAWAL: 'Cash withdrawn',
  TRANSFER: 'Transfers between accounts',
  CARD_PAYMENT: 'Credit card bill payment',
  SALARY_INCOME: 'Salary and income',
  INTEREST_INCOME: 'Interest received',
  REFUND_CASHBACK: 'Refunds and cashback',
  OTHER: 'Other'
}

/** Money that moves between your own pockets or into investments: not spending. */
export const NOT_SPENDING: SpendCategory[] = ['TRANSFER', 'CARD_PAYMENT', 'INVESTMENT', 'SALARY_INCOME', 'INTEREST_INCOME', 'REFUND_CASHBACK']

export type SpendAccountKind = 'CREDIT_CARD' | 'BANK_ACCOUNT'

export interface SpendAccount {
  id: number
  personId: number
  personName: string
  kind: SpendAccountKind
  institution: string
  name: string
  last4: string | null
}

export interface StatementView {
  id: number
  accountId: number
  periodFrom: string | null
  periodTo: string | null
  statementDate: string | null
  dueDate: string | null
  totalDue: number | null
  minimumDue: number | null
  creditLimit: number | null
  closingBalance: number | null
  rewardPoints: number | null
  transactions: number
  source: string
  addedAt: string
  /** Paid in full as seen in a later statement or a bank debit, when known. */
  paid: boolean | null
}

export interface SpendTxn {
  id: number
  accountId: number
  statementId: number
  date: string
  description: string
  merchant: string | null
  /** Positive: money out. Negative: money in. */
  amount: number
  category: SpendCategory
  /** Changed by hand (kept when the statement is read again). */
  edited: boolean
  isEmi: boolean
}

export interface SpendingReport {
  accounts: (SpendAccount & { latest: StatementView | null })[]
  months: string[]
  /** Spending (money out, excluding transfers, card payments and investments) by month and category. */
  byMonth: { month: string; total: number; byCategory: Partial<Record<SpendCategory, number>> }[]
  /** Card bills not yet seen paid, earliest due first. */
  dues: { accountId: number; name: string; dueDate: string; totalDue: number; minimumDue: number | null }[]
  transactions: SpendTxn[]
}

/** What Claude read from one statement, before it is saved. */
export interface StatementRead {
  kind: 'CREDIT_CARD' | 'BANK_ACCOUNT' | 'CONTRACT_NOTE' | 'OTHER'
  institution: string
  accountName: string
  last4: string | null
  holderName: string | null
  periodFrom: string | null
  periodTo: string | null
  statementDate: string | null
  dueDate: string | null
  totalDue: number | null
  minimumDue: number | null
  creditLimit: number | null
  openingBalance: number | null
  closingBalance: number | null
  rewardPoints: number | null
  transactions: {
    date: string
    description: string
    merchant: string | null
    amount: number
    direction: 'DEBIT' | 'CREDIT'
    category: SpendCategory
    isEmi: boolean
  }[]
  trades: {
    date: string
    symbol: string
    isin: string | null
    side: 'BUY' | 'SELL'
    quantity: number
    price: number
    exchange: string | null
    /** The exchange's trade number, so the same trade from a tradebook is recognised. */
    tradeId: string | null
  }[]
}

export interface StatementImportResult {
  statementId: number | null
  account: string
  kind: StatementRead['kind']
  transactions: number
  trades: number
  duplicate: boolean
  message: string
}

// ---------------- Ask your money ----------------

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** What the answer looked up, in words ("your holdings", "tax"). */
  looked?: string[]
}

/** Streamed to the window while an answer is written. */
export type ChatEvent =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'looking'; what: string }
  | { id: string; type: 'done'; looked: string[] }
  | { id: string; type: 'error'; message: string }
