// Loans: what the family owes, so net worth is what it owns minus what it owes. Shared by main, the
// renderer and the phone app.

export const LOAN_KINDS = {
  HOME: 'Home loan',
  VEHICLE: 'Car or bike loan',
  GOLD: 'Gold loan',
  PERSONAL: 'Personal loan',
  EDUCATION: 'Education loan',
  KCC: 'Kisan Credit Card',
  AGRI: 'Farm term loan (tractor, well…)',
  OTHER: 'Other loan'
} as const
export type LoanKind = keyof typeof LOAN_KINDS

/**
 * EMI: a fixed monthly instalment (most loans). BULLET: interest monthly or at the end, the
 * principal at the end (many gold loans). REVOLVING: drawn and repaid as needed (KCC).
 */
export type Repayment = 'EMI' | 'BULLET' | 'REVOLVING'
export const REPAYMENT_OF: Record<LoanKind, Repayment> = {
  HOME: 'EMI',
  VEHICLE: 'EMI',
  GOLD: 'BULLET',
  PERSONAL: 'EMI',
  EDUCATION: 'EMI',
  KCC: 'REVOLVING',
  AGRI: 'EMI',
  OTHER: 'EMI'
}

export interface LoanMeta {
  kind: LoanKind
  repayment: Repayment
  lender: string
  /** Account number's last digits, to tell loans apart. */
  last4?: string | null
  /** What was borrowed (for a KCC, the sanctioned limit). */
  principal: number
  /** Interest, % a year (floating loans: today's rate). */
  ratePct: number
  tenureMonths?: number | null
  /** Disbursed on (the first draw, for a KCC). */
  startDate: string
  /** Monthly instalment; worked out from principal, rate and tenure when empty. */
  emi?: number | null
  /** Day of the month the EMI is debited. */
  emiDay?: number | null
  /** EMIs are taken to be paid on time unless payments are recorded (most people never record them). */
  autoEmi: boolean
  /** A balance read off a statement: the loan is followed from here. */
  balance?: { amount: number; asOf: string } | null
  /** KCC: interest help for repaying on time (3 points under the Modified Interest Subvention Scheme). */
  promptRepaymentPct?: number | null
  /** KCC: the date each year's drawings should be repaid by (usually a year from drawing, or after harvest). */
  dueDate?: string | null
  /** What it is for: a property (account id) or a vehicle (id), to show beside it. */
  linked?: { type: 'PROPERTY' | 'VEHICLE'; id: number } | null
  closedOn?: string | null
  note?: string | null
}

export type LoanPaymentKind = 'EMI' | 'PREPAY' | 'DRAW' | 'REPAY' | 'INTEREST'
export const PAYMENT_LABELS: Record<LoanPaymentKind, string> = {
  EMI: 'EMI paid',
  PREPAY: 'Part-prepayment',
  DRAW: 'Money drawn',
  REPAY: 'Repaid',
  INTEREST: 'Interest paid'
}

export interface LoanPayment {
  id: string
  date: string
  kind: LoanPaymentKind
  amount: number
  note?: string | null
}

export interface LoanInput {
  id?: number
  personId: number
  meta: LoanMeta
  payments?: LoanPayment[]
}

export interface LoanView {
  id: number
  personId: number
  personName: string
  meta: LoanMeta
  payments: LoanPayment[]
  /** Owed today (principal; plus unpaid interest on a KCC). */
  outstanding: number
  /** Of what was borrowed, the share repaid. */
  repaidShare: number
  emi: number | null
  nextEmi: string | null
  emisLeft: number | null
  /** When it is paid off at the current EMI and rate. */
  payoffDate: string | null
  /** Interest still to pay from today, at the current EMI and rate. */
  interestLeft: number | null
  /** This financial year so far: interest and principal paid (home loans: sections 24(b) and 80C). */
  thisFy: { fy: string; interest: number; principal: number }
  /** KCC: interest so far at the full rate, what it is if repaid by the due date, and the due date. */
  kcc: { drawn: number; interestFull: number; interestOnTime: number; dueDate: string | null; daysLeft: number | null } | null
  closed: boolean
}

export interface LoansReport {
  loans: LoanView[]
  owedInr: number
  /** EMIs going out each month across open loans. */
  monthlyEmi: number
}
