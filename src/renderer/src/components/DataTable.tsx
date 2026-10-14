import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'

// One table component for the long lists (activity, dividends, sales): sort by any column, filter,
// choose columns, group rows, download what is shown as CSV. Settings are remembered per table.

export interface Column<T> {
  key: string
  header: string
  /** Plain value for sorting, filtering and the CSV file. */
  value: (row: T) => string | number | null
  render?: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Off until switched on in the column picker. */
  hidden?: boolean
  /** Can't be switched off. */
  always?: boolean
  sortable?: boolean
  /** Left out of the CSV file (e.g. buttons). */
  noCsv?: boolean
  /** Added up in group headings. */
  sum?: boolean
  className?: string
}

export interface GroupOption<T> {
  key: string
  label: string
  value: (row: T) => string
}

interface Saved {
  sort: string | null
  desc: boolean
  hidden: string[]
  shown: string[]
  group: string | null
}

const PAGE = 300

const csvCell = (v: string | number | null) => {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : v
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const blob = new Blob(['\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const compare = (a: string | number | null, b: string | number | null) => {
  if (a === null || a === '') return b === null || b === '' ? 0 : 1
  if (b === null || b === '') return -1
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en-IN', { numeric: true })
}

export function DataTable<T>({
  id,
  rows,
  columns,
  rowKey,
  groups = [],
  initialSort,
  initialGroup = null,
  filterPlaceholder = 'Filter',
  csvName,
  onRowClick,
  maxHeight,
  empty = 'Nothing to show.',
  toolbar
}: {
  /** Remembers this table's settings under this name. */
  id: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T, i: number) => string
  groups?: GroupOption<T>[]
  initialSort?: { key: string; desc: boolean }
  initialGroup?: string | null
  filterPlaceholder?: string
  csvName?: string
  onRowClick?: (row: T) => void
  /** Scroll inside the table (keeps the header in view) instead of with the page. */
  maxHeight?: number
  empty?: string
  toolbar?: ReactNode
}) {
  const storeKey = `table:${id}`
  const [saved, setSaved] = useState<Saved>(() => {
    const base: Saved = { sort: initialSort?.key ?? null, desc: initialSort?.desc ?? false, hidden: [], shown: [], group: initialGroup }
    try {
      return { ...base, ...(JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Partial<Saved>) }
    } catch {
      return base
    }
  })
  useEffect(() => localStorage.setItem(storeKey, JSON.stringify(saved)), [storeKey, saved])
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const visible = columns.filter((c) => c.always || (c.hidden ? saved.shown.includes(c.key) : !saved.hidden.includes(c.key)))
  const sortCol = columns.find((c) => c.key === saved.sort)
  const group = groups.find((g) => g.key === saved.group) ?? null

  const shownRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q
      ? rows.filter((r) => columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q)))
      : [...rows]
    if (sortCol) {
      out.sort((a, b) => compare(sortCol.value(a), sortCol.value(b)) * (saved.desc ? -1 : 1))
    }
    if (group) {
      // Keep the sort inside each group; groups in order of first appearance after sorting.
      const order = new Map<string, number>()
      out.forEach((r) => {
        const g = group.value(r)
        if (!order.has(g)) order.set(g, order.size)
      })
      out = out.map((r, i) => ({ r, i })).sort((a, b) => order.get(group.value(a.r))! - order.get(group.value(b.r))! || a.i - b.i).map((x) => x.r)
    }
    return out
  }, [rows, columns, query, sortCol, saved.desc, group])

  const setSort = (key: string) =>
    setSaved((s) => (s.sort === key ? { ...s, desc: !s.desc } : { ...s, sort: key, desc: typeof columns.find((c) => c.key === key)?.value(rows[0]) === 'number' }))
  const toggleCol = (c: Column<T>) =>
    setSaved((s) =>
      c.hidden
        ? { ...s, shown: s.shown.includes(c.key) ? s.shown.filter((k) => k !== c.key) : [...s.shown, c.key] }
        : { ...s, hidden: s.hidden.includes(c.key) ? s.hidden.filter((k) => k !== c.key) : [...s.hidden, c.key] }
    )
  const exportCsv = () => {
    const cols = visible.filter((c) => !c.noCsv)
    downloadCsv(`${csvName ?? id}.csv`, [cols.map((c) => c.header), ...shownRows.map((r) => cols.map((c) => c.value(r)))])
  }

  const page = shownRows.slice(0, limit)
  const firstSum = visible.findIndex((c) => c.sum)
  const labelSpan = firstSum > 0 ? firstSum : visible.length
  const sums = (rs: T[]) =>
    Object.fromEntries(visible.filter((c) => c.sum).map((c) => [c.key, rs.reduce((s, r) => s + (Number(c.value(r)) || 0), 0)]))

  const table = (
    <table className="w-full text-[15px] [&_td+td]:pl-4 [&_th+th]:pl-4">
      <thead className="sticky top-0 z-10 bg-paper">
        <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
          {visible.map((c) => {
            const active = saved.sort === c.key
            const right = c.align === 'right'
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={active ? (saved.desc ? 'descending' : 'ascending') : undefined}
                className={'py-1.5 font-medium whitespace-nowrap ' + (right ? 'text-right' : '')}
              >
                {c.sortable === false || !c.header ? (
                  c.header
                ) : (
                  <button type="button" onClick={() => setSort(c.key)} className={active ? 'text-ink' : 'hover:text-ink'}>
                    {c.header}
                    <span aria-hidden className={active ? '' : 'invisible'}>
                      {saved.desc ? ' ↓' : ' ↑'}
                    </span>
                  </button>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {page.map((r, i) => {
          const g = group?.value(r)
          const startsGroup = group && (i === 0 || group.value(page[i - 1]) !== g)
          const members = startsGroup ? shownRows.filter((x) => group!.value(x) === g) : []
          const s = startsGroup ? sums(members) : {}
          return (
            <Fragment key={rowKey(r, i)}>
              {startsGroup && (
                <tr className="border-b border-rule-strong">
                  {/* The group name spans every column up to the first total, so it never widens a column. */}
                  <th scope="rowgroup" colSpan={labelSpan} className="pt-5 pb-1.5 text-left">
                    <span className="wide text-[15px] font-semibold">{g || 'Not known'}</span>
                    <span className="ml-2 text-[13px] font-normal text-ink-muted">{members.length}</span>
                  </th>
                  {visible.slice(labelSpan).map((c) => (
                    <th key={c.key} className={'pt-5 pb-1.5 ' + (c.align === 'right' ? 'num font-semibold' : 'text-left')}>
                      {c.sum ? s[c.key]?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : null}
                    </th>
                  ))}
                </tr>
              )}
              <tr
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                className={'border-b border-rule align-top ' + (onRowClick ? 'cursor-pointer hover:bg-sheet/70 focus-visible:bg-sheet' : '')}
              >
                {visible.map((c) => (
                  <td key={c.key} className={'py-1.5 ' + (c.align === 'right' ? 'num ' : '') + (c.className ?? '')}>
                    {c.render ? c.render(r) : (c.value(r) ?? '')}
                  </td>
                ))}
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
          placeholder={filterPlaceholder}
          aria-label={filterPlaceholder}
          className="w-64 rounded-md border border-rule-strong bg-sheet px-2.5 py-1 text-ink placeholder:text-ink-muted/70"
        />
        {groups.length > 0 && (
          <label className="flex items-center gap-1.5">
            Group by
            <select
              value={saved.group ?? ''}
              onChange={(e) => setSaved((s) => ({ ...s, group: e.target.value || null }))}
              className="rounded border border-rule-strong bg-sheet px-1.5 py-1 text-ink"
            >
              <option value="">Nothing</option>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded border border-rule-strong px-2.5 py-1 hover:bg-sheet">Columns</summary>
          <div className="absolute z-20 mt-1 w-56 rounded-md border border-rule-strong bg-sheet p-2 shadow-lg">
            {columns
              .filter((c) => !c.always && c.header)
              .map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-paper">
                  <input type="checkbox" checked={visible.includes(c)} onChange={() => toggleCol(c)} />
                  {c.header}
                </label>
              ))}
          </div>
        </details>
        <button type="button" onClick={exportCsv} disabled={!shownRows.length} className="rounded border border-rule-strong px-2.5 py-1 hover:bg-sheet disabled:opacity-50">
          Download CSV
        </button>
        <span className="text-ink-muted">
          {shownRows.length === rows.length ? `${rows.length} rows` : `${shownRows.length} of ${rows.length} rows`}
        </span>
        {toolbar}
      </div>
      {!shownRows.length ? (
        <p className="py-6 text-[14px] text-ink-muted">{query ? 'Nothing matches that filter.' : empty}</p>
      ) : maxHeight ? (
        <div className="overflow-auto" style={{ maxHeight }}>
          {table}
        </div>
      ) : (
        table
      )}
      {shownRows.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE * 3)} className="mt-3 text-[14px] text-stamp hover:underline">
          Show more ({shownRows.length - limit} left)
        </button>
      )}
    </div>
  )
}
