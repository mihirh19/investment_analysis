import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  EpfAccountView,
  EpfInput,
  NpsAccountInput,
  NpsHoldingInput,
  PolicyInput,
  PolicyView,
  PremiumFrequency
} from '@shared/types'
import { schema, type Db } from './db'
import { persistBundle } from './importers/bundle'
import { estimateEpfBalance, parseEpfMeta } from './portfolio/epf'

/**
 * Hand-maintained assets: EPF balances, insurance policies and NPS units typed in without a CAS.
 * Each lives as an account with one instrument; values are stored as MANUAL holding snapshots so
 * they flow through holdings, totals and exposure like everything else.
 */

const today = () => new Date().toISOString().slice(0, 10)

interface WithInstrument {
  instrumentId: number
}

function readMeta<T>(json: string | null): T & WithInstrument {
  try {
    return JSON.parse(json ?? '{}')
  } catch {
    return {} as T & WithInstrument
  }
}

function upsertValue(db: Db, accountId: number, instrumentId: number, date: string, value: number) {
  db.insert(schema.holdingSnapshots)
    .values({ accountId, instrumentId, date, quantity: 1, price: value, value, source: 'MANUAL' })
    .onConflictDoUpdate({
      target: [
        schema.holdingSnapshots.accountId,
        schema.holdingSnapshots.instrumentId,
        schema.holdingSnapshots.date,
        schema.holdingSnapshots.source
      ],
      set: { price: value, value, quantity: 1 }
    })
    .run()
}

function createAccountWithInstrument(
  db: Db,
  a: {
    personId: number
    platform: 'EPF' | 'INSURANCE'
    kind: 'EPF' | 'INSURANCE'
    name: string
    externalId: string | null
  },
  instrumentName: string,
  meta: object
): number {
  return db.transaction((tx) => {
    const instrument = tx
      .insert(schema.instruments)
      .values({ name: instrumentName, assetClass: a.kind, currency: 'INR' })
      .returning({ id: schema.instruments.id })
      .get()
    const account = tx
      .insert(schema.accounts)
      .values({ ...a, currency: 'INR', metaJson: JSON.stringify({ ...meta, instrumentId: instrument.id }) })
      .returning({ id: schema.accounts.id })
      .get()
    return account.id
  })
}

function getAccount(db: Db, accountId: number, kind: 'EPF' | 'INSURANCE') {
  const a = db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.kind, kind)))
    .get()
  if (!a) throw new Error(`No ${kind === 'EPF' ? 'EPF account' : 'policy'} with id ${accountId}`)
  return a
}

// ---------------- EPF ----------------

export function listEpf(db: Db): EpfAccountView[] {
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  return db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.kind, 'EPF'))
    .all()
    .map((a) => {
      const meta = parseEpfMeta(a.metaJson)
      const entries = db
        .select({ date: schema.holdingSnapshots.date, balance: schema.holdingSnapshots.value })
        .from(schema.holdingSnapshots)
        .where(eq(schema.holdingSnapshots.accountId, a.id))
        .orderBy(asc(schema.holdingSnapshots.date))
        .all()
        .map((e) => ({ date: e.date, balance: e.balance ?? 0 }))
      const last = entries[entries.length - 1]
      return {
        accountId: a.id,
        personId: a.personId,
        personName: persons.get(a.personId) ?? '',
        name: a.name,
        uan: meta.uan,
        monthlyContribution: meta.monthlyContribution,
        interestRate: meta.interestRate,
        entries,
        estimatedBalance: last ? estimateEpfBalance(last.balance, last.date, today(), meta) : null
      }
    })
}

export function saveEpf(db: Db, input: EpfInput): number {
  const name = input.name.trim() || 'EPF'
  if (!(input.monthlyContribution >= 0)) throw new Error('Monthly contribution must be zero or more')
  if (!(input.interestRate >= 0 && input.interestRate < 20))
    throw new Error('Interest rate looks wrong; enter a percentage like 8.25')
  const meta = {
    uan: input.uan?.trim() || null,
    monthlyContribution: input.monthlyContribution,
    interestRate: input.interestRate
  }
  if (input.accountId) {
    const a = getAccount(db, input.accountId, 'EPF')
    const old = readMeta<object>(a.metaJson)
    db.update(schema.accounts)
      .set({
        name,
        personId: input.personId,
        externalId: meta.uan,
        metaJson: JSON.stringify({ ...meta, instrumentId: old.instrumentId })
      })
      .where(eq(schema.accounts.id, a.id))
      .run()
    db.update(schema.instruments)
      .set({ name: `EPF · ${name}` })
      .where(eq(schema.instruments.id, old.instrumentId))
      .run()
    return a.id
  }
  return createAccountWithInstrument(
    db,
    { personId: input.personId, platform: 'EPF', kind: 'EPF', name, externalId: meta.uan },
    `EPF · ${name}`,
    meta
  )
}

export function addEpfEntry(db: Db, accountId: number, date: string, balance: number): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new Error('Pick a date that is not in the future')
  if (!(balance >= 0)) throw new Error('Balance must be zero or more')
  const a = getAccount(db, accountId, 'EPF')
  upsertValue(db, a.id, readMeta<object>(a.metaJson).instrumentId, date, balance)
}

export function deleteEpfEntry(db: Db, accountId: number, date: string): void {
  db.delete(schema.holdingSnapshots)
    .where(and(eq(schema.holdingSnapshots.accountId, accountId), eq(schema.holdingSnapshots.date, date)))
    .run()
}

// ---------------- Insurance ----------------

const PER_YEAR: Record<PremiumFrequency, number> = { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, YEARLY: 1, SINGLE: 0 }

type PolicyMeta = Omit<PolicyInput, 'accountId' | 'personId' | 'currentValue'>

export function listPolicies(db: Db): PolicyView[] {
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  return db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.kind, 'INSURANCE'))
    .all()
    .map((a) => {
      const meta = readMeta<PolicyMeta>(a.metaJson)
      const value = db
        .select()
        .from(schema.holdingSnapshots)
        .where(eq(schema.holdingSnapshots.accountId, a.id))
        .orderBy(desc(schema.holdingSnapshots.date))
        .get()
      return {
        accountId: a.id,
        personId: a.personId,
        personName: persons.get(a.personId) ?? '',
        insurer: meta.insurer ?? '',
        name: meta.name ?? a.name,
        policyNumber: meta.policyNumber ?? a.externalId ?? '',
        type: meta.type ?? 'OTHER',
        sumAssured: meta.sumAssured ?? 0,
        premium: meta.premium ?? 0,
        premiumFrequency: meta.premiumFrequency ?? 'YEARLY',
        startDate: meta.startDate,
        nextDueDate: meta.nextDueDate,
        maturityDate: meta.maturityDate,
        currentValue: value?.value ?? undefined,
        valueDate: value?.date ?? null,
        annualPremium: (meta.premium ?? 0) * PER_YEAR[meta.premiumFrequency ?? 'YEARLY']
      }
    })
}

export function savePolicy(db: Db, input: PolicyInput): number {
  if (!input.name.trim() || !input.insurer.trim()) throw new Error('Insurer and policy name are required')
  if (!(input.sumAssured >= 0) || !(input.premium >= 0)) throw new Error('Cover and premium must be zero or more')
  const meta: PolicyMeta = {
    insurer: input.insurer.trim(),
    name: input.name.trim(),
    policyNumber: input.policyNumber.trim(),
    type: input.type,
    sumAssured: input.sumAssured,
    premium: input.premium,
    premiumFrequency: input.premiumFrequency,
    startDate: input.startDate || undefined,
    nextDueDate: input.nextDueDate || undefined,
    maturityDate: input.maturityDate || undefined
  }
  const accountName = `${meta.insurer} · ${meta.name}`
  let accountId: number
  let instrumentId: number
  if (input.accountId) {
    const a = getAccount(db, input.accountId, 'INSURANCE')
    instrumentId = readMeta<object>(a.metaJson).instrumentId
    db.update(schema.accounts)
      .set({
        name: accountName,
        personId: input.personId,
        externalId: meta.policyNumber || null,
        metaJson: JSON.stringify({ ...meta, instrumentId })
      })
      .where(eq(schema.accounts.id, a.id))
      .run()
    db.update(schema.instruments).set({ name: meta.name }).where(eq(schema.instruments.id, instrumentId)).run()
    accountId = a.id
  } else {
    accountId = createAccountWithInstrument(
      db,
      {
        personId: input.personId,
        platform: 'INSURANCE',
        kind: 'INSURANCE',
        name: accountName,
        externalId: meta.policyNumber || null
      },
      meta.name,
      meta
    )
    instrumentId = readMeta<object>(getAccount(db, accountId, 'INSURANCE').metaJson).instrumentId
  }

  // Only savings-type policies carry a value; pure cover (term, health) never counts towards net worth.
  const hasValue =
    input.currentValue !== undefined && input.currentValue > 0 && input.type !== 'TERM' && input.type !== 'HEALTH'
  if (hasValue) upsertValue(db, accountId, instrumentId, today(), input.currentValue!)
  else db.delete(schema.holdingSnapshots).where(eq(schema.holdingSnapshots.accountId, accountId)).run()
  return accountId
}

export function deletePolicy(db: Db, accountId: number): void {
  const a = getAccount(db, accountId, 'INSURANCE')
  const { instrumentId } = readMeta<object>(a.metaJson)
  db.transaction((tx) => {
    tx.delete(schema.holdingSnapshots).where(eq(schema.holdingSnapshots.accountId, accountId)).run()
    tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run()
    if (instrumentId) tx.delete(schema.instruments).where(eq(schema.instruments.id, instrumentId)).run()
  })
}

// ---------------- NPS without a CAS ----------------

export function addNpsHolding(db: Db, input: NpsHoldingInput): void {
  if (!(input.units > 0)) throw new Error('Units must be more than zero')
  if (!input.schemeCode) throw new Error('Pick a scheme')
  const pran = input.pran?.replace(/\s+/g, '') || null
  persistBundle(db, {
    personId: input.personId,
    kind: 'MANUAL',
    fileName: `NPS: ${input.schemeName}`,
    bundle: {
      accounts: [
        {
          key: 'A',
          platform: 'NPS',
          kind: 'NPS',
          name: pran ? `NPS · ${pran}` : 'NPS',
          externalId: pran,
          currency: 'INR'
        }
      ],
      instruments: [{ key: 'I', isin: null, name: input.schemeName, assetClass: 'NPS', currency: 'INR' }],
      transactions: [],
      snapshots: [
        {
          accountKey: 'A',
          instrumentKey: 'I',
          date: input.date,
          quantity: input.units,
          price: null,
          value: null,
          cost: null,
          source: 'MANUAL'
        }
      ],
      warnings: []
    }
  })
  db.update(schema.instruments)
    .set({ npsCode: input.schemeCode })
    .where(and(eq(schema.instruments.name, input.schemeName), eq(schema.instruments.assetClass, 'NPS')))
    .run()
}

// ---------------- NPS the way a POP shows it ----------------

/** Pension fund managers, by the word their scheme names share. */
export const NPS_MANAGERS: { key: string; name: string; match: RegExp }[] = [
  { key: 'SBI', name: 'SBI Pension Funds', match: /\bSBI\b/ },
  { key: 'LIC', name: 'LIC Pension Fund', match: /\bLIC\b/ },
  { key: 'UTI', name: 'UTI Retirement Solutions', match: /\bUTI\b/ },
  { key: 'HDFC', name: 'HDFC Pension Fund', match: /\bHDFC\b/ },
  { key: 'ICICI', name: 'ICICI Prudential Pension Fund', match: /\bICICI\b/ },
  { key: 'KOTAK', name: 'Kotak Mahindra Pension Fund', match: /\bKOTAK\b/ },
  { key: 'ABSL', name: 'Aditya Birla Sun Life Pension', match: /\bBIRLA\b/ },
  { key: 'TATA', name: 'Tata Pension Fund', match: /\bTATA\b/ },
  { key: 'AXIS', name: 'Axis Pension Fund (Max Life)', match: /\bAXIS\b|\bMAX\b/ },
  { key: 'DSP', name: 'DSP Pension Fund', match: /\bDSP\b/ }
]

/**
 * The npsnav scheme for a manager, asset class (E, C, G, A) and tier, bought through a POP (a
 * broker like Zerodha Coin, or a bank), directly (eNPS) or under the government sector. Each has
 * its own NAV, so the plain name (POP) must not be mistaken for the DIRECT or GS one.
 */
export function pickNpsScheme(
  schemes: { code: string; name: string }[],
  q: { manager: string; letter: string; tier: 'I' | 'II'; route: 'POP' | 'DIRECT' | 'GS' }
): { code: string; name: string } | null {
  const mgr = NPS_MANAGERS.find((m) => m.key === q.manager)
  if (!mgr) return null
  const re = new RegExp(String.raw`SCHEME\s*-?\s*${q.letter}\s*-\s*TIER\s*-?\s*${q.tier}(?![I\w])`, 'i')
  const fits = schemes.filter((s) => {
    const n = s.name.toUpperCase()
    if (!mgr.match.test(n) || !re.test(n)) return false
    if (/TAX SAVER|SURAKSHIT|VATSALYA|SANCHAY|ADVANTAGE|LITE|ATAL|SWAVALAMBAN/.test(n)) return false
    const direct = /\bDIRECT\b/.test(n)
    const gs = /\bGS\b|GOVT|GOVERNMENT|CENTRAL|STATE/.test(n)
    return q.route === 'DIRECT' ? direct : q.route === 'GS' ? gs : !direct && !gs
  })
  return fits.sort((a, b) => a.name.length - b.name.length)[0] ?? null
}

/**
 * Adds an NPS account from what a POP's screen shows (current value and amount invested per
 * scheme). Units are worked out from the latest NAV, so the value then moves with each day's NAV.
 */
export async function addNpsAccount(
  db: Db,
  input: NpsAccountInput,
  market: {
    schemes(): Promise<{ code: string; name: string }[]>
    latest(code: string): Promise<{ nav: number; date: string }>
  }
): Promise<string[]> {
  const rows = input.rows.filter((r) => r.value > 0)
  if (rows.length === 0) throw new Error('Enter the current value of at least one scheme')
  const schemes = await market.schemes()
  const pran = input.pran?.replace(/\s+/g, '') || null
  const added: string[] = []
  for (const r of rows) {
    const s = pickNpsScheme(schemes, { manager: input.manager, letter: r.letter, tier: input.tier, route: input.route })
    if (!s) throw new Error(`No ${input.manager} scheme ${r.letter} – Tier ${input.tier} found for that route`)
    const { nav, date } = await market.latest(s.code)
    const units = r.value / nav
    persistBundle(db, {
      personId: input.personId,
      kind: 'MANUAL',
      fileName: `NPS: ${s.name}`,
      bundle: {
        accounts: [
          { key: 'A', platform: 'NPS', kind: 'NPS', name: pran ? `NPS · ${pran}` : 'NPS', externalId: pran, currency: 'INR' }
        ],
        instruments: [{ key: 'I', isin: null, name: s.name, assetClass: 'NPS', currency: 'INR' }],
        transactions: [],
        snapshots: [
          {
            accountKey: 'A',
            instrumentKey: 'I',
            date,
            quantity: units,
            price: nav,
            value: r.value,
            cost: r.invested && r.invested > 0 ? r.invested : null,
            source: 'MANUAL'
          }
        ],
        warnings: []
      }
    })
    db.update(schema.instruments)
      .set({ npsCode: s.code })
      .where(and(eq(schema.instruments.name, s.name), eq(schema.instruments.assetClass, 'NPS')))
      .run()
    added.push(s.name)
  }
  return added
}

/**
 * Removes one holding (an account's units of one instrument): its statements and trades here.
 * The account goes too once it holds nothing else. A statement imported again brings it back.
 */
export function removeHolding(db: Db, accountId: number, instrumentId: number): void {
  db.transaction((tx) => {
    const pair = (t: typeof schema.holdingSnapshots | typeof schema.transactions) =>
      and(eq(t.accountId, accountId), eq(t.instrumentId, instrumentId))
    tx.delete(schema.holdingSnapshots).where(pair(schema.holdingSnapshots)).run()
    tx.delete(schema.transactions).where(pair(schema.transactions)).run()
    tx.delete(schema.costBasis)
      .where(and(eq(schema.costBasis.accountId, accountId), eq(schema.costBasis.instrumentId, instrumentId)))
      .run()
    const left =
      tx.select().from(schema.holdingSnapshots).where(eq(schema.holdingSnapshots.accountId, accountId)).get() ??
      tx.select().from(schema.transactions).where(eq(schema.transactions.accountId, accountId)).get()
    const account = tx.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get()
    if (!left && account && account.kind === 'NPS' && account.platform === 'NPS') {
      tx.delete(schema.costBasis).where(eq(schema.costBasis.accountId, accountId)).run()
      tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run()
    }
  })
}
