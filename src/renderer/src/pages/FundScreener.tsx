import { useMemo, useState } from 'react'
import { applyFundScreen, FUND_FIELDS, FUND_PRESETS, fundField, type FundField, type FundFilter, type FundRow } from '@shared/fundScreener'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button } from '../components/ui'
import { useFundScreen, useSetFundScreenSync } from '../lib/api'
import { toneClass } from '../lib/format'
import { useTerminal } from '../lib/terminal'

const DEFAULT_COLUMNS: FundField[] = ['aumCr', 'ter', 'ret1y', 'ret3y', 'ret5y', 'vol', 'sharpe', 'sortino', 'alpha', 'beta', 'maxDrawdown', 'downCapture', 'beatRate']
const SIGNED: FundField[] = ['ret1m', 'ret3m', 'ret6m', 'ret1y', 'ret3y', 'ret5y', 'alpha', 'maxDrawdown']

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

/** Every mutual fund with its costs, returns and risk ratios: filter, sort and open one. */
export function FundScreener() {
  const q = useFundScreen()
  const sync = useSetFundScreenSync()
  const terminal = useTerminal()
  const [group, setGroup] = useState<string>('Equity')
  const [category, setCategory] = useState('')
  const [house, setHouse] = useState('')
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState<string | null>(null)
  const [filters, setFilters] = useState<FundFilter[]>([])
  const [sort, setSort] = useState<{ field: FundField; dir: 'asc' | 'desc' }>({ field: 'aumCr', dir: 'desc' })
  const [columns, setColumns] = useState<FundField[]>(DEFAULT_COLUMNS)
  const [shown, setShown] = useState(100)
  const d = q.data
  const all = d?.rows ?? []

  const categories = useMemo(() => [...new Set(all.filter((r) => !group || r.group === group).map((r) => r.category))].sort(), [all, group])
  const houses = useMemo(() => [...new Set(all.map((r) => r.fundHouse).filter((h): h is string => !!h))].sort(), [all])
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return applyFundScreen(
      all.filter((r) => (!house || r.fundHouse === house) && (!s || r.name.toLowerCase().includes(s))),
      { group: group || undefined, category: category || undefined, filters, sort }
    )
  }, [all, group, category, house, search, filters, sort])

  const usePreset = (key: string) => {
    const p = FUND_PRESETS.find((x) => x.key === key)!
    setPreset(key)
    setGroup(p.group ?? '')
    setCategory(p.category ? (categories.find((c) => c.toLowerCase().includes(p.category!.toLowerCase())) ?? '') : '')
    setFilters(p.filters)
    setSort(p.sort)
  }
  const open = (r: FundRow) => terminal?.openScreen(`/research/fund/${r.code}`, { newTab: true })
  const head = (k: FundField) => {
    const f = fundField(k)!
    const on = sort.field === k
    return (
      <th key={k} scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="px-2 py-1 text-right font-medium whitespace-nowrap">
        <button
          type="button"
          title={`${f.label}: ${f.help}`}
          className={on ? 'text-stamp' : 'hover:text-ink'}
          onClick={() => setSort(on ? { field: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { field: k, dir: f.better === 'low' ? 'asc' : 'desc' })}
        >
          {f.short}
          {on ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }
  const s = d?.status

  return (
    <>
      <PageHeader title="Fund screener">
        {s && (
          <span className="text-[12.5px] text-ink-muted" aria-live="polite">
            {s.funds === 0
              ? 'Getting the list of funds from AMFI…'
              : `Ratios for ${s.measured.toLocaleString('en-IN')} of ${s.funds.toLocaleString('en-IN')} funds${s.running && s.current ? `; now ${s.current}` : ''}`}
          </span>
        )}
        {s && (
          <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={sync.isPending} onClick={() => sync.mutate([!s.enabled])}>
            {s.enabled ? 'Pause' : 'Resume'}
          </Button>
        )}
      </PageHeader>
      <ErrorNote error={q.error} />
      {s?.lastError && <p className="mb-3 text-[13px] text-warn">{s.lastError}. Tried again on the next pass.</p>}

      <div role="radiogroup" aria-label="Ready-made screens" className="mb-3 flex flex-wrap gap-1 text-[13px]">
        {FUND_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={preset === p.key}
            title={p.note}
            onClick={() => usePreset(p.key)}
            className={`rounded-sm px-2.5 py-1 ${preset === p.key ? 'bg-stamp font-semibold text-black' : 'text-ink-muted hover:bg-sheet hover:text-ink'}`}
          >
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => (setPreset(null), setFilters([]), setSort({ field: 'aumCr', dir: 'desc' }))} className="rounded-sm px-2.5 py-1 text-ink-muted hover:bg-sheet hover:text-ink">
          Clear
        </button>
      </div>
      {preset && <p className="mb-3 text-[13px] text-ink-muted">{FUND_PRESETS.find((p) => p.key === preset)?.note}</p>}

      <div className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <Pick label="Kind" value={group} onChange={(v) => (setGroup(v), setCategory(''))} options={[['', 'All'], ['Equity', 'Equity'], ['Hybrid', 'Hybrid'], ['Debt', 'Debt'], ['Solution Oriented', 'Solution oriented'], ['Other', 'Index and others']]} />
        <Pick label="Category" value={category} onChange={setCategory} options={[['', 'All categories'], ...categories.map((c) => [c, c] as [string, string])]} />
        <Pick label="Fund house" value={house} onChange={setHouse} options={[['', 'All fund houses'], ...houses.map((h) => [h, h] as [string, string])]} />
        <label className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-ink-muted">Name</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. parag parikh" className="w-44 rounded-sm border border-rule bg-sheet px-2 py-1" />
        </label>
      </div>

      <FilterRows filters={filters} onChange={(f) => (setPreset(null), setFilters(f))} />

      <details className="mb-3 text-[13px]">
        <summary className="cursor-pointer text-stamp">Columns</summary>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {FUND_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5" title={f.help}>
              <input type="checkbox" checked={columns.includes(f.key)} onChange={(e) => setColumns(e.target.checked ? FUND_FIELDS.map((x) => x.key).filter((k) => k === f.key || columns.includes(k)) : columns.filter((c) => c !== f.key))} />
              {f.label}
            </label>
          ))}
        </div>
      </details>

      {q.isLoading && <p className="text-ink-muted">Opening the funds…</p>}
      {d && (
        <>
          <p className="mb-1 text-[12.5px] text-ink-muted">
            {rows.length.toLocaleString('en-IN')} funds. Direct growth plans; size, costs and riskometer from AMFI{d.factsAsOf ? ` (${d.factsAsOf})` : ''}; returns and ratios from each fund’s NAVs
            against its index, with 6.5% as the risk-free rate. Click a heading to sort, a fund to open it.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" aria-label="Funds">
              <thead>
                <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                  <th scope="col" className="sticky left-0 bg-paper py-1 pr-3 text-left font-medium">
                    Fund
                  </th>
                  {columns.map(head)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <tr key={r.code} tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => e.key === 'Enter' && open(r)} className="cursor-pointer border-b border-rule hover:bg-sheet focus:bg-sheet focus:outline-none">
                    <th scope="row" className="sticky left-0 max-w-[320px] bg-paper py-1 pr-3 text-left font-normal">
                      <span className="block truncate font-medium text-ink" title={r.name}>
                        {r.name}
                        {r.held && (
                          <span className="ml-1.5 text-[11px] text-gain" title="The family holds it">
                            ●
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {r.category}
                        {r.fundHouse ? `, ${r.fundHouse.replace(/ Mutual Fund$/i, '')}` : ''}
                      </span>
                    </th>
                    {columns.map((k) => (
                      <td key={k} className={`num px-2 ${SIGNED.includes(k) ? toneClass(r[k] as number | null) : ''}`}>
                        {fundText(k, r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 200)} className="mt-2 text-[13px] text-stamp hover:underline">
              Show {Math.min(200, rows.length - shown)} more of {rows.length - shown}
            </button>
          )}
        </>
      )}
      <p className="mt-6 text-[12px] text-ink-muted">Data: AMFI (funds, size, costs), mfapi.in (NAV history), Yahoo Finance (index levels). Past returns don’t tell what comes next.</p>
    </>
  )
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11.5px] text-ink-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[260px] rounded-sm border border-rule bg-sheet px-2 py-1">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Conditions like "Sharpe ≥ 1": values in the units shown (percent for returns). */
function FilterRows({ filters, onChange }: { filters: FundFilter[]; onChange: (f: FundFilter[]) => void }) {
  const isPct = (k: FundField) => fundField(k)?.kind === 'pct'
  return (
    <div className="mb-3 text-[13px]">
      {filters.map((f, i) => (
        <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5">
          <select value={f.field} onChange={(e) => onChange(filters.map((x, j) => (j === i ? { ...x, field: e.target.value as FundField } : x)))} className="rounded-sm border border-rule bg-sheet px-1.5 py-0.5">
            {FUND_FIELDS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <select value={f.op} onChange={(e) => onChange(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as '>=' | '<=' } : x)))} className="rounded-sm border border-rule bg-sheet px-1.5 py-0.5">
            <option value=">=">at least</option>
            <option value="<=">at most</option>
          </select>
          <input
            type="number"
            step="any"
            value={isPct(f.field) ? +(f.value * 100).toFixed(4) : f.value}
            onChange={(e) => onChange(filters.map((x, j) => (j === i ? { ...x, value: isPct(x.field) ? Number(e.target.value) / 100 : Number(e.target.value) } : x)))}
            className="num w-24 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-left"
          />
          <span className="text-ink-muted">{isPct(f.field) ? '%' : ''}</span>
          <button type="button" aria-label="Remove this condition" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="text-ink-muted hover:text-loss">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...filters, { field: 'sharpe', op: '>=', value: 1 }])} className="text-stamp hover:underline">
        + Add a condition
      </button>
    </div>
  )
}
