import type Database from 'better-sqlite3'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  arrange,
  computeMetrics,
  type Basis,
  type CompanyHeld,
  type CompanyHit,
  type CompanyView,
  type DayQuote,
  type Filing,
  type ResearchRow,
  type CalendarReport,
  type OwnershipReport,
  type OwnershipView,
  type ShpQuarter,
  type StakeChange,
  type Announcement,
  type AnnouncementsReport,
  type AnnTag,
  MARKET_TAGS,
  tagAnnouncement
} from '@shared/research'
import {
  fundamentalsOf,
  NO_FUNDAMENTALS,
  screenRow,
  type Fundamentals,
  type IndexLevel,
  type MarketMonitor,
  type ScreenData,
  type ScreenRow
} from '@shared/screener'
import { adjustBars, rankStrength, technicalsOf, type Bar, type Technicals } from '@shared/technicals'
import { schema, type Db } from '../db'
import { listHoldings } from '../portfolio/holdings'
import type { FilingRef, parseAnnouncements, parseCorporateActions, parseEventCalendar, parseShpList, parseShpXbrl, parseSymbolData } from './nse'
import type { IndustryMap } from '@shared/sectors'

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

// What the screener and the monitor are built from changes only when the download stores something,
// so their results are kept until then (rebuilding them reads every company: half a second or more).
const versions = new WeakMap<Db, number>()
const memos = new WeakMap<Db, Map<string, { version: number; at: number; value: unknown }>>()
/** Marks this database's research as changed, so the screener and the monitor are worked out again. */
export const touchResearch = (db: Db) => {
  versions.set(db, (versions.get(db) ?? 0) + 1)
}
function remember<T>(db: Db, key: string, build: () => T): T {
  const version = versions.get(db) ?? 0
  const memo = memos.get(db) ?? new Map()
  memos.set(db, memo)
  const hit = memo.get(key)
  if (hit && hit.version === version && Date.now() - hit.at < 10 * 60_000) return hit.value as T
  const value = build()
  memo.set(key, { version, at: Date.now(), value })
  return value
}
const heldKey = (held: Map<string, CompanyHeld>) => [...held].map(([s, h]) => `${s}:${h.quantity}`).join(',')

export function saveQuotes(db: Db, quotes: DayQuote[]): void {
  touchResearch(db)
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
  return row?.industry ?? db.select({ s: schema.researchIndustry.sector }).from(schema.researchIndustry).where(eq(schema.researchIndustry.symbol, symbol)).get()?.s ?? null
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

// ---------------- screener and market monitor ----------------

/**
 * Works out the screener figures again for companies whose stored filings changed (all of them, or
 * the ones named). Cheap when nothing changed: it compares filing counts.
 */
export function refreshFundamentals(db: Db, symbols?: string[]): number {
  const counts = db
    .select({ symbol: schema.researchFilings.symbol, n: sql<number>`count(*)` })
    .from(schema.researchFilings)
    .where(eq(schema.researchFilings.status, 'DONE'))
    .groupBy(schema.researchFilings.symbol)
    .all()
  const have = new Map(
    db
      .select({ symbol: schema.researchFundamentals.symbol, n: schema.researchFundamentals.filings })
      .from(schema.researchFundamentals)
      .all()
      .map((r) => [r.symbol, r.n])
  )
  const wanted = symbols ? new Set(symbols) : null
  const stale = counts.filter((c) => (!wanted || wanted.has(c.symbol)) && have.get(c.symbol) !== c.n)
  if (stale.length) touchResearch(db)
  for (const c of stale) {
    const f = fundamentalsOf(filingsOf(db, c.symbol))
    const v = { symbol: c.symbol, filings: c.n, dataJson: JSON.stringify(f) }
    db.insert(schema.researchFundamentals)
      .values(v)
      .onConflictDoUpdate({ target: schema.researchFundamentals.symbol, set: { filings: v.filings, dataJson: v.dataJson } })
      .run()
  }
  return stale.length
}

export function saveIndices(db: Db, levels: IndexLevel[]): void {
  touchResearch(db)
  db.transaction((tx) => {
    for (const l of levels) {
      const { name, ...rest } = l
      tx.insert(schema.researchIndices).values(l).onConflictDoUpdate({ target: schema.researchIndices.name, set: rest }).run()
    }
  })
}

/** Every listed company with a price or results, as screener rows. */
export function screenData(db: Db, held = heldStocks(db)): ScreenData {
  return remember(db, `screen|${heldKey(held)}`, () => buildScreenData(db, held))
}

// Fundamentals are worked out by the download as it stores each company's results, not here.
function buildScreenData(db: Db, held: Map<string, CompanyHeld>): ScreenData {
  const funds = new Map(
    db
      .select()
      .from(schema.researchFundamentals)
      .all()
      .map((r) => [r.symbol, JSON.parse(r.dataJson) as Fundamentals])
  )
  const quotes = new Map(db.select().from(schema.researchQuotes).all().map((q) => [q.symbol, q as DayQuote]))
  const techs = new Map(
    db
      .select()
      .from(schema.researchTechnicals)
      .all()
      .map((t) => [t.symbol, JSON.parse(t.dataJson) as Technicals])
  )
  // NSE's index lists first (the Nifty 500); every other company from its own classification.
  const industries = new Map<string | null, string | null>(
    db.select({ s: schema.researchIndustry.symbol, i: schema.researchIndustry.sector }).from(schema.researchIndustry).all().map((r) => [r.s, r.i])
  )
  for (const r of db.select({ s: schema.sectorMap.symbol, i: schema.sectorMap.industry }).from(schema.sectorMap).all()) industries.set(r.s, r.i)
  const companies = listedCompanies(db)
  const rows: ScreenRow[] = []
  for (const c of companies) {
    const f = funds.get(c.symbol)
    const q = quotes.get(c.symbol) ?? null
    if (!f && !q && !techs.has(c.symbol)) continue
    rows.push(
      screenRow(
        { symbol: c.symbol, name: c.name ?? c.symbol, industry: industries.get(c.symbol) ?? null, held: held.has(c.symbol) },
        f ?? NO_FUNDAMENTALS,
        q,
        techs.get(c.symbol) ?? null
      )
    )
  }
  return { rows, companies: companies.length, withResults: funds.size, pricesDate: latestQuoteDate(db) }
}

/** The indices worth a glance, in this order (NSE's own spellings). */
const KEY_INDICES = [
  'Nifty 50', 'Nifty Next 50', 'Nifty Bank', 'NIFTY MIDCAP 100', 'NIFTY SMLCAP 100', 'Nifty 500', 'India VIX',
  'Nifty IT', 'Nifty Fin Service', 'Nifty Pharma', 'NIFTY HEALTHCARE', 'Nifty FMCG', 'Nifty Auto', 'Nifty Metal',
  'Nifty Energy', 'NIFTY OIL AND GAS', 'Nifty Realty', 'Nifty Infra', 'Nifty PSU Bank', 'Nifty Media',
  'NIFTY CONSR DURBL', 'Nifty Ind Defence', 'Nifty Capital Mkt', 'Nifty GS 10Yr'
]

export function marketMonitor(db: Db): MarketMonitor {
  const held = heldStocks(db)
  return remember(db, `monitor|${heldKey(held)}`, () => buildMonitor(db, held))
}

function buildMonitor(db: Db, held: Map<string, CompanyHeld>): MarketMonitor {
  const { rows, pricesDate } = screenData(db, held)
  const byName = new Map(db.select().from(schema.researchIndices).all().map((i) => [i.name, i as IndexLevel]))
  const indices = KEY_INDICES.map((n) => byName.get(n)).filter((i): i is IndexLevel => !!i)
  const today = rows.filter((r) => r.change !== null)
  const breadth = { up: 0, down: 0, flat: 0, atHigh: 0, atLow: 0 }
  for (const r of today) {
    if (r.change! > 0.0005) breadth.up++
    else if (r.change! < -0.0005) breadth.down++
    else breadth.flat++
  }
  const quotes = db.select().from(schema.researchQuotes).all()
  for (const q of quotes) {
    if (q.high52 && q.close >= q.high52) breadth.atHigh++
    if (q.low52 && q.close <= q.low52) breadth.atLow++
  }
  // Movers among companies of a meaningful size (₹1,000 crore and up).
  const sized = today.filter((r) => (r.mcap ?? 0) >= 1e10)
  const byChange = [...sized].sort((a, b) => b.change! - a.change!)
  const sectors = new Map<string, { mcap: number; moved: number; weight: number; count: number }>()
  for (const r of today) {
    if (!r.industry || !r.mcap) continue
    const s = sectors.get(r.industry) ?? { mcap: 0, moved: 0, weight: 0, count: 0 }
    s.mcap += r.mcap
    s.moved += r.mcap * r.change!
    s.weight += r.mcap
    s.count++
    sectors.set(r.industry, s)
  }
  return {
    date: pricesDate,
    indices,
    breadth,
    gainers: byChange.slice(0, 10),
    losers: byChange.slice(-10).reverse(),
    sectors: [...sectors.entries()]
      .map(([name, s]) => ({ name, mcap: s.mcap, change: s.weight ? s.moved / s.weight : null, count: s.count }))
      .sort((a, b) => b.mcap - a.mcap),
    yours: rows.filter((r) => r.held).sort((a, b) => (held.get(b.symbol)?.valueInr ?? 0) - (held.get(a.symbol)?.valueInr ?? 0))
  }
}

// ---------------- daily prices and technicals ----------------

/** How many years of daily prices are kept (enough for 52-week figures and 200-day averages). */
export const BAR_YEARS = 2

export function saveBars(db: Db, date: string, bars: (Bar & { symbol: string })[]): void {
  db.transaction((tx) => {
    for (const b of bars) {
      tx.insert(schema.researchBars).values(b).onConflictDoNothing().run()
    }
    tx.insert(schema.researchBarDays)
      .values({ date, status: bars.length ? 'DONE' : 'NONE', rows: bars.length })
      .onConflictDoUpdate({ target: schema.researchBarDays.date, set: { status: bars.length ? 'DONE' : 'NONE', rows: bars.length } })
      .run()
  })
}

/** A day with no file (a holiday, or not published): remembered so it isn't asked for again. */
export function markNoBars(db: Db, date: string): void {
  db.insert(schema.researchBarDays).values({ date, status: 'NONE', rows: 0 }).onConflictDoNothing().run()
}

export function barDaysSeen(db: Db): Set<string> {
  return new Set(db.select({ d: schema.researchBarDays.date }).from(schema.researchBarDays).all().map((r) => r.d))
}

export function barProgress(db: Db) {
  const r = db
    .select({ days: sql<number>`count(*)`, first: sql<string | null>`min(${schema.researchBarDays.date})`, last: sql<string | null>`max(${schema.researchBarDays.date})` })
    .from(schema.researchBarDays)
    .where(eq(schema.researchBarDays.status, 'DONE'))
    .get()
  return { days: r?.days ?? 0, first: r?.first ?? null, last: r?.last ?? null }
}

/** Drops prices older than the years kept. */
export function pruneBars(db: Db, before: string): void {
  db.delete(schema.researchBars).where(sql`${schema.researchBars.date} < ${before}`).run()
  db.delete(schema.researchBarDays).where(sql`${schema.researchBarDays.date} < ${before}`).run()
}

/** One stock's stored bars, oldest first, adjusted for splits and bonuses. */
export function barsOf(db: Db, symbol: string): Bar[] {
  const rows = db
    .select()
    .from(schema.researchBars)
    .where(eq(schema.researchBars.symbol, symbol))
    .orderBy(schema.researchBars.date)
    .all()
  return adjustBars(rows)
}

/** Works out every stock's technicals from the stored bars (a few seconds for the whole market). */
export function refreshTechnicals(db: Db): number {
  touchResearch(db)
  // Straight from SQLite as arrays: a million rows as objects would be slow.
  const sqlite = (db as unknown as { $client: Database.Database }).$client
  const stmt = sqlite
    .prepare('SELECT symbol, date, open, high, low, close, prev_close, volume, deliv_pct FROM research_bars ORDER BY symbol, date')
    .raw()
  const all = new Map<string, Technicals>()
  let symbol: string | null = null
  let bars: Bar[] = []
  const flush = () => {
    if (symbol && bars.length) {
      const t = technicalsOf(adjustBars(bars))
      if (t) all.set(symbol, t)
    }
  }
  for (const r of stmt.iterate() as Iterable<[string, string, number | null, number | null, number | null, number, number | null, number | null, number | null]>) {
    if (r[0] !== symbol) {
      flush()
      symbol = r[0]
      bars = []
    }
    bars.push({ date: r[1], open: r[2], high: r[3], low: r[4], close: r[5], prevClose: r[6], volume: r[7], delivPct: r[8] })
  }
  flush()
  rankStrength(all)
  db.transaction((tx) => {
    tx.delete(schema.researchTechnicals).run()
    for (const [s, t] of all) tx.insert(schema.researchTechnicals).values({ symbol: s, date: t.date, dataJson: JSON.stringify(t) }).run()
  })
  return all.size
}

// ---------------- calendar: results days and corporate actions ----------------

export function saveEvents(db: Db, rows: ReturnType<typeof parseEventCalendar>): void {
  db.transaction((tx) => {
    for (const r of rows) {
      const rest = { company: r.company, details: r.details }
      tx.insert(schema.researchEvents).values(r).onConflictDoUpdate({ target: [schema.researchEvents.symbol, schema.researchEvents.date, schema.researchEvents.purpose], set: rest }).run()
    }
  })
}

export function saveActions(db: Db, rows: ReturnType<typeof parseCorporateActions>): void {
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(schema.researchActions)
        .values(r)
        .onConflictDoUpdate({ target: [schema.researchActions.symbol, schema.researchActions.exDate, schema.researchActions.subject], set: { recordDate: r.recordDate, kind: r.kind, amount: r.amount } })
        .run()
    }
  })
}

export function calendarReport(db: Db, today = new Date().toISOString().slice(0, 10)): CalendarReport {
  const held = heldStocks(db)
  const watched = watchedSymbols(db)
  const shift = (days: number) => new Date(Date.parse(today) + days * 86400_000).toISOString().slice(0, 10)
  const names = new Map(listedCompanies(db).map((c) => [c.symbol, c.name ?? c.symbol]))
  const results = db
    .select()
    .from(schema.researchEvents)
    .where(and(sql`${schema.researchEvents.date} >= ${shift(-7)}`, sql`${schema.researchEvents.date} <= ${shift(45)}`))
    .orderBy(schema.researchEvents.date)
    .all()
    .map((r) => ({ ...r, held: held.get(r.symbol) ?? null, watched: watched.has(r.symbol) }))
  const actions = db
    .select()
    .from(schema.researchActions)
    .where(and(sql`${schema.researchActions.exDate} >= ${shift(-30)}`, sql`${schema.researchActions.exDate} <= ${shift(90)}`))
    .orderBy(schema.researchActions.exDate)
    .all()
    .map((r) => {
      const h = held.get(r.symbol) ?? null
      return {
        ...r,
        company: names.get(r.symbol) ?? r.symbol,
        held: h,
        watched: watched.has(r.symbol),
        expectedInr: h && r.kind === 'DIVIDEND' && r.amount ? h.quantity * r.amount : null
      }
    })
  const updatedAt = db.select().from(schema.settings).where(eq(schema.settings.key, 'research:calendarAt')).get()?.value ?? null
  return { results, actions, updatedAt }
}

/** Every symbol on any watchlist. */
export function watchedSymbols(db: Db): Set<string> {
  return new Set(
    db
      .select({ s: schema.watchlists.symbolsJson })
      .from(schema.watchlists)
      .all()
      .flatMap((w) => JSON.parse(w.s) as string[])
  )
}

// ---------------- ownership ----------------

const QUARTER_END = /-(03-31|06-30|09-30|12-31)$/

export function saveShpList(db: Db, rows: ReturnType<typeof parseShpList>): void {
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(schema.researchShp)
        .values(r)
        .onConflictDoUpdate({ target: [schema.researchShp.symbol, schema.researchShp.asOf], set: { promoter: r.promoter, url: r.url, filedAt: r.filedAt } })
        .run()
    }
  })
}

export function markShpChecked(db: Db, symbol: string): void {
  const at = new Date().toISOString()
  db.insert(schema.researchShpChecked).values({ symbol, at }).onConflictDoUpdate({ target: schema.researchShpChecked.symbol, set: { at } }).run()
}

/** Companies whose full shareholding history hasn't been asked for in the last week. */
export function shpStale(db: Db, symbols: Iterable<string>, now = Date.now()): string[] {
  const at = new Map(db.select().from(schema.researchShpChecked).all().map((r) => [r.symbol, Date.parse(r.at)]))
  return [...symbols].filter((s) => !(now - (at.get(s) ?? 0) < 7 * 86400_000))
}

/** Each company's latest quarters whose full pattern hasn't been read yet. */
export function shpDetailWanted(db: Db, symbols: Iterable<string>, quarters = 5): { symbol: string; asOf: string; url: string; attempts: number }[] {
  const out = []
  for (const symbol of symbols) {
    const rows = db.select().from(schema.researchShp).where(eq(schema.researchShp.symbol, symbol)).orderBy(desc(schema.researchShp.asOf)).all()
    for (const r of rows.filter((r) => QUARTER_END.test(r.asOf)).slice(0, quarters))
      if (r.url && !r.detailJson && r.attempts < 3) out.push({ symbol, asOf: r.asOf, url: r.url, attempts: r.attempts })
  }
  return out
}

export function saveShpDetail(db: Db, symbol: string, asOf: string, detail: ReturnType<typeof parseShpXbrl>, attempts: number): void {
  db.update(schema.researchShp)
    .set({ detailJson: detail ? JSON.stringify({ groups: detail.groups, shareholders: detail.shareholders, holders: detail.holders }) : null, attempts, ...(detail ? { promoter: detail.groups.promoter } : {}) })
    .where(and(eq(schema.researchShp.symbol, symbol), eq(schema.researchShp.asOf, asOf)))
    .run()
}

const toQuarter = (r: typeof schema.researchShp.$inferSelect): ShpQuarter => {
  const d = r.detailJson ? (JSON.parse(r.detailJson) as Pick<ShpQuarter, 'groups' | 'shareholders' | 'holders'>) : null
  return { asOf: r.asOf, promoter: r.promoter, groups: d?.groups ?? null, shareholders: d?.shareholders ?? null, holders: d?.holders ?? null, filedAt: r.filedAt }
}

export function ownershipView(db: Db, symbol: string): OwnershipView {
  const s = symbol.toUpperCase()
  const quarters = db
    .select()
    .from(schema.researchShp)
    .where(eq(schema.researchShp.symbol, s))
    .orderBy(desc(schema.researchShp.asOf))
    .all()
    .filter((r) => QUARTER_END.test(r.asOf))
    .map(toQuarter)
  return { symbol: s, quarters, waiting: shpStale(db, [s]).length > 0 || shpDetailWanted(db, [s]).length > 0 }
}

/** The latest quarter against the one before, for one company's rows (newest first). */
function stakeChange(symbol: string, company: string, rows: ShpQuarter[]): Omit<StakeChange, 'held' | 'watched'> | null {
  const [a, b] = rows
  if (!a || !b) return null
  const diff = (x: number | null | undefined, y: number | null | undefined) => (x === null || x === undefined || y === null || y === undefined ? null : x - y)
  return {
    symbol,
    company,
    asOf: a.asOf,
    prevAsOf: b.asOf,
    promoter: a.promoter,
    promoterChange: diff(a.promoter, b.promoter),
    fpi: a.groups?.fpi ?? null,
    fpiChange: diff(a.groups?.fpi, b.groups?.fpi),
    mf: a.groups?.mf ?? null,
    mfChange: diff(a.groups?.mf, b.groups?.mf)
  }
}

export function ownershipReport(db: Db, today = new Date().toISOString().slice(0, 10)): OwnershipReport {
  const held = heldStocks(db)
  const watched = watchedSymbols(db)
  const names = new Map(listedCompanies(db).map((c) => [c.symbol, c.name ?? c.symbol]))
  const since = new Date(Date.parse(today) - 400 * 86400_000).toISOString().slice(0, 10)
  const bySymbol = new Map<string, ShpQuarter[]>()
  for (const r of db.select().from(schema.researchShp).where(sql`${schema.researchShp.asOf} >= ${since}`).orderBy(desc(schema.researchShp.asOf)).all()) {
    if (!QUARTER_END.test(r.asOf)) continue
    const list = bySymbol.get(r.symbol) ?? []
    list.push(toQuarter(r))
    bySymbol.set(r.symbol, list)
  }
  const tag = (c: Omit<StakeChange, 'held' | 'watched'>): StakeChange => ({ ...c, held: held.get(c.symbol) ?? null, watched: watched.has(c.symbol) })
  const mine = [...new Set([...held.keys(), ...watched])]
    .map((s) => stakeChange(s, names.get(s) ?? s, bySymbol.get(s) ?? []))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map(tag)
    .sort((a, b) => Math.abs(b.fpiChange ?? b.promoterChange ?? 0) - Math.abs(a.fpiChange ?? a.promoterChange ?? 0))
  const recent = new Date(Date.parse(today) - 60 * 86400_000).toISOString().slice(0, 10)
  const promoterMoves = [...bySymbol]
    .filter(([, rows]) => (rows[0].filedAt ?? rows[0].asOf) >= recent)
    .map(([s, rows]) => stakeChange(s, names.get(s) ?? s, rows))
    .filter(
      (c): c is NonNullable<typeof c> =>
        c !== null && c.promoterChange !== null && Math.abs(c.promoterChange) >= 0.005 && Date.parse(c.asOf) - Date.parse(c.prevAsOf) <= 200 * 86400_000
    )
    .map(tag)
    .sort((a, b) => Math.abs(b.promoterChange!) - Math.abs(a.promoterChange!))
    .slice(0, 150)
  const updatedAt = db.select().from(schema.settings).where(eq(schema.settings.key, 'research:shpWindowAt')).get()?.value ?? null
  return { mine, promoterMoves, updatedAt }
}

// ---------------- industries ----------------

export function saveIndustry(db: Db, symbol: string, d: ReturnType<typeof parseSymbolData>): void {
  touchResearch(db)
  const v = {
    macro: d?.macro ?? null,
    sector: d?.sector ?? null,
    industry: d?.industry ?? null,
    basicIndustry: d?.basicIndustry ?? null,
    sectorIndex: d?.sectorIndex ?? null,
    sectorPe: d?.sectorPe ?? null,
    symbolPe: d?.symbolPe ?? null,
    indicesJson: d ? JSON.stringify(d.indices) : null,
    listedOn: d?.listedOn ?? null,
    checkedAt: new Date().toISOString()
  }
  db.insert(schema.researchIndustry).values({ symbol, ...v }).onConflictDoUpdate({ target: schema.researchIndustry.symbol, set: v }).run()
}

/** Companies to classify next: never asked, or asked over a month ago; held and watched first, then the biggest. */
export function industryWanted(db: Db, limit: number, now = Date.now()): string[] {
  const at = new Map(db.select({ s: schema.researchIndustry.symbol, at: schema.researchIndustry.checkedAt }).from(schema.researchIndustry).all().map((r) => [r.s, Date.parse(r.at)]))
  const mcap = new Map(db.select({ s: schema.researchQuotes.symbol, m: schema.researchQuotes.mcap }).from(schema.researchQuotes).all().map((r) => [r.s, r.m ?? 0]))
  const first = new Set([...heldStocks(db).keys(), ...watchedSymbols(db)])
  return listedCompanies(db)
    .map((c) => c.symbol)
    .filter((s) => !(now - (at.get(s) ?? 0) < 30 * 86400_000))
    .sort((a, b) => Number(first.has(b)) - Number(first.has(a)) || (mcap.get(b) ?? 0) - (mcap.get(a) ?? 0))
    .slice(0, limit)
}

export function industryMap(db: Db): IndustryMap {
  const classes = db
    .select({ symbol: schema.researchIndustry.symbol, macro: schema.researchIndustry.macro, sector: schema.researchIndustry.sector, industry: schema.researchIndustry.industry, basicIndustry: schema.researchIndustry.basicIndustry })
    .from(schema.researchIndustry)
    .all()
    .filter((c) => c.sector)
  return { classes, companies: listedCompanies(db).length, classified: classes.length }
}

// ---------------- announcements ----------------

export const DIGEST_KEY = 'research:digest'

export function saveAnnouncements(db: Db, rows: ReturnType<typeof parseAnnouncements>, keepFrom = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)): void {
  db.transaction((tx) => {
    for (const r of rows) {
      const v = { ...r, tag: tagAnnouncement(r.category, r.text) }
      tx.insert(schema.researchAnnouncements).values(v).onConflictDoUpdate({ target: schema.researchAnnouncements.id, set: v }).run()
    }
    tx.delete(schema.researchAnnouncements).where(sql`${schema.researchAnnouncements.at} < ${keepFrom}`).run()
  })
}

const toAnn = (r: typeof schema.researchAnnouncements.$inferSelect): Announcement => ({ ...r, tag: r.tag as AnnTag })

/** Held and watched companies' announcements since a date, newest first (routine filings left out unless asked). */
export function myAnnouncements(db: Db, since: string, routine = true) {
  const held = new Set(heldStocks(db).keys())
  const watched = watchedSymbols(db)
  const mine = [...new Set([...held, ...watched])]
  if (mine.length === 0) return []
  return db
    .select()
    .from(schema.researchAnnouncements)
    .where(and(sql`${schema.researchAnnouncements.at} >= ${since}`, inArray(schema.researchAnnouncements.symbol, mine)))
    .orderBy(desc(schema.researchAnnouncements.at))
    .all()
    .filter((r) => routine || r.tag !== 'routine')
    .map((r) => ({ ...toAnn(r), held: held.has(r.symbol), watched: watched.has(r.symbol) }))
}

export function announcementsReport(db: Db, today = new Date().toISOString().slice(0, 10)): AnnouncementsReport {
  const day = (n: number) => new Date(Date.parse(today) - n * 86400_000).toISOString().slice(0, 10)
  const market = db
    .select()
    .from(schema.researchAnnouncements)
    .where(and(sql`${schema.researchAnnouncements.at} >= ${day(3)}`, inArray(schema.researchAnnouncements.tag, MARKET_TAGS)))
    .orderBy(desc(schema.researchAnnouncements.at))
    .limit(400)
    .all()
    .map(toAnn)
  const get = (k: string) => db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value ?? null
  const digest = get(DIGEST_KEY)
  return { mine: myAnnouncements(db, day(30)), market, digest: digest ? JSON.parse(digest) : null, updatedAt: get('research:annAt') }
}
