import { useMemo, useState } from 'react'
import type { CalendarReport } from '@shared/research'
import { ErrorNote, PageHeader } from '../components/Shell'
import { useCalendar } from '../lib/api'
import { money, shortDate, timeAgo } from '../lib/format'
import { useOpenSymbol } from '../lib/links'

type Filter = 'mine' | 'all'
const today = () => new Date(Date.now() + 19800_000).toISOString().slice(0, 10)
const KIND_LABEL: Record<string, string> = { DIVIDEND: 'Dividend', BONUS: 'Bonus', SPLIT: 'Split', RIGHTS: 'Rights', BUYBACK: 'Buyback', DEMERGER: 'Demerger', OTHER: 'Other' }

/** Results days and corporate actions for the stocks the family holds or watches, from NSE’s calendars. */
export function Calendar() {
  const q = useCalendar()
  const [filter, setFilter] = useState<Filter>('mine')
  const openSymbol = useOpenSymbol()
  const c = q.data
  const t = today()
  const mine = <T extends { held: unknown; watched: boolean }>(r: T) => filter === 'all' || r.held !== null || r.watched
  const results = useMemo(() => (c?.results ?? []).filter(mine), [c, filter])
  const actions = useMemo(() => (c?.actions ?? []).filter(mine), [c, filter])
  const upcomingIncome = actions.filter((a) => a.exDate >= t).reduce((s, a) => s + (a.expectedInr ?? 0), 0)

  return (
    <>
      <PageHeader title="Results and dividends ahead" />
      <ErrorNote error={q.error} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
        <div role="group" aria-label="Which companies" className="flex rounded-sm border border-rule">
          {(['mine', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 ${filter === f ? 'bg-stamp text-black' : 'text-ink-muted hover:text-ink'}`}
            >
              {f === 'mine' ? 'Held and watched' : 'All companies'}
            </button>
          ))}
        </div>
        <span className="text-ink-muted">{c?.updatedAt ? `From NSE, updated ${timeAgo(c.updatedAt)}` : 'Waiting for the first download from NSE (Research must be on).'}</span>
      </div>

      {upcomingIncome > 0 && (
        <p className="mb-6 text-[14px]">
          Dividends coming to the family in the next 90 days: <span className="num font-semibold text-gain">{money(upcomingIncome, 'INR', 0)}</span>{' '}
          <span className="text-ink-muted">before tax, on shares held today.</span>
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">Results days</h2>
        {results.length === 0 ? (
          <p className="text-[13px] text-ink-muted">{filter === 'mine' ? 'No board meetings announced for your companies in the next 45 days.' : 'Nothing announced yet.'}</p>
        ) : (
          <Rows>
            {results.map((r) => (
              <tr key={`${r.symbol}|${r.date}|${r.purpose}`} className={`border-b border-rule ${r.date < t ? 'text-ink-muted' : ''}`}>
                <td className="num w-24 py-1 text-left">{shortDate(r.date)}</td>
                <td className="px-2">
                  <Company symbol={r.symbol} name={r.company} onOpen={openSymbol} />
                </td>
                <td className="px-2 text-ink-muted">{r.purpose}</td>
                <td className="px-2 text-right">
                  <Badge held={r.held} watched={r.watched} />
                </td>
              </tr>
            ))}
          </Rows>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-[15px] font-semibold text-stamp">Dividends and other corporate actions</h2>
        <p className="mb-2 text-[13px] text-ink-muted">To get a dividend, the shares must be in your demat account before the ex-date.</p>
        {actions.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing in the last 30 or next 90 days.</p>
        ) : (
          <Rows>
            {actions.map((a) => (
              <tr key={`${a.symbol}|${a.exDate}|${a.subject}`} className={`border-b border-rule ${a.exDate < t ? 'text-ink-muted' : ''}`}>
                <td className="num w-24 py-1 text-left">{shortDate(a.exDate)}</td>
                <td className="px-2">
                  <Company symbol={a.symbol} name={a.company} onOpen={openSymbol} />
                </td>
                <td className="px-2">
                  <span className="mr-2 text-[12px] text-ink-muted">{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span title={a.subject}>{a.kind === 'DIVIDEND' && a.amount ? `₹${a.amount} a share` : a.subject}</span>
                </td>
                <td className="num px-2">{a.expectedInr ? money(a.expectedInr, 'INR', 0) : ''}</td>
                <td className="px-2 text-right">
                  <Badge held={a.held} watched={a.watched} />
                </td>
              </tr>
            ))}
          </Rows>
        )}
      </section>
    </>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-[13.5px]">
      <tbody>{children}</tbody>
    </table>
  )
}

function Company({ symbol, name, onOpen }: { symbol: string; name: string; onOpen: (s: string) => void }) {
  return (
    <button type="button" className="text-left hover:text-stamp hover:underline" onClick={() => onOpen(symbol)} title={`Open ${symbol}`}>
      {name} <span className="text-[12px] text-ink-muted">{symbol}</span>
    </button>
  )
}

function Badge({ held, watched }: Pick<CalendarReport['results'][number], 'held' | 'watched'>) {
  if (held) return <span className="text-[12px] text-gain" title={held.people.join(', ')}>held · {money(held.valueInr, 'INR', 0)}</span>
  if (watched) return <span className="text-[12px] text-ink-muted">watched</span>
  return null
}
