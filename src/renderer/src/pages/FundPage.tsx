import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { fundField, type FundDetail, type FundField, type FundRow } from '@shared/fundScreener'
import { ErrorNote } from '../components/Shell'
import { FundHistory } from '../components/FundCharts'
import { Columns } from '../components/charts'
import { Sparkline } from '../components/viz'
import { useFollowFund, useFundDetail } from '../lib/api'
import { shortDate, toneClass } from '../lib/format'
import { useOpenSymbol } from '../lib/links'
import { fundText } from './FundScreener'

const RATIOS: FundField[] = ['sharpe', 'sortino', 'alpha', 'beta', 'r2', 'vol', 'maxDrawdown', 'upCapture', 'downCapture', 'beatRate']
const RETURNS: FundField[] = ['ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'ret5y']
const pts = (v: number | null) => (v === null ? 'new' : Math.abs(v) < 0.00005 ? '0.00' : `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}`)
const pct = (v: number | null, d = 2) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`)
/** "Sep 26" from a month-end date. */
const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-15`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })

/** One fund, the way an investing app shows it: returns and chart first, then risk, then what it holds month by month. */
export function FundPage() {
  const { code = '' } = useParams()
  const q = useFundDetail(code)
  const openSymbol = useOpenSymbol()
  const follow = useFollowFund()
  const d = q.data
  if (q.isLoading) return <p className="text-ink-muted">Opening the fund (its NAV history comes from mfapi.in the first time)…</p>
  if (q.error) return <ErrorNote error={q.error} />
  if (!d) return <p className="text-ink-muted">No open-ended Direct plan with scheme code {code}.</p>
  const r = d.row
  const avg = d.categoryAvg
  // The headline return: the longest of three or five years the fund has, else one year.
  const head = r.ret5y !== null ? { v: r.ret5y, label: '5Y annualised' } : r.ret3y !== null ? { v: r.ret3y, label: '3Y annualised' } : { v: r.ret1y, label: '1Y' }

  return (
    <article className="mx-auto max-w-[920px] space-y-10">
      <header>
        <h1 className="text-[24px] leading-tight font-semibold text-ink">{r.name}</h1>
        <ul className="mt-2 flex flex-wrap gap-2 text-[12.5px]">
          {[r.group, r.category, r.risk ? `${r.risk} risk` : null, r.fundHouse, r.held ? 'Held by the family' : null]
            .filter((x): x is string => !!x)
            .map((c) => (
              <li key={c} className="rounded-full border border-rule-strong px-2.5 py-0.5 text-ink-muted">
                {c}
              </li>
            ))}
        </ul>
        <div className="mt-4">
          <span className={`text-[28px] font-semibold ${toneClass(head.v)}`}>{head.v === null ? '—' : `${head.v > 0 ? '+' : ''}${(head.v * 100).toFixed(2)}%`}</span>{' '}
          <span className="text-[13px] text-ink-muted">{head.label}</span>
          {r.ret1m !== null && (
            <div className="text-[13px]">
              <span className={toneClass(r.ret1m)}>{pct(r.ret1m)}</span> <span className="text-ink-muted">last month</span>
            </div>
          )}
        </div>
      </header>

      <FundHistory code={r.code} />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-rule py-5 text-[13px] sm:grid-cols-3 lg:grid-cols-5">
        <Fact label={`NAV${r.navDate ? `: ${shortDate(r.navDate)}` : ''}`} value={r.nav ? `₹${r.nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })}` : '—'} />
        <Fact label="Fund size" value={fundText('aumCr', r.aumCr)} />
        <Fact label="Expense ratio" value={fundText('ter', r.ter)} note={avg.ter !== undefined ? `category ${avg.ter.toFixed(2)}%` : undefined} />
        <Fact label="Benchmark" value={r.benchmark ?? '—'} note={r.index ? `ratios against ${r.index}` : undefined} />
        <Fact label="Track record" value={`${r.years.toFixed(1)} years`} />
      </dl>

      <section>
        <h2 className="mb-3 text-[18px] font-semibold">Returns against the category</h2>
        <CompareTable fields={RETURNS} row={r} avg={avg} count={d.categoryCount} />
      </section>

      <section>
        <h2 className="mb-3 text-[18px] font-semibold">Risk, and how it got its return</h2>
        {r.statsAt ? (
          <CompareTable fields={RATIOS} row={r} avg={avg} count={d.categoryCount} />
        ) : (
          <p className="text-[13.5px] text-ink-muted">Not worked out yet; it comes with the background download.</p>
        )}
        <p className="mt-2 text-[12px] text-ink-muted">Three years of daily NAVs (five for the worst fall); 6.5% a year as the risk-free rate.</p>
      </section>

      <section>
        <h2 className="mb-3 text-[18px] font-semibold">What it holds</h2>
        {!d.holdings ? (
          <div className="rounded-xl border border-rule p-5 text-[13.5px] text-ink-muted">
            <p>{d.holdingsNote}</p>
            {!d.followed && !r.held && (
              <button
                type="button"
                disabled={follow.isPending}
                onClick={() => follow.mutate([r.code, true])}
                className="mt-3 rounded-lg bg-stamp px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Get its holdings every month
              </button>
            )}
            <ErrorNote error={follow.error} />
          </div>
        ) : (
          <Holdings d={d} />
        )}
      </section>

      <p className="text-[12px] text-ink-muted">
        Data: AMFI, mfapi.in, Yahoo Finance, and the fund house’s monthly portfolio file.{' '}
        {d.followed && (
          <button type="button" className="mr-2 text-stamp hover:underline" onClick={() => follow.mutate([r.code, false])}>
            Stop fetching its portfolio
          </button>
        )}
        {r.isin && (
          <button type="button" className="text-stamp hover:underline" onClick={() => openSymbol(r.isin!)}>
            {r.isin}
          </button>
        )}
      </p>
    </article>
  )
}

type View = 'now' | 'months' | 'sectors'

/** The portfolio: this month with its changes, each holding month by month, and sectors month by month. */
function Holdings({ d }: { d: FundDetail }) {
  const h = d.holdings!
  const hist = d.history
  const [view, setView] = useState<View>(hist ? 'months' : 'now')
  const views: { key: View; label: string }[] = [
    { key: 'now', label: `${monthLabel(h.asOf)} portfolio` },
    ...(hist ? [{ key: 'months' as const, label: 'Month by month' }, { key: 'sectors' as const, label: 'Sectors by month' }] : [])
  ]
  return (
    <>
      {d.assetMix.length > 1 && (
        <p className="mb-3 text-[13px] text-ink-muted">
          {d.assetMix.map((a) => `${a.type.toLowerCase()} ${(a.weight * 100).toFixed(1)}%`).join(' · ')}
        </p>
      )}
      <div role="tablist" aria-label="Holdings view" className="mb-4 flex flex-wrap gap-2">
        {views.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={
              'rounded-full border px-3.5 py-1 text-[13px] transition-colors ' +
              (view === v.key ? 'border-stamp bg-stamp-wash font-semibold text-stamp' : 'border-rule-strong text-ink-muted hover:text-ink')
            }
          >
            {v.label}
          </button>
        ))}
      </div>
      {!hist && (
        <p className="mb-3 text-[12.5px] text-ink-muted">
          Month-by-month changes show once a second month’s portfolio is in; up to six months are fetched in the background.
        </p>
      )}
      {view === 'now' && <ThisMonth d={d} />}
      {view === 'months' && hist && <MonthByMonth hist={hist} />}
      {view === 'sectors' && hist && <SectorsByMonth hist={hist} />}
    </>
  )
}

function ThisMonth({ d }: { d: FundDetail }) {
  const h = d.holdings!
  const max = Math.max(...h.rows.map((r) => r.weight), 0.0001)
  return (
    <div className="grid gap-8 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="overflow-hidden rounded-xl border border-rule">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-rule bg-sheet text-[12px] text-ink-muted">
              <th className="px-4 py-2 text-left font-medium">Holding</th>
              <th className="px-2 text-left font-medium">Sector</th>
              <th className="px-2 text-right font-medium">Share</th>
              <th className="px-4 text-right font-medium">{h.prevAsOf ? `Since ${monthLabel(h.prevAsOf)}` : ''}</th>
            </tr>
          </thead>
          <tbody>
            {h.rows.slice(0, 60).map((r) => (
              <tr key={r.isin ?? r.name} className="border-b border-rule last:border-0">
                <td className="max-w-[280px] truncate px-4 py-2" title={r.name}>
                  {r.name}
                </td>
                <td className="max-w-[150px] truncate px-2 text-ink-muted">{r.assetType === 'EQUITY' ? (r.sector ?? '') : r.assetType.toLowerCase()}</td>
                <td className="px-2">
                  <div className="flex items-center justify-end gap-2">
                    <span aria-hidden className="h-1.5 rounded-full bg-stamp/70" style={{ width: `${Math.max(2, (r.weight / max) * 56)}px` }} />
                    <span className="num w-14">{pct(r.weight)}</span>
                  </div>
                </td>
                <td className={`num px-4 ${r.change === null ? 'text-gain' : toneClass(r.change)}`}>{h.prevAsOf ? pts(r.change) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        {d.sectors.length > 0 && (
          <>
            <h3 className="mb-2 text-[15px] font-semibold">Sectors</h3>
            <ul className="mb-6 text-[13px]">
              {d.sectors.map((s) => (
                <li key={s.sector} className="flex items-center gap-2 border-b border-rule py-1.5">
                  <span className="min-w-0 flex-1 truncate">{s.sector}</span>
                  <span aria-hidden className="inline-block h-1.5 rounded-full bg-stamp/70" style={{ width: `${Math.max(2, s.weight * 200)}px` }} />
                  <span className="num w-14 text-right">{(s.weight * 100).toFixed(1)}%</span>
                  <span className={`num w-14 text-right ${toneClass(s.change)}`}>{s.change === null ? '' : pts(s.change)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {h.exited.length > 0 && (
          <>
            <h3 className="mb-2 text-[15px] font-semibold">Sold out since {monthLabel(h.prevAsOf!)}</h3>
            <ul className="text-[13px] text-ink-muted">
              {h.exited.slice(0, 15).map((x) => (
                <li key={x.name} className="py-0.5">
                  {x.name} <span className="num">(was {pct(x.weight)})</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

/** Every holding's share in each month: a column per month, the change over them, and a chart for the one picked. */
function MonthByMonth({ hist }: { hist: NonNullable<FundDetail['history']> }) {
  const [picked, setPicked] = useState(0)
  const [all, setAll] = useState(false)
  const rows = all ? hist.rows : hist.rows.slice(0, 30)
  const sel = hist.rows[picked] ?? hist.rows[0]
  const first = (w: (number | null)[]) => w.find((x) => x !== null) ?? null
  const status = (w: (number | null)[]) => (w.at(-1) === null ? 'Sold out' : w[0] === null ? 'New' : null)
  return (
    <div className="space-y-5">
      {sel && (
        <div className="rounded-xl border border-rule p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold">{sel.name}</h3>
            <span className="text-[13px] text-ink-muted">
              {hist.months.map((m, i) => `${monthLabel(m)} ${pct(sel.weights[i], 1)}`).join(' → ')}
            </span>
          </div>
          <Columns
            points={hist.months.map((m, i) => ({ key: m, label: monthLabel(m), value: (sel.weights[i] ?? 0) * 100 }))}
            format={(v) => `${v.toFixed(2)}% of the fund`}
            axisFormat={(v) => `${v.toFixed(1)}%`}
            label={`${sel.name}: share of the fund each month`}
            seriesLabel="Share of the fund"
            height={180}
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-rule">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-rule bg-sheet text-[12px] text-ink-muted">
              <th className="px-4 py-2 text-left font-medium">Holding</th>
              {hist.months.map((m) => (
                <th key={m} className="px-2 text-right font-medium whitespace-nowrap">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="px-2 text-right font-medium">Change</th>
              <th className="px-4 text-left font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const a = first(r.weights)
              const b = r.weights.at(-1) ?? 0
              const change = a === null ? null : b - (r.weights[0] ?? 0)
              const s = status(r.weights)
              const on = hist.rows[picked] === r
              return (
                <tr
                  key={r.isin ?? r.name}
                  onClick={() => setPicked(hist.rows.indexOf(r))}
                  aria-selected={on}
                  className={'cursor-pointer border-b border-rule last:border-0 ' + (on ? 'bg-stamp-wash' : 'hover:bg-sheet')}
                >
                  <td className="max-w-[260px] px-4 py-2">
                    <div className="truncate" title={r.name}>
                      {r.name}
                    </div>
                    <div className="text-[11.5px] text-ink-muted">
                      {r.assetType === 'EQUITY' ? (r.sector ?? '') : r.assetType.toLowerCase()}
                      {s && <span className={'ml-2 font-medium ' + (s === 'New' ? 'text-gain' : 'text-loss')}>{s}</span>}
                    </div>
                  </td>
                  {r.weights.map((w, j) => (
                    <td key={j} className={'num px-2 ' + (w === null ? 'text-ink-muted' : '')}>
                      {w === null ? '—' : pct(w)}
                    </td>
                  ))}
                  <td className={`num px-2 font-medium ${toneClass(change)}`}>{change === null ? '' : pts(change)}</td>
                  <td className="px-4">{i < 60 && <Sparkline values={r.weights.map((w) => w ?? 0)} width={72} height={22} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-ink-muted">
        Share of the fund at each month end, from the fund house’s monthly portfolio files. Change is in percentage points from {monthLabel(hist.months[0])}. Click a holding for its chart.
        {hist.rows.length > 30 && (
          <button type="button" onClick={() => setAll(!all)} className="ml-2 text-stamp hover:underline">
            {all ? 'Show the top 30' : `Show all ${hist.rows.length}`}
          </button>
        )}
      </p>
    </div>
  )
}

function SectorsByMonth({ hist }: { hist: NonNullable<FundDetail['history']> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-rule">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-rule bg-sheet text-[12px] text-ink-muted">
            <th className="px-4 py-2 text-left font-medium">Sector</th>
            {hist.months.map((m) => (
              <th key={m} className="px-2 text-right font-medium whitespace-nowrap">
                {monthLabel(m)}
              </th>
            ))}
            <th className="px-2 text-right font-medium">Change</th>
            <th className="px-4 text-left font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {hist.sectors.map((s) => {
            const change = s.weights.at(-1)! - s.weights[0]
            return (
              <tr key={s.sector} className="border-b border-rule last:border-0">
                <td className="px-4 py-2">{s.sector}</td>
                {s.weights.map((w, j) => (
                  <td key={j} className="num px-2">
                    {pct(w, 1)}
                  </td>
                ))}
                <td className={`num px-2 font-medium ${toneClass(change)}`}>{pts(change)}</td>
                <td className="px-4">
                  <Sparkline values={s.weights} width={72} height={22} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold text-ink" title={value}>
        {value}
      </dd>
      {note && (
        <dd className="truncate text-[11.5px] text-ink-muted" title={note}>
          {note}
        </dd>
      )}
    </div>
  )
}

/** The fund's figure against its category's average, and which way is better. */
function CompareTable({ fields, row, avg, count }: { fields: FundField[]; row: FundRow; avg: Partial<Record<FundField, number>>; count: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-rule bg-sheet text-[12px] text-ink-muted">
            <th className="px-4 py-2 text-left font-medium" />
            <th className="px-2 text-right font-medium">This fund</th>
            <th className="px-2 text-right font-medium">Category average ({count})</th>
            <th className="px-4 text-left font-medium" />
          </tr>
        </thead>
        <tbody>
          {fields.map((k) => {
            const f = fundField(k)!
            const v = row[k] as number | null
            const a = avg[k]
            // Within a hair of the average says nothing either way.
            const close = typeof v === 'number' && a !== undefined && Math.abs(v - a) <= Math.abs(a) * 0.01 + 1e-9
            const better = typeof v === 'number' && a !== undefined && !close ? (f.better === 'high' ? v > a : v < a) : null
            return (
              <tr key={k} className="border-b border-rule last:border-0">
                <td className="px-4 py-2" title={f.help}>
                  {f.label}
                </td>
                <td className="num px-2 font-semibold">{fundText(k, v)}</td>
                <td className="num px-2 text-ink-muted">{a === undefined ? '—' : fundText(k, a)}</td>
                <td className="px-4">
                  {better !== null && (
                    <span className={'rounded-full px-2 py-0.5 text-[11.5px] font-medium ' + (better ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss')}>
                      {better ? 'Better' : 'Worse'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
