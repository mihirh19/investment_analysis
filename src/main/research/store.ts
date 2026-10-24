import { and, desc, eq, sql } from 'drizzle-orm'
import {
  arrange,
  computeMetrics,
  type Basis,
  type CompanyHeld,
  type CompanyHit,
  type CompanyView,
  type DayQuote,
  type Filing,
  type ResearchRow
} from '@shared/research'
import { schema, type Db } from '../db'
import { listHoldings } from '../portfolio/holdings'
import type { FilingRef } from './nse'

/** Results older than this aren't fetched: NSE's XBRL files start in late 2018. */
export const RESULTS_FROM = '2018-06-30'

/** Indian stocks the family holds, by NSE symbol. */
export function heldStocks(db: Db): Map<string, CompanyHeld> {
  const out = new Map<string, CompanyHeld>()
  const bySymbol = new Map(
    db
      .select({ isin: schema.nseListings.isin, symbol: schema.nseListings.symbol })
      .from(schema.nseListings)
      .all()
      .map((r) => [r.isin, r.symbol])
  )
  for (const h of listHoldings(db)) {
    if (h.assetClass !== 'EQUITY_IN' || h.quantity <= 0) continue
    const symbol = (h.isin && bySymbol.get(h.isin)) || h.symbol
    if (!symbol) continue
    const cur = out.get(symbol) ?? { quantity: 0, valueInr: 0, people: [] }
    cur.quantity += h.quantity
    cur.valueInr += h.marketValueInr ?? 0
    if (!cur.people.includes(h.personName)) cur.people.push(h.personName)
    out.set(symbol, cur)
  }
  return out
}

export function saveQuotes(db: Db, quotes: DayQuote[]): void {
  db.transaction((tx) => {
    for (const q of quotes) {
      const { symbol, ...rest } = q
      tx.insert(schema.researchQuotes)
        .values(q)
        .onConflictDoUpdate({ target: schema.researchQuotes.symbol, set: rest })
        .run()
    }
  })
}

export function latestQuoteDate(db: Db): string | null {
  return db.select({ d: sql<string | null>`max(${schema.researchQuotes.date})` }).from(schema.researchQuotes).get()?.d ?? null
}

/**
 * Records listed filings to fetch: one per period, consolidated where the company files group
 * figures, else standalone. A revision filed later replaces the stored one.
 */
export function saveRefs(db: Db, refs: FilingRef[]): number {
  const recent = refs.filter((r) => r.periodEnd >= RESULTS_FROM)
  const consolidated = new Set(recent.filter((r) => r.basis === 'C').map((r) => `${r.symbol}|${r.periodEnd}`))
  let added = 0
  db.transaction((tx) => {
    for (const r of recent) {
      if (r.basis === 'S' && consolidated.has(`${r.symbol}|${r.periodEnd}`)) continue
      const key = and(
        eq(schema.researchFilings.symbol, r.symbol),
        eq(schema.researchFilings.periodEnd, r.periodEnd),
        eq(schema.researchFilings.basis, r.basis)
      )
      const cur = tx.select().from(schema.researchFilings).where(key).get()
      if (cur && (cur.url === r.url || (cur.filedAt ?? '') >= (r.filedAt ?? ''))) continue
      if (cur) {
        tx.update(schema.researchFilings)
          .set({ url: r.url, filedAt: r.filedAt, status: 'PENDING', attempts: 0, dataJson: null })
          .where(key)
          .run()
      } else {
        tx.insert(schema.researchFilings)
          .values({ symbol: r.symbol, periodEnd: r.periodEnd, basis: r.basis, url: r.url, filedAt: r.filedAt })
          .run()
      }
      added++
    }
  })
  return added
}

export function pendingFilings(db: Db, symbol?: string, limit = 50) {
  return db
    .select()
    .from(schema.researchFilings)
    .where(
      and(
        eq(schema.researchFilings.status, 'PENDING'),
        symbol ? eq(schema.researchFilings.symbol, symbol) : undefined
      )
    )
    .orderBy(desc(schema.researchFilings.periodEnd))
    .limit(limit)
    .all()
}

type FilingKey = { symbol: string; periodEnd: string; basis: Basis }
const keyOf = (k: FilingKey) =>
  and(
    eq(schema.researchFilings.symbol, k.symbol),
    eq(schema.researchFilings.periodEnd, k.periodEnd),
    eq(schema.researchFilings.basis, k.basis)
  )

export function storeFiling(db: Db, k: FilingKey, filing: Filing | null, attempts: number): void {
  db.update(schema.researchFilings)
    .set(
      filing
        ? { status: 'DONE', dataJson: JSON.stringify(filing), attempts }
        : { status: attempts >= 3 ? 'FAILED' : 'PENDING', attempts }
    )
    .where(keyOf(k))
    .run()
}

export function markChecked(db: Db, symbol: string, error: string | null): void {
  const v = { symbol, checkedAt: new Date().toISOString(), error }
  db.insert(schema.researchCompanies)
    .values(v)
    .onConflictDoUpdate({ target: schema.researchCompanies.symbol, set: { checkedAt: v.checkedAt, error } })
    .run()
}

/** Every NSE-listed company (not ETFs). */
export function listedCompanies(db: Db) {
  return db
    .select({ symbol: schema.nseListings.symbol, name: schema.nseListings.name, isin: schema.nseListings.isin })
    .from(schema.nseListings)
    .where(eq(schema.nseListings.kind, 'EQ'))
    .all()
}

/**
 * Companies whose filings haven't been listed yet, in the order to fetch them: the family's own
 * stocks, then the Nifty 500, then everything else, larger companies first.
 */
export function companiesToCheck(db: Db, held: Set<string>): string[] {
  const done = new Set(
    db
      .select({ s: schema.researchCompanies.symbol })
      .from(schema.researchCompanies)
      .where(sql`${schema.researchCompanies.checkedAt} is not null`)
      .all()
      .map((r) => r.s)
  )
  const n500 = new Set(db.select({ s: schema.sectorMap.symbol }).from(schema.sectorMap).all().map((r) => r.s))
  const caps = new Map(
    db
      .select({ s: schema.researchQuotes.symbol, m: schema.researchQuotes.mcap })
      .from(schema.researchQuotes)
      .all()
      .map((r) => [r.s, r.m ?? 0])
  )
  const rank = (s: string) => (held.has(s) ? 0 : n500.has(s) ? 1 : 2)
  return listedCompanies(db)
    .map((c) => c.symbol)
    .filter((s) => !done.has(s))
    .sort((a, b) => rank(a) - rank(b) || (caps.get(b) ?? 0) - (caps.get(a) ?? 0) || a.localeCompare(b))
}

export function progress(db: Db) {
  const companies = listedCompanies(db).length
  const companiesDone =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.researchCompanies)
      .where(sql`${schema.researchCompanies.checkedAt} is not null`)
      .get()?.n ?? 0
  const counts = db
    .select({ status: schema.researchFilings.status, n: sql<number>`count(*)` })
    .from(schema.researchFilings)
    .groupBy(schema.researchFilings.status)
    .all()
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0
  return { companies, companiesDone, filings: n('DONE'), pending: n('PENDING') }
}

function filingsOf(db: Db, symbol: string): Filing[] {
  return db
    .select({ data: schema.researchFilings.dataJson })
    .from(schema.researchFilings)
    .where(and(eq(schema.researchFilings.symbol, symbol), eq(schema.researchFilings.status, 'DONE')))
    .all()
    .map((r) => JSON.parse(r.data!) as Filing)
}

function quoteOf(db: Db, symbol: string): DayQuote | null {
  return (db.select().from(schema.researchQuotes).where(eq(schema.researchQuotes.symbol, symbol)).get() as DayQuote) ?? null
}

function industryOf(db: Db, symbol: string, isin: string | null): string | null {
  const row = isin
    ? db.select().from(schema.sectorMap).where(eq(schema.sectorMap.isin, isin)).get()
    : db.select().from(schema.sectorMap).where(eq(schema.sectorMap.symbol, symbol)).get()
  return row?.industry ?? null
}

export function companyView(db: Db, symbol: string, basis: Basis | null = null, held = heldStocks(db)): CompanyView | null {
  const listing = db
    .select()
    .from(schema.nseListings)
    .where(and(eq(schema.nseListings.symbol, symbol), eq(schema.nseListings.kind, 'EQ')))
    .get()
  const quote = quoteOf(db, symbol)
  if (!listing && !quote) return null
  const filings = filingsOf(db, symbol)
  const a = arrange(filings, basis)
  const latest = filings.filter((f) => f.basis === a.basis).sort((x, y) => y.periodEnd.localeCompare(x.periodEnd))[0]
  const company = db.select().from(schema.researchCompanies).where(eq(schema.researchCompanies.symbol, symbol)).get()
  const pending = pendingFilings(db, symbol, 1).length > 0
  return {
    symbol,
    name: listing?.name ?? symbol,
    isin: listing?.isin ?? null,
    industry: industryOf(db, symbol, listing?.isin ?? null),
    bank: a.bank,
    quote,
    basis: a.basis,
    bases: a.bases,
    quarters: a.quarters.slice(0, 13),
    years: a.years.slice(0, 10),
    balances: a.balances.slice(0, 12),
    metrics: computeMetrics(a, quote, { capital: latest?.shareCapital ?? null, face: latest?.faceValue ?? null }),
    held: held.get(symbol) ?? null,
    results: {
      state: pending || !company?.checkedAt ? 'WAITING' : filings.length ? 'DONE' : 'NONE',
      stored: filings.length,
      checkedAt: company?.checkedAt ?? null,
      error: company?.error ?? null
    }
  }
}

export function researchRows(db: Db, symbols: string[], held = heldStocks(db)): ResearchRow[] {
  return symbols
    .map((s) => companyView(db, s, null, held))
    .filter((v): v is CompanyView => v !== null)
    .map((v) => ({
      symbol: v.symbol,
      name: v.name,
      industry: v.industry,
      close: v.quote?.close ?? null,
      change: v.quote?.prevClose ? v.quote.close / v.quote.prevClose - 1 : null,
      mcap: v.metrics.mcap,
      pe: v.metrics.pe,
      roe: v.metrics.roe,
      salesGrowthQ: v.metrics.salesGrowthQ,
      held: v.held
    }))
}

/** Companies whose symbol or name matches; symbols starting with the query first. */
export function searchCompanies(db: Db, query: string, held = heldStocks(db)): CompanyHit[] {
  const q = query.trim().toUpperCase()
  if (!q) return []
  const like = `%${q.replace(/[%_]/g, '')}%`
  const rows = db
    .select({ symbol: schema.nseListings.symbol, name: schema.nseListings.name })
    .from(schema.nseListings)
    .where(
      and(
        eq(schema.nseListings.kind, 'EQ'),
        sql`(upper(${schema.nseListings.symbol}) like ${like} or upper(${schema.nseListings.name}) like ${like})`
      )
    )
    .limit(200)
    .all()
  const score = (r: { symbol: string; name: string | null }) =>
    r.symbol === q ? 0 : r.symbol.startsWith(q) ? 1 : (r.name ?? '').toUpperCase().startsWith(q) ? 2 : 3
  return rows
    .sort((a, b) => score(a) - score(b) || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol))
    .slice(0, 12)
    .map((r) => ({ symbol: r.symbol, name: r.name ?? r.symbol, held: held.has(r.symbol) }))
}

