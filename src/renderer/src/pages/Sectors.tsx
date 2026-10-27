import { useMemo, useState } from 'react'
import { groupRows, LEVEL_LABEL, rowsUnder, SECTOR_LEVELS, type IndustryClass } from '@shared/sectors'
import { ErrorNote, PageHeader } from '../components/Shell'
import { BASE_COLUMNS, ScreenTable } from '../components/ScreenTable'
import { useIndustries, useScreenData } from '../lib/api'
import { bigMoney, toneClass } from '../lib/format'

const pct = (v: number | null, d = 1) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`)

/** Every listed company by NSE's sector, industry and basic industry: size, moves and valuation, with the companies at the bottom. */
export function Sectors() {
  const screen = useScreenData()
  const ind = useIndustries()
  const [path, setPath] = useState<string[]>([])
  const classOf = useMemo(() => new Map<string, IndustryClass>((ind.data?.classes ?? []).map((c) => [c.symbol, c])), [ind.data])
  const rows = useMemo(() => rowsUnder(screen.data?.rows ?? [], classOf, path), [screen.data, classOf, path])
  const level = SECTOR_LEVELS[path.length]
  const groups = useMemo(() => (level ? groupRows(rows, classOf, level) : []), [rows, classOf, level])
  const total = groups.reduce((s, g) => s + g.mcap, 0)
  const m = ind.data

  return (
    <>
      <PageHeader title="Sectors" />
      <ErrorNote error={screen.error ?? ind.error} />
      {m && m.classified < m.companies && (
        <p className="mb-3 text-[13px] text-ink-muted">
          {m.classified.toLocaleString('en-IN')} of {m.companies.toLocaleString('en-IN')} companies classified so far; NSE is asked for the rest
          slowly while Research is on, biggest first.
        </p>
      )}
      <nav aria-label="Sector path" className="mb-4 flex flex-wrap items-center gap-1 text-[14px]">
        <button type="button" onClick={() => setPath([])} className={path.length ? 'text-stamp hover:underline' : 'font-semibold'}>
          All sectors
        </button>
        {path.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            <span aria-hidden className="text-ink-muted">
              /
            </span>
            <button type="button" onClick={() => setPath(path.slice(0, i + 1))} className={i < path.length - 1 ? 'text-stamp hover:underline' : 'font-semibold'}>
              {p}
            </button>
          </span>
        ))}
      </nav>

      {(screen.isLoading || ind.isLoading) && <p className="text-ink-muted">Adding up the market…</p>}

      {level && groups.length > 0 && (
        <div className="mb-8 overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                <th className="py-1 text-left font-medium">{LEVEL_LABEL[level]}</th>
                <th className="px-2 text-right font-medium">Companies</th>
                <th className="px-2 text-right font-medium">Market value</th>
                <th className="px-2 text-right font-medium">Today</th>
                <th className="px-2 text-right font-medium">Up today</th>
                <th className="px-2 text-right font-medium">1 month</th>
                <th className="px-2 text-right font-medium">1 year</th>
                <th className="px-2 text-right font-medium">Median P/E</th>
                <th className="px-2 text-left font-medium">Biggest</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className="cursor-pointer border-b border-rule hover:bg-sheet" onClick={() => setPath([...path, g.name])}>
                  <td className="py-1">
                    <button type="button" className="text-left hover:text-stamp" onClick={(e) => (e.stopPropagation(), setPath([...path, g.name]))}>
                      {g.name}
                    </button>
                    {g.held > 0 && <span className="ml-2 text-[12px] text-gain">{g.held} held</span>}
                  </td>
                  <td className="num px-2">{g.companies}</td>
                  <td className="num px-2">
                    <span className="mr-2 inline-block h-1.5 rounded-sm bg-stamp align-middle" style={{ width: `${Math.max(1, (g.mcap / (total || 1)) * 80)}px` }} aria-hidden />
                    {bigMoney(g.mcap)}
                  </td>
                  <td className={`num px-2 ${toneClass(g.change)}`}>{pct(g.change, 2)}</td>
                  <td className="num px-2">{g.breadth === null ? '—' : `${Math.round(g.breadth * 100)}%`}</td>
                  <td className={`num px-2 ${toneClass(g.ret1m)}`}>{pct(g.ret1m)}</td>
                  <td className={`num px-2 ${toneClass(g.ret1y)}`}>{pct(g.ret1y)}</td>
                  <td className="num px-2">{g.medianPe === null ? '—' : g.medianPe.toFixed(1)}</td>
                  <td className="max-w-[260px] truncate px-2 text-ink-muted" title={g.leaders.join(', ')}>
                    {g.leaders.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-ink-muted">Moves are weighted by market value. Click a row to go a level down.</p>
        </div>
      )}

      {path.length > 0 && rows.length > 0 && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold text-stamp">
            {rows.length} {rows.length === 1 ? 'company' : 'companies'} in {path.at(-1)}
          </h2>
          <ScreenTable rows={rows} columns={[...BASE_COLUMNS, 'ret1y']} initialSort={{ field: 'mcap', dir: 'desc' }} label={`Companies in ${path.at(-1)}`} />
        </section>
      )}
      <p className="mt-6 text-[12px] text-ink-muted">Classification: NSE (macro-economic sector, sector, industry, basic industry).</p>
    </>
  )
}
