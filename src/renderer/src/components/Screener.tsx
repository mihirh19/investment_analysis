import { useMemo, useState } from 'react'
import { applyScreen, PRESET_SCREENS, SCREEN_FIELDS, type FieldKey, type Screen, type ScreenFilter } from '@shared/screener'
import { ErrorNote } from './Shell'
import { Button, Input, Select } from './ui'
import { downloadCsv } from './DataTable'
import { BASE_COLUMNS, fieldOf, fromInput, inputUnit, ScreenTable, toInput } from './ScreenTable'
import { useSavedScreens, useSaveScreens, useScreenData } from '../lib/api'
import { shortDate } from '../lib/format'

const BLANK: Screen = {
  name: '',
  about: 'Your own filters.',
  filters: [{ field: 'mcap', op: '>=', value: 1000 * 1e7 }],
  sort: { field: 'mcap', dir: 'desc' }
}

export function Screener() {
  const data = useScreenData()
  const saved = useSavedScreens()
  const save = useSaveScreens()
  const [screen, setScreen] = useState<Screen>(PRESET_SCREENS[0])
  const [naming, setNaming] = useState<string | null>(null)
  const mine = saved.data ?? []
  const isMine = mine.some((s) => s.name === screen.name)

  const rows = useMemo(() => (data.data ? applyScreen(data.data.rows, screen) : []), [data.data, screen])
  const columns = useMemo(() => {
    const extra = screen.filters.map((f) => f.field).filter((k) => !BASE_COLUMNS.includes(k))
    return [...BASE_COLUMNS, ...new Set(extra)]
  }, [screen.filters])

  const setFilter = (i: number, f: ScreenFilter | null) =>
    setScreen((s) => ({ ...s, filters: f ? s.filters.map((x, j) => (j === i ? f : x)) : s.filters.filter((_, j) => j !== i) }))

  const d = data.data
  return (
    <div className="grid gap-6 @5xl:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="Screens" className="flex flex-col gap-px text-[14px]">
        <div className="mb-1 text-[12.5px] text-ink-muted">Ready-made</div>
        {PRESET_SCREENS.map((s) => (
          <ScreenLink key={s.name} s={s} on={screen.name === s.name && !isMine} pick={() => setScreen(s)} />
        ))}
        <div className="mt-4 mb-1 text-[12.5px] text-ink-muted">Yours</div>
        {mine.map((s) => (
          <ScreenLink key={s.name} s={s} on={screen.name === s.name} pick={() => setScreen(s)} />
        ))}
        <button type="button" onClick={() => setScreen({ ...BLANK })} className="mt-1 rounded px-2 py-1 text-left text-stamp hover:bg-sheet">
          + New screen
        </button>
      </nav>

      <div className="min-w-0">
        <ErrorNote error={data.error ?? save.error} />
        <section aria-label="Filters" className="mb-4 rounded-md border border-rule bg-sheet p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-semibold">{screen.name || 'New screen'}</h2>
            <p className="text-[13px] text-ink-muted">{screen.about}</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {screen.filters.map((f, i) => (
              <FilterRow key={`${i}-${f.field}`} f={f} onChange={(x) => setFilter(i, x)} />
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px]">
            <button
              type="button"
              className="text-stamp hover:underline"
              onClick={() => setScreen((s) => ({ ...s, filters: [...s.filters, { field: 'roe', op: '>=', value: 0.15 }] }))}
            >
              + Add a filter
            </button>
            <label className="flex items-center gap-1.5 text-ink-muted">
              <input type="checkbox" checked={!!screen.noLenders} onChange={(e) => setScreen((s) => ({ ...s, noLenders: e.target.checked }))} />
              Leave out banks and lenders
            </label>
            <span className="ml-auto flex items-center gap-2">
              {naming === null ? (
                <>
                  <Button variant="quiet" className="!py-1 !text-[13.5px]" onClick={() => setNaming(isMine ? screen.name : '')}>
                    {isMine ? 'Save changes' : 'Save as mine'}
                  </Button>
                  {isMine && (
                    <Button variant="danger" className="!py-1 !text-[13.5px]" onClick={() => save.mutate(mine.filter((s) => s.name !== screen.name))}>
                      Delete
                    </Button>
                  )}
                </>
              ) : (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const name = naming.trim()
                    if (!name) return
                    const next: Screen = { ...screen, name, about: screen.about === BLANK.about || !isMine ? 'Your own filters.' : screen.about, rank: undefined }
                    save.mutate([...mine.filter((s) => s.name !== name && s.name !== screen.name), next])
                    setScreen(next)
                    setNaming(null)
                  }}
                >
                  <Input autoFocus aria-label="Name for this screen" value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name" className="!py-1 !text-[13.5px]" />
                  <Button type="submit" className="!py-1 !text-[13.5px]">
                    Save
                  </Button>
                  <Button type="button" variant="quiet" className="!py-1 !text-[13.5px]" onClick={() => setNaming(null)}>
                    Cancel
                  </Button>
                </form>
              )}
            </span>
          </div>
        </section>

        {d && (
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3 text-[13.5px] text-ink-muted">
            <span aria-live="polite">
              <strong className="text-ink">{rows.length.toLocaleString('en-IN')}</strong> {rows.length === 1 ? 'company matches' : 'companies match'}
              {screen.rank === 'magic' ? ', ranked by earnings yield and ROCE together' : ''}. Results are in for{' '}
              {d.withResults.toLocaleString('en-IN')} of {d.companies.toLocaleString('en-IN')} companies
              {d.pricesDate ? `, prices of ${shortDate(d.pricesDate)}` : ''}.
            </span>
            <button
              type="button"
              className="text-stamp hover:underline"
              onClick={() =>
                downloadCsv(`${screen.name || 'screen'}.csv`, [
                  ['Symbol', 'Company', 'Industry', ...columns.map((k) => fieldOf(k).label)],
                  ...rows.map((r) => [r.symbol, r.name, r.industry ?? '', ...columns.map((k) => (typeof r[k] === 'number' ? (r[k] as number) : null))])
                ])
              }
            >
              Download CSV
            </button>
          </div>
        )}
        {data.isLoading && <p className="text-ink-muted">Reading every company…</p>}
        {d && rows.length > 0 && (
          <ScreenTable
            key={screen.name + JSON.stringify(screen.filters)}
            rows={rows}
            columns={columns}
            initialSort={screen.rank ? null : screen.sort}
            label={`${screen.name || 'Screen'} results`}
          />
        )}
        {d && rows.length === 0 && (
          <p className="text-[14.5px] text-ink-muted">
            No company passes every filter{d.withResults < d.companies / 2 ? ' yet: most companies’ results are still downloading' : ''}. Loosen a
            filter to see more.
          </p>
        )}
        <p className="mt-6 text-[12.5px] text-ink-muted">
          A screen is a filter on reported figures, not a view on what to buy. A company with a figure missing is left out of any filter on that
          figure.
        </p>
      </div>
    </div>
  )
}

function ScreenLink({ s, on, pick }: { s: Screen; on: boolean; pick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={s.about}
      onClick={pick}
      className={'rounded px-2 py-1 text-left ' + (on ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet hover:text-ink')}
    >
      {s.name}
    </button>
  )
}

function FilterRow({ f, onChange }: { f: ScreenFilter; onChange: (f: ScreenFilter | null) => void }) {
  const field = fieldOf(f.field)
  const [text, setText] = useState(toInput(field.kind, f.value))
  return (
    <li className="flex flex-wrap items-center gap-2 text-[14px]">
      <Select
        aria-label="Figure"
        value={f.field}
        onChange={(e) => {
          const k = e.target.value as FieldKey
          const nf = fieldOf(k)
          const value = nf.kind === 'pct' ? 0.15 : nf.kind === 'money' ? 1000 * 1e7 : nf.kind === 'score' ? 7 : 1
          setText(toInput(nf.kind, value))
          onChange({ field: k, op: nf.better === 'low' ? '<=' : '>=', value })
        }}
        className="!py-1 !text-[14px]"
      >
        {SCREEN_FIELDS.map((x) => (
          <option key={x.key} value={x.key}>
            {x.label}
          </option>
        ))}
      </Select>
      <Select aria-label="At least or at most" value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value as ScreenFilter['op'] })} className="!py-1 !text-[14px]">
        <option value=">=">at least</option>
        <option value="<=">at most</option>
      </Select>
      <span className="flex items-center gap-1">
        <Input
          aria-label={`${field.label} value`}
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const v = fromInput(field.kind, e.target.value)
            if (v !== null) onChange({ ...f, value: v })
          }}
          className="num w-24 !py-1 !text-[14px]"
        />
        <span className="text-[13px] text-ink-muted">{inputUnit(field.kind)}</span>
      </span>
      <button type="button" aria-label={`Remove the ${field.label} filter`} onClick={() => onChange(null)} className="ml-1 px-1 text-ink-muted hover:text-loss">
        ✕
      </button>
    </li>
  )
}
