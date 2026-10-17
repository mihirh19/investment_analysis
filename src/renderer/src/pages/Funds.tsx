import { useMemo, useState } from 'react'
import type { FundPlan, FundsReport } from '@shared/types'
import { HBars } from '../components/charts'
import { Heatmap } from '../components/chart/extra'
import { FundComparisonsSection } from '../components/FundComparisons'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { useFunds } from '../lib/api'
import { compactMoney, money, shortDate, toneClass } from '../lib/format'
import { stagger } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'

const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`

const PLAN_LABEL: Record<FundPlan, string> = {
  DIRECT: 'Direct',
  REGULAR: 'Regular',
  NOT_STATED: 'Not stated',
  ETF: 'ETF'
}

function PlanBadge({ plan }: { plan: FundPlan }) {
  const tone =
    plan === 'REGULAR'
      ? 'border-warn/40 bg-warn-wash text-warn'
      : plan === 'DIRECT'
        ? 'border-gain/30 text-gain'
        : 'border-rule-strong text-ink-muted'
  return <span className={`rounded border px-1.5 py-px text-[12px] whitespace-nowrap ${tone}`}>{PLAN_LABEL[plan]}</span>
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
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

/** Short, unique axis labels for the heatmap columns. */
function columnLabels(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const words = n.replace(/\b(fund|etf|index|plan)\b/gi, '').trim().split(/\s+/)
    let s = words.slice(0, 2).join(' ')
    if (s.length > 16) s = s.slice(0, 15) + '…'
    const k = seen.get(s) ?? 0
    seen.set(s, k + 1)
    return k ? `${s} ${k + 1}` : s
  })
}

export function Funds() {
  const { scope } = useScope()
  const q = useFunds(scopePersonId(scope))
  const r = q.data

  if (!r || r.funds.length === 0) {
    return (
      <>
        <PageHeader title="Funds" />
        <ErrorNote error={q.error} />
        {q.isLoading && <PageSkeleton />}
        {!q.isLoading && <p className="py-8 text-ink-muted">No mutual funds or ETFs yet. Import a CAS to see how your funds compare.</p>}
      </>
    )
  }
  return (
    <div className="[&_td+td]:pl-4 [&_th+th]:pl-4">
      <PageHeader title="Funds" />
      <ErrorNote error={q.error} />
      <FundsBody r={r} family={scope === 'family'} personId={scopePersonId(scope)} />
    </div>
  )
}

function FundsBody({ r, family, personId }: { r: FundsReport; family: boolean; personId?: number }) {
  const { portfolios, matrix, pairs } = r.overlap
  const fundPairs = pairs.filter((p) => p.a !== 0)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const pair = sel ? pairs.find((p) => (p.a === sel.a && p.b === sel.b) || (p.a === sel.b && p.b === sel.a)) : (fundPairs[0] ?? pairs[0])
  const labelOf = (id: number) => portfolios.find((p) => p.id === id)?.label ?? ''
  const regular = r.funds.filter((f) => f.plan === 'REGULAR')
  const extra = regular.reduce((s, f) => s + Math.max(0, f.directPlan?.extraCostInr ?? 0), 0)
  const cols = useMemo(() => columnLabels(portfolios.map((p) => p.label)), [portfolios])
  const top = fundPairs[0]

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
        {(
          [
            ['In funds and ETFs', money(r.totalFundsInr), `${r.funds.length} fund${r.funds.length === 1 ? '' : 's'}`],
            ['Fund houses', String(r.byHouse.filter((h) => h.name !== 'Not known').length), r.byHouse[0] ? `largest: ${r.byHouse[0].name}` : ''],
            ['Biggest overlap', top ? pct(top.overlap) : '—', top ? `${labelOf(top.a)} & ${labelOf(top.b)}` : 'needs two fund portfolios'],
            [
              'Regular plans',
              regular.length ? String(regular.length) : 'None',
              regular.length ? (extra > 0 ? `about ${money(extra)} a year more than Direct` : 'cost not known yet') : 'all Direct or ETF'
            ]
          ] as const
        ).map(([k, v, sub], i) => (
          <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 60)}>
            <dt className="text-[13px] text-ink-muted">{k}</dt>
            <dd className="wide text-[20px] font-semibold">{v}</dd>
            <dd className="truncate text-[12px] text-ink-muted" title={sub}>
              {sub}
            </dd>
          </div>
        ))}
      </dl>

      {r.notes.length > 0 && (
        <Section id="notes" title="What stands out">
          <ul className="max-w-[90ch] list-disc space-y-1 pl-5 text-[15px]">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        id="overlap"
        title="How much your funds overlap"
        note="The share of each pair's money in the same companies and bonds (adding the smaller weight of each one they share), from the latest monthly portfolios. Above about 50%, the second fund adds little variety. Click a square to see what they share."
      >
        {portfolios.length >= 2 ? (
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Heatmap
              rows={portfolios.map((p) => p.label)}
              cols={cols}
              colNames={portfolios.map((p) => p.label)}
              values={matrix}
              format={(v) => pct(v)}
              label="Overlap between your funds"
              max={Math.max(0.5, ...matrix.flat().filter((v): v is number => v !== null))}
              onSelect={(a, b) => setSel({ a: portfolios[a].id, b: portfolios[b].id })}
            />
            {pair && (
              <div>
                <h3 className="text-[15px] font-semibold">
                  {labelOf(pair.a)} & {labelOf(pair.b)}
                </h3>
                <p className="mb-2 text-[13px] text-ink-muted">
                  {pct(pair.overlap)} overlap · {pair.sharedCount} holding{pair.sharedCount === 1 ? '' : 's'} in common
                </p>
                {pair.shared.length ? (
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                        <th className="py-1.5 font-medium">Holding</th>
                        <th className="num py-1.5 font-medium" title={labelOf(pair.a)}>
                          {cols[portfolios.findIndex((p) => p.id === pair.a)]}
                        </th>
                        <th className="num py-1.5 font-medium" title={labelOf(pair.b)}>
                          {cols[portfolios.findIndex((p) => p.id === pair.b)]}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pair.shared.slice(0, 12).map((s) => (
                        <tr key={s.isin ?? s.name} className="border-b border-rule">
                          <td className="max-w-[260px] truncate py-1.5" title={s.name}>
                            {s.name}
                          </td>
                          <td className="num py-1.5">{pct(s.weightA, 1)}</td>
                          <td className="num py-1.5">{pct(s.weightB, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[14px] text-ink-muted">Nothing in common.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[14px] text-ink-muted">
            Needs at least two funds with a monthly portfolio. Portfolios are fetched from the fund houses with the daily
            refresh; you can also import one under Import statements.
          </p>
        )}
      </Section>

      <FundComparisonsSection personId={personId} />

      <Section id="list" title="Every fund" note="Regular plans pay the distributor from the fund's returns every year. The cost shown is last year's return gap against the Direct plan of the same scheme, on today's value.">
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Fund</th>
                <th className="py-1.5 font-medium">Category</th>
                <th className="py-1.5 font-medium">Plan</th>
                <th className="num py-1.5 font-medium">Value</th>
                <th className="py-1.5 font-medium">Portfolio as of</th>
                <th className="num py-1.5 font-medium">Regular costs you</th>
              </tr>
            </thead>
            <tbody>
              {r.funds.map((f) => (
                <tr key={f.instrumentId} className="border-b border-rule">
                  <td className="py-1.5">
                    {f.shortName}
                    <div className="text-[12px] text-ink-muted">
                      {f.fundHouse ?? 'Fund house not known'}
                      {family && f.people.length ? ` · ${f.people.join(', ')}` : ''}
                    </div>
                  </td>
                  <td className="py-1.5 text-[14px]">
                    {f.category}
                    <div className="text-[12px] text-ink-muted">{f.categoryGroup}</div>
                  </td>
                  <td className="py-1.5">
                    <PlanBadge plan={f.plan} />
                  </td>
                  <td className="num py-1.5">{money(f.valueInr)}</td>
                  <td className="py-1.5 text-[14px] text-ink-muted">
                    {f.holdingsAsOf ? `${shortDate(f.holdingsAsOf)} · ${f.holdingsCount} holdings` : 'Not yet'}
                  </td>
                  <td className="num py-1.5">
                    {f.plan !== 'REGULAR' ? (
                      <span className="text-ink-muted">—</span>
                    ) : f.directPlan?.extraCostInr != null ? (
                      <span className={toneClass(-(f.directPlan.extraCostInr))} title={f.directPlan.name ?? undefined}>
                        {money(Math.max(0, f.directPlan.extraCostInr))}/yr
                        <span className="ml-1 text-[12px] text-ink-muted">({pct(f.directPlan.gap1y, 2)})</span>
                      </span>
                    ) : (
                      <span className="text-[13px] text-ink-muted">{f.directPlan?.code ? 'needs a year of NAVs' : 'Direct plan not found'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-x-12 xl:grid-cols-2">
        <Section id="houses" title="By fund house" note="One fund house running most of your money concentrates its investment style and its operational risk.">
          <HBars
            label="Fund money by fund house"
            series={[{ label: 'Value', color: 'var(--series-1)' }]}
            format={(v) => `${compactMoney(v)}  ${pct(v / r.totalFundsInr)}`}
            rows={r.byHouse.map((h) => ({ key: h.name, label: h.name, sublabel: h.funds.length > 1 ? `${h.funds.length} funds` : undefined, values: [h.valueInr] }))}
          />
        </Section>
        <Section id="categories" title="By category" note="Several funds in one category usually own much the same companies.">
          <HBars
            label="Fund money by category"
            series={[{ label: 'Value', color: 'var(--series-3)' }]}
            format={(v) => `${compactMoney(v)}  ${pct(v / r.totalFundsInr)}`}
            rows={r.byCategory.map((c) => ({
              key: `${c.group}|${c.name}`,
              label: c.name,
              sublabel: c.funds.length > 1 ? `${c.funds.length} funds` : c.group,
              values: [c.valueInr]
            }))}
          />
        </Section>
      </div>

      {r.companies.length > 0 && (
        <Section
          id="companies"
          title="Companies you reach more than one way"
          note="Your own shares plus your slice of every fund that holds the company. Holding a stock directly and through three funds is more concentrated than it looks."
        >
          <HBars
            label="Companies by combined exposure"
            series={[
              { label: 'Held directly', color: 'var(--series-2)' },
              { label: 'Through funds', color: 'var(--series-1)' }
            ]}
            format={(v) => compactMoney(v)}
            rows={r.companies.slice(0, 15).map((c) => {
              const funds = c.sources.filter((s) => s.label !== 'Held directly').length
              return {
                key: c.isin ?? c.name,
                label: c.name,
                sublabel: `${funds} fund${funds === 1 ? '' : 's'}${c.directInr > 0 ? ' + direct' : ''}`,
                values: [c.directInr, c.valueInr - c.directInr]
              }
            })}
          />
        </Section>
      )}
    </>
  )
}
