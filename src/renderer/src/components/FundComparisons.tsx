import type { FundFacts, FundPairComparison } from '@shared/insights'
import { useFundComparisons } from '../lib/api'
import { compactMoney } from '../lib/format'

const pctNum = (v: number | null, digits = 1) => (v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`)
const share = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const PLAN: Record<FundFacts['plan'], string> = { DIRECT: 'Direct', REGULAR: 'Regular', NOT_STATED: 'Plan not stated', ETF: 'ETF' }

/**
 * Marks the better figure of the two on a row, by a stated rule (lower cost, more of its own
 * companies…). The reader weighs the rows; nothing here adds them up into a pick.
 */
function Row({
  label,
  a,
  b,
  fmt,
  better,
  hint
}: {
  label: string
  a: number | null
  b: number | null
  fmt: (v: number | null) => string
  better?: 'low' | 'high'
  hint?: string
}) {
  const mark = (x: number | null, y: number | null) =>
    better && x !== null && y !== null && x !== y && (better === 'low' ? x < y : x > y) ? 'font-semibold text-ink' : 'text-ink-muted'
  return (
    <tr className="border-b border-rule">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-muted" title={hint}>
        {label}
      </th>
      <td className={`num py-1.5 ${mark(a, b)}`}>{fmt(a)}</td>
      <td className={`num py-1.5 ${mark(b, a)}`}>{fmt(b)}</td>
    </tr>
  )
}

function Pair({ p }: { p: FundPairComparison }) {
  const [a, b] = p.funds
  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-[15px]">
          <span className="font-semibold">{Math.round(p.overlap * 100)}% the same</span>
          <span className="ml-2 text-ink-muted">{p.sharedCount} companies in both</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-[13px]">
              <th className="w-[34%]" />
              {[a, b].map((f) => (
                <th key={f.instrumentId} className="py-1.5 text-right align-bottom font-medium">
                  {f.name}
                  <div className="text-[12px] font-normal text-ink-muted">
                    {PLAN[f.plan]}
                    {f.category ? `, ${f.category}` : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="You hold" a={a.valueInr} b={b.valueInr} fmt={(v) => (v === null ? '—' : compactMoney(v))} />
            <Row label="Yearly cost (TER), your plan" a={a.ter} b={b.ter} fmt={(v) => pctNum(v, 2)} better="low" />
            <Row label="Fund size" a={a.aumCr} b={b.aumCr} fmt={(v) => (v === null ? '—' : compactMoney(v * 1e7))} />
            <Row label="Return, 1 year" a={a.r1y} b={b.r1y} fmt={(v) => pctNum(v)} />
            <Row label="Return, 3 years a year" a={a.r3y} b={b.r3y} fmt={(v) => pctNum(v)} better="high" />
            <Row label="Return, 5 years a year" a={a.r5y} b={b.r5y} fmt={(v) => pctNum(v)} better="high" />
            <Row
              label="Its benchmark, 3 years"
              a={a.benchmark3y}
              b={b.benchmark3y}
              fmt={(v) => pctNum(v)}
              hint="What the fund's own index returned over the same three years"
            />
            <Row
              label="Holdings not in the other"
              a={a.uniqueShare}
              b={b.uniqueShare}
              fmt={share}
              better="high"
              hint="Share of the fund (by weight) in companies the other fund doesn't own"
            />
            <tr className="border-b border-rule">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-muted">
                Risk level
              </th>
              <td className="py-1.5 text-right text-ink-muted">{a.risk ?? '—'}</td>
              <td className="py-1.5 text-right text-ink-muted">{b.risk ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {p.shared.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-muted">
          Largest in both:{' '}
          {p.shared.slice(0, 6).map((s, i) => (
            <span key={s.name}>
              {i > 0 && ', '}
              {s.name} ({(s.weightA * 100).toFixed(1)}% / {(s.weightB * 100).toFixed(1)}%)
            </span>
          ))}
        </p>
      )}
      {(!a.matched || !b.matched) && (
        <p className="mt-2 text-[12px] text-warn">
          {[a, b]
            .filter((f) => !f.matched)
            .map((f) => f.name)
            .join(' and ')}{' '}
          not found in AMFI&rsquo;s performance list, so its cost and returns are missing.
        </p>
      )}
    </div>
  )
}

export function FundComparisonsSection({ personId }: { personId?: number }) {
  const q = useFundComparisons(personId)
  const d = q.data
  if (!d || d.pairs.length === 0) return null
  return (
    <section aria-labelledby="pairs" className="mt-14">
      <h2 id="pairs" className="wide text-[19px] font-semibold">
        Overlapping funds, side by side
      </h2>
      <p className="mt-1 mb-4 max-w-[80ch] text-[14px] text-ink-muted">
        Pairs of your funds that own a quarter or more of the same companies. Two funds this alike add cost and
        paperwork more than spread. The bolder figure on a row is the lower cost, the higher long-run return or the more
        of its own companies; which rows matter is your call. Returns are past ones, from AMFI
        {d.schemesAsOf ? ` (${d.schemesAsOf})` : ''}, before tax.
      </p>
      <div className="grid gap-4 @7xl:grid-cols-2">
        {d.pairs.slice(0, 8).map((p) => (
          <Pair key={`${p.funds[0].instrumentId}-${p.funds[1].instrumentId}`} p={p} />
        ))}
      </div>
      {!d.schemesAsOf && (
        <p className="mt-3 text-[13px] text-ink-muted">Costs and returns download from AMFI with the next refresh.</p>
      )}
    </section>
  )
}
