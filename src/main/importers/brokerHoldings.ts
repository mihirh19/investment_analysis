import { and, eq } from 'drizzle-orm'
import XLSX from 'xlsx'
import type { ImportResult, Platform } from '@shared/types'
import { schema, type Db } from '../db'
import { listHoldings } from '../portfolio/holdings'
import { nameSimilarity } from './amcPortfolio'
import { normalizeHeader, parseNumber } from './parse'

/**
 * Buy prices from a broker's holdings download. NSDL/CDSL statements list units and value but
 * not what was paid, so the gain is unknown until a cost comes from somewhere. Brokers' holdings
 * files carry it: Zerodha Console (stocks and Coin funds), Groww (stocks and funds), and most
 * others with an ISIN or symbol column plus an average price or invested amount.
 */

export interface BrokerHoldingRow {
  name: string
  isin: string | null
  symbol: string | null
  quantity: number | null
  avgCost: number | null
  invested: number | null
  /** Units held over a year (Zerodha's "Quantity Long Term"). */
  longTermQty: number | null
}

const NAME = [
  'symbol',
  'stock name',
  'scheme name',
  'scheme',
  'fund name',
  'instrument',
  'security name',
  'security',
  'scrip name',
  'scrip',
  'company name',
  'name'
]
const QTY = ['quantity available', 'quantity', 'qty', 'units', 'balance units', 'net qty', 'shares', 'holding quantity']
const AVG = [
  'average price',
  'average buy price',
  'avg. buy price',
  'avg buy price',
  'avg. cost',
  'avg cost',
  'average cost',
  'avg price',
  'buy avg',
  'buy average',
  'avg. price',
  'average nav',
  'purchase price'
]
const INVESTED = [
  'buy value',
  'invested value',
  'invested amount',
  'investment value',
  'total investment',
  'investment',
  'total cost',
  'cost value',
  'invested',
  'amount invested',
  'purchase value'
]

const col = (headers: string[], names: string[]) => {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n)
    if (i >= 0) return i
  }
  for (const n of names) {
    const i = headers.findIndex((h) => h.startsWith(n))
    if (i >= 0) return i
  }
  return -1
}

/** Reads every sheet; the header row is the first with a name/ISIN column and a price or cost column. */
export function parseBrokerHoldings(data: Buffer | ArrayBuffer): {
  platform: Platform | null
  rows: BrokerHoldingRow[]
  /** The date the statement is as on ("Equity Holdings Statement as on 2026-10-15"), if it says. */
  asOf: string | null
} {
  const wb = XLSX.read(data, { type: 'buffer' })
  const rows: BrokerHoldingRow[] = []
  let platform: Platform | null = null
  let asOf: string | null = null
  const seen = new Set<string>()
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '', raw: true })
    const text = grid
      .slice(0, 30)
      .map((r) => r.join(' '))
      .join(' ')
      .toLowerCase()
    asOf ??= statementDate(text)
    for (let r = 0; r < Math.min(grid.length, 60); r++) {
      const headers = grid[r].map(normalizeHeader)
      const iIsin = headers.findIndex((h) => h === 'isin' || h.startsWith('isin'))
      const iName = col(headers, NAME)
      const iAvg = col(headers, AVG)
      const iInv = col(headers, INVESTED)
      if ((iIsin < 0 && iName < 0) || (iAvg < 0 && iInv < 0)) continue
      const iQty = col(headers, QTY)
      const iLong = headers.findIndex((h) => h === 'quantity long term')
      // Zerodha's export says "Quantity Available"; Groww's "Average buy price".
      if (!platform) {
        if (headers.includes('quantity available') || /zerodha|kite|console|coin/.test(text)) platform = 'ZERODHA'
        else if (headers.some((h) => h.startsWith('average buy price')) || /groww/.test(text)) platform = 'GROWW'
        else if (/indmoney/.test(text)) platform = 'INDMONEY'
      }
      for (const line of grid.slice(r + 1)) {
        const isinRaw =
          iIsin >= 0
            ? String(line[iIsin] ?? '')
                .trim()
                .toUpperCase()
            : ''
        const isin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isinRaw) ? isinRaw : null
        const nameRaw = iName >= 0 ? String(line[iName] ?? '').trim() : ''
        if (!isin && !nameRaw) continue
        if (/^(total|grand total)\b/i.test(nameRaw)) continue
        const quantity = iQty >= 0 ? parseNumber(line[iQty]) : null
        const avgCost = iAvg >= 0 ? parseNumber(line[iAvg]) : null
        const invested = iInv >= 0 ? parseNumber(line[iInv]) : null
        if (!(avgCost && avgCost > 0) && !(invested && invested > 0)) continue
        const looksLikeSymbol = /^[A-Z0-9&.-]{2,20}$/.test(nameRaw)
        // Zerodha's file repeats every row on a "Combined" sheet: keep the first.
        const key = isin ?? nameRaw.toUpperCase()
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          name: nameRaw || isin!,
          isin,
          symbol: looksLikeSymbol ? nameRaw : null,
          quantity,
          avgCost: avgCost && avgCost > 0 ? avgCost : null,
          invested: invested && invested > 0 ? invested : null,
          longTermQty: iLong >= 0 ? parseNumber(line[iLong]) : null
        })
      }
      break
    }
  }
  return { platform, rows, asOf }
}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** "as on 2026-10-15", "as on 15-10-2026", "as of 15 Oct 2026" → 2026-10-15. */
export function statementDate(text: string): string | null {
  const m = text.match(/as (?:on|of)\s*:?\s*([0-9a-z ,/-]{8,20})/i)
  if (!m) return null
  const t = m[1].trim()
  const pad = (n: number) => String(n).padStart(2, '0')
  let y: number, mo: number, d: number
  let x: RegExpMatchArray | null
  if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, mo, d] = [+x[1], +x[2], +x[3]]
  else if ((x = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) [y, mo, d] = [+x[3], +x[2], +x[1]]
  else if ((x = t.match(/^(\d{1,2})[ -]([a-z]{3})[a-z]*[ ,-]+(\d{4})/i)) && MON.includes(x[2].toLowerCase()))
    [y, mo, d] = [+x[3], MON.indexOf(x[2].toLowerCase()) + 1, +x[1]]
  else return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

export function importBrokerHoldings(
  db: Db,
  opts: { personId: number; fileName: string; data: Buffer; asOf?: string }
): ImportResult {
  const { platform, rows, asOf: statedOn } = parseBrokerHoldings(opts.data)
  if (rows.length === 0)
    throw new Error(
      'No holdings with a buy price found. Expected columns like "ISIN" or "Symbol", "Quantity" and "Average price" (or "Invested value").'
    )
  const held = listHoldings(db, opts.personId).filter((h) => !['EPF', 'INSURANCE'].includes(h.assetClass))
  if (held.length === 0)
    throw new Error('Import a CAS statement for this person first; buy prices are added to the holdings it lists.')
  const instruments = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const listings = new Map(
    db
      .select()
      .from(schema.nseListings)
      .all()
      .map((l) => [l.symbol.toUpperCase(), l.isin])
  )
  // Long-term quantities are as on the statement's date, not the day it is imported.
  const todayIso = new Date().toISOString().slice(0, 10)
  const asOf = opts.asOf ?? (statedOn && statedOn <= todayIso ? statedOn : todayIso)

  // Which held instrument a row is: by ISIN, then ticker, then name.
  const find = (r: BrokerHoldingRow) => {
    if (r.isin) {
      const byIsin = held.filter((h) => h.isin === r.isin)
      if (byIsin.length) return byIsin
    }
    if (r.symbol) {
      const s = r.symbol.toUpperCase()
      const isin = listings.get(s)
      const bySymbol = held.filter((h) => {
        const i = instruments.get(h.instrumentId)!
        return (isin && h.isin === isin) || [i.symbolNse, i.symbolBse, i.tickerUs].some((x) => x?.toUpperCase() === s)
      })
      if (bySymbol.length) return bySymbol
    }
    let best: { score: number; rows: typeof held } = { score: 0, rows: [] }
    for (const h of held) {
      const i = instruments.get(h.instrumentId)!
      const score = Math.max(
        nameSimilarity(r.name, h.instrumentName),
        i.schemeName ? nameSimilarity(r.name, i.schemeName) : 0
      )
      if (score > best.score) best = { score, rows: [h] }
      else if (score === best.score && score > 0) best.rows.push(h)
    }
    return best.score >= 0.75 ? best.rows : []
  }

  return db.transaction((tx) => {
    const batch = tx
      .insert(schema.importBatches)
      .values({ kind: 'BROKER_HOLDINGS', fileName: opts.fileName, personId: opts.personId })
      .returning({ id: schema.importBatches.id })
      .get()
    const set: string[] = []
    const unmatched: string[] = []
    for (const r of rows) {
      const matches = find(r)
      if (matches.length === 0) {
        unmatched.push(r.name)
        continue
      }
      const avg = r.avgCost ?? (r.invested && r.quantity ? r.invested / r.quantity : null)
      if (!avg) {
        unmatched.push(r.name)
        continue
      }
      // The account this broker's file is about, when the person has it; else any account.
      const onPlatform = matches.filter((m) => m.platform === platform)
      const targets = onPlatform.length ? onPlatform : matches.length === 1 ? matches : []
      const accountIds = targets.length ? [...new Set(targets.map((t) => t.accountId))] : [0]
      for (const accountId of accountIds) {
        const values = {
          personId: opts.personId,
          accountId,
          instrumentId: matches[0].instrumentId,
          avgCost: avg,
          quantity: r.quantity,
          longTermQty: r.longTermQty,
          asOf,
          source: 'BROKER' as const,
          importBatchId: batch.id
        }
        tx.delete(schema.costBasis)
          .where(
            and(
              eq(schema.costBasis.personId, opts.personId),
              eq(schema.costBasis.accountId, accountId),
              eq(schema.costBasis.instrumentId, values.instrumentId),
              eq(schema.costBasis.source, 'BROKER')
            )
          )
          .run()
        tx.insert(schema.costBasis).values(values).run()
      }
      set.push(matches[0].instrumentName)
    }
    const result: ImportResult = {
      batchId: batch.id,
      kind: 'BROKER_HOLDINGS',
      fileName: opts.fileName,
      accountsCreated: 0,
      instrumentsCreated: 0,
      transactionsAdded: 0,
      transactionsSkipped: 0,
      snapshotsAdded: set.length,
      warnings: unmatched.length
        ? [
            `${unmatched.length} line${unmatched.length === 1 ? '' : 's'} in the file match no holding of this person: ${unmatched.slice(0, 6).join(', ')}${unmatched.length > 6 ? '…' : ''}`
          ]
        : [],
      notes: [
        `Buy prices added for ${set.length} holding${set.length === 1 ? '' : 's'}${platform ? ` (${platform.toLowerCase()} file)` : ''}.`
      ]
    }
    tx.update(schema.importBatches)
      .set({ summaryJson: JSON.stringify(result) })
      .where(eq(schema.importBatches.id, batch.id))
      .run()
    return result
  })
}

/** A buy price typed in for one holding; null removes it. */
export function setManualCost(
  db: Db,
  input: {
    personId: number
    accountId: number
    instrumentId: number
    avgCost: number | null
    heldSince?: string | null
  }
): void {
  const where = and(
    eq(schema.costBasis.personId, input.personId),
    eq(schema.costBasis.accountId, input.accountId),
    eq(schema.costBasis.instrumentId, input.instrumentId),
    eq(schema.costBasis.source, 'MANUAL')
  )
  db.delete(schema.costBasis).where(where).run()
  if (input.avgCost !== null) {
    if (!(input.avgCost > 0)) throw new Error('Enter a buy price above zero')
    db.insert(schema.costBasis)
      .values({
        personId: input.personId,
        accountId: input.accountId,
        instrumentId: input.instrumentId,
        avgCost: input.avgCost,
        heldSince: input.heldSince ?? null,
        source: 'MANUAL',
        asOf: new Date().toISOString().slice(0, 10)
      })
      .run()
  }
}

/** INDmoney's "Holding Since" and average price for each US holding just imported. */
export function saveIndmoneyDates(
  db: Db,
  personId: number,
  batchId: number,
  report: { holdings: { symbol: string; heldSince: string | null; quantity: number; avgCost: number }[]; asOf: string }
): void {
  const account = db
    .select()
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.personId, personId),
        eq(schema.accounts.platform, 'INDMONEY'),
        eq(schema.accounts.kind, 'US_BROKER')
      )
    )
    .get()
  if (!account) return
  for (const h of report.holdings) {
    const inst = db
      .select()
      .from(schema.instruments)
      .where(and(eq(schema.instruments.tickerUs, h.symbol), eq(schema.instruments.assetClass, 'EQUITY_US')))
      .get()
    if (!inst) continue
    const key = and(
      eq(schema.costBasis.personId, personId),
      eq(schema.costBasis.accountId, account.id),
      eq(schema.costBasis.instrumentId, inst.id),
      eq(schema.costBasis.source, 'BROKER')
    )
    db.delete(schema.costBasis).where(key).run()
    db.insert(schema.costBasis)
      .values({
        personId,
        accountId: account.id,
        instrumentId: inst.id,
        avgCost: h.avgCost,
        quantity: h.quantity,
        heldSince: h.heldSince,
        asOf: report.asOf,
        source: 'BROKER',
        importBatchId: batchId
      })
      .run()
  }
}
