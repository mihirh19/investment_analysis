import { useState } from 'react'
import type { PhoneExposure, PhoneFunds, PhonePerformance, PhoneRebalance } from '@shared/phone'
import type { Bucket } from '@shared/types'
import { CAP_COLORS, CAP_LABELS, DEBT_TYPE_LABELS, RATING_LABELS } from '../../../src/renderer/src/lib/labels'
import { useData } from '../lib/data'
import { Card, day, inr, lakhCrore, Seg } from '../ui'
import { ScopePicker, useScopeKey } from './Home'

type Part = 'returns' | 'sectors' | 'funds' | 'mix'

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`)
const pctTone = (v: number | null | undefined) => (!v ? 'text-ink-muted' : v > 0 ? 'text-gain' : 'text-loss')
const PERIOD: Record<string, string> = { '1Y': '1 year', '3Y': '3 years', '5Y': '5 years', ALL: 'Since start' }
const BUCKETS: Record<Bucket, string> = {
  EQUITY_IN: 'Indian equity',
  EQUITY_INTL: 'International equity',
  DEBT: 'Debt',
  GOLD: 'Gold & silver',
  CASH: 'Cash'
}
const CAPS: Record<'LARGE' | 'MID' | 'SMALL' | 'OTHER', string> = { LARGE: 'Large cap', MID: 'Mid cap', SMALL: 'Small cap', OTHER: 'Other' }

/** "How it is doing": returns, sectors, funds and the mix against its targets. */
export function Doing() {
  const { snapshot } = useData()
  const [scope, setScope] = useScopeKey()
  const [part, setPart] = useState<Part>(() => (sessionStorage.getItem('fp.doing') as Part) || 'returns')
  if (!snapshot) return null
  const s = snapshot.scopes[scope] ?? snapshot.scopes.family
  const parts = (
    [
      ['returns', 'Returns', s.performance],
      ['sectors', 'Sectors', s.exposure],
      ['funds', 'Funds', s.funds],
      ['mix', 'Mix', s.rebalance]
    ] as const
  ).filter(([, , d]) => d)
  const shown = parts.find(([k]) => k === part)?.[0] ?? parts[0]?.[0]
  const choose = (p: Part) => (sessionStorage.setItem('fp.doing', p), setPart(p))

  return (
    <>
      <ScopePicker value={scope} onChange={setScope} />
      {parts.length === 0 ? (
        <Card>
          <p className="text-[15px] text-ink-muted">Nothing here yet for this person. Sync from the computer (version 0.17 or later).</p>
        </Card>
      ) : (
        <>
          {parts.length > 1 && (
            <div className="mb-3">
              <Seg label="Which part" value={shown!} onChange={choose} options={parts.map(([value, label]) => ({ value, label }))} />
            </div>
          )}
          {shown === 'returns' && s.performance && <Returns p={s.performance} />}
          {shown === 'sectors' && s.exposure && <Sectors e={s.exposure} />}
          {shown === 'funds' && s.funds && <Funds f={s.funds} />}
          {shown === 'mix' && s.rebalance && <Mix r={s.rebalance} />}
        </>
      )}
    </>
  )
}

/** Growth of ₹100: yours and the benchmark's, on one scale. */
function Growth({ g }: { g: PhonePerformance['growth'] }) {
  const mine = g.values
  const bench = g.benchmark?.values ?? []
  const all = [...mine, ...bench.filter((v): v is number => v !== null)].filter(Number.isFinite)
  if (mine.length < 2 || !all.length) return null
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const w = 320
  const h = 120
  const x = (i: number) => (i / (mine.length - 1)) * w
  const y = (v: number) => h - 6 - ((v - lo) / (hi - lo || 1)) * (h - 12)
  const path = (vs: (number | null)[]) =>
    vs.reduce((d, v, i) => (v === null || !Number.isFinite(v) ? d : `${d}${d === '' || vs[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '')
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Growth of ₹100 from ${day(g.dates[0])}: yours ${mine.at(-1)!.toFixed(0)}${g.benchmark ? `, ${g.benchmark.label} ${bench.at(-1)?.toFixed(0) ?? '—'}` : ''}`}>
        {g.benchmark && <path d={path(bench)} fill="none" stroke="var(--ink-muted)" strokeWidth="1.5" strokeDasharray="4 3" />}
        <path d={path(mine)} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[var(--series-1)]" aria-hidden />
          You: ₹100 became ₹{mine.at(-1)!.toFixed(0)}
        </span>
        {g.benchmark && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-ink-muted" aria-hidden />
            {g.benchmark.label}: ₹{bench.at(-1)?.toFixed(0) ?? '—'}
          </span>
        )}
      </figcaption>
    </figure>
  )
}

function Returns({ p }: { p: PhonePerformance }) {
  const [kind, setKind] = useState<'FY' | 'CY'>('FY')
  const bench = p.benchmarks[0]
  const years = p.years.filter((y) => y.kind === kind)
  return (
    <>
      <Card title="Returns" aside={`covers ${pct(p.coverage, 0)} of your money`}>
        <div className="mb-3 flex items-baseline gap-2">
          <span className={`wide num text-[32px] leading-tight font-semibold ${pctTone(p.xirr)}`}>{pct(p.xirr)}</span>
          <span className="text-[13px] text-ink-muted">a year (XIRR)</span>
        </div>
        <table className="num w-full text-[14px]">
          <thead>
            <tr className="text-[12px] text-ink-muted">
              <th className="py-1 text-left font-normal">Time-weighted</th>
              <th className="py-1 text-right font-normal">You</th>
              {bench && <th className="py-1 text-right font-normal">{bench.label}</th>}
            </tr>
          </thead>
          <tbody>
            {p.trailing.map((t) => (
              <tr key={t.key} className="border-t border-rule">
                <td className="py-1.5 text-left">
                  {PERIOD[t.key]}
                  {t.key !== '1Y' && <span className="text-[11px] text-ink-muted"> a year</span>}
                </td>
                <td className={`py-1.5 text-right ${pctTone(t.twr)}`}>{pct(t.twr)}</td>
                {bench && <td className="py-1.5 text-right text-ink-muted">{pct(t.benchmarks[bench.key])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3">
          <Growth g={p.growth} />
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">Past returns don&rsquo;t say what comes next.</p>
      </Card>

      {years.length > 0 && (
        <Card title="By year">
          <div className="mb-2">
            <Seg
              label="Kind of year"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'FY', label: 'Financial years' },
                { value: 'CY', label: 'Calendar years' }
              ]}
            />
          </div>
          <ul>
            {years.map((y, i) => (
              <li key={y.label} className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-0">
                <div>
                  <div className="text-[15px]">
                    {y.label}
                    {/* Newest first: a partial newest year is still running; a partial oldest one is where the records start. */}
                    {y.partial && <span className="text-[12px] text-ink-muted">{i === 0 ? ' so far' : ' part year'}</span>}
                  </div>
                  <div className="text-[12px] text-ink-muted">
                    Gain {lakhCrore(y.gain)}, put in {lakhCrore(y.added)}
                  </div>
                </div>
                <div className="num text-right">
                  <div className={`text-[15px] font-semibold ${pctTone(y.twr)}`}>{pct(y.twr)}</div>
                  {bench && <div className="text-[12px] text-ink-muted">{bench.label} {pct(y.benchmarks[bench.key])}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {p.maxDrawdown && (
        <Card title="Worst fall">
          <div className="num text-left text-[22px] font-semibold text-loss">{pct(p.maxDrawdown.depth)}</div>
          <p className="text-[14px] text-ink-muted">
            From {day(p.maxDrawdown.peak)} to {day(p.maxDrawdown.trough)};{' '}
            {p.maxDrawdown.recovered ? `back to the old high by ${day(p.maxDrawdown.recovered)}.` : 'not back to the old high yet.'}
          </p>
        </Card>
      )}

      {p.byAccount.length > 0 && (
        <Card title="By account" aside="XIRR">
          <ul>
            {[...p.byAccount]
              .sort((a, b) => b.valueInr - a.valueInr)
              .map((a, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[15px]">{a.label}</div>
                    <div className="text-[12px] text-ink-muted">
                      {a.personName}, {lakhCrore(a.valueInr)}
                    </div>
                  </div>
                  <div className={`num shrink-0 text-[15px] ${pctTone(a.xirr)}`}>{pct(a.xirr)}</div>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {p.holdings.length > 0 && (
        <Card title="Largest holdings" aside="XIRR">
          <ul>
            {p.holdings.slice(0, 20).map((h, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{h.name}</div>
                  <div className="text-[12px] text-ink-muted">
                    {h.personName}, {lakhCrore(h.valueInr)}
                    {h.gainInr !== null ? `, gain ${lakhCrore(h.gainInr)}` : ''}
                  </div>
                </div>
                <div className={`num shrink-0 text-[15px] ${pctTone(h.xirr)}`}>{pct(h.xirr)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

/** A share bar with an optional marker (the market's share, or a target). */
function ShareBar({ share, marker, color = 'var(--series-1)' }: { share: number; marker?: number | null; color?: string }) {
  return (
    <div className="relative mt-1 h-2 rounded-full bg-rule/60" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
      {marker !== null && marker !== undefined && <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `calc(${Math.min(100, marker * 100)}% - 1px)` }} />}
    </div>
  )
}

function Sectors({ e }: { e: PhoneExposure }) {
  const [all, setAll] = useState(false)
  const sectors = [...e.sectors].sort((a, b) => b.valueInr - a.valueInr)
  const capTotal = e.marketCap.reduce((s, m) => s + m.valueInr, 0)
  const hasMarket = sectors.some((s) => s.marketShare !== null)
  return (
    <>
      {sectors.length > 0 && (
        <Card title="Equity by sector" aside={lakhCrore(e.equityInr)}>
          {hasMarket && (
            <p className="mb-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
              <span className="inline-block h-3 w-0.5 rounded bg-ink" aria-hidden /> the Nifty 500&rsquo;s share
            </p>
          )}
          <ul>
            {(all ? sectors : sectors.slice(0, 10)).map((s) => (
              <li key={s.sector} className="py-1.5">
                <div className="flex justify-between gap-3 text-[15px]">
                  <span className="min-w-0 truncate">{s.sector}</span>
                  <span className="num shrink-0">
                    {pct(s.share, 0)} <span className="text-[12px] text-ink-muted">{lakhCrore(s.valueInr)}</span>
                  </span>
                </div>
                <ShareBar share={s.share} marker={s.marketShare} />
                <div className="mt-0.5 text-[12px] text-ink-muted">
                  {s.directInr > 0 && `Direct ${lakhCrore(s.directInr)}`}
                  {s.directInr > 0 && s.viaFundsInr > 0 && ', '}
                  {s.viaFundsInr > 0 && `through funds ${lakhCrore(s.viaFundsInr)}`}
                  {s.marketShare !== null && `; Nifty 500 ${pct(s.marketShare, 0)}`}
                </div>
              </li>
            ))}
          </ul>
          {sectors.length > 10 && (
            <button className="mt-1 min-h-10 text-[14px] text-stamp" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show all ${sectors.length}`}
            </button>
          )}
        </Card>
      )}

      {capTotal > 0 && (
        <Card title="Large, mid and small cap">
          <div className="mb-2 flex h-3 overflow-hidden rounded-full" aria-hidden>
            {e.marketCap.map((m) => (
              <div key={m.cap} style={{ width: `${(m.valueInr / capTotal) * 100}%`, background: CAP_COLORS[m.cap] }} />
            ))}
          </div>
          <ul>
            {e.marketCap.map((m) => (
              <li key={m.cap} className="flex items-center justify-between py-1 text-[15px]">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CAP_COLORS[m.cap] }} aria-hidden />
                  {CAP_LABELS[m.cap].label}
                </span>
                <span className="num">
                  {lakhCrore(m.valueInr)} <span className="text-[12px] text-ink-muted">{pct(m.valueInr / capTotal, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {e.debt.totalInr > 0 && (
        <Card title="Debt" aside={lakhCrore(e.debt.totalInr)}>
          <h3 className="mb-1 text-[13px] text-ink-muted">By type</h3>
          <ul className="mb-3">
            {e.debt.types.map((t) => (
              <li key={t.type} className="flex justify-between py-1 text-[15px]">
                <span>{DEBT_TYPE_LABELS[t.type]}</span>
                <span className="num">
                  {lakhCrore(t.valueInr)} <span className="text-[12px] text-ink-muted">{pct(t.valueInr / e.debt.totalInr, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
          <h3 className="mb-1 text-[13px] text-ink-muted">By credit rating</h3>
          <ul>
            {e.debt.ratings.map((r) => (
              <li key={r.rating} className="flex justify-between py-1 text-[15px]">
                <span>{RATING_LABELS[r.rating].label}</span>
                <span className="num">
                  {lakhCrore(r.valueInr)} <span className="text-[12px] text-ink-muted">{pct(r.valueInr / e.debt.totalInr, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {e.companies.length > 0 && (
        <Card title="Largest companies" aside="direct and through funds">
          <ul>
            {e.companies.slice(0, 20).map((c, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{c.name}</div>
                  <div className="truncate text-[12px] text-ink-muted">
                    {c.sector ?? 'Sector not known'}
                    {c.viaFundsInr > 0 ? `, ${lakhCrore(c.viaFundsInr)} through funds` : ''}
                  </div>
                </div>
                <div className="num shrink-0 text-[15px]">{lakhCrore(c.valueInr)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

const PLAN: Record<PhoneFunds['funds'][number]['plan'], string> = { DIRECT: 'Direct', REGULAR: 'Regular', NOT_STATED: 'Plan not stated', ETF: 'ETF' }

function Funds({ f }: { f: PhoneFunds }) {
  const funds = [...f.funds].sort((a, b) => b.valueInr - a.valueInr)
  const catTotal = f.byCategory.reduce((s, c) => s + c.valueInr, 0)
  return (
    <>
      <Card title="Your funds" aside={lakhCrore(f.totalInr)}>
        {f.regularExtraCostInr > 0 && (
          <p className="mb-2 rounded-xl bg-warn-wash px-3 py-2 text-[14px]">
            Regular plans cost about <b className="num">{inr(f.regularExtraCostInr)}</b> a year more than the same funds&rsquo; Direct plans.
          </p>
        )}
        <ul>
          {funds.map((x, i) => (
            <li key={i} className="border-b border-rule py-2 last:border-0">
              <div className="flex justify-between gap-3">
                <div className="min-w-0 truncate text-[15px]">{x.name}</div>
                <div className="num shrink-0 text-[15px]">{lakhCrore(x.valueInr)}</div>
              </div>
              <div className="text-[12px] text-ink-muted">
                {x.category}
                {PLAN[x.plan] !== x.category ? `, ${PLAN[x.plan]}` : ''}
                {x.people.length > 1 ? `, ${x.people.join(' & ')}` : ''}
              </div>
              {(x.ter !== null || x.r3y !== null || x.extraCostInr) && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
                  {x.ter !== null && <span className="text-ink-muted">Expense ratio {x.ter.toFixed(2)}%</span>}
                  {x.r3y !== null && (
                    <span className="text-ink-muted">
                      3 years <span className={pctTone(x.r3y)}>{x.r3y.toFixed(1)}%</span>
                      {x.benchmark3y !== null && ` vs benchmark ${x.benchmark3y.toFixed(1)}%`}
                    </span>
                  )}
                  {x.extraCostInr ? <span className="text-warn">Regular costs {inr(x.extraCostInr)} a year more</span> : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {f.overlap.length > 0 && (
        <Card title="Funds holding the same companies">
          <ul>
            {f.overlap.map((o, i) => (
              <li key={i} className="border-b border-rule py-2 last:border-0">
                <div className="flex justify-between gap-3 text-[15px]">
                  <span className="min-w-0">
                    {o.a} <span className="text-ink-muted">and</span> {o.b}
                  </span>
                  <span className="num shrink-0 font-semibold">{pct(o.overlap, 0)}</span>
                </div>
                <ShareBar share={o.overlap} color="var(--warn)" />
                <div className="mt-0.5 text-[12px] text-ink-muted">
                  {o.sharedCount} companies in both{o.shared.length ? `: ${o.shared.join(', ')}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {catTotal > 0 && (
        <Card title="By category">
          <ul>
            {[...f.byCategory]
              .sort((a, b) => b.valueInr - a.valueInr)
              .map((c) => (
                <li key={c.name} className="py-1.5">
                  <div className="flex justify-between text-[15px]">
                    <span>{c.name}</span>
                    <span className="num">
                      {lakhCrore(c.valueInr)} <span className="text-[12px] text-ink-muted">{pct(c.valueInr / catTotal, 0)}</span>
                    </span>
                  </div>
                  <ShareBar share={c.valueInr / catTotal} />
                </li>
              ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function Mix({ r }: { r: PhoneRebalance }) {
  const hasTargets = r.buckets.some((b) => b.target !== null)
  const status = (share: number, target: number | null, st?: string) => {
    if (target === null) return null
    const diff = (share - target) * 100
    const word = st === 'OVER' ? 'above' : st === 'UNDER' ? 'below' : 'on target'
    return (
      <span className={st === 'OVER' || st === 'UNDER' ? 'text-warn' : 'text-gain'}>
        {word === 'on target' ? 'On target' : `${Math.abs(diff).toFixed(1)} pts ${word}`} (target {pct(target, 0)})
      </span>
    )
  }
  return (
    <>
      <Card title="Your mix" aside={lakhCrore(r.baseInr)}>
        {!hasTargets && <p className="mb-2 text-[14px] text-ink-muted">No target mix set yet. Set one on the computer, on the Rebalance page.</p>}
        {hasTargets && r.targetSource === 'FAMILY' && <p className="mb-2 text-[13px] text-ink-muted">Using the family&rsquo;s targets.</p>}
        <ul>
          {r.buckets.map((b) => (
            <li key={b.bucket} className="py-1.5">
              <div className="flex justify-between gap-3 text-[15px]">
                <span>{BUCKETS[b.bucket]}</span>
                <span className="num">
                  {pct(b.share, 0)} <span className="text-[12px] text-ink-muted">{lakhCrore(b.valueInr)}</span>
                </span>
              </div>
              <ShareBar share={b.share} marker={b.target} />
              <div className="mt-0.5 text-[12px]">{status(b.share, b.target, b.status)}</div>
            </li>
          ))}
        </ul>
        {hasTargets && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="inline-block h-3 w-0.5 rounded bg-ink" aria-hidden /> target
          </p>
        )}
      </Card>

      {r.caps.some((c) => c.band !== 'OTHER' && c.valueInr > 0) && (
        <Card title="Indian equity by size">
          <ul>
            {r.caps.map((c) => (
              <li key={c.band} className="py-1.5">
                <div className="flex justify-between text-[15px]">
                  <span>{CAPS[c.band]}</span>
                  <span className="num">
                    {pct(c.share, 0)} <span className="text-[12px] text-ink-muted">{lakhCrore(c.valueInr)}</span>
                  </span>
                </div>
                <ShareBar share={c.share} marker={c.target} />
                {c.target !== null && <div className="mt-0.5 text-[12px] text-ink-muted">Target {pct(c.target, 0)}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="px-1 pb-2 text-[12px] text-ink-muted">Amounts to move towards the targets are worked out on the computer (Rebalance page).</p>
    </>
  )
}
