import { asc, eq, inArray } from 'drizzle-orm'
import { CHART_GROUPS, GROUP_OF, type AnalysisReport, type ChartGroup, type Liquidity } from '@shared/assets'
import type { HoldingRow } from '@shared/types'
import { schema, type Db } from '../db'
import { loadManualAssets, loadPriceBook } from '../manualAssets'
import { addDays, addYears, financialYearOf, monthEnds, todayIso } from './dates'
import { listDividends, openingFromTrades, unitsHeldBefore, US_WITHHOLDING } from './dividends'
import { engineFor, type Engine } from './engines'
import { estimateEpfBalance, parseEpfMeta } from './epf'
import { FxTable } from './fx'
import { listHoldings } from './holdings'
import { xirr, type CashFlow } from './xirr'

type Txn = typeof schema.transactions.$inferSelect

const MARKET_LIQUIDITY: Partial<Record<HoldingRow['assetClass'], Liquidity>> = {
  EQUITY_IN: 'LIQUID',
  ETF: 'LIQUID',
  EQUITY_US: 'LIQUID',
  MF: 'LIQUID',
  BOND: 'BREAKABLE',
  EPF: 'LOCKED',
  NPS: 'LOCKED',
  INSURANCE: 'BREAKABLE',
  OTHER: 'ILLIQUID'
}

/** The investor's cash flow for one transaction, in INR. Reinvested dividends never left the fund. */
export function txnFlow(t: Txn, fx: FxTable): number {
  const rate = t.currency === 'USD' ? (fx.on(t.date) ?? fx.latest() ?? 0) : 1
  switch (t.type) {
    case 'BUY':
      return -(Math.abs(t.amount) + t.fees) * rate
    case 'SELL':
    case 'DIVIDEND':
      return (Math.abs(t.amount) - t.fees) * rate
    case 'TAX':
      return -Math.abs(t.amount) * rate
    case 'DIVIDEND_REINVEST':
    case 'BONUS':
    case 'SPLIT':
      return 0
    default:
      return t.amount * rate
  }
}

export interface Item {
  row: HoldingRow
  /** Dated flows including today's value as the last one; null when the history is incomplete. */
  flows: CashFlow[] | null
  /** The same flows without the closing value: money in and out only. */
  own: CashFlow[] | null
  incomeThisFy: number
  liquidity: Liquidity
  /**
   * Set when the flows are rebuilt from statements rather than a full trade history: the date of
   * the first statement, from which the return is measured (the holding counts as bought then, at
   * that day's value).
   */
  since: string | null
}

type Snap = typeof schema.holdingSnapshots.$inferSelect

/**
 * Money in and out for a holding known from statements (and maybe some trades): the first
 * statement's units count as bought on its date at that day's price, a change in units between
 * statements that no trade explains as bought or sold on the later statement's date, and trades
 * after the first statement as themselves. This matches how the net worth history counts its
 * units, so returns measured from the first statement are consistent with the chart. Returns null
 * when a price is missing for any of those dates.
 */
export function flowsFromStatements(
  snaps: Snap[],
  txns: Txn[],
  priceOn: (date: string, snap: Snap | null) => number | null,
  fx: FxTable,
  isUsd: boolean
): { flows: CashFlow[]; since: string } | null {
  // Trade files that reach back further than the statements: measured from the day before the
  // first trade, with the units they don't explain counted as bought then at that day's price.
  const opening = openingFromTrades(txns, snaps)
  if (opening) {
    const price = opening.units > 0 ? priceOn(opening.date, null) : 0
    if (price !== null) {
      const rate = isUsd ? (fx.on(opening.date) ?? fx.latest() ?? 0) : 1
      const flows: CashFlow[] = [
        ...(opening.units > 0 ? [{ date: opening.date, amount: -opening.units * price * rate }] : []),
        ...txns.map((t) => ({ date: t.date, amount: txnFlow(t, fx) }))
      ]
      return { flows: flows.sort((a, b) => a.date.localeCompare(b.date)), since: opening.date }
    }
  }
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return null
  const flows: CashFlow[] = []
  let prev: Snap | null = null
  for (const s of sorted) {
    const from = prev?.date
    const traded = from ? txns.filter((t) => t.date > from && t.date <= s.date).reduce((a, t) => a + t.quantity, 0) : 0
    const delta = s.quantity - ((prev?.quantity ?? 0) + traded)
    if (Math.abs(delta) > 1e-6) {
      const price = priceOn(s.date, s)
      if (price === null) return null
      const rate = isUsd ? (fx.on(s.date) ?? fx.latest() ?? 0) : 1
      flows.push({ date: s.date, amount: -delta * price * rate })
    }
    prev = s
  }
  const since = sorted[0].date
  for (const t of txns) if (t.date > since) flows.push({ date: t.date, amount: txnFlow(t, fx) })
  return flows.length ? { flows: flows.sort((a, b) => a.date.localeCompare(b.date)), since } : null
}

export type Engines = Map<number, { engine: Engine; name: string; personId: number }>

export interface Context {
  today: string
  fx: FxTable
  rows: HoldingRow[]
  payments: ReturnType<typeof listDividends>['payments']
  accounts: (typeof schema.accounts.$inferSelect)[]
  txnsByPair: Map<string, Txn[]>
  engines: Engines
  items: Item[]
  persons: Map<number, string>
}

/** Holdings, their dated cash flows and valuation engines: the shared input of Analysis and Performance. */
export function loadContext(db: Db, personId?: number): Context {
  const today = todayIso()
  const fy = financialYearOf(today)
  const fyFrom = addDays(fy.start, -1)
  const fx = FxTable.load(db, 'USDINR')
  const book = loadPriceBook(db)
  const rows = listHoldings(db, personId)
  const { payments } = listDividends(db, personId)

  const accounts = db
    .select()
    .from(schema.accounts)
    .where(personId ? eq(schema.accounts.personId, personId) : undefined)
    .all()
  const accountIds = accounts.map((a) => a.id)
  const txns = accountIds.length
    ? db
        .select()
        .from(schema.transactions)
        .where(inArray(schema.transactions.accountId, accountIds))
        .orderBy(asc(schema.transactions.date))
        .all()
    : []
  const txnsByPair = new Map<string, Txn[]>()
  for (const t of txns) {
    const k = `${t.accountId}:${t.instrumentId}`
    txnsByPair.set(k, [...(txnsByPair.get(k) ?? []), t])
  }

  // Statements, for holdings without a complete trade history.
  const snapsByPair = new Map<string, Snap[]>()
  if (accountIds.length)
    for (const sn of db
      .select()
      .from(schema.holdingSnapshots)
      .where(inArray(schema.holdingSnapshots.accountId, accountIds))
      .all()) {
      const k = `${sn.accountId}:${sn.instrumentId}`
      snapsByPair.set(k, [...(snapsByPair.get(k) ?? []), sn])
    }
  const histCache = new Map<number, { date: string; close: number }[]>()
  const closeOn = (instrumentId: number, date: string): number | null => {
    if (!histCache.has(instrumentId))
      histCache.set(
        instrumentId,
        db
          .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
          .from(schema.priceHistory)
          .where(eq(schema.priceHistory.key, `I:${instrumentId}`))
          .orderBy(asc(schema.priceHistory.date))
          .all()
      )
    let found: number | null = null
    for (const p of histCache.get(instrumentId)!) if (p.date <= date) found = p.close
    return found
  }
  const accountKind = new Map(accounts.map((a) => [a.id, a.kind]))

  const manual = loadManualAssets(db, personId)
  const engines: Engines = new Map()
  for (const m of manual)
    engines.set(m.account.id, {
      engine: engineFor(m.meta, m.entries, book, today),
      name: m.meta.name,
      personId: m.account.personId
    })

  // ---------- per-holding flows, income and liquidity ----------
  const items: Item[] = rows.map((row) => {
    const value = row.marketValueInr ?? 0
    const eng = engines.get(row.accountId)
    if (eng) {
      const { engine } = eng
      const mat = engine.maturity()
      const base = engine.flows()
      const matured = !!mat && mat.date <= today
      const flows = base.length ? [...base, ...(matured ? [] : [{ date: today, amount: value }])] : null
      const inc = engine.incomeBetween(fyFrom, today)
      return {
        row,
        flows,
        own: base.length ? base.map((f) => ({ date: f.date, amount: f.amount })) : null,
        incomeThisFy: inc.interest + inc.rent,
        liquidity: engine.liquidity().bucket,
        since: null
      }
    }
    const pairTxns = txnsByPair.get(`${row.accountId}:${row.instrumentId}`) ?? []
    const complete = pairTxns.some((t) => t.type === 'BUY') && row.tradesQuantity === null
    const divs = payments.filter((p) => p.instrumentId === row.instrumentId && p.accountName === row.accountName)
    let own: CashFlow[] | null = null
    let since: string | null = null
    const estimatedDivs = divs.filter((p) => p.basis === 'ESTIMATED')
    if (complete) {
      own = [
        ...pairTxns.map((t) => ({ date: t.date, amount: txnFlow(t, fx) })),
        ...estimatedDivs.map((p) => ({ date: p.exDate, amount: p.netInr }))
      ]
    } else if (!['EPF', 'INSURANCE'].includes(accountKind.get(row.accountId) ?? '') && row.marketValueInr !== null) {
      // Statement-only, or trade files that don't reach back: measured from the first statement.
      const rebuilt = flowsFromStatements(
        snapsByPair.get(`${row.accountId}:${row.instrumentId}`) ?? [],
        pairTxns,
        (date, sn) =>
          closeOn(row.instrumentId, date) ??
          (sn
            ? (sn.price ?? (sn.value != null && sn.quantity > 0 ? sn.value / sn.quantity : null))
            : // Before any statement: the price of the first trade on file.
              (pairTxns.find((t) => t.price != null && t.quantity !== 0)?.price ?? null)),
        fx,
        row.currency === 'USD'
      )
      if (rebuilt) {
        own = [
          ...rebuilt.flows,
          ...estimatedDivs.filter((p) => p.exDate > rebuilt.since).map((p) => ({ date: p.exDate, amount: p.netInr }))
        ]
        since = rebuilt.since
      }
    }
    const flows = own ? [...own, { date: today, amount: value }] : null
    const incomeThisFy = divs.filter((p) => p.exDate > fyFrom && p.exDate <= today).reduce((s, p) => s + p.netInr, 0)
    return { row, flows, own, incomeThisFy, liquidity: MARKET_LIQUIDITY[row.assetClass] ?? 'LIQUID', since }
  })

  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  return { today, fx, rows, payments, accounts, txnsByPair, engines, items, persons }
}

export function computeAnalysis(db: Db, personId?: number): AnalysisReport {
  const { today, fx, rows, payments, accounts, txnsByPair, engines, items, persons } = loadContext(db, personId)
  const fy = financialYearOf(today)

  const valueOf = (i: Item) => i.row.marketValueInr ?? i.row.investedInr ?? 0
  const totalInr = items.reduce((s, i) => s + valueOf(i), 0)
  const groupXirr = (group: Item[]) => {
    const covered = group.filter((i) => i.flows)
    const value = group.reduce((s, i) => s + valueOf(i), 0)
    const coveredValue = covered.reduce((s, i) => s + valueOf(i), 0)
    return { xirr: xirr(covered.flatMap((i) => i.flows!)), coverage: value > 0 ? coveredValue / value : 0 }
  }

  // ---------- scorecard by asset class ----------
  const byClass = new Map<string, Item[]>()
  for (const i of items) byClass.set(i.row.assetClass, [...(byClass.get(i.row.assetClass) ?? []), i])
  const scorecard = [...byClass].map(([assetClass, group]) => {
    const value = group.reduce((s, i) => s + valueOf(i), 0)
    const withCost = group.filter((i) => i.row.investedInr !== null && i.row.marketValueInr !== null)
    const invested = withCost.length ? withCost.reduce((s, i) => s + i.row.investedInr!, 0) : null
    const gain = withCost.length ? withCost.reduce((s, i) => s + i.row.marketValueInr! - i.row.investedInr!, 0) : null
    const x = groupXirr(group)
    return {
      assetClass,
      valueInr: value,
      investedInr: invested,
      gainInr: gain,
      xirr: x.xirr,
      xirrCoverage: x.coverage,
      incomeThisFy: group.reduce((s, i) => s + i.incomeThisFy, 0),
      holdings: group.length
    }
  })
  scorecard.sort((a, b) => b.valueInr - a.valueInr)

  const overall = groupXirr(items)
  const byPerson = [...new Set(items.map((i) => i.row.personId))].map((pid) => {
    const x = groupXirr(items.filter((i) => i.row.personId === pid))
    return { personName: persons.get(pid) ?? '', xirr: x.xirr, coverage: x.coverage }
  })

  // ---------- net worth month by month ----------
  const history = buildHistory(db, accounts, txnsByPair, engines, fx, today)

  // ---------- income by financial year ----------
  const incomeByFy = new Map<string, { fy: string; dividends: number; interest: number; rent: number }>()
  const fyRow = (label: string) => {
    if (!incomeByFy.has(label)) incomeByFy.set(label, { fy: label, dividends: 0, interest: 0, rent: 0 })
    return incomeByFy.get(label)!
  }
  for (const p of payments) fyRow(financialYearOf(p.exDate).label).dividends += p.netInr
  const firstYear = Math.max(Number(today.slice(0, 4)) - 6, 2000)
  for (const { engine } of engines.values()) {
    for (let y = firstYear; y <= Number(fy.end.slice(0, 4)); y++) {
      const from = `${y - 1}-03-31`
      if (from >= today) break
      const to = `${y}-03-31` < today ? `${y}-03-31` : today
      const inc = engine.incomeBetween(from, to)
      if (inc.interest || inc.rent) {
        const r = fyRow(`FY${String(y).slice(2)}`)
        r.interest += inc.interest
        r.rent += inc.rent
      }
    }
  }
  const income = [...incomeByFy.values()].sort((a, b) => a.fy.localeCompare(b.fy)).slice(-8)

  // ---------- next 12 months ----------
  const horizon = addYears(today, 1)
  const upcoming: AnalysisReport['upcoming'] = []
  for (const { engine, name, personId: pid } of engines.values()) {
    for (const e of engine.events(today, horizon))
      upcoming.push({ ...e, holding: name, personName: persons.get(pid) ?? '' })
  }
  // Last year's dividends, repeated on today's units.
  const yearAgo = addYears(today, -1)
  const published = db.select().from(schema.dividends).all()
  for (const r of rows) {
    if (!['EQUITY_IN', 'ETF', 'REIT', 'EQUITY_US'].includes(r.assetClass)) continue
    for (const d of published.filter(
      (x) => x.instrumentId === r.instrumentId && x.exDate > yearAgo && x.exDate <= today
    )) {
      const isUs = r.currency === 'USD'
      upcoming.push({
        date: addYears(d.exDate, 1),
        label: 'Expected dividend',
        amount: d.amount * r.quantity * (isUs ? (1 - US_WITHHOLDING) * r.fxRate : 1),
        kind: 'DIVIDEND',
        holding: r.instrumentName,
        personName: r.personName
      })
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date))

  // ---------- maturity ladder ----------
  const ladder = new Map<string, AnalysisReport['maturities'][number]>()
  for (const { engine, name } of engines.values()) {
    const m = engine.maturity()
    if (!m || m.date <= today) continue
    const year = m.date.slice(0, 4)
    const row = ladder.get(year) ?? { year, amount: 0, items: [] }
    row.amount += m.value
    row.items.push({ name, date: m.date, amount: m.value })
    ladder.set(year, row)
  }
  const maturities = [...ladder.values()].sort((a, b) => a.year.localeCompare(b.year))

  // ---------- liquidity ----------
  const liq = new Map<Liquidity, number>()
  for (const i of items) liq.set(i.liquidity, (liq.get(i.liquidity) ?? 0) + valueOf(i))
  const liquidity = (['LIQUID', 'BREAKABLE', 'LOCKED', 'ILLIQUID'] as Liquidity[]).map((bucket) => ({
    bucket,
    valueInr: liq.get(bucket) ?? 0
  }))

  // ---------- concentration, treemap, movers (one entry per instrument) ----------
  const agg = new Map<
    number,
    { instrumentId: number; name: string; group: ChartGroup; value: number; invested: number; gain: number; hasCost: boolean }
  >()
  for (const i of items) {
    const r = i.row
    const a = agg.get(r.instrumentId) ?? {
      instrumentId: r.instrumentId,
      name: r.instrumentName,
      group: GROUP_OF[r.assetClass],
      value: 0,
      invested: 0,
      gain: 0,
      hasCost: false
    }
    a.value += valueOf(i)
    if (r.investedInr !== null && r.marketValueInr !== null) {
      a.invested += r.investedInr
      a.gain += r.marketValueInr - r.investedInr
      a.hasCost = true
    }
    agg.set(r.instrumentId, a)
  }
  const ranked = [...agg.values()].filter((a) => a.value > 0).sort((a, b) => b.value - a.value)
  const top10 = ranked.slice(0, 10).reduce((s, a) => s + a.value, 0)
  const withGain = [...agg.values()].filter((a) => a.hasCost && a.gain !== 0)
  const movers = [
    ...withGain
      .filter((a) => a.gain > 0)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 6),
    ...withGain
      .filter((a) => a.gain < 0)
      .sort((a, b) => a.gain - b.gain)
      .slice(0, 6)
  ].map((a) => ({ name: a.name, gainInr: a.gain, gainPct: a.invested > 0 ? a.gain / a.invested : null }))

  return {
    totalInr,
    xirr: { overall: overall.xirr, coverage: overall.coverage, byPerson },
    scorecard,
    history,
    income,
    upcoming: upcoming.slice(0, 60),
    maturities,
    liquidity,
    concentration: {
      top10Share: totalInr > 0 ? top10 / totalInr : 0,
      largest: ranked[0] ? { name: ranked[0].name, share: totalInr > 0 ? ranked[0].value / totalInr : 0 } : null
    },
    treemap: ranked.slice(0, 40).map((a) => ({
      instrumentId: a.instrumentId,
      name: a.name,
      group: a.group,
      valueInr: a.value,
      gainPct: a.hasCost && a.invested > 0 ? a.gain / a.invested : null
    })),
    movers
  }
}

/**
 * Value of everything at each month end: units held (from trades or statements) × that week's price,
 * EPF from passbook entries, hand-maintained assets from their engines.
 */
export function buildHistory(
  db: Db,
  accounts: (typeof schema.accounts.$inferSelect)[],
  txnsByPair: Map<string, Txn[]>,
  engines: Map<number, { engine: Engine }>,
  fx: FxTable,
  today: string,
  /** Only these "accountId:instrumentId" pairs (all when omitted). */
  only?: Set<string>
): AnalysisReport['history'] {
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const snaps = accounts.length
    ? db
        .select()
        .from(schema.holdingSnapshots)
        .where(
          inArray(
            schema.holdingSnapshots.accountId,
            accounts.map((a) => a.id)
          )
        )
        .orderBy(asc(schema.holdingSnapshots.date))
        .all()
    : []
  const snapsByPair = new Map<string, typeof snaps>()
  for (const s of snaps) {
    const k = `${s.accountId}:${s.instrumentId}`
    snapsByPair.set(k, [...(snapsByPair.get(k) ?? []), s])
  }
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
      .map((q) => [q.instrumentId, q.price])
  )

  // Start at the earliest dated data, at most five years back.
  const dates = [
    ...[...txnsByPair.values()].flat().map((t) => t.date),
    ...snaps.map((s) => s.date),
    ...[...engines.values()].map((e) => e.engine.start).filter((d): d is string => !!d)
  ].sort()
  const fiveYears = addYears(today, -5)
  const start = dates.length ? (dates[0] > fiveYears ? dates[0] : fiveYears) : today
  const months = monthEnds(start, today)
  const series = new Map<ChartGroup, number[]>(CHART_GROUPS.map((g) => [g, months.map(() => 0)]))
  const add = (group: ChartGroup, i: number, v: number) => {
    if (Number.isFinite(v) && v > 0) series.get(group)![i] += v
  }

  const histCache = new Map<number, { date: string; close: number }[]>()
  const histOf = (id: number) => {
    if (!histCache.has(id)) {
      histCache.set(
        id,
        db
          .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
          .from(schema.priceHistory)
          .where(eq(schema.priceHistory.key, `I:${id}`))
          .orderBy(asc(schema.priceHistory.date))
          .all()
      )
    }
    return histCache.get(id)!
  }
  const lastOnOrBefore = <T extends { date: string }>(xs: T[], d: string) => {
    let found: T | null = null
    for (const x of xs) if (x.date <= d) found = x
    return found
  }

  const pairs = new Set([...txnsByPair.keys(), ...snapsByPair.keys()])
  for (const k of pairs) {
    const [accountId, instrumentId] = k.split(':').map(Number)
    const account = accountById.get(accountId)
    const instrument = instruments.get(instrumentId)
    if (!account || !instrument || account.kind === 'MANUAL_ASSET') continue
    if (only && !only.has(k)) continue
    const group = GROUP_OF[instrument.assetClass]
    const pTxns = txnsByPair.get(k) ?? []
    const pSnaps = snapsByPair.get(k) ?? []

    if (account.kind === 'EPF') {
      const meta = parseEpfMeta(account.metaJson)
      months.forEach((d, i) => {
        const e = lastOnOrBefore(pSnaps, d)
        if (e?.value != null) add(group, i, estimateEpfBalance(e.value, e.date, d, meta))
      })
      continue
    }
    if (account.kind === 'INSURANCE') {
      months.forEach((d, i) => add(group, i, lastOnOrBefore(pSnaps, d)?.value ?? 0))
      continue
    }

    const hist = histOf(instrumentId)
    const isUsd = instrument.currency === 'USD'
    months.forEach((d, i) => {
      const units = unitsHeldBefore(addDays(d, 1), pTxns, pSnaps)
      if (!units || units <= 0) return
      const price =
        lastOnOrBefore(hist, d)?.close ??
        lastOnOrBefore(
          pSnaps.filter((s) => s.price != null),
          d
        )?.price ??
        lastOnOrBefore(
          pTxns.filter((t) => t.price != null),
          d
        )?.price ??
        (i === months.length - 1 ? quotes.get(instrumentId) : undefined)
      if (price == null) return
      add(group, i, units * price * (isUsd ? (fx.on(d) ?? fx.latest() ?? 0) : 1))
    })
  }

  for (const [accountId, { engine }] of engines) {
    const account = accountById.get(accountId)
    const id = account ? JSON.parse(account.metaJson ?? '{}').instrumentId : null
    const instrument = id ? instruments.get(id) : null
    if (!instrument) continue
    if (only && !only.has(`${accountId}:${instrument.id}`)) continue
    const group = GROUP_OF[instrument.assetClass]
    months.forEach((d, i) => add(group, i, engine.valueOn(d)))
  }

  return {
    months,
    series: CHART_GROUPS.map((group) => ({ group, values: series.get(group)! })).filter((s) =>
      s.values.some((v) => v > 0)
    )
  }
}
