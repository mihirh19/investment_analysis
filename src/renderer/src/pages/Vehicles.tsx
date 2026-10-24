import { useState, type FormEvent } from 'react'
import {
  FUELS,
  POLICY_TYPES,
  VEHICLE_EXPENSE_KINDS,
  VEHICLE_TYPES,
  type Fuel,
  type PolicyType,
  type VehicleDocRead,
  type VehicleExpenseKind,
  type VehicleMeta,
  type VehicleReminder,
  type VehicleType,
  type VehicleView
} from '@shared/vehicles'
import { Columns } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  openDocument,
  openExternal,
  pickDocument,
  readVehicleDocument,
  useAddVehicleDocument,
  useDeleteDocument,
  useDeleteVehicle,
  usePersons,
  useSaveVehicle,
  useVehicles
} from '../lib/api'
import { money, shortDate } from '../lib/format'

/** Whole rupees: vehicle costs never need paise. */
const inr = (v: number | null | undefined) => money(v, 'INR', 0)
import { stagger } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'

const today = () => new Date().toISOString().slice(0, 10)
const newId = () => crypto.randomUUID().slice(0, 8)
const optNum = (s: string) => (s.trim() === '' ? undefined : Number(s))
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ECHALLAN = 'https://echallan.parivahan.gov.in/'

const TYPE_LABELS: Record<VehicleType, string> = {
  CAR: 'Car',
  TWO_WHEELER: 'Bike or scooter',
  COMMERCIAL: 'Commercial',
  OTHER: 'Other'
}
const FUEL_LABELS: Record<Fuel, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  CNG: 'CNG',
  EV: 'Electric',
  HYBRID: 'Hybrid',
  OTHER: 'Other'
}
const POLICY_LABELS: Record<PolicyType, string> = {
  COMPREHENSIVE: 'Comprehensive',
  THIRD_PARTY: 'Third party only',
  OWN_DAMAGE: 'Own damage only'
}
const EXPENSE_LABELS: Record<VehicleExpenseKind, string> = {
  FUEL: 'Fuel or charging',
  SERVICE: 'Service',
  REPAIR: 'Repair',
  TYRES: 'Tyres and battery',
  INSURANCE: 'Insurance premium',
  PUC: 'PUC',
  TOLL: 'Toll and FASTag',
  PARKING: 'Parking',
  CHALLAN: 'Fine (challan)',
  OTHER: 'Other'
}
const DOC_KINDS = ['RC', 'Insurance', 'PUC', 'Invoice', 'Loan', 'Other']

const LEVEL: Record<VehicleReminder['level'], { mark: string; cls: string; word: string }> = {
  OVERDUE: { mark: '!', cls: 'text-loss', word: 'Overdue' },
  SOON: { mark: '◔', cls: 'text-warn', word: 'Soon' },
  OK: { mark: '✓', cls: 'text-gain', word: 'In order' }
}

const when = (r: VehicleReminder) =>
  r.days === null
    ? ''
    : r.days < 0
      ? `${-r.days} day${r.days === -1 ? '' : 's'} ago`
      : r.days === 0
        ? 'today'
        : `in ${r.days} day${r.days === 1 ? '' : 's'}`

/** Registration number set like a plate: the thing people recognise their vehicle by. */
function Plate({ text, small }: { text: string; small?: boolean }) {
  return (
    <span
      className={
        'inline-flex items-stretch overflow-hidden rounded-[5px] border-2 border-[#1b1b1b] bg-white font-semibold text-[#1b1b1b] ' +
        (small ? 'text-[12px]' : 'text-[19px]')
      }
    >
      <span
        className={`flex items-center bg-[#1f4fb5] font-bold text-white ${small ? 'px-1 text-[7px]' : 'px-1.5 text-[9px]'}`}
        aria-hidden
      >
        IND
      </span>
      <span className={`whitespace-nowrap ${small ? 'px-1.5 py-0' : 'px-2.5 py-0.5'} tracking-[0.08em]`}>{text}</span>
    </span>
  )
}

export function Vehicles() {
  const { scope } = useScope()
  const q = useVehicles(scopePersonId(scope))
  const [editing, setEditing] = useState<VehicleView | 'new' | null>(null)
  const list = q.data ?? []
  const due = list.flatMap((v) => v.reminders.filter((r) => r.level !== 'OK').map((r) => ({ v, r })))
  const yearCost = list.reduce((s, v) => s + v.costs.last12m, 0)

  return (
    <>
      <PageHeader title="Vehicles">
        <Button variant="quiet" onClick={() => void openExternal(ECHALLAN)}>
          Check e-challans
        </Button>
        {editing === null && <Button onClick={() => setEditing('new')}>Add a vehicle</Button>}
      </PageHeader>
      <ErrorNote error={q.error} />

      {list.length > 0 && (
        <div className="mb-8 grid gap-6 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <h2 className="mb-2 text-[15px] font-semibold">
              {due.length ? `${due.length} thing${due.length > 1 ? 's' : ''} to sort out` : 'Everything is in order'}
            </h2>
            {due.length === 0 ? (
              <p className="text-[14px] text-ink-muted">
                Insurance, PUC and registration are all valid. Reminders show up here 30 days ahead (15 for PUC).
              </p>
            ) : (
              <ul className="border-t border-rule">
                {due.map(({ v, r }) => (
                  <li key={`${v.id}-${r.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-2">
                    <span className={`w-4 text-center font-bold ${LEVEL[r.level].cls}`} aria-label={LEVEL[r.level].word}>
                      {LEVEL[r.level].mark}
                    </span>
                    <Plate text={v.regDisplay} small />
                    <span className="font-medium">{r.label}</span>
                    <span className={`text-[14px] ${LEVEL[r.level].cls}`}>{when(r) || LEVEL[r.level].word}</span>
                    <span className="basis-full pl-7 text-[13px] text-ink-muted">{r.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[13px] text-ink-muted">Running costs, last 12 months</div>
            <div className="wide num text-[28px] font-semibold">{inr(yearCost)}</div>
            <div className="text-[13px] text-ink-muted">
              {inr(yearCost / 12)} a month across {list.filter((v) => !v.meta.soldOn).length} vehicle
              {list.length > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      {editing !== null && <VehicleForm v={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}

      {list.length === 0 && editing === null && !q.isLoading && (
        <div className="max-w-[72ch] py-4">
          <p className="text-ink-muted">
            Add your car or bike to get reminders before the insurance, PUC or registration runs out, an estimate of
            what it is worth, and what it costs to run. Start from the RC or insurance policy PDF (from DigiLocker,
            mParivahan or the insurer&rsquo;s email) and the details fill in by themselves.
          </p>
          <Button className="mt-4" onClick={() => setEditing('new')}>
            Add your first vehicle
          </Button>
        </div>
      )}

      {list.map((v, i) => (
        <VehicleSection
          key={v.id}
          v={v}
          index={i}
          showPerson={scope === 'family'}
          onEdit={() => setEditing(v)}
        />
      ))}
    </>
  )
}

// ---------------- one vehicle ----------------

function useUpdate(v: VehicleView) {
  const save = useSaveVehicle()
  const put = (patch: Partial<VehicleMeta>, onSuccess?: () => void) =>
    save.mutate([{ id: v.id, personId: v.personId, meta: { ...v.meta, ...patch } }], { onSuccess })
  return { put, pending: save.isPending, error: save.error }
}

function H({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <h3 className="text-[15px] font-semibold">{children}</h3>
      {aside && <div className="text-[13px] text-ink-muted">{aside}</div>}
    </div>
  )
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="text-[14px]">
      {rows.map(([k, val]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-rule py-1.5">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="num text-right">{val}</dd>
        </div>
      ))}
    </dl>
  )
}

function VehicleSection({
  v,
  index,
  showPerson,
  onEdit
}: {
  v: VehicleView
  index: number
  showPerson: boolean
  onEdit: () => void
}) {
  const del = useDeleteVehicle()
  const m = v.meta
  const facts = [
    [m.make, m.model, m.variant].filter(Boolean).join(' ') || TYPE_LABELS[m.type],
    m.fuel ? FUEL_LABELS[m.fuel] : null,
    v.ageYears !== null ? (v.ageYears < 1 ? 'under a year old' : `${Math.floor(v.ageYears)} years old`) : null,
    v.lastKm ? `${v.lastKm.km.toLocaleString('en-IN')} km` : null,
    showPerson ? v.personName : null,
    m.soldOn ? `sold ${shortDate(m.soldOn)}` : null
  ].filter(Boolean) as string[]
  return (
    <section className="anim-page mb-12 border-t border-rule-strong pt-5" style={stagger(index, 60, 300)}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <Plate text={v.regDisplay} />
          <div className="mt-2 text-[14px] text-ink-muted">
            {facts.map((f) => (
              <span key={f} className="mr-4">
                {f}
              </span>
            ))}
          </div>
        </div>
        <div className="max-w-[46ch] text-right">
          <div className="text-[13px] text-ink-muted">Worth about</div>
          <div className="wide num text-[26px] leading-tight font-semibold">{v.value !== null ? inr(v.value) : '—'}</div>
          <div className="mt-1 text-[13px] text-ink-muted">{v.valueNote}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 @7xl:grid-cols-2">
        <div className="min-w-0">
          <Reminders v={v} />
          <Insurance v={v} />
          <Puc v={v} />
          <Documents v={v} />
        </div>
        <div className="min-w-0">
          <Costs v={v} />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="quiet" onClick={onEdit}>
          Edit details
        </Button>
        <Button
          variant="danger"
          onClick={() => confirm(`Remove ${v.regDisplay} with its documents and costs?`) && del.mutate([v.id])}
        >
          Remove
        </Button>
      </div>
      <ErrorNote error={del.error} />
    </section>
  )
}

function Reminders({ v }: { v: VehicleView }) {
  if (v.reminders.length === 0) return null
  return (
    <div className="mb-8">
      <H>What&rsquo;s due</H>
      <ul className="text-[14px]">
        {v.reminders.map((r) => (
          <li key={r.key} className="border-b border-rule py-2">
            <div className="flex items-baseline gap-2">
              <span className={`w-4 text-center font-bold ${LEVEL[r.level].cls}`} aria-label={LEVEL[r.level].word}>
                {LEVEL[r.level].mark}
              </span>
              <span className="font-medium">{r.label}</span>
              {r.date && (
                <span className="num text-ink-muted">
                  {shortDate(r.date)}
                  {r.level !== 'OK' && <span className={`ml-2 ${LEVEL[r.level].cls}`}>{when(r)}</span>}
                </span>
              )}
              {r.link && (
                <button
                  className="ml-auto shrink-0 text-[13px] text-stamp hover:underline"
                  onClick={() => void openExternal(r.link!.url)}
                >
                  {r.link.label}
                </button>
              )}
            </div>
            <div className="pl-6 text-[13px] text-ink-muted">{r.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Insurance({ v }: { v: VehicleView }) {
  const up = useUpdate(v)
  const [open, setOpen] = useState(false)
  const p = v.policy
  const [f, setF] = useState({
    insurer: p?.insurer ?? '',
    policyNumber: '',
    type: (p?.type ?? 'COMPREHENSIVE') as PolicyType,
    startDate: p ? p.endDate : today(),
    endDate: '',
    idv: '',
    premium: '',
    ncbPct: ''
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const policy = {
      id: newId(),
      insurer: f.insurer.trim() || undefined,
      policyNumber: f.policyNumber.trim() || undefined,
      type: f.type,
      startDate: f.startDate || undefined,
      endDate: f.endDate,
      idv: optNum(f.idv),
      premium: optNum(f.premium),
      ncbPct: optNum(f.ncbPct)
    }
    // The premium is a running cost too.
    const expenses = policy.premium
      ? [
          ...(v.meta.expenses ?? []),
          { id: newId(), date: policy.startDate ?? today(), kind: 'INSURANCE' as const, amount: policy.premium, note: policy.insurer }
        ]
      : v.meta.expenses
    up.put({ policies: [...(v.meta.policies ?? []), policy], expenses }, () => setOpen(false))
  }
  return (
    <div className="mb-8">
      <H aside={p?.type ? POLICY_LABELS[p.type] : undefined}>Insurance</H>
      {p ? (
        <Rows
          rows={[
            ['Insurer', p.insurer ?? '—'],
            ...(p.policyNumber ? [['Policy number', p.policyNumber] as [string, string]] : []),
            ['Covers', `${p.startDate ? `${shortDate(p.startDate)} to ` : 'to '}${shortDate(p.endDate)}`],
            ...(p.idv ? [['Insured declared value', inr(p.idv)] as [string, string]] : []),
            ...(p.premium ? [['Premium', inr(p.premium)] as [string, string]] : []),
            ...(p.ncbPct !== undefined ? [['No-claim bonus', `${p.ncbPct}%`] as [string, string]] : [])
          ]}
        />
      ) : (
        <p className="text-[14px] text-ink-muted">No policy yet. Read it from the policy PDF below, or add it here.</p>
      )}
      {open ? (
        <form onSubmit={submit} className="anim-pop mt-3 grid grid-cols-2 gap-3 rounded-md border border-rule bg-sheet p-4">
          <Field label="Insurer">
            <Input value={f.insurer} onChange={(e) => setF({ ...f, insurer: e.target.value })} />
          </Field>
          <Field label="Policy number" hint="Optional">
            <Input value={f.policyNumber} onChange={(e) => setF({ ...f, policyNumber: e.target.value })} />
          </Field>
          <Field label="Cover">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PolicyType })}>
              {POLICY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {POLICY_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="No-claim bonus (%)" hint="Optional">
            <Input type="number" min="0" max="65" value={f.ncbPct} onChange={(e) => setF({ ...f, ncbPct: e.target.value })} />
          </Field>
          <Field label="From">
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field label="IDV (₹)" hint="Insured declared value; sets the estimate">
            <Input type="number" min="0" step="any" value={f.idv} onChange={(e) => setF({ ...f, idv: e.target.value })} />
          </Field>
          <Field label="Premium paid (₹)" hint="Optional; counted in running costs">
            <Input type="number" min="0" step="any" value={f.premium} onChange={(e) => setF({ ...f, premium: e.target.value })} />
          </Field>
          <div className="col-span-2 flex gap-3">
            <Button type="submit" disabled={up.pending}>
              Save policy
            </Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="quiet" className="mt-3" onClick={() => setOpen(true)}>
          {p ? 'Add the renewed policy' : 'Add a policy'}
        </Button>
      )}
      <ErrorNote error={up.error} />
    </div>
  )
}

function Puc({ v }: { v: VehicleView }) {
  const up = useUpdate(v)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ date: today(), validUntil: '', certificateNo: '', amount: '' })
  if (v.meta.fuel === 'EV') return null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const amount = optNum(f.amount)
    up.put(
      {
        puc: [
          ...(v.meta.puc ?? []),
          { id: newId(), date: f.date || undefined, validUntil: f.validUntil, certificateNo: f.certificateNo.trim() || undefined }
        ],
        expenses: amount
          ? [...(v.meta.expenses ?? []), { id: newId(), date: f.date || today(), kind: 'PUC' as const, amount }]
          : v.meta.expenses
      },
      () => setOpen(false)
    )
  }
  return (
    <div className="mb-8">
      <H>PUC certificate</H>
      {v.puc ? (
        <Rows
          rows={[
            ['Valid to', shortDate(v.puc.validUntil)],
            ...(v.puc.certificateNo ? [['Certificate', v.puc.certificateNo] as [string, string]] : []),
            ...(v.puc.date ? [['Tested on', shortDate(v.puc.date)] as [string, string]] : [])
          ]}
        />
      ) : (
        <p className="text-[14px] text-ink-muted">None recorded.</p>
      )}
      {open ? (
        <form onSubmit={submit} className="anim-pop mt-3 flex flex-wrap items-end gap-2 rounded-md border border-rule bg-sheet p-3">
          <Field label="Tested on">
            <Input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Valid to">
            <Input type="date" required value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          </Field>
          <Field label="Certificate no.">
            <Input className="w-40" value={f.certificateNo} onChange={(e) => setF({ ...f, certificateNo: e.target.value })} />
          </Field>
          <Field label="Paid (₹)">
            <Input type="number" min="0" className="w-24" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Button type="submit" disabled={up.pending}>
            Save
          </Button>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="quiet" className="mt-3" onClick={() => setOpen(true)}>
          Add a PUC
        </Button>
      )}
      <ErrorNote error={up.error} />
    </div>
  )
}

// ---------------- documents ----------------

/** What a read document adds to a vehicle: a renewed policy, a new PUC, details not yet filled in. */
function mergeRead(m: VehicleMeta, r: VehicleDocRead): Partial<VehicleMeta> {
  const patch: Partial<VehicleMeta> = {}
  for (const [k, val] of Object.entries(r.meta) as [keyof VehicleMeta, unknown][])
    if (val !== undefined && (m[k] === undefined || m[k] === '')) (patch as Record<string, unknown>)[k] = val
  if (r.policy?.endDate && !(m.policies ?? []).some((p) => p.endDate === r.policy!.endDate))
    patch.policies = [...(m.policies ?? []), { id: newId(), ...r.policy, endDate: r.policy.endDate }]
  if (r.puc?.validUntil && !(m.puc ?? []).some((p) => p.validUntil === r.puc!.validUntil))
    patch.puc = [...(m.puc ?? []), { id: newId(), ...r.puc, validUntil: r.puc.validUntil }]
  return patch
}

const READ_LABELS: Record<string, string> = {
  regNo: 'Number',
  make: 'Make',
  model: 'Model',
  fuel: 'Fuel',
  type: 'Kind',
  ownerName: 'Owner',
  registrationDate: 'Registered',
  registrationValidUntil: 'RC valid to',
  colour: 'Colour'
}

function describeRead(r: VehicleDocRead): [string, string][] {
  const rows: [string, string][] = []
  if (r.regNo) rows.push(['Number', r.regNo])
  for (const [k, val] of Object.entries(r.meta)) if (val && READ_LABELS[k]) rows.push([READ_LABELS[k], String(val)])
  if (r.policy?.insurer) rows.push(['Insurer', r.policy.insurer])
  if (r.policy?.policyNumber) rows.push(['Policy number', r.policy.policyNumber])
  if (r.policy?.endDate) rows.push(['Insured to', shortDate(r.policy.endDate)])
  if (r.policy?.idv) rows.push(['IDV', inr(r.policy.idv)])
  if (r.policy?.premium) rows.push(['Premium', inr(r.policy.premium)])
  if (r.puc?.validUntil) rows.push(['PUC valid to', shortDate(r.puc.validUntil)])
  return rows
}

/** Picks a PDF and reads it, asking for the password if it has one. */
function useReader() {
  const [state, setState] = useState<{
    path: string
    read: VehicleDocRead | null
    needsPassword: boolean
    password: string
    error: string | null
    busy: boolean
  } | null>(null)
  const run = async (path: string, password?: string) => {
    setState({ path, read: null, needsPassword: false, password: password ?? '', error: null, busy: true })
    try {
      const read = await readVehicleDocument(path, password)
      setState({ path, read, needsPassword: false, password: password ?? '', error: null, busy: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ path, read: null, needsPassword: /password/i.test(msg), password: password ?? '', error: msg, busy: false })
    }
  }
  const pick = async () => {
    const path = await pickDocument()
    if (!path) return
    if (!/\.pdf$/i.test(path)) {
      setState({ path, read: null, needsPassword: false, password: '', error: null, busy: false })
      return
    }
    await run(path)
  }
  return { state, setState, pick, run, clear: () => setState(null) }
}

function Documents({ v }: { v: VehicleView }) {
  const add = useAddVehicleDocument()
  const del = useDeleteDocument()
  const up = useUpdate(v)
  const reader = useReader()
  const [chosen, setChosen] = useState<string | null>(null)
  const s = reader.state
  const docKind =
    chosen ??
    (s?.read?.kind === 'RC' ? 'RC' : s?.read?.kind === 'INSURANCE' ? 'Insurance' : s?.read?.kind === 'PUC' ? 'PUC' : 'Other')
  const done = () => {
    setChosen(null)
    reader.clear()
  }
  const keep = (path: string) => add.mutate([v.id, docKind, path], { onSuccess: done })
  const mismatch = s?.read?.regNo && s.read.regNo !== v.meta.regNo

  return (
    <div>
      <H aside="Kept encrypted on this computer">Documents</H>
      {v.documents.length > 0 && (
        <table className="w-full text-[14px]">
          <tbody>
            {v.documents.map((d) => (
              <tr key={d.id} className="border-b border-rule">
                <td className="py-1 pr-3 text-ink-muted">{d.kind}</td>
                <td className="py-1">
                  <button className="text-left text-stamp hover:underline" onClick={() => void openDocument(d.id)}>
                    {d.fileName}
                  </button>
                </td>
                <td className="num py-1 text-right text-ink-muted">{Math.max(1, Math.round(d.size / 1024))} KB</td>
                <td className="w-20 py-0.5 text-right">
                  <button
                    className="px-2 text-[13px] text-loss hover:underline"
                    onClick={() => confirm(`Remove ${d.fileName}?`) && del.mutate([d.id])}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s === null ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Button variant="quiet" onClick={() => void reader.pick()}>
            Add a document
          </Button>
          <span className="text-[13px] text-ink-muted">
            RC, policy or PUC as a PDF fills in the details; photos are kept as they are.
          </span>
        </div>
      ) : (
        <div className="anim-pop mt-3 rounded-md border border-rule bg-sheet p-4 text-[14px]">
          <div className="mb-2 font-medium">{s.path.split(/[\\/]/).pop()}</div>
          {s.busy && <p className="text-ink-muted">Reading…</p>}
          {s.needsPassword && (
            <form
              className="mb-2 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void reader.run(s.path, s.password)
              }}
            >
              <Field label="PDF password">
                <Input
                  type="password"
                  autoFocus
                  value={s.password}
                  onChange={(e) => reader.setState({ ...s, password: e.target.value })}
                />
              </Field>
              <Button type="submit">Open</Button>
            </form>
          )}
          {s.error && !s.needsPassword && <p className="text-loss">{s.error}</p>}
          {s.read && (
            <>
              {s.read.kind === 'UNKNOWN' || describeRead(s.read).length === 0 ? (
                <p className="text-ink-muted">Nothing recognisable was found in it. It can still be kept as a document.</p>
              ) : (
                <>
                  <p className="mb-1 text-ink-muted">
                    Read as {s.read.kind === 'RC' ? 'a registration certificate' : s.read.kind === 'INSURANCE' ? 'an insurance policy' : 'a PUC certificate'}:
                  </p>
                  <Rows rows={describeRead(s.read)} />
                  {mismatch && (
                    <p className="mt-2 text-warn">
                      This is for {s.read.regNo}, not {v.regDisplay}. Check it&rsquo;s the right vehicle.
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {!s.busy && !s.needsPassword && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Keep as">
                <Select value={docKind} onChange={(e) => setChosen(e.target.value)}>
                  {DOC_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
              {s.read && s.read.kind !== 'UNKNOWN' && Object.keys(mergeRead(v.meta, s.read)).length > 0 && (
                <Button
                  disabled={up.pending || add.isPending}
                  onClick={() => up.put(mergeRead(v.meta, s.read!), () => keep(s.path))}
                >
                  Use these details and keep it
                </Button>
              )}
              <Button variant="quiet" disabled={add.isPending} onClick={() => keep(s.path)}>
                Just keep the file
              </Button>
              <Button variant="quiet" onClick={done}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
      <ErrorNote error={add.error ?? del.error ?? up.error} />
    </div>
  )
}

// ---------------- running costs ----------------

function Costs({ v }: { v: VehicleView }) {
  const up = useUpdate(v)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({
    date: today(),
    kind: 'FUEL' as VehicleExpenseKind,
    amount: '',
    km: '',
    litres: '',
    note: ''
  })
  const c = v.costs
  const list = [...(v.meta.expenses ?? [])].sort((a, b) => b.date.localeCompare(a.date))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    up.put(
      {
        expenses: [
          ...(v.meta.expenses ?? []),
          {
            id: newId(),
            date: f.date,
            kind: f.kind,
            amount: Number(f.amount),
            km: optNum(f.km),
            litres: f.kind === 'FUEL' ? optNum(f.litres) : undefined,
            note: f.note.trim() || undefined
          }
        ]
      },
      () => {
        setF((x) => ({ ...x, amount: '', km: '', litres: '', note: '' }))
        setOpen(false)
      }
    )
  }
  const rows: [string, string][] = [
    ['This month', inr(c.thisMonth)],
    ['Last 12 months', inr(c.last12m)]
  ]
  if (c.kmLast12m) rows.push(['Driven, last 12 months', `${c.kmLast12m.toLocaleString('en-IN')} km`])
  if (c.perKm) rows.push(['Cost per km', `₹${c.perKm.toFixed(2)}`])
  if (c.kmPerLitre) rows.push([v.meta.fuel === 'EV' ? 'km per kWh' : 'Mileage', `${c.kmPerLitre.toFixed(1)} km/${v.meta.fuel === 'EV' ? 'kWh' : 'l'}`])
  for (const k of c.byKind) rows.push([EXPENSE_LABELS[k.kind], inr(k.amount)])

  return (
    <div>
      <H aside="Last 12 months">Running costs</H>
      {c.last12m > 0 && (
        <Columns
          points={c.monthly.map((x) => ({
            key: x.month,
            label: MONTHS[Number(x.month.slice(5, 7)) - 1],
            value: x.amount
          }))}
          format={(n) => inr(n)}
          axisFormat={(n) => `₹${n >= 1000 ? `${Math.round(n / 1000)}k` : Math.round(n)}`}
          label={`${v.regDisplay} spending by month`}
          seriesLabel="Spent"
          height={160}
        />
      )}
      <div className="mt-3">
        <Rows rows={rows} />
      </div>
      {open ? (
        <form onSubmit={submit} className="anim-pop mt-3 grid grid-cols-2 gap-3 rounded-md border border-rule bg-sheet p-4 @2xl:grid-cols-3">
          <Field label="On">
            <Input type="date" required max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="For">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as VehicleExpenseKind })}>
              {VEHICLE_EXPENSE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EXPENSE_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" required min="1" step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Odometer (km)" hint="Optional; gives cost per km">
            <Input type="number" min="0" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
          </Field>
          {f.kind === 'FUEL' && (
            <Field label={v.meta.fuel === 'EV' ? 'kWh' : 'Litres'} hint="Optional; gives mileage">
              <Input type="number" min="0" step="any" value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} />
            </Field>
          )}
          <Field label="Note">
            <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <div className="col-span-full flex gap-3">
            <Button type="submit" disabled={up.pending}>
              Save
            </Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button className="mt-3" onClick={() => setOpen(true)}>
          Add a cost
        </Button>
      )}
      {list.length > 0 && (
        <details className="mt-4 text-[14px]">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">All costs ({list.length})</summary>
          <table className="mt-2 w-full">
            <tbody>
              {list.slice(0, 60).map((x) => (
                <tr key={x.id} className="border-b border-rule">
                  <td className="py-1">{shortDate(x.date)}</td>
                  <td className="py-1">
                    {EXPENSE_LABELS[x.kind]}
                    {x.note && <span className="ml-2 text-ink-muted">{x.note}</span>}
                  </td>
                  <td className="num py-1 text-right text-ink-muted">{x.km ? `${x.km.toLocaleString('en-IN')} km` : ''}</td>
                  <td className="num py-1 text-right">{inr(x.amount)}</td>
                  <td className="w-20 py-0.5 text-right">
                    <button
                      className="px-2 text-[13px] text-loss hover:underline"
                      onClick={() => up.put({ expenses: (v.meta.expenses ?? []).filter((y) => y.id !== x.id) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ErrorNote error={up.error} />
    </div>
  )
}

// ---------------- add or edit ----------------

function VehicleForm({ v, onDone }: { v: VehicleView | null; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveVehicle()
  const add = useAddVehicleDocument()
  const reader = useReader()
  const m = v?.meta
  const s = (x: number | undefined) => (x === undefined ? '' : String(x))
  const [personId, setPersonId] = useState<number>(v?.personId ?? (scope === 'family' ? (persons[0]?.id ?? 1) : scope))
  const [f, setF] = useState({
    regNo: v?.regDisplay ?? '',
    type: (m?.type ?? 'CAR') as VehicleType,
    make: m?.make ?? '',
    model: m?.model ?? '',
    variant: m?.variant ?? '',
    fuel: (m?.fuel ?? 'PETROL') as Fuel,
    ownerName: m?.ownerName ?? '',
    registrationDate: m?.registrationDate ?? '',
    registrationValidUntil: m?.registrationValidUntil ?? '',
    purchaseDate: m?.purchaseDate ?? '',
    exShowroomPrice: s(m?.exShowroomPrice),
    onRoadPrice: s(m?.onRoadPrice),
    serviceEveryMonths: s(m?.serviceEveryMonths),
    serviceEveryKm: s(m?.serviceEveryKm),
    loanLender: m?.loan?.lender ?? '',
    loanEmi: s(m?.loan?.emi),
    loanEnd: m?.loan?.endDate ?? '',
    soldOn: m?.soldOn ?? ''
  })
  const [fromDoc, setFromDoc] = useState<{ path: string; read: VehicleDocRead } | null>(null)
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }))

  const apply = (path: string, r: VehicleDocRead) => {
    setFromDoc({ path, read: r })
    setF((x) => ({
      ...x,
      regNo: x.regNo || r.regNo || '',
      type: r.meta.type ?? x.type,
      make: x.make || r.meta.make || '',
      model: x.model || r.meta.model || '',
      fuel: r.meta.fuel ?? x.fuel,
      ownerName: x.ownerName || r.meta.ownerName || '',
      registrationDate: x.registrationDate || r.meta.registrationDate || '',
      registrationValidUntil: x.registrationValidUntil || r.meta.registrationValidUntil || ''
    }))
    reader.clear()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    let meta: VehicleMeta = {
      ...(m ?? {}),
      regNo: f.regNo,
      type: f.type,
      make: f.make.trim() || undefined,
      model: f.model.trim() || undefined,
      variant: f.variant.trim() || undefined,
      fuel: f.fuel,
      ownerName: f.ownerName.trim() || undefined,
      registrationDate: f.registrationDate || undefined,
      registrationValidUntil: f.registrationValidUntil || undefined,
      purchaseDate: f.purchaseDate || undefined,
      exShowroomPrice: optNum(f.exShowroomPrice),
      onRoadPrice: optNum(f.onRoadPrice),
      serviceEveryMonths: optNum(f.serviceEveryMonths),
      serviceEveryKm: optNum(f.serviceEveryKm),
      loan: f.loanEnd || f.loanEmi ? { lender: f.loanLender.trim() || undefined, emi: optNum(f.loanEmi), endDate: f.loanEnd || undefined } : undefined,
      soldOn: f.soldOn || undefined
    }
    if (fromDoc) meta = { ...meta, ...mergeRead(meta, { ...fromDoc.read, meta: {} }) }
    save.mutate([{ id: v?.id, personId, meta }], {
      onSuccess: (id) => {
        if (fromDoc) {
          const k = fromDoc.read.kind === 'RC' ? 'RC' : fromDoc.read.kind === 'INSURANCE' ? 'Insurance' : fromDoc.read.kind === 'PUC' ? 'PUC' : 'Other'
          add.mutate([id, k, fromDoc.path])
        }
        onDone()
      }
    })
  }

  const rs = reader.state
  return (
    <form onSubmit={submit} className="anim-pop mb-10 rounded-md border border-rule bg-sheet p-5">
      <h2 className="mb-4 text-[17px] font-semibold">{v ? `Edit ${v.regDisplay}` : 'Add a vehicle'}</h2>

      {!v && (
        <div className="mb-5 rounded-md border border-dashed border-rule-strong p-4 text-[14px]">
          {fromDoc ? (
            <p>
              Filled in from <span className="font-medium">{fromDoc.path.split(/[\\/]/).pop()}</span>
              {fromDoc.read.policy?.endDate ? ', with its insurance' : ''}
              {fromDoc.read.puc?.validUntil ? ' and PUC' : ''}. Check the details, then save; the PDF is kept with the
              vehicle.
            </p>
          ) : rs === null || (!rs.needsPassword && !rs.error && !rs.busy && !rs.read) ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void reader.pick()}>
                Fill from the RC or policy PDF
              </Button>
              <span className="text-ink-muted">
                From DigiLocker, mParivahan or the insurer&rsquo;s email. Or type the details below.
              </span>
            </div>
          ) : (
            <>
              {rs.busy && <p className="text-ink-muted">Reading…</p>}
              {rs.needsPassword && (
                <div className="flex items-end gap-2">
                  <Field label="PDF password">
                    <Input
                      type="password"
                      autoFocus
                      value={rs.password}
                      onChange={(e) => reader.setState({ ...rs, password: e.target.value })}
                    />
                  </Field>
                  <Button type="button" onClick={() => void reader.run(rs.path, rs.password)}>
                    Open
                  </Button>
                </div>
              )}
              {rs.error && !rs.needsPassword && <p className="text-loss">{rs.error}</p>}
              {rs.read &&
                (describeRead(rs.read).length ? (
                  <>
                    <Rows rows={describeRead(rs.read)} />
                    <div className="mt-3 flex gap-2">
                      <Button type="button" onClick={() => apply(rs.path, rs.read!)}>
                        Use these details
                      </Button>
                      <Button type="button" variant="quiet" onClick={reader.clear}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-ink-muted">
                    Nothing recognisable was found in it. Type the details below.{' '}
                    <button type="button" className="text-stamp hover:underline" onClick={reader.clear}>
                      Try another file
                    </button>
                  </p>
                ))}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 @5xl:grid-cols-4">
        <Field label="Whose">
          <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
            {persons.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Registration number" hint="e.g. GJ 01 AB 1234">
          <Input required value={f.regNo} onChange={(e) => set('regNo', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Kind">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as VehicleType)}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fuel">
          <Select value={f.fuel} onChange={(e) => set('fuel', e.target.value as Fuel)}>
            {FUELS.map((t) => (
              <option key={t} value={t}>
                {FUEL_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Make">
          <Input value={f.make} onChange={(e) => set('make', e.target.value)} />
        </Field>
        <Field label="Model">
          <Input value={f.model} onChange={(e) => set('model', e.target.value)} />
        </Field>
        <Field label="Variant" hint="Optional">
          <Input value={f.variant} onChange={(e) => set('variant', e.target.value)} />
        </Field>
        <Field label="Owner on the RC" hint="Optional">
          <Input value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
        </Field>
        <Field label="Registered on">
          <Input type="date" max={today()} value={f.registrationDate} onChange={(e) => set('registrationDate', e.target.value)} />
        </Field>
        <Field label="RC valid to" hint="Blank: 15 years from registration">
          <Input type="date" value={f.registrationValidUntil} onChange={(e) => set('registrationValidUntil', e.target.value)} />
        </Field>
        <Field label="Ex-showroom price (₹)" hint="For the value estimate">
          <Input type="number" min="0" step="any" value={f.exShowroomPrice} onChange={(e) => set('exShowroomPrice', e.target.value)} />
        </Field>
        <Field label="On-road price (₹)" hint="Optional">
          <Input type="number" min="0" step="any" value={f.onRoadPrice} onChange={(e) => set('onRoadPrice', e.target.value)} />
        </Field>
        <Field label="Service every (months)" hint={`Blank: ${f.type === 'TWO_WHEELER' ? 6 : 12}`}>
          <Input type="number" min="1" value={f.serviceEveryMonths} onChange={(e) => set('serviceEveryMonths', e.target.value)} />
        </Field>
        <Field label="or every (km)" hint={`Blank: ${f.type === 'TWO_WHEELER' ? '3,000' : '10,000'}`}>
          <Input type="number" min="1" value={f.serviceEveryKm} onChange={(e) => set('serviceEveryKm', e.target.value)} />
        </Field>
        <Field label="Loan EMI (₹)" hint="Optional">
          <Input type="number" min="0" value={f.loanEmi} onChange={(e) => set('loanEmi', e.target.value)} />
        </Field>
        <Field label="Last EMI on" hint="Reminds you to remove hypothecation">
          <Input type="date" value={f.loanEnd} onChange={(e) => set('loanEnd', e.target.value)} />
        </Field>
        {v && (
          <Field label="Sold on" hint="Stops reminders">
            <Input type="date" max={today()} value={f.soldOn} onChange={(e) => set('soldOn', e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorNote error={save.error ?? add.error} />
      <div className="mt-5 flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : v ? 'Save changes' : 'Add vehicle'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
