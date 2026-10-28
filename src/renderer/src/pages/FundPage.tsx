import { useParams } from 'react-router-dom'
import { fundField, type FundField, type FundRow } from '@shared/fundScreener'
import { ErrorNote } from '../components/Shell'
import { FundHistory } from '../components/FundCharts'
import { useFollowFund, useFundDetail } from '../lib/api'
import { shortDate, toneClass } from '../lib/format'
import { useOpenSymbol } from '../lib/links'
import { fundText } from './FundScreener'

const RATIOS: FundField[] = ['sharpe', 'sortino', 'alpha', 'beta', 'r2', 'vol', 'maxDrawdown', 'upCapture', 'downCapture', 'beatRate']
const RETURNS: FundField[] = ['ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'ret5y']
const pts = (v: number | null) => (v === null ? 'new' : Math.abs(v) < 0.00005 ? '0.00' : `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}`)

/** One fund: its returns and risk against its category and index, and what it holds. */
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

  return (
    <article className="space-y-8">
      <header>
        <h1 className="wide text-[22px] leading-tight font-semibold">{r.name}</h1>
        <p className="text-[13.5px] text-ink-muted">
          {[r.category, r.fundHouse, r.risk ? `riskometer ${r.risk}` : null, r.held ? 'held by the family' : null].filter(Boolean).join(' · ')}
        </p>
        <dl className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 text-[13px]">
          <Fact label="NAV" value={r.nav ? `₹${r.nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })}` : '—'} note={r.navDate ? shortDate(r.navDate) : undefined} />
          <Fact label="Fund size" value={fundText('aumCr', r.aumCr)} />
          <Fact label="Expense ratio" value={fundText('ter', r.ter)} note={avg.ter !== undefined ? `category ${avg.ter.toFixed(2)}%` : undefined} />
          <Fact label="Benchmark" value={r.benchmark ?? '—'} note={r.index ? `ratios against ${r.index}` : 'no equity index for this kind of fund'} />
          <Fact label="History" value={`${r.years.toFixed(1)} years`} />
        </dl>
      </header>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">Returns against the category</h2>
        <CompareTable fields={RETURNS} row={r} avg={avg} count={d.categoryCount} />
      </section>

      <FundHistory code={r.code} />

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">Risk and how it got its return</h2>
        {r.statsAt ? <CompareTable fields={RATIOS} row={r} avg={avg} count={d.categoryCount} /> : <p className="text-[13.5px] text-ink-muted">Not worked out yet; it comes with the background download.</p>}
        <p className="mt-1 text-[12px] text-ink-muted">Three years of daily NAVs (five for the worst fall); 6.5% a year as the risk-free rate.</p>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">What it holds</h2>
        {!d.holdings ? (
          <div className="text-[13.5px] text-ink-muted">
            <p>{d.holdingsNote}</p>
            {!d.followed && !r.held && (
              <button type="button" disabled={follow.isPending} onClick={() => follow.mutate([r.code, true])} className="mt-2 rounded-sm bg-stamp px-3 py-1 font-medium text-black disabled:opacity-50">
                Get its holdings every month
              </button>
            )}
            <ErrorNote error={follow.error} />
          </div>
        ) : (
          <>
            <p className="mb-2 text-[13px] text-ink-muted">
              Portfolio of {shortDate(d.holdings.asOf)}
              {d.holdings.prevAsOf ? `, with changes since ${shortDate(d.holdings.prevAsOf)} (percentage points of the fund)` : '; changes show once the next month’s file is in'}.
            </p>
            {d.assetMix.length > 1 && (
              <p className="mb-3 text-[13px]">
                {d.assetMix.map((a) => `${a.type.toLowerCase()} ${(a.weight * 100).toFixed(1)}%`).join(', ')}
              </p>
            )}
            <div className="grid gap-8 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                    <th className="py-1 text-left font-medium">Holding</th>
                    <th className="px-2 text-left font-medium">Sector</th>
                    <th className="px-2 text-right font-medium">Weight</th>
                    <th className="px-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {d.holdings.rows.slice(0, 60).map((h) => (
                    <tr key={`${h.isin ?? h.name}`} className="border-b border-rule">
                      <td className="max-w-[300px] truncate py-1" title={h.name}>
                        {h.name}
                      </td>
                      <td className="max-w-[160px] truncate px-2 text-ink-muted">{h.assetType === 'EQUITY' ? (h.sector ?? '') : h.assetType.toLowerCase()}</td>
                      <td className="num px-2">{(h.weight * 100).toFixed(2)}%</td>
                      <td className={`num px-2 ${h.change === null ? 'text-gain' : toneClass(h.change)}`}>{d.holdings!.prevAsOf ? pts(h.change) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                {d.sectors.length > 0 && (
                  <>
                    <h3 className="mb-1 text-[14px] font-medium">Sectors</h3>
                    <ul className="mb-6 text-[13px]">
                      {d.sectors.map((s) => (
                        <li key={s.sector} className="flex items-center gap-2 border-b border-rule py-1">
                          <span className="min-w-0 flex-1 truncate">{s.sector}</span>
                          <span aria-hidden className="inline-block h-1.5 rounded-sm bg-stamp" style={{ width: `${Math.max(2, s.weight * 200)}px` }} />
                          <span className="num w-14 text-right">{(s.weight * 100).toFixed(1)}%</span>
                          <span className={`num w-14 text-right ${toneClass(s.change)}`}>{s.change === null ? '' : pts(s.change)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {d.holdings.exited.length > 0 && (
                  <>
                    <h3 className="mb-1 text-[14px] font-medium">Sold out since {shortDate(d.holdings.prevAsOf!)}</h3>
                    <ul className="text-[13px] text-ink-muted">
                      {d.holdings.exited.slice(0, 15).map((h) => (
                        <li key={h.name}>
                          {h.name} <span className="num">(was {(h.weight * 100).toFixed(2)}%)</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </>
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

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-sm border border-rule bg-sheet px-3 py-1.5">
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd className="num text-left text-[15px] font-medium">{value}</dd>
      {note && <dd className="truncate text-[11.5px] text-ink-muted" title={note}>{note}</dd>}
    </div>
  )
}

/** The fund's figure against its category's average, and which way is better. */
function CompareTable({ fields, row, avg, count }: { fields: FundField[]; row: FundRow; avg: Partial<Record<FundField, number>>; count: number }) {
  return (
    <table className="w-full max-w-[720px] text-[13.5px]">
      <thead>
        <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
          <th className="py-1 text-left font-medium" />
          <th className="px-2 text-right font-medium">This fund</th>
          <th className="px-2 text-right font-medium">Category average ({count})</th>
          <th className="px-2 text-left font-medium" />
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
            <tr key={k} className="border-b border-rule">
              <td className="py-1" title={f.help}>
                {f.label}
              </td>
              <td className="num px-2 font-medium">{fundText(k, v)}</td>
              <td className="num px-2 text-ink-muted">{a === undefined ? '—' : fundText(k, a)}</td>
              <td className={`px-2 text-[12px] ${better === null ? '' : better ? 'text-gain' : 'text-loss'}`}>{better === null ? '' : better ? 'better' : 'worse'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
