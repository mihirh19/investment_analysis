import { useEffect, useState } from 'react'
import { AUTO_ALERTS, AUTO_LABEL, RULE_KINDS, RULE_LABEL, type RuleKind } from '@shared/alerts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button } from '../components/ui'
import { useAlerts, useDeleteAlertRule, useMarkAlertsRead, useSaveAlertRule, useSetAutoAlerts } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useOpenSymbol } from '../lib/links'

/** Price alerts you set, the automatic ones for your companies, and everything that fired. */
export function Alerts() {
  const q = useAlerts()
  const save = useSaveAlertRule()
  const remove = useDeleteAlertRule()
  const setAuto = useSetAutoAlerts()
  const markRead = useMarkAlertsRead()
  const open = useOpenSymbol()
  const [symbol, setSymbol] = useState('')
  const [kind, setKind] = useState<RuleKind>('above')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const r = q.data
  const unread = r?.unread ?? 0

  // Seen once the screen has been open a moment.
  useEffect(() => {
    if (unread === 0) return
    const t = setTimeout(() => markRead.mutate([]), 4000)
    return () => clearTimeout(t)
  }, [unread])

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    save.mutate([{ symbol, kind, value: Number(value), note }], {
      onSuccess: () => {
        setSymbol('')
        setValue('')
        setNote('')
      }
    })
  }

  return (
    <>
      <PageHeader title="Alerts" />
      <ErrorNote error={q.error ?? save.error ?? remove.error ?? setAuto.error} />
      <div className="grid gap-8 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-8">
          <section aria-labelledby="alert-new">
            <h2 id="alert-new" className="mb-1 text-[15px] font-semibold text-stamp">
              Set a price alert
            </h2>
            <p className="mb-3 text-[13px] text-ink-muted">Checked every 5 minutes while the market is open, on delayed prices. A level fires once; a day’s move fires at most once a day.</p>
            <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-[13.5px]">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-muted">Symbol</span>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="INFY" required className="w-28 rounded-sm border border-rule bg-sheet px-2 py-1" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-muted">When</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} className="rounded-sm border border-rule bg-sheet px-2 py-1">
                  {RULE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {RULE_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-muted">{kind === 'above' || kind === 'below' ? 'Price (₹)' : 'Move (%)'}</span>
                <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required className="num w-24 rounded-sm border border-rule bg-sheet px-2 py-1 text-left" />
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1">
                <span className="text-[12px] text-ink-muted">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-sm border border-rule bg-sheet px-2 py-1" />
              </label>
              <Button type="submit" disabled={save.isPending || !symbol || !value}>
                Add alert
              </Button>
            </form>
          </section>

          {r && r.rules.length > 0 && (
            <section aria-labelledby="alert-rules">
              <h2 id="alert-rules" className="mb-2 text-[15px] font-semibold text-stamp">
                Your alerts
              </h2>
              <ul className="text-[13.5px]">
                {r.rules.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-rule py-1.5">
                    <button type="button" className="font-medium hover:text-stamp hover:underline" onClick={() => open(x.symbol)}>
                      {x.symbol}
                    </button>
                    <span>
                      {RULE_LABEL[x.kind]} <span className="num">{x.kind === 'above' || x.kind === 'below' ? `₹${x.value.toLocaleString('en-IN')}` : `${x.value}%`}</span>
                    </span>
                    {x.note && <span className="text-ink-muted">{x.note}</span>}
                    <span className="ml-auto text-[12px] text-ink-muted">{x.active ? (x.firedAt ? `last fired ${timeAgo(x.firedAt)}` : 'waiting') : `reached ${timeAgo(x.firedAt)}`}</span>
                    {!x.active && (
                      <button type="button" className="text-[12px] text-stamp hover:underline" onClick={() => save.mutate([{ id: x.id, symbol: x.symbol, kind: x.kind, value: x.value, note: x.note }])}>
                        Set again
                      </button>
                    )}
                    <button type="button" className="text-[12px] text-ink-muted hover:text-loss" onClick={() => remove.mutate([x.id])} aria-label={`Delete the ${x.symbol} alert`}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r && (
            <section aria-labelledby="alert-auto">
              <h2 id="alert-auto" className="mb-2 text-[15px] font-semibold text-stamp">
                Automatic alerts
              </h2>
              <ul className="space-y-2 text-[13.5px]">
                {AUTO_ALERTS.map((a) => (
                  <li key={a}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={r.auto[a]} onChange={(e) => setAuto.mutate([{ [a]: e.target.checked }])} />
                      <span>
                        {AUTO_LABEL[a].title}
                        <span className="block text-[12.5px] text-ink-muted">{AUTO_LABEL[a].help}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-ink-muted">These come from the research download, so Research needs to be on.</p>
            </section>
          )}
        </div>

        <section aria-labelledby="alert-events">
          <h2 id="alert-events" className="mb-2 text-[15px] font-semibold text-stamp">
            What fired
          </h2>
          {r && r.events.length === 0 && <p className="text-[13.5px] text-ink-muted">Nothing yet. Alerts also show as Windows notifications.</p>}
          <ul className="text-[13.5px]">
            {r?.events.map((e) => (
              <li key={e.key} className={`border-b border-rule py-2 ${e.read ? '' : 'border-l-2 border-l-stamp pl-2'}`}>
                <div className="flex items-baseline justify-between gap-3">
                  {e.symbol ? (
                    <button type="button" className="text-left font-medium hover:text-stamp hover:underline" onClick={() => open(e.symbol!)}>
                      {e.title}
                    </button>
                  ) : (
                    <span className="font-medium">{e.title}</span>
                  )}
                  <span className="shrink-0 text-[12px] text-ink-muted">{timeAgo(e.at)}</span>
                </div>
                <p className="text-ink-muted">{e.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
