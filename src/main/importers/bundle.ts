import { createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { AccountKind, AssetClass, ImportKind, ImportResult, Platform, TxnType } from '@shared/types'
import { schema, type Db } from '../db'

/** Source-agnostic shape every importer produces; `persistBundle` writes it to the DB. */
export interface ImportBundle {
  accounts: NormAccount[]
  instruments: NormInstrument[]
  transactions: NormTxn[]
  snapshots: NormSnapshot[]
  warnings: string[]
}

export interface NormAccount {
  key: string
  platform: Platform
  kind: AccountKind
  name: string
  externalId: string | null
  currency: string
}

export interface NormInstrument {
  key: string
  isin: string | null
  name: string
  assetClass: AssetClass
  symbolNse?: string | null
  symbolBse?: string | null
  tickerUs?: string | null
  amfiCode?: string | null
  mfType?: string | null
  currency: string
}

export interface NormTxn {
  accountKey: string
  instrumentKey: string
  date: string
  type: TxnType
  quantity: number
  price: number | null
  amount: number
  fees: number
  currency: string
  description: string | null
  source: string
  externalId: string
}

export interface NormSnapshot {
  accountKey: string
  instrumentKey: string
  date: string
  quantity: number
  price: number | null
  value: number | null
  cost: number | null
  source: string
}

export function emptyBundle(): ImportBundle {
  return { accounts: [], instruments: [], transactions: [], snapshots: [], warnings: [] }
}

/** Short stable hash used as a dedupe key for rows that have no id of their own. */
export function rowHash(...parts: unknown[]): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20)
}

/**
 * Adds an index to rows whose content is identical within one file, so two genuine
 * identical trades stay distinct while a re-import of the same file is still skipped.
 */
export function makeOccurrenceKeyer(): (...parts: unknown[]) => string {
  const seen = new Map<string, number>()
  return (...parts) => {
    const base = rowHash(...parts)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  }
}

export function persistBundle(
  db: Db,
  opts: { personId: number; kind: ImportKind; fileName: string; bundle: ImportBundle }
): ImportResult {
  const { personId, kind, fileName, bundle } = opts

  return db.transaction((tx) => {
    const batch = tx
      .insert(schema.importBatches)
      .values({ kind, fileName, personId })
      .returning({ id: schema.importBatches.id })
      .get()

    const result: ImportResult = {
      batchId: batch.id,
      kind,
      fileName,
      accountsCreated: 0,
      instrumentsCreated: 0,
      transactionsAdded: 0,
      transactionsSkipped: 0,
      snapshotsAdded: 0,
      warnings: [...bundle.warnings]
    }

    const accountIds = new Map<string, number>()
    for (const a of bundle.accounts) {
      const { id, created } = findOrCreateAccount(tx as unknown as Db, personId, a)
      accountIds.set(a.key, id)
      if (created) result.accountsCreated++
    }

    const instrumentIds = new Map<string, number>()
    for (const i of bundle.instruments) {
      const { id, created } = findOrCreateInstrument(tx as unknown as Db, i)
      instrumentIds.set(i.key, id)
      if (created) result.instrumentsCreated++
    }

    const resolve = (accountKey: string, instrumentKey: string) => {
      const accountId = accountIds.get(accountKey)
      const instrumentId = instrumentIds.get(instrumentKey)
      if (accountId === undefined || instrumentId === undefined) {
        throw new Error(`Importer bug: unknown account/instrument key ${accountKey} / ${instrumentKey}`)
      }
      return { accountId, instrumentId }
    }

    for (const t of bundle.transactions) {
      const ids = resolve(t.accountKey, t.instrumentKey)
      const res = tx
        .insert(schema.transactions)
        .values({
          ...ids,
          date: t.date,
          type: t.type,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          fees: t.fees,
          currency: t.currency,
          description: t.description,
          source: t.source,
          externalId: t.externalId,
          importBatchId: batch.id
        })
        .onConflictDoNothing()
        .run()
      if (res.changes > 0) result.transactionsAdded++
      else result.transactionsSkipped++
    }

    for (const s of bundle.snapshots) {
      const ids = resolve(s.accountKey, s.instrumentKey)
      const res = tx
        .insert(schema.holdingSnapshots)
        .values({
          ...ids,
          date: s.date,
          quantity: s.quantity,
          price: s.price,
          value: s.value,
          cost: s.cost,
          source: s.source,
          importBatchId: batch.id
        })
        .onConflictDoNothing()
        .run()
      if (res.changes > 0) result.snapshotsAdded++
    }

    tx.update(schema.importBatches)
      .set({ summaryJson: JSON.stringify(result) })
      .where(eq(schema.importBatches.id, batch.id))
      .run()
    return result
  })
}

/**
 * Accounts from different sources must land on the same row: a Zerodha tradebook has no
 * DP/client id, the CAS does. A row without an external id adopts the person's only
 * account on that platform, and a CAS account with an id claims an id-less one.
 */
function findOrCreateAccount(db: Db, personId: number, a: NormAccount): { id: number; created: boolean } {
  const { accounts } = schema
  const base = and(eq(accounts.personId, personId), eq(accounts.platform, a.platform), eq(accounts.kind, a.kind))

  if (a.externalId) {
    const exact = db
      .select()
      .from(accounts)
      .where(and(base, eq(accounts.externalId, a.externalId)))
      .get()
    if (exact) return { id: exact.id, created: false }
    const idLess = db
      .select()
      .from(accounts)
      .where(and(base, isNull(accounts.externalId)))
      .get()
    if (idLess) {
      db.update(accounts).set({ externalId: a.externalId, name: a.name }).where(eq(accounts.id, idLess.id)).run()
      return { id: idLess.id, created: false }
    }
  } else {
    const any = db.select().from(accounts).where(base).all()
    if (any.length === 1) return { id: any[0].id, created: false }
    const idLess = any.find((x) => x.externalId === null)
    if (idLess) return { id: idLess.id, created: false }
  }

  const row = db
    .insert(accounts)
    .values({
      personId,
      platform: a.platform,
      kind: a.kind,
      name: a.name,
      externalId: a.externalId,
      currency: a.currency
    })
    .returning({ id: accounts.id })
    .get()
  return { id: row.id, created: true }
}

function findOrCreateInstrument(db: Db, i: NormInstrument): { id: number; created: boolean } {
  const { instruments } = schema
  let existing = i.isin ? db.select().from(instruments).where(eq(instruments.isin, i.isin)).get() : undefined
  if (!existing && i.symbolNse) {
    existing = db
      .select()
      .from(instruments)
      .where(and(eq(instruments.symbolNse, i.symbolNse), eq(instruments.assetClass, i.assetClass)))
      .get()
  }
  if (!existing && i.tickerUs) {
    existing = db.select().from(instruments).where(eq(instruments.tickerUs, i.tickerUs)).get()
  }
  if (!existing && !i.isin) {
    existing = db
      .select()
      .from(instruments)
      .where(and(sql`lower(${instruments.name}) = lower(${i.name})`, eq(instruments.assetClass, i.assetClass)))
      .get()
  }

  if (existing) {
    // Fill in whatever the earlier source did not know; a real name beats a bare ticker.
    const patch: Partial<typeof instruments.$inferInsert> = {}
    if (!existing.isin && i.isin) patch.isin = i.isin
    if (!existing.symbolNse && i.symbolNse) patch.symbolNse = i.symbolNse
    if (!existing.symbolBse && i.symbolBse) patch.symbolBse = i.symbolBse
    if (!existing.tickerUs && i.tickerUs) patch.tickerUs = i.tickerUs
    if (!existing.amfiCode && i.amfiCode) patch.amfiCode = i.amfiCode
    if (!existing.mfType && i.mfType) patch.mfType = i.mfType
    const nameIsTicker = [existing.symbolNse, existing.symbolBse, existing.tickerUs].includes(existing.name)
    if (nameIsTicker && i.name && i.name !== existing.name) patch.name = i.name
    if (Object.keys(patch).length > 0) db.update(instruments).set(patch).where(eq(instruments.id, existing.id)).run()
    return { id: existing.id, created: false }
  }

  const row = db
    .insert(instruments)
    .values({
      isin: i.isin,
      name: i.name,
      assetClass: i.assetClass,
      symbolNse: i.symbolNse ?? null,
      symbolBse: i.symbolBse ?? null,
      tickerUs: i.tickerUs ?? null,
      amfiCode: i.amfiCode ?? null,
      mfType: i.mfType ?? null,
      currency: i.currency
    })
    .returning({ id: instruments.id })
    .get()
  return { id: row.id, created: true }
}
