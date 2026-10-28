import { Link } from 'react-router-dom'
import { GROUP_OF, type ChartGroup } from '@shared/assets'
import type { HoldingRow } from '@shared/types'
import { Checklist, Overview } from '../pages/Overview'
import { ReportButton } from '../components/ReportButton'
import { AreaStack } from '../components/viz'
import { useAnalysis, useHealth, useHoldings, usePersons } from '../lib/api'
import { compactMoney, money, percent, signedMoney, toneClass } from '../lib/format'
import { GROUP_COLORS, GROUP_LABELS } from '../lib/labels'
import { useLiveHoldings } from '../lib/live'
import { useOpenSymbol } from '../lib/links'
import { useCountUp } from '../lib/motion'
import { PeriodPicker, periodStartIndex, usePeriod } from '../lib/period'
import { scopePersonId, useScope } from '../lib/scope'
import { groupBy, totals } from '../lib/summary'

// The simple look's home: what it is all worth, what it is made of, what moved today, and what
// needs fixing. The full Overview (allocation, platforms, upcoming money) stays a click away.

const ORDER: ChartGroup[] = ['STOCKS', 'FUNDS', 'US', 'GOLD', 'DEBT', 'RETIREMENT', 'PROPERTY', 'CRYPTO', 'OTHER']

export function Home() {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const query = useHoldings(scopePersonId(scope))
  const rows = useLiveHoldings(query.data) ?? []
  const analysis = useAnalysis(scopePersonId(scope))
  const health = useHealth(scopePersonId(scope))
  const { period } = usePeriod()
  const t = totals(rows)
  const owed = analysis.data?.owed.totalInr ?? 0
  const net = useCountUp(t.value - owed)

  // Loading, an error or nothing recorded yet: the Overview says what to do.
  if (query.isLoading || rows.length === 0) return <Overview />

  const whose = scope === 'family' ? 'The family' : (persons.find((p) => p.id === scope)?.name ?? '')
  const hist = analysis.data?.history
  const owedByMonth = analysis.data?.owed.byMonth ?? []
  const all = hist && hist.months.length > 2 ? hist.months.map((_, i) => hist.series.reduce((s, x) => s + x.values[i], 0) - (owedByMonth[i] ?? 0)) : null
  const from = hist ? periodStartIndex(hist.months, period) : 0
  const trend = all?.slice(from) ?? null
  const dayPct = t.dayBase > 0 ? t.dayChange / t.dayBase : null
  const xirr = analysis.data?.xirr.overall ?? null
  const groups = [...groupBy(rows, (r) => GROUP_OF[r.assetClass])]
    .map(([g, rs]) => ({ group: g as ChartGroup, t: totals(rs), count: rs.length }))
    .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group))

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Net worth" className="rounded-xl border border-rule p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[14px] text-ink-muted">{whose}, net worth</div>
              <div className="num mt-1 text-left text-[34px] leading-tight font-semibold text-ink">{money(net)}</div>
              <div className="mt-1 text-[14px]">
                <span className={`num ${toneClass(t.dayChange)}`}>
                  {signedMoney(t.dayChange)} ({percent(dayPct)})
                </span>{' '}
                <span className="text-ink-muted">today</span>
              </div>
            </div>
            <ReportButton personId={scopePersonId(scope)} />
          </div>
          {trend && trend.length > 1 && (
            <div className="mt-5">
              <AreaStack
                key={period}
                dates={hist!.months.slice(from)}
                series={[{ key: 'total', label: 'Net worth', color: 'var(--stamp)', values: trend }]}
                label="Net worth over time"
                format={(v) => money(v)}
                axisFormat={(v) => compactMoney(v)}
                height={220}
              />
              <div className="mt-3 flex justify-center">
                <PeriodPicker />
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="summary" className="rounded-xl border border-rule p-6">
          <h2 id="summary" className="text-[16px] font-semibold">
            Holdings summary
          </h2>
          <dl className="mt-4 space-y-4 text-[14px]">
            <Line label="Current value" value={money(t.value)} />
            <Line label="Invested" value={money(t.invested)} />
            <Line
              label="Total returns"
              value={
                <span className={toneClass(t.gain)}>
                  {signedMoney(t.gain)} ({percent(t.gainPct)})
                </span>
              }
            />
            <Line
              label="1 day returns"
              value={
                <span className={toneClass(t.dayChange)}>
                  {signedMoney(t.dayChange)} ({percent(dayPct)})
                </span>
              }
            />
            {xirr !== null && <Line label="Return per year (XIRR)" value={<span className={toneClass(xirr)}>{(xirr * 100).toFixed(1)}%</span>} />}
            {owed > 0 && <Line label={<Link to="/loans" className="text-stamp hover:underline">Owed on loans</Link>} value={<span className="text-loss">−{money(owed)}</span>} />}
          </dl>
          {t.valueWithoutCost > 0 && (
            <p className="mt-4 text-[12.5px] text-ink-muted">{money(t.valueWithoutCost)} has no buy price on record, so it is left out of the returns.</p>
          )}
          <Link to="/holdings" className="mt-5 block rounded-lg bg-stamp-wash py-2 text-center text-[14px] font-semibold text-stamp hover:brightness-95">
            See all holdings
          </Link>
        </section>
      </div>

      <section aria-labelledby="mix">
        <h2 id="mix" className="mb-3 text-[18px] font-semibold">
          Your investments
        </h2>
        <ul className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g.group}>
              <Link to="/holdings" className="block rounded-xl border border-rule p-4 transition-colors hover:border-rule-strong hover:bg-sheet">
                <div className="flex items-center gap-2 text-[14px] text-ink-muted">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: GROUP_COLORS[g.group] }} />
                  {GROUP_LABELS[g.group]}
                  <span className="ml-auto text-[12.5px]">{g.count === 1 ? '1 holding' : `${g.count} holdings`}</span>
                </div>
                <div className="num mt-2 text-left text-[20px] font-semibold text-ink">{money(g.t.value)}</div>
                <div className="mt-0.5 flex justify-between text-[13px]">
                  <span className={toneClass(g.t.gain)}>{g.t.gainPct === null ? 'No buy price' : `${signedMoney(g.t.gain)} (${percent(g.t.gainPct)})`}</span>
                  <span className="text-ink-muted">{t.value > 0 ? `${((g.t.value / t.value) * 100).toFixed(0)}% of all` : ''}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Movers rows={rows} />

      {health.data && <Checklist report={health.data} />}

      <p className="text-[13.5px] text-ink-muted">
        Allocation, platforms and money coming in are on the{' '}
        <Link to="/analysis" className="text-stamp hover:underline">
          Analysis
        </Link>{' '}
        screen.
      </p>
    </div>
  )
}

function Line({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num font-medium text-ink">{value}</dd>
    </div>
  )
}

/** The holdings that moved most today, up and down (listed ones with a live price). */
function Movers({ rows }: { rows: HoldingRow[] }) {
  const open = useOpenSymbol()
  // One line per instrument, even when two people hold it.
  const seen = new Map<number, HoldingRow>()
  for (const r of rows) if (r.dayChange !== null && r.prevClose && r.quantity > 0 && !seen.has(r.instrumentId)) seen.set(r.instrumentId, r)
  const moved = [...seen.values()].map((r) => ({ r, pct: r.dayChange! / (r.quantity * r.prevClose!) }))
  const up = moved.filter((m) => m.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 5)
  const down = moved.filter((m) => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 5)
  if (!up.length && !down.length) return null
  const List = ({ title, items }: { title: string; items: typeof moved }) => (
    <section aria-label={title} className="rounded-xl border border-rule">
      <h3 className="border-b border-rule px-5 py-3 text-[15px] font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-[13.5px] text-ink-muted">None today.</p>
      ) : (
        <ul>
          {items.map(({ r, pct }) => (
            <li key={r.instrumentId} className="border-b border-rule last:border-0">
              <button
                type="button"
                disabled={!r.symbol}
                onClick={() => r.symbol && open(r.symbol)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-sheet disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{r.instrumentName}</span>
                  <span className="text-[12.5px] text-ink-muted">{r.symbol ?? ''}</span>
                </span>
                <span className="num text-[14px] text-ink">{r.lastPrice === null ? '' : money(r.lastPrice, r.currency, 2)}</span>
                <span className={`num w-20 text-[14px] font-medium ${toneClass(pct)}`}>{percent(pct)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
  return (
    <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
      <List title="Top gainers today" items={up} />
      <List title="Top losers today" items={down} />
    </div>
  )
}
