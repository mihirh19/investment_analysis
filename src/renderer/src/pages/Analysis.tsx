import { useMemo, useState } from 'react'
import type { ChartGroup } from '@shared/assets'
import type { AssetClass, HoldingRow } from '@shared/types'
import { Columns, StackBar } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { AreaStack, DivergingBars, Donut, StackedColumns, Treemap } from '../components/viz'
import { useAnalysis, useHoldings } from '../lib/api'
import { HoldingDetail } from '../components/HoldingDetail'
import { compactMoney, money, percent, shortDate, signedMoney, toneClass } from '../lib/format'
import {
  ASSET_COLORS,
  ASSET_LABELS,
  GROUP_COLORS,
  GROUP_LABELS,
  LIQUIDITY_COLORS,
  LIQUIDITY_LABELS,
  LIQUIDITY_ORDER
} from '../lib/labels'
import { stagger, useCountUp } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'
import { PeriodPicker, periodStartIndex, usePeriod } from '../lib/period'


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)

function Section({
  id,
  title,
  note,
  children
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note && <p className="mt-0.5 mb-4 max-w-[80ch] text-[14px] text-ink-muted">{note}</p>}
      {!note && <div className="mb-4" />}
      {children}
    </section>
  )
}

export function Analysis() {
  const { scope } = useScope()
  const q = useAnalysis(scopePersonId(scope))
  const a = q.data
  const { period } = usePeriod()
  const holdings = useHoldings(scopePersonId(scope))
  const [open, setOpen] = useState<HoldingRow | null>(null)
  const xirrShown = useCountUp((a?.xirr.overall ?? 0) * 100)

  const hist = useMemo(() => {
    if (!a) return null
    const from = periodStartIndex(a.history.months, period)
    return {
      dates: a.history.months.slice(from),
      series: a.history.series.map((s) => ({
        key: s.group,
        label: GROUP_LABELS[s.group],
        color: GROUP_COLORS[s.group],
        values: s.values.slice(from)
      }))
    }
  }, [a, period])

  const donut = useMemo(() => {
    if (!a) return []
    const byGroup = new Map<ChartGroup, number>()
    for (const t of a.treemap) byGroup.set(t.group, (byGroup.get(t.group) ?? 0) + t.valueInr)
    const sorted = [...byGroup].sort((x, y) => y[1] - x[1])
    // At most six slices: the five largest groups plus everything else in neutral grey.
    const head = sorted
      .slice(0, 5)
      .map(([g, v]) => ({ key: g, label: GROUP_LABELS[g], value: v, color: GROUP_COLORS[g] }))
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
    return rest > 0
      ? [...head, { key: 'REST', label: 'Everything else', value: rest, color: 'var(--series-other)' }]
      : head
  }, [a])

  const upcomingByMonth = useMemo(() => {
    if (!a) return []
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return {
        key: ym,
        label: MONTHS[d.getMonth()],
        value: a.upcoming.filter((u) => u.date.startsWith(ym) && u.amount > 0).reduce((s, u) => s + u.amount, 0)
      }
    })
  }, [a])

  if (!a || a.totalInr <= 0) {
    return (
      <>
        <PageHeader title="Analysis" />
        <ErrorNote error={q.error} />
        {q.isLoading && <PageSkeleton />}
        {!q.isLoading && <p className="py-8 text-ink-muted">Add holdings to see the analysis.</p>}
      </>
    )
  }

  const totalUpcoming = a.upcoming.filter((u) => u.amount > 0).reduce((s, u) => s + u.amount, 0)
  const liquidNow = a.liquidity.find((l) => l.bucket === 'LIQUID')?.valueInr ?? 0

  return (
    <>
      <PageHeader title="Analysis">
        <PeriodPicker />
      </PageHeader>
      <ErrorNote error={q.error} />

      {/* Headline: the money-weighted return and the few numbers that frame it. */}
      <section aria-label="Returns" className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr]">
        <div>
          <div className="text-[14px] text-ink-muted">Return per year (XIRR)</div>
          <div className={`wide text-[56px] leading-none font-semibold tracking-tight ${toneClass(a.xirr.overall)}`}>
            {a.xirr.overall === null ? '—' : `${xirrShown >= 0 ? '' : '−'}${Math.abs(xirrShown).toFixed(1)}%`}
          </div>
          <div className="mt-2 max-w-[44ch] text-[13px] text-ink-muted">
            Based on {Math.round(a.xirr.coverage * 100)}% of your money: holdings with dated purchases. Statement-only
            holdings and passbook balances are left out of this figure.
          </div>
        </div>
        <dl className="grid grid-cols-2 content-end gap-x-10 gap-y-4 sm:grid-cols-4">
          {[
            ['Net worth', money(a.totalInr)],
            ['Available in days', money(liquidNow)],
            ['Coming in, next 12 months', money(totalUpcoming)],
            ['Top 10 holdings', `${Math.round(a.concentration.top10Share * 100)}% of it`]
          ].map(([k, v], i) => (
            <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 60)}>
              <dt className="text-[13px] text-ink-muted">{k}</dt>
              <dd className="wide text-[20px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      {scope === 'family' && a.xirr.byPerson.length > 1 && (
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-1 text-[15px]">
          {a.xirr.byPerson.map((p) => (
            <li key={p.personName}>
              {p.personName} <span className={`num font-semibold ${toneClass(p.xirr)}`}>{pct(p.xirr)}</span>
              <span className="ml-1 text-[12px] text-ink-muted">a year</span>
            </li>
          ))}
        </ul>
      )}

      <Section
        id="history"
        title="Net worth over time"
        note="Month-end values: units held on each date × that week's price; deposits and bonds by their terms. Holdings without trade history count from their first statement."
      >
        {hist && (
          <AreaStack
            key={period}
            dates={hist.dates}
            series={hist.series}
            label="Net worth by type over time"
            format={(v) => money(v)}
            axisFormat={(v) => compactMoney(v)}
          />
        )}
      </Section>

      <Section
        id="scorecard"
        title="Every asset type"
        note="XIRR uses dated purchases, sales, dividends and interest; the coverage column says how much of each type it is based on."
      >
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 font-medium">Type</th>
              <th className="num py-1.5 font-medium">Value</th>
              <th className="py-1.5 pl-6 font-medium">Share</th>
              <th className="num py-1.5 font-medium">Gain</th>
              <th className="num py-1.5 font-medium">XIRR</th>
              <th className="num py-1.5 font-medium">Covered</th>
              <th className="num py-1.5 font-medium">Income this year</th>
            </tr>
          </thead>
          <tbody>
            {a.scorecard.map((s, i) => {
              const cls = s.assetClass as AssetClass
              const share = s.valueInr / a.totalInr
              return (
                <tr key={s.assetClass} className="border-b border-rule">
                  <td className="py-2">
                    <span
                      className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                      style={{ background: ASSET_COLORS[cls] }}
                    />
                    {ASSET_LABELS[cls] ?? s.assetClass}
                    <span className="ml-2 text-[12px] text-ink-muted">{s.holdings}</span>
                  </td>
                  <td className="num py-2 font-medium">{money(s.valueInr)}</td>
                  <td className="py-2 pl-6">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 rounded-full bg-rule">
                        <div
                          className="anim-grow-x h-full rounded-full"
                          style={{ width: `${share * 100}%`, background: ASSET_COLORS[cls], ...stagger(i) }}
                        />
                      </div>
                      <span className="num text-[13px]">{(share * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className={`num py-2 ${toneClass(s.gainInr)}`}>
                    {s.gainInr === null ? '—' : signedMoney(s.gainInr)}
                  </td>
                  <td className={`num py-2 font-medium ${toneClass(s.xirr)}`}>{pct(s.xirr)}</td>
                  <td className="num py-2 text-[13px] text-ink-muted">{Math.round(s.xirrCoverage * 100)}%</td>
                  <td className="num py-2">{s.incomeThisFy ? money(s.incomeThisFy, 'INR', 0) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section id="alloc" title="Where it sits">
          <div className="flex flex-wrap items-center gap-8">
            <Donut parts={donut} centerLabel="Total" format={(v) => compactMoney(v)} label="Allocation by group" />
            <ul className="flex-1 text-[14px]">
              {donut.map((p) => (
                <li key={p.key} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: p.color }} />
                    {p.label}
                  </span>
                  <span className="num">
                    {compactMoney(p.value)}
                    <span className="ml-2 text-ink-muted">{((p.value / a.totalInr) * 100).toFixed(1)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="liquidity" title="How quickly you can use it">
          <StackBar
            label="Liquidity"
            format={(v) => money(v)}
            segments={LIQUIDITY_ORDER.map((b) => ({
              key: b,
              label: LIQUIDITY_LABELS[b].label,
              value: a.liquidity.find((l) => l.bucket === b)?.valueInr ?? 0,
              color: LIQUIDITY_COLORS[b]
            }))}
          />
          <table className="mt-3 w-full text-[14px]">
            <tbody>
              {LIQUIDITY_ORDER.map((b) => {
                const v = a.liquidity.find((l) => l.bucket === b)?.valueInr ?? 0
                if (!v) return null
                return (
                  <tr key={b} className="border-b border-rule align-top">
                    <td className="py-1.5">
                      <span
                        className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                        style={{ background: LIQUIDITY_COLORS[b] }}
                      />
                      {LIQUIDITY_LABELS[b].label}
                      <div className="pl-[18px] text-[12px] text-ink-muted">{LIQUIDITY_LABELS[b].detail}</div>
                    </td>
                    <td className="num py-1.5">{compactMoney(v)}</td>
                    <td className="num py-1.5 text-ink-muted">{((v / a.totalInr) * 100).toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      </div>

      <Section
        id="income"
        title="Income by financial year"
        note="Dividends received, interest earned (accrued for deposits, as for tax) and rent."
      >
        <StackedColumns
          label="Income by financial year"
          periods={a.income.map((r) => ({ key: r.fy, label: r.fy, values: [r.dividends, r.interest, r.rent] }))}
          series={[
            { label: 'Dividends', color: 'var(--series-1)' },
            { label: 'Interest', color: 'var(--series-5)' },
            { label: 'Rent', color: 'var(--series-7)' }
          ]}
          format={(v) => money(v, 'INR', 0)}
          axisFormat={(v) => compactMoney(v)}
        />
        <table className="mt-3 w-full max-w-[640px] text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[12px] text-ink-muted">
              <th className="py-1 font-medium">Year</th>
              <th className="num py-1 font-medium">Dividends</th>
              <th className="num py-1 font-medium">Interest</th>
              <th className="num py-1 font-medium">Rent</th>
              <th className="num py-1 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {[...a.income].reverse().map((r) => (
              <tr key={r.fy} className="border-b border-rule">
                <td className="py-1">{r.fy}</td>
                <td className="num py-1">{compactMoney(r.dividends)}</td>
                <td className="num py-1">{compactMoney(r.interest)}</td>
                <td className="num py-1">{r.rent ? compactMoney(r.rent) : ''}</td>
                <td className="num py-1 font-medium">{compactMoney(r.dividends + r.interest + r.rent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid grid-cols-1 gap-12 xl:grid-cols-2">
        <Section
          id="upcoming"
          title="Coming in over the next 12 months"
          note="Interest payouts, coupons, maturities and dividends (repeating last year's)."
        >
          <Columns
            label="Money coming in by month"
            seriesLabel="Coming in"
            points={upcomingByMonth}
            format={(v) => money(v, 'INR', 0)}
            axisFormat={(v) => compactMoney(v)}
            height={180}
          />
          <ul className="mt-3 max-h-[280px] overflow-y-auto border-t border-rule text-[14px]">
            {a.upcoming.slice(0, 30).map((u, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
                <span className="min-w-0">
                  <span className="num mr-3 inline-block w-24 text-left text-ink-muted">{shortDate(u.date)}</span>
                  <span className="truncate">{u.holding}</span>
                  <span className="ml-2 text-[12px] text-ink-muted">{u.label}</span>
                </span>
                <span className={`num shrink-0 ${u.amount < 0 ? 'text-ink-muted' : ''}`}>{signedMoney(u.amount)}</span>
              </li>
            ))}
            {a.upcoming.length === 0 && <li className="py-3 text-ink-muted">Nothing scheduled.</li>}
          </ul>
        </Section>

        <Section id="maturities" title="When deposits and bonds mature">
          {a.maturities.length === 0 ? (
            <p className="text-[14px] text-ink-muted">
              No deposits, bonds, SGBs or PPF with a maturity date yet. Add them under Other assets.
            </p>
          ) : (
            <>
              <Columns
                label="Maturity ladder by year"
                seriesLabel="Maturing"
                points={a.maturities.map((m) => ({ key: m.year, label: m.year, value: m.amount }))}
                format={(v) => money(v, 'INR', 0)}
                axisFormat={(v) => compactMoney(v)}
                height={180}
              />
              <ul className="mt-3 border-t border-rule text-[14px]">
                {a.maturities
                  .flatMap((m) => m.items)
                  .map((it) => (
                    <li
                      key={it.name + it.date}
                      className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5"
                    >
                      <span>
                        <span className="num mr-3 inline-block w-24 text-left text-ink-muted">
                          {shortDate(it.date)}
                        </span>
                        {it.name}
                      </span>
                      <span className="num">{money(it.amount, 'INR', 0)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Section>
      </div>

      <Section
        id="treemap"
        title="Everything you own, by size"
        note={
          a.concentration.largest
            ? `Largest: ${a.concentration.largest.name} at ${(a.concentration.largest.share * 100).toFixed(1)}% of the total. Colour shows return since purchase.`
            : undefined
        }
      >
        <Treemap
          label="Holdings by value, coloured by return"
          items={a.treemap.map((t) => ({
            key: String(t.instrumentId),
            name: t.name,
            value: t.valueInr,
            gainPct: t.gainPct
          }))}
          format={(v) => money(v)}
          onSelect={(key) => setOpen((holdings.data ?? []).find((r) => String(r.instrumentId) === key) ?? null)}
        />
        <p className="mt-2 text-[13px] text-ink-muted">Click a tile to open that holding.</p>
      </Section>

      {a.movers.length > 0 && (
        <Section
          id="movers"
          title="Biggest winners and losers"
          note="Gain or loss in rupees since purchase, for holdings with a cost on record."
        >
          <DivergingBars
            label="Gain or loss by holding"
            rows={a.movers.map((m) => ({
              key: m.name,
              label: m.name,
              value: m.gainInr,
              sub: `${signedMoney(m.gainInr)}  ${percent(m.gainPct)}`
            }))}
            format={(v) => signedMoney(v)}
          />
        </Section>
      )}
      {open && <HoldingDetail row={open} onClose={() => setOpen(null)} />}
    </>
  )
}
