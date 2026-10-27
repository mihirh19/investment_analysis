import { useState } from 'react'
import { SUPPORT_SCHEMES, type FarmReport, type SupportScheme } from '@shared/farm'
import { ErrorNote } from './Shell'
import { Button, Field, Input, Select } from './ui'
import { useDeleteFarmSupport, usePersons, useSaveFarmSupport } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { useScope } from '../lib/scope'

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** PM-KISAN instalments, crop insurance or crop-loss claims and subsidies: what came in, and which PM-KISAN periods are still to come. */
export function FarmSupportSection({ r }: { r: FarmReport }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveFarmSupport()
  const del = useDeleteFarmSupport()
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState({ personId: 0, scheme: 'PM_KISAN' as SupportScheme, date: today(), amount: '2000', note: '' })
  const s = r.support
  const personId = v.personId || (scope === 'family' ? (persons[0]?.id ?? 0) : scope)

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4">
        <h2 className="wide text-[19px] font-semibold">Government support</h2>
        {!adding && (
          <button type="button" className="text-[13px] text-stamp hover:underline" onClick={() => setAdding(true)}>
            Add money received
          </button>
        )}
      </div>

      {s.pmKisan.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 text-[14px] font-medium">PM-KISAN this year ({r.thisFy.fy})</h3>
          <table className="text-[14px]">
            <tbody>
              {s.pmKisan.map((p) => (
                <tr key={p.personId} className="border-b border-rule">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {p.personName}
                  </th>
                  {p.periods.map((x) => (
                    <td key={x.label} className="px-3 py-1">
                      <span className="block text-[12px] text-ink-muted">{x.label}</span>
                      {x.received ? (
                        <span className="text-gain">{money(x.received.amount)} on {shortDate(x.received.date)}</span>
                      ) : x.due ? (
                        <span className="text-warn">Not recorded yet</span>
                      ) : (
                        <span className="text-ink-muted">Later</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-ink-muted">₹2,000 for each of the three periods. A missing instalment often means e-KYC or the land record needs updating; check the beneficiary status on pmkisan.gov.in.</p>
        </div>
      )}

      {adding && (
        <form
          className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-rule bg-sheet p-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate([{ personId, scheme: v.scheme, date: v.date, amount: Number(v.amount), note: v.note }], {
              onSuccess: () => {
                setAdding(false)
                setV((x) => ({ ...x, note: '' }))
              }
            })
          }}
        >
          <Field label="Whose">
            <Select value={personId} onChange={(e) => setV({ ...v, personId: Number(e.target.value) })}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What">
            <Select
              value={v.scheme}
              onChange={(e) => {
                const scheme = e.target.value as SupportScheme
                setV({ ...v, scheme, amount: scheme === 'PM_KISAN' ? '2000' : v.amount === '2000' ? '' : v.amount })
              }}
            >
              {(Object.keys(SUPPORT_SCHEMES) as SupportScheme[]).map((k) => (
                <option key={k} value={k}>
                  {SUPPORT_SCHEMES[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Came in on">
            <Input type="date" required max={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" required min="1" step="any" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} className="w-32" />
          </Field>
          <Field label="Note" hint="Optional: season, crop, scheme name">
            <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
          <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}
      <ErrorNote error={save.error ?? del.error} />

      {s.entries.length > 0 ? (
        <table className="w-full max-w-[860px] text-[14px]">
          <tbody>
            {s.entries.slice(0, 12).map((e) => (
              <tr key={e.id} className="border-b border-rule">
                <td className="py-1">{shortDate(e.date)}</td>
                <td className="px-2">{SUPPORT_SCHEMES[e.scheme]}</td>
                {scope === 'family' && <td className="px-2 text-ink-muted">{e.personName}</td>}
                <td className="px-2 text-ink-muted">{e.note ?? ''}</td>
                <td className="num px-2">{money(e.amount)}</td>
                <td className="w-16 text-right">
                  <button type="button" className="text-[13px] text-loss hover:underline" onClick={() => del.mutate([e.id])}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        !adding && <p className="max-w-[80ch] text-[14px] text-ink-muted">Record PM-KISAN instalments, crop insurance or crop-loss payments and subsidies as they come in; they count in the farm&rsquo;s income for the year.</p>
      )}
      {r.thisFy.support > 0 && <p className="mt-2 text-[13px] text-ink-muted">{money(r.thisFy.support)} received so far in {r.thisFy.fy}.</p>}
    </section>
  )
}
