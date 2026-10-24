import { useEffect, useRef, useState } from 'react'
import {
  EXPENSE_LABELS,
  PLAN_BUCKET_LABELS,
  PLAN_BUCKETS,
  type ExpenseKey,
  type Forecast as ForecastData,
  type Plan,
  type PlanBucket,
  type PlanGoal,
  type PlanSip
} from '@shared/plan'
import { LineCompare } from '../components/chart/extra'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { Button, Select } from '../components/ui'
import { openExternal, useForecast, usePersons, useSavePlan } from '../lib/api'
import { lakhCrore, money } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const newId = () => crypto.randomUUID().slice(0, 8)
const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
const thisYear = new Date().getFullYear()
const thisMonth = new Date().toISOString().slice(0, 7)

/** Private-hospital costs rise faster than the CPI health index, which weights government care heavily. */
const MEDICAL_TREND = {
  rate: 11.5,
  label: 'Private healthcare 11.5% (Aon, 2026)',
  url: 'https://www.aon.com/apac/in-the-press/asia-newsroom/2025/india-outpaces-global-average-with-2026-medical-trend-at-11-5-percent-aon-reports'
}
const MOSPI = 'https://www.mospi.gov.in/'

/** A number box that keeps what is typed and commits a number when typing pauses or focus leaves. */
function Num({
  value,
  onCommit,
  placeholder,
  step = 'any',
  className = 'w-28',
  label,
  allowEmpty = false
}: {
  value: number | null
  onCommit: (v: number | null) => void
  placeholder?: string
  step?: string
  className?: string
  label: string
  allowEmpty?: boolean
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setText(value === null ? '' : String(value)), [value])
  const commit = (t: string) => {
    if (t.trim() === '') return allowEmpty ? onCommit(null) : undefined
    const n = Number(t)
    if (Number.isFinite(n) && n !== value) onCommit(n)
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      step={step}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        if (timer.current) clearTimeout(timer.current)
        const t = e.target.value
        timer.current = setTimeout(() => commit(t), 700)
      }}
      onBlur={(e) => {
        if (timer.current) clearTimeout(timer.current)
        commit(e.target.value)
      }}
      className={`num rounded-md border border-rule-strong bg-sheet px-2 py-1 text-right text-[14px] ${className}`}
    />
  )
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note && <p className="mt-1 mb-4 max-w-[80ch] text-[14px] text-ink-muted">{note}</p>}
      {!note && <div className="mb-3" />}
      {children}
    </section>
  )
}

export function Forecast() {
  const { scope } = useScope()
  const q = useForecast(scopePersonId(scope))
  const save = useSavePlan()
  const [draft, setDraft] = useState<Plan | null>(null)
  const f = q.data

  // The plan being edited: from the server once, then the person's edits (saved as they go).
  useEffect(() => {
    if (f && !draft) setDraft(f.plan)
  }, [f, draft])
  const update = (fn: (p: Plan) => Plan) => {
    if (!draft) return
    const next = fn(draft)
    setDraft(next)
    save.mutate(next)
  }

  if (!f || !draft) return <PageSkeleton />
  return (
    <>
      <PageHeader title="Forecast">
        <label className="flex items-center gap-2 text-[14px] text-ink-muted">
          Look ahead to
          <Num
            label="Forecast year"
            value={draft.targetYear}
            step="1"
            className="w-24"
            onCommit={(v) => v && update((p) => ({ ...p, targetYear: Math.round(v) }))}
          />
        </label>
      </PageHeader>
      <ErrorNote error={q.error ?? save.error} />
      <Headline f={f} />
      <Timeline f={f} />
      <Sips f={f} plan={draft} update={update} />
      <Spending f={f} plan={draft} update={update} />
      <Goals f={f} plan={draft} update={update} />
      <Retirement f={f} plan={draft} update={update} />
      <Assumptions f={f} plan={draft} update={update} />
      {f.notes.length > 0 && (
        <ul className="mt-10 max-w-[80ch] list-disc pl-5 text-[13px] text-ink-muted">
          {f.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  )
}

type Edit = { f: ForecastData; plan: Plan; update: (fn: (p: Plan) => Plan) => void }

// ---------------- the answer ----------------

function Headline({ f }: { f: ForecastData }) {
  const last = f.years.at(-1)
  if (!last) return null
  const personal = f.personalInflation
  return (
    <section aria-label="Forecast summary" className="grid grid-cols-1 gap-8 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <div className="text-[15px] text-ink-muted">In {last.year} your money could be</div>
        <div className="wide num text-[52px] leading-none font-semibold tracking-tight">{lakhCrore(last.nominal)}</div>
        <div className="mt-3 text-[17px]">
          worth <span className="num font-semibold">{lakhCrore(last.real)}</span> in today&rsquo;s money
          <span className="text-ink-muted"> after {f.plan.inflation}% inflation a year</span>
        </div>
        {personal !== null && f.household && (
          <div className="mt-1 text-[15px]">
            or <span className="num font-semibold">{lakhCrore(last.realPersonal)}</span>
            <span className="text-ink-muted"> by your own costs, which rise {pct(personal)} a year</span>
          </div>
        )}
        {last.byBucket.PROPERTY > 0 && (
          <p className="mt-3 text-[14px] text-ink-muted">
            Of which property {lakhCrore(last.byBucket.PROPERTY)}; investments {lakhCrore(last.nominal - last.byBucket.PROPERTY)}.
          </p>
        )}
        <p className="mt-3 max-w-[60ch] text-[13px] text-ink-muted">
          Between {lakhCrore(last.low)} and {lakhCrore(last.high)} if returns run {f.plan.spread} points a year lower or
          higher. A forecast, not a promise: returns come unevenly, and the assumptions below drive it.
        </p>
      </div>
      <dl className="grid grid-cols-2 content-end gap-x-10 gap-y-5 text-[14px]">
        <div>
          <dt className="text-ink-muted">Today</dt>
          <dd className="num text-[20px] font-medium">{lakhCrore(f.startValue)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Going in each month</dt>
          <dd className="num text-[20px] font-medium">{money(f.sipMonthly + f.epfMonthly, 'INR', 0)}</dd>
          <dd className="text-[12px] text-ink-muted">
            SIPs {money(f.sipMonthly, 'INR', 0)}
            {f.epfMonthly > 0 ? `, EPF ${money(f.epfMonthly, 'INR', 0)}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Put in by {last.year}</dt>
          <dd className="num text-[20px] font-medium">{lakhCrore(last.putIn)}</dd>
        </div>
        {f.household && (
          <div>
            <dt className="text-ink-muted">Costs covered by the money</dt>
            <dd className="num text-[20px] font-medium">{f.freedomYear ?? (f.expenses.some((e) => e.monthly > 0) ? 'Not by ' + last.year : '—')}</dd>
            <dd className="text-[12px] text-ink-muted">
              {f.expenses.some((e) => e.monthly > 0)
                ? `the first year ${f.plan.withdrawalRate}% of it pays your living costs`
                : 'Add your monthly spending below'}
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}

function Timeline({ f }: { f: ForecastData }) {
  const dates = f.years.map((y) => `${y.year}-12-31`)
  const milestones = f.years.filter(
    (y, i) => i === 0 || y.year % 5 === 0 || i === f.years.length - 1 || y.year === f.plan.retireYear
  )
  const showAges = f.years.some((y) => y.ages.length > 0)
  return (
    <Section id="timeline" title="Year by year">
      {f.years.length > 1 && (
        <LineCompare
          dates={dates}
          series={[
            { key: 'nominal', label: 'Rupees of that year', color: 'var(--series-1)', values: f.years.map((y) => y.nominal) },
            { key: 'real', label: 'In today’s money', color: 'var(--series-2)', values: f.years.map((y) => y.real) },
            { key: 'low', label: 'Lower returns', color: 'var(--series-other)', values: f.years.map((y) => y.low), dashed: true },
            { key: 'high', label: 'Higher returns', color: 'var(--series-other)', values: f.years.map((y) => y.high), dashed: true }
          ]}
          format={(v) => lakhCrore(v)}
          axisFormat={(v) => lakhCrore(v).replace('.00', '')}
          label="Projected value by year"
          height={300}
        />
      )}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Year</th>
              {showAges && <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Age</th>}
              <th className="num py-1.5 pr-2 pl-3 font-medium">Worth then</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">In today&rsquo;s money</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Put in so far</th>
              {f.household && <th className="num py-1.5 pr-2 pl-3 font-medium">Living costs that year</th>}
            </tr>
          </thead>
          <tbody>
            {milestones.map((y) => (
              <tr key={y.year} className="border-b border-rule">
                <td className="py-1.5">
                  {y.year}
                  {y.year === f.plan.retireYear && <span className="ml-2 text-[12px] text-ink-muted">retire</span>}
                </td>
                {showAges && (
                  <td className="py-1.5 text-ink-muted">{y.ages.map((a) => `${a.name} ${a.age}`).join(', ')}</td>
                )}
                <td className="num py-1.5 font-medium">{lakhCrore(y.nominal)}</td>
                <td className="num py-1.5">{lakhCrore(y.real)}</td>
                <td className="num py-1.5 text-ink-muted">{lakhCrore(y.putIn)}</td>
                {f.household && <td className="num py-1.5 text-ink-muted">{y.yearlyCosts ? lakhCrore(y.yearlyCosts) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ---------------- SIPs ----------------

function Sips({ f, plan, update }: Edit) {
  const persons = usePersons().data ?? []
  const { scope } = useScope()
  const setSip = (id: string, patch: Partial<PlanSip>) =>
    update((p) => ({ ...p, sips: p.sips.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const shown = plan.sips.filter((s) => scope === 'family' || s.personId === scope)
  return (
    <Section
      id="sips"
      title="SIPs and step-ups"
      note="Each SIP rises by its step-up once a year, in the month it started, until its last year (or retirement)."
    >
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">SIP</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Whose</th>
                <th className="num py-1.5 pr-2 pl-3 font-medium">Per month (₹)</th>
                <th className="num py-1.5 pr-2 pl-3 font-medium">Step-up a year (%)</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Goes into</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Started</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Until</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="border-b border-rule">
                  <td className="py-1">
                    <input
                      aria-label="SIP name"
                      defaultValue={s.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && setSip(s.id, { name: e.target.value.trim() })}
                      className="w-full min-w-40 rounded-md border border-transparent bg-transparent px-1 py-1 hover:border-rule-strong focus:border-rule-strong"
                    />
                  </td>
                  <td className="py-1">
                    <Select value={s.personId} onChange={(e) => setSip(s.id, { personId: Number(e.target.value) })}>
                      {persons.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 text-right">
                    <Num label="Monthly amount" value={s.monthly} onCommit={(v) => v && v > 0 && setSip(s.id, { monthly: v })} />
                  </td>
                  <td className="py-1 text-right">
                    <Num label="Step-up" value={s.stepUpPct} className="w-20" onCommit={(v) => v !== null && setSip(s.id, { stepUpPct: v })} />
                  </td>
                  <td className="py-1">
                    <Select value={s.bucket} onChange={(e) => setSip(s.id, { bucket: e.target.value as PlanBucket })}>
                      {PLAN_BUCKETS.filter((b) => b !== 'PROPERTY').map((b) => (
                        <option key={b} value={b}>
                          {PLAN_BUCKET_LABELS[b]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1">
                    <input
                      type="month"
                      aria-label="Started"
                      value={s.start}
                      onChange={(e) => e.target.value && setSip(s.id, { start: e.target.value })}
                      className="rounded-md border border-rule-strong bg-sheet px-2 py-1"
                    />
                  </td>
                  <td className="py-1">
                    <Num
                      label="Last year"
                      value={s.endYear}
                      step="1"
                      className="w-20"
                      placeholder={plan.retireYear ? String(plan.retireYear) : 'always'}
                      allowEmpty
                      onCommit={(v) => setSip(s.id, { endYear: v === null ? null : Math.round(v) })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button
                      className="px-2 text-[13px] text-loss hover:underline"
                      onClick={() => update((p) => ({ ...p, sips: p.sips.filter((x) => x.id !== s.id) }))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.detectedSips.length > 0 && (
        <div className="mt-4 rounded-md border border-dashed border-rule-strong p-3 text-[14px]">
          <div className="mb-2 font-medium">Seen in your fund purchases of the last six months</div>
          <ul>
            {f.detectedSips.map((d) => (
              <li key={`${d.personId}-${d.name}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1">
                <span>{d.name}</span>
                <span className="num text-ink-muted">{money(d.monthly, 'INR', 0)} a month</span>
                <span className="text-ink-muted">{persons.find((p) => p.id === d.personId)?.name}</span>
                <button
                  className="text-stamp hover:underline"
                  onClick={() => update((p) => ({ ...p, sips: [...p.sips, { ...d, id: newId() }] }))}
                >
                  Add, with a 10% step-up
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="quiet"
        className="mt-3"
        onClick={() =>
          update((p) => ({
            ...p,
            sips: [
              ...p.sips,
              {
                id: newId(),
                personId: scope === 'family' ? (persons[0]?.id ?? 1) : scope,
                name: 'New SIP',
                monthly: 5000,
                stepUpPct: 10,
                bucket: 'EQUITY',
                start: thisMonth,
                endYear: null
              }
            ]
          }))
        }
      >
        Add a SIP
      </Button>
      {f.epfMonthly > 0 && (
        <p className="mt-4 text-[14px]">
          EPF: {money(f.epfMonthly, 'INR', 0)} a month (from EPF &amp; NPS), rising{' '}
          <Num
            label="EPF contribution growth"
            value={plan.epfGrowth}
            className="w-16"
            onCommit={(v) => v !== null && update((p) => ({ ...p, epfGrowth: v }))}
          />{' '}
          % a year with salary, until retirement.
        </p>
      )}
    </Section>
  )
}

// ---------------- spending and inflation ----------------

function Spending({ f, plan, update }: Edit) {
  const setExpense = (key: ExpenseKey, patch: Partial<Plan['expenses'][number]>) =>
    update((p) => ({ ...p, expenses: p.expenses.map((e) => (e.key === key ? { ...e, ...patch } : e)) }))
  const total = f.expenses.reduce((s, e) => s + e.monthly, 0)
  const totalThen = f.expenses.reduce((s, e) => s + e.monthlyThen, 0)
  return (
    <Section
      id="spending"
      title="Spending and inflation"
      note={
        <>
          What the household spends a month on each kind of thing, and how fast each gets dearer. Rates default to the
          official consumer price index for that category, the yearly rise over the ten years to{' '}
          {f.cpi.asOf.slice(0, 4)} (
          <button className="text-stamp hover:underline" onClick={() => void openExternal(MOSPI)}>
            MoSPI
          </button>
          , All-India){f.cpi.builtIn ? '' : ', downloaded'}. Type your own rate where your costs differ, such as private
          school fees or hospitals.
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Category</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Per month today (₹)</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Rises a year (%)</th>
              <th className="py-1.5 pl-4 font-medium">Official CPI, 10 years / 5 years / last year</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Per month in {plan.targetYear}</th>
            </tr>
          </thead>
          <tbody>
            {f.expenses.map((e) => {
              const saved = plan.expenses.find((x) => x.key === e.key)!
              return (
                <tr key={e.key} className="border-b border-rule">
                  <td className="py-1.5">{e.label}</td>
                  <td className="py-1 text-right">
                    <Num label={`${e.label} per month`} value={saved.monthly || null} placeholder="0" allowEmpty onCommit={(v) => setExpense(e.key, { monthly: v ?? 0 })} />
                  </td>
                  <td className="py-1 text-right">
                    <Num
                      label={`${e.label} inflation`}
                      value={saved.inflation}
                      className="w-20"
                      placeholder={String(e.inflation)}
                      allowEmpty
                      onCommit={(v) => setExpense(e.key, { inflation: v })}
                    />
                  </td>
                  <td className="py-1.5 pl-4 text-[13px] text-ink-muted">
                    {e.cpi ? (
                      <>
                        <span className="num">
                          {e.cpi.tenYear}% / {e.cpi.fiveYear}% / {e.cpi.latest}%
                        </span>
                        {saved.inflation !== null && (
                          <button className="ml-3 text-stamp hover:underline" onClick={() => setExpense(e.key, { inflation: null })}>
                            Use official
                          </button>
                        )}
                        {e.key === 'HEALTH' && saved.inflation !== MEDICAL_TREND.rate && (
                          <button
                            className="ml-3 text-stamp hover:underline"
                            title="Hospital and insurance costs in private care, as employers' health plans see them"
                            onClick={() => setExpense(e.key, { inflation: MEDICAL_TREND.rate })}
                          >
                            {MEDICAL_TREND.label}
                          </button>
                        )}
                        {e.key === 'PERSONAL' && <span className="ml-2">includes gold jewellery</span>}
                      </>
                    ) : e.key === 'EMI' ? (
                      'Fixed: an EMI doesn’t rise'
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num py-1.5">{e.monthly > 0 ? money(e.monthlyThen, 'INR', 0) : ''}</td>
                </tr>
              )
            })}
            <tr className="border-t border-rule-strong font-medium">
              <td className="py-2">All of it</td>
              <td className="num py-2 pr-1">{money(total, 'INR', 0)}</td>
              <td className="num py-2 pr-1">{f.personalInflation !== null ? pct(f.personalInflation) : ''}</td>
              <td className="py-2 pl-4 text-[13px] font-normal text-ink-muted">
                General CPI: {f.cpi.general.tenYear}% / {f.cpi.general.fiveYear}% / {f.cpi.general.latest}%
              </td>
              <td className="num py-2">{total > 0 ? money(totalThen, 'INR', 0) : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {f.personalInflation !== null && (
        <p className="mt-3 max-w-[80ch] text-[14px]">
          Your costs rise about <b>{pct(f.personalInflation)}</b> a year on this mix, against {plan.inflation}% general
          inflation. The fastest-rising categories take a bigger share over time, so the rate creeps up the further ahead
          you look.
        </p>
      )}
    </Section>
  )
}

// ---------------- goals ----------------

function Goals({ f, plan, update }: Edit) {
  if (!f.household) return null
  const setGoal = (id: string, patch: Partial<PlanGoal>) =>
    update((p) => ({ ...p, goals: p.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  return (
    <Section
      id="goals"
      title="Goals"
      note="Big costs ahead: a child's degree, a wedding, a car, a house. Each grows with its category's inflation; paid from the investments, it comes out in its year."
    >
      {f.goals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Goal</th>
                <th className="num py-1.5 pr-2 pl-3 font-medium">Costs today (₹)</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Year</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Rises like</th>
                <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">From investments</th>
                <th className="num py-1.5 pr-2 pl-3 font-medium">Will cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.goals.map((g) => (
                <tr key={g.id} className="border-b border-rule">
                  <td className="py-1">
                    <input
                      aria-label="Goal name"
                      defaultValue={g.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== g.name && setGoal(g.id, { name: e.target.value.trim() })}
                      className="w-full min-w-36 rounded-md border border-transparent bg-transparent px-1 py-1 hover:border-rule-strong focus:border-rule-strong"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <Num label="Cost today" value={g.costToday} onCommit={(v) => v && v > 0 && setGoal(g.id, { costToday: v })} />
                  </td>
                  <td className="py-1">
                    <Num label="Year" value={g.year} step="1" className="w-20" onCommit={(v) => v && setGoal(g.id, { year: Math.round(v) })} />
                  </td>
                  <td className="py-1">
                    <Select value={g.category} onChange={(e) => setGoal(g.id, { category: e.target.value as PlanGoal['category'] })}>
                      <option value="GENERAL">General inflation</option>
                      {f.expenses
                        .filter((e) => e.key !== 'EMI')
                        .map((e) => (
                          <option key={e.key} value={e.key}>
                            {EXPENSE_LABELS[e.key]}
                          </option>
                        ))}
                    </Select>
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label="Paid from investments"
                      checked={g.fromPortfolio}
                      onChange={(e) => setGoal(g.id, { fromPortfolio: e.target.checked })}
                    />
                    {g.funded === false && <span className="ml-2 text-[13px] text-loss">not enough by then</span>}
                  </td>
                  <td className="num py-1.5 font-medium">{lakhCrore(g.costThen)}</td>
                  <td className="py-1 text-right">
                    <button
                      className="px-2 text-[13px] text-loss hover:underline"
                      onClick={() => update((p) => ({ ...p, goals: p.goals.filter((x) => x.id !== g.id) }))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        variant="quiet"
        className="mt-3"
        onClick={() =>
          update((p) => ({
            ...p,
            goals: [
              ...p.goals,
              { id: newId(), name: 'New goal', costToday: 500000, year: Math.min(thisYear + 10, plan.targetYear), category: 'GENERAL', fromPortfolio: true }
            ]
          }))
        }
      >
        Add a goal
      </Button>
    </Section>
  )
}

// ---------------- retirement ----------------

function Retirement({ f, plan, update }: Edit) {
  if (!f.household) return null
  const r = f.retirement
  return (
    <Section
      id="retirement"
      title="Retirement"
      note="From the year you retire, SIPs and EPF stop and the household's living costs are drawn from the investments (never from property)."
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px]">
        <label className="flex items-center gap-2">
          Retire in
          <Num
            label="Retirement year"
            value={plan.retireYear}
            step="1"
            className="w-24"
            placeholder="not set"
            allowEmpty
            onCommit={(v) => update((p) => ({ ...p, retireYear: v === null ? null : Math.round(v) }))}
          />
        </label>
        <label className="flex items-center gap-2">
          Draw each year
          <Num
            label="Withdrawal rate"
            value={plan.withdrawalRate}
            className="w-16"
            onCommit={(v) => v && update((p) => ({ ...p, withdrawalRate: v }))}
          />
          % of the investments
        </label>
      </div>
      {r ? (
        <div className="mt-4 grid max-w-[720px] grid-cols-1 gap-6 @2xl:grid-cols-3">
          <div>
            <div className="text-[13px] text-ink-muted">Needed in {r.year}</div>
            <div className="num text-[22px] font-semibold">{lakhCrore(r.needed)}</div>
            <div className="text-[12px] text-ink-muted">a year&rsquo;s costs ÷ {plan.withdrawalRate}%</div>
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">Projected by then</div>
            <div className={`num text-[22px] font-semibold ${r.projected >= r.needed ? 'text-gain' : 'text-loss'}`}>
              {lakhCrore(r.projected)}
            </div>
            <div className="text-[12px] text-ink-muted">
              {r.projected >= r.needed ? 'enough' : `${lakhCrore(r.needed - r.projected)} short`}
            </div>
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">Money lasts</div>
            <div className={`num text-[22px] font-semibold ${r.lastsUntil ? 'text-loss' : 'text-gain'}`}>
              {r.lastsUntil ? `until ${r.lastsUntil}` : `past ${plan.targetYear}`}
            </div>
            <div className="text-[12px] text-ink-muted">drawing the costs each month</div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-ink-muted">
          {plan.retireYear ? 'Add your monthly spending above to see what retirement needs.' : 'Set a year to see whether the money lasts.'}
        </p>
      )}
    </Section>
  )
}

// ---------------- assumptions ----------------

function Assumptions({ f, plan, update }: Edit) {
  const persons = usePersons().data ?? []
  const presets = [
    { label: 'RBI target 4%', v: 4 },
    { label: `Last 10 years ${Math.round(f.cpi.general.tenYear * 10) / 10}%`, v: Math.round(f.cpi.general.tenYear * 10) / 10 },
    { label: 'Cautious 6%', v: 6 }
  ]
  return (
    <Section
      id="assumptions"
      title="Assumptions"
      note="Yearly returns before tax for each kind of investment. Today's amounts are what you hold now; funds count by their category (hybrids split)."
    >
      <div className="grid grid-cols-1 gap-x-10 @5xl:grid-cols-2">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 pr-2 pl-3 font-medium first:pl-0">Kind</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Today</th>
              <th className="num py-1.5 pr-2 pl-3 font-medium">Return a year (%)</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_BUCKETS.map((b) => (
              <tr key={b} className="border-b border-rule">
                <td className="py-1.5">{PLAN_BUCKET_LABELS[b]}</td>
                <td className="num py-1.5 text-ink-muted">{f.startByBucket[b] ? lakhCrore(f.startByBucket[b]) : '—'}</td>
                <td className="py-1 text-right">
                  <Num
                    label={`${PLAN_BUCKET_LABELS[b]} return`}
                    value={plan.returns[b]}
                    className="w-20"
                    onCommit={(v) => v !== null && update((p) => ({ ...p, returns: { ...p.returns, [b]: v } }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 space-y-5 text-[14px] @5xl:mt-0">
          <div>
            <div className="mb-1 font-medium">General inflation, for &ldquo;today&rsquo;s money&rdquo;</div>
            <div className="flex flex-wrap items-center gap-2">
              <Num label="General inflation" value={plan.inflation} className="w-20" onCommit={(v) => v !== null && update((p) => ({ ...p, inflation: v }))} />
              <span>%</span>
              {presets.map((x) => (
                <button
                  key={x.label}
                  aria-pressed={plan.inflation === x.v}
                  onClick={() => update((p) => ({ ...p, inflation: x.v }))}
                  className={
                    'rounded-full border px-3 py-1 text-[13px] ' +
                    (plan.inflation === x.v ? 'border-stamp bg-stamp-wash text-stamp' : 'border-rule-strong text-ink-muted hover:text-ink')
                  }
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2">
            Range: returns
            <Num label="Spread" value={plan.spread} className="w-16" onCommit={(v) => v !== null && update((p) => ({ ...p, spread: v }))} />
            points lower or higher
          </label>
          <div>
            <div className="mb-1 font-medium">Birth years, for ages on the timeline</div>
            <div className="flex flex-wrap gap-4">
              {persons.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  {p.name}
                  <Num
                    label={`${p.name} birth year`}
                    value={plan.birthYears[p.id] ?? null}
                    step="1"
                    className="w-20"
                    allowEmpty
                    onCommit={(v) =>
                      update((pl) => {
                        const birthYears = { ...pl.birthYears }
                        if (v === null) delete birthYears[p.id]
                        else birthYears[p.id] = Math.round(v)
                        return { ...pl, birthYears }
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
