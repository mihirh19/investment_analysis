import { useState } from 'react'
import type { ChartGroup } from '@shared/assets'
import { CROPS } from '@shared/farm'
import type { PhoneTax } from '@shared/phone'
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

/** Gains booked this financial year, tax-free room left, and lots worth knowing about. */
function TaxCard({ tax }: { tax: PhoneTax }) {
  const [open, setOpen] = useState(false)
  const used = Math.max(0, tax.exemptionLimit - tax.exemptionLeft)
  return (
    <Card title={`Tax this year`} aside={tax.fy}>
      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ['Long-term booked', tax.longTermGain],
            ['Short-term booked', tax.shortTermGain],
            ['Tax (fixed rates)', tax.fixedRateTax]
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <div className="num text-center text-[17px] font-semibold">{lakhCrore(v)}</div>
            <div className="text-[12px] text-ink-muted">{k}</div>
          </div>
        ))}
      </div>
      {tax.exemptionLimit > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-[14px]">
            <span>Tax-free long-term gain left</span>
            <span className="num font-semibold">{inr(tax.exemptionLeft)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-rule/60" aria-hidden>
            <div className="h-full rounded-full bg-gain" style={{ width: `${Math.min(100, (used / tax.exemptionLimit) * 100)}%` }} />
          </div>
          <div className="mt-1 text-[12px] text-ink-muted">
            {inr(used)} used of {inr(tax.exemptionLimit)}
          </div>
        </div>
      )}
      <div className="mt-3 flex justify-between text-[13px] text-ink-muted">
        <span>Not booked: long-term {lakhCrore(tax.unrealized.longTerm)}</span>
        <span>short-term {lakhCrore(tax.unrealized.shortTerm)}</span>
      </div>
      {tax.slabGain !== 0 && <p className="mt-1 text-[12px] text-ink-muted">{inr(tax.slabGain)} of gains is taxed at your slab rate, with income.</p>}
      {(tax.harvest.length > 0 || tax.soonLongTerm.length > 0) && (
        <>
          <button className="mt-3 min-h-10 text-[14px] text-stamp" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide details' : `Details: ${tax.harvest.length ? `${tax.harvest.length} can use the tax-free room` : ''}${tax.harvest.length && tax.soonLongTerm.length ? ', ' : ''}${tax.soonLongTerm.length ? `${tax.soonLongTerm.length} turn long-term soon` : ''}`}
          </button>
          {open && (
            <div className="text-[14px]">
              {tax.harvest.length > 0 && (
                <>
                  <h3 className="mt-2 mb-1 font-semibold">Long-term gains within the tax-free room</h3>
                  <p className="mb-1 text-[12px] text-ink-muted">Selling and buying back books the gain tax-free this year (the Tax page on the computer explains it).</p>
                  <ul>
                    {tax.harvest.map((h, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b border-rule py-1.5 last:border-0">
                        <div className="min-w-0">
                          <div className="truncate">{h.name}</div>
                          <div className="truncate text-[12px] text-ink-muted">
                            {h.personName}, {h.account}, {h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                          </div>
                        </div>
                        <div className="num shrink-0 text-gain">{inr(h.gain)}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tax.soonLongTerm.length > 0 && (
                <>
                  <h3 className="mt-3 mb-1 font-semibold">Turning long-term soon</h3>
                  <p className="mb-1 text-[12px] text-ink-muted">Gains here are taxed less if sold after the date shown.</p>
                  <ul>
                    {tax.soonLongTerm.map((l, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b border-rule py-1.5 last:border-0">
                        <div className="min-w-0">
                          <div className="truncate">{l.name}</div>
                          <div className="truncate text-[12px] text-ink-muted">
                            {l.personName}, long-term from {day(l.longTermFrom)}
                          </div>
                        </div>
                        <div className="num shrink-0 text-gain">{inr(l.gain)}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

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
  for (const p of snapshot.farm?.prices ?? [])
    if (p.targetReached && p.latest)
      attention.push({
        key: `f${p.crop}`,
        tone: 'warn',
        title: `${CROPS[p.crop].label}: ${inr(p.latest.modal)} a quintal at ${p.market}`,
        detail: `Reached your target of ${inr(p.target)}`
      })
  for (const pol of snapshot.policies.filter(mine))
    if (pol.nextDue && daysTo(pol.nextDue) <= 30)
      attention.push({
        key: `i${pol.name}`,
        tone: daysTo(pol.nextDue) < 0 ? 'loss' : 'warn',
        title: `${pol.name}: premium`,
        detail: `${inr(pol.premium)} due ${day(pol.nextDue)}`
      })

  for (const d of s.spending?.dues ?? [])
    if (daysTo(d.dueDate) <= 7)
      attention.push({
        key: `c${d.name}${d.dueDate}`,
        tone: daysTo(d.dueDate) < 0 ? 'loss' : 'warn',
        title: `${d.name}: card bill`,
        detail: `${inr(d.totalDue)} ${daysTo(d.dueDate) < 0 ? `${-daysTo(d.dueDate)} days overdue` : `due ${day(d.dueDate)}`}`
      })

  const total = s.byGroup.reduce((a, g) => a + g.value, 0)
  const soon = s.upcoming.filter((u) => daysTo(u.date) <= 45).slice(0, 8)

  return (
    <>
      <ScopePicker value={scope} onChange={setScope} />
      <Card>
        <div className="text-[14px] text-ink-muted">{personName ? `${personName}’s net worth` : 'Net worth'}</div>
        <div className="wide num text-left text-[40px] leading-tight font-semibold">{lakhCrore(s.netWorth - (s.owed ?? 0))}</div>
        {(s.owed ?? 0) > 0 && (
          <div className="text-[13px] text-ink-muted">
            Own {lakhCrore(s.netWorth)}, owe <span className="text-loss">{lakhCrore(s.owed!)}</span> on loans
          </div>
        )}
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

      {s.tax && <TaxCard tax={s.tax} />}

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
