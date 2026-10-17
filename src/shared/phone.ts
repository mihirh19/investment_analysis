// What the desktop sends the phone, and what the phone sends back, through the person's Google
// Drive (hidden app folder), sealed with vault.ts. Shared by main, the renderer and the phone app.

import type { ChartGroup, PropertyExpenseKind, PropertyView } from './assets'
import type { Forecast } from './plan'
import type { AssetClass, Platform } from './types'
import type { VehicleExpenseKind, VehicleView } from './vehicles'

export const SNAPSHOT_FILE = 'fp-snapshot.json'
export const INBOX_PREFIX = 'fp-inbox-'

export interface PhoneHolding {
  personId: number
  accountId: number
  instrumentId: number
  name: string
  account: string
  platform: Platform
  assetClass: AssetClass
  group: ChartGroup
  quantity: number
  price: number | null
  priceDate: string | null
  currency: string
  value: number
  invested: number | null
  dayChange: number | null
}

/** Figures that depend on whose money is shown: the family, or one person. */
export interface PhoneScope {
  netWorth: number
  invested: number
  dayChange: number
  xirr: number | null
  xirrCoverage: number
  /** Month-end net worth, last five years at most. */
  history: { months: string[]; values: number[] }
  byGroup: { group: ChartGroup; value: number }[]
  upcoming: { date: string; label: string; amount: number; holding: string; personName: string }[]
  incomeThisFy: { dividends: number; interest: number; rent: number }
}

export interface PhoneSnapshot {
  version: 1
  /** When the desktop built it. */
  generatedAt: string
  pricesAsOf: string | null
  persons: { id: number; name: string }[]
  scopes: Record<string, PhoneScope>
  holdings: PhoneHolding[]
  properties: PropertyView[]
  vehicles: Omit<VehicleView, 'documents'>[]
  forecast: Forecast | null
  policies: { name: string; personName: string; nextDue: string | null; premium: number; insurer: string }[]
  /** Phone entries the desktop has applied (most recent), so the phone can stop showing them as pending. */
  applied: string[]
}

/** Something recorded on the phone, applied by the desktop on its next sync. */
export type PhoneEntry = { id: string; at: string } & (
  | { type: 'RENT'; propertyId: number; date: string; forMonth: string; amount: number; tenancyId?: string }
  | { type: 'PROPERTY_EXPENSE'; propertyId: number; date: string; kind: PropertyExpenseKind; amount: number; note?: string }
  | {
      type: 'VEHICLE_EXPENSE'
      vehicleId: number
      date: string
      kind: VehicleExpenseKind
      amount: number
      km?: number
      litres?: number
      note?: string
    }
  | { type: 'VEHICLE_PUC'; vehicleId: number; validUntil: string; date?: string; amount?: number }
  | { type: 'VEHICLE_POLICY'; vehicleId: number; endDate: string; startDate?: string; insurer?: string; premium?: number; idv?: number }
  | { type: 'ASSET_VALUE'; accountId: number; date: string; value: number }
)

export type PhoneEntryType = PhoneEntry['type']

export interface PhoneSyncStatus {
  /** The Google account whose Drive carries the data. */
  account: string | null
  /** The sign-in client is a "Web application" one, so the phone can use it too. */
  webClient: boolean
  /** That account has allowed the hidden Drive folder. */
  driveAllowed: boolean
  passphraseSet: boolean
  lastSync: string | null
  lastError: string | null
  lastApplied: number
  /** The address the phone opens, with the sign-in client in it. */
  phoneUrl: string | null
}
