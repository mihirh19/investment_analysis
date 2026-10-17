import { readFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { PLATFORM_LABELS, type AssetClass, type Platform, type TxnType } from '@shared/types'
import { emptyBundle, makeOccurrenceKeyer, type ImportBundle, type NormAccount, type NormInstrument } from './bundle'
import { normalizeHeader, parseDate, parseNumber } from './parse'
import { dematClass, isEtfName } from './isin'

export type Row = Record<string, unknown>

/** Reads CSV/XLS/XLSX into rows keyed by normalized header, locating the header row automatically. */
export function readTableFile(filePath: string, requiredHeaders: string[][]): { rows: Row[]; headers: string[] } {
  const wb = XLSX.read(readFileSync(filePath), { type: 'buffer', cellDates: true })
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '', raw: true })
    const found = findTable(grid, requiredHeaders)
    if (found) return found
  }
  throw new Error(
    `Could not find the expected columns (${requiredHeaders.map((a) => a[0]).join(', ')}). Is this the right file?`
  )
}

export function findTable(grid: unknown[][], requiredHeaders: string[][]): { rows: Row[]; headers: string[] } | null {
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const headers = grid[r].map(normalizeHeader)
    const hasAll = requiredHeaders.every((aliases) => aliases.some((a) => headers.includes(a)))
    if (!hasAll) continue
    const rows: Row[] = []
    for (const line of grid.slice(r + 1)) {
      if (line.every((c) => c === '' || c === null || c === undefined)) continue
      const row: Row = {}
      headers.forEach((h, i) => {
        if (h && !(h in row)) row[h] = line[i]
      })
      rows.push(row)
    }
    return { rows, headers }
  }
  return null
}

const pick = (row: Row, aliases: string[]): unknown => {
  for (const a of aliases) if (a in row && row[a] !== '' && row[a] !== null) return row[a]
  return undefined
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())

function stockInstrument(opts: {
  isin: string | null
  symbol: string
  exchange: string
  name?: string
  market: 'IN' | 'US'
}): NormInstrument {
  const { isin, symbol, exchange, market } = opts
  if (market === 'US') {
    return {
      key: isin ? `ISIN:${isin}` : `US:${symbol}`,
      isin,
      name: opts.name || symbol,
      assetClass: 'EQUITY_US',
      tickerUs: symbol,
      currency: 'USD'
    }
  }
  const assetClass: AssetClass = isin ? dematClass(isin, opts.name || symbol) : 'EQUITY_IN'
  const onBse = exchange.toUpperCase() === 'BSE'
  return {
    key: isin ? `ISIN:${isin}` : `NSE:${symbol}`,
    isin,
    name: opts.name || symbol,
    assetClass,
    symbolNse: onBse ? null : symbol,
    symbolBse: onBse ? symbol : null,
    currency: 'INR'
  }
}

function brokerAccount(platform: Platform, market: 'IN' | 'US'): NormAccount {
  const label = PLATFORM_LABELS[platform]
  return market === 'US'
    ? {
        key: `${platform}:US`,
        platform,
        kind: 'US_BROKER',
        name: `${label} US stocks`,
        externalId: null,
        currency: 'USD'
      }
    : { key: `${platform}:IN`, platform, kind: 'DEMAT', name: `${label} demat`, externalId: null, currency: 'INR' }
}

// ---------------- Zerodha Console tradebook ----------------

export const ZERODHA_HEADERS = [['symbol'], ['trade date'], ['trade type'], ['quantity'], ['price']]

export function mapZerodhaTradebook(rows: Row[]): ImportBundle {
  const b = emptyBundle()
  const acct = brokerAccount('ZERODHA', 'IN')
  b.accounts.push(acct)
  const instruments = new Map<string, NormInstrument>()
  const keyer = makeOccurrenceKeyer()
  let skippedSegments = 0

  rows.forEach((row, i) => {
    const segment = str(row['segment']).toUpperCase()
    // EQ: stocks and ETFs. MF: Coin mutual funds (symbol is the scheme name).
    const isFund = segment === 'MF'
    if (segment && segment !== 'EQ' && !isFund) {
      skippedSegments++
      return
    }
    const symbol = str(row['symbol']).toUpperCase()
    const date = parseDate(row['trade date'])
    const side = str(row['trade type']).toLowerCase()
    const qty = parseNumber(row['quantity'])
    const price = parseNumber(row['price'])
    if (!symbol || !date || !qty || price === null || (side !== 'buy' && side !== 'sell')) {
      b.warnings.push(`Row ${i + 2}: skipped (missing symbol, date, side, quantity or price)`)
      return
    }
    const isin = str(row['isin']).toUpperCase() || null
    const instr: NormInstrument = isFund
      ? {
          // Keyed like the CAS's fund entries, so the trades join the same holding.
          key: isin ? `ISIN:${isin}` : `NAME:${symbol}`,
          isin,
          name: str(row['symbol']),
          assetClass: isEtfName(symbol) ? 'ETF' : 'MF',
          currency: 'INR'
        }
      : stockInstrument({ isin, symbol, exchange: str(row['exchange']), market: 'IN' })
    if (!instruments.has(instr.key)) instruments.set(instr.key, instr)

    const sign = side === 'buy' ? 1 : -1
    const tradeId = str(row['trade id'])
    b.transactions.push({
      accountKey: acct.key,
      instrumentKey: instr.key,
      date,
      type: side === 'buy' ? 'BUY' : 'SELL',
      quantity: sign * Math.abs(qty),
      price,
      amount: -sign * Math.abs(qty) * price,
      fees: 0,
      currency: 'INR',
      description: null,
      source: 'TRADEBOOK_ZERODHA',
      externalId: tradeId ? `${str(row['exchange'])}:${date}:${tradeId}` : keyer(date, symbol, side, qty, price)
    })
  })

  if (skippedSegments) b.warnings.push(`${skippedSegments} F&O, currency or commodity rows were skipped`)
  b.instruments.push(...instruments.values())
  return b
}

// ---------------- Groww stock order history ----------------

const G = {
  name: ['stock name', 'company name', 'scrip name', 'name'],
  symbol: ['symbol', 'nse symbol', 'trading symbol', 'ticker'],
  isin: ['isin'],
  side: ['type', 'buy sell', 'transaction type', 'order type', 'side', 'trade type'],
  qty: ['quantity', 'qty'],
  price: ['price', 'avg price', 'average price', 'execution price', 'trade price', 'rate'],
  value: ['value', 'amount', 'total value', 'trade value', 'net amount'],
  exchange: ['exchange'],
  date: ['execution date and time', 'execution date', 'trade date', 'order date', 'date', 'date time'],
  status: ['order status', 'status'],
  id: ['exchange order id', 'order id', 'trade id', 'exchange trade id']
}

export const GROWW_HEADERS = [G.side, G.qty, G.date, [...G.isin, ...G.symbol, ...G.name]]

export function mapGrowwOrders(rows: Row[]): ImportBundle {
  const b = emptyBundle()
  const acct = brokerAccount('GROWW', 'IN')
  b.accounts.push(acct)
  const instruments = new Map<string, NormInstrument>()
  const keyer = makeOccurrenceKeyer()
  let notExecuted = 0

  rows.forEach((row, i) => {
    const status = str(pick(row, G.status)).toLowerCase()
    if (status && !/(execut|complet|success|traded)/.test(status)) {
      notExecuted++
      return
    }
    const side = str(pick(row, G.side)).toLowerCase()
    const isBuy = side.startsWith('b')
    const isSell = side.startsWith('s')
    const qty = parseNumber(pick(row, G.qty))
    const date = parseDate(pick(row, G.date))
    let price = parseNumber(pick(row, G.price))
    const value = parseNumber(pick(row, G.value))
    if ((price === null || price === 0) && value !== null && qty) price = Math.abs(value / qty)
    const isin = str(pick(row, G.isin)).toUpperCase() || null
    const name = str(pick(row, G.name))
    const symbol = str(pick(row, G.symbol)).toUpperCase() || isin || name.toUpperCase()

    if ((!isBuy && !isSell) || !qty || !date || price === null || !symbol) {
      b.warnings.push(`Row ${i + 2}: skipped (missing side, quantity, date or price)`)
      return
    }
    const instr = stockInstrument({ isin, symbol, exchange: str(pick(row, G.exchange)), name, market: 'IN' })
    if (!instruments.has(instr.key)) instruments.set(instr.key, instr)

    const sign = isBuy ? 1 : -1
    const orderId = str(pick(row, G.id))
    b.transactions.push({
      accountKey: acct.key,
      instrumentKey: instr.key,
      date,
      type: isBuy ? 'BUY' : 'SELL',
      quantity: sign * Math.abs(qty),
      price,
      amount: -sign * Math.abs(qty) * price,
      fees: 0,
      currency: 'INR',
      description: null,
      source: 'ORDERS_GROWW',
      externalId: orderId ? `${orderId}:${keyer(orderId)}` : keyer(date, symbol, side, qty, price)
    })
  })

  if (notExecuted) b.warnings.push(`${notExecuted} cancelled/rejected orders were skipped`)
  b.instruments.push(...instruments.values())
  return b
}

// ---------------- Generic trades template (INDmoney US, others) ----------------

export const GENERIC_HEADERS = [['date'], ['type'], ['symbol'], ['quantity'], ['price']]
export const GENERIC_TEMPLATE =
  'date,type,symbol,name,isin,quantity,price,fees,currency,market\n' +
  '2024-03-15,BUY,AAPL,Apple Inc,,2.5,172.40,0,USD,US\n' +
  '2024-06-20,DIVIDEND,AAPL,Apple Inc,,0,0.60,0,USD,US\n' +
  '2024-04-02,BUY,INFY,Infosys,INE009A01021,10,1450,15.5,INR,IN\n'

export function mapGenericTrades(rows: Row[], platform: Platform): ImportBundle {
  const b = emptyBundle()
  const instruments = new Map<string, NormInstrument>()
  const accounts = new Map<string, NormAccount>()
  const keyer = makeOccurrenceKeyer()

  rows.forEach((row, i) => {
    const date = parseDate(row['date'])
    const type = str(row['type']).toUpperCase() as TxnType
    const symbol = str(row['symbol']).toUpperCase()
    const qty = parseNumber(row['quantity']) ?? 0
    const price = parseNumber(row['price'])
    const fees = parseNumber(row['fees']) ?? 0
    const currency = (str(row['currency']) || 'INR').toUpperCase()
    const market: 'IN' | 'US' =
      (str(row['market']).toUpperCase() || (currency === 'USD' ? 'US' : 'IN')) === 'US' ? 'US' : 'IN'

    if (!date || !symbol || price === null || !['BUY', 'SELL', 'DIVIDEND'].includes(type)) {
      b.warnings.push(`Row ${i + 2}: skipped (needs date, type BUY/SELL/DIVIDEND, symbol, price)`)
      return
    }
    if (type !== 'DIVIDEND' && !qty) {
      b.warnings.push(`Row ${i + 2}: skipped (quantity is required for ${type})`)
      return
    }

    const acct = brokerAccount(platform, market)
    if (!accounts.has(acct.key)) accounts.set(acct.key, acct)
    const instr = stockInstrument({
      isin: str(row['isin']).toUpperCase() || null,
      symbol,
      exchange: 'NSE',
      name: str(row['name']),
      market
    })
    if (!instruments.has(instr.key)) instruments.set(instr.key, instr)

    const q = Math.abs(qty)
    const quantity = type === 'BUY' ? q : type === 'SELL' ? -q : 0
    // For DIVIDEND rows `price` is the total amount received.
    const amount = type === 'BUY' ? -q * price : type === 'SELL' ? q * price : Math.abs(price)
    b.transactions.push({
      accountKey: acct.key,
      instrumentKey: instr.key,
      date,
      type,
      quantity,
      price: type === 'DIVIDEND' ? null : price,
      amount,
      fees,
      currency,
      description: null,
      source: `GENERIC_${platform}`,
      externalId: keyer(date, type, symbol, qty, price, fees)
    })
  })

  b.accounts.push(...accounts.values())
  b.instruments.push(...instruments.values())
  return b
}

// ---------------- INDmoney US stocks (DriveWealth reports) ----------------

/**
 * INDmoney's US reports are .xls files with an "Account Details" block above the table:
 * ORDER_BOOK (every buy and sell: symbol, execution time, quantity, price $, brokerage $) and
 * HOLDINGS_BOOK (symbol, "Holding Since", quantity, average price $). Which one a file is, if either.
 */
export function indmoneyReportKind(data: Buffer): 'ORDERS' | 'HOLDINGS' | null {
  try {
    const wb = XLSX.read(data, { type: 'buffer', sheetRows: 12 })
    if (wb.SheetNames.includes('ORDER_BOOK')) return 'ORDERS'
    if (wb.SheetNames.includes('HOLDINGS_BOOK')) return 'HOLDINGS'
  } catch {
    /* not a spreadsheet */
  }
  return null
}

/** The table under the account block: rows keyed by normalized header. */
function indmoneyTable(data: Buffer, sheet: string, first: string): { rows: Row[]; asOf: string | null } {
  const wb = XLSX.read(data, { type: 'buffer', raw: true })
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '', raw: true })
  const h = grid.findIndex((r) => normalizeHeader(r[0]) === first || r.some((c) => normalizeHeader(c) === first))
  if (h < 0) throw new Error(`This INDmoney report has no "${first}" table`)
  const headers = grid[h].map(normalizeHeader)
  const rows: Row[] = []
  for (const line of grid.slice(h + 1)) {
    if (!line.some((c) => String(c).trim())) continue
    if (/^disclaimer/i.test(String(line[0]))) break
    rows.push(Object.fromEntries(headers.map((k, i) => [k, line[i]])))
  }
  const dateRow = grid.slice(0, h).find((r) => /holdings as on|period to/i.test(String(r[0])))
  return { rows, asOf: dateRow ? parseDate(dateRow[1]) : null }
}

/** INDmoney order report → US buys and sells. */
export function mapIndmoneyOrders(data: Buffer): ImportBundle {
  const { rows } = indmoneyTable(data, 'ORDER_BOOK', 'stock symbol')
  const generic: Row[] = rows
    .filter((r) => /^(buy|sell)$/i.test(str(r['transaction type'])))
    .map((r) => ({
      date: r['order execution time'] || r['order placed time'],
      type: str(r['transaction type']).toUpperCase(),
      symbol: r['stock symbol'],
      name: r['stock name'],
      quantity: r['quantity'],
      price: r['price'],
      fees: r['brokerage'] ?? 0,
      currency: 'USD',
      market: 'US'
    }))
  return mapGenericTrades(generic, 'INDMONEY')
}

export interface IndmoneyHolding {
  symbol: string
  heldSince: string | null
  quantity: number
  avgCost: number
}

/** INDmoney holdings report → units and cost on the report date, plus each holding's start date. */
export function mapIndmoneyHoldings(data: Buffer): { bundle: ImportBundle; holdings: IndmoneyHolding[]; asOf: string } {
  const { rows, asOf } = indmoneyTable(data, 'HOLDINGS_BOOK', 'stock symbol')
  const date = asOf ?? new Date().toISOString().slice(0, 10)
  const b = emptyBundle()
  const acct = brokerAccount('INDMONEY', 'US')
  b.accounts.push(acct)
  const holdings: IndmoneyHolding[] = []
  for (const r of rows) {
    const symbol = str(r['stock symbol']).toUpperCase()
    const quantity = parseNumber(r['quantity'])
    const avgCost = parseNumber(r['avg price'] ?? r['average price'])
    if (!symbol || !quantity || !avgCost) continue
    const instr = stockInstrument({ isin: null, symbol, exchange: 'NSE', name: '', market: 'US' })
    b.instruments.push(instr)
    b.snapshots.push({
      accountKey: acct.key,
      instrumentKey: instr.key,
      date,
      quantity,
      price: null,
      value: null,
      cost: quantity * avgCost,
      source: 'INDMONEY_HOLDINGS'
    })
    holdings.push({ symbol, heldSince: parseDate(r['holding since']), quantity, avgCost })
  }
  if (holdings.length === 0) b.warnings.push('No holdings found in this INDmoney report')
  return { bundle: b, holdings, asOf: date }
}
