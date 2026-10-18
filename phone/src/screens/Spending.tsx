import { SPEND_CATEGORY_LABELS, type SpendCategory } from '@shared/ai'
import { useData } from '../lib/data'
import { Card, day, inr, lakhCrore, monthName, today } from '../ui'
import { ScopePicker, useScopeKey } from './Home'

const daysTo = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today())) / 86400000)

/** Card and bank spending, read from statements on the computer. */
export function Spending() {
  const { snapshot } = useData()
  const [scope, setScope] = useScopeKey()
  if (!snapshot) return null
  const sp = (snapshot.scopes[scope] ?? snapshot.scopes.family).spending
  if (!sp)
    return (
      <>
        <ScopePicker value={scope} onChange={setScope} />
        <Card>
          <p className="text-[15px] text-ink-muted">No card or bank statements read for this person yet. Add them on the computer (Spending page).</p>
        </Card>
      </>
    )

  const last = sp.months.at(-1)
  const prev = sp.months.at(-2)
  const cats = Object.entries(last?.byCategory ?? {})
    .map(([k, v]) => [k as SpendCategory, v ?? 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const max = Math.max(...sp.months.map((m) => m.total), 1)

  return (
    <>
      <ScopePicker value={scope} onChange={setScope} />

      {sp.dues.length > 0 && (
        <Card title="Card bills due">
          <ul>
            {sp.dues.map((d) => {
              const n = daysTo(d.dueDate)
              return (
                <li key={`${d.name}${d.dueDate}`} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[15px]">{d.name}</div>
                    <div className={`text-[13px] ${n < 0 ? 'text-loss' : n <= 5 ? 'text-warn' : 'text-ink-muted'}`}>
                      {n < 0 ? `${-n} days overdue` : n === 0 ? 'due today' : `due ${day(d.dueDate)}`}
                      {d.minimumDue ? `, minimum ${inr(d.minimumDue)}` : ''}
                    </div>
                  </div>
                  <div className="num shrink-0 text-[15px] font-semibold">{inr(d.totalDue)}</div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {last && (
        <Card title={`Spent in ${monthName(last.month)}`} aside={prev ? `${monthName(prev.month)}: ${lakhCrore(prev.total)}` : undefined}>
          <div className="wide num mb-3 text-left text-[32px] leading-tight font-semibold">{inr(last.total)}</div>
          <ul>
            {cats.slice(0, 10).map(([k, v]) => (
              <li key={k} className="py-1">
                <div className="flex justify-between text-[15px]">
                  <span>{SPEND_CATEGORY_LABELS[k]}</span>
                  <span className="num">{inr(v)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-rule/60" aria-hidden>
                  <div className="h-full rounded-full bg-stamp" style={{ width: `${(v / last.total) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {sp.months.length > 1 && (
        <Card title="Last months">
          <div className="flex h-28 items-end gap-2" role="img" aria-label={sp.months.map((m) => `${monthName(m.month)} ${inr(m.total)}`).join(', ')}>
            {sp.months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="w-full rounded-t-md bg-stamp/80" style={{ height: `${Math.max(4, (m.total / max) * 88)}px` }} />
                <div className="text-[11px] text-ink-muted">{monthName(m.month)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sp.recent.length > 0 && (
        <Card title="Latest spends">
          <ul>
            {sp.recent.map((t, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{t.merchant}</div>
                  <div className="truncate text-[13px] text-ink-muted">
                    {day(t.date)}, {SPEND_CATEGORY_LABELS[t.category]}, {t.account}
                  </div>
                </div>
                <div className="num shrink-0 text-[15px]">{inr(t.amount)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
