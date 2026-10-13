import { useEffect, useState } from 'react'
import type { RiskReport, RiskStats } from '@shared/types'
import { StackBar } from './charts'
import { Heatmap, LineCompare } from './chart/extra'
import { ErrorNote } from './Shell'
import { useRisk, useSetRiskFreeRate } from '../lib/api'
import { compactMoney, shortDate } from '../lib/format'
import { stagger } from '../lib/motion'

// Risk of today's holdings over the last year of daily prices, plus how concentrated the money is.

const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d))
const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`
const signed = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : Math.abs(v * 100) < 0.5 * 10 ** -d
      ? `${(0).toFixed(d)}%`
      : `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%`
const tone = (v: number | null | undefined) => (!v ? '' : v > 0 ? 'text-gain' : 'text-loss')

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note ? <div className="mt-0.5 mb-4 max-w-[86ch] text-[14px] text-ink-muted">{note}</div> : <div className="mb-4" />}
      {children}
    </section>
  )
}

/** Short, unique labels for heatmap axes. */
function shortLabels(names: string[], words = 2, chars = 14): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    let s = n
      .replace(/\b(limited|ltd\.?|fund|etf|index|plan|direct|growth|regular)\b/gi, '')
      .split(/\s+[-–]\s+/)[0]
      .trim()
      .split(/\s+/)
      .slice(0, words)
      .join(' ')
    if (s.length > chars) s = s.slice(0, chars - 1) + '…'
    const k = seen.get(s) ?? 0
    seen.set(s, k + 1)
    return k ? `${s} ${k + 1}` : s
  })
}

function RiskFreeInput({ value }: { value: number }) {
  const [text, setText] = useState((value * 100).toFixed(1))
  const set = useSetRiskFreeRate()
  useEffect(() => setText((value * 100).toFixed(1)), [value])
  const save = () => {
    const v = Number(text.replace('%', '')) / 100
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-9) set.mutate(v)
    else setText((value * 100).toFixed(1))
  }
  return (
    <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
      Risk-free rate
      <input
        value={text}
        inputMode="decimal"
        aria-label="Risk-free rate, percent a year"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        className="w-14 rounded border border-rule-strong bg-sheet px-1.5 py-0.5 text-right text-[13px] text-ink"
      />
      % a year
      {set.error && <span className="text-loss">{(set.error as Error).message}</span>}
    </label>
  )
}

export function RiskSection({ personId, family }: { personId?: number; family: boolean }) {
  const q = useRisk(personId)
  const r = q.data
  if (!r) return <ErrorNote error={q.error} />
  return (
    <>
      <PortfolioRisk r={r} />
      <Concentration r={r} family={family} />
    </>
  )
}

function coverageNote(r: RiskReport) {
  const noDaily = r.coverage.excluded.filter((e) => e.reason === 'NO_DAILY_PRICES')
  const young = r.coverage.excluded.filter((e) => e.reason === 'TOO_LITTLE_HISTORY')
  const share = r.coverage.totalInr > 0 ? r.coverage.includedInr / r.coverage.totalInr : 0
  return (
    <>
      Your shares, funds and ETFs as you hold them today ({pct(share, 0)} of your money), replayed over the last year of
      daily prices: how today's mix would have behaved, not what happened to your money.{' '}
      {noDaily.length > 0 &&
        `Deposits, EPF, property and the like (${compactMoney(noDaily.reduce((s, e) => s + e.valueInr, 0))}) have no daily prices and are left out; they move far less, so your whole net worth swings less than this. `}
      {young.length > 0 && `Too new to measure: ${young.map((e) => e.name).join(', ')}.`}
      <div className="mt-2 text-ink">
        <RiskFreeInput value={r.riskFreeRate} />
        <span className="ml-2 text-ink-muted">used for the Sharpe and Sortino ratios</span>
      </div>
    </>
  )
}

function PortfolioRisk({ r }: { r: RiskReport }) {
  const p = r.portfolio
  const nifty = r.benchmarks.find((b) => b.key === 'BM:NIFTY50')?.stats
  if (!p) {
    return (
      <Section id="risk" title="Risk, as you hold things today" note={coverageNote(r)}>
        <p className="text-[14px] text-ink-muted">
          Needs about a year of daily prices for your shares and funds. They download with the daily price refresh; check
          back after it has run.
        </p>
      </Section>
    )
  }
  const cards: [string, string, string][] = [
    ['Swings, a year', pct(p.volatility), `volatility · Nifty 50 ${pct(nifty?.volatility)}`],
    ['Sharpe ratio', num(p.sharpe), `return per unit of swing · Nifty ${num(nifty?.sharpe)}`],
    ['Sortino ratio', num(p.sortino), `counts only the falls · Nifty ${num(nifty?.sortino)}`],
    ['Beta to Nifty 50', num(p.beta), p.beta !== null ? `moves ${num(p.beta)}% per 1% of the Nifty` : 'no Nifty prices yet'],
    [
      'Worst fall in the year',
      signed(p.maxDrawdown?.depth ?? 0),
      p.maxDrawdown ? (p.maxDrawdown.recovered ? `back by ${shortDate(p.maxDrawdown.recovered)}` : 'not yet recovered') : 'none'
    ],
    ['Worst day', signed(p.worstDay?.r), p.worstDay ? shortDate(p.worstDay.date) : '']
  ]
  const top = r.holdings.slice(0, 12)
  const labels = shortLabels(r.correlation.names)

  return (
    <>
      <Section id="risk" title="Risk, as you hold things today" note={coverageNote(r)}>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {cards.map(([k, v, sub], i) => (
            <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 50)}>
              <dt className="text-[13px] text-ink-muted">{k}</dt>
              <dd className="wide text-[20px] font-semibold">{v}</dd>
              <dd className="text-[12px] text-ink-muted">{sub}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-[15px] [&_td+td]:pl-4 [&_th+th]:pl-4">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">{`${shortDate(r.from)} to ${shortDate(r.to)}`}</th>
                <th className="num py-1.5 font-medium">Return</th>
                <th className="num py-1.5 font-medium">Volatility</th>
                <th className="num py-1.5 font-medium">Sharpe</th>
                <th className="num py-1.5 font-medium">Sortino</th>
                <th className="num py-1.5 font-medium">Worst fall</th>
                <th className="num py-1.5 font-medium">Beta</th>
              </tr>
            </thead>
            <tbody>
              <StatsRow label="Your holdings, as held today" s={p} strong />
              {r.benchmarks.map((b) => (
                <StatsRow key={b.key} label={b.label} s={b.stats} />
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="risk-year" title="The last year, as held today" note="Growth of ₹100 in today's mix of shares and funds, day by day, against the Nifty 50.">
        <LineCompare
          dates={r.dates}
          series={[
            { key: 'you', label: 'Your holdings, as held today', color: 'var(--series-1)', values: r.growth },
            { key: 'nifty', label: 'Nifty 50', color: 'var(--series-2)', values: r.niftyGrowth, dashed: true }
          ]}
          label="Growth of 100 rupees over the last year, today's holdings against the Nifty 50"
          format={(v) => `₹${v.toFixed(1)}`}
          axisFormat={(v) => `₹${Math.round(v)}`}
          height={240}
        />
      </Section>

      <div className="grid grid-cols-1 gap-x-12 xl:grid-cols-2">
        <Section
          id="risk-sources"
          title="Where the swings come from"
          note="Each holding's share of the money and of the ups and downs. A holding with a much bigger share of the swings than of the money (amber) is what makes the portfolio move."
        >
          <table className="w-full text-[14px] [&_td+td]:pl-3 [&_th+th]:pl-3">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Holding</th>
                <th className="num py-1.5 font-medium">Of the money</th>
                <th className="num py-1.5 font-medium">Of the swings</th>
                <th className="num py-1.5 font-medium">Volatility</th>
                <th className="num py-1.5 font-medium">Beta</th>
              </tr>
            </thead>
            <tbody>
              {top.map((h) => {
                const heavy = h.riskShare !== null && h.riskShare > h.weight * 1.5 && h.riskShare > 0.05
                return (
                  <tr key={h.instrumentId} className="border-b border-rule">
                    <td className="max-w-[220px] truncate py-1.5" title={h.name}>
                      {h.name}
                    </td>
                    <td className="num py-1.5">{pct(h.weight, 0)}</td>
                    <td className={`num py-1.5 ${heavy ? 'font-semibold text-warn' : ''}`}>{pct(h.riskShare, 0)}</td>
                    <td className="num py-1.5 text-ink-muted">{pct(h.volatility, 0)}</td>
                    <td className="num py-1.5 text-ink-muted">{num(h.beta)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {r.holdings.length > top.length && (
            <p className="mt-1 text-[12px] text-ink-muted">and {r.holdings.length - top.length} smaller holdings</p>
          )}
        </Section>

        <Section
          id="risk-correlation"
          title="How your largest holdings move together"
          note="Correlation of daily returns: 1 means they rise and fall together, 0 unrelated, below 0 opposite. Holdings that move together add little protection to each other."
        >
          {r.correlation.names.length >= 2 ? (
            <Heatmap
              rows={shortLabels(r.correlation.names, 3, 22)}
              rowNames={r.correlation.names}
              cols={labels}
              colNames={r.correlation.names}
              values={r.correlation.matrix}
              format={(v) => v.toFixed(2)}
              label="Correlation between your largest holdings"
              max={1}
              diverging
              valueLabel="correlation"
            />
          ) : (
            <p className="text-[14px] text-ink-muted">Needs at least two holdings with daily prices.</p>
          )}
        </Section>
      </div>
    </>
  )
}

function StatsRow({ label, s, strong = false }: { label: string; s: RiskStats; strong?: boolean }) {
  return (
    <tr className="border-b border-rule">
      <td className={`py-1.5 ${strong ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`num py-1.5 ${tone(s.return1y)} ${strong ? 'font-semibold' : ''}`}>{signed(s.return1y)}</td>
      <td className="num py-1.5">{pct(s.volatility)}</td>
      <td className="num py-1.5">{num(s.sharpe)}</td>
      <td className="num py-1.5">{num(s.sortino)}</td>
      <td className="num py-1.5">{signed(s.maxDrawdown?.depth ?? 0)}</td>
      <td className="num py-1.5 text-ink-muted">{s.beta === null ? '—' : num(s.beta)}</td>
    </tr>
  )
}

function Concentration({ r, family }: { r: RiskReport; family: boolean }) {
  if (!r.concentration.length || !r.concentration[0].holdings) return null
  return (
    <Section
      id="concentration"
      title="How concentrated the money is"
      note="By holding, across everything you own. The effective number is how many equal-sized holdings would be just as concentrated (1 ÷ the sum of squared shares)."
    >
      <div className={`grid grid-cols-1 gap-8 ${r.concentration.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {r.concentration.map((c) => {
          const largest = c.largest?.share ?? 0
          return (
            <div key={c.label}>
              {(family || r.concentration.length > 1) && <h3 className="mb-1 text-[15px] font-semibold">{c.label}</h3>}
              <p className="mb-3 text-[15px]">
                {c.holdings} holdings, as concentrated as{' '}
                <strong className="num">{c.effectiveHoldings.toFixed(1)}</strong> equal ones.
                {c.largest && (
                  <span className="text-ink-muted">
                    {' '}
                    Largest: {c.largest.name} at {pct(c.largest.share, 0)}.
                  </span>
                )}
              </p>
              <StackBar
                label={`${c.label}: share of the money by holding rank`}
                format={(v) => pct(v, 0)}
                segments={[
                  { key: 'top1', label: 'Largest holding', value: largest, color: 'var(--series-1)' },
                  { key: 'next4', label: 'Next 4', value: c.top5Share - largest, color: 'var(--series-3)' },
                  { key: 'next5', label: 'Next 5', value: c.top10Share - c.top5Share, color: 'var(--series-4)' },
                  { key: 'rest', label: 'All the rest', value: 1 - c.top10Share, color: 'var(--series-other)' }
                ]}
              />
              <dl className="mt-2 flex flex-wrap gap-x-6 text-[13px] text-ink-muted">
                <div>
                  <dt className="inline">Top 5: </dt>
                  <dd className="num inline text-ink">{pct(c.top5Share, 0)}</dd>
                </div>
                <div>
                  <dt className="inline">Top 10: </dt>
                  <dd className="num inline text-ink">{pct(c.top10Share, 0)}</dd>
                </div>
                <div>
                  <dt className="inline">Rest: </dt>
                  <dd className="num inline text-ink">{pct(1 - c.top10Share, 0)}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[12px] text-ink-muted">A fund counts as one holding here; the Funds page shows the companies inside them.</p>
    </Section>
  )
}
