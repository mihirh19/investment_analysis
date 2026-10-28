import { useMemo, useState } from 'react'
import type { FundDetail } from '@shared/fundScreener'
import type { TargetRange } from '@shared/fundPortfolio'
import { Columns } from './charts'

// The fund's portfolio period by period, the way investing apps lay it out: how it is split between
// shares, bonds and cash against what its category allows, its sectors in a chosen period, and one
// sector's share across the periods.

const periodLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }).replace(' ', " '")
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`

/** Colours for the sector bars, from the app's palette, cycling. */
const BAR = ['bg-stamp', 'bg-[#5b8def]', 'bg-[#e08a2e]', 'bg-[#8a5cc7]', 'bg-[#2fa3a3]', 'bg-[#d4566b]', 'bg-[#7a8a3a]', 'bg-[#b07d48]', 'bg-[#4a6b8a]', 'bg-[#9a9a9a]']

export function PortfolioView({ d }: { d: FundDetail }) {
  const p = d.portfolio!
  const periods = p.periods.slice(-6)
  const [at, setAt] = useState(periods.length - 1)
  const sel = periods[Math.min(at, periods.length - 1)]
  const sectorNames = useMemo(() => [...new Set(periods.flatMap((x) => x.sectors.map((s) => s.sector)))], [periods])
  const [sector, setSector] = useState<string | null>(null)
  const pickedSector = sector && sectorNames.includes(sector) ? sector : (sel.sectors[0]?.sector ?? sectorNames[0] ?? null)

  const tabs = (
    <div role="tablist" aria-label="Period" className="flex overflow-hidden rounded-lg border border-rule-strong text-[13px]">
      {periods.map((x, i) => (
        <button
          key={x.asOf}
          type="button"
          role="tab"
          aria-selected={i === at}
          onClick={() => setAt(i)}
          className={'px-3 py-1.5 whitespace-nowrap ' + (i === at ? 'bg-ink font-semibold text-paper' : 'text-ink-muted hover:bg-sheet hover:text-ink')}
        >
          {periodLabel(x.asOf)}
        </button>
      ))}
    </div>
  )

  const top = sel.sectors.slice(0, 9)
  const rest = sel.sectors.slice(9).reduce((a, s) => a + s.weight, 0)
  const bars = rest > 0.0005 ? [...top, { sector: 'Others', weight: rest }] : top
  const maxBar = Math.max(...bars.map((s) => s.weight), 0.0001)
  const maxAlloc = Math.max(...sel.alloc.map((a) => a.weight), 0.0001)

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold">Asset allocation</h2>
          {periods.length > 1 && tabs}
        </div>
        <div className={'grid gap-8 ' + (p.target ? '@3xl:grid-cols-2' : '')}>
          {p.target && <Target ranges={p.target} />}
          <div>
            <div className="mb-3 text-[12px] font-medium tracking-wide text-ink-muted uppercase">Actual, {periodLabel(sel.asOf)}</div>
            <ul className="space-y-3">
              {sel.alloc.map((a) => (
                <li key={a.label}>
                  <div className="mb-1 text-[13px]">{a.label}</div>
                  <div className="flex items-center gap-3">
                    <span aria-hidden className={'h-7 rounded-sm ' + (a.label === 'Equity' ? 'bg-[#e08a2e]' : a.label === 'Debt' ? 'bg-[#5b8def]' : 'bg-ink/70')} style={{ width: `${Math.max(0.5, (a.weight / maxAlloc) * 75)}%` }} />
                    <span className="num text-[13px] font-medium">{pct(a.weight)}</span>
                  </div>
                </li>
              ))}
              {!sel.alloc.length && <li className="text-[13px] text-ink-muted">Not given for this period.</li>}
            </ul>
          </div>
        </div>
      </section>

      {sectorNames.length > 0 && (
        <div className="grid gap-8 @3xl:grid-cols-2">
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold">Sector distribution</h2>
            </div>
            {periods.length > 1 && <div className="mb-4">{tabs}</div>}
            <ul className="space-y-2.5">
              {bars.map((s, i) => (
                <li key={s.sector}>
                  <button type="button" onClick={() => s.sector !== 'Others' && setSector(s.sector)} className="block w-full text-left" title={`Show ${s.sector} over time`}>
                    <div className="mb-1 text-[13px]">{s.sector}</div>
                    <div className="flex items-center gap-2">
                      <span aria-hidden className={'h-6 rounded-sm ' + BAR[i % BAR.length] + (pickedSector === s.sector ? ' ring-2 ring-ink/30' : '')} style={{ width: `${Math.max(1, (s.weight / maxBar) * 60)}%` }} />
                      <span className="num text-[13px]">{pct(s.weight)}</span>
                    </div>
                  </button>
                </li>
              ))}
              {!bars.length && <li className="text-[13px] text-ink-muted">No sectors for this period.</li>}
            </ul>
          </section>
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold">Sector weightage</h2>
              <select
                aria-label="Sector"
                value={pickedSector ?? ''}
                onChange={(e) => setSector(e.target.value)}
                className="max-w-[240px] rounded-lg border border-rule-strong bg-paper px-3 py-1.5 text-[13px]"
              >
                {sectorNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {pickedSector && (
              <Columns
                points={periods.map((x) => ({ key: x.asOf, label: periodLabel(x.asOf), value: (x.sectors.find((s) => s.sector === pickedSector)?.weight ?? 0) * 100 }))}
                format={(v) => `${v.toFixed(2)}% of the fund`}
                axisFormat={(v) => `${v.toFixed(0)}%`}
                label={`${pickedSector}: share of the fund in each period`}
                seriesLabel={pickedSector}
                height={260}
              />
            )}
            {periods.length < 2 && <p className="mt-2 text-[12.5px] text-ink-muted">One period on file so far; more show as they come in.</p>}
          </section>
        </div>
      )}
      <p className="text-[12px] text-ink-muted">
        From {p.source}.{p.target ? ' The target is the range SEBI’s rules allow its category, not the fund’s own document.' : ''} Sector shares are of the whole fund
        {d.row.market === 'IN' ? '' : ' (of the equity part, for Yahoo’s summaries)'}.
      </p>
    </div>
  )
}

/** Each asset class's allowed range as a marked stretch of a 0–100% track. */
function Target({ ranges }: { ranges: TargetRange[] }) {
  return (
    <div>
      <div className="mb-3 text-[12px] font-medium tracking-wide text-ink-muted uppercase">Target (SEBI)</div>
      <ul className="space-y-4">
        {ranges.map((r) => (
          <li key={r.label}>
            <div className="mb-1.5 text-[13px]">{r.label}</div>
            <div className="flex items-center gap-3">
              <div className="relative h-1.5 flex-1 rounded-full bg-rule" aria-hidden>
                <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#8a5cc7]" style={{ left: `${r.min * 100}%`, width: `${Math.max(1, (r.max - r.min) * 100)}%` }} />
                <span className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-[#8a5cc7]" style={{ left: `${r.min * 100}%` }} />
                <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-full -translate-y-1/2 bg-[#8a5cc7]" style={{ left: `${r.max * 100}%` }} />
              </div>
              <span className="num w-24 text-right text-[13px]">
                {Math.round(r.min * 100)}% – {Math.round(r.max * 100)}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
