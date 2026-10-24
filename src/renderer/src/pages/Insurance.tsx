import { useState, type FormEvent } from 'react'
import {
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type PolicyType,
  type PolicyView,
  type PremiumFrequency
} from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { useDeletePolicy, usePersons, usePolicies, useSavePolicy } from '../lib/api'
import { lakhCrore, money, shortDate } from '../lib/format'
import { useScope } from '../lib/scope'

const TYPE_LABELS: Record<PolicyType, string> = {
  TERM: 'Term (pure cover)',
  ENDOWMENT: 'Endowment',
  ULIP: 'ULIP',
  MONEY_BACK: 'Money back',
  WHOLE_LIFE: 'Whole life',
  HEALTH: 'Health',
  OTHER: 'Other'
}
const FREQ_LABELS: Record<PremiumFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
  SINGLE: 'Single premium'
}
const hasValue = (t: PolicyType) => t !== 'TERM' && t !== 'HEALTH'

export function Insurance() {
  const { scope } = useScope()
  const policies = usePolicies()
  const del = useDeletePolicy()
  const [editing, setEditing] = useState<PolicyView | 'new' | null>(null)
  const list = (policies.data ?? []).filter((p) => scope === 'family' || p.personId === scope)

  const lifeCover = list.filter((p) => p.type !== 'HEALTH').reduce((s, p) => s + p.sumAssured, 0)
  const premiums = list.reduce((s, p) => s + p.annualPremium, 0)
  const value = list.reduce((s, p) => s + (p.currentValue ?? 0), 0)
  const soon = list
    .filter((p) => p.nextDueDate)
    .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!))
    .slice(0, 3)

  return (
    <>
      <PageHeader title="Insurance">
        {editing === null && <Button onClick={() => setEditing('new')}>Add a policy</Button>}
      </PageHeader>
      <ErrorNote error={policies.error ?? del.error} />

      {editing !== null && <PolicyForm policy={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}

      {list.length === 0 && editing === null && (
        <p className="max-w-[72ch] py-4 text-ink-muted">
          Keep every policy in one list: cover, premiums and due dates. Endowment, money-back and ULIP policies also
          count towards net worth at their surrender or fund value; term and health cover never do.
        </p>
      )}

      {list.length > 0 && (
        <>
          <dl className="grid max-w-[880px] grid-cols-2 gap-x-10 gap-y-4 @2xl:grid-cols-4">
            {[
              ['Life cover', lakhCrore(lifeCover)],
              ['Premiums a year', money(premiums)],
              ['Policy value in net worth', money(value)],
              ['Next premium', soon[0] ? `${shortDate(soon[0].nextDueDate)}` : '—']
            ].map(([k, v]) => (
              <div key={k} className="border-t border-rule-strong pt-2">
                <dt className="text-[13px] text-ink-muted">{k}</dt>
                <dd className="wide text-[24px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <table className="mt-10 w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Policy</th>
                <th className="py-1.5 font-medium">Type</th>
                <th className="num py-1.5 font-medium">Cover</th>
                <th className="num py-1.5 font-medium">Premium</th>
                <th className="num py-1.5 font-medium">Next due</th>
                <th className="num py-1.5 font-medium">Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.accountId} className="border-b border-rule align-top">
                  <td className="py-2">
                    <div>{p.name}</div>
                    <div className="condensed text-[12px] text-ink-muted">
                      <span className="mr-3">{p.insurer}</span>
                      {p.policyNumber && <span className="mr-3">No. {p.policyNumber}</span>}
                      {scope === 'family' && p.personName}
                    </div>
                  </td>
                  <td className="py-2">{TYPE_LABELS[p.type]}</td>
                  <td className="num py-2">{lakhCrore(p.sumAssured)}</td>
                  <td className="num py-2">
                    {money(p.premium)}
                    <div className="text-[12px] text-ink-muted">{FREQ_LABELS[p.premiumFrequency]}</div>
                  </td>
                  <td className="num py-2">
                    {shortDate(p.nextDueDate)}
                    {p.maturityDate && (
                      <div className="text-[12px] text-ink-muted">Matures {shortDate(p.maturityDate)}</div>
                    )}
                  </td>
                  <td className="num py-2">
                    {p.currentValue ? money(p.currentValue) : hasValue(p.type) ? '—' : ''}
                    {p.valueDate && <div className="text-[12px] text-ink-muted">{shortDate(p.valueDate)}</div>}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p)} className="px-2 text-[13px] text-stamp hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => confirm(`Delete ${p.name}?`) && del.mutate([p.accountId])}
                      className="px-2 text-[13px] text-loss hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function PolicyForm({ policy, onDone }: { policy: PolicyView | null; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSavePolicy()
  const [f, setF] = useState({
    personId: policy?.personId ?? (scope === 'family' ? (persons[0]?.id ?? 1) : scope),
    insurer: policy?.insurer ?? '',
    name: policy?.name ?? '',
    policyNumber: policy?.policyNumber ?? '',
    type: policy?.type ?? ('TERM' as PolicyType),
    sumAssured: String(policy?.sumAssured ?? ''),
    premium: String(policy?.premium ?? ''),
    premiumFrequency: policy?.premiumFrequency ?? ('YEARLY' as PremiumFrequency),
    nextDueDate: policy?.nextDueDate ?? '',
    maturityDate: policy?.maturityDate ?? '',
    currentValue: policy?.currentValue ? String(policy.currentValue) : ''
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      [
        {
          accountId: policy?.accountId,
          personId: Number(f.personId),
          insurer: f.insurer,
          name: f.name,
          policyNumber: f.policyNumber,
          type: f.type,
          sumAssured: Number(f.sumAssured || 0),
          premium: Number(f.premium || 0),
          premiumFrequency: f.premiumFrequency,
          nextDueDate: f.nextDueDate || undefined,
          maturityDate: f.maturityDate || undefined,
          currentValue: f.currentValue ? Number(f.currentValue) : undefined
        }
      ],
      { onSuccess: onDone }
    )
  }

  return (
    <form onSubmit={submit} className="mb-8 rounded-md border border-rule bg-sheet p-5">
      <div className="grid grid-cols-4 gap-4">
        <Field label="Whose">
          <Select value={f.personId} onChange={(e) => set('personId', Number(e.target.value))}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Insurer">
          <Input required value={f.insurer} placeholder="LIC" onChange={(e) => set('insurer', e.target.value)} />
        </Field>
        <Field label="Plan name">
          <Input required value={f.name} placeholder="Jeevan Anand" onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Policy number" hint="Optional">
          <Input value={f.policyNumber} onChange={(e) => set('policyNumber', e.target.value)} />
        </Field>

        <Field label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as PolicyType)}>
            {POLICY_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sum assured (₹)">
          <Input
            type="number"
            min="0"
            step="any"
            required
            value={f.sumAssured}
            onChange={(e) => set('sumAssured', e.target.value)}
          />
        </Field>
        <Field label="Premium (₹)">
          <Input
            type="number"
            min="0"
            step="any"
            required
            value={f.premium}
            onChange={(e) => set('premium', e.target.value)}
          />
        </Field>
        <Field label="Paid">
          <Select
            value={f.premiumFrequency}
            onChange={(e) => set('premiumFrequency', e.target.value as PremiumFrequency)}
          >
            {PREMIUM_FREQUENCIES.map((x) => (
              <option key={x} value={x}>
                {FREQ_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Next premium due" hint="Optional">
          <Input type="date" value={f.nextDueDate} onChange={(e) => set('nextDueDate', e.target.value)} />
        </Field>
        <Field label="Maturity date" hint="Optional">
          <Input type="date" value={f.maturityDate} onChange={(e) => set('maturityDate', e.target.value)} />
        </Field>
        {hasValue(f.type) && (
          <Field label="Value today (₹)" hint="Surrender or fund value, from the insurer">
            <Input
              type="number"
              min="0"
              step="any"
              value={f.currentValue}
              onChange={(e) => set('currentValue', e.target.value)}
            />
          </Field>
        )}
      </div>
      <ErrorNote error={save.error} />
      <div className="mt-4 flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {policy ? 'Save changes' : 'Add policy'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
