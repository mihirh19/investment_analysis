import { asc, eq, sql } from 'drizzle-orm'
import type { CostSource, HoldingRow, PriceSource } from '@shared/types'
import { schema, type Db } from '../db'
import { computeFifo } from './fifo'
import { estimateEpfBalance, parseEpfMeta } from './epf'
import { FxTable } from './fx'
import { farmHoldings } from '../farm'
import { manualHoldings } from '../manualAssets'

const EPS = 1e-3

// Many screens ask for the holdings after each price update, and working them out reads every
// transaction and statement. The answer is kept until anything is written to the database (SQLite
// counts every change on this connection) and for half a minute at most, as some values follow the date.
const kept = new WeakMap<Db, Map<string, { changes: number; at: number; rows: HoldingRow[] }>>()

export function listHoldings(db: Db, personId?: number): HoldingRow[] {
  const changes = db.get<{ n: number }>(sql`SELECT total_changes() AS n`).n
  const memo = kept.get(db) ?? new Map()
  kept.set(db, memo)
  const key = String(personId ?? '')
  const hit = memo.get(key)
  if (!hit || hit.changes !== changes || Date.now() - hit.at > 30_000)
    memo.set(key, { changes, at: Date.now(), rows: workOutHoldings(db, personId) })
  // Each caller gets its own copy, free to change.
  return structuredClone(memo.get(key)!.rows)
}

function workOutHoldings(db: Db, personId?: number): HoldingRow[] {
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p])
  )
  const accounts = new Map(
    db
      .select()
      .from(schema.accounts)
      .where(personId ? eq(schema.accounts.personId, personId) : undefined)
      .all()
      .map((a) => [a.id, a])
  )
  const instruments = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const quotes = new Map(
    db
      .select()
      .from(schema.quotes)
      .all()
      .map((q) => [q.instrumentId, q])
  )
  const fx = FxTable.load(db, 'USDINR')

  const txnsByKey = new Map<string, (typeof schema.transactions.$inferSelect)[]>()
  for (const t of db
    .select()
    .from(schema.transactions)
    .orderBy(asc(schema.transactions.date), asc(schema.transactions.id))
    .all()) {
    if (!accounts.has(t.accountId)) continue
    const k = `${t.accountId}:${t.instrumentId}`
    if (!txnsByKey.has(k)) txnsByKey.set(k, [])
    txnsByKey.get(k)!.push(t)
  }

  // Latest statement snapshot per account + instrument.
  const latest = db.all<
    typeof schema.holdingSnapshots.$inferSelect & { account_id: number; instrument_id: number }
  >(sql`
    SELECT s.* FROM holding_snapshots s
    JOIN (SELECT account_id, instrument_id, MAX(date) AS d FROM holding_snapshots GROUP BY account_id, instrument_id) m
      ON m.account_id = s.account_id AND m.instrument_id = s.instrument_id AND m.d = s.date
  `)
  const snapByKey = new Map<
    string,
    { date: string; quantity: number; price: number | null; value: number | null; cost: number | null; source: string }
  >()
  for (const s of latest) {
    if (!accounts.has(s.account_id)) continue
    // Prefer a row that carries a cost when two sources printed the same date.
    const k = `${s.account_id}:${s.instrument_id}`
    const prev = snapByKey.get(k)
    if (!prev || (prev.cost === null && s.cost !== null)) {
      snapByKey.set(k, {
        date: s.date,
        quantity: s.quantity,
        price: s.price,
        value: s.value,
        cost: s.cost,
        source: s.source
      })
    }
  }

  // Buy prices from broker files or typed in (statements from the depositories have none).
  const basis = new Map<string, { avg: number; source: 'BROKER' | 'MANUAL'; asOf: string; heldSince: string | null }>()
  for (const b of db.select().from(schema.costBasis).all()) {
    const k = `${b.source}:${b.accountId ? `a${b.accountId}` : `p${b.personId}`}:${b.instrumentId}`
    const prev = basis.get(k)
    if (!prev || b.asOf > prev.asOf)
      basis.set(k, { avg: b.avgCost, source: b.source, asOf: b.asOf, heldSince: b.heldSince })
  }
  // The newest statement that did print a cost, per account + instrument.
  const earlier = new Map<string, number>()
  for (const s of db.all<{ account_id: number; instrument_id: number; quantity: number; cost: number }>(sql`
    SELECT account_id, instrument_id, quantity, cost FROM holding_snapshots
    WHERE cost IS NOT NULL AND quantity > 0 ORDER BY date DESC
  `)) {
    const k = `${s.account_id}:${s.instrument_id}`
    if (!earlier.has(k)) earlier.set(k, s.cost / s.quantity)
  }
  const costFor = (
    personId: number,
    accountId: number,
    instrumentId: number,
    snap: { quantity: number; cost: number | null } | undefined
  ): { avg: number; source: CostSource; heldSince?: string | null } | null => {
    const typed = basis.get(`MANUAL:a${accountId}:${instrumentId}`) ?? basis.get(`MANUAL:p${personId}:${instrumentId}`)
    if (typed) return { avg: typed.avg, source: 'MANUAL', heldSince: typed.heldSince }
    if (snap?.cost != null && snap.quantity > EPS) return { avg: snap.cost / snap.quantity, source: 'STATEMENT' }
    const broker = basis.get(`BROKER:a${accountId}:${instrumentId}`) ?? basis.get(`BROKER:p${personId}:${instrumentId}`)
    if (broker) return { avg: broker.avg, source: 'BROKER', heldSince: broker.heldSince }
    const old = earlier.get(`${accountId}:${instrumentId}`)
    return old !== undefined ? { avg: old, source: 'EARLIER' } : null
  }

  const rows: HoldingRow[] = []
  for (const k of new Set([...txnsByKey.keys(), ...snapByKey.keys()])) {
    const [accountId, instrumentId] = k.split(':').map(Number)
    const account = accounts.get(accountId)!
    // Hand-maintained assets are valued by their own engines (manualHoldings below).
    if (account.kind === 'MANUAL_ASSET') continue
    const instrument = instruments.get(instrumentId)!
    const person = persons.get(account.personId)!
    const txns = txnsByKey.get(k) ?? []
    const snap = snapByKey.get(k)
    const fifo = computeFifo(txns)

    let quantity = fifo.quantity
    let avgCost = fifo.avgCost
    let invested: number | null = fifo.invested
    let costFromLots = true
    let costSource: CostSource | null = fifo.invested !== null && txns.length > 0 ? 'TRADES' : null
    let heldSince: string | null = null
    let tradesQuantity: number | null = null

    if (snap) {
      const atSnap = txns.filter((t) => t.date <= snap.date).reduce((s, t) => s + t.quantity, 0)
      const after = txns.filter((t) => t.date > snap.date).reduce((s, t) => s + t.quantity, 0)
      quantity = snap.quantity + after
      const consistent = txns.length > 0 && Math.abs(atSnap - snap.quantity) < EPS && fifo.unmatchedSellQuantity < EPS
      if (txns.length > 0 && !consistent) tradesQuantity = atSnap
      if (!consistent) {
        const c = costFor(account.personId, accountId, instrumentId, snap)
        avgCost = c?.avg ?? null
        invested = avgCost !== null ? avgCost * quantity : null
        costSource = c?.source ?? null
        heldSince = c?.heldSince ?? null
        costFromLots = false
      }
    }
    if (quantity < EPS) continue

    // Price: a live quote or NAV beats the statement unless the statement is newer.
    let lastPrice: number | null = null
    let priceDate: string | null = null
    let prevClose: number | null = null
    let priceSource: PriceSource = 'STATEMENT'
    const quote = quotes.get(instrumentId)
    const quoteDate = quote?.asOf.slice(0, 10) ?? null

    if (quote && (!snap || quoteDate! >= snap.date)) {
      lastPrice = quote.price
      priceDate = quoteDate
      prevClose = quote.prevClose
      priceSource = quote.source === 'YAHOO' ? 'LIVE' : 'NAV'
    } else if (account.kind === 'EPF' && snap?.price != null) {
      const meta = parseEpfMeta(account.metaJson)
      lastPrice = estimateEpfBalance(snap.price, snap.date, new Date().toISOString().slice(0, 10), meta)
      priceDate = snap.date
      priceSource = 'ESTIMATE'
    } else if (snap?.price != null) {
      lastPrice = snap.price
      priceDate = snap.date
      priceSource = snap.source === 'MANUAL' ? 'MANUAL' : 'STATEMENT'
    } else {
      const lastPriced = [...txns].reverse().find((t) => t.price !== null && t.quantity !== 0)
      if (lastPriced) {
        lastPrice = lastPriced.price
        priceDate = lastPriced.date
        priceSource = 'TRADE'
      }
    }

    const marketValue =
      lastPrice !== null
        ? quantity * lastPrice
        : snap?.value != null && Math.abs(quantity - snap.quantity) < EPS
          ? snap.value
          : null
    const dayChange = prevClose !== null && lastPrice !== null ? quantity * (lastPrice - prevClose) : null

    // INR view. US cost uses the exchange rate on each purchase date, so the gain includes currency moves.
    const isUsd = instrument.currency === 'USD'
    const fxRate = isUsd ? (fx.latest() ?? 0) : 1
    let investedInr: number | null = invested
    if (isUsd) {
      investedInr =
        invested === null
          ? null
          : costFromLots
            ? fifo.openLots.reduce((s, l) => s + l.quantity * l.costPerUnit * (fx.on(l.date) ?? fxRate), 0)
            : invested * (fx.on(snap!.date) ?? fxRate)
    }
    const marketValueInr = marketValue !== null && fxRate ? marketValue * fxRate : null

    rows.push({
      personId: person.id,
      personName: person.name,
      accountId,
      accountName: account.name,
      platform: account.platform,
      instrumentId,
      instrumentName: instrument.name,
      isin: instrument.isin,
      symbol: instrument.symbolNse ?? instrument.tickerUs ?? instrument.symbolBse ?? instrument.amfiCode,
      assetClass: instrument.assetClass,
      currency: instrument.currency,
      quantity,
      avgCost,
      invested,
      lastPrice,
      priceDate,
      marketValue,
      unrealizedPnl: marketValue !== null && invested !== null ? marketValue - invested : null,
      realizedPnl: fifo.realizedPnl,
      dividends: fifo.dividends,
      tradesQuantity,
      prevClose,
      dayChange,
      priceSource,
      sector: instrument.sector,
      fxRate,
      marketValueInr,
      investedInr,
      unrealizedPnlInr: marketValueInr !== null && investedInr !== null ? marketValueInr - investedInr : null,
      dayChangeInr: dayChange !== null && fxRate ? dayChange * fxRate : null,
      costSource: invested !== null ? costSource : null,
      heldSince
    })
  }

  return [...dropDematFolioDuplicates(rows, accounts), ...manualHoldings(db, personId), ...farmHoldings(db, personId)]
}

/**
 * MF units bought through a demat app (e.g. Zerodha Coin) can appear both under the demat
 * account and as an RTA folio. When one person holds the same fund in a DEMAT and an MF_FOLIO
 * account with the same units, keep only the demat row.
 */
function dropDematFolioDuplicates(rows: HoldingRow[], accounts: Map<number, { kind: string }>): HoldingRow[] {
  const dematQty = new Map<string, number[]>()
  for (const r of rows) {
    if (r.assetClass === 'MF' && accounts.get(r.accountId)?.kind === 'DEMAT') {
      const k = `${r.personId}:${r.instrumentId}`
      dematQty.set(k, [...(dematQty.get(k) ?? []), r.quantity])
    }
  }
  return rows.filter((r) => {
    if (r.assetClass !== 'MF' || accounts.get(r.accountId)?.kind !== 'MF_FOLIO') return true
    const qs = dematQty.get(`${r.personId}:${r.instrumentId}`)
    return !qs?.some((q) => Math.abs(q - r.quantity) < EPS)
  })
}
