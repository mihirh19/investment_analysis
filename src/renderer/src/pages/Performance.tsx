import { useMemo, useState } from 'react'
import type { PerformanceReport, PerformanceYear } from '@shared/types'
import { Drawdown, LineCompare, Waterfall, type LineSeries } from '../components/chart/extra'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { RiskSection } from '../components/RiskSection'
import { usePerformance } from '../lib/api'
import { compactMoney, lakhCrore, money, shortDate, signedMoney, toneClass } from '../lib/format'
import { stagger, useCountUp } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'
import { PeriodPicker, periodStartIndex, usePeriod } from '../lib/period'


const BENCH_COLORS: Record<string, string> = {
  'BM:NIFTY50': 'var(--series-2)',
  'BM:NIFTY500': 'var(--series-3)',
  'BM:MIDCAP150': 'var(--series-5)',
  'BM:SP500_INR': 'var(--series-7)',
  'BM:LIQUID': 'var(--series-other)'
}

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : Math.abs(v * 100) < 0.5 * 10 ** -digits
      ? `${(0).toFixed(digits)}%`
      : `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note ? <p className="mt-0.5 mb-4 max-w-[80ch] text-[14px] text-ink-muted">{note}</p> : <div className="mb-4" />}
      {children}
    </section>
  )
}

function Toggle<T extends string | number>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: readonly { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <button
          key={String(o.key)}
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={
            'rounded px-2.5 py-0.5 text-[13px] transition-colors ' +
            (value === o.key ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const signedLakh = (v: number) => (v > 0 ? '+' : '') + lakhCrore(v)

/** Rebases a growth series so the first point of the window is 100. */
function rebase(values: (number | null)[]): (number | null)[] {
  const base = values.find((v) => v !== null && v > 0)
  return values.map((v) => (v === null || !base ? null : (v / base) * 100))
}

export function Performance() {
  const { scope } = useScope()
  const q = usePerformance(scopePersonId(scope))
  const p = q.data
  const { period } = usePeriod()
  const [picked, setPicked] = useState<string[]>(['BM:NIFTY50'])
  const [yearKind, setYearKind] = useState<'FY' | 'CY'>('FY')
  const [yearSel, setYearSel] = useState<string | null>(null)
  const [sameIn, setSameIn] = useState('BM:NIFTY50')

  const all = p?.trailing.find((t) => t.key === 'ALL')
  const oneY = p?.trailing.find((t) => t.key === '1Y')
  const xirrShown = useCountUp((p?.xirr.overall ?? 0) * 100)

  const win = useMemo(() => {
    if (!p) return null
    const from = periodStartIndex(p.dates, period)
    return { from, dates: p.dates.slice(from) }
  }, [p, period])

  const growthSeries = useMemo<LineSeries[]>(() => {
    if (!p || !win) return []
    return [
      { key: 'you', label: 'Your holdings', color: 'var(--series-1)', values: rebase(p.growth.slice(win.from)) },
      ...p.benchmarks
        .filter((b) => picked.includes(b.key))
        .map((b) => ({
          key: b.key,
          label: b.label,
          color: BENCH_COLORS[b.key] ?? 'var(--series-other)',
          values: rebase(b.growth.slice(win.from)),
          dashed: true
        }))
    ]
  }, [p, win, picked])

  const moneySeries = useMemo<LineSeries[]>(() => {
    if (!p) return []
    const b = p.benchmarks.find((x) => x.key === sameIn)
    return [
      { key: 'value', label: 'Your holdings', color: 'var(--series-1)', values: p.values },
      ...(b
        ? [{ key: 'same', label: `Same money in ${b.label}`, color: BENCH_COLORS[b.key] ?? 'var(--series-2)', values: b.sameMoney }]
        : []),
      { key: 'net', label: 'Money put in, net', color: 'var(--ink-muted)', values: p.netInvested, dashed: true }
    ]
  }, [p, sameIn])

  if (!p || p.dates.length < 2 || p.coveredValueInr <= 0) {
    return (
      <>
        <PageHeader title="Performance" />
        <ErrorNote error={q.error} />
        {q.isLoading && <PageSkeleton />}
        {!q.isLoading && (
          <p className="max-w-[70ch] py-8 text-ink-muted">
            Performance needs holdings with a full money trail: import a tradebook (Zerodha, Groww) or add trades by hand.
            Holdings that only appear in statements have no purchase dates, so their returns can't be measured over time.
          </p>
        )}
        <RiskSection personId={scopePersonId(scope)} family={scope === 'family'} />
      </>
    )
  }

  const years = p.years.filter((y) => y.kind === yearKind).reverse()
  const chosenYear = years.find((y) => y.label === yearSel) ?? years[0]
  const benchKeys = p.benchmarks.map((b) => b.key)
  const benchLabel = (k: string) => p.benchmarks.find((b) => b.key === k)?.label ?? k
  const n50 = 'BM:NIFTY50'
  const sameB = p.benchmarks.find((b) => b.key === sameIn)
  const sameEnd = sameB?.sameMoney.at(-1) ?? null

  return (
    <>
      <PageHeader title="Performance">
        <PeriodPicker />
      </PageHeader>
      <ErrorNote error={q.error} />

      <section aria-label="Headline returns" className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr]">
        <div>
          <div className="text-[14px] text-ink-muted">Return per year on your money (XIRR)</div>
          <div className={`wide text-[56px] leading-none font-semibold tracking-tight ${toneClass(p.xirr.overall)}`}>
            {p.xirr.overall === null ? '—' : `${xirrShown >= 0 ? '' : '−'}${Math.abs(xirrShown).toFixed(1)}%`}
          </div>
          <p className="mt-2 max-w-[48ch] text-[13px] text-ink-muted">
            Covers {Math.round(p.coverage * 100)}% of your money ({compactMoney(p.coveredValueInr)} of{' '}
            {compactMoney(p.totalValueInr)}).{' '}
            {p.fromStatementsInr > 0 ? (
              <>
                {compactMoney(p.coveredValueInr - p.fromStatementsInr)} has its full purchase history.{' '}
                {compactMoney(p.fromStatementsInr)} has only part of its history, so it is measured from the earliest
                trade file or statement imported{p.statementsSince ? ` (from ${shortDate(p.statementsSince)})` : ''},
                as if what was held then had been bought at that day&rsquo;s price. Older CAS or tradebooks take it
                further back.
              </>
            ) : (
              <>Holdings with their purchases on record, plus deposits, bonds and property with their dates.</>
            )}{' '}
            EPF and insurance are left out.
          </p>
        </div>
        <dl className="grid grid-cols-2 content-end gap-x-10 gap-y-4 sm:grid-cols-4">
          {(
            [
              ['Time-weighted, per year', pct(all?.twr), `since ${shortDate(p.dates[0])}`],
              ['Last 12 months', pct(oneY?.twr), oneY ? `Nifty 50 ${pct(oneY.benchmarks[n50])}` : 'needs a year of history'],
              [
                'Worst fall',
                pct(p.maxDrawdown?.depth),
                p.maxDrawdown
                  ? p.maxDrawdown.recovered
                    ? `recovered ${shortDate(p.maxDrawdown.recovered)}`
                    : 'not yet recovered'
                  : 'none'
              ],
              ['Gain on money put in', signedLakh(p.values.at(-1)! - p.netInvested.at(-1)!), 'value − net money put in']
            ] as const
          ).map(([k, v, sub], i) => (
            <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 60)}>
              <dt className="text-[13px] text-ink-muted">{k}</dt>
              <dd className="wide text-[20px] font-semibold">{v}</dd>
              <dd className="text-[12px] text-ink-muted">{sub}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section
        id="growth"
        title="Growth of ₹100"
        note="Time-weighted: what ₹100 kept in your holdings would have become, so adding or withdrawing money doesn't move the line. Indices are price-only (dividends excluded), which flatters you by about 1–1.5% a year against Nifty."
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Benchmarks" className="flex flex-wrap gap-1.5">
            {p.benchmarks.map((b) => {
              const on = picked.includes(b.key)
              return (
                <button
                  key={b.key}
                  aria-pressed={on}
                  onClick={() => setPicked((xs) => (on ? xs.filter((x) => x !== b.key) : [...xs, b.key]))}
                  className={
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] transition-colors ' +
                    (on ? 'border-rule-strong bg-sheet text-ink' : 'border-rule text-ink-muted hover:bg-sheet')
                  }
                >
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ background: on ? BENCH_COLORS[b.key] : 'var(--rule-strong)' }}
                  />
                  {b.label}
                </button>
              )
            })}
          </div>
        </div>
        {win && (
          <LineCompare
            key={`${period}-${picked.join()}`}
            dates={win.dates}
            series={growthSeries}
            label="Growth of 100 rupees, your holdings against benchmarks"
            format={(v) => `₹${v.toFixed(1)}`}
            axisFormat={(v) => `₹${Math.round(v)}`}
          />
        )}
        {p.benchmarks.length === 0 && (
          <p className="mt-2 text-[13px] text-ink-muted">Benchmark prices load with the daily refresh; check back shortly.</p>
        )}
      </Section>

      <Section
        id="trailing"
        title="Returns over time"
        note="Per year, time-weighted. Green where you beat the index over the same period."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Period</th>
                <th className="num py-1.5 font-medium">You</th>
                {benchKeys.map((k) => (
                  <th key={k} className="num py-1.5 font-medium">
                    {benchLabel(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.trailing.map((t) => (
                <tr key={t.key} className="border-b border-rule">
                  <td className="py-1.5">
                    {t.key === 'ALL' ? `Since ${shortDate(p.dates[0])}` : `Last ${t.years} year${t.years > 1 ? 's' : ''}`}
                  </td>
                  <td className={`num py-1.5 font-semibold ${toneClass(t.twr)}`}>{pct(t.twr)}</td>
                  {benchKeys.map((k) => {
                    const b = t.benchmarks[k]
                    const beat = t.twr !== null && b !== null && b !== undefined ? t.twr - b : null
                    return (
                      <td key={k} className="num py-1.5">
                        {pct(b)}
                        {beat !== null && (
                          <span className={`ml-1.5 text-[12px] ${beat >= 0 ? 'text-gain' : 'text-loss'}`}>
                            {beat >= 0 ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="same-money"
        title="Your money against the same money in an index"
        note="Every rupee you put in or took out, replayed into the index on the same day. The gap at the end is what your choices added or cost compared with simply buying the index."
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Toggle
            label="Index"
            options={p.benchmarks.map((b) => ({ key: b.key, label: b.label }))}
            value={sameIn}
            onChange={setSameIn}
          />
          {sameEnd !== null && (
            <span className="text-[14px]">
              You have <strong className="num">{money(p.values.at(-1))}</strong>; the same money in {sameB!.label} would be{' '}
              <strong className="num">{money(sameEnd)}</strong>{' '}
              <span className={toneClass(p.values.at(-1)! - sameEnd)}>
                ({signedMoney(p.values.at(-1)! - sameEnd)} {p.values.at(-1)! >= sameEnd ? 'ahead' : 'behind'})
              </span>
            </span>
          )}
        </div>
        <LineCompare
          dates={p.dates}
          series={moneySeries}
          label="Value of your holdings against the same money in an index"
          format={(v) => money(v)}
          axisFormat={(v) => compactMoney(v)}
        />
      </Section>

      <Section id="years" title="Year by year" note="Partial years (history starts or ends inside the year) are marked *. Click a year to see where its change came from.">
        <div className="mb-3">
          <Toggle
            label="Year type"
            options={[
              { key: 'FY', label: 'Financial year (Apr–Mar)' },
              { key: 'CY', label: 'Calendar year' }
            ]}
            value={yearKind}
            onChange={(k) => {
              setYearKind(k)
              setYearSel(null)
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.3fr_1fr]">
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                  <th className="py-1.5 font-medium">Year</th>
                  <th className="num py-1.5 font-medium">You</th>
                  {benchKeys.slice(0, 3).map((k) => (
                    <th key={k} className="num py-1.5 font-medium">
                      {benchLabel(k)}
                    </th>
                  ))}
                  <th className="num py-1.5 font-medium">Gain</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr
                    key={y.label}
                    tabIndex={0}
                    aria-selected={chosenYear?.label === y.label}
                    onClick={() => setYearSel(y.label)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setYearSel(y.label)}
                    className={
                      'cursor-pointer border-b border-rule hover:bg-sheet/70 ' +
                      (chosenYear?.label === y.label ? 'bg-stamp-wash shadow-[inset_3px_0_0_var(--stamp)]' : '')
                    }
                  >
                    <td className="py-1.5 pl-2">
                      {y.label}
                      {y.partial && <span className="text-ink-muted">*</span>}
                    </td>
                    <td className={`num py-1.5 font-semibold ${toneClass(y.twr)}`}>{pct(y.twr)}</td>
                    {benchKeys.slice(0, 3).map((k) => (
                      <td key={k} className="num py-1.5 text-ink-muted">
                        {pct(y.benchmarks[k])}
                      </td>
                    ))}
                    <td className={`num py-1.5 ${toneClass(y.gain)}`}>{signedMoney(y.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chosenYear && <YearWaterfall y={chosenYear} />}
        </div>
      </Section>

      <Section
        id="risk"
        title="Falls from the peak"
        note="How far the time-weighted value stood below its previous high at each month end. Month-end values hide falls that recovered within a month."
      >
        <Drawdown points={p.dates.map((d, i) => ({ date: d, value: p.drawdown[i] }))} label="Fall from previous peak" />
      </Section>

      <Section id="rolling" title="Rolling 12-month return" note="The return over the twelve months ending each month: how consistent the returns have been.">
        <LineCompare
          dates={p.dates}
          series={[
            { key: 'r12', label: 'Your holdings', color: 'var(--series-1)', values: p.rolling12 },
            ...rollingBench(p, n50)
          ]}
          label="Rolling twelve-month return"
          format={(v) => pct(v)}
          axisFormat={(v) => `${Math.round(v * 100)}%`}
          zeroLine
          height={220}
        />
      </Section>

      <RiskSection personId={scopePersonId(scope)} family={scope === 'family'} />

      <Section id="by-account" title="By account" note="XIRR of each demat account or folio, from its own purchases, sales and dividends.">
        <XirrTable
          rows={p.xirr.byAccount.map((a) => ({ key: String(a.accountId), name: a.label, sub: a.personName, xirr: a.xirr, value: a.valueInr }))}
          showPerson={scope === 'family'}
        />
      </Section>

      <Section id="by-holding" title="By holding">
        <XirrTable
          rows={p.xirr.byHolding.map((h) => ({
            key: `${h.accountId}:${h.instrumentId}`,
            name: h.name,
            sub: h.personName,
            xirr: h.xirr,
            value: h.valueInr,
            gain: h.gainInr,
            note: h.since ? `measured from ${shortDate(h.since)}` : undefined,
            recent: h.xirr === null
          }))}
          showPerson={scope === 'family'}
          withGain
        />
      </Section>
    </>
  )
}

/** Rolling 12-month return of the Nifty 50 on the same month ends, from its growth line. */
function rollingBench(p: PerformanceReport, key: string): LineSeries[] {
  const b = p.benchmarks.find((x) => x.key === key)
  if (!b) return []
  const values = b.growth.map((g, i) => {
    const prev = i >= 12 ? b.growth[i - 12] : null
    return g !== null && prev ? g / prev - 1 : null
  })
  return [{ key, label: b.label, color: BENCH_COLORS[key], values, dashed: true }]
}

function YearWaterfall({ y }: { y: PerformanceYear }) {
  return (
    <div>
      <h3 className="mb-1 text-[15px] font-semibold">
        {y.label}
        {y.partial ? '*' : ''}: where the change came from
      </h3>
      <p className="mb-2 text-[13px] text-ink-muted">
        {shortDate(y.start)} to {shortDate(y.end)}
      </p>
      <Waterfall
        key={y.kind + y.label}
        label={`Change in value during ${y.label}`}
        steps={[
          { key: 'open', label: 'Start', value: y.opening, kind: 'total' },
          { key: 'add', label: 'Put in', value: y.added, kind: 'delta' },
          { key: 'out', label: 'Taken out', value: -y.withdrawn, kind: 'delta' },
          { key: 'gain', label: 'Gain', value: y.gain, kind: 'delta' },
          { key: 'close', label: 'End', value: y.closing, kind: 'total' }
        ]}
        format={(v) => money(v)}
        axisFormat={(v) => compactMoney(v)}
        height={220}
      />
    </div>
  )
}

function XirrTable({
  rows,
  showPerson,
  withGain = false
}: {
  rows: { key: string; name: string; sub: string; xirr: number | null; value: number; gain?: number | null; note?: string; recent?: boolean }[]
  showPerson: boolean
  withGain?: boolean
}) {
  if (!rows.length) return <p className="text-[14px] text-ink-muted">Nothing with dated purchases yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
            <th className="py-1.5 font-medium">Name</th>
            {showPerson && <th className="py-1.5 font-medium">Person</th>}
            <th className="num py-1.5 font-medium">Value</th>
            {withGain && <th className="num py-1.5 font-medium">Gain</th>}
            <th className="num py-1.5 font-medium">XIRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-rule">
              <td className="py-1.5">
                {r.name}
                {r.note && <div className="text-[12px] text-ink-muted">{r.note}</div>}
              </td>
              {showPerson && <td className="py-1.5 text-ink-muted">{r.sub}</td>}
              <td className="num py-1.5">{money(r.value)}</td>
              {withGain && <td className={`num py-1.5 ${toneClass(r.gain)}`}>{signedMoney(r.gain)}</td>}
              <td
                className={`num py-1.5 font-semibold ${toneClass(r.xirr)}`}
                title={r.recent ? 'Under three months: too short to give a yearly figure' : undefined}
              >
                {r.recent ? <span className="font-normal text-ink-muted">too recent</span> : pct(r.xirr)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
