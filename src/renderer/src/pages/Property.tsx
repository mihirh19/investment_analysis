import { useMemo, useState, type FormEvent } from 'react'
import {
  PROPERTY_EXPENSE_KINDS,
  PROPERTY_SUBTYPES,
  type HousingCity,
  type PropertyExpenseKind,
  type PropertyMeta,
  type PropertySubtype,
  type PropertyView,
  type RentStatus,
  type Tenancy
} from '@shared/assets'
import { PriceLine } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  openExternal,
  useAddManualEntry,
  useDeleteManual,
  useDeleteManualEntry,
  useHousingCities,
  useManualAssets,
  usePersons,
  useProperties,
  useSaveManual
} from '../lib/api'
import { money, percent, shortDate, signedMoney, toneClass } from '../lib/format'
import { stagger, useCountUp } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'

const today = () => new Date().toISOString().slice(0, 10)
const newId = () => crypto.randomUUID().slice(0, 8)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const addMonthsIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const optNum = (s: string) => (s.trim() === '' ? undefined : Number(s))

/** Gujarat's land records and Jantri (guideline value) lookup. */
const GARVI_URL = 'https://garvi.gujarat.gov.in/'

export const SUBTYPE_LABELS: Record<PropertySubtype, string> = {
  FLAT: 'Flat',
  TENEMENT: 'Tenement',
  BUNGALOW: 'Bungalow',
  ROW_HOUSE: 'Row house',
  SHOP: 'Shop',
  OFFICE: 'Office',
  PLOT: 'Plot',
  LAND: 'Farm or land',
  OTHER: 'Other'
}
const TYPE_OF: Record<PropertySubtype, PropertyMeta['propertyType']> = {
  FLAT: 'RESIDENTIAL',
  TENEMENT: 'RESIDENTIAL',
  BUNGALOW: 'RESIDENTIAL',
  ROW_HOUSE: 'RESIDENTIAL',
  SHOP: 'COMMERCIAL',
  OFFICE: 'COMMERCIAL',
  PLOT: 'LAND',
  LAND: 'LAND',
  OTHER: 'OTHER'
}
const EXPENSE_LABELS: Record<PropertyExpenseKind, string> = {
  PROPERTY_TAX: 'Property tax',
  MAINTENANCE: 'Society maintenance',
  REPAIR: 'Repairs',
  INSURANCE: 'Insurance',
  LOAN_INTEREST: 'Home loan interest',
  OTHER: 'Other'
}
const BAND_LABELS: Record<string, string> = {
  ALL: 'all home sizes',
  LT60: 'homes under 645 sq ft carpet',
  '60TO110': 'homes of 645–1,185 sq ft carpet',
  GT110: 'homes over 1,185 sq ft carpet'
}
const STATUS: Record<RentStatus, { text: string; mark: string; cls: string }> = {
  PAID: { text: 'Paid', mark: '✓', cls: 'border-gain/40 text-gain' },
  PART: { text: 'Part paid', mark: '½', cls: 'border-warn/50 bg-warn-wash text-warn' },
  DUE: { text: 'Due', mark: '○', cls: 'border-rule-strong text-ink-muted' },
  OVERDUE: { text: 'Overdue', mark: '!', cls: 'border-loss/50 bg-loss/5 text-loss' }
}

/** Saves the property with some of its details changed. */
function useUpdate(p: PropertyView) {
  const save = useSaveManual()
  const put = (patch: Partial<PropertyMeta>, onSuccess?: () => void) =>
    save.mutate([{ accountId: p.accountId, personId: p.personId, meta: { ...p.meta, ...patch } }], { onSuccess })
  return { put, pending: save.isPending, error: save.error }
}

export function Property() {
  const { scope } = useScope()
  const q = useProperties(scopePersonId(scope))
  const [editing, setEditing] = useState<PropertyView | 'new' | null>(null)
  const list = q.data ?? []
  const total = list.reduce((s, p) => s + (p.value ?? 0), 0)
  const shownTotal = useCountUp(total)
  const rentFy = list.reduce((s, p) => s + p.fy.rentReceived, 0)
  const overdue = list.reduce((s, p) => s + (p.rent?.overdue ?? 0), 0)
  const fyLabel = list[0]?.fy.label

  return (
    <>
      <PageHeader title="Property">
        {editing === null && <Button onClick={() => setEditing('new')}>Add a property</Button>}
      </PageHeader>
      <ErrorNote error={q.error} />

      {list.length > 0 && (
        <div className="mb-8 flex flex-wrap items-baseline gap-x-12 gap-y-3">
          <div>
            <div className="text-[13px] text-ink-muted">Worth today</div>
            <div className="wide num text-[30px] font-semibold">{money(shownTotal)}</div>
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">Rent received in {fyLabel}</div>
            <div className="num text-[20px] font-medium">{money(rentFy)}</div>
          </div>
          {overdue > 0 && (
            <div>
              <div className="text-[13px] text-loss">Rent overdue</div>
              <div className="num text-[20px] font-medium text-loss">{money(overdue)}</div>
            </div>
          )}
        </div>
      )}

      {editing !== null && (
        <PropertyForm p={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      )}

      {list.length === 0 && editing === null && !q.isLoading && (
        <div className="max-w-[72ch] py-4">
          <p className="text-ink-muted">
            Add your home, flat, tenement, shop or land. Pick its city and the value follows that city&rsquo;s home
            prices from NHB RESIDEX, the National Housing Bank&rsquo;s quarterly index built from bank valuations. If
            it is let out, add the tenancy and record rent as it comes in: the page shows who has paid, what is
            overdue, the rental yield and this year&rsquo;s income from house property for your return.
          </p>
          <Button className="mt-4" onClick={() => setEditing('new')}>
            Add your first property
          </Button>
        </div>
      )}

      {list.map((p, i) => (
        <PropertySection
          key={p.accountId}
          p={p}
          index={i}
          showPerson={scope === 'family'}
          onEdit={() => setEditing(p)}
        />
      ))}
    </>
  )
}

// ---------------- one property ----------------

function PropertySection({
  p,
  index,
  showPerson,
  onEdit
}: {
  p: PropertyView
  index: number
  showPerson: boolean
  onEdit: () => void
}) {
  const del = useDeleteManual()
  const m = p.meta
  const facts = [
    m.subtype ? SUBTYPE_LABELS[m.subtype] : null,
    m.locality,
    m.cityName,
    m.carpetAreaSqft ? `${m.carpetAreaSqft.toLocaleString('en-IN')} sq ft carpet` : null,
    `bought ${shortDate(m.purchaseDate)}`,
    showPerson ? p.personName : null
  ].filter(Boolean) as string[]

  return (
    <section className="anim-page mb-12 border-t border-rule-strong pt-5" style={stagger(index, 60, 300)}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[21px] leading-tight font-semibold">{m.name}</h2>
          <div className="mt-1 text-[14px] text-ink-muted">
            {facts.map((f) => (
              <span key={f} className="mr-4">
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="wide num text-[28px] leading-tight font-semibold">{money(p.value)}</div>
          <div className={`num text-[14px] ${toneClass(p.gain)}`}>
            {signedMoney(p.gain)}
            {p.gain !== null && p.invested > 0 && <span className="ml-2">{percent(p.gain / p.invested)}</span>}
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-[90ch] text-[14px] text-ink-muted">{p.valuationNote}</p>

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="min-w-0">
          <Market p={p} />
          <Estimates p={p} />
        </div>
        <div className="min-w-0">
          <Rent p={p} />
          <Expenses p={p} />
          <Returns p={p} />
          <HouseIncome p={p} />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="quiet" onClick={onEdit}>
          Edit details
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            confirm(`Remove ${m.name} with its rent and expense records?`) && del.mutate([p.accountId])
          }
        >
          Remove
        </Button>
      </div>
      <ErrorNote error={del.error} />
    </section>
  )
}

function Rows({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="text-[14px]">
      {rows.map(([k, v, cls]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-rule py-1.5">
          <dt className="text-ink-muted">{k}</dt>
          <dd className={`num text-right ${cls ?? ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function H({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <h3 className="text-[15px] font-semibold">{children}</h3>
      {aside && <div className="text-[13px] text-ink-muted">{aside}</div>}
    </div>
  )
}

// ---------------- the city's market ----------------

function Market({ p }: { p: PropertyView }) {
  const mk = p.market
  const m = p.meta
  if (!mk)
    return (
      <div className="mb-8">
        <H>Market price</H>
        <p className="text-[14px] text-ink-muted">
          Choose the city in Edit details to follow its home prices. NHB RESIDEX covers about 50 cities, including
          Ahmedabad, Gandhinagar, Rajkot, Surat and Vadodara.
        </p>
      </div>
    )
  const latest = mk.latest
  const rows: [string, React.ReactNode, string?][] = []
  if (latest) {
    rows.push([`${mk.cityName} average, ${BAND_LABELS[mk.band]}`, `${money(latest.close, 'INR', 0)}/sq ft`])
    if (mk.yoyPct !== null) rows.push(['Change over a year', percent(mk.yoyPct), toneClass(mk.yoyPct)])
    rows.push(['Latest quarter', `to ${shortDate(latest.date)}`])
  }
  if (p.areaCheck)
    rows.push([
      `Your ${m.carpetAreaSqft!.toLocaleString('en-IN')} sq ft at the city average`,
      money(p.areaCheck.value)
    ])
  if (m.jantriValue)
    rows.push([`Jantri value${m.jantriDate ? `, ${shortDate(m.jantriDate)}` : ''}`, money(m.jantriValue)])
  return (
    <div className="mb-8">
      <H aside={latest ? 'NHB RESIDEX, quarterly' : undefined}>{mk.cityName} home prices, ₹ per sq ft</H>
      {mk.series.length > 1 ? (
        <PriceLine
          points={mk.series}
          label={`${mk.cityName} average price per sq ft, ${BAND_LABELS[mk.band]}`}
          format={(v) => `${money(v, 'INR', 0)}/sq ft`}
          axisFormat={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`}
          height={200}
        />
      ) : (
        <p className="py-6 text-[14px] text-ink-muted">
          {mk.cityName}&rsquo;s price series downloads with the next market refresh (it needs the internet).
        </p>
      )}
      <div className="mt-3">
        <Rows rows={rows} />
      </div>
      {p.areaCheck && p.value && (
        <p className="mt-2 text-[13px] text-ink-muted">
          {Math.abs(p.value / p.areaCheck.value - 1) < 0.05
            ? 'The value is in line with the city average for this size.'
            : `The value is ${percent(p.value / p.areaCheck.value - 1).replace('+', '')} ${p.value > p.areaCheck.value ? 'above' : 'below'} the city average for this size. Locality, floor, age and amenities explain most of that.`}
        </p>
      )}
    </div>
  )
}

// ---------------- your own estimates ----------------

function Estimates({ p }: { p: PropertyView }) {
  const assets = useManualAssets()
  const add = useAddManualEntry()
  const del = useDeleteManualEntry()
  const [date, setDate] = useState(today())
  const [value, setValue] = useState('')
  const entries = assets.data?.find((a) => a.accountId === p.accountId)?.entries ?? []
  return (
    <div>
      <H aside={p.mode === 'INDEX' ? 'The latest one is grown with city prices' : undefined}>Your estimates</H>
      <p className="mb-2 text-[13px] text-ink-muted">
        A broker&rsquo;s quote, a sale nearby, a bank valuation: add it with its date and it becomes the starting
        point.
      </p>
      {entries.length > 0 && (
        <table className="w-full text-[14px]">
          <tbody>
            {[...entries].reverse().map((e) => (
              <tr key={e.date} className="border-b border-rule">
                <td className="py-1">{shortDate(e.date)}</td>
                <td className="num py-1 text-right">{money(e.value)}</td>
                <td className="w-20 py-0.5 text-right">
                  <button
                    className="px-2 text-[13px] text-loss hover:underline"
                    onClick={() => del.mutate([p.accountId, e.date])}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          add.mutate([p.accountId, date, Number(value)], { onSuccess: () => setValue('') })
        }}
      >
        <Field label="On">
          <Input type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Worth (₹)">
          <Input
            type="number"
            required
            min="1"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-40"
          />
        </Field>
        <Button type="submit" variant="quiet" disabled={add.isPending}>
          Add estimate
        </Button>
      </form>
      <ErrorNote error={add.error ?? del.error} />
    </div>
  )
}

// ---------------- rent ----------------

function Rent({ p }: { p: PropertyView }) {
  const r = p.rent
  const up = useUpdate(p)
  const [tenancyForm, setTenancyForm] = useState<Tenancy | 'new' | null>(null)
  const [pay, setPay] = useState<{ forMonth: string; amount: string; date: string; tenancyId?: string } | null>(null)
  const tenancies = p.meta.tenancies ?? []
  const payments = [...(p.meta.rentPayments ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const unpaid = r?.months.filter((x) => x.status === 'OVERDUE' || (x.status === 'PART' && x.dueDate < today())) ?? []

  const startPay = (forMonth?: string) => {
    const due = r?.months.find((x) => x.month === forMonth) ?? r?.months.find((x) => x.status !== 'PAID')
    setPay({
      forMonth: due?.month ?? today().slice(0, 7),
      amount: String(due ? due.amount - due.paid : (r?.current?.monthlyRent ?? '')),
      date: today(),
      tenancyId: due?.tenancyId
    })
  }
  const savePayment = (e: FormEvent) => {
    e.preventDefault()
    if (!pay) return
    const tenancyId = pay.tenancyId && pay.tenancyId !== 'legacy' ? pay.tenancyId : undefined
    up.put(
      {
        rentPayments: [
          ...(p.meta.rentPayments ?? []),
          { id: newId(), date: pay.date, forMonth: pay.forMonth, amount: Number(pay.amount), tenancyId }
        ]
      },
      () => setPay(null)
    )
  }
  const markOverduePaid = () => {
    if (!confirm(`Record ${unpaid.length} month${unpaid.length > 1 ? 's' : ''} of rent as received on their due dates?`))
      return
    up.put({
      rentPayments: [
        ...(p.meta.rentPayments ?? []),
        ...unpaid.map((x) => ({
          id: newId(),
          date: x.dueDate,
          forMonth: x.month,
          amount: x.amount - x.paid,
          tenancyId: x.tenancyId !== 'legacy' ? x.tenancyId : undefined
        }))
      ]
    })
  }

  return (
    <div className="mb-8">
      <H aside={r?.current ? `${money(r.current.monthlyRent)} a month` : undefined}>Rent</H>

      {!r && tenancyForm === null && (
        <div className="text-[14px] text-ink-muted">
          <p>Not let out. If it is, add the tenancy to track rent month by month.</p>
          <Button variant="quiet" className="mt-2" onClick={() => setTenancyForm('new')}>
            Add a tenancy
          </Button>
        </div>
      )}

      {r?.assumed && tenancyForm === null && (
        <div className="mb-3 rounded-md border border-rule bg-sheet px-3 py-2 text-[14px]">
          Rent of {money(p.meta.monthlyRent)} a month is assumed to arrive. Add the tenancy to see who has paid and
          what is late.
          <div>
            <Button variant="quiet" className="mt-2" onClick={() => setTenancyForm('new')}>
              Add the tenancy
            </Button>
          </div>
        </div>
      )}

      {r && !r.assumed && (
        <>
          {r.current ? (
            <div className="mb-3 text-[14px]">
              <span className="font-medium">{r.current.tenant}</span>
              <span className="ml-3 text-ink-muted">
                due on the {ordinal(r.current.dueDay ?? 1)}
                {r.current.deposit ? `, ${money(r.current.deposit)} deposit held` : ''}
              </span>
              {r.endsInDays !== null && (
                <div
                  className={
                    'mt-1 text-[13px] ' +
                    (r.endsInDays < 0 ? 'text-loss' : r.endsInDays <= 45 ? 'text-warn' : 'text-ink-muted')
                  }
                >
                  {r.endsInDays < 0
                    ? `Agreement ended ${-r.endsInDays} days ago, ${shortDate(r.current.endDate)}. Renew it or end the tenancy.`
                    : r.endsInDays <= 45
                      ? `Agreement ends in ${r.endsInDays} days, ${shortDate(r.current.endDate)}. Time to renew.`
                      : `Agreement runs to ${shortDate(r.current.endDate)}`}
                </div>
              )}
            </div>
          ) : (
            <p className="mb-3 text-[14px] text-ink-muted">No tenant at the moment.</p>
          )}

          {r.months.length > 0 && (
            <ul className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 2xl:grid-cols-6" aria-label="Rent by month">
              {r.months.map((x) => {
                const s = STATUS[x.status]
                return (
                  <li key={`${x.tenancyId}|${x.month}`}>
                    <button
                      type="button"
                      onClick={() => x.status !== 'PAID' && startPay(x.month)}
                      title={`${monthName(x.month)}: ${money(x.paid)} of ${money(x.amount)}, due ${shortDate(x.dueDate)}`}
                      className={`w-full rounded-md border px-2 py-1 text-left ${s.cls} ${x.status === 'PAID' ? 'cursor-default' : 'hover:brightness-95'}`}
                    >
                      <div className="text-[12px] text-ink-muted">{monthName(x.month)}</div>
                      <div className="text-[13px] font-medium">
                        <span aria-hidden className="mr-1">
                          {s.mark}
                        </span>
                        {x.status === 'PART' ? `${money(x.paid)} paid` : s.text}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <Rows
            rows={[
              [`Received in ${p.fy.label}`, money(r.receivedThisFy)],
              ...(r.overdue > 0
                ? [[`Overdue, ${r.overdueMonths} month${r.overdueMonths > 1 ? 's' : ''}`, money(r.overdue), 'text-loss'] as [
                    string,
                    string,
                    string
                  ]]
                : [])
            ]}
          />

          {pay === null && tenancyForm === null && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => startPay()}>Record rent</Button>
              {unpaid.length > 1 && (
                <Button variant="quiet" onClick={markOverduePaid} disabled={up.pending}>
                  Mark {unpaid.length} overdue months as received
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {pay && (
        <form onSubmit={savePayment} className="anim-pop mt-3 flex flex-wrap items-end gap-2 rounded-md border border-rule bg-sheet p-3">
          <Field label="For">
            <Input
              type="month"
              required
              value={pay.forMonth}
              onChange={(e) => setPay({ ...pay, forMonth: e.target.value })}
            />
          </Field>
          <Field label="Amount (₹)">
            <Input
              type="number"
              required
              min="1"
              step="any"
              className="w-32"
              value={pay.amount}
              onChange={(e) => setPay({ ...pay, amount: e.target.value })}
            />
          </Field>
          <Field label="Received on">
            <Input
              type="date"
              required
              max={today()}
              value={pay.date}
              onChange={(e) => setPay({ ...pay, date: e.target.value })}
            />
          </Field>
          <Button type="submit" disabled={up.pending}>
            Save
          </Button>
          <Button type="button" variant="quiet" onClick={() => setPay(null)}>
            Cancel
          </Button>
        </form>
      )}

      {tenancyForm !== null && (
        <TenancyForm
          p={p}
          t={tenancyForm === 'new' ? null : tenancyForm}
          onDone={() => setTenancyForm(null)}
        />
      )}

      {tenancies.length > 0 && tenancyForm === null && (
        <details className="mt-4 text-[14px]">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">
            Tenancies and payments ({tenancies.length}, {payments.length})
          </summary>
          <table className="mt-2 w-full">
            <tbody>
              {[...tenancies]
                .sort((a, b) => b.startDate.localeCompare(a.startDate))
                .map((t) => (
                  <tr key={t.id} className="border-b border-rule">
                    <td className="py-1">{t.tenant}</td>
                    <td className="py-1 text-ink-muted">
                      {shortDate(t.startDate)} to {t.endDate ? shortDate(t.endDate) : 'open'}
                    </td>
                    <td className="num py-1 text-right">{money(t.monthlyRent)}</td>
                    <td className="w-16 py-0.5 text-right">
                      <button className="px-2 text-[13px] text-stamp hover:underline" onClick={() => setTenancyForm(t)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <button className="mt-2 text-[13px] text-stamp hover:underline" onClick={() => setTenancyForm('new')}>
            Add a tenancy (new tenant or renewed agreement)
          </button>
          {payments.length > 0 && (
            <table className="mt-4 w-full">
              <thead>
                <tr className="text-left text-[12px] text-ink-muted">
                  <th className="font-normal">Received</th>
                  <th className="font-normal">For</th>
                  <th className="text-right font-normal">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 24).map((x) => (
                  <tr key={x.id} className="border-b border-rule">
                    <td className="py-1">{shortDate(x.date)}</td>
                    <td className="py-1 text-ink-muted">{monthName(x.forMonth)}</td>
                    <td className="num py-1 text-right">{money(x.amount)}</td>
                    <td className="w-20 py-0.5 text-right">
                      <button
                        className="px-2 text-[13px] text-loss hover:underline"
                        onClick={() =>
                          up.put({ rentPayments: (p.meta.rentPayments ?? []).filter((y) => y.id !== x.id) })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      )}
      <ErrorNote error={up.error} />
    </div>
  )
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

function TenancyForm({ p, t, onDone }: { p: PropertyView; t: Tenancy | null; onDone: () => void }) {
  const up = useUpdate(p)
  const start0 = t?.startDate ?? today().slice(0, 8) + '01'
  const [v, setV] = useState({
    tenant: t?.tenant ?? '',
    phone: t?.phone ?? '',
    startDate: start0,
    // Most agreements in Gujarat are leave and licence for 11 months.
    endDate: t ? (t.endDate ?? '') : dayBefore(addMonthsIso(start0, 11)),
    monthlyRent: String(t?.monthlyRent ?? p.meta.monthlyRent ?? ''),
    dueDay: String(t?.dueDay ?? 5),
    deposit: String(t?.deposit ?? '')
  })
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Tenancy = {
      id: t?.id ?? newId(),
      tenant: v.tenant.trim(),
      phone: v.phone.trim() || undefined,
      startDate: v.startDate,
      endDate: v.endDate || null,
      monthlyRent: Number(v.monthlyRent),
      dueDay: Number(v.dueDay) || 1,
      deposit: optNum(v.deposit)
    }
    const others = (p.meta.tenancies ?? []).filter((x) => x.id !== next.id)
    // Tracking tenancies replaces the single assumed rent figure.
    up.put({ tenancies: [...others, next], monthlyRent: undefined }, onDone)
  }
  const remove = () => {
    if (!t || !confirm(`Remove the tenancy of ${t.tenant}? Payments recorded stay.`)) return
    up.put({ tenancies: (p.meta.tenancies ?? []).filter((x) => x.id !== t.id) }, onDone)
  }
  return (
    <form onSubmit={submit} className="anim-pop mt-3 rounded-md border border-rule bg-sheet p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenant">
          <Input required value={v.tenant} onChange={(e) => set('tenant', e.target.value)} />
        </Field>
        <Field label="Phone" hint="Optional">
          <Input value={v.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Rent a month (₹)">
          <Input
            type="number"
            required
            min="1"
            step="any"
            value={v.monthlyRent}
            onChange={(e) => set('monthlyRent', e.target.value)}
          />
        </Field>
        <Field label="Due on day">
          <Input
            type="number"
            required
            min="1"
            max="28"
            value={v.dueDay}
            onChange={(e) => set('dueDay', e.target.value)}
          />
        </Field>
        <Field label="Agreement from">
          <Input
            type="date"
            required
            value={v.startDate}
            onChange={(e) => {
              const s = e.target.value
              setV((x) => ({ ...x, startDate: s, endDate: t || !s ? x.endDate : dayBefore(addMonthsIso(s, 11)) }))
            }}
          />
        </Field>
        <Field label="Agreement to" hint="Leave empty if open-ended">
          <Input type="date" min={v.startDate} value={v.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
        <Field label="Deposit held (₹)" hint="Optional">
          <Input type="number" min="0" step="any" value={v.deposit} onChange={(e) => set('deposit', e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={up.error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="submit" disabled={up.pending}>
          {t ? 'Save tenancy' : 'Add tenancy'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        {t && (
          <Button type="button" variant="danger" onClick={remove}>
            Remove tenancy
          </Button>
        )}
      </div>
    </form>
  )
}

// ---------------- expenses ----------------

function Expenses({ p }: { p: PropertyView }) {
  const up = useUpdate(p)
  const [open, setOpen] = useState(false)
  const [v, setV] = useState({ date: today(), kind: 'PROPERTY_TAX' as PropertyExpenseKind, amount: '', note: '' })
  const list = [...(p.meta.expenses ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    up.put(
      {
        expenses: [
          ...(p.meta.expenses ?? []),
          { id: newId(), date: v.date, kind: v.kind, amount: Number(v.amount), note: v.note.trim() || undefined }
        ]
      },
      () => {
        setV((s) => ({ ...s, amount: '', note: '' }))
        setOpen(false)
      }
    )
  }
  return (
    <div className="mb-8">
      <H aside={list.length ? `${money(p.fy.propertyTax + p.fy.otherExpenses + p.fy.loanInterest)} in ${p.fy.label}` : undefined}>
        Expenses
      </H>
      {list.length === 0 && !open && (
        <p className="text-[14px] text-ink-muted">
          Property tax, society maintenance, repairs and home loan interest. They lower the net yield, and property tax
          and loan interest lower the taxable rent.
        </p>
      )}
      {list.length > 0 && (
        <table className="w-full text-[14px]">
          <tbody>
            {list.slice(0, 12).map((x) => (
              <tr key={x.id} className="border-b border-rule">
                <td className="py-1">{shortDate(x.date)}</td>
                <td className="py-1">
                  {EXPENSE_LABELS[x.kind]}
                  {x.note && <span className="ml-2 text-ink-muted">{x.note}</span>}
                </td>
                <td className="num py-1 text-right">{money(x.amount)}</td>
                <td className="w-20 py-0.5 text-right">
                  <button
                    className="px-2 text-[13px] text-loss hover:underline"
                    onClick={() => up.put({ expenses: (p.meta.expenses ?? []).filter((y) => y.id !== x.id) })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? (
        <form onSubmit={submit} className="anim-pop mt-3 flex flex-wrap items-end gap-2 rounded-md border border-rule bg-sheet p-3">
          <Field label="Paid on">
            <Input type="date" required max={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="For">
            <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as PropertyExpenseKind })}>
              {PROPERTY_EXPENSE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EXPENSE_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input
              type="number"
              required
              min="1"
              step="any"
              className="w-32"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          </Field>
          <Field label="Note">
            <Input className="w-40" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
          <Button type="submit" disabled={up.pending}>
            Save
          </Button>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="quiet" className="mt-3" onClick={() => setOpen(true)}>
          Add an expense
        </Button>
      )}
      <ErrorNote error={up.error} />
    </div>
  )
}

// ---------------- returns and tax ----------------

function Returns({ p }: { p: PropertyView }) {
  const rows: [string, React.ReactNode, string?][] = [
    [p.meta.buyingCosts ? 'Cost, with stamp duty and registration' : 'Cost', money(p.invested)],
    ['Gain in value', signedMoney(p.gain), toneClass(p.gain)]
  ]
  if (p.cagr !== null) rows.push(['Value growth a year', percent(p.cagr), toneClass(p.cagr)])
  if (p.totalReturn !== null)
    rows.push(['Return a year, with rent and expenses', percent(p.totalReturn), toneClass(p.totalReturn)])
  if (p.yield) {
    rows.push(['Rental yield, last 12 months', percent(p.yield.gross).replace('+', '')])
    rows.push(['Net of expenses', percent(p.yield.net).replace('+', '')])
  }
  return (
    <div className="mb-8">
      <H>Returns</H>
      <Rows rows={rows} />
      {p.yield && (
        <p className="mt-2 text-[13px] text-ink-muted">
          Residential rent in Indian cities usually yields 2–3.5% a year; a fixed deposit pays about 6.5–7%.
        </p>
      )}
    </div>
  )
}

function HouseIncome({ p }: { p: PropertyView }) {
  const f = p.fy
  if (f.taxableIncome === null) return null
  const nav = Math.max(0, f.rentReceived - f.propertyTax)
  return (
    <div className="mb-2">
      <H aside="Let-out property, old and new regime">Income from house property, {f.label}</H>
      <Rows
        rows={[
          ['Rent received', money(f.rentReceived)],
          ['Less property tax paid', money(f.propertyTax)],
          ['Net annual value', money(nav)],
          ['Less 30% standard deduction', money(nav * 0.3)],
          ...(f.loanInterest > 0 ? [['Less home loan interest', money(f.loanInterest)] as [string, string]] : []),
          ['Taxable', money(f.taxableIncome), f.taxableIncome < 0 ? 'text-gain font-medium' : 'font-medium']
        ]}
      />
      <p className="mt-2 text-[13px] text-ink-muted">
        The 30% deduction covers repairs and maintenance, so those aren&rsquo;t deducted again.
        {f.taxableIncome < 0 && ' A loss can be set off against other income up to ₹2 lakh a year (old regime).'}
        {p.rent?.assumed && ' Rent here is assumed, not recorded.'}
      </p>
    </div>
  )
}

// ---------------- add or edit a property ----------------

function PropertyForm({ p, onDone }: { p: PropertyView | null; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const cities = useHousingCities()
  const save = useSaveManual()
  const addEntry = useAddManualEntry()
  const m = p?.meta
  const s = (x: number | undefined | null) => (x === undefined || x === null ? '' : String(x))
  const [personId, setPersonId] = useState<number>(p?.personId ?? (scope === 'family' ? (persons[0]?.id ?? 1) : scope))
  const [v, setV] = useState({
    name: m?.name ?? '',
    subtype: (m?.subtype ?? 'FLAT') as PropertySubtype,
    locality: m?.locality ?? '',
    cityId: s(m?.cityId),
    carpetAreaSqft: s(m?.carpetAreaSqft),
    builtUpAreaSqft: s(m?.builtUpAreaSqft),
    purchasePrice: s(m?.purchasePrice),
    purchaseDate: m?.purchaseDate ?? '',
    buyingCosts: s(m?.buyingCosts),
    valuation: (m ? (m.valuation ?? (m.cityId ? 'INDEX' : 'MANUAL')) : 'INDEX') as NonNullable<PropertyMeta['valuation']>,
    premiumPct: s(m?.premiumPct),
    appreciation: s(m?.appreciation),
    estimate: '',
    jantriValue: s(m?.jantriValue),
    jantriDate: m?.jantriDate ?? ''
  })
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }))

  // Gujarat first, then the other states alphabetically.
  const byState = useMemo(() => {
    const g = new Map<string, HousingCity[]>()
    for (const c of cities.data ?? []) g.set(c.state, [...(g.get(c.state) ?? []), c])
    const guj = (x: string) => x.toUpperCase() === 'GUJARAT'
    return [...g].sort(([a], [b]) => (guj(a) ? -1 : guj(b) ? 1 : a.localeCompare(b)))
  }, [cities.data])
  const city = cities.data?.find((c) => String(c.id) === v.cityId)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const cityId = optNum(v.cityId)
    const meta: PropertyMeta = {
      ...(m ?? {}),
      kind: 'PROPERTY',
      name: v.name.trim(),
      propertyType: TYPE_OF[v.subtype],
      subtype: v.subtype,
      locality: v.locality.trim() || undefined,
      cityId,
      cityName: cityId ? (city?.name ?? m?.cityName) : undefined,
      carpetAreaSqft: optNum(v.carpetAreaSqft),
      builtUpAreaSqft: optNum(v.builtUpAreaSqft),
      purchasePrice: Number(v.purchasePrice),
      purchaseDate: v.purchaseDate,
      buyingCosts: optNum(v.buyingCosts),
      valuation: v.valuation,
      premiumPct: v.valuation === 'AREA' ? optNum(v.premiumPct) : undefined,
      appreciation: optNum(v.appreciation),
      jantriValue: optNum(v.jantriValue),
      jantriDate: v.jantriValue.trim() ? v.jantriDate || today() : undefined
    }
    save.mutate([{ accountId: p?.accountId, personId, meta }], {
      onSuccess: (id) => {
        const est = Number(v.estimate)
        if (v.estimate.trim() && est > 0) addEntry.mutate([id, today(), est])
        onDone()
      }
    })
  }

  const needsArea = v.valuation === 'AREA'
  return (
    <form onSubmit={submit} className="anim-pop mb-10 rounded-md border border-rule bg-sheet p-5">
      <h2 className="mb-4 text-[17px] font-semibold">{p ? `Edit ${m!.name}` : 'Add a property'}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Field label="Whose">
          <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
            {persons.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" hint="e.g. Flat in Vastrapur">
          <Input required value={v.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={v.subtype} onChange={(e) => set('subtype', e.target.value as PropertySubtype)}>
            {PROPERTY_SUBTYPES.map((k) => (
              <option key={k} value={k}>
                {SUBTYPE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Locality" hint="Optional, e.g. Satellite">
          <Input value={v.locality} onChange={(e) => set('locality', e.target.value)} />
        </Field>

        <Field
          label="City, for the live price"
          hint={
            cities.isError
              ? 'The city list needs the internet. You can add the city later.'
              : cities.isLoading
                ? 'Loading cities…'
                : 'Not listed? Pick the nearest city, or leave it empty'
          }
        >
          <Select value={v.cityId} onChange={(e) => set('cityId', e.target.value)}>
            <option value="">None</option>
            {m?.cityId && !city && <option value={String(m.cityId)}>{m.cityName}</option>}
            {byState.map(([state, list]) => (
              <optgroup key={state} label={state === state.toUpperCase() ? state.charAt(0) + state.slice(1).toLowerCase() : state}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Carpet area (sq ft)" hint="From the agreement; picks the size band">
          <Input
            type="number"
            min="1"
            step="any"
            required={needsArea}
            value={v.carpetAreaSqft}
            onChange={(e) => set('carpetAreaSqft', e.target.value)}
          />
        </Field>
        <Field label="Built-up or plot area (sq ft)" hint="Optional">
          <Input
            type="number"
            min="1"
            step="any"
            value={v.builtUpAreaSqft}
            onChange={(e) => set('builtUpAreaSqft', e.target.value)}
          />
        </Field>
        <div />

        <Field label="Price paid (₹)">
          <Input
            type="number"
            required
            min="1"
            step="any"
            value={v.purchasePrice}
            onChange={(e) => set('purchasePrice', e.target.value)}
          />
        </Field>
        <Field label="Bought on">
          <Input
            type="date"
            required
            max={today()}
            value={v.purchaseDate}
            onChange={(e) => set('purchaseDate', e.target.value)}
          />
        </Field>
        <Field label="Stamp duty, registration, brokerage (₹)" hint="Optional; part of the cost for tax">
          <Input
            type="number"
            min="0"
            step="any"
            value={v.buyingCosts}
            onChange={(e) => set('buyingCosts', e.target.value)}
          />
        </Field>
        {!p && (
          <Field label="Worth today, your estimate (₹)" hint="Optional; better than an old purchase price">
            <Input type="number" min="1" step="any" value={v.estimate} onChange={(e) => set('estimate', e.target.value)} />
          </Field>
        )}
      </div>

      <fieldset className="mt-6">
        <legend className="mb-2 text-[14px] font-medium">How to value it</legend>
        <div className="grid gap-2 lg:grid-cols-3">
          {(
            [
              ['INDEX', 'Grow with city prices', 'Your latest estimate, or the price paid, moved up or down with the city’s RESIDEX price.'],
              ['AREA', 'Carpet area × city price', 'The city’s average price per sq ft for this size of home, adjusted for the locality.'],
              ['MANUAL', 'Only my estimates', 'Your own estimates, with a yearly growth rate between them if you set one. Best for land.']
            ] as const
          ).map(([key, title, detail]) => (
            <label
              key={key}
              className={
                'flex cursor-pointer gap-2 rounded-md border p-3 ' +
                (v.valuation === key ? 'border-stamp bg-stamp-wash' : 'border-rule-strong')
              }
            >
              <input
                type="radio"
                name="valuation"
                className="mt-1"
                checked={v.valuation === key}
                onChange={() => set('valuation', key)}
              />
              <span>
                <span className="block text-[14px] font-medium">{title}</span>
                <span className="block text-[13px] text-ink-muted">{detail}</span>
              </span>
            </label>
          ))}
        </div>
        {v.valuation !== 'MANUAL' && !v.cityId && (
          <p className="mt-2 text-[13px] text-warn">Choose a city above for this to work.</p>
        )}
      </fieldset>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {needsArea && (
          <Field label="Locality premium (%)" hint="+20 if pricier than the city average, −10 if cheaper">
            <Input type="number" step="any" value={v.premiumPct} onChange={(e) => set('premiumPct', e.target.value)} />
          </Field>
        )}
        <Field
          label="Yearly growth to assume (%)"
          hint={v.valuation === 'MANUAL' ? 'Optional; used between your estimates' : 'Optional; used before the city series starts (mid-2018)'}
        >
          <Input type="number" step="any" value={v.appreciation} onChange={(e) => set('appreciation', e.target.value)} />
        </Field>
        <Field label="Jantri value (₹)" hint="Optional; the government guideline value">
          <Input type="number" min="0" step="any" value={v.jantriValue} onChange={(e) => set('jantriValue', e.target.value)} />
        </Field>
        <Field label="Jantri looked up on">
          <Input type="date" max={today()} value={v.jantriDate} onChange={(e) => set('jantriDate', e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-[13px] text-ink-muted">
        Gujarat&rsquo;s Jantri rates are on{' '}
        <button type="button" className="text-stamp hover:underline" onClick={() => void openExternal(GARVI_URL)}>
          GARVI
        </button>
        . Stamp duty is charged on the higher of the deal price and the Jantri value.
      </p>

      <ErrorNote error={save.error ?? addEntry.error} />
      <div className="mt-5 flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : p ? 'Save changes' : 'Add property'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

