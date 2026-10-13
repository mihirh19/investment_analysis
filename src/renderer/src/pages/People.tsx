import { useState } from 'react'
import { PLATFORM_LABELS, type Person, type Relation } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Input, Select } from '../components/ui'
import { useAccounts, usePersons, useSavePerson } from '../lib/api'

const RELATIONS: { value: Relation; label: string }[] = [
  { value: 'SELF', label: 'Me' },
  { value: 'PARENT', label: 'Parent' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'OTHER', label: 'Other' }
]

export function People() {
  const persons = usePersons()
  const accounts = useAccounts().data ?? []
  const save = useSavePerson()
  const [newName, setNewName] = useState('')

  return (
    <>
      <PageHeader title="People & accounts" />
      <ErrorNote error={persons.error ?? save.error} />

      <div className="flex flex-col gap-10">
        {(persons.data ?? []).map((p) => (
          <section key={p.id} aria-label={p.name}>
            <PersonRow person={p} onSave={(x) => save.mutate(x)} />
            <table className="mt-2 w-full text-[15px]">
              <tbody>
                {accounts
                  .filter((a) => a.personId === p.id)
                  .map((a) => (
                    <tr key={a.id} className="border-b border-rule">
                      <td className="w-48 py-2 text-ink-muted">{PLATFORM_LABELS[a.platform]}</td>
                      <td className="py-2">{a.name}</td>
                      <td className="condensed py-2 text-right text-[13px] text-ink-muted">{a.externalId}</td>
                    </tr>
                  ))}
                {!accounts.some((a) => a.personId === p.id) && (
                  <tr>
                    <td className="py-2 text-[14px] text-ink-muted">
                      No accounts yet. They are created automatically when you import {p.name}&rsquo;s statements.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        ))}

        <form
          className="flex max-w-[480px] items-center gap-3 border-t border-rule pt-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) save.mutate({ name: newName, relation: 'OTHER' }, { onSuccess: () => setNewName('') })
          }}
        >
          <Input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label="New person's name"
          />
          <Button type="submit" variant="quiet" disabled={!newName.trim()}>
            Add person
          </Button>
        </form>
      </div>
    </>
  )
}

function PersonRow({ person, onSave }: { person: Person; onSave: (p: Person) => void }) {
  const [name, setName] = useState(person.name)
  const [relation, setRelation] = useState(person.relation)
  const dirty = name.trim() !== person.name || relation !== person.relation
  return (
    <div className="flex items-center gap-3 border-b border-rule-strong pb-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Name"
        className="wide w-64 border-transparent bg-transparent px-1 text-[20px] font-semibold hover:border-rule-strong focus:border-rule-strong"
      />
      <Select value={relation} onChange={(e) => setRelation(e.target.value as Relation)} aria-label="Relation">
        {RELATIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      {dirty && (
        <Button onClick={() => onSave({ id: person.id, name, relation })} disabled={!name.trim()}>
          Save
        </Button>
      )}
    </div>
  )
}
