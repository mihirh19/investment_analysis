import { useState } from 'react'
import type { ChartGroup } from '@shared/assets'
import { GROUP_COLORS, GROUP_LABELS } from '../../../src/renderer/src/lib/labels'
import { useData } from '../lib/data'
import { Card, day, inr, lakhCrore, signed, tone } from '../ui'
import { ScopePicker, useScopeKey } from './Home'

export function Holdings() {
  const { snapshot } = useData()
  const [scope, setScope] = useScopeKey()
  const [open, setOpen] = useState<string | null>(null)
  if (!snapshot) return null
  const rows = snapshot.holdings.filter((h) => scope === 'family' || h.personId === Number(scope))
  const groups = new Map<ChartGroup, typeof rows>()
  for (const h of rows) groups.set(h.group, [...(groups.get(h.group) ?? []), h])
  const ordered = [...groups].sort((a, b) => b[1].reduce((s, h) => s + h.value, 0) - a[1].reduce((s, h) => s + h.value, 0))

  return (
    <>
      <ScopePicker value={scope} onChange={setScope} />
      {ordered.map(([group, list]) => {
        const value = list.reduce((s, h) => s + h.value, 0)
        const invested = list.reduce((s, h) => s + (h.invested ?? 0), 0)
        const known = list.filter((h) => h.invested !== null)
        const gain = known.length ? known.reduce((s, h) => s + h.value - h.invested!, 0) : null
        return (
          <Card
            key={group}
            title={GROUP_LABELS[group]}
            aside={
              <span className="num">
                {lakhCrore(value)}
                {gain !== null && invested > 0 && <span className={`ml-2 ${tone(gain)}`}>{((gain / invested) * 100).toFixed(1)}%</span>}
              </span>
            }
          >
            <div className="mb-1 h-1 rounded-full" style={{ background: GROUP_COLORS[group] }} aria-hidden />
            <ul>
              {[...list]
                .sort((a, b) => b.value - a.value)
                .map((h) => {
                  const key = `${h.accountId}:${h.instrumentId}`
                  const g = h.invested !== null ? h.value - h.invested : null
                  const isOpen = open === key
                  return (
                    <li key={key} className="border-b border-rule last:border-0">
                      <button
                        className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : key)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[15px]">{h.name}</span>
                          <span className="block truncate text-[12px] text-ink-muted">{h.account}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="num block text-[15px]">{inr(h.value)}</span>
                          <span className={`num block text-[12px] ${tone(h.dayChange)}`}>
                            {h.dayChange ? `${signed(h.dayChange)} today` : g !== null ? <span className={tone(g)}>{signed(g)}</span> : ''}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pb-3 text-[14px]">
                          <dt className="text-ink-muted">Units</dt>
                          <dd className="num">{h.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</dd>
                          <dt className="text-ink-muted">Price</dt>
                          <dd className="num">
                            {h.price !== null ? `${h.currency === 'USD' ? '$' : '₹'}${h.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                            {h.priceDate && <span className="text-[12px] text-ink-muted"> {day(h.priceDate)}</span>}
                          </dd>
                          <dt className="text-ink-muted">Put in</dt>
                          <dd className="num">{h.invested !== null ? inr(h.invested) : '—'}</dd>
                          <dt className="text-ink-muted">Gain</dt>
                          <dd className={`num ${tone(g)}`}>
                            {signed(g)}
                            {g !== null && h.invested ? ` (${((g / h.invested) * 100).toFixed(1)}%)` : ''}
                          </dd>
                        </dl>
                      )}
                    </li>
                  )
                })}
            </ul>
          </Card>
        )
      })}
    </>
  )
}
