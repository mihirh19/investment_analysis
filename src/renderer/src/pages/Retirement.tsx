import { useState, type FormEvent } from 'react'
import type { EpfAccountView } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  useAddEpfEntry,
  useAddNps,
  useDeleteEpfEntry,
  useEpf,
  useHoldings,
  useNpsSchemes,
  usePersons,
  useSaveEpf
} from '../lib/api'
import { money, percent, shortDate, signedMoney, toneClass, units } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const today = () => new Date().toISOString().slice(0, 10)

export function Retirement() {
  const { scope } = useScope()
  const epf = useEpf()
  const holdings = useHoldings(scopePersonId(scope))
  const [editing, setEditing] = useState<EpfAccountView | 'new' | null>(null)
  const [addingNps, setAddingNps] = useState(false)

  const accounts = (epf.data ?? []).filter((a) => scope === 'family' || a.personId === scope)
  const nps = (holdings.data ?? []).filter((h) => h.assetClass === 'NPS')
  const npsValue = nps.reduce((s, h) => s + (h.marketValueInr ?? 0), 0)
  const epfValue = accounts.reduce((s, a) => s + (a.estimatedBalance ?? 0), 0)

  return (
    <>
      <PageHeader title="EPF & NPS">
        <span className="text-[15px] text-ink-muted">
          Retirement savings <span className="num ml-1 font-semibold text-ink">{money(epfValue + npsValue)}</span>
        </span>
      </PageHeader>
      <ErrorNote error={epf.error ?? holdings.error} />

      <section aria-labelledby="epf">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="epf" className="wide text-[19px] font-semibold">
            EPF
          </h2>
          {editing === null && (
            <Button variant="quiet" onClick={() => setEditing('new')}>
              Add an EPF account
            </Button>
          )}
        </div>
        {editing !== null && <EpfForm account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
        {accounts.length === 0 && editing === null && (
          <p className="max-w-[72ch] text-ink-muted">
            EPFO has no public feed, so EPF is kept from your passbook. Add the account once, then type in the balance
            whenever you check the passbook on the EPFO member portal or UMANG. Between entries the balance grows by
            your monthly contribution and the interest rate.
          </p>
        )}
        <div className="flex flex-col gap-8">
          {accounts.map((a) => (
            <EpfCard key={a.accountId} a={a} showPerson={scope === 'family'} onEdit={() => setEditing(a)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="nps" className="mt-14">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="nps" className="wide text-[19px] font-semibold">
            NPS
          </h2>
          {!addingNps && (
            <Button variant="quiet" onClick={() => setAddingNps(true)}>
              Add NPS units by hand
            </Button>
          )}
        </div>
        {addingNps && <NpsForm onDone={() => setAddingNps(false)} />}
        {nps.length === 0 && !addingNps && (
          <p className="max-w-[72ch] text-ink-muted">
            NPS holdings come in with your NSDL/CDSL CAS when it includes them. Otherwise add the units per scheme from
            your CRA statement and they will be valued at the daily NAV.
          </p>
        )}
        {nps.length > 0 && (
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Scheme</th>
                <th className="num py-1.5 font-medium">Units</th>
                <th className="num py-1.5 font-medium">NAV</th>
                <th className="num py-1.5 font-medium">Day change</th>
                <th className="num py-1.5 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {nps.map((h) => (
                <tr key={`${h.accountId}:${h.instrumentId}`} className="border-b border-rule align-top">
                  <td className="py-2">
                    <div>{h.instrumentName}</div>
                    <div className="condensed text-[12px] text-ink-muted">
                      <span className="mr-3">{h.accountName}</span>
                      {scope === 'family' && h.personName}
                    </div>
                  </td>
                  <td className="num py-2">{units(h.quantity)}</td>
                  <td className="num py-2">
                    {money(h.lastPrice, 'INR', 4)}
                    <div className={'text-[12px] ' + (h.priceSource === 'NAV' ? 'text-ink-muted' : 'text-warn')}>
                      {h.priceSource === 'NAV' ? 'NAV' : 'Statement'}, {shortDate(h.priceDate)}
                    </div>
                  </td>
                  <td className={`num py-2 ${toneClass(h.dayChangeInr)}`}>
                    {h.dayChangeInr !== null ? signedMoney(h.dayChangeInr) : ''}
                  </td>
                  <td className="num py-2 font-medium">{money(h.marketValueInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function EpfCard({ a, showPerson, onEdit }: { a: EpfAccountView; showPerson: boolean; onEdit: () => void }) {
  const add = useAddEpfEntry()
  const del = useDeleteEpfEntry()
  const [date, setDate] = useState(today())
  const [balance, setBalance] = useState('')
  const last = a.entries[a.entries.length - 1]
  const growth = last && a.estimatedBalance ? a.estimatedBalance - last.balance : 0

  return (
    <div className="border-t border-rule-strong pt-3">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <span className="wide text-[17px] font-semibold">{a.name}</span>
          <span className="ml-3 text-[13px] text-ink-muted">
            {[
              showPerson ? a.personName : null,
              a.uan ? `UAN ${a.uan}` : null,
              `${money(a.monthlyContribution)} a month`,
              `${a.interestRate}% a year`
            ]
              .filter(Boolean)
              .join(', ')}
          </span>
        </div>
        <button onClick={onEdit} className="text-[14px] text-stamp hover:underline">
          Edit
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-10 gap-y-1">
        <div>
          <div className="text-[13px] text-ink-muted">Estimated today</div>
          <div className="wide text-[26px] font-semibold">{money(a.estimatedBalance)}</div>
        </div>
        {last && (
          <div className="text-[14px] text-ink-muted">
            Passbook {money(last.balance)} on {shortDate(last.date)}
            {growth > 0 && <> + {money(growth)} contributions and interest since</>}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <table className="text-[14px]">
          <thead>
            <tr className="border-b border-rule text-left text-[13px] text-ink-muted">
              <th className="py-1 font-medium">Passbook date</th>
              <th className="num py-1 font-medium">Balance</th>
              <th className="num py-1 font-medium">Change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...a.entries].reverse().map((e, i, arr) => {
              const prev = arr[i + 1]
              return (
                <tr key={e.date} className="border-b border-rule">
                  <td className="py-1">{shortDate(e.date)}</td>
                  <td className="num py-1">{money(e.balance)}</td>
                  <td className="num py-1 text-ink-muted">
                    {prev ? percent((e.balance - prev.balance) / prev.balance) : ''}
                  </td>
                  <td className="py-0.5 text-right">
                    <button
                      className="px-2 text-[13px] text-loss hover:underline"
                      onClick={() =>
                        confirm(`Remove the ${shortDate(e.date)} entry?`) && del.mutate([a.accountId, e.date])
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <form
          className="flex items-end gap-3"
          onSubmit={(ev) => {
            ev.preventDefault()
            add.mutate([a.accountId, date, Number(balance)], { onSuccess: () => setBalance('') })
          }}
        >
          <Field label="Passbook date">
            <Input type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Total balance (₹)">
            <Input
              type="number"
              required
              min="0"
              step="any"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="w-40"
            />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            Add balance
          </Button>
        </form>
      </div>
      <ErrorNote error={add.error ?? del.error} />
    </div>
  )
}

function EpfForm({ account, onDone }: { account: EpfAccountView | null; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveEpf()
  const [f, setF] = useState({
    personId: account?.personId ?? (scope === 'family' ? (persons[0]?.id ?? 1) : scope),
    name: account?.name ?? '',
    uan: account?.uan ?? '',
    monthlyContribution: String(account?.monthlyContribution ?? ''),
    interestRate: String(account?.interestRate ?? 8.25)
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      [
        {
          accountId: account?.accountId,
          personId: Number(f.personId),
          name: f.name,
          uan: f.uan,
          monthlyContribution: Number(f.monthlyContribution || 0),
          interestRate: Number(f.interestRate)
        }
      ],
      { onSuccess: onDone }
    )
  }
  return (
    <form onSubmit={submit} className="mb-8 rounded-md border border-rule bg-sheet p-5">
      <div className="grid grid-cols-5 gap-4">
        <Field label="Whose">
          <Select value={f.personId} onChange={(e) => setF({ ...f, personId: Number(e.target.value) })}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employer or label">
          <Input required value={f.name} placeholder="Infosys" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="UAN" hint="Optional">
          <Input value={f.uan} onChange={(e) => setF({ ...f, uan: e.target.value })} />
        </Field>
        <Field label="Going in each month (₹)" hint="Your share + employer's EPF share">
          <Input
            type="number"
            min="0"
            step="any"
            value={f.monthlyContribution}
            onChange={(e) => setF({ ...f, monthlyContribution: e.target.value })}
          />
        </Field>
        <Field label="Interest rate (%)" hint="Declared by EPFO each year">
          <Input
            type="number"
            min="0"
            max="20"
            step="0.01"
            required
            value={f.interestRate}
            onChange={(e) => setF({ ...f, interestRate: e.target.value })}
          />
        </Field>
      </div>
      <ErrorNote error={save.error} />
      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {account ? 'Save changes' : 'Add account'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function NpsForm({ onDone }: { onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const schemes = useNpsSchemes(true)
  const add = useAddNps()
  const [filter, setFilter] = useState('')
  const [f, setF] = useState({
    personId: scope === 'family' ? (persons[0]?.id ?? 1) : scope,
    pran: '',
    schemeCode: '',
    units: '',
    date: today()
  })
  const list = (schemes.data ?? []).filter((s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()))
  const chosen = schemes.data?.find((s) => s.code === f.schemeCode)

  return (
    <form
      className="mb-8 rounded-md border border-rule bg-sheet p-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!chosen) return
        add.mutate(
          [
            {
              personId: Number(f.personId),
              pran: f.pran,
              schemeCode: chosen.code,
              schemeName: chosen.name,
              units: Number(f.units),
              date: f.date
            }
          ],
          { onSuccess: onDone }
        )
      }}
    >
      <div className="grid grid-cols-4 gap-4">
        <Field label="Whose">
          <Select value={f.personId} onChange={(e) => setF({ ...f, personId: Number(e.target.value) })}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PRAN" hint="Optional">
          <Input value={f.pran} onChange={(e) => setF({ ...f, pran: e.target.value })} />
        </Field>
        <Field label="Units">
          <Input
            type="number"
            required
            min="0"
            step="any"
            value={f.units}
            onChange={(e) => setF({ ...f, units: e.target.value })}
          />
        </Field>
        <Field label="As of">
          <Input
            type="date"
            required
            max={today()}
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-4">
        <Field label="Find scheme">
          <Input placeholder="e.g. SBI scheme E tier I" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Field>
        <Field label="Scheme">
          <Select required value={f.schemeCode} onChange={(e) => setF({ ...f, schemeCode: e.target.value })}>
            <option value="">{schemes.isLoading ? 'Loading schemes…' : `Choose one of ${list.length}`}</option>
            {list.slice(0, 300).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorNote error={schemes.error ?? add.error} />
      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={add.isPending || !chosen}>
          {add.isPending ? 'Adding…' : 'Add units'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
