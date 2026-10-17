import { and, desc, eq, sql } from 'drizzle-orm'
import type {
  PucCertificate,
  VehicleDocument,
  VehicleExpenseKind,
  VehicleInput,
  VehicleMeta,
  VehiclePolicy,
  VehicleReminder,
  VehicleView
} from '@shared/vehicles'
import { VEHICLE_TYPES } from '@shared/vehicles'
import { schema, type Db } from './db'
import { displayRegNo, normalizeRegNo } from './importers/vehicleDocs'
import { addDays, addMonths, addYears, todayIso, yearsBetween } from './portfolio/dates'

/**
 * Vehicles are kept apart from the investment portfolio: they lose value with age, so counting
 * them in the asset mix, XIRR or rebalancing would mislead. Their page shows an estimated value,
 * what is due (insurance, PUC, registration, service) and what they cost to run.
 */

const PARIVAHAN = 'https://vahan.parivahan.gov.in/vahanservice/'
const PUC_SITE = 'https://puc.parivahan.gov.in/puc/'

/**
 * IRDAI's depreciation for a vehicle's insured declared value by age: 5% under six months, then
 * 15%, 20%, 30%, 40% and 50% at four to five years. Beyond five years the IDV is agreed with the
 * insurer; 5 points more a year (to at most 90%) is a typical figure.
 */
export function idvDepreciation(ageYears: number): number {
  if (ageYears < 0.5) return 0.05
  if (ageYears < 1) return 0.15
  if (ageYears < 2) return 0.2
  if (ageYears < 3) return 0.3
  if (ageYears < 4) return 0.4
  if (ageYears < 5) return 0.5
  return Math.min(0.9, 0.5 + 0.05 * Math.floor(ageYears - 4))
}

const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

function validate(input: VehicleInput): VehicleMeta {
  const m = input.meta
  const reg = normalizeRegNo(m.regNo ?? '')
  if (!reg) throw new Error('Enter the registration number, e.g. GJ 01 AB 1234')
  if (!VEHICLE_TYPES.includes(m.type)) throw new Error('Choose what kind of vehicle it is')
  const isDate = (d: string | undefined, what: string) => {
    if (d !== undefined && d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`${what} is not a date`)
  }
  isDate(m.registrationDate, 'Registration date')
  isDate(m.purchaseDate, 'Purchase date')
  for (const p of m.policies ?? []) {
    isDate(p.endDate, 'Policy end date')
    if (!p.endDate) throw new Error('Enter when the insurance policy ends')
    if (p.startDate && p.startDate > p.endDate) throw new Error('The policy ends before it starts')
  }
  for (const p of m.puc ?? []) if (!p.validUntil) throw new Error('Enter until when the PUC is valid')
  for (const e of m.expenses ?? []) {
    if (!(e.amount > 0)) throw new Error('Enter the amount spent')
    isDate(e.date, 'Expense date')
  }
  return { ...m, regNo: reg }
}

export function saveVehicle(db: Db, input: VehicleInput): number {
  const meta = validate(input)
  const others = db.select().from(schema.vehicles).all()
  const dup = others.find((v) => v.id !== input.id && (JSON.parse(v.metaJson) as VehicleMeta).regNo === meta.regNo)
  if (dup) throw new Error(`${displayRegNo(meta.regNo)} is already added`)
  const metaJson = JSON.stringify(meta)
  if (input.id) {
    db.update(schema.vehicles).set({ personId: input.personId, metaJson }).where(eq(schema.vehicles.id, input.id)).run()
    return input.id
  }
  return Number(db.insert(schema.vehicles).values({ personId: input.personId, metaJson }).run().lastInsertRowid)
}

export function deleteVehicle(db: Db, id: number): void {
  db.transaction((tx) => {
    tx.delete(schema.documents)
      .where(and(eq(schema.documents.ownerType, 'VEHICLE'), eq(schema.documents.ownerId, id)))
      .run()
    tx.delete(schema.vehicles).where(eq(schema.vehicles.id, id)).run()
  })
}

const latest = <T>(xs: T[] | undefined, key: (x: T) => string | undefined): T | null =>
  [...(xs ?? [])].sort((a, b) => (key(b) ?? '').localeCompare(key(a) ?? ''))[0] ?? null

function reminders(m: VehicleMeta, policy: VehiclePolicy | null, puc: PucCertificate | null, lastKm: { date: string; km: number } | null, today: string): VehicleReminder[] {
  const out: VehicleReminder[] = []
  const level = (days: number, soon: number): VehicleReminder['level'] => (days < 0 ? 'OVERDUE' : days <= soon ? 'SOON' : 'OK')
  const born = m.registrationDate ?? m.purchaseDate

  if (!m.soldOn) {
    if (policy) {
      const d = daysBetween(today, policy.endDate)
      out.push({
        key: 'INSURANCE',
        label: 'Insurance',
        date: policy.endDate,
        days: d,
        level: level(d, 30),
        detail:
          d < 0
            ? `Ended ${day(policy.endDate)}. Driving without insurance is an offence; a policy that has lapsed over 90 days also loses its no-claim bonus.`
            : `${policy.insurer ?? 'Policy'}${policy.policyNumber ? ` ${policy.policyNumber}` : ''} runs to ${day(policy.endDate)}.${d <= 30 ? ' Renew before it ends to keep the no-claim bonus and skip an inspection.' : ''}`
      })
    } else
      out.push({
        key: 'INSURANCE',
        label: 'Insurance',
        date: null,
        days: null,
        level: 'OVERDUE',
        detail: 'No policy recorded. Add it, or read it from the policy PDF.'
      })

    // EVs need no PUC; a new vehicle needs its first one a year after registration.
    if (m.fuel !== 'EV') {
      if (puc) {
        const d = daysBetween(today, puc.validUntil)
        out.push({
          key: 'PUC',
          label: 'PUC certificate',
          date: puc.validUntil,
          days: d,
          level: level(d, 15),
          detail: d < 0 ? `Expired ${day(puc.validUntil)}. The fine starts at ₹10,000.` : `Valid to ${day(puc.validUntil)}.`,
          link: { label: 'Check on Parivahan', url: PUC_SITE }
        })
      } else if (born && addYears(born, 1) > today) {
        const due = addYears(born, 1)
        out.push({
          key: 'PUC',
          label: 'PUC certificate',
          date: due,
          days: daysBetween(today, due),
          level: level(daysBetween(today, due), 15),
          detail: `A new vehicle's first PUC is due a year after registration, ${day(due)}.`
        })
      } else
        out.push({
          key: 'PUC',
          label: 'PUC certificate',
          date: null,
          days: null,
          level: 'SOON',
          detail: 'No PUC recorded. Add its validity date so you get a reminder.',
          link: { label: 'Check on Parivahan', url: PUC_SITE }
        })
    }

    // A private vehicle's registration lasts 15 years, then renews every 5.
    const regUntil = m.registrationValidUntil ?? (born && m.type !== 'COMMERCIAL' ? addDays(addYears(born, 15), -1) : null)
    if (regUntil) {
      const d = daysBetween(today, regUntil)
      out.push({
        key: 'REGISTRATION',
        label: 'Registration (RC)',
        date: regUntil,
        days: d,
        level: level(d, 90),
        detail:
          d < 0
            ? `Lapsed ${day(regUntil)}. Apply for renewal (fitness test) at the RTO.`
            : `Valid to ${day(regUntil)}${m.registrationValidUntil ? '' : ', 15 years from registration'}.`,
        link: { label: 'Vahan services', url: PARIVAHAN }
      })
    }

    // Service: from the last one recorded, by months or km, whichever comes first.
    const services = (m.expenses ?? []).filter((e) => e.kind === 'SERVICE').sort((a, b) => b.date.localeCompare(a.date))
    const months = m.serviceEveryMonths ?? (m.type === 'TWO_WHEELER' ? 6 : 12)
    const km = m.serviceEveryKm ?? (m.type === 'TWO_WHEELER' ? 3000 : 10000)
    if (services.length) {
      const last = services[0]
      const due = addMonths(last.date, months)
      const d = daysBetween(today, due)
      const kmLeft = last.km !== undefined && lastKm ? last.km + km - lastKm.km : null
      const lv = kmLeft !== null && kmLeft < 0 ? 'OVERDUE' : kmLeft !== null && kmLeft <= 500 ? 'SOON' : level(d, 21)
      out.push({
        key: 'SERVICE',
        label: 'Service',
        date: due,
        days: d,
        level: lv,
        detail: `Last serviced ${day(last.date)}${last.km !== undefined ? ` at ${last.km.toLocaleString('en-IN')} km` : ''}; next every ${months} months or ${km.toLocaleString('en-IN')} km${kmLeft !== null ? `, ${Math.abs(kmLeft).toLocaleString('en-IN')} km ${kmLeft < 0 ? 'over' : 'to go'}` : ''}.`
      })
    }

    if (m.loan?.endDate) {
      const d = daysBetween(today, m.loan.endDate)
      out.push({
        key: 'LOAN',
        label: 'Loan',
        date: m.loan.endDate,
        days: d,
        level: d < 0 ? 'SOON' : d <= 60 ? 'SOON' : 'OK',
        detail:
          d < 0
            ? `Paid off ${day(m.loan.endDate)}. Get the lender's NOC and Form 35, and have the hypothecation removed from the RC (Vahan services).`
            : `${m.loan.emi ? `${money(m.loan.emi)} a month` : 'EMIs'}${m.loan.lender ? ` to ${m.loan.lender}` : ''} until ${day(m.loan.endDate)}.`,
        link: d < 0 ? { label: 'Vahan services', url: PARIVAHAN } : undefined
      })
    }
  }
  // Most urgent first; at the same urgency the legal ones (insurance, PUC, RC) before the rest.
  const rank = { OVERDUE: 0, SOON: 1, OK: 2 }
  const legal = (r: VehicleReminder) => (['INSURANCE', 'PUC', 'REGISTRATION'].includes(r.key) ? 0 : 1)
  return out.sort(
    (a, b) => rank[a.level] - rank[b.level] || legal(a) - legal(b) || (a.days ?? -1e9) - (b.days ?? -1e9)
  )
}

function documentsOf(db: Db, id: number): VehicleDocument[] {
  return db
    .select({
      id: schema.documents.id,
      kind: schema.documents.kind,
      fileName: schema.documents.fileName,
      mime: schema.documents.mime,
      size: sql<number>`length(${schema.documents.data})`,
      createdAt: schema.documents.createdAt
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.ownerType, 'VEHICLE'), eq(schema.documents.ownerId, id)))
    .orderBy(desc(schema.documents.createdAt))
    .all()
}

export function vehicleView(
  db: Db,
  row: { id: number; personId: number; metaJson: string },
  personName: string,
  today = todayIso()
): VehicleView {
  const m = JSON.parse(row.metaJson) as VehicleMeta
  const policy = latest(m.policies, (p) => p.endDate)
  const puc = latest(m.puc, (p) => p.validUntil)
  const born = m.registrationDate ?? m.purchaseDate ?? null
  const ageYears = born ? yearsBetween(born, today) : null

  // Value: the latest policy's IDV carried forward by the depreciation since, else the ex-showroom price.
  let value: number | null = null
  let valueNote: string
  const withIdv = [...(m.policies ?? [])].filter((p) => p.idv && (p.startDate ?? born)).sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
  if (m.soldOn) valueNote = `Sold ${day(m.soldOn)}.`
  else if (withIdv && born && ageYears !== null) {
    const at = withIdv.startDate ?? addYears(withIdv.endDate, -1)
    const ageAt = Math.max(0, yearsBetween(born, at))
    value = (withIdv.idv! * (1 - idvDepreciation(ageYears))) / (1 - idvDepreciation(ageAt))
    valueNote = `The insured declared value of ${money(withIdv.idv!)} on ${day(at)}, less IRDAI's age-based depreciation since. A private sale often fetches 10–20% more.`
  } else if (m.exShowroomPrice && ageYears !== null) {
    value = m.exShowroomPrice * (1 - idvDepreciation(ageYears))
    valueNote = `Ex-showroom price ${money(m.exShowroomPrice)} less ${Math.round(idvDepreciation(ageYears) * 100)}% for ${ageYears < 1 ? 'under a year' : `${Math.floor(ageYears)} year${Math.floor(ageYears) > 1 ? 's' : ''}`} of age (IRDAI's IDV schedule).`
  } else valueNote = 'Add the ex-showroom price or the insurance policy (its IDV) for an estimate.'

  // Running costs.
  const yearAgo = addMonths(today, -12)
  const recent = (m.expenses ?? []).filter((e) => e.date > yearAgo && e.date <= today)
  const byKindMap = new Map<VehicleExpenseKind, number>()
  for (const e of recent) byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + e.amount)
  const monthly: { month: string; amount: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const month = addMonths(today, -i).slice(0, 7)
    monthly.push({ month, amount: recent.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0) })
  }
  const readings = (m.expenses ?? [])
    .filter((e) => e.km !== undefined && e.km > 0)
    .map((e) => ({ date: e.date, km: e.km! }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km)
  const lastKm = readings.at(-1) ?? null
  const inYear = readings.filter((r) => r.date > yearAgo)
  const kmLast12m = inYear.length >= 2 ? inYear.at(-1)!.km - inYear[0].km : null
  const last12m = recent.reduce((s, e) => s + e.amount, 0)
  // Fuel economy: distance between the first and last fill with a reading, over the fuel bought after the first.
  const fills = (m.expenses ?? [])
    .filter((e) => e.kind === 'FUEL' && e.km && e.litres)
    .sort((a, b) => a.km! - b.km!)
  const kmPerLitre =
    fills.length >= 2 ? (fills.at(-1)!.km! - fills[0].km!) / fills.slice(1).reduce((s, e) => s + e.litres!, 0) : null

  return {
    id: row.id,
    personId: row.personId,
    personName,
    meta: m,
    regDisplay: displayRegNo(m.regNo),
    ageYears,
    value,
    valueNote,
    policy,
    puc,
    reminders: reminders(m, policy, puc, lastKm, today),
    costs: {
      byKind: [...byKindMap].map(([kind, amount]) => ({ kind, amount })).sort((a, b) => b.amount - a.amount),
      last12m,
      thisMonth: monthly.at(-1)!.amount,
      perKm: kmLast12m && kmLast12m > 0 ? last12m / kmLast12m : null,
      kmPerLitre: kmPerLitre && Number.isFinite(kmPerLitre) && kmPerLitre > 0 ? kmPerLitre : null,
      kmLast12m,
      monthly
    },
    lastKm,
    documents: documentsOf(db, row.id)
  }
}

export function listVehicles(db: Db, personId?: number, today = todayIso()): VehicleView[] {
  const names = new Map(db.select().from(schema.persons).all().map((p) => [p.id, p.name]))
  return db
    .select()
    .from(schema.vehicles)
    .all()
    .filter((r) => personId === undefined || r.personId === personId)
    .map((r) => vehicleView(db, r, names.get(r.personId) ?? '', today))
    .sort((a, b) => Number(!!a.meta.soldOn) - Number(!!b.meta.soldOn) || a.regDisplay.localeCompare(b.regDisplay))
}

// ---------------- documents ----------------

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}
export const DOCUMENT_EXTENSIONS = Object.keys(MIME)
const MAX_BYTES = 20 * 1024 * 1024

export function addDocument(
  db: Db,
  owner: { type: 'VEHICLE' | 'PROPERTY' | 'PERSON'; id: number },
  kind: string,
  fileName: string,
  data: Buffer
): number {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[ext]
  if (!mime) throw new Error('Add a PDF or a photo (JPG, PNG)')
  if (data.length > MAX_BYTES) throw new Error('That file is over 20 MB')
  return Number(
    db
      .insert(schema.documents)
      .values({ ownerType: owner.type, ownerId: owner.id, kind, fileName, mime, data })
      .run().lastInsertRowid
  )
}

export function getDocument(db: Db, id: number) {
  const d = db.select().from(schema.documents).where(eq(schema.documents.id, id)).get()
  if (!d) throw new Error('That document is no longer there')
  return d
}

export function deleteDocument(db: Db, id: number): void {
  db.delete(schema.documents).where(eq(schema.documents.id, id)).run()
}
