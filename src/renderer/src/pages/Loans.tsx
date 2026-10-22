import { useState, type FormEvent } from 'react'
import {
  LOAN_KINDS,
  PAYMENT_LABELS,
  REPAYMENT_OF,
  type LoanKind,
  type LoanMeta,
  type LoanPaymentKind,
  type LoanView
} from '@shared/loans'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { loanPrepayment, useAddLoanPayment, useDeleteLoan, useDeleteLoanPayment, useLoans, usePersons, useSaveLoan } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const inr = (v: number | null | undefined) => money(v, 'INR', 0)
const today = () => new Date().toISOString().slice(0, 10)
const num = (s: string) => (s.trim() === '' ? null : Number(s))
/** 1st, 2nd, 3rd, 4th… 11th, 12th, 13th, 21st. */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
const span = (months: number) => {
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || '0 months'
}

export function Loans() {
  const { scope } = useScope()
  const q = useLoans(scopePersonId(scope))
  const [adding, setAdding] = useState(false)
  const r = q.data
  const open = (r?.loans ?? []).filter((l) => !l.closed)
  const closed = (r?.loans ?? []).filter((l) => l.closed)
  const fyInterest = open.reduce((s, l) => s + l.thisFy.interest, 0)

  return (
    <>
      <PageHeader title="Loans">{!adding && <Button onClick={() => setAdding(true)}>Add a loan</Button>}</PageHeader>
      <ErrorNote error={q.error} />

      {r && open.length > 0 && (
        <div className="mb-8 grid gap-6 sm:grid-cols-3">
          <div>
            <div className="text-[13px] text-ink-muted">Owed today</div>
            <div className="wide num text-[28px] font-semibold text-loss">{inr(r.owedInr)}</div>
            <div className="text-[13px] text-ink-muted">Taken off net worth on the Overview</div>
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">EMIs each month</div>
            <div className="wide num text-[28px] font-semibold">{inr(r.monthlyEmi)}</div>
            <div className="text-[13px] text-ink-muted">
              across {open.filter((l) => l.emi).length} loan{open.filter((l) => l.emi).length === 1 ? '' : 's'}
            </div>
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">Interest paid this year ({open[0]?.thisFy.fy})</div>
            <div className="wide num text-[28px] font-semibold">{inr(fyInterest)}</div>
            <div className="text-[13px] text-ink-muted">EMIs as scheduled, plus interest recorded on other loans</div>
          </div>
        </div>
      )}

      {adding && <LoanForm onDone={() => setAdding(false)} />}

      {r && r.loans.length === 0 && !adding && (
        <div className="max-w-[72ch] py-4 text-ink-muted">
          <p>
            Add home, car, gold, personal, education and farm loans, and the Kisan Credit Card. The app works out what is
            still owed from the amount, rate and EMI (taking EMIs as paid on time unless you record otherwise, or from a
            balance on a statement), so net worth on the Overview becomes what you own less what you owe.
          </p>
        </div>
      )}

      {open.map((l) => (
        <LoanCard key={l.id} l={l} showPerson={scope === 'family'} />
      ))}
      {closed.length > 0 && (
        <section className="mt-8">
          <h2 className="wide mb-3 text-[17px] font-semibold">Closed</h2>
          {closed.map((l) => (
            <LoanCard key={l.id} l={l} showPerson={scope === 'family'} />
          ))}
        </section>
      )}
    </>
  )
}

function LoanCard({ l, showPerson }: { l: LoanView; showPerson: boolean }) {
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState<LoanPaymentKind | null>(null)
  const [balance, setBalance] = useState(false)
  const del = useDeleteLoan()
  const delPay = useDeleteLoanPayment()
  const save = useSaveLoan()
  const m = l.meta
  const kcc = m.repayment === 'REVOLVING'
  const facts: [string, string][] = kcc
    ? [
        ['Limit', inr(m.principal)],
        ['Drawn', inr(l.kcc?.drawn)],
        ['Interest so far', `${inr(l.kcc?.interestFull)} at ${m.ratePct}%`],
        ...(l.kcc?.dueDate ? ([['Repay by', `${shortDate(l.kcc.dueDate)}${l.kcc.daysLeft !== null ? ` (${l.kcc.daysLeft < 0 ? `${-l.kcc.daysLeft} days late` : `${l.kcc.daysLeft} days`})` : ''}`]] as [string, string][]) : [])
      ]
    : [
        ['Borrowed', `${inr(m.principal)} on ${shortDate(m.startDate)}`],
        ['Rate', `${m.ratePct}% a year`],
        ...(l.emi ? ([['EMI', `${inr(l.emi)}${m.emiDay ? ` on the ${ordinal(m.emiDay)}` : ''}`]] as [string, string][]) : []),
        ...(l.nextEmi ? ([['Next EMI', shortDate(l.nextEmi)]] as [string, string][]) : []),
        ...(l.emisLeft ? ([['EMIs left', `${l.emisLeft} (${span(l.emisLeft)})`]] as [string, string][]) : []),
        ...(l.payoffDate && !l.closed ? ([['Paid off by', shortDate(l.payoffDate)]] as [string, string][]) : []),
        ...(l.interestLeft ? ([['Interest still to pay', inr(l.interestLeft)]] as [string, string][]) : [])
      ]
  return (
    <article className={`mb-6 rounded-lg border border-rule p-4 ${l.closed ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-semibold">
          {LOAN_KINDS[m.kind]}{' '}
          <span className="text-[14px] font-normal text-ink-muted">
            {m.lender}
            {m.last4 ? ` ••${m.last4}` : ''}
            {showPerson ? `, ${l.personName}` : ''}
          </span>
        </h3>
        <div className="text-right">
          <div className="wide num text-[24px] font-semibold">{l.closed ? 'Closed' : inr(l.outstanding)}</div>
          {!l.closed && <div className="text-[12px] text-ink-muted">owed today</div>}
        </div>
      </div>
      {!kcc && !l.closed && (m.repayment === 'EMI' || l.repaidShare > 0) && (
        <div className="mt-2">
          <div className="h-2 overflow-hidden rounded-full bg-rule/60" aria-hidden>
            <div className="h-full rounded-full bg-gain" style={{ width: `${l.repaidShare * 100}%` }} />
          </div>
          <div className="mt-1 text-[12px] text-ink-muted">{Math.round(l.repaidShare * 100)}% of what was borrowed repaid</div>
        </div>
      )}
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-[14px] sm:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-36 shrink-0 text-ink-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {kcc && l.kcc && l.kcc.drawn > 0 && (
        <p className="mt-2 max-w-[80ch] text-[14px]">
          Repaid by the due date, the interest is <b>{inr(l.kcc.interestOnTime)}</b> instead of {inr(l.kcc.interestFull)} (
          {m.ratePct - (m.promptRepaymentPct ?? 3)}% after the {m.promptRepaymentPct ?? 3}-point prompt repayment help), a
          difference of <b className="text-gain">{inr(l.kcc.interestFull - l.kcc.interestOnTime)}</b> so far.
        </p>
      )}
      {!kcc && !l.closed && (l.thisFy.interest > 0 || l.thisFy.principal > 0) && (
        <p className="mt-2 max-w-[80ch] text-[14px] text-ink-muted">
          This year ({l.thisFy.fy}): {inr(l.thisFy.interest)} interest and {inr(l.thisFy.principal)} principal.
          {m.kind === 'HOME' &&
            ' Under the old tax regime, interest on a self-occupied home counts under section 24(b) (up to ₹2 lakh a year) and principal under 80C (within ₹1.5 lakh); the new regime allows neither for a self-occupied home.'}
          {m.kind === 'EDUCATION' && ' Interest on an education loan counts under section 80E under the old regime.'}
        </p>
      )}
      {!kcc && !l.closed && l.emi && <Prepay l={l} />}

      {l.payments.length > 0 && (
        <table className="num mt-3 w-full text-[14px]">
          <tbody>
            {l.payments.slice(0, 12).map((p) => (
              <tr key={p.id} className="border-t border-rule">
                <td className="w-28 py-1.5 text-left text-ink-muted">{shortDate(p.date)}</td>
                <td className="py-1.5 text-left">
                  {PAYMENT_LABELS[p.kind]}
                  {p.note ? <span className="text-ink-muted">, {p.note}</span> : null}
                </td>
                <td className="py-1.5 text-right">{inr(p.amount)}</td>
                <td className="w-20 py-1.5 text-right">
                  <button className="text-[13px] text-ink-muted hover:text-loss" onClick={() => confirm('Remove this entry?') && delPay.mutate([l.id, p.id])}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {paying && <PaymentForm l={l} kind={paying} onDone={() => setPaying(null)} />}
      {balance && <BalanceForm l={l} onDone={() => setBalance(false)} />}
      {editing && <LoanForm loan={l} onDone={() => setEditing(false)} />}
      {!paying && !balance && !editing && !l.closed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {kcc ? (
            <>
              <Button variant="quiet" onClick={() => setPaying('DRAW')}>
                Record money drawn
              </Button>
              <Button variant="quiet" onClick={() => setPaying('REPAY')}>
                Record a repayment
              </Button>
            </>
          ) : m.repayment === 'BULLET' ? (
            <>
              <Button variant="quiet" onClick={() => setPaying('INTEREST')}>
                Record interest paid
              </Button>
              <Button variant="quiet" onClick={() => setPaying('REPAY')}>
                Record a repayment
              </Button>
            </>
          ) : (
            <>
              <Button variant="quiet" onClick={() => setPaying('PREPAY')}>
                Record a part-prepayment
              </Button>
              {!m.autoEmi && (
                <Button variant="quiet" onClick={() => setPaying('EMI')}>
                  Record an EMI
                </Button>
              )}
              <Button variant="quiet" onClick={() => setBalance(true)}>
                Update from a statement
              </Button>
            </>
          )}
          <Button variant="quiet" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="quiet"
            onClick={() => confirm('Mark this loan closed (fully repaid) today?') && save.mutate([{ id: l.id, personId: l.personId, meta: { ...m, closedOn: today() } }])}
          >
            Mark closed
          </Button>
          <Button variant="danger" onClick={() => confirm('Delete this loan and its entries?') && del.mutate([l.id])}>
            Delete
          </Button>
        </div>
      )}
      {l.closed && (
        <div className="mt-3 flex gap-2">
          <Button variant="quiet" onClick={() => save.mutate([{ id: l.id, personId: l.personId, meta: { ...m, closedOn: null } }])}>
            Reopen
          </Button>
          <Button variant="danger" onClick={() => confirm('Delete this loan and its entries?') && del.mutate([l.id])}>
            Delete
          </Button>
        </div>
      )}
      <ErrorNote error={del.error ?? delPay.error ?? save.error} />
    </article>
  )
}

/** What a part-prepayment today would do, with the EMI unchanged: a calculation, not a suggestion. */
function Prepay({ l }: { l: LoanView }) {
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<{ interestSaved: number; monthsSooner: number; newPayoff: string | null } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      setResult(await loanPrepayment(l.id, Number(amount)))
    } catch (err) {
      setError(err)
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-sheet p-3">
      <Field label="If I prepay (₹)">
        <Input
          className="w-32"
          inputMode="numeric"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setResult(null)
          }}
        />
      </Field>
      <Button type="submit" variant="quiet" disabled={!(Number(amount) > 0)}>
        Work it out
      </Button>
      {result && (
        <p className="pb-1.5 text-[14px]">
          Interest saved <b className="text-gain">{inr(result.interestSaved)}</b>; the loan ends {span(result.monthsSooner)} sooner
          {result.newPayoff ? ` (${shortDate(result.newPayoff)})` : ''}, keeping the EMI the same.
        </p>
      )}
      <ErrorNote error={error} />
    </form>
  )
}

function PaymentForm({ l, kind, onDone }: { l: LoanView; kind: LoanPaymentKind; onDone: () => void }) {
  const add = useAddLoanPayment()
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(kind === 'EMI' && l.emi ? String(l.emi) : '')
  const [note, setNote] = useState('')
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 rounded-md bg-sheet p-3"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate([l.id, { date, kind, amount: Number(amount), note: note || null }], { onSuccess: onDone })
      }}
    >
      <span className="w-full text-[15px] font-semibold">{PAYMENT_LABELS[kind]}</span>
      <Field label="Date">
        <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Amount (₹)">
        <Input className="w-32" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Note">
        <Input className="w-48" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button type="submit" disabled={!(Number(amount) > 0) || add.isPending}>
        Save
      </Button>
      <Button type="button" variant="quiet" onClick={onDone}>
        Cancel
      </Button>
      <ErrorNote error={add.error} />
    </form>
  )
}

function BalanceForm({ l, onDone }: { l: LoanView; onDone: () => void }) {
  const save = useSaveLoan()
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState('')
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-3 rounded-md bg-sheet p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate([{ id: l.id, personId: l.personId, meta: { ...l.meta, balance: { amount: Number(amount), asOf: date } } }], { onSuccess: onDone })
      }}
    >
      <span className="w-full text-[15px] font-semibold">Balance on a statement</span>
      <Field label="Principal outstanding (₹)" hint="From the loan statement or the bank's app">
        <Input className="w-40" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="As on">
        <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Button type="submit" disabled={!(Number(amount) >= 0) || !amount || save.isPending}>
        Save
      </Button>
      <Button type="button" variant="quiet" onClick={onDone}>
        Cancel
      </Button>
      <ErrorNote error={save.error} />
    </form>
  )
}

function LoanForm({ loan, onDone }: { loan?: LoanView; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveLoan()
  const m = loan?.meta
  const [personId, setPersonId] = useState(loan?.personId ?? scopePersonId(scope) ?? persons[0]?.id ?? 1)
  const [kind, setKind] = useState<LoanKind>(m?.kind ?? 'HOME')
  const [lender, setLender] = useState(m?.lender ?? '')
  const [last4, setLast4] = useState(m?.last4 ?? '')
  const [principal, setPrincipal] = useState(m ? String(m.principal) : '')
  const [rate, setRate] = useState(m ? String(m.ratePct) : kind === 'KCC' ? '7' : '')
  const [years, setYears] = useState(m?.tenureMonths ? String(Math.round((m.tenureMonths / 12) * 100) / 100) : '')
  const [start, setStart] = useState(m?.startDate ?? '')
  const [emi, setEmi] = useState(m?.emi ? String(m.emi) : '')
  const [emiDay, setEmiDay] = useState(m?.emiDay ? String(m.emiDay) : '')
  const [autoEmi, setAutoEmi] = useState(m?.autoEmi ?? true)
  const [prompt, setPrompt] = useState(m?.promptRepaymentPct != null ? String(m.promptRepaymentPct) : '3')
  const [due, setDue] = useState(m?.dueDate ?? '')
  const [note, setNote] = useState(m?.note ?? '')
  const repayment = REPAYMENT_OF[kind]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const meta: LoanMeta = {
      ...(m ?? {}),
      kind,
      repayment,
      lender,
      last4: last4 || null,
      principal: Number(principal),
      ratePct: Number(rate),
      tenureMonths: num(years) !== null ? Math.round(num(years)! * 12) : null,
      startDate: start,
      emi: num(emi),
      emiDay: num(emiDay),
      autoEmi: repayment === 'EMI' ? autoEmi : false,
      promptRepaymentPct: kind === 'KCC' ? num(prompt) : null,
      dueDate: kind === 'KCC' ? due || null : null,
      note: note || null
    }
    save.mutate([{ id: loan?.id, personId: Number(personId), meta }], { onSuccess: onDone })
  }

  return (
    <form onSubmit={submit} className="mb-8 rounded-lg border border-rule-strong p-4">
      <h2 className="mb-3 text-[17px] font-semibold">{loan ? 'Edit the loan' : 'A loan'}</h2>
      <div className="flex flex-wrap items-start gap-4">
        {persons.length > 1 && (
          <Field label="Whose">
            <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Kind">
          <Select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as LoanKind
              setKind(k)
              if (k === 'KCC' && !rate) setRate('7')
            }}
          >
            {(Object.keys(LOAN_KINDS) as LoanKind[]).map((k) => (
              <option key={k} value={k}>
                {LOAN_KINDS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bank or lender">
          <Input className="w-44" value={lender} onChange={(e) => setLender(e.target.value)} />
        </Field>
        <Field label="Account (last digits)">
          <Input className="w-24" value={last4} onChange={(e) => setLast4(e.target.value)} />
        </Field>
        <Field label={kind === 'KCC' ? 'Limit (₹)' : 'Borrowed (₹)'}>
          <Input className="w-36" inputMode="numeric" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label="Interest (% a year)">
          <Input className="w-24" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label={kind === 'KCC' ? 'First drawn on' : 'Started on'}>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {repayment !== 'REVOLVING' && (
          <Field label="Tenure (years)">
            <Input className="w-24" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} />
          </Field>
        )}
        {repayment === 'EMI' && (
          <>
            <Field label="EMI (₹)" hint="Empty: worked out from the amount, rate and tenure">
              <Input className="w-32" inputMode="numeric" value={emi} onChange={(e) => setEmi(e.target.value)} />
            </Field>
            <Field label="EMI day of the month">
              <Input className="w-20" inputMode="numeric" value={emiDay} onChange={(e) => setEmiDay(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[14px]">
              <input type="checkbox" checked={autoEmi} onChange={(e) => setAutoEmi(e.target.checked)} />
              EMIs are paid on time (auto-debit)
            </label>
          </>
        )}
        {kind === 'KCC' && (
          <>
            <Field label="Prompt repayment help (% points)" hint="3 under the interest subvention scheme">
              <Input className="w-24" inputMode="decimal" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
            <Field label="Repay by">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Note">
          <Input className="w-56" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {kind === 'KCC' && !loan && (
        <p className="mt-2 text-[13px] text-ink-muted">After saving, record each drawing and repayment; interest is worked out by the day.</p>
      )}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  )
}
