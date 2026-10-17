import { useState } from 'react'
import type { SectorIndexStats, SectorProduct, SectorRow } from '@shared/insights'
import { useSectorInsights } from '../lib/api'
import { compactMoney, shortDate } from '../lib/format'

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`
const share = (v: number) => `${(v * 100).toFixed(1)}%`
const tone = (v: number | null | undefined) => (v === null || v === undefined ? '' : v > 0 ? 'text-gain' : v < 0 ? 'text-loss' : '')
const KIND: Record<SectorProduct['kind'], string> = { ETF: 'ETF', INDEX_FUND: 'Index fund', ACTIVE: 'Active fund' }

/** Where today's P/E sits among the index's own last ten years, as words a reader can check. */
function peWords(s: SectorIndexStats): string {
  if (s.pe === null || s.pePercentile === null) return '—'
  const p = Math.round(s.pePercentile * 100)
  return p <= 20 ? `lower than ${100 - p}% of the last 10 years` : p >= 80 ? `higher than ${p}% of the last 10 years` : `around its usual (${p}th percentile)`
}

/** A 0–100 track with today's P/E percentile marked. */
function PeTrack({ s }: { s: SectorIndexStats }) {
  if (s.pePercentile === null) return null
  const p = s.pePercentile * 100
  return (
    <span className="relative inline-block h-1.5 w-20 rounded-full bg-rule align-middle" title={peWords(s)} aria-hidden>
      <span className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-ink" style={{ left: `calc(${p}% - 2px)` }} />
    </span>
  )
}

function IndexCard({ s, market }: { s: SectorIndexStats; market: SectorIndexStats | null }) {
  return (
    <div className="rounded-md border border-rule bg-sheet p-3 text-[14px]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{s.name}</span>
        <span className="text-[12px] text-ink-muted">to {shortDate(s.asOf)}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-ink-muted">Returns a year</dt>
        <dd className="num">
          <span className={tone(s.r1y)}>{pct(s.r1y)}</span> 1y, <span className={tone(s.r3y)}>{pct(s.r3y)}</span> 3y,{' '}
          <span className={tone(s.r5y)}>{pct(s.r5y)}</span> 5y
        </dd>
        {market && market.key !== s.key && (
          <>
            <dt className="text-ink-muted">Nifty 500</dt>
            <dd className="num text-ink-muted">
              {pct(market.r1y)} 1y, {pct(market.r3y)} 3y, {pct(market.r5y)} 5y
            </dd>
          </>
        )}
        <dt className="text-ink-muted">P/E</dt>
        <dd className="num">
          {s.pe ?? '—'} <span className="text-ink-muted">(10-year median {s.peMedian10y ?? '—'})</span> <PeTrack s={s} />
        </dd>
        <dt className="text-ink-muted" />
        <dd className="text-[13px] text-ink-muted">{peWords(s)}</dd>
        <dt className="text-ink-muted">From 52-week high</dt>
        <dd className="num">{s.belowHigh > 0.001 ? `−${(s.belowHigh * 100).toFixed(1)}%` : 'at its high'}</dd>
      </dl>
    </div>
  )
}

function Products({ list }: { list: SectorProduct[] }) {
  const [all, setAll] = useState(false)
  if (list.length === 0)
    return <p className="text-[14px] text-ink-muted">No index fund, ETF or sector fund in AMFI&rsquo;s list follows these indices.</p>
  const shown = all ? list : list.slice(0, 8)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 font-medium">Fund or ETF</th>
              <th className="py-1.5 font-medium">Kind</th>
              <th className="num py-1.5 font-medium" title="Total expense ratio, % a year (Direct plan for funds)">Cost</th>
              <th className="num py-1.5 font-medium" title="Assets under management">Size</th>
              <th className="num py-1.5 font-medium">1y</th>
              <th className="num py-1.5 font-medium">3y</th>
              <th className="num py-1.5 font-medium">5y</th>
              <th className="num py-1.5 font-medium" title="1-year return minus its benchmark's: how closely it tracks">vs index 1y</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.name} className="border-b border-rule">
                <td className="py-1.5">
                  {p.name}
                  <div className="text-[12px] text-ink-muted">{p.benchmark}</div>
                </td>
                <td className="py-1.5 text-ink-muted">{KIND[p.kind]}</td>
                <td className="num py-1.5">{pct(p.ter, 2)}</td>
                <td className="num py-1.5">{p.aumCr !== null ? compactMoney(p.aumCr * 1e7) : '—'}</td>
                <td className={`num py-1.5 ${tone(p.r1y)}`}>{pct(p.r1y)}</td>
                <td className={`num py-1.5 ${tone(p.r3y)}`}>{pct(p.r3y)}</td>
                <td className={`num py-1.5 ${tone(p.r5y)}`}>{pct(p.r5y)}</td>
                <td className="num py-1.5 text-ink-muted">{p.vsBenchmark1y !== null ? `${p.vsBenchmark1y > 0 ? '+' : ''}${p.vsBenchmark1y.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 8 && (
        <button className="mt-2 text-[13px] text-stamp hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </>
  )
}

function SectorDetail({ row, market, onClose }: { row: SectorRow; market: SectorIndexStats | null; onClose: () => void }) {
  return (
    <div id="sector-market-detail" className="anim-pop mt-4 rounded-md border border-rule bg-paper p-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-[17px] font-semibold">{row.sector}</h3>
        <button className="text-[14px] text-stamp hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mb-3 text-[14px]">
        {share(row.mineShare)} of your Indian equity ({compactMoney(row.mineInr)}), against {share(row.marketShare)} of the
        Nifty 500.
      </p>
      {row.indices.length > 0 ? (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {row.indices.map((s) => (
            <IndexCard key={s.key} s={s} market={market} />
          ))}
        </div>
      ) : (
        <p className="mb-4 text-[14px] text-ink-muted">NSE has no sector index for this industry.</p>
      )}
      <h4 className="mb-2 text-[15px] font-semibold">Funds and ETFs that track it</h4>
      <Products list={row.products} />
      <p className="mt-3 text-[12px] text-ink-muted">
        Facts from AMFI and NSE, not a recommendation: past returns don&rsquo;t predict future ones, and a sector fund
        concentrates risk. Costs are for Direct plans (ETFs: the fund&rsquo;s own charge; brokerage is extra).
      </p>
    </div>
  )
}

export function SectorInsightsSection({ personId }: { personId?: number }) {
  const q = useSectorInsights(personId)
  const [open, setOpen] = useState<string | null>(null)
  const [sort, setSort] = useState<'pe' | 'r1y' | 'r5y' | 'name'>('pe')
  const d = q.data
  if (!d) return null
  const loaded = d.marketBasis && d.sectors.some((s) => s.marketShare > 0)
  const rows = d.sectors.filter((s) => s.marketShare >= 0.002 || s.mineShare >= 0.002)
  const max = Math.max(0.01, ...rows.map((s) => Math.abs(s.mineShare - s.marketShare)))
  const allIndices = [...new Map(d.sectors.flatMap((s) => s.indices).map((i) => [i.key, i])).values()]
  const sorted = [...allIndices].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'pe'
        ? (a.pePercentile ?? 2) - (b.pePercentile ?? 2)
        : (b[sort] ?? -1e9) - (a[sort] ?? -1e9)
  )
  const openRow = rows.find((r) => r.sector === open)

  return (
    <>
      <section aria-labelledby="vs-market" className="mt-12">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 id="vs-market" className="wide text-[19px] font-semibold">
            Your sectors against the market
          </h2>
          {d.marketBasis && <span className="text-[13px] text-ink-muted">Nifty 500, {d.marketBasis.members} companies</span>}
        </div>
        <p className="mb-4 max-w-[80ch] text-[14px] text-ink-muted">
          Each sector&rsquo;s share of your Indian equity (after looking inside funds) beside its share of the Nifty 500,
          weighted by market value. Neither more nor less than the market is right or wrong in itself; it shows where your
          money leans. Click a sector for its indices and the funds that track it.
        </p>
        {!loaded ? (
          <p className="text-[14px] text-ink-muted">The market&rsquo;s sector weights download with the next refresh.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                  <th className="py-1.5 font-medium">Sector</th>
                  <th className="num py-1.5 font-medium">Yours</th>
                  <th className="num py-1.5 font-medium">Nifty 500</th>
                  <th className="py-1.5 pl-6 font-medium">Under or over the market</th>
                  <th className="py-1.5 font-medium">Its P/E now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = r.mineShare - r.marketShare
                  const idx = r.indices[0]
                  const w = (Math.abs(diff) / max) * 50
                  return (
                    <tr
                      key={r.sector}
                      className={`cursor-pointer border-b border-rule hover:bg-sheet/60 ${open === r.sector ? 'bg-stamp-wash' : ''}`}
                      onClick={() => setOpen(open === r.sector ? null : r.sector)}
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(open === r.sector ? null : r.sector))}
                      aria-expanded={open === r.sector}
                    >
                      <td className="py-1.5">{r.sector}</td>
                      <td className="num py-1.5">{share(r.mineShare)}</td>
                      <td className="num py-1.5 text-ink-muted">{share(r.marketShare)}</td>
                      <td className="py-1.5 pl-6">
                        <div className="relative h-3 w-56" title={`${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)} points`}>
                          <div className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
                          <div
                            className="absolute inset-y-0 rounded-sm"
                            style={{
                              left: diff >= 0 ? '50%' : `${50 - w}%`,
                              width: `${w}%`,
                              background: diff >= 0 ? 'var(--series-1)' : 'var(--series-2)'
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 text-[13px] text-ink-muted">
                        {idx?.pe ? (
                          <span className="flex items-center gap-2">
                            <span className="num text-ink">{idx.pe}</span> <PeTrack s={idx} />
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {d.unknownInr > 0 && loaded && (
          <p className="mt-3 text-[13px] text-ink-muted">
            {compactMoney(d.unknownInr)} of equity isn&rsquo;t broken down by sector yet and is left out of &ldquo;Yours&rdquo;.
          </p>
        )}
        {openRow && <SectorDetail row={openRow} market={d.market} onClose={() => setOpen(null)} />}
      </section>

      {allIndices.length > 0 && (
        <section aria-labelledby="scoreboard" className="mt-12">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <h2 id="scoreboard" className="wide text-[19px] font-semibold">
              Sector scoreboard
            </h2>
            <label className="text-[13px] text-ink-muted">
              Sort by{' '}
              <select
                className="rounded-md border border-rule-strong bg-sheet px-2 py-1 text-ink"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="pe">P/E against its 10 years</option>
                <option value="r1y">1-year return</option>
                <option value="r5y">5-year return</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <p className="mb-4 max-w-[80ch] text-[14px] text-ink-muted">
            NSE&rsquo;s sector indices: what they returned, and how expensive they are now against their own last ten
            years. A low P/E for its history can mean cheap or can mean earnings expected to fall; a high one, the
            reverse. It records the past, not the future.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                  <th className="py-1.5 font-medium">Index</th>
                  <th className="num py-1.5 font-medium">1y</th>
                  <th className="num py-1.5 font-medium">3y a year</th>
                  <th className="num py-1.5 font-medium">5y a year</th>
                  <th className="num py-1.5 font-medium">P/E</th>
                  <th className="num py-1.5 font-medium">10y median</th>
                  <th className="py-1.5 pl-4 font-medium">Where P/E sits in 10 years</th>
                  <th className="num py-1.5 font-medium">From 52w high</th>
                </tr>
              </thead>
              <tbody>
                {d.market && (
                  <tr className="border-b border-rule-strong bg-sheet/60 font-medium">
                    <td className="py-1.5">{d.market.name} (the market)</td>
                    <td className={`num py-1.5 ${tone(d.market.r1y)}`}>{pct(d.market.r1y)}</td>
                    <td className={`num py-1.5 ${tone(d.market.r3y)}`}>{pct(d.market.r3y)}</td>
                    <td className={`num py-1.5 ${tone(d.market.r5y)}`}>{pct(d.market.r5y)}</td>
                    <td className="num py-1.5">{d.market.pe ?? '—'}</td>
                    <td className="num py-1.5">{d.market.peMedian10y ?? '—'}</td>
                    <td className="py-1.5 pl-4">
                      <PeTrack s={d.market} />
                    </td>
                    <td className="num py-1.5">{d.market.belowHigh > 0.001 ? `−${(d.market.belowHigh * 100).toFixed(1)}%` : 'at high'}</td>
                  </tr>
                )}
                {sorted.map((s) => (
                  <tr key={s.key} className="border-b border-rule">
                    <td className="py-1.5">{s.name}</td>
                    <td className={`num py-1.5 ${tone(s.r1y)}`}>{pct(s.r1y)}</td>
                    <td className={`num py-1.5 ${tone(s.r3y)}`}>{pct(s.r3y)}</td>
                    <td className={`num py-1.5 ${tone(s.r5y)}`}>{pct(s.r5y)}</td>
                    <td className="num py-1.5">{s.pe ?? '—'}</td>
                    <td className="num py-1.5 text-ink-muted">{s.peMedian10y ?? '—'}</td>
                    <td className="py-1.5 pl-4 text-[13px] text-ink-muted">
                      <span className="flex items-center gap-2">
                        <PeTrack s={s} />
                        {s.pePercentile !== null ? `${Math.round(s.pePercentile * 100)}th` : ''}
                      </span>
                    </td>
                    <td className="num py-1.5">{s.belowHigh > 0.001 ? `−${(s.belowHigh * 100).toFixed(1)}%` : 'at high'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            Price returns from niftyindices.com (dividends not included), to {d.indicesAsOf ? shortDate(d.indicesAsOf) : '—'}.
            Updated weekly.
          </p>
        </section>
      )}
    </>
  )
}
