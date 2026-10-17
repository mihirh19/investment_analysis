import { useState } from 'react'
import type { ChartGroup } from '@shared/assets'
import { GROUP_COLORS, GROUP_LABELS } from '../../../src/renderer/src/lib/labels'
import { useData } from '../lib/data'
import { Card, day, inr, lakhCrore, Seg, signed, today, tone, Trend } from '../ui'

/** Whose money is shown, remembered between visits. */
export function useScopeKey(): [string, (k: string) => void] {
  const [k, setK] = useState(() => localStorage.getItem('fp.scope') ?? 'family')
  return [k, (v: string) => (localStorage.setItem('fp.scope', v), setK(v))]
}

export function ScopePicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const { snapshot } = useData()
  if (!snapshot || snapshot.persons.length < 2) return null
  return (
    <div className="mb-3">
      <Seg
        label="Whose money"
        value={value}
        onChange={onChange}
        options={[{ value: 'family', label: 'Family' }, ...snapshot.persons.map((p) => ({ value: String(p.id), label: p.name }))]}
      />
    </div>
  )
}

const daysTo = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today())) / 86400000)

export function Home() {
  const { snapshot, pending } = useData()
  const [scope, setScope] = useScopeKey()
  if (!snapshot) return null
  const s = snapshot.scopes[scope] ?? snapshot.scopes.family
  const personName = scope === 'family' ? null : snapshot.persons.find((p) => String(p.id) === scope)?.name
  const mine = <T extends { personName?: string; personId?: number }>(x: T) =>
    !personName || x.personName === personName || x.personId === Number(scope)

  // What needs doing: the reminders worth acting on now.
  const attention: { key: string; tone: 'loss' | 'warn'; title: string; detail: string }[] = []
  for (const v of snapshot.vehicles.filter(mine))
    for (const r of v.reminders.filter((r) => r.level !== 'OK'))
      attention.push({
        key: `v${v.id}${r.key}`,
        tone: r.level === 'OVERDUE' ? 'loss' : 'warn',
        title: `${v.regDisplay}: ${r.label}`,
        detail: r.date ? (r.days! < 0 ? `${-r.days!} days overdue` : `due ${day(r.date)}`) : r.detail
      })
  for (const p of snapshot.properties.filter(mine)) {
    if (p.rent && p.rent.overdue > 0)
      attention.push({
        key: `p${p.accountId}`,
        tone: 'loss',
        title: `${p.meta.name}: rent overdue`,
        detail: `${inr(p.rent.overdue)}, ${p.rent.overdueMonths} month${p.rent.overdueMonths > 1 ? 's' : ''}`
      })
    if (p.rent?.endsInDays !== null && p.rent?.endsInDays !== undefined && p.rent.endsInDays <= 45)
      attention.push({
        key: `t${p.accountId}`,
        tone: 'warn',
        title: `${p.meta.name}: agreement`,
        detail: p.rent.endsInDays < 0 ? `ended ${-p.rent.endsInDays} days ago` : `ends in ${p.rent.endsInDays} days`
      })
  }
  for (const pol of snapshot.policies.filter(mine))
    if (pol.nextDue && daysTo(pol.nextDue) <= 30)
      attention.push({
        key: `i${pol.name}`,
        tone: daysTo(pol.nextDue) < 0 ? 'loss' : 'warn',
        title: `${pol.name}: premium`,
        detail: `${inr(pol.premium)} due ${day(pol.nextDue)}`
      })

  const total = s.byGroup.reduce((a, g) => a + g.value, 0)
  const soon = s.upcoming.filter((u) => daysTo(u.date) <= 45).slice(0, 8)

  return (
    <>
      <ScopePicker value={scope} onChange={setScope} />
      <Card>
        <div className="text-[14px] text-ink-muted">{personName ? `${personName}’s net worth` : 'Net worth'}</div>
        <div className="wide num text-left text-[40px] leading-tight font-semibold">{lakhCrore(s.netWorth)}</div>
        <div className={`num text-left text-[15px] ${tone(s.dayChange)}`}>{signed(s.dayChange)} today</div>
        <div className="mt-3">
          <Trend values={s.history.values} />
        </div>
        <div className="mt-2 flex justify-between text-[13px] text-ink-muted">
          <span>Put in {lakhCrore(s.invested)}</span>
          <span>
            {s.xirr !== null ? `${(s.xirr * 100).toFixed(1)}% a year (XIRR)` : ''}
          </span>
        </div>
      </Card>

      {(attention.length > 0 || pending.length > 0) && (
        <Card title="Needs attention">
          <ul>
            {attention.map((a) => (
              <li key={a.key} className="flex items-start gap-2 border-b border-rule py-2 last:border-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === 'loss' ? 'bg-loss' : 'bg-warn'}`} aria-hidden />
                <div className="min-w-0">
                  <div className="text-[15px]">{a.title}</div>
                  <div className={`text-[13px] ${a.tone === 'loss' ? 'text-loss' : 'text-warn'}`}>{a.detail}</div>
                </div>
              </li>
            ))}
            {pending.length > 0 && (
              <li className="py-2 text-[14px] text-ink-muted">
                {pending.length} entr{pending.length === 1 ? 'y' : 'ies'} from this phone waiting for the computer to sync.
              </li>
            )}
          </ul>
        </Card>
      )}

      {soon.length > 0 && (
        <Card title="Coming up" aside="next 45 days">
          <ul>
            {soon.map((u, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-rule py-2 text-[15px] last:border-0">
                <div className="min-w-0">
                  <div className="truncate">{u.label}</div>
                  <div className="truncate text-[13px] text-ink-muted">
                    {day(u.date)}, {u.holding}
                  </div>
                </div>
                <div className={`num shrink-0 ${tone(u.amount)}`}>{signed(u.amount)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Where it is">
        <div className="mb-3 flex h-3 overflow-hidden rounded-full" aria-hidden>
          {s.byGroup.map((g) => (
            <div key={g.group} style={{ width: `${(g.value / total) * 100}%`, background: GROUP_COLORS[g.group as ChartGroup] }} />
          ))}
        </div>
        <ul>
          {s.byGroup.map((g) => (
            <li key={g.group} className="flex items-center justify-between py-1 text-[15px]">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_COLORS[g.group as ChartGroup] }} aria-hidden />
                {GROUP_LABELS[g.group as ChartGroup]}
              </span>
              <span className="num">
                {lakhCrore(g.value)} <span className="text-[13px] text-ink-muted">{((g.value / total) * 100).toFixed(0)}%</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Income this financial year">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['Dividends', s.incomeThisFy.dividends],
              ['Interest', s.incomeThisFy.interest],
              ['Rent', s.incomeThisFy.rent]
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <div className="num text-center text-[17px] font-semibold">{lakhCrore(v)}</div>
              <div className="text-[12px] text-ink-muted">{k}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
