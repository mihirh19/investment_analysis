import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, schema, type Db } from '../src/main/db'
import { createServices, type Services } from '../src/main/services'

// The PDF helper (casparser.exe) takes the password on stdin and answers in JSON. Here Node plays
// it: the "PDF" is a small script that opens only with the password named in its .pw file, and
// writes every password it was offered to tried.log.

let dir: string
let db: Db
let close: () => void
let svc: Services
let n = 0

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-pw-'))
  const opened = openDatabase(join(dir, 'test.db'), 'b'.repeat(64), resolve('drizzle'))
  db = opened.db
  close = () => opened.sqlite.close()
  svc = createServices({ db, casparserExe: process.execPath, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) })
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const CAS = {
  statement_period: { from: '01-Jan-2024', to: '31-Mar-2024' },
  file_type: 'CAMS',
  cas_type: 'DETAILED',
  folios: [
    {
      folio: '1234567 / 89',
      amc: 'PPFAS Mutual Fund',
      schemes: [
        {
          scheme: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
          isin: 'INF879O01027',
          amfi: '122639',
          type: 'EQUITY',
          rta: 'CAMS',
          close: '10.000',
          valuation: { date: '2024-03-31', nav: '70.00', cost: '500.00', value: '700.00' },
          transactions: [{ date: '2024-01-10', description: 'SIP Purchase', amount: '500.00', units: '10.000', nav: '50.00', balance: '10.000', type: 'PURCHASE_SIP' }]
        }
      ]
    }
  ]
}

/** A "PDF" that opens with `password`; its content differs per file so each imports as its own. */
function lockedPdf(password: string): string {
  const file = join(dir, `file${++n}.js`)
  const cas = { ...CAS, statement_period: { from: '01-Jan-2024', to: `${String(n).padStart(2, '0')}-Mar-2024` } }
  writeFileSync(file.replace(/\.js$/, '.pw'), password)
  writeFileSync(
    file,
    `const fs = require('fs'), path = require('path')
let pw = ''
process.stdin.on('data', (d) => (pw += d)).on('end', () => {
  pw = pw.trim()
  fs.appendFileSync(path.join(__dirname, 'tried.log'), pw + '\\n')
  const ok = fs.readFileSync(__filename.replace(/\\.js$/, '.pw'), 'utf8').trim()
  console.log(JSON.stringify(pw === ok ? { ok: true, data: ${JSON.stringify(cas)} } : { ok: false, error: 'wrong_password', message: 'Wrong password' }))
})
`
  )
  return file
}
const tried = () => {
  try {
    return readFileSync(join(dir, 'tried.log'), 'utf8').trim().split('\n')
  } catch {
    return []
  }
}
const cas = (filePath: string, extra: { password?: string; rememberPassword?: boolean; personId?: number } = {}) =>
  svc.runImport({ kind: 'CAS_PDF', personId: extra.personId ?? 1, filePath, ...extra })

describe('PANs and the passwords of PDFs', () => {
  it('saves a PAN encrypted, shows only its end, and rejects one that is not a PAN', () => {
    expect(svc.getPanInfo().map((p) => [p.name, p.saved])).toEqual([['Me', false], ['Dad', false]])
    expect(() => svc.setPersonPan(1, 'ABC123')).toThrow(/five letters/)
    const after = svc.setPersonPan(1, ' abcde 1234f ')
    expect(after[0]).toEqual({ personId: 1, name: 'Me', saved: true, ending: '234F' })
    expect(JSON.stringify(after)).not.toContain('ABCDE')
    expect(db.select().from(schema.settings).where(eq(schema.settings.key, 'person_pan:1')).get()?.value).toBe('enc:ABCDE1234F')
    // Empty removes it.
    expect(svc.setPersonPan(1, '')[0].saved).toBe(false)
  })

  it('says what to do when there is no password to try', async () => {
    await expect(cas(lockedPdf('whatever'))).rejects.toThrow(/Saving your PAN/)
    expect(tried()).toEqual([])
  })

  it('opens a PDF with the PAN by itself: capitals first, then lower case', async () => {
    svc.setPersonPan(1, 'ABCDE1234F')
    await cas(lockedPdf('ABCDE1234F'))
    await cas(lockedPdf('abcde1234f'))
    expect(tried()).toEqual(['ABCDE1234F', 'ABCDE1234F', 'abcde1234f'])
  })

  it('tries the other people’s PANs too (a parent’s statement in your mailbox)', async () => {
    svc.setPersonPan(1, 'ABCDE1234F')
    svc.setPersonPan(2, 'PQRST6789U')
    await cas(lockedPdf('PQRST6789U'), { personId: 1 })
    expect(tried()).toEqual(['ABCDE1234F', 'abcde1234f', 'PQRST6789U'])
  })

  it('opens a file with its own password once, and remembers it for the next files', async () => {
    svc.setPersonPan(1, 'ABCDE1234F')
    // The first file has a password of its own; typed once and remembered.
    await cas(lockedPdf('camsPass#1'), { password: 'camsPass#1', rememberPassword: true })
    // A second file with the same password needs nothing typed.
    await cas(lockedPdf('camsPass#1'))
    // A third file with yet another password: typed, and then it is remembered as well.
    await cas(lockedPdf('other-one'), { password: 'other-one', rememberPassword: true })
    await cas(lockedPdf('other-one'))
    await cas(lockedPdf('camsPass#1'))
  })

  it('does not remember a typed password unless asked, and says how many it tried when none opens', async () => {
    svc.setPersonPan(1, 'ABCDE1234F')
    await cas(lockedPdf('typed-only'), { password: 'typed-only' })
    await expect(cas(lockedPdf('typed-only'))).rejects.toThrow(/none of the 2 tried/)
    // A wrong password stops with a clear message too.
    await expect(cas(lockedPdf('right'), { password: 'wrong' })).rejects.toThrow(/Wrong PDF password/)
  })
})
