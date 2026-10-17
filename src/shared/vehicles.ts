// Vehicles: details, insurance, PUC, running costs and reminders. Shared by main and renderer.

export const VEHICLE_TYPES = ['CAR', 'TWO_WHEELER', 'COMMERCIAL', 'OTHER'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const FUELS = ['PETROL', 'DIESEL', 'CNG', 'EV', 'HYBRID', 'OTHER'] as const
export type Fuel = (typeof FUELS)[number]

export const POLICY_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY', 'OWN_DAMAGE'] as const
export type PolicyType = (typeof POLICY_TYPES)[number]

/** One insurance policy period. Renewals add a new one; the latest is in force. */
export interface VehiclePolicy {
  id: string
  insurer?: string
  policyNumber?: string
  type?: PolicyType
  startDate?: string
  endDate: string
  /** Insured declared value: what the insurer would pay if the vehicle were stolen or written off. */
  idv?: number
  premium?: number
  /** No-claim bonus, percent. */
  ncbPct?: number
}

export interface PucCertificate {
  id: string
  certificateNo?: string
  date?: string
  validUntil: string
}

export const VEHICLE_EXPENSE_KINDS = [
  'FUEL',
  'SERVICE',
  'REPAIR',
  'TYRES',
  'INSURANCE',
  'PUC',
  'TOLL',
  'PARKING',
  'CHALLAN',
  'OTHER'
] as const
export type VehicleExpenseKind = (typeof VEHICLE_EXPENSE_KINDS)[number]

export interface VehicleExpense {
  id: string
  date: string
  kind: VehicleExpenseKind
  amount: number
  /** Odometer reading then, if noted. */
  km?: number
  /** Fuel bought, litres (or kWh for an EV). */
  litres?: number
  note?: string
}

export interface VehicleMeta {
  /** Registration number as printed, e.g. GJ01AB1234 (stored without spaces). */
  regNo: string
  type: VehicleType
  make?: string
  model?: string
  variant?: string
  fuel?: Fuel
  colour?: string
  ownerName?: string
  registrationDate?: string
  /** Registration (RC) valid until: 15 years from registration for a private vehicle. */
  registrationValidUntil?: string
  purchaseDate?: string
  /** Ex-showroom price, which insurers depreciate for the IDV. */
  exShowroomPrice?: number
  /** What was paid on the road (with registration, road tax and insurance), for the record. */
  onRoadPrice?: number
  policies?: VehiclePolicy[]
  puc?: PucCertificate[]
  /** Service every so many months or km, whichever comes first. */
  serviceEveryMonths?: number
  serviceEveryKm?: number
  expenses?: VehicleExpense[]
  /** Loan against it, if any. */
  loan?: { lender?: string; emi?: number; endDate?: string }
  soldOn?: string
  notes?: string
}

export type ReminderLevel = 'OVERDUE' | 'SOON' | 'OK'

export interface VehicleReminder {
  key: 'INSURANCE' | 'PUC' | 'REGISTRATION' | 'SERVICE' | 'LOAN'
  label: string
  /** When it falls due (or fell due). */
  date: string | null
  days: number | null
  level: ReminderLevel
  detail: string
  /** Where to renew or check it. */
  link?: { label: string; url: string }
}

export interface VehicleDocument {
  id: number
  kind: string
  fileName: string
  mime: string
  size: number
  createdAt: string
}

export interface VehicleView {
  id: number
  personId: number
  personName: string
  meta: VehicleMeta
  /** "GJ 01 AB 1234". */
  regDisplay: string
  ageYears: number | null
  /** Estimated value today and how it was worked out. */
  value: number | null
  valueNote: string
  policy: VehiclePolicy | null
  puc: PucCertificate | null
  reminders: VehicleReminder[]
  costs: {
    /** Last 12 months, by kind. */
    byKind: { kind: VehicleExpenseKind; amount: number }[]
    last12m: number
    thisMonth: number
    /** Running cost per km over the last 12 months, when odometer readings allow. */
    perKm: number | null
    /** Fuel economy, km per litre (or kWh), from full-tank entries with odometer readings. */
    kmPerLitre: number | null
    kmLast12m: number | null
    monthly: { month: string; amount: number }[]
  }
  lastKm: { date: string; km: number } | null
  documents: VehicleDocument[]
}

export interface VehicleInput {
  id?: number
  personId: number
  meta: VehicleMeta
}

/** What could be read off an RC, insurance policy or PUC certificate. The person confirms it. */
export interface VehicleDocRead {
  kind: 'RC' | 'INSURANCE' | 'PUC' | 'UNKNOWN'
  regNo?: string
  meta: Partial<VehicleMeta>
  policy?: Partial<VehiclePolicy>
  puc?: Partial<PucCertificate>
  /** Labels found, for showing what was read. */
  found: string[]
}
