import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LoanMeta } from '../src/shared/loans'
import { openDatabase, type Db } from '../src/main/db'
import { addLoanPayment, emiFor, emiSchedule, kccState, loansReport, loanView, owedByDate, owedOn, prepaymentEffect, saveLoan } from '../src/main/loans'

const home = (over: Partial<LoanMeta> = {}): LoanMeta => ({
  kind: 'HOME',
  repayment: 'EMI',
  lender: 'SBI',
  principal: 3000000,
  ratePct: 8.5,
  tenureMonths: 240,
  startDate: '2025-01-10',
  emiDay: 5,
  autoEmi: true,
  ...over
})

describe('an EMI loan', () => {
  it('has the standard EMI and pays it off in its tenure', () => {
    expect(Math.round(emiFor(3000000, 8.5, 240))).toBe(26035)
    const { steps } = emiSchedule(home(), [], '2026-10-22')
    // First EMI on the 5th after the start; its interest is a month at 8.5% on ₹30 lakh.
    expect(steps[0]).toMatchObject({ date: '2025-02-05' })
    expect(Math.round(steps[0].interest)).toBe(21250)
    expect(steps.filter((s) => s.interest > 0)).toHaveLength(240)
    expect(steps.at(-1)!.balance).toBe(0)
    expect(Math.round(steps.reduce((s, x) => s + x.principal, 0))).toBe(3000000)
  })

  it('knows what is owed today, what is left and this year’s interest for tax', () => {
    const v = loanView(1, 1, 'Me', home(), [], '2026-10-22')
    // 21 EMIs paid (Feb 2025 to Oct 2026).
    const owed = emiSchedule(home(), [], '2026-10-22').steps.filter((s) => s.date <= '2026-10-22')
    expect(owed).toHaveLength(21)
    expect(v.outstanding).toBe(Math.round(owed.at(-1)!.balance))
    expect(v).toMatchObject({ emi: 26035, nextEmi: '2026-11-05', emisLeft: 219, payoffDate: '2045-01-05' })
    // April to October 2026: seven EMIs, mostly interest.
    expect(v.thisFy.fy).toBe('FY27')
    expect(v.thisFy.interest).toBeGreaterThan(140000)
    expect(v.thisFy.interest + v.thisFy.principal).toBe(Math.round(7 * emiFor(3000000, 8.5, 240)))
  })

  it('follows a statement balance, prepayments and recorded EMIs', () => {
    // From a statement: ₹20 lakh on 1 Oct 2026, EMI unchanged.
    const fromStatement = loanView(1, 1, 'Me', home({ balance: { amount: 2000000, asOf: '2026-10-01' } }), [], '2026-10-22')
    // The 5 October EMI: ₹14,167 interest on ₹20 lakh, ₹11,868 off the principal.
    expect(fromStatement.outstanding).toBe(1988132)
    // A ₹5 lakh prepayment saves interest and ends the loan sooner, EMI the same.
    const e = prepaymentEffect(home(), [], 500000, '2026-10-22')
    expect(e.interestSaved).toBeGreaterThan(700000)
    expect(e.monthsSooner).toBeGreaterThan(60)
    // Not assumed: only the EMIs recorded count.
    const manual = home({ autoEmi: false })
    expect(owedOn(manual, [], '2025-06-30')).toBeGreaterThan(3000000) // nothing paid: interest piles up
    expect(owedOn(manual, [1, 2, 3, 4, 5].map((m) => ({ id: `e${m}`, date: `2025-0${m + 1}-05`, kind: 'EMI' as const, amount: 26035 })), '2025-06-30')).toBeLessThan(3000000)
    // Closed loans owe nothing.
    expect(loanView(1, 1, 'Me', home({ closedOn: '2026-09-01' }), [], '2026-10-22')).toMatchObject({ outstanding: 0, closed: true })
  })
})

describe('a Kisan Credit Card', () => {
  const kcc: LoanMeta = { kind: 'KCC', repayment: 'REVOLVING', lender: 'Bank of Baroda', principal: 300000, ratePct: 7, promptRepaymentPct: 3, startDate: '2026-01-01', dueDate: '2026-12-31', autoEmi: false }
  it('charges 7% by the day, 4% when repaid on time, and takes repayments against interest first', () => {
    const draws = [{ id: 'd1', date: '2026-01-01', kind: 'DRAW' as const, amount: 100000 }]
    const k = kccState(kcc, draws, '2026-07-01')
    expect(Math.round(k.interest)).toBe(3471)
    expect(Math.round(k.interestLow)).toBe(1984)
    const repaid = kccState(kcc, [...draws, { id: 'r1', date: '2026-07-01', kind: 'REPAY', amount: 50000 }], '2026-07-01')
    expect(Math.round(repaid.interest)).toBe(0)
    expect(Math.round(repaid.principal)).toBe(100000 - (50000 - 3471))
    const v = loanView(2, 2, 'Dad', kcc, draws, '2026-10-22')
    expect(v.kcc).toMatchObject({ drawn: 100000, dueDate: '2026-12-31', daysLeft: 70 })
    expect(v.kcc!.interestFull - v.kcc!.interestOnTime).toBeGreaterThan(2000)
  })
})

describe('loans in the books', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-loans-'))
    const o = openDatabase(join(dir, 't.db'), '8'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves loans, checks them, and totals what is owed by date', () => {
    expect(() => saveLoan(db, { personId: 1, meta: { ...home(), tenureMonths: null, emi: null } })).toThrow(/EMI or the tenure/)
    const id = saveLoan(db, { personId: 1, meta: home() })
    const gold = saveLoan(db, { personId: 2, meta: { kind: 'GOLD', repayment: 'BULLET', lender: 'Muthoot', principal: 200000, ratePct: 12, tenureMonths: 12, startDate: '2026-05-01', autoEmi: false } })
    addLoanPayment(db, gold, { date: '2026-09-01', kind: 'REPAY', amount: 50000 })
    const r = loansReport(db, undefined, '2026-10-22')
    expect(r.loans.map((l) => l.id)).toEqual([id, gold])
    expect(r.loans[1]).toMatchObject({ outstanding: 150000, payoffDate: '2027-05-01' })
    expect(r.owedInr).toBe(r.loans[0].outstanding + 150000)
    expect(r.monthlyEmi).toBe(26035)
    expect(owedByDate(db, ['2024-12-31', '2026-06-30'], 2)).toEqual([0, 200000])
  })
})
