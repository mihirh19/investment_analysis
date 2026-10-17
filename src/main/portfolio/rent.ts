import type { PropertyMeta, Tenancy } from '@shared/assets'

/**
 * Rent from a property's tenancies and the payments recorded against them. Shared by the
 * valuation engine (income, cash flows) and the Property page (who has paid, what is overdue).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const monthOf = (date: string) => date.slice(0, 7)
const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`
}
const daysIn = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The tenancies in force: those recorded, or the legacy single monthly rent from the purchase. */
export function tenanciesOf(m: PropertyMeta): Tenancy[] {
  if (m.tenancies?.length) return m.tenancies
  return m.monthlyRent
    ? [{ id: 'legacy', tenant: '', startDate: m.purchaseDate, endDate: null, monthlyRent: m.monthlyRent, dueDay: 1 }]
    : []
}

/** True once rent is being recorded as it comes in; before that, rent is assumed to arrive. */
export const recordsPayments = (m: PropertyMeta) => (m.rentPayments?.length ?? 0) > 0 || (m.tenancies?.length ?? 0) > 0

export interface RentDue {
  /** YYYY-MM the rent is for. */
  month: string
  dueDate: string
  amount: number
  tenancyId: string
  tenant: string
}

/** Rent falling due for each month a tenancy covers, with due dates in [from, to]. */
export function rentDues(m: PropertyMeta, from: string, to: string): RentDue[] {
  const out: RentDue[] = []
  for (const t of tenanciesOf(m)) {
    const day = Math.min(Math.max(1, t.dueDay ?? 1), 28)
    let ym = monthOf(t.startDate)
    const last = monthOf(t.endDate && t.endDate < to ? t.endDate : to)
    while (ym <= last) {
      const dueDate = `${ym}-${pad(Math.min(day, daysIn(ym)))}`
      // A tenancy starting mid-month owes from its start; one ending mid-month still owes that month.
      if (dueDate >= from && dueDate <= to && ym >= monthOf(t.startDate))
        out.push({ month: ym, dueDate, amount: t.monthlyRent, tenancyId: t.id, tenant: t.tenant })
      ym = nextMonth(ym)
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/** Rent received with payment dates in (from, to]. */
export function rentReceived(m: PropertyMeta, from: string, to: string): number {
  return (m.rentPayments ?? []).filter((p) => p.date > from && p.date <= to).reduce((s, p) => s + p.amount, 0)
}

export type MonthStatus = 'PAID' | 'PART' | 'DUE' | 'OVERDUE'

export interface RentMonth extends RentDue {
  paid: number
  status: MonthStatus
}

/** Each due month in [from, to] with what was paid for it and whether it is late. */
export function rentMonths(m: PropertyMeta, from: string, to: string, today: string): RentMonth[] {
  const paidFor = new Map<string, number>()
  for (const p of m.rentPayments ?? []) {
    const k = `${p.tenancyId ?? ''}|${p.forMonth}`
    paidFor.set(k, (paidFor.get(k) ?? 0) + p.amount)
    // Payments not tied to a tenancy count for whichever tenancy is due that month.
    if (p.tenancyId) continue
    paidFor.set(`*|${p.forMonth}`, (paidFor.get(`*|${p.forMonth}`) ?? 0) + p.amount)
  }
  return rentDues(m, from, to).map((d) => {
    const paid = (paidFor.get(`${d.tenancyId}|${d.month}`) ?? 0) + (paidFor.get(`*|${d.month}`) ?? 0)
    const status: MonthStatus =
      paid >= d.amount - 0.5 ? 'PAID' : paid > 0 ? 'PART' : d.dueDate < today ? 'OVERDUE' : 'DUE'
    return { ...d, paid, status }
  })
}

/** Rent counted as income in (from, to]: actual receipts once recording, else the schedule. */
export function rentIncome(m: PropertyMeta, from: string, to: string): number {
  if (recordsPayments(m)) return rentReceived(m, from, to)
  return rentDues(m, from, to)
    .filter((d) => d.dueDate > from)
    .reduce((s, d) => s + d.amount, 0)
}

/** Dated rent cash flows up to today (for XIRR). */
export function rentFlows(m: PropertyMeta, today: string): { date: string; amount: number }[] {
  if (recordsPayments(m))
    return (m.rentPayments ?? []).filter((p) => p.date <= today).map((p) => ({ date: p.date, amount: p.amount }))
  return rentDues(m, m.purchaseDate, today).map((d) => ({ date: d.dueDate, amount: d.amount }))
}

/** Expenses paid in (from, to], optionally of some kinds only. */
export function expensesBetween(m: PropertyMeta, from: string, to: string, kinds?: string[]): number {
  return (m.expenses ?? [])
    .filter((e) => e.date > from && e.date <= to && (!kinds || kinds.includes(e.kind)))
    .reduce((s, e) => s + e.amount, 0)
}
