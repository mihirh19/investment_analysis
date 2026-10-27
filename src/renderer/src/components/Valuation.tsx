import { useMemo, useState } from 'react'
import type { CompanyView } from '@shared/research'
import { averageFcf, impliedGrowth, valuationBands, type Band } from '@shared/valuation'
import { ErrorNote } from './Shell'
import { PriceLine } from './charts'
import { useCompanyChart } from '../lib/api'
import { bigMoney, shortDate } from '../lib/format'

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`)
const times = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1))

/** Where today's price sits against the company's own history, and what growth it takes for granted. */
export function Valuation({ c }: { c: CompanyView }) {
  const q = useCompanyChart(c.symbol, '5y')
  const bands = useMemo(
    // Today is the history's latest point, worked out the same way, so the line and the words agree.
    () => valuationBands(q.data ?? [], c.metrics.shares, c.quarters, c.balances),
    [q.data, c]
  )
  return (
    <div className="space-y-8">
      <ErrorNote error={q.error} />
      {q.isLoading && <p className="text-ink-muted">Fetching five years of prices…</p>}
      {q.data && (
        <div className="grid gap-8 @5xl:grid-cols-2">
          <BandChart title="Price to earnings (P/E)" what="profit over the last four quarters" band={bands.pe} c={c} />
          <BandChart title="Price to book value (P/B)" what="the book value in the latest balance sheet" band={bands.pb} c={c} />
        </div>
      )}
      <ReverseDcf c={c} />
    </div>
  )
}

function BandChart({ title, what, band, c }: { title: string; what: string; band: Band; c: CompanyView }) {
  if (band.points.length < 10)
    return (
      <section>
        <h3 className="mb-1 text-[15px] font-semibold">{title}</h3>
        <p className="text-[13.5px] text-ink-muted">Not enough filed results to draw this for {c.name} yet.</p>
      </section>
    )
  const from = band.points[0].date
  return (
    <section>
      <h3 className="mb-1 text-[15px] font-semibold">{title}</h3>
      <p className="mb-2 text-[13.5px] text-ink-muted">
        Today <strong className="num text-ink">{times(band.current)}</strong>
        {band.rank !== null && <>, higher than {Math.round(band.rank * 100)}% of the time since {shortDate(from)}</>}. Usual range{' '}
        <span className="num text-ink">
          {times(band.low)} to {times(band.high)}
        </span>{' '}
        (middle 80%), median <span className="num text-ink">{times(band.median)}</span>.
      </p>
      <PriceLine
        label={`${title} of ${c.name}`}
        points={band.points.map((p) => ({ date: p.date, close: p.value }))}
        format={(v) => v.toFixed(1)}
        axisFormat={(v) => v.toFixed(0)}
        reference={band.median !== null ? { value: band.median, label: 'Median' } : null}
        height={220}
      />
      <p className="mt-1 text-[12px] text-ink-muted">Market value each week against {what} known then.</p>
    </section>
  )
}

function ReverseDcf({ c }: { c: CompanyView }) {
  const fcf = c.bank ? null : averageFcf(c.years)
  const [basis, setBasis] = useState<'profit' | 'fcf'>('profit')
  const [discount, setDiscount] = useState(12)
  const [years, setYears] = useState(10)
  const [terminal, setTerminal] = useState(5)
  const base = basis === 'fcf' ? fcf : c.metrics.ttmProfit
  const mcap = c.metrics.mcap
  const g = mcap && base ? impliedGrowth(mcap, { base, years, discount: discount / 100, terminalGrowth: terminal / 100 }) : null
  const past = c.metrics.profitGrowth3y
  const label = basis === 'fcf' ? 'free cash flow' : 'profit'

  return (
    <section aria-labelledby="rdcf">
      <h3 id="rdcf" className="mb-1 text-[15px] font-semibold">
        What the price assumes (reverse DCF)
      </h3>
      <p className="mb-3 max-w-[80ch] text-[13.5px] text-ink-muted">
        Works backwards from today’s market value to the yearly growth that would justify it, for the return you set. A way to read the price,
        not a forecast or a recommendation.
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 text-[13px]">
        <div role="radiogroup" aria-label="Grow from" className="flex rounded-sm border border-rule">
          {(
            [
              ['profit', 'Profit, last 4 quarters'],
              ['fcf', 'Free cash flow, 3-year average']
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={basis === k}
              disabled={k === 'fcf' && fcf === null}
              onClick={() => setBasis(k)}
              className={`px-3 py-1 disabled:opacity-40 ${basis === k ? 'bg-stamp text-black' : 'text-ink-muted hover:text-ink'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <Slider label="Return you want a year" value={discount} min={8} max={18} step={0.5} unit="%" onChange={setDiscount} />
        <Slider label="Years of growth" value={years} min={5} max={20} step={1} unit=" years" onChange={setYears} />
        <Slider label="Growth after that, forever" value={terminal} min={2} max={7} step={0.5} unit="%" onChange={setTerminal} />
      </div>
      {!mcap || !base ? (
        <p className="text-[13.5px] text-ink-muted">Needs a market value and a positive {label}; {c.name} doesn’t have both yet.</p>
      ) : base <= 0 ? (
        <p className="text-[13.5px] text-ink-muted">The {label} is negative, so there is no growth rate to work out.</p>
      ) : (
        <div className="max-w-[80ch] rounded-sm border border-rule bg-sheet px-4 py-3 text-[14.5px]">
          {g === null ? (
            <p>Even with no growth at all, the {label} is worth more than today’s price at a {discount}% return.</p>
          ) : (
            <p>
              At a market value of {bigMoney(mcap)}, the price assumes {label} of {bigMoney(base)} grows about{' '}
              <strong className="num text-[18px] text-stamp">{pct(g)}</strong> a year for {years} years, then {terminal}% a year, for you to earn{' '}
              {discount}% a year.
            </p>
          )}
          {past !== null && <p className="mt-1 text-[13px] text-ink-muted">For comparison, profit grew {pct(past)} a year over the last three years.</p>}
        </div>
      )}
    </section>
  )
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-muted">
        {label}: <span className="num text-ink">{`${value}${unit}`}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-44 accent-[var(--stamp)]" />
    </label>
  )
}
