import type { CommodityRow } from '@shared/commodities'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Sparkline } from '../components/viz'
import { useCommodities } from '../lib/api'
import { shortDate, timeAgo, toneClass } from '../lib/format'

const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)}%`)
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: v < 10 ? 3 : 2 }))
const GROUPS: CommodityRow['group'][] = ['Energy', 'Metals', 'Farm goods']

/** Oil, gas, metals and farm goods worldwide, and gold, silver and the farm's crops at home. */
export function Commodities() {
  const q = useCommodities()
  const b = q.data
  return (
    <>
      <PageHeader title="Commodities">{b && <span className="text-[12.5px] text-ink-muted">Futures from Yahoo Finance, delayed; {timeAgo(b.at)}</span>}</PageHeader>
      <ErrorNote error={q.error} />
      {q.isLoading && <p className="text-ink-muted">Fetching a year of prices…</p>}
      {b && b.india.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-[15px] font-semibold text-stamp">At home</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
            {b.india.map((x) => (
              <li key={x.label} className="rounded-sm border border-rule bg-sheet px-3 py-2">
                <div className="text-[12.5px] text-ink-muted">{x.label}</div>
                <div className="num text-left text-[19px] font-semibold">₹{Math.round(x.value).toLocaleString('en-IN')}</div>
                <div className="text-[12px] text-ink-muted">
                  {x.unit}
                  {x.change1d !== null && <span className={`num ml-2 ${toneClass(x.change1d)}`}>{pct(x.change1d)}</span>}
                  {x.asOf && <span className="ml-2">{shortDate(x.asOf.slice(0, 10))}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {b &&
        GROUPS.map((g) => (
          <section key={g} className="mb-8">
            <h2 className="mb-2 text-[15px] font-semibold text-stamp">{g}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                    <th className="py-1 text-left font-medium">Commodity</th>
                    <th className="px-2 text-right font-medium">Last</th>
                    <th className="px-2 text-right font-medium">Day</th>
                    <th className="px-2 text-right font-medium">Month</th>
                    <th className="px-2 text-right font-medium">Year</th>
                    <th className="px-2 font-medium">Year’s path</th>
                    <th className="px-2 text-left font-medium">Why it matters here</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <tr key={r.symbol} className="border-b border-rule">
                        <td className="py-1">
                          {r.label} <span className="block text-[11.5px] text-ink-muted">{r.unit}</span>
                        </td>
                        <td className="num px-2">{num(r.last)}</td>
                        <td className={`num px-2 ${toneClass(r.change1d)}`}>{pct(r.change1d)}</td>
                        <td className={`num px-2 ${toneClass(r.change1m)}`}>{pct(r.change1m)}</td>
                        <td className={`num px-2 ${toneClass(r.change1y)}`}>{pct(r.change1y)}</td>
                        <td className="px-2">{r.points.length > 2 && <Sparkline values={r.points} width={120} height={28} />}</td>
                        <td className="max-w-[44ch] px-2 text-[12.5px] text-ink-muted">{r.why}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      <p className="text-[12px] text-ink-muted">Futures are for the nearest contract month and switch when it rolls over, so a day’s move can include the switch.</p>
    </>
  )
}
