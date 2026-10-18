import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { detectImportKind } from '../src/main/importers/detect'

const dir = mkdtempSync(join(tmpdir(), 'fp-detect-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const sheet = (name: string, rows: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  const file = join(dir, name)
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  return file
}

describe('which report an emailed file is', () => {
  it('knows a Zerodha tradebook by its columns, whatever it is called', () => {
    const file = join(dir, 'report.csv')
    copyFileSync('tests/fixtures/demo/me-zerodha-tradebook.csv', file)
    expect(detectImportKind(file)).toBe('ZERODHA_TRADEBOOK')
  })

  it('knows a holdings statement', () => {
    const file = sheet('holdings.xlsx', [
      ['Client ID', 'AB1234'],
      [],
      ['Symbol', 'ISIN', 'Quantity Available', 'Average Price', 'Previous Closing Price'],
      ['HDFCBANK', 'INE040A01034', 10, 1450.5, 1900]
    ])
    expect(detectImportKind(file)).toBe('BROKER_HOLDINGS')
  })

  it('skips files it does not read', () => {
    const ledger = sheet('ledger.xlsx', [['Particulars', 'Posting Date', 'Debit', 'Credit'], ['Funds added', '2026-10-01', 0, 5000]])
    expect(detectImportKind(ledger)).toBeNull()
    expect(detectImportKind(join(dir, 'contract-note.pdf'))).toBeNull()
  })
})
