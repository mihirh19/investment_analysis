import { useEffect, useMemo, useRef, useState } from 'react'
import { ColorType, createChart, CrosshairMode, LineSeries, LineStyle, PriceScaleMode, type IChartApi, type Time } from 'lightweight-charts'
import { rollingReturns, rollingStats, type FundChartData, type PricePt } from '@shared/fundScreener'
import { alpha, token, useChartTheme } from './chart/setup'
import { Legend } from './charts'
import { ErrorNote } from './Shell'
import { useFundChart } from '../lib/api'
import { shortDate } from '../lib/format'

const RANGES = [
  ['1M', 30],
  ['6M', 182],
  ['1Y', 365],
  ['3Y', 3 * 365],
  ['5Y', 5 * 365],
  ['10Y', 10 * 365],
  ['All', 0]
] as const
type Range = (typeof RANGES)[number][0]

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`)

/** A chart on the app's theme, created in a box and removed with it. */
function useChart(build: (chart: IChartApi) => void, deps: unknown[], percent: boolean) {
  const box = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  useEffect(() => {
    const el = box.current
    if (!el) return
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: token('paper') }, textColor: token('ink-muted'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: alpha('var(--rule)', 0.6) }, horzLines: { color: alpha('var(--rule)', 0.6) } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: token('rule-strong') },
      timeScale: { borderColor: token('rule-strong'), rightOffset: 2 },
      localization: { priceFormatter: (p: number) => (percent ? `${(p * 100).toFixed(1)}%` : p.toLocaleString('en-IN', { maximumFractionDigits: 2 })) }
    })
    build(chart)
    return () => {
      chart.remove()
    }
  }, [theme, ...deps])
  return box
}

const line = (s: { date: string; value: number }[]) => s.map((p) => ({ time: p.date as Time, value: p.value }))

/** The fund's whole NAV history; with the index on, both start at 100 from the range's first day. */
function FullChart({ d }: { d: FundChartData }) {
  const [range, setRange] = useState<Range>('5Y')
  const [compare, setCompare] = useState(true)
  const [log, setLog] = useState(false)
  const last = d.nav.at(-1)!
  const days = RANGES.find((r) => r[0] === range)![1]
  const from = days ? new Date(Date.parse(last.date) - days * 86400_000).toISOString().slice(0, 10) : d.nav[0].date
  const nav = d.nav.filter((p) => p.date >= from)
  const idx = compare && d.index ? d.index.filter((p) => p.date >= nav[0]?.date) : null
  const rebase = (s: PricePt[]) => (s.length ? s.map((p) => ({ date: p.date, value: (p.close / s[0].close) * 100 })) : [])
  const fundLine = compare && idx?.length ? rebase(nav) : nav.map((p) => ({ date: p.date, value: p.close }))
  const change = nav.length > 1 ? nav.at(-1)!.close / nav[0].close - 1 : null
  const idxChange = idx && idx.length > 1 ? idx.at(-1)!.close / idx[0].close - 1 : null
  const years = nav.length > 1 ? (Date.parse(nav.at(-1)!.date) - Date.parse(nav[0].date)) / (365.25 * 86400_000) : 0

  const box = useChart(
    (chart) => {
      chart.addSeries(LineSeries, { color: token('series-1'), lineWidth: 2, priceLineVisible: false, title: 'Fund' }).setData(line(fundLine))
      if (compare && idx?.length) chart.addSeries(LineSeries, { color: token('series-2'), lineWidth: 2, priceLineVisible: false, title: d.indexLabel ?? 'Index' }).setData(line(rebase(idx)))
      chart.priceScale('right').applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
      chart.timeScale().fitContent()
    },
    [range, compare, log, d],
    false
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
        <div role="radiogroup" aria-label="Period" className="flex rounded-sm border border-rule">
          {RANGES.map(([k]) => (
            <button key={k} type="button" role="radio" aria-checked={range === k} onClick={() => setRange(k)} className={`px-2 py-0.5 ${range === k ? 'bg-stamp text-black' : 'text-ink-muted hover:text-ink'}`}>
              {k}
            </button>
          ))}
        </div>
        {d.index && (
          <label className="flex items-center gap-1.5 text-ink-muted">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Against {d.indexLabel}
          </label>
        )}
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale
        </label>
        <span className="text-ink-muted">
          {nav.length > 1 && (
            <>
              {shortDate(nav[0].date)} to {shortDate(last.date)}: fund <b className={change !== null && change >= 0 ? 'text-gain' : 'text-loss'}>{pct(change)}</b>
              {years >= 1 && change !== null ? ` (${pct((1 + change) ** (1 / years) - 1)} a year)` : ''}
              {idxChange !== null && (
                <>
                  , index <b>{pct(idxChange)}</b>
                </>
              )}
            </>
          )}
        </span>
      </div>
      {compare && idx?.length ? <Legend items={[{ label: 'This fund', color: 'var(--series-1)' }, { label: d.indexLabel ?? 'Index', color: 'var(--series-2)' }]} /> : null}
      <div ref={box} className="h-[340px] w-full" role="img" aria-label={`NAV of the fund from ${shortDate(nav[0]?.date)} to ${shortDate(last.date)}`} />
      <p className="mt-1 text-[12px] text-ink-muted">
        {compare && idx?.length ? 'Both start at 100 on the first day shown. ' : 'NAV in rupees. '}Since {shortDate(d.nav[0].date)} (mfapi.in){d.index ? `; index from Yahoo Finance since ${shortDate(d.index[0].date)}` : ''}. Chart by TradingView Lightweight Charts.
      </p>
    </div>
  )
}

/** Yearly return over every 1, 3 or 5-year window: how it went whenever someone started. */
function Rolling({ d }: { d: FundChartData }) {
  const [years, setYears] = useState(3)
  const fund = useMemo(() => rollingReturns(d.nav, years), [d.nav, years])
  const index = useMemo(() => (d.index ? rollingReturns(d.index, years) : null), [d.index, years])
  const idxFrom = index?.length && fund.length ? index.filter((p) => p.date >= fund[0].date) : null
  const st = useMemo(() => rollingStats(fund, index, years), [fund, index, years])
  const ist = useMemo(() => (idxFrom ? rollingStats(idxFrom, null, years) : null), [idxFrom, years])

  const box = useChart(
    (chart) => {
      const f = chart.addSeries(LineSeries, { color: token('series-1'), lineWidth: 2, priceLineVisible: false, title: 'Fund' })
      f.setData(line(fund))
      f.createPriceLine({ price: 0, color: token('ink-muted'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
      if (idxFrom?.length) chart.addSeries(LineSeries, { color: token('series-2'), lineWidth: 2, priceLineVisible: false, title: d.indexLabel ?? 'Index' }).setData(line(idxFrom))
      chart.timeScale().fitContent()
    },
    [fund, idxFrom],
    true
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
        <div role="radiogroup" aria-label="Holding period" className="flex rounded-sm border border-rule">
          {[1, 3, 5, 7, 10].map((y) => (
            <button key={y} type="button" role="radio" aria-checked={years === y} onClick={() => setYears(y)} className={`px-2 py-0.5 ${years === y ? 'bg-stamp text-black' : 'text-ink-muted hover:text-ink'}`}>
              {y} year{y === 1 ? '' : 's'}
            </button>
          ))}
        </div>
        <span className="text-ink-muted">{st.windows ? `${st.windows.toLocaleString('en-IN')} windows, ending ${shortDate(st.from)} to ${shortDate(st.to)}` : ''}</span>
      </div>
      {fund.length === 0 ? (
        <p className="text-[13.5px] text-ink-muted">The fund hasn’t been around for {years} years yet.</p>
      ) : (
        <>
          <Legend items={[{ label: 'This fund', color: 'var(--series-1)' }, ...(idxFrom?.length ? [{ label: d.indexLabel ?? 'Index', color: 'var(--series-2)' }] : [])]} />
          <div ref={box} className="h-[260px] w-full" role="img" aria-label={`${years}-year rolling returns: ${pct(st.min)} at worst, ${pct(st.max)} at best`} />
          <div className="mt-3 grid gap-6 @5xl:grid-cols-2">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                  <th className="py-1 text-left font-medium">{years}-year return, a year</th>
                  <th className="px-2 text-right font-medium">Fund</th>
                  {ist && <th className="px-2 text-right font-medium">{d.indexLabel}</th>}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Worst', st.min, ist?.min],
                    ['Median', st.median, ist?.median],
                    ['Average', st.avg, ist?.avg],
                    ['Best', st.max, ist?.max],
                    ['Lost money', st.negative, ist?.negative]
                  ] as [string, number | null, number | null | undefined][]
                ).map(([label, v, i]) => (
                  <tr key={label} className="border-b border-rule">
                    <td className="py-1">{label}</td>
                    <td className="num px-2 font-medium">{label === 'Lost money' ? `${pct(v, 0)} of windows` : pct(v)}</td>
                    {ist && <td className="num px-2 text-ink-muted">{label === 'Lost money' ? `${pct(i ?? null, 0)}` : pct(i ?? null)}</td>}
                  </tr>
                ))}
                {st.beatIndex !== null && (
                  <tr className="border-b border-rule">
                    <td className="py-1">Ahead of the index</td>
                    <td className="num px-2 font-medium">{pct(st.beatIndex, 0)} of windows</td>
                    {ist && <td />}
                  </tr>
                )}
              </tbody>
            </table>
            <div>
              <h4 className="mb-1 text-[13px] font-medium">How the windows came out</h4>
              <ul className="text-[13px]">
                {st.buckets.map((b) => (
                  <li key={b.label} className="flex items-center gap-2 py-0.5">
                    <span className="w-24 text-ink-muted">{b.label}</span>
                    <span aria-hidden className={`inline-block h-2 rounded-sm ${b.label.startsWith('Below') ? 'bg-loss' : 'bg-stamp'}`} style={{ width: `${Math.max(1, b.share * 220)}px` }} />
                    <span className="num">{pct(b.share, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">Each point is the yearly return of someone who stayed in for {years} year{years === 1 ? '' : 's'} up to that day. Past returns don’t tell what comes next.</p>
        </>
      )}
    </div>
  )
}

/** The fund's full chart and its rolling returns, from its whole NAV history. */
export function FundHistory({ code }: { code: string }) {
  const q = useFundChart(code)
  if (q.isLoading) return <p className="text-[13.5px] text-ink-muted">Fetching the whole NAV history…</p>
  if (q.error) return <ErrorNote error={q.error} />
  const d = q.data
  if (!d || d.nav.length < 2) return <p className="text-[13.5px] text-ink-muted">No NAV history for this fund yet.</p>
  return (
    <>
      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">NAV since launch</h2>
        <FullChart d={d} />
      </section>
      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">Rolling returns</h2>
        <Rolling d={d} />
      </section>
    </>
  )
}
