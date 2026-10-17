import { useState, type FormEvent } from 'react'
import { PROPERTY_EXPENSE_KINDS, type PropertyExpenseKind, type PropertyView } from '@shared/assets'
import { useData } from '../lib/data'
import { Card, day, field, inr, Label, lakhCrore, monthName, Primary, Sheet, signed, today, tone } from '../ui'

const EXPENSE_LABELS: Record<PropertyExpenseKind, string> = {
  PROPERTY_TAX: 'Property tax',
  MAINTENANCE: 'Society maintenance',
  REPAIR: 'Repairs',
  INSURANCE: 'Insurance',
  LOAN_INTEREST: 'Home loan interest',
  OTHER: 'Other'
}

const STATUS = {
  PAID: { mark: '✓', cls: 'border-gain/40 text-gain' },
  PART: { mark: '½', cls: 'border-warn/50 bg-warn-wash text-warn' },
  DUE: { mark: '○', cls: 'border-rule-strong text-ink-muted' },
  OVERDUE: { mark: '!', cls: 'border-loss/50 bg-loss/5 text-loss' }
} as const

function RentSheet({ p, onClose, month }: { p: PropertyView; onClose: () => void; month?: string }) {
  const { record } = useData()
  const due = p.rent?.months.find((x) => x.month === month) ?? p.rent?.months.find((x) => x.status !== 'PAID')
  const [f, setF] = useState({
    forMonth: due?.month ?? today().slice(0, 7),
    amount: String(due ? due.amount - due.paid : (p.rent?.current?.monthlyRent ?? '')),
    date: today()
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({
      type: 'RENT',
      propertyId: p.accountId,
      date: f.date,
      forMonth: f.forMonth,
      amount: Number(f.amount),
      tenancyId: due && due.tenancyId !== 'legacy' ? due.tenancyId : undefined
    })
    onClose()
  }
  return (
    <Sheet title={`Rent for ${p.meta.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Label text="For the month">
          <input type="month" required className={field} value={f.forMonth} onChange={(e) => setF({ ...f, forMonth: e.target.value })} />
        </Label>
        <Label text="Amount (₹)">
          <input type="number" inputMode="decimal" required min="1" className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Label>
        <Label text="Received on">
          <input type="date" required max={today()} className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Label>
        <div className="pb-3">
          <Primary type="submit" disabled={!(Number(f.amount) > 0)}>
            Record rent
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

function ExpenseSheet({ p, onClose }: { p: PropertyView; onClose: () => void }) {
  const { record } = useData()
  const [f, setF] = useState({ date: today(), kind: 'MAINTENANCE' as PropertyExpenseKind, amount: '', note: '' })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({ type: 'PROPERTY_EXPENSE', propertyId: p.accountId, date: f.date, kind: f.kind, amount: Number(f.amount), note: f.note.trim() || undefined })
    onClose()
  }
  return (
    <Sheet title={`Expense for ${p.meta.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Label text="What for">
          <select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PropertyExpenseKind })}>
            {PROPERTY_EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPENSE_LABELS[k]}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Amount (₹)">
          <input type="number" inputMode="decimal" required min="1" className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Label>
        <Label text="Paid on">
          <input type="date" required max={today()} className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Label>
        <Label text="Note (optional)">
          <input className={field} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Label>
        <div className="pb-3">
          <Primary type="submit" disabled={!(Number(f.amount) > 0)}>
            Save expense
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

export function Properties() {
  const { snapshot, pending } = useData()
  const [sheet, setSheet] = useState<{ kind: 'rent' | 'expense'; p: PropertyView; month?: string } | null>(null)
  if (!snapshot) return null
  return (
    <>
      {snapshot.properties.map((p) => {
        const r = p.rent
        const waiting = pending.filter((e) => (e.type === 'RENT' || e.type === 'PROPERTY_EXPENSE') && e.propertyId === p.accountId)
        return (
          <Card key={p.accountId} title={p.meta.name} aside={p.meta.cityName}>
            <div className="flex items-baseline justify-between">
              <div className="wide num text-left text-[26px] font-semibold">{lakhCrore(p.value)}</div>
              <div className={`num text-[14px] ${tone(p.gain)}`}>{signed(p.gain)}</div>
            </div>
            {p.market?.yoyPct !== null && p.market?.yoyPct !== undefined && (
              <div className="text-[13px] text-ink-muted">
                {p.market.cityName} prices {p.market.yoyPct >= 0 ? 'up' : 'down'} {Math.abs(p.market.yoyPct * 100).toFixed(1)}% in a year
              </div>
            )}
            {r && !r.assumed && (
              <>
                <div className="mt-3 mb-1 flex items-baseline justify-between text-[14px]">
                  <span>
                    {r.current ? `${r.current.tenant}, ${inr(r.current.monthlyRent)}/month` : 'No tenant now'}
                  </span>
                  {r.overdue > 0 && <span className="text-loss">{inr(r.overdue)} overdue</span>}
                </div>
                <ul className="grid grid-cols-4 gap-1.5" aria-label="Rent by month">
                  {r.months.map((m) => (
                    <li key={`${m.tenancyId}|${m.month}`}>
                      <button
                        className={`w-full rounded-lg border px-1.5 py-1 text-left ${STATUS[m.status].cls}`}
                        onClick={() => m.status !== 'PAID' && setSheet({ kind: 'rent', p, month: m.month })}
                      >
                        <div className="text-[11px] text-ink-muted">{monthName(m.month)}</div>
                        <div className="text-[13px] font-medium">
                          <span aria-hidden>{STATUS[m.status].mark}</span> {m.status === 'PART' ? inr(m.paid) : m.status.toLowerCase()}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                {r.endsInDays !== null && r.endsInDays <= 45 && (
                  <p className={`mt-2 text-[13px] ${r.endsInDays < 0 ? 'text-loss' : 'text-warn'}`}>
                    Agreement {r.endsInDays < 0 ? `ended ${-r.endsInDays} days ago` : `ends ${day(r.current?.endDate)}`}.
                  </p>
                )}
              </>
            )}
            {waiting.length > 0 && (
              <p className="mt-2 text-[13px] text-ink-muted">
                {waiting.length} entr{waiting.length === 1 ? 'y' : 'ies'} waiting for the computer.
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {r && !r.assumed && (
                <button className="min-h-11 rounded-xl bg-stamp-wash font-medium text-stamp" onClick={() => setSheet({ kind: 'rent', p })}>
                  Record rent
                </button>
              )}
              <button className="min-h-11 rounded-xl border border-rule-strong" onClick={() => setSheet({ kind: 'expense', p })}>
                Add expense
              </button>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[13px]">
              <dt className="text-ink-muted">Rent this year ({p.fy.label})</dt>
              <dd className="num">{inr(p.fy.rentReceived)}</dd>
              {p.yield && (
                <>
                  <dt className="text-ink-muted">Rental yield</dt>
                  <dd className="num">{(p.yield.gross * 100).toFixed(2)}%</dd>
                </>
              )}
            </dl>
          </Card>
        )
      })}
      {sheet?.kind === 'rent' && <RentSheet p={sheet.p} month={sheet.month} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'expense' && <ExpenseSheet p={sheet.p} onClose={() => setSheet(null)} />}
    </>
  )
}
