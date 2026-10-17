import { useState, type FormEvent } from 'react'
import { VEHICLE_EXPENSE_KINDS, type VehicleExpenseKind, type VehicleView } from '@shared/vehicles'
import { useData } from '../lib/data'
import { Card, day, field, inr, Label, lakhCrore, Primary, Sheet, today } from '../ui'

type Vehicle = Omit<VehicleView, 'documents'>

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
const LEVEL = {
  OVERDUE: 'text-loss',
  SOON: 'text-warn',
  OK: 'text-gain'
} as const

function Plate({ text }: { text: string }) {
  return (
    <span className="inline-flex overflow-hidden rounded-[5px] border-2 border-[#1b1b1b] bg-white text-[17px] font-semibold text-[#1b1b1b]">
      <span className="flex items-center bg-[#1f4fb5] px-1.5 text-[8px] font-bold text-white" aria-hidden>
        IND
      </span>
      <span className="px-2 py-0.5 tracking-[0.08em] whitespace-nowrap">{text}</span>
    </span>
  )
}

function CostSheet({ v, onClose }: { v: Vehicle; onClose: () => void }) {
  const { record } = useData()
  const [f, setF] = useState({ kind: 'FUEL' as VehicleExpenseKind, amount: '', km: '', litres: '', date: today(), note: '' })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({
      type: 'VEHICLE_EXPENSE',
      vehicleId: v.id,
      date: f.date,
      kind: f.kind,
      amount: Number(f.amount),
      km: f.km ? Number(f.km) : undefined,
      litres: f.kind === 'FUEL' && f.litres ? Number(f.litres) : undefined,
      note: f.note.trim() || undefined
    })
    onClose()
  }
  return (
    <Sheet title={`Cost for ${v.regDisplay}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Label text="What for">
          <select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as VehicleExpenseKind })}>
            {VEHICLE_EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {EXPENSE_LABELS[k]}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Amount (₹)">
          <input type="number" inputMode="decimal" required min="1" className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label text={`Odometer (km)${v.lastKm ? `, last ${v.lastKm.km.toLocaleString('en-IN')}` : ''}`}>
            <input type="number" inputMode="numeric" min="0" className={field} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
          </Label>
          {f.kind === 'FUEL' && (
            <Label text={v.meta.fuel === 'EV' ? 'kWh' : 'Litres'}>
              <input type="number" inputMode="decimal" min="0" step="any" className={field} value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} />
            </Label>
          )}
        </div>
        <Label text="On">
          <input type="date" required max={today()} className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Label>
        <div className="pb-3">
          <Primary type="submit" disabled={!(Number(f.amount) > 0)}>
            Save
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

function PucSheet({ v, onClose }: { v: Vehicle; onClose: () => void }) {
  const { record } = useData()
  const nextYear = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const [f, setF] = useState({ date: today(), validUntil: nextYear, amount: '' })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({ type: 'VEHICLE_PUC', vehicleId: v.id, date: f.date, validUntil: f.validUntil, amount: f.amount ? Number(f.amount) : undefined })
    onClose()
  }
  return (
    <Sheet title={`PUC for ${v.regDisplay}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Label text="Tested on">
          <input type="date" required max={today()} className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Label>
        <Label text="Valid until">
          <input type="date" required className={field} value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
        </Label>
        <Label text="Paid (₹, optional)">
          <input type="number" inputMode="decimal" min="0" className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Label>
        <div className="pb-3">
          <Primary type="submit">Save PUC</Primary>
        </div>
      </form>
    </Sheet>
  )
}

function PolicySheet({ v, onClose }: { v: Vehicle; onClose: () => void }) {
  const { record } = useData()
  const [f, setF] = useState({
    insurer: v.policy?.insurer ?? '',
    startDate: v.policy?.endDate ?? today(),
    endDate: '',
    premium: '',
    idv: ''
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({
      type: 'VEHICLE_POLICY',
      vehicleId: v.id,
      insurer: f.insurer.trim() || undefined,
      startDate: f.startDate || undefined,
      endDate: f.endDate,
      premium: f.premium ? Number(f.premium) : undefined,
      idv: f.idv ? Number(f.idv) : undefined
    })
    onClose()
  }
  return (
    <Sheet title={`Insurance for ${v.regDisplay}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Label text="Insurer">
          <input className={field} value={f.insurer} onChange={(e) => setF({ ...f, insurer: e.target.value })} />
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <Label text="From">
            <input type="date" className={field} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Label>
          <Label text="To">
            <input type="date" required className={field} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Label text="Premium (₹)">
            <input type="number" inputMode="decimal" min="0" className={field} value={f.premium} onChange={(e) => setF({ ...f, premium: e.target.value })} />
          </Label>
          <Label text="IDV (₹)">
            <input type="number" inputMode="decimal" min="0" className={field} value={f.idv} onChange={(e) => setF({ ...f, idv: e.target.value })} />
          </Label>
        </div>
        <div className="pb-3">
          <Primary type="submit" disabled={!f.endDate}>
            Save policy
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

export function Vehicles() {
  const { snapshot, pending } = useData()
  const [sheet, setSheet] = useState<{ kind: 'cost' | 'puc' | 'policy'; v: Vehicle } | null>(null)
  if (!snapshot) return null
  return (
    <>
      {snapshot.vehicles
        .filter((v) => !v.meta.soldOn)
        .map((v) => {
          const waiting = pending.filter((e) => 'vehicleId' in e && e.vehicleId === v.id).length
          return (
            <Card key={v.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Plate text={v.regDisplay} />
                  <div className="mt-1 text-[13px] text-ink-muted">
                    {[v.meta.make, v.meta.model].filter(Boolean).join(' ')}
                    {v.lastKm ? `, ${v.lastKm.km.toLocaleString('en-IN')} km` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[17px] font-semibold">{v.value !== null ? lakhCrore(v.value) : '—'}</div>
                  <div className="text-[12px] text-ink-muted">worth about</div>
                </div>
              </div>
              <ul className="mt-3">
                {v.reminders.map((r) => (
                  <li key={r.key} className="flex justify-between gap-3 border-b border-rule py-1.5 text-[14px] last:border-0">
                    <span>{r.label}</span>
                    <span className={LEVEL[r.level]}>
                      {r.date ? (r.days! < 0 ? `${-r.days!} days overdue` : r.level === 'OK' ? day(r.date) : `in ${r.days} days`) : 'not recorded'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between text-[13px] text-ink-muted">
                <span>This month {inr(v.costs.thisMonth)}</span>
                <span>12 months {inr(v.costs.last12m)}</span>
                {v.costs.kmPerLitre && <span>{v.costs.kmPerLitre.toFixed(1)} km/l</span>}
              </div>
              {waiting > 0 && <p className="mt-1 text-[13px] text-ink-muted">{waiting} waiting for the computer.</p>}
              <div className="mt-3 grid grid-cols-3 gap-2 text-[14px]">
                <button className="min-h-11 rounded-xl bg-stamp-wash font-medium text-stamp" onClick={() => setSheet({ kind: 'cost', v })}>
                  Fuel or cost
                </button>
                {v.meta.fuel !== 'EV' && (
                  <button className="min-h-11 rounded-xl border border-rule-strong" onClick={() => setSheet({ kind: 'puc', v })}>
                    PUC done
                  </button>
                )}
                <button className="min-h-11 rounded-xl border border-rule-strong" onClick={() => setSheet({ kind: 'policy', v })}>
                  Insurance renewed
                </button>
              </div>
            </Card>
          )
        })}
      {sheet?.kind === 'cost' && <CostSheet v={sheet.v} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'puc' && <PucSheet v={sheet.v} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'policy' && <PolicySheet v={sheet.v} onClose={() => setSheet(null)} />}
    </>
  )
}
