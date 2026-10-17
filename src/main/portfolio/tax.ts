import { asc, eq, inArray, like } from 'drizzle-orm'
import type { HarvestIdea, OpenLot, RealizedGain, TaxReport, TaxYearSummary } from '@shared/types'
import { schema, type Db } from '../db'
import { addDays, financialYearOf, todayIso } from './dates'
import { computeFifo, type FifoTxn } from './fifo'
import { FxTable } from './fx'
import { listHoldings } from './holdings'
import {
  GRANDFATHER_DATE,
  grandfatheredCost,
  ltcgExemption,
  taxClassOf,
  treatment,
  yearTax,
  type TaxClass
} from './taxRules'

/** price_history key holding the 31 Jan 2018 value of an instrument (grandfathering). */
export const fmvKey = (instrumentId: number) => `FMV2018:I:${instrumentId}`

/** Account kinds whose sales are capital gains this app can work out from trades. */
const TRADED_KINDS = new Set(['DEMAT', 'MF_FOLIO', 'US_BROKER', 'OTHER'])
const SOON_DAYS = 60

/**
 * Capital gains from the trade history: every sale matched first-in-first-out to its purchases,
 * converted to rupees at the rate on each trade date, and taxed by the rules in taxRules.ts.
 * Holdings without a purchase-by-purchase history can't be split into lots, so they are listed
 * as estimates only.
 */
export function computeTax(db: Db, personId?: number, today = todayIso()): TaxReport {
  const fx = FxTable.load(db, 'USDINR')
  const currentFy = financialYearOf(today).label
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  const accounts = db
    .select()
    .from(schema.accounts)
    .where(personId ? eq(schema.accounts.personId, personId) : undefined)
    .all()
    .filter((a) => TRADED_KINDS.has(a.kind))
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const instruments = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const fmv = new Map(
    db
      .select()
      .from(schema.priceHistory)
      .where(like(schema.priceHistory.key, 'FMV2018:I:%'))
      .all()
      .map((r) => [Number(r.key.slice('FMV2018:I:'.length)), r.close])
  )
  const txns = accounts.length
    ? db
        .select()
        .from(schema.transactions)
        .where(
          inArray(
            schema.transactions.accountId,
            accounts.map((a) => a.id)
          )
        )
        .orderBy(asc(schema.transactions.date), asc(schema.transactions.id))
        .all()
    : []
  const byPair = new Map<string, typeof txns>()
  for (const t of txns) {
    const k = `${t.accountId}:${t.instrumentId}`
    byPair.set(k, [...(byPair.get(k) ?? []), t])
  }
  const rows = listHoldings(db, personId)
  const rowByPair = new Map(rows.map((r) => [`${r.accountId}:${r.instrumentId}`, r]))

  const realized: RealizedGain[] = []
  const lots: OpenLot[] = []
  const warnings: string[] = []
  const missingFmv = new Set<string>()
  const lotPairs = new Set<string>()

  for (const [k, pairTxns] of byPair) {
    const [accountId, instrumentId] = k.split(':').map(Number)
    const account = accountById.get(accountId)!
    const inst = instruments.get(instrumentId)
    if (!inst) continue
    const cls = taxClassOf(inst)
    if (!cls) continue
    const pid = account.personId
    const personName = persons.get(pid) ?? ''
    const row = rowByPair.get(k)
    // Lots are only trustworthy when the trades add up to what the statement shows.
    if (row && row.tradesQuantity !== null) continue
    if (!pairTxns.some((t) => t.type === 'BUY')) continue

    // Rupees at each trade's own date: cost at the purchase rate, proceeds at the sale rate.
    const inr: FifoTxn[] = pairTxns.map((t) => {
      const rate = t.currency === 'USD' ? (fx.on(t.date) ?? fx.latest() ?? 0) : 1
      return { date: t.date, type: t.type, quantity: t.quantity, amount: t.amount * rate, fees: t.fees * rate }
    })
    const fifo = computeFifo(inr)
    if (fifo.unmatchedSellQuantity > 1e-6)
      warnings.push(
        `${inst.name}: ${+fifo.unmatchedSellQuantity.toFixed(3)} units sold have no matching purchase in the data, so that part of the sale is left out.`
      )

    const fmvPerUnit = fmv.get(instrumentId) ?? null
    const taxCost = (cost: number, units: number, proceeds: number, buyDate: string, term: 'ST' | 'LT') => {
      const eligible = cls === 'EQUITY' && term === 'LT' && buyDate <= GRANDFATHER_DATE
      if (!eligible) return { cost, grandfathered: false }
      if (fmvPerUnit === null) {
        missingFmv.add(inst.name)
        return { cost, grandfathered: false }
      }
      const c = grandfatheredCost(cost, fmvPerUnit * units, proceeds)
      return { cost: c, grandfathered: c !== cost }
    }

    for (const s of fifo.sales) {
      const tr = treatment(cls, s.buyDate, s.sellDate)
      const { cost, grandfathered } = taxCost(s.cost, s.quantity, s.proceeds, s.buyDate, tr.term)
      realized.push({
        personId: pid,
        personName,
        accountName: row?.accountName ?? account.externalId ?? account.platform,
        instrumentId,
        name: inst.name,
        isin: inst.isin,
        taxClass: cls,
        buyDate: s.buyDate,
        sellDate: s.sellDate,
        fy: financialYearOf(s.sellDate).label,
        units: s.quantity,
        costInr: cost,
        actualCostInr: s.cost,
        proceedsInr: s.proceeds,
        gainInr: s.proceeds - cost,
        term: tr.term,
        kind: tr.kind,
        rate: tr.rate,
        fmv2018: s.buyDate <= GRANDFATHER_DATE ? fmvPerUnit : null,
        grandfathered
      })
    }

    // Open lots, valued at today's price of the holding.
    if (!row || row.marketValueInr === null || row.quantity <= 0) continue
    lotPairs.add(k)
    const pricePerUnit = row.marketValueInr / row.quantity
    for (const lot of fifo.openLots) {
      if (lot.quantity <= 1e-9) continue
      const tr = treatment(cls, lot.date, today)
      const value = lot.quantity * pricePerUnit
      const { cost } = taxCost(lot.quantity * lot.costPerUnit, lot.quantity, value, lot.date, tr.term)
      lots.push({
        personId: pid,
        personName,
        accountName: row.accountName,
        accountId,
        instrumentId,
        name: inst.name,
        taxClass: cls,
        buyDate: lot.date,
        units: lot.quantity,
        costInr: cost,
        valueInr: value,
        gainInr: value - cost,
        term: tr.term,
        kind: tr.kind,
        longTermFrom: tr.longTermFrom
      })
    }
  }

  // ---------- opening lots for holdings with no trade history ----------
  // A statement plus a broker's holdings file give units and average cost but not dates. When the
  // date is known (INDmoney's "Holding Since", or typed in) the holding becomes one lot from that
  // date; when the broker says how many units are over a year old (Zerodha's "Quantity Long Term"),
  // those are dated a year and a day before the file and the rest today, so they are never shown
  // as long-term too early.
  const dates = new Map<
    string,
    { heldSince: string | null; longTermQty: number | null; asOf: string; manual: boolean }
  >()
  for (const b of db.select().from(schema.costBasis).all()) {
    if (!b.heldSince && b.longTermQty === null) continue
    for (const k of [b.accountId ? `a${b.accountId}:${b.instrumentId}` : `p${b.personId}:${b.instrumentId}`]) {
      const prev = dates.get(k)
      const manual = b.source === 'MANUAL'
      if (!prev || (manual && !prev.manual) || (manual === prev.manual && b.asOf > prev.asOf))
        dates.set(k, { heldSince: b.heldSince, longTermQty: b.longTermQty, asOf: b.asOf, manual })
    }
  }
  for (const row of rows) {
    const k = `${row.accountId}:${row.instrumentId}`
    if (lotPairs.has(k) || !accountById.has(row.accountId)) continue
    const inst = instruments.get(row.instrumentId)
    const cls = inst ? taxClassOf(inst) : null
    if (!inst || !cls || row.investedInr === null || row.marketValueInr === null || row.quantity <= 0) continue
    const d = dates.get(`a${row.accountId}:${row.instrumentId}`) ?? dates.get(`p${row.personId}:${row.instrumentId}`)
    if (!d) continue
    const parts: { units: number; date: string; from: NonNullable<OpenLot['estimatedFrom']> }[] = []
    if (d.heldSince) parts.push({ units: row.quantity, date: d.heldSince, from: 'HELD_SINCE' })
    else if (d.longTermQty !== null) {
      const long = Math.min(row.quantity, Math.max(0, d.longTermQty))
      if (long > 1e-9) parts.push({ units: long, date: addDays(d.asOf, -366), from: 'OVER_A_YEAR' })
      if (row.quantity - long > 1e-9) parts.push({ units: row.quantity - long, date: d.asOf, from: 'WITHIN_A_YEAR' })
    }
    if (parts.length === 0) continue
    lotPairs.add(k)
    const fmvPerUnit = fmv.get(row.instrumentId) ?? null
    for (const p of parts) {
      const share = p.units / row.quantity
      const value = row.marketValueInr * share
      let cost = row.investedInr * share
      const tr = treatment(cls, p.date, today)
      // Grandfathering needs a real pre-2018 date; an estimated "over a year" date never qualifies.
      if (cls === 'EQUITY' && tr.term === 'LT' && p.from === 'HELD_SINCE' && p.date <= GRANDFATHER_DATE) {
        if (fmvPerUnit === null) missingFmv.add(inst.name)
        else cost = grandfatheredCost(cost, fmvPerUnit * p.units, value)
      }
      lots.push({
        personId: row.personId,
        personName: row.personName,
        accountName: row.accountName,
        accountId: row.accountId,
        instrumentId: row.instrumentId,
        name: inst.name,
        taxClass: cls,
        buyDate: p.date,
        units: p.units,
        costInr: cost,
        valueInr: value,
        gainInr: value - cost,
        term: tr.term,
        kind: tr.kind,
        longTermFrom: tr.longTermFrom,
        estimatedFrom: p.from
      })
    }
  }
  if (lots.some((l) => l.estimatedFrom === 'OVER_A_YEAR'))
    warnings.push(
      'Some holdings have no trade history, so their purchase dates are estimated from the broker\'s long-term quantity (shown as "over a year"). Units bought before Feb 2018 may owe less tax than shown: import the broker\'s tradebook for exact dates, or enter the date a holding was first bought.'
    )

  // ---------- each person's financial years ----------
  const groups = new Map<string, RealizedGain[]>()
  for (const g of realized) {
    const k = `${g.personId}|${g.fy}`
    groups.set(k, [...(groups.get(k) ?? []), g])
  }
  const years: TaxYearSummary[] = [...groups].map(([k, gs]) => {
    const [pid, fy] = k.split('|')
    const t = yearTax(
      fy,
      gs.map((g) => ({ term: g.term, kind: g.kind, rate: g.rate, amount: g.gainInr }))
    )
    return {
      personId: Number(pid),
      personName: persons.get(Number(pid)) ?? '',
      fy,
      current: fy === currentFy,
      shortTermGain: t.shortTermGain,
      longTermGain: t.longTermGain,
      buckets: t.buckets,
      exemptionUsed: t.exemptionUsed,
      exemptionLimit: t.exemptionLimit,
      slabGain: t.slabGain,
      fixedRateTax: t.fixedRateTax,
      carryForward: t.carryForward,
      sales: gs.length
    }
  })
  years.sort((a, b) => b.fy.localeCompare(a.fy) || a.personName.localeCompare(b.personName))

  // ---------- this year's exemption and harvesting ----------
  const limit = ltcgExemption(currentFy)
  const peopleInScope = [...new Set(accounts.map((a) => a.personId))]
  const exemptionLeft = peopleInScope.map((pid) => {
    const y = years.find((x) => x.personId === pid && x.current)
    return {
      personId: pid,
      personName: persons.get(pid) ?? '',
      left: Math.max(0, limit - (y?.exemptionUsed ?? 0)),
      limit
    }
  })
  const harvest: HarvestIdea[] = []
  for (const e of exemptionLeft) {
    let left = e.left
    // Selling sells the oldest units first, so only a run of long-term lots from the start counts.
    const holdings = new Map<string, OpenLot[]>()
    for (const l of lots.filter((x) => x.personId === e.personId && x.kind === '112A'))
      holdings.set(`${l.accountId}:${l.instrumentId}`, [...(holdings.get(`${l.accountId}:${l.instrumentId}`) ?? []), l])
    const runs = [...holdings.values()]
      .map((ls) => {
        const all = lots.filter((x) => x.accountId === ls[0].accountId && x.instrumentId === ls[0].instrumentId)
        const run: OpenLot[] = []
        for (const l of all) {
          if (l.term !== 'LT') break
          run.push(l)
        }
        return run
      })
      .filter((run) => run.reduce((s, l) => s + l.gainInr, 0) > 1)
      .sort((a, b) => b.reduce((s, l) => s + l.gainInr, 0) - a.reduce((s, l) => s + l.gainInr, 0))
    for (const run of runs) {
      if (left < 1) break
      let units = 0
      let value = 0
      let gain = 0
      for (const l of run) {
        if (gain + l.gainInr <= left || l.gainInr <= 0) {
          units += l.units
          value += l.valueInr
          gain += l.gainInr
          continue
        }
        const share = (left - gain) / l.gainInr
        units += l.units * share
        value += l.valueInr * share
        gain += l.gainInr * share
        break
      }
      if (gain < 1) continue
      left -= gain
      harvest.push({
        personId: e.personId,
        personName: e.personName,
        accountName: run[0].accountName,
        name: run[0].name,
        units,
        valueInr: value,
        gainInr: gain
      })
    }
  }

  const horizon = addDays(today, SOON_DAYS)
  const soonLongTerm = lots
    .filter((l) => l.term === 'ST' && l.gainInr > 0 && l.longTermFrom !== null && l.longTermFrom <= horizon)
    .sort((a, b) => a.longTermFrom!.localeCompare(b.longTermFrom!))
  const losses = lots.filter((l) => l.gainInr < -1).sort((a, b) => a.gainInr - b.gainInr)

  const sum = (xs: OpenLot[]) => xs.reduce((s, l) => s + l.gainInr, 0)
  const unrealized = {
    shortTermGain: sum(lots.filter((l) => l.term === 'ST' && l.gainInr > 0)),
    shortTermLoss: sum(lots.filter((l) => l.term === 'ST' && l.gainInr < 0)),
    longTermGain: sum(lots.filter((l) => l.term === 'LT' && l.gainInr > 0)),
    longTermLoss: sum(lots.filter((l) => l.term === 'LT' && l.gainInr < 0))
  }

  // ---------- holdings without lots ----------
  // Holdings already given a price by a broker's holdings file (imported before it was read for dates).
  const brokerFiles = new Set(
    db
      .select()
      .from(schema.costBasis)
      .all()
      .filter((b) => b.source === 'BROKER' && b.accountId)
      .map((b) => `${b.accountId}:${b.instrumentId}`)
  )
  const estimateOnly = rows
    .filter((r) => {
      const a = accountById.get(r.accountId)
      const inst = instruments.get(r.instrumentId)
      return a && inst && taxClassOf(inst) && !lotPairs.has(`${r.accountId}:${r.instrumentId}`)
    })
    .map((r) => ({
      personName: r.personName,
      name: r.instrumentName,
      valueInr: r.marketValueInr ?? 0,
      gainInr: r.marketValueInr !== null && r.investedInr !== null ? r.marketValueInr - r.investedInr : null,
      fix: fixFor(r, accountById.get(r.accountId)!, brokerFiles.has(`${r.accountId}:${r.instrumentId}`))
    }))
    .sort((a, b) => b.valueInr - a.valueInr)

  if (missingFmv.size)
    warnings.push(
      `No 31 Jan 2018 price yet for ${[...missingFmv].join(', ')}, so units bought before Feb 2018 use their actual cost (gain may be overstated). It is fetched with the daily price refresh.`
    )
  if (realized.some((g) => g.taxClass === ('FOREIGN' satisfies TaxClass)) || lots.some((l) => l.taxClass === 'FOREIGN'))
    warnings.push(
      'US shares are converted at the USD→INR market rate on each trade date. The tax rules use the SBI TT buying rate of the month before each trade, so expect small differences.'
    )

  return {
    currentFy,
    years,
    realized: realized.sort((a, b) => b.sellDate.localeCompare(a.sellDate)),
    lots,
    unrealized,
    exemptionLeft,
    harvest,
    soonLongTerm,
    losses,
    estimateOnly,
    warnings
  }
}

/** What to import so a holding gets dated lots, by where it is held. */
function fixFor(
  r: { assetClass: string; platform: string; tradesQuantity: number | null },
  account: { kind: string },
  hadBrokerFile: boolean
): string {
  const zerodha = r.platform === 'ZERODHA'
  if (r.tradesQuantity !== null)
    return 'Trades imported don’t add up to the units held: import the missing years of the tradebook.'
  if (account.kind === 'US_BROKER')
    return r.platform === 'INDMONEY'
      ? 'INDmoney holdings report (it has “Holding Since”) and order report.'
      : 'The broker’s order history, or enter when it was first bought.'
  if (account.kind === 'MF_FOLIO')
    return 'A Detailed CAS “since inception” from camsonline.com or mfcentral.com (lists every purchase).'
  if (r.assetClass === 'MF')
    return zerodha
      ? 'Zerodha Console → Reports → Tradebook → Mutual funds, every year since first bought.'
      : 'The broker’s mutual fund order history, or a Detailed CAS since inception.'
  if (zerodha)
    return hadBrokerFile
      ? 'Import the Zerodha holdings file again (this version reads its long-term quantity), or the tradebook for every year.'
      : 'Zerodha holdings file (long-term quantity) or Console → Reports → Tradebook → Equity, every year.'
  if (r.platform === 'GROWW') return 'Groww order history (Stocks → Reports), every year since first bought.'
  return 'The broker’s trade history, or open the holding and enter when it was first bought.'
}
