import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SCREEN_FIELDS, sortRows, type FieldKey, type FieldKind, type ScreenRow } from '@shared/screener'
import { bigMoney, money, toneClass } from '../lib/format'

/** A figure the way the screener shows it. */
export function fieldText(kind: FieldKind, v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  switch (kind) {
    case 'pct':
      return `${(v * 100).toFixed(1)}%`
    case 'money':
      return bigMoney(v)
    case 'rs':
      return money(v, 'INR', v >= 1000 ? 0 : 2)
    case 'times':
      return v.toFixed(1)
    case 'ratio':
      return v.toFixed(2)
    default:
      return String(Math.round(v))
  }
}

/** What a filter's number box takes: percent as 15 (for 15%), money in crore. */
export const toInput = (kind: FieldKind, v: number) =>
  kind === 'pct' ? String(Math.round(v * 1000) / 10) : kind === 'money' ? String(Math.round(v / 1e7)) : String(v)
export const fromInput = (kind: FieldKind, text: string) => {
  const n = Number(text)
  if (text.trim() === '' || !Number.isFinite(n)) return null
  return kind === 'pct' ? n / 100 : kind === 'money' ? n * 1e7 : n
}
export const inputUnit = (kind: FieldKind) => (kind === 'pct' ? '%' : kind === 'money' ? '₹ Cr' : kind === 'rs' ? '₹' : '')

const FIELD = new Map(SCREEN_FIELDS.map((f) => [f.key, f]))
export const fieldOf = (k: FieldKey) => FIELD.get(k)!

/** Columns shown for every screen; a screen's own filter fields are added after them. */
export const BASE_COLUMNS: FieldKey[] = ['close', 'change', 'mcap', 'pe', 'roe', 'roce', 'debtToEquity', 'salesGrowth3y', 'profitGrowth3y', 'piotroski']

const SIGNED: FieldKey[] = ['change', 'salesGrowthQ', 'profitGrowthQ', 'salesGrowth3y', 'profitGrowth3y', 'salesGrowthMin5', 'fromHigh']

export function ScreenTable({
  rows,
  columns,
  limit = 100,
  highlight,
  initialSort,
  label
}: {
  rows: ScreenRow[]
  columns: FieldKey[]
  limit?: number
  highlight?: string
  /** Null keeps the order given (a ranked screen). */
  initialSort?: { field: FieldKey; dir: 'asc' | 'desc' } | null
  label: string
}) {
  const navigate = useNavigate()
  const [sort, setSort] = useState(initialSort ?? null)
  const [shown, setShown] = useState(limit)
  const sorted = sort ? sortRows(rows, sort.field, sort.dir) : rows
  const open = (s: string) => navigate(`/research/${encodeURIComponent(s)}`)
  const head = (k: FieldKey) => {
    const f = fieldOf(k)
    const on = sort?.field === k
    return (
      <th key={k} scope="col" aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined} className="px-2 py-1 text-right font-medium whitespace-nowrap">
        <button
          type="button"
          title={`${f.label}: ${f.help}`}
          onClick={() => setSort(on ? { field: k, dir: sort!.dir === 'asc' ? 'desc' : 'asc' } : { field: k, dir: f.better === 'low' ? 'asc' : 'desc' })}
          className={on ? 'text-stamp' : 'hover:text-ink'}
        >
          {f.short}
          {on ? (sort!.dir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]" aria-label={label}>
        <thead>
          <tr className="border-b border-rule-strong text-[12.5px] text-ink-muted">
            <th scope="col" className="sticky left-0 bg-paper py-1 pr-3 text-left font-medium">
              Company
            </th>
            {columns.map(head)}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((r) => (
            <tr
              key={r.symbol}
              tabIndex={0}
              onClick={() => open(r.symbol)}
              onKeyDown={(e) => e.key === 'Enter' && open(r.symbol)}
              className={
                'cursor-pointer border-b border-rule hover:bg-sheet focus:bg-sheet focus:outline-none ' +
                (r.symbol === highlight ? 'bg-stamp-wash' : '')
              }
            >
              <th scope="row" className={'sticky left-0 max-w-[260px] py-1 pr-3 text-left font-normal ' + (r.symbol === highlight ? 'bg-stamp-wash' : 'bg-paper')}>
                <span className="font-semibold text-stamp">{r.symbol}</span>
                {r.held && <span className="ml-1.5 text-[11.5px] text-ink-muted" title="The family holds it">●</span>}
                <div className="truncate text-[12px] text-ink-muted">{r.name}</div>
              </th>
              {columns.map((k) => {
                const v = r[k]
                return (
                  <td key={k} className={'num px-2 ' + (SIGNED.includes(k) ? toneClass(v as number | null) : '')}>
                    {fieldText(fieldOf(k).kind, v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 200)} className="mt-2 text-[13.5px] text-stamp hover:underline">
          Show {Math.min(200, sorted.length - shown)} more of {sorted.length - shown}
        </button>
      )}
    </div>
  )
}
