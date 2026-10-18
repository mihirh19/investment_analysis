import { readFileSync } from 'node:fs'
import type { ImportKind } from '@shared/types'
import { parseBrokerHoldings } from './brokerHoldings'
import { GROWW_HEADERS, indmoneyReportKind, readTableFile, ZERODHA_HEADERS } from './trades'

/**
 * Which importer a broker's report file is for, from its columns rather than its name: what arrives
 * by email is often called "report.xlsx". Null for files the app doesn't read (tax P&L, ledgers…).
 */
export function detectImportKind(filePath: string): ImportKind | null {
  if (!/\.(xlsx|xls|csv)$/i.test(filePath)) return null
  const data = readFileSync(filePath)
  if (/\.xlsx?$/i.test(filePath) && indmoneyReportKind(data)) return 'INDMONEY_US'
  const has = (headers: string[][]) => {
    try {
      return readTableFile(filePath, headers).rows.length > 0
    } catch {
      return false
    }
  }
  // Zerodha's tradebook: symbol, trade date, trade type, quantity, price.
  if (has(ZERODHA_HEADERS)) return 'ZERODHA_TRADEBOOK'
  if (has(GROWW_HEADERS)) return 'GROWW_ORDERS'
  // A holdings file: units and average buy price per security.
  try {
    if (parseBrokerHoldings(data).rows.length > 0) return 'BROKER_HOLDINGS'
  } catch {
    /* not a holdings file */
  }
  return null
}
