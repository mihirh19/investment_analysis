import { OWNER_GROUPS, OWNER_LABEL, quarterLabel, type OwnerGroup, type ShpQuarter } from '@shared/research'
import { ErrorNote } from './Shell'
import { Columns, StackBar } from './charts'
import { useOwnership } from '../lib/api'
import { shortDate, units } from '../lib/format'

// Fixed order, so a group keeps its colour on every company.
export const OWNER_COLOR: Record<OwnerGroup, string> = {
  promoter: 'var(--series-1)',
  fpi: 'var(--series-2)',
  mf: 'var(--series-3)',
  insurance: 'var(--series-4)',
  otherDii: 'var(--series-5)',
  retail: 'var(--series-6)',
  hni: 'var(--series-7)',
  corporate: 'var(--series-8)',
  other: 'var(--series-other)'
}

const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`)
/** A change in percentage points, signed, coloured only by direction. */
function Points({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink-muted">—</span>
  const p = v * 100
  if (Math.abs(p) < 0.005) return <span className="text-ink-muted">0.00</span>
  return <span className={p > 0 ? 'text-gain' : 'text-loss'}>{`${p > 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}`}</span>
}

/** Who owns the company, quarter by quarter, from the shareholding patterns it files with NSE. */
export function Ownership({ symbol, name }: { symbol: string; name: string }) {
  const q = useOwnership(symbol)
  const o = q.data
  if (q.error) return <ErrorNote error={q.error} />
  if (!o) return <p className="text-ink-muted">Opening the shareholding patterns…</p>
  if (o.quarters.length === 0)
    return <p className="text-ink-muted">{o.waiting ? `Fetching ${name}’s shareholding patterns from NSE…` : `NSE has no shareholding patterns for ${name}.`}</p>

  const detailed = o.quarters.filter((x): x is ShpQuarter & { groups: Record<OwnerGroup, number> } => x.groups !== null)
  const [now, prev] = detailed
  const yearAgo = detailed.find((x) => now && x.asOf.slice(0, 4) === String(Number(now.asOf.slice(0, 4)) - 1) && x.asOf.slice(5) === now.asOf.slice(5))
  const history = [...o.quarters].reverse().filter((x) => x.promoter !== null)

  return (
    <div className="space-y-8">
      {o.waiting && <p className="text-[13px] text-ink-muted">Still reading the latest patterns from NSE; this fills in as they arrive.</p>}

      {now && (
        <section aria-labelledby="own-now">
          <h3 id="own-now" className="mb-1 text-[15px] font-semibold">
            Who owns {name}, {quarterLabel(now.asOf)}
          </h3>
          <p className="mb-3 text-[13px] text-ink-muted">
            Share of all shares{now.shareholders ? `, among ${units(now.shareholders)} shareholders` : ''}
            {prev?.shareholders && now.shareholders ? ` (${now.shareholders >= prev.shareholders ? 'up' : 'down'} from ${units(prev.shareholders)} a quarter before)` : ''}.
            Filed {shortDate(now.filedAt)}.
          </p>
          <StackBar
            label={`Shareholding of ${name}`}
            format={(v) => pct(v)}
            segments={OWNER_GROUPS.map((g) => ({ key: g, label: OWNER_LABEL[g], value: now.groups[g], color: OWNER_COLOR[g] }))}
          />
          <table className="mt-3 w-full max-w-[760px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                <th className="py-1 text-left font-medium">Held by</th>
                <th className="px-2 text-right font-medium">Share</th>
                <th className="px-2 text-right font-medium">{prev ? `Change since ${quarterLabel(prev.asOf)}` : 'Change'}</th>
                <th className="px-2 text-right font-medium">Change in a year</th>
              </tr>
            </thead>
            <tbody>
              {OWNER_GROUPS.map((g) => (
                <tr key={g} className="border-b border-rule">
                  <td className="py-1">
                    <span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: OWNER_COLOR[g] }} />
                    {OWNER_LABEL[g]}
                  </td>
                  <td className="num px-2">{pct(now.groups[g])}</td>
                  <td className="num px-2">
                    <Points v={prev ? now.groups[g] - prev.groups[g] : null} />
                  </td>
                  <td className="num px-2">
                    <Points v={yearAgo ? now.groups[g] - yearAgo.groups[g] : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-ink-muted">Changes are in percentage points.</p>
        </section>
      )}

      {detailed.length > 1 && (
        <section aria-labelledby="own-quarters">
          <h3 id="own-quarters" className="mb-2 text-[15px] font-semibold">
            Quarter by quarter
          </h3>
          <div className="overflow-x-auto">
            <table className="text-[13px]">
              <thead>
                <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                  <th className="py-1 pr-3 text-left font-medium">Quarter</th>
                  {OWNER_GROUPS.map((g) => (
                    <th key={g} className="px-2 text-right font-medium" title={OWNER_LABEL[g]}>
                      {SHORT[g]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detailed.map((x) => (
                  <tr key={x.asOf} className="border-b border-rule">
                    <td className="py-1 pr-3">{quarterLabel(x.asOf)}</td>
                    {OWNER_GROUPS.map((g) => (
                      <td key={g} className="num px-2">
                        {pct(x.groups[g])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">{OWNER_GROUPS.map((g) => `${SHORT[g]}: ${OWNER_LABEL[g]}`).join('; ')}.</p>
        </section>
      )}

      {history.length > 2 && (
        <section aria-labelledby="own-promoter">
          <h3 id="own-promoter" className="mb-2 text-[15px] font-semibold">
            Promoters’ share since {quarterLabel(history[0].asOf)}
          </h3>
          <Columns
            label={`Promoters’ share of ${name}, by quarter`}
            seriesLabel="Promoters’ share"
            points={history.map((x) => ({ key: x.asOf, label: quarterLabel(x.asOf), value: (x.promoter ?? 0) * 100 }))}
            format={(v) => `${v.toFixed(2)}%`}
            axisFormat={(v) => `${v.toFixed(0)}%`}
            height={180}
          />
        </section>
      )}

      {now?.holders && now.holders.length > 0 && (
        <section aria-labelledby="own-holders">
          <h3 id="own-holders" className="mb-1 text-[15px] font-semibold">
            Holders of 1% or more
          </h3>
          <p className="mb-2 text-[13px] text-ink-muted">As named in the pattern. Smaller holders aren’t listed by name.</p>
          <table className="w-full max-w-[760px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                <th className="py-1 text-left font-medium">Holder</th>
                <th className="px-2 text-left font-medium">Type</th>
                <th className="px-2 text-right font-medium">Share</th>
                <th className="px-2 text-right font-medium">{prev ? `Since ${quarterLabel(prev.asOf)}` : 'Change'}</th>
              </tr>
            </thead>
            <tbody>
              {now.holders.map((h) => {
                const before = prev?.holders?.find((p) => p.name.toLowerCase() === h.name.toLowerCase())
                return (
                  <tr key={`${h.kind}|${h.name}`} className="border-b border-rule">
                    <td className="py-1">{h.name}</td>
                    <td className="px-2 text-ink-muted">{h.kind}</td>
                    <td className="num px-2">{pct(h.share)}</td>
                    <td className="num px-2">{prev?.holders ? before ? <Points v={h.share - before.share} /> : <span className="text-[12px] text-ink-muted">new</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-[12px] text-ink-muted">Source: shareholding patterns filed with NSE.</p>
    </div>
  )
}

const SHORT: Record<OwnerGroup, string> = {
  promoter: 'Prom',
  fpi: 'FPI',
  mf: 'MF',
  insurance: 'Ins',
  otherDii: 'DII oth',
  retail: 'Retail',
  hni: 'HNI',
  corporate: 'Corp',
  other: 'Other'
}
