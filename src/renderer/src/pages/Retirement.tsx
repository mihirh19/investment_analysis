import { useState, type FormEvent } from 'react'
import type { EpfAccountView } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  useAddEpfEntry,
  useAddNps,
  useAddNpsAccount,
  useDeleteEpfEntry,
  useEpf,
  useHoldings,
  useNpsSchemes,
  usePersons,
  useRemoveHolding,
  useSaveEpf
} from '../lib/api'
import { money, percent, shortDate, signedMoney, toneClass, units } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const today = () => new Date().toISOString().slice(0, 10)
const gainOf = (h: { marketValueInr: number | null; investedInr: number | null }) =>
  h.marketValueInr !== null && h.investedInr !== null ? h.marketValueInr - h.investedInr : null

export function Retirement() {
  const { scope } = useScope()
  const epf = useEpf()
  const holdings = useHoldings(scopePersonId(scope))
  const [editing, setEditing] = useState<EpfAccountView | 'new' | null>(null)
  const [addingNps, setAddingNps] = useState<'account' | 'units' | null>(null)
  const remove = useRemoveHolding()

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
            <Button variant="quiet" onClick={() => setAddingNps('account')}>
              Add your NPS
            </Button>
          )}
        </div>
        {addingNps === 'account' && (
          <NpsAccountForm onDone={() => setAddingNps(null)} onUnits={() => setAddingNps('units')} />
        )}
        {addingNps === 'units' && <NpsForm onDone={() => setAddingNps(null)} />}
        {nps.length === 0 && !addingNps && (
          <p className="max-w-[72ch] text-ink-muted">
            NPS comes in with your NSDL/CDSL CAS when it includes it. Bought through Zerodha Coin, a bank or eNPS? Add
            it from that screen: the value and amount invested in each scheme. It is then valued at each day&rsquo;s
            NAV.
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
                <th className="num py-1.5 font-medium">Invested</th>
                <th className="num py-1.5 font-medium">Value</th>
                <th className="num py-1.5 font-medium">Gain</th>
                <th />
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
                  <td className="num py-2 text-ink-muted">{h.investedInr !== null ? money(h.investedInr) : '—'}</td>
                  <td className="num py-2 font-medium">{money(h.marketValueInr)}</td>
                  <td className={`num py-2 ${toneClass(gainOf(h))}`}>
                    {gainOf(h) !== null ? signedMoney(gainOf(h)) : ''}
                    {gainOf(h) !== null && h.investedInr ? (
                      <div className="text-[12px]">{percent(gainOf(h)! / h.investedInr)}</div>
                    ) : null}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      className="px-2 text-[13px] text-loss hover:underline"
                      onClick={() =>
                        confirm(
                          `Remove ${h.instrumentName}?${h.accountName.startsWith('NPS') ? '' : ' It comes back if the statement it came from is imported again.'}`
                        ) && remove.mutate([h.accountId, h.instrumentId])
                      }
                    >
                      Remove
                    </button>
                  </td>
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

const NPS_MANAGERS = [
  ['SBI', 'SBI Pension Funds'],
  ['LIC', 'LIC Pension Fund'],
  ['UTI', 'UTI Retirement Solutions'],
  ['HDFC', 'HDFC Pension Fund'],
  ['ICICI', 'ICICI Prudential Pension Fund'],
  ['KOTAK', 'Kotak Mahindra Pension Fund'],
  ['ABSL', 'Aditya Birla Sun Life Pension'],
  ['TATA', 'Tata Pension Fund'],
  ['AXIS', 'Axis Pension Fund (Max Life)'],
  ['DSP', 'DSP Pension Fund']
] as const
const NPS_SCHEMES = [
  ['E', 'Scheme E: equity'],
  ['C', 'Scheme C: corporate bonds'],
  ['G', 'Scheme G: government bonds'],
  ['A', 'Scheme A: alternatives (closed in 2023)']
] as const
type Letter = (typeof NPS_SCHEMES)[number][0]

/** NPS the way a POP's screen shows it: one pension fund, one tier, value and invested per scheme. */
function NpsAccountForm({ onDone, onUnits }: { onDone: () => void; onUnits: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const add = useAddNpsAccount()
  const [personId, setPersonId] = useState<number>(scope === 'family' ? (persons[0]?.id ?? 1) : scope)
  const [pran, setPran] = useState('')
  const [manager, setManager] = useState('HDFC')
  const [tier, setTier] = useState<'I' | 'II'>('I')
  const [route, setRoute] = useState<'POP' | 'DIRECT' | 'GS'>('POP')
  const [rows, setRows] = useState<Record<Letter, { value: string; invested: string }>>({
    E: { value: '', invested: '' },
    C: { value: '', invested: '' },
    G: { value: '', invested: '' },
    A: { value: '', invested: '' }
  })
  const setRow = (k: Letter, patch: Partial<{ value: string; invested: string }>) =>
    setRows((r) => ({ ...r, [k]: { ...r[k], ...patch } }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      [
        {
          personId,
          pran,
          manager,
          tier,
          route,
          rows: NPS_SCHEMES.map(([letter]) => ({ letter, ...rows[letter] }))
            .filter((r) => Number(r.value) > 0)
            .map((r) => ({ letter: r.letter, value: Number(r.value), invested: r.invested ? Number(r.invested) : null }))
        }
      ],
      { onSuccess: onDone }
    )
  }
  return (
    <form onSubmit={submit} className="anim-pop mb-8 rounded-md border border-rule bg-sheet p-5">
      <p className="mb-4 max-w-[72ch] text-[14px] text-ink-muted">
        Copy the figures from Zerodha Coin (NPS), your bank or eNPS: for each scheme, what it is worth now (Current) and
        what went in (Invested). The units are worked out from today&rsquo;s NAV.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Field label="Whose">
          <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pension fund">
          <Select value={manager} onChange={(e) => setManager(e.target.value)}>
            {NPS_MANAGERS.map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tier">
          <Select value={tier} onChange={(e) => setTier(e.target.value as 'I' | 'II')}>
            <option value="I">Tier I (pension)</option>
            <option value="II">Tier II (savings)</option>
          </Select>
        </Field>
        <Field label="Bought through" hint={route === 'POP' ? 'Scheme names ending in POP' : undefined}>
          <Select value={route} onChange={(e) => setRoute(e.target.value as 'POP' | 'DIRECT' | 'GS')}>
            <option value="POP">Zerodha Coin, a bank or another POP</option>
            <option value="DIRECT">eNPS directly</option>
            <option value="GS">Government employer</option>
          </Select>
        </Field>
        <Field label="PRAN" hint="Optional">
          <Input value={pran} onChange={(e) => setPran(e.target.value)} />
        </Field>
      </div>
      <table className="mt-5 w-full max-w-[720px] text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
            <th className="py-1.5 font-medium">Scheme</th>
            <th className="num py-1.5 font-medium">Current (₹)</th>
            <th className="num py-1.5 font-medium">Invested (₹)</th>
          </tr>
        </thead>
        <tbody>
          {NPS_SCHEMES.map(([k, label]) => (
            <tr key={k} className="border-b border-rule">
              <td className="py-1.5">{label}</td>
              <td className="py-1 text-right">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`${label} current value`}
                  className="w-32 text-right"
                  value={rows[k].value}
                  onChange={(e) => setRow(k, { value: e.target.value })}
                />
              </td>
              <td className="py-1 text-right">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`${label} invested`}
                  className="w-32 text-right"
                  value={rows[k].invested}
                  onChange={(e) => setRow(k, { invested: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNote error={add.error} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Looking up NAVs…' : 'Add NPS'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <button type="button" className="text-[13px] text-stamp hover:underline" onClick={onUnits}>
          I have the units instead
        </button>
      </div>
    </form>
  )
}
