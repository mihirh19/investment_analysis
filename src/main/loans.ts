import { eq } from 'drizzle-orm'
import { LOAN_KINDS, REPAYMENT_OF, type LoanInput, type LoanMeta, type LoanPayment, type LoansReport, type LoanView } from '@shared/loans'
import { schema, type Db } from './db'

/**
 * Loans, worked out from what is known about them: an EMI loan from its amount, rate, tenure and
 * start (EMIs taken as paid on time unless payments are recorded), or from a balance read off a
 * statement; a gold loan whose principal is repaid at the end; a Kisan Credit Card that is drawn and
 * repaid, with interest at the full rate and at the lower rate for repaying on time.
 */

const todayIso = () => new Date().toISOString().slice(0, 10)
const round = (v: number) => Math.round(v)
const DAY = 86400000

/** The standard EMI for an amount over `months` at `ratePct` a year. */
export function emiFor(principal: number, ratePct: number, months: number): number {
  const r = ratePct / 1200
  if (months <= 0) return principal
  if (r === 0) return principal / months
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
}

/** The same day of the month, `n` months on (the 31st becomes the month's last day). */
function addMonths(iso: string, n: number, day?: number): string {
  const [y, m] = iso.split('-').map(Number)
  const d = day ?? Number(iso.slice(8, 10))
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

const fyOf = (iso: string) => {
  const y = Number(iso.slice(0, 4))
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1
  return { label: `FY${String(start + 1).slice(2)}`, from: `${start}-04-01`, to: `${start + 1}-03-31` }
}

interface Step {
  date: string
  interest: number
  principal: number
  balance: number
}

/**
 * An EMI loan month by month from where it is known (its start, or a statement balance) to `until`,
 * then on to payoff: each EMI pays the month's interest and the rest goes to the principal;
 * part-prepayments go straight to the principal.
 */
export function emiSchedule(meta: LoanMeta, payments: LoanPayment[], until: string): { steps: Step[]; emi: number | null } {
  const fromBalance = meta.balance && meta.balance.asOf >= meta.startDate ? meta.balance : null
  let bal = fromBalance ? fromBalance.amount : meta.principal
  const from = fromBalance ? fromBalance.asOf : meta.startDate
  const r = meta.ratePct / 1200
  const emi = meta.emi ?? (meta.tenureMonths ? emiFor(meta.principal, meta.ratePct, meta.tenureMonths) : null)
  if (!emi) return { steps: [{ date: from, interest: 0, principal: 0, balance: bal }], emi: null }
  const day = meta.emiDay ?? Number(meta.startDate.slice(8, 10))
  const recorded = [...payments].sort((a, b) => a.date.localeCompare(b.date))
  const steps: Step[] = []
  // The first EMI falls on the EMI day after the loan is known from.
  let due = addMonths(from, Number(from.slice(8, 10)) < day ? 0 : 1, day)
  let prev = from
  for (let guard = 0; bal > 0.5 && guard < 1200; guard++) {
    // Prepayments between the last EMI and this one.
    for (const p of recorded.filter((p) => p.kind === 'PREPAY' && p.date > prev && p.date <= due)) {
      const part = Math.min(bal, p.amount)
      bal -= part
      steps.push({ date: p.date, interest: 0, principal: part, balance: bal })
    }
    if (bal <= 0.5) break
    const interest = bal * r
    // Up to today, recorded EMIs are what was paid (when EMIs aren't assumed); after today, the EMI.
    const paidEmi = recorded.filter((p) => p.kind === 'EMI' && p.date.slice(0, 7) === due.slice(0, 7)).reduce((s, p) => s + p.amount, 0)
    const pay = due <= until && !meta.autoEmi ? paidEmi : Math.min(emi, bal + interest)
    const principal = pay - interest
    bal = Math.max(0, bal - principal)
    steps.push({ date: due, interest, principal, balance: bal })
    prev = due
    due = addMonths(due, 1, day)
  }
  return { steps, emi }
}

/** A gold loan: the principal less what was repaid; interest is paid as it falls due. */
function bulletBalance(meta: LoanMeta, payments: LoanPayment[], on: string): number {
  const repaid = payments.filter((p) => (p.kind === 'REPAY' || p.kind === 'PREPAY') && p.date <= on).reduce((s, p) => s + p.amount, 0)
  const drawn = payments.filter((p) => p.kind === 'DRAW' && p.date <= on).reduce((s, p) => s + p.amount, 0)
  return Math.max(0, meta.principal + drawn - repaid)
}

/**
 * A Kisan Credit Card up to `on`: drawings add to the principal; repayments clear the interest that
 * has built up first, then the principal (as banks apply them). Interest is simple, by the day, at
 * the full rate and, for comparison, at the rate after the on-time repayment help.
 */
export function kccState(meta: LoanMeta, payments: LoanPayment[], on: string) {
  const events = [...payments].filter((p) => p.date <= on && (p.kind === 'DRAW' || p.kind === 'REPAY')).sort((a, b) => a.date.localeCompare(b.date))
  const full = meta.ratePct / 100
  const lowRate = Math.max(0, meta.ratePct - (meta.promptRepaymentPct ?? 3)) / 100
  let principal = 0
  let interest = 0
  let interestLow = 0
  let at = events[0]?.date ?? on
  const accrue = (to: string) => {
    const days = Math.max(0, (Date.parse(to) - Date.parse(at)) / DAY)
    interest += (principal * full * days) / 365
    interestLow += (principal * lowRate * days) / 365
    at = to
  }
  for (const e of events) {
    accrue(e.date)
    if (e.kind === 'DRAW') principal += e.amount
    else {
      const toInterest = Math.min(interest, e.amount)
      interest -= toInterest
      interestLow = Math.max(0, interestLow - toInterest)
      principal = Math.max(0, principal - (e.amount - toInterest))
    }
  }
  accrue(on)
  return { principal, interest, interestLow }
}

/** What is owed on a loan on a day. */
export function owedOn(meta: LoanMeta, payments: LoanPayment[], on: string): number {
  if (on < meta.startDate || (meta.closedOn && on >= meta.closedOn)) return 0
  if (meta.repayment === 'REVOLVING') {
    const k = kccState(meta, payments, on)
    return k.principal + k.interest
  }
  if (meta.repayment === 'BULLET') return bulletBalance(meta, payments, on)
  const { steps } = emiSchedule(meta, payments, on)
  if (meta.balance && on < meta.balance.asOf) {
    // Before the statement balance: the schedule from the start.
    const early = emiSchedule({ ...meta, balance: null }, payments, on).steps.filter((s) => s.date <= on).at(-1)
    return early ? early.balance : meta.principal
  }
  const last = steps.filter((s) => s.date <= on).at(-1)
  return last ? last.balance : (meta.balance?.amount ?? meta.principal)
}

export function loanView(id: number, personId: number, personName: string, meta: LoanMeta, payments: LoanPayment[], today = todayIso()): LoanView {
  const closed = !!(meta.closedOn && meta.closedOn <= today)
  const fy = fyOf(today)
  const base = {
    id,
    personId,
    personName,
    meta,
    payments: [...payments].sort((a, b) => b.date.localeCompare(a.date)),
    closed
  }
  if (meta.repayment === 'REVOLVING') {
    const k = kccState(meta, payments, today)
    const due = meta.dueDate ?? null
    return {
      ...base,
      outstanding: closed ? 0 : round(k.principal + k.interest),
      repaidShare: 0,
      emi: null,
      nextEmi: null,
      emisLeft: null,
      payoffDate: due,
      interestLeft: null,
      thisFy: { fy: fy.label, interest: 0, principal: 0 },
      kcc: {
        drawn: round(k.principal),
        interestFull: round(k.interest),
        interestOnTime: round(k.interestLow),
        dueDate: due,
        daysLeft: due ? Math.round((Date.parse(due) - Date.parse(today)) / DAY) : null
      }
    }
  }
  if (meta.repayment === 'BULLET') {
    const owed = closed ? 0 : bulletBalance(meta, payments, today)
    const end = meta.tenureMonths ? addMonths(meta.startDate, meta.tenureMonths) : null
    return {
      ...base,
      outstanding: round(owed),
      repaidShare: meta.principal ? Math.max(0, Math.min(1, 1 - owed / meta.principal)) : 0,
      emi: null,
      nextEmi: null,
      emisLeft: null,
      payoffDate: end,
      // Interest due to the end at the current rate.
      interestLeft: end ? round((owed * meta.ratePct * Math.max(0, (Date.parse(end) - Date.parse(today)) / DAY)) / 36500) : null,
      thisFy: {
        fy: fy.label,
        interest: round(payments.filter((p) => p.kind === 'INTEREST' && p.date >= fy.from && p.date <= today).reduce((s, p) => s + p.amount, 0)),
        principal: 0
      },
      kcc: null
    }
  }
  const { steps, emi } = emiSchedule(meta, payments, today)
  const past = steps.filter((s) => s.date <= today)
  const future = steps.filter((s) => s.date > today)
  const owed = closed ? 0 : (past.at(-1)?.balance ?? meta.balance?.amount ?? meta.principal)
  const inFy = past.filter((s) => s.date >= fy.from)
  return {
    ...base,
    outstanding: round(owed),
    repaidShare: meta.principal ? Math.max(0, Math.min(1, 1 - owed / meta.principal)) : 0,
    emi: emi ? round(emi) : null,
    nextEmi: closed ? null : (future.find((s) => s.interest > 0)?.date ?? null),
    emisLeft: closed ? 0 : future.filter((s) => s.interest > 0).length,
    payoffDate: closed ? meta.closedOn! : (future.at(-1)?.date ?? past.at(-1)?.date ?? null),
    interestLeft: closed ? 0 : round(future.reduce((s, x) => s + x.interest, 0)),
    thisFy: { fy: fy.label, interest: round(inFy.reduce((s, x) => s + x.interest, 0)), principal: round(inFy.reduce((s, x) => s + x.principal, 0)) },
    kcc: null
  }
}

/** What a part-prepayment today would do: interest saved and how much sooner the loan ends (EMI unchanged). */
export function prepaymentEffect(meta: LoanMeta, payments: LoanPayment[], amount: number, today = todayIso()) {
  const before = loanView(0, 0, '', meta, payments, today)
  const after = loanView(0, 0, '', meta, [...payments, { id: 'what-if', date: today, kind: 'PREPAY', amount }], today)
  const months = (a: string | null, b: string | null) => (a && b ? (Number(a.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + Number(a.slice(5, 7)) - Number(b.slice(5, 7)) : 0)
  return {
    interestSaved: Math.max(0, (before.interestLeft ?? 0) - (after.interestLeft ?? 0)),
    monthsSooner: Math.max(0, months(before.payoffDate, after.payoffDate)),
    newPayoff: after.payoffDate
  }
}

// ---------------- storage ----------------

const KIND_KEYS = Object.keys(LOAN_KINDS)

function check(meta: LoanMeta): LoanMeta {
  if (!KIND_KEYS.includes(meta.kind)) throw new Error('Pick the kind of loan.')
  if (!meta.lender?.trim()) throw new Error('Enter the bank or lender.')
  if (!(meta.principal > 0)) throw new Error(meta.kind === 'KCC' ? 'Enter the KCC limit.' : 'Enter how much was borrowed.')
  if (!(meta.ratePct >= 0 && meta.ratePct < 60)) throw new Error('Enter the interest rate, % a year.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.startDate)) throw new Error('Enter when the loan started.')
  const repayment = meta.repayment ?? REPAYMENT_OF[meta.kind]
  if (repayment === 'EMI' && !meta.emi && !meta.tenureMonths && !meta.balance)
    throw new Error('Enter the EMI or the tenure, so the balance can be worked out.')
  if (meta.emiDay != null && !(meta.emiDay >= 1 && meta.emiDay <= 31)) throw new Error('The EMI day is a day of the month (1–31).')
  return { ...meta, lender: meta.lender.trim(), repayment }
}

export function saveLoan(db: Db, input: LoanInput): number {
  const meta = check(input.meta)
  const row = { personId: input.personId, metaJson: JSON.stringify(meta), paymentsJson: JSON.stringify(input.payments ?? []) }
  if (input.id) {
    const cur = db.select().from(schema.loans).where(eq(schema.loans.id, input.id)).get()
    if (!cur) throw new Error('That loan no longer exists.')
    db.update(schema.loans)
      .set({ ...row, paymentsJson: input.payments ? row.paymentsJson : cur.paymentsJson })
      .where(eq(schema.loans.id, input.id))
      .run()
    return input.id
  }
  return db.insert(schema.loans).values(row).returning({ id: schema.loans.id }).get().id
}

export function deleteLoan(db: Db, id: number): void {
  db.delete(schema.loans).where(eq(schema.loans.id, id)).run()
}

export function addLoanPayment(db: Db, loanId: number, p: Omit<LoanPayment, 'id'> & { id?: string }): void {
  const cur = db.select().from(schema.loans).where(eq(schema.loans.id, loanId)).get()
  if (!cur) throw new Error('That loan no longer exists.')
  if (!(p.amount > 0)) throw new Error('Enter the amount.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('Pick a date.')
  const list = JSON.parse(cur.paymentsJson) as LoanPayment[]
  const id = p.id ?? crypto.randomUUID().slice(0, 8)
  if (list.some((x) => x.id === id)) return
  list.push({ ...p, id })
  db.update(schema.loans).set({ paymentsJson: JSON.stringify(list) }).where(eq(schema.loans.id, loanId)).run()
}

export function deleteLoanPayment(db: Db, loanId: number, paymentId: string): void {
  const cur = db.select().from(schema.loans).where(eq(schema.loans.id, loanId)).get()
  if (!cur) return
  const list = (JSON.parse(cur.paymentsJson) as LoanPayment[]).filter((x) => x.id !== paymentId)
  db.update(schema.loans).set({ paymentsJson: JSON.stringify(list) }).where(eq(schema.loans.id, loanId)).run()
}

function rows(db: Db, personId?: number) {
  const names = new Map(db.select().from(schema.persons).all().map((p) => [p.id, p.name]))
  return db
    .select()
    .from(schema.loans)
    .where(personId ? eq(schema.loans.personId, personId) : undefined)
    .all()
    .map((r) => ({ id: r.id, personId: r.personId, personName: names.get(r.personId) ?? '', meta: JSON.parse(r.metaJson) as LoanMeta, payments: JSON.parse(r.paymentsJson) as LoanPayment[] }))
}

export function loansReport(db: Db, personId?: number, today = todayIso()): LoansReport {
  const loans = rows(db, personId)
    .map((r) => loanView(r.id, r.personId, r.personName, r.meta, r.payments, today))
    .sort((a, b) => Number(a.closed) - Number(b.closed) || b.outstanding - a.outstanding)
  return {
    loans,
    owedInr: loans.reduce((s, l) => s + l.outstanding, 0),
    monthlyEmi: loans.filter((l) => !l.closed && l.outstanding > 0).reduce((s, l) => s + (l.emi ?? 0), 0)
  }
}

/** What was owed at each date (month ends for the net worth chart). */
export function owedByDate(db: Db, dates: string[], personId?: number): number[] {
  const list = rows(db, personId)
  return dates.map((d) => Math.round(list.reduce((s, r) => s + owedOn(r.meta, r.payments, d), 0)))
}
