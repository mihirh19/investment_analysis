import { useMemo, useState, type ReactNode } from 'react'
import { applyFundScreen, FUND_FIELDS, FUND_PRESETS, fundField, type FundField, type FundFilter, type FundRow } from '@shared/fundScreener'
import { ErrorNote } from '../components/Shell'
import { useAddFundEtf, useFundScreen, useSetFundScreenSync } from '../lib/api'
import { toneClass } from '../lib/format'
import { useTerminal } from '../lib/terminal'

const SIGNED: FundField[] = ['ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'ret5y', 'alpha', 'maxDrawdown']

/** Ready-made column sets, as investing apps offer them; Custom picks its own. */
const VIEWS: { key: string; label: string; columns: FundField[] }[] = [
  { key: 'overview', label: 'Overview', columns: ['aumCr', 'ter', 'ret1y', 'ret3y', 'ret5y', 'sharpe', 'maxDrawdown'] },
  { key: 'returns', label: 'Returns', columns: ['ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'ret5y'] },
  { key: 'risk', label: 'Risk', columns: ['vol', 'maxDrawdown', 'sharpe', 'sortino', 'years'] },
  { key: 'index', label: 'Against the index', columns: ['alpha', 'beta', 'r2', 'upCapture', 'downCapture', 'beatRate', 'trackingError'] }
]

/** The filter panel's number ranges, in groups. */
const RANGE_GROUPS: { title: string; fields: FundField[] }[] = [
  { title: 'Size and cost', fields: ['aumCr', 'ter'] },
  { title: 'Returns', fields: ['ret1y', 'ret3y', 'ret5y'] },
  { title: 'Risk', fields: ['vol', 'maxDrawdown', 'sharpe', 'sortino'] },
  { title: 'Against the index', fields: ['alpha', 'beta', 'upCapture', 'downCapture', 'beatRate', 'trackingError'] },
  { title: 'Track record', fields: ['years'] }
]

/** Where the fund is listed, and whether it is a mutual fund or an ETF. */
type Market = '' | 'IN-MF' | 'IN-ETF' | 'US' | 'UCITS'
const MARKETS: [Market, string][] = [
  ['IN-MF', 'Indian mutual funds'],
  ['IN-ETF', 'Indian ETFs'],
  ['US', 'US ETFs'],
  ['UCITS', 'UCITS ETFs'],
  ['', 'Everything']
]
const inMarket = (r: FundRow, m: Market) =>
  !m || (m === 'IN-MF' ? r.market === 'IN' && r.vehicle === 'MF' : m === 'IN-ETF' ? r.market === 'IN' && r.vehicle === 'ETF' : r.market === m)

const KINDS: [string, string][] = [
  ['', 'All'],
  ['Equity', 'Equity'],
  ['Hybrid', 'Hybrid'],
  ['Debt', 'Debt'],
  ['Other', 'Index & others'],
  ['Solution Oriented', 'Solution']
]

/** A range in the units shown: percent for returns and the like, the plain number otherwise. */
type Range = { min?: number; max?: number }
const isPct = (k: FundField) => fundField(k)?.kind === 'pct'
const toShown = (k: FundField, v: number) => (isPct(k) ? +(v * 100).toFixed(4) : v)
const fromShown = (k: FundField, v: number) => (isPct(k) ? v / 100 : v)
const unit = (k: FundField) => (isPct(k) ? '%' : k === 'ter' ? '%' : k === 'aumCr' ? 'Cr' : '')

/** A fund field's value as shown in the table. */
export function fundText(k: FundField, v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  switch (fundField(k)?.kind) {
    case 'pct':
      return `${(v * 100).toFixed(1)}%`
    case 'cr':
      return `₹${Math.round(v).toLocaleString('en-IN')} Cr`
    case 'ratio':
      return v.toFixed(2)
    case 'capture':
      return v.toFixed(0)
    case 'years':
      return v.toFixed(1)
    default:
      return k === 'ter' ? `${v.toFixed(2)}%` : v.toFixed(2)
  }
}

function rangesToFilters(ranges: Partial<Record<FundField, Range>>): FundFilter[] {
  const out: FundFilter[] = []
  for (const [k, r] of Object.entries(ranges) as [FundField, Range][]) {
    if (r.min !== undefined) out.push({ field: k, op: '>=', value: fromShown(k, r.min) })
    if (r.max !== undefined) out.push({ field: k, op: '<=', value: fromShown(k, r.max) })
  }
  return out
}

function filtersToRanges(filters: FundFilter[]): Partial<Record<FundField, Range>> {
  const out: Partial<Record<FundField, Range>> = {}
  for (const f of filters) out[f.field] = { ...out[f.field], [f.op === '>=' ? 'min' : 'max']: toShown(f.field, f.value) }
  return out
}

/** Every mutual fund with its costs, returns and risk ratios, Tickertape-style: filters at the left, ready-made screens and the results at the right. */
export function FundScreener() {
  const q = useFundScreen()
  const sync = useSetFundScreenSync()
  const terminal = useTerminal()
  const [market, setMarket] = useState<Market>('IN-MF')
  const [showLeveraged, setShowLeveraged] = useState(false)
  const [group, setGroup] = useState<string>('Equity')
  const [categories, setCategories] = useState<string[]>([])
  const [houses, setHouses] = useState<string[]>([])
  const [risks, setRisks] = useState<string[]>([])
  const [heldOnly, setHeldOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState<string | null>(null)
  const [ranges, setRanges] = useState<Partial<Record<FundField, Range>>>({})
  const [sort, setSort] = useState<{ field: FundField; dir: 'asc' | 'desc' }>({ field: 'aumCr', dir: 'desc' })
  const [view, setView] = useState('overview')
  const [custom, setCustom] = useState<FundField[]>(VIEWS[0].columns)
  const [shown, setShown] = useState(100)
  const d = q.data
  const all = useMemo(() => d?.rows ?? [], [d])

  const inMarketRows = useMemo(() => all.filter((r) => inMarket(r, market) && (showLeveraged || !r.leveraged)), [all, market, showLeveraged])
  const marketCounts = useMemo(() => new Map(MARKETS.map(([m]) => [m, all.filter((r) => inMarket(r, m) && !r.leveraged).length])), [all])
  const inGroup = useMemo(() => inMarketRows.filter((r) => !group || r.group === group), [inMarketRows, group])
  const global = market === 'US' || market === 'UCITS'
  const categoryCounts = useMemo(() => count(inGroup.map((r) => r.category)), [inGroup])
  const houseCounts = useMemo(() => count(inGroup.map((r) => r.fundHouse).filter((h): h is string => !!h)), [inGroup])
  const riskCounts = useMemo(() => count(inGroup.map((r) => r.risk).filter((h): h is string => !!h)), [inGroup])
  const filters = useMemo(() => rangesToFilters(ranges), [ranges])
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return applyFundScreen(
      inGroup.filter(
        (r) =>
          (!categories.length || categories.includes(r.category)) &&
          (!houses.length || (r.fundHouse !== null && houses.includes(r.fundHouse))) &&
          (!risks.length || (r.risk !== null && risks.includes(r.risk))) &&
          (!heldOnly || r.held) &&
          (!s || r.name.toLowerCase().includes(s) || (r.fundHouse ?? '').toLowerCase().includes(s) || (r.ticker ?? '').toLowerCase() === s)
      ),
      { filters, sort }
    )
  }, [inGroup, categories, houses, risks, heldOnly, search, filters, sort])

  const presetCounts = useMemo(() => new Map(FUND_PRESETS.map((p) => [p.key, applyFundScreen(inMarketRows, { group: p.group, category: p.category, filters: p.filters, sort: p.sort }).length])), [inMarketRows])
  const usePreset = (key: string) => {
    if (preset === key) return clearAll()
    const p = FUND_PRESETS.find((x) => x.key === key)!
    setPreset(key)
    setGroup(p.group ?? '')
    setCategories(p.category ? [...new Set(all.filter((r) => r.category.toLowerCase().includes(p.category!.toLowerCase())).map((r) => r.category))] : [])
    setHouses([])
    setRisks([])
    setRanges(filtersToRanges(p.filters))
    setSort(p.sort)
    setShown(100)
  }
  const clearAll = () => {
    setPreset(null)
    setCategories([])
    setHouses([])
    setRisks([])
    setHeldOnly(false)
    setRanges({})
    setSort({ field: 'aumCr', dir: 'desc' })
  }
  const setRange = (k: FundField, r: Range) => {
    setPreset(null)
    setRanges((cur) => {
      const next = { ...cur }
      if (r.min === undefined && r.max === undefined) delete next[k]
      else next[k] = r
      return next
    })
  }

  const picked = view === 'custom' ? custom : VIEWS.find((v) => v.key === view)!.columns
  // Abroad: the year's return in rupees beside the one in its own currency.
  const columns = global ? picked.flatMap((k) => (k === 'ret1y' && view !== 'custom' ? (['ret1y', 'ret1yInr'] as FundField[]) : [k])) : picked
  const open = (r: FundRow) => terminal?.openScreen(`/research/fund/${r.code}`, { newTab: true })
  const s = d?.status

  // Chips for every filter in force, each with its own ×.
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...categories.map((c) => ({ key: `c:${c}`, label: c, clear: () => setCategories(categories.filter((x) => x !== c)) })),
    ...houses.map((h) => ({ key: `h:${h}`, label: h.replace(/ Mutual Fund$/i, ''), clear: () => setHouses(houses.filter((x) => x !== h)) })),
    ...risks.map((r) => ({ key: `r:${r}`, label: `${r} risk`, clear: () => setRisks(risks.filter((x) => x !== r)) })),
    ...(heldOnly ? [{ key: 'held', label: 'Held by the family', clear: () => setHeldOnly(false) }] : []),
    ...(Object.entries(ranges) as [FundField, Range][]).map(([k, r]) => ({
      key: `f:${k}`,
      label: `${fundField(k)!.label} ${r.min !== undefined && r.max !== undefined ? `${r.min}–${r.max}` : r.min !== undefined ? `≥ ${r.min}` : `≤ ${r.max}`}${unit(k) === 'Cr' ? ' Cr' : unit(k)}`,
      clear: () => setRange(k, {})
    }))
  ]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] leading-tight font-semibold text-ink">Mutual fund screener</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Direct growth plans with AMFI’s costs and size, and returns and ratios worked out from each fund’s NAVs.
          </p>
        </div>
        {s && (
          <div className="flex items-center gap-3 text-[12.5px] text-ink-muted" aria-live="polite">
            <span>
              {s.funds === 0
                ? 'Getting the list of funds from AMFI…'
                : `Ratios for ${s.measured.toLocaleString('en-IN')} of ${s.funds.toLocaleString('en-IN')} funds${s.running && s.current ? `; now ${s.current}` : ''}`}
            </span>
            <button type="button" disabled={sync.isPending} onClick={() => sync.mutate([!s.enabled])} className="rounded-lg border border-rule-strong px-3 py-1 text-ink hover:bg-sheet disabled:opacity-50">
              {s.enabled ? 'Pause' : 'Resume'}
            </button>
          </div>
        )}
      </header>
      <ErrorNote error={q.error} />
      {s?.lastError && <p className="text-[13px] text-warn">{s.lastError}. Tried again on the next pass.</p>}

      {/* Ready-made screens as cards. */}
      <section aria-label="Ready-made screens">
        <ul className="grid gap-3 @2xl:grid-cols-3 @6xl:grid-cols-5">
          {FUND_PRESETS.map((p) => {
            const on = preset === p.key
            return (
              <li key={p.key}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => usePreset(p.key)}
                  className={
                    'flex h-full w-full flex-col rounded-xl border p-4 text-left transition-colors ' +
                    (on ? 'border-stamp bg-stamp-wash' : 'border-rule hover:border-rule-strong hover:bg-sheet')
                  }
                >
                  <span className={'text-[14px] font-semibold ' + (on ? 'text-stamp' : 'text-ink')}>{p.label}</span>
                  <span className="mt-1 line-clamp-2 flex-1 text-[12px] leading-snug text-ink-muted">{p.note}</span>
                  {d && <span className="mt-2 text-[12px] font-medium text-ink">{(presetCounts.get(p.key) ?? 0).toLocaleString('en-IN')} funds</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid items-start gap-6 @4xl:grid-cols-[270px_minmax(0,1fr)]">
        {/* The filters. */}
        <aside aria-label="Filters" className="overflow-hidden rounded-xl border border-rule @4xl:sticky @4xl:top-16 @4xl:max-h-[calc(100vh-5rem)] @4xl:overflow-y-auto">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-[15px] font-semibold">Filters</h2>
            <button type="button" onClick={clearAll} className="text-[12.5px] text-stamp hover:underline">
              Clear all
            </button>
          </div>
          <Section title="Market" open>
            <div role="radiogroup" aria-label="Market" className="space-y-0.5 text-[13px]">
              {MARKETS.map(([m, l]) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-sheet">
                  <input
                    type="radio"
                    name="fund-market"
                    checked={market === m}
                    onChange={() => {
                      setMarket(m)
                      setCategories([])
                      setHouses([])
                      setPreset(null)
                      setSort({ field: 'aumCr', dir: 'desc' })
                    }}
                  />
                  <span className="flex-1">{l}</span>
                  <span className="text-[11.5px] text-ink-muted">{(marketCounts.get(m) ?? 0).toLocaleString('en-IN')}</span>
                </label>
              ))}
            </div>
            {(market === 'US' || market === '') && (
              <label className="mt-2 flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={showLeveraged} onChange={(e) => setShowLeveraged(e.target.checked)} />
                Show leveraged and inverse ETFs
              </label>
            )}
            {(market === 'US' || market === 'UCITS') && <AddEtf onAdded={(code) => open({ code } as FundRow)} />}
          </Section>
          <Section title="Kind" open>
            <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
              {KINDS.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={group === v}
                  onClick={() => (setGroup(v), setCategories([]), setPreset(null))}
                  className={
                    'rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors ' +
                    (group === v ? 'border-stamp bg-stamp-wash font-semibold text-stamp' : 'border-rule-strong text-ink-muted hover:text-ink')
                  }
                >
                  {l}
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={heldOnly} onChange={(e) => setHeldOnly(e.target.checked)} />
              Only funds the family holds
            </label>
          </Section>
          <Section title="Category" open count={categories.length}>
            <CheckList items={categoryCounts} picked={categories} onChange={(v) => (setPreset(null), setCategories(v))} />
          </Section>
          <Section title="Fund house" count={houses.length}>
            <CheckList items={houseCounts} picked={houses} onChange={(v) => (setPreset(null), setHouses(v))} searchable format={(h) => h.replace(/ Mutual Fund$/i, '')} />
          </Section>
          <Section title="Riskometer" count={risks.length}>
            <CheckList items={riskCounts} picked={risks} onChange={(v) => (setPreset(null), setRisks(v))} />
          </Section>
          {RANGE_GROUPS.map((g) => (
            <Section key={g.title} title={g.title} open={g.title === 'Size and cost' || g.title === 'Returns'} count={g.fields.filter((k) => ranges[k]).length}>
              <div className="space-y-3">
                {g.fields.map((k) => (
                  <RangeInput key={k} field={k} value={ranges[k] ?? {}} rows={inGroup} onChange={(r) => setRange(k, r)} />
                ))}
              </div>
            </Section>
          ))}
        </aside>

        {/* The results. */}
        <section aria-label="Results" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="text-[15px] font-semibold">{d ? `${rows.length.toLocaleString('en-IN')} funds` : 'Funds'}</div>
            <label className="relative ml-auto">
              <span className="sr-only">Search funds</span>
              <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 fill-none stroke-current text-ink-muted" strokeWidth="1.6">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a fund, fund house or ticker"
                className="w-64 rounded-lg border border-rule-strong bg-paper py-1.5 pr-3 pl-8 text-[13px]"
              />
            </label>
          </div>

          {chips.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
              {chips.map((c) => (
                <li key={c.key} className="flex items-center gap-1 rounded-full bg-sheet py-0.5 pr-1 pl-2.5">
                  {c.label}
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={c.clear} className="rounded-full px-1 text-ink-muted hover:bg-rule hover:text-ink">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div role="tablist" aria-label="Columns" className="mb-3 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-rule">
            {[...VIEWS, { key: 'custom', label: 'Custom' }].map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                className={'-mb-px border-b-2 px-3 pb-2 text-[13.5px] whitespace-nowrap ' + (view === v.key ? 'border-stamp font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink')}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'custom' && (
            <div className="mb-3 flex flex-wrap gap-1.5 text-[12.5px]">
              {FUND_FIELDS.map((f) => {
                const on = custom.includes(f.key)
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={on}
                    title={f.help}
                    onClick={() => setCustom(on ? custom.filter((c) => c !== f.key) : FUND_FIELDS.map((x) => x.key).filter((k) => k === f.key || custom.includes(k)))}
                    className={'rounded-full border px-2.5 py-0.5 ' + (on ? 'border-stamp bg-stamp-wash text-stamp' : 'border-rule-strong text-ink-muted hover:text-ink')}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          )}

          {q.isLoading && <p className="text-ink-muted">Opening the funds…</p>}
          {d && (
            <>
              <div className="overflow-x-auto rounded-xl border border-rule">
                <table className="w-full text-[13.5px]" aria-label="Funds">
                  <thead>
                    <tr className="border-b border-rule bg-sheet text-[12px] text-ink-muted">
                      <th scope="col" className="sticky left-0 bg-sheet px-4 py-2.5 text-left font-medium">
                        Fund
                      </th>
                      {columns.map((k) => (
                        <SortHead key={k} field={k} sort={sort} onSort={(x) => (setSort(x), setShown(100))} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((r) => (
                      <tr
                        key={r.code}
                        tabIndex={0}
                        onClick={() => open(r)}
                        onKeyDown={(e) => e.key === 'Enter' && open(r)}
                        className="group cursor-pointer border-b border-rule last:border-0 hover:bg-sheet focus:bg-sheet focus:outline-none"
                      >
                        <th scope="row" className="sticky left-0 max-w-[330px] bg-paper px-4 py-2.5 text-left font-normal group-hover:bg-sheet group-focus:bg-sheet">
                          <span className="flex items-center gap-2.5">
                            <Initials name={r.fundHouse ?? r.name} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink" title={r.name}>
                                {r.name}
                                {r.held && (
                                  <span className="ml-1.5 rounded bg-stamp-wash px-1 text-[10.5px] font-semibold text-stamp" title="The family holds it">
                                    HELD
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-[11.5px] text-ink-muted">
                                {r.ticker ? `${r.ticker} · ` : ''}
                                {r.category}
                                {r.risk ? ` · ${r.risk}` : ''}
                              </span>
                            </span>
                          </span>
                        </th>
                        {columns.map((k) => (
                          <td key={k} className={`num px-3 ${SIGNED.includes(k) ? toneClass(r[k] as number | null) : ''}`}>
                            {fundText(k, r[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-ink-muted">
                          No fund matches these filters.{' '}
                          <button type="button" onClick={clearAll} className="text-stamp hover:underline">
                            Clear them
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {rows.length > shown && (
                <button type="button" onClick={() => setShown((n) => n + 200)} className="mt-3 w-full rounded-lg border border-rule py-2 text-[13px] text-stamp hover:bg-sheet">
                  Show {Math.min(200, rows.length - shown)} more of {(rows.length - shown).toLocaleString('en-IN')}
                </button>
              )}
              <p className="mt-3 text-[12px] text-ink-muted">
                Size, costs and riskometer from AMFI{d.factsAsOf ? ` (${d.factsAsOf})` : ''}; returns and ratios from each fund’s NAVs (mfapi.in) against its index (Yahoo Finance), with 6.5% as
                the risk-free rate. Click a heading to sort, a fund to open it. Past returns don’t tell what comes next; this is information, not advice.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function count(values: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].sort((a, b) => a[0].localeCompare(b[0]))
}

/** A fold in the filter panel. */
function Section({ title, open, count, children }: { title: string; open?: boolean; count?: number; children: ReactNode }) {
  return (
    <details open={open} className="group/s border-b border-rule last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13.5px] font-medium hover:bg-sheet [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{title}</span>
        {!!count && <span className="rounded-full bg-stamp px-1.5 text-[11px] font-semibold text-white">{count}</span>}
        <svg aria-hidden viewBox="0 0 12 12" className="size-3 fill-none stroke-current text-ink-muted transition-transform group-open/s:rotate-180" strokeWidth="1.6">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

function CheckList({
  items,
  picked,
  onChange,
  searchable,
  format = (x) => x
}: {
  items: [string, number][]
  picked: string[]
  onChange: (v: string[]) => void
  searchable?: boolean
  format?: (x: string) => string
}) {
  const [find, setFind] = useState('')
  const f = find.trim().toLowerCase()
  const list = f ? items.filter(([k]) => k.toLowerCase().includes(f)) : items
  return (
    <>
      {searchable && <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" className="mb-2 w-full rounded-lg border border-rule-strong bg-paper px-2.5 py-1 text-[13px]" />}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto text-[13px]">
        {list.map(([k, n]) => (
          <li key={k}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-sheet">
              <input type="checkbox" checked={picked.includes(k)} onChange={(e) => onChange(e.target.checked ? [...picked, k] : picked.filter((x) => x !== k))} />
              <span className="min-w-0 flex-1 truncate" title={k}>
                {format(k)}
              </span>
              <span className="text-[11.5px] text-ink-muted">{n}</span>
            </label>
          </li>
        ))}
        {!list.length && <li className="text-ink-muted">None</li>}
      </ul>
    </>
  )
}

/** Min and max boxes for one figure, with the funds' own spread as a hint. */
function RangeInput({ field, value, rows, onChange }: { field: FundField; value: Range; rows: FundRow[]; onChange: (r: Range) => void }) {
  const f = fundField(field)!
  const vals = rows.map((r) => r[field]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const lo = vals.length ? toShown(field, Math.min(...vals)) : null
  const hi = vals.length ? toShown(field, Math.max(...vals)) : null
  const hint = (v: number | null) => (v === null ? '' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(isPct(field) ? 0 : 2))
  const read = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s))
  const box = 'num w-full min-w-0 rounded-lg border border-rule-strong bg-paper px-2 py-1 text-left text-[13px]'
  return (
    <div title={f.help}>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span>{f.label}</span>
        {unit(field) && <span className="text-[11.5px] text-ink-muted">{unit(field)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input aria-label={`${f.label}, at least`} type="number" step="any" value={value.min ?? ''} placeholder={`Min ${hint(lo)}`} onChange={(e) => onChange({ ...value, min: read(e.target.value) })} className={box} />
        <span className="text-ink-muted">–</span>
        <input aria-label={`${f.label}, at most`} type="number" step="any" value={value.max ?? ''} placeholder={`Max ${hint(hi)}`} onChange={(e) => onChange({ ...value, max: read(e.target.value) })} className={box} />
      </div>
    </div>
  )
}

function SortHead({ field, sort, onSort }: { field: FundField; sort: { field: FundField; dir: 'asc' | 'desc' }; onSort: (s: { field: FundField; dir: 'asc' | 'desc' }) => void }) {
  const f = fundField(field)!
  const on = sort.field === field
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
      <button
        type="button"
        title={`${f.label}: ${f.help}`}
        className={on ? 'font-semibold text-stamp' : 'hover:text-ink'}
        onClick={() => onSort(on ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: f.better === 'low' ? 'asc' : 'desc' })}
      >
        {f.short}
        {on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
}

/** A round badge with the fund house's initials, in place of a logo. */
function Initials({ name }: { name: string }) {
  const words = name.replace(/ Mutual Fund$/i, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
  const text = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-stamp-wash text-[11px] font-semibold text-stamp">
      {text}
    </span>
  )
}

/** Adds a UCITS or US ETF that isn't in the list, by ticker, ISIN or name (Yahoo's search). */
function AddEtf({ onAdded }: { onAdded: (code: string) => void }) {
  const add = useAddFundEtf()
  const [q, setQ] = useState('')
  const submit = () => {
    if (q.trim().length < 2) return
    add.mutate([q.trim()], { onSuccess: (code) => (setQ(''), onAdded(code)) })
  }
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <div className="mb-1 text-[12.5px]">Add an ETF that isn’t listed</div>
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="VWRA.L, IE00BK5BQT80…"
          aria-label="ETF ticker, ISIN or name"
          className="min-w-0 flex-1 rounded-lg border border-rule-strong bg-paper px-2.5 py-1 text-[13px]"
        />
        <button type="button" disabled={add.isPending} onClick={submit} className="rounded-lg bg-stamp px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-50">
          {add.isPending ? '…' : 'Add'}
        </button>
      </div>
      {add.error && <p className="mt-1 text-[12px] text-loss">{add.error instanceof Error ? add.error.message : String(add.error)}</p>}
    </div>
  )
}