import { asc, eq, inArray } from 'drizzle-orm'
import type { DividendOutlook, DividendPayment } from '@shared/types'
import { schema, type Db } from '../db'
import { FxTable } from './fx'
import { listHoldings } from './holdings'

/** US withholding tax on dividends paid to Indian residents (DTAA rate). */
export const US_WITHHOLDING = 0.25

type Txn = typeof schema.transactions.$inferSelect
type Snap = { date: string; quantity: number }

/**
 * Units held at the close of the day before `exDate`. Trades are used when they cover the
 * position from its first purchase; otherwise statement snapshots (unknown before the first one).
 */
export function unitsHeldBefore(exDate: string, txns: Txn[], snaps: Snap[]): number | null {
  const unitTxns = txns.filter((t) => t.quantity !== 0)
  const tradesComplete = unitTxns.length > 0 && !hasUnmatchedSells(unitTxns)
  if (tradesComplete && (snaps.length === 0 || tradesAgreeWithSnapshots(unitTxns, snaps))) {
    return unitTxns.filter((t) => t.date < exDate).reduce((s, t) => s + t.quantity, 0)
  }
  const before = snaps.filter((s) => s.date < exDate)
  if (before.length === 0) return null
  const last = before[before.length - 1]
  // Trades after the statement still move the count.
  return (
    last.quantity + unitTxns.filter((t) => t.date > last.date && t.date < exDate).reduce((s, t) => s + t.quantity, 0)
  )
}

function hasUnmatchedSells(txns: Txn[]): boolean {
  let q = 0
  for (const t of txns) {
    q += t.quantity
    if (q < -1e-6) return true
  }
  return false
}

function tradesAgreeWithSnapshots(txns: Txn[], snaps: Snap[]): boolean {
  return snaps.every((s) => {
    const q = txns.filter((t) => t.date <= s.date).reduce((a, t) => a + t.quantity, 0)
    return Math.abs(q - s.quantity) < 1e-3
  })
}

export function listDividends(db: Db, personId?: number): { payments: DividendPayment[]; outlook: DividendOutlook[] } {
  const accounts = db
    .select()
    .from(schema.accounts)
    .where(personId ? eq(schema.accounts.personId, personId) : undefined)
    .all()
  if (accounts.length === 0) return { payments: [], outlook: [] }
  const accountIds = accounts.map((a) => a.id)
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p])
  )
  const instruments = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const fx = FxTable.load(db, 'USDINR')
  const today = new Date().toISOString().slice(0, 10)

  const txns = db
    .select()
    .from(schema.transactions)
    .where(inArray(schema.transactions.accountId, accountIds))
    .orderBy(asc(schema.transactions.date), asc(schema.transactions.id))
    .all()
  const snaps = db
    .select()
    .from(schema.holdingSnapshots)
    .where(inArray(schema.holdingSnapshots.accountId, accountIds))
    .orderBy(asc(schema.holdingSnapshots.date))
    .all()
  const published = new Map<number, { exDate: string; amount: number }[]>()
  for (const d of db.select().from(schema.dividends).orderBy(asc(schema.dividends.exDate)).all()) {
    if (!published.has(d.instrumentId)) published.set(d.instrumentId, [])
    published.get(d.instrumentId)!.push(d)
  }

  const pairs = new Map<string, { txns: Txn[]; snaps: Snap[] }>()
  const pair = (a: number, i: number) => {
    const k = `${a}:${i}`
    if (!pairs.has(k)) pairs.set(k, { txns: [], snaps: [] })
    return pairs.get(k)!
  }
  for (const t of txns) pair(t.accountId, t.instrumentId).txns.push(t)
  for (const s of snaps) pair(s.accountId, s.instrumentId).snaps.push(s)

  const payments: DividendPayment[] = []
  for (const [k, data] of pairs) {
    const [accountId, instrumentId] = k.split(':').map(Number)
    const account = accountById.get(accountId)!
    const instrument = instruments.get(instrumentId)!
    const person = persons.get(account.personId)!
    const isUs = instrument.currency === 'USD'
    const base = {
      personId: person.id,
      personName: person.name,
      accountName: account.name,
      instrumentId,
      instrumentName: instrument.name,
      symbol: instrument.symbolNse ?? instrument.tickerUs ?? instrument.symbolBse,
      currency: instrument.currency
    }

    const recorded = data.txns.filter((t) => t.type === 'DIVIDEND')
    if (recorded.length > 0) {
      // Amounts the investor entered or the statement printed are what was received.
      for (const t of recorded) {
        const net = Math.abs(t.amount) - t.fees
        const gross = isUs ? net / (1 - US_WITHHOLDING) : net
        payments.push({
          ...base,
          exDate: t.date,
          perShare: null,
          quantity: null,
          gross,
          withholding: gross - net,
          net,
          netInr: isUs ? net * (fx.on(t.date) ?? 0) : net,
          basis: 'RECORDED'
        })
      }
      continue
    }

    for (const d of published.get(instrumentId) ?? []) {
      if (d.exDate > today) continue
      const units = unitsHeldBefore(d.exDate, data.txns, data.snaps)
      if (!units || units < 1e-6) continue
      const gross = units * d.amount
      const withholding = isUs ? gross * US_WITHHOLDING : 0
      const net = gross - withholding
      payments.push({
        ...base,
        exDate: d.exDate,
        perShare: d.amount,
        quantity: units,
        gross,
        withholding,
        net,
        netInr: isUs ? net * (fx.on(d.exDate) ?? 0) : net,
        basis: 'ESTIMATED'
      })
    }
  }
  payments.sort((a, b) => b.exDate.localeCompare(a.exDate))

  // Next 12 months if the last 12 months' dividends repeat on today's units.
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const byInstrument = new Map<number, { qty: number; price: number | null }>()
  for (const h of listHoldings(db, personId)) {
    const cur = byInstrument.get(h.instrumentId)
    byInstrument.set(h.instrumentId, { qty: (cur?.qty ?? 0) + h.quantity, price: h.lastPrice })
  }
  const outlook: DividendOutlook[] = []
  for (const [instrumentId, { qty, price }] of byInstrument) {
    const trailing = (published.get(instrumentId) ?? [])
      .filter((d) => d.exDate > yearAgo && d.exDate <= today)
      .reduce((s, d) => s + d.amount, 0)
    if (trailing <= 0) continue
    const i = instruments.get(instrumentId)!
    const isUs = i.currency === 'USD'
    outlook.push({
      instrumentId,
      instrumentName: i.name,
      symbol: i.symbolNse ?? i.tickerUs ?? i.symbolBse,
      currency: i.currency,
      trailingPerShare: trailing,
      quantity: qty,
      nextYearInr: trailing * qty * (isUs ? (1 - US_WITHHOLDING) * (fx.latest() ?? 0) : 1),
      yieldOnPrice: price ? trailing / price : null
    })
  }
  outlook.sort((a, b) => b.nextYearInr - a.nextYearInr)
  return { payments, outlook }
}
