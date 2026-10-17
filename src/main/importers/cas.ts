import { spawn } from 'node:child_process'
import { PLATFORM_LABELS, type Platform, type TxnType } from '@shared/types'
import { emptyBundle, rowHash, type ImportBundle, type NormAccount, type NormInstrument } from './bundle'
import { dematClass, isEtfName } from './isin'
import { parseDate, parseNumber } from './parse'

// ---- casparser JSON (by_alias) — see tools/casparser and casparser/types.py ----

type Num = string | number | null | undefined

interface CasTxn {
  date: string
  description: string
  amount: Num
  units: Num
  nav: Num
  balance: Num
  type: string
}
interface CasScheme {
  scheme: string
  isin: string | null
  amfi: string | null
  type: string | null
  rta: string
  close: Num
  valuation: { date: string; nav: Num; cost: Num; value: Num }
  transactions: CasTxn[]
}
interface CasFolio {
  folio: string
  amc: string
  schemes: CasScheme[]
}
export interface CamsCas {
  statement_period: { from: string; to: string }
  folios: CasFolio[]
  file_type: 'CAMS' | 'KFINTECH'
  cas_type: 'DETAILED' | 'SUMMARY'
  parse_warnings?: string[]
}

interface DematEquity {
  name: string | null
  isin: string
  num_shares: Num
  price: Num
  value: Num
  symbol: string | null
  exchange: string | null
}
interface DematMf {
  name: string | null
  isin: string
  amfi: string | null
  type: string | null
  balance: Num
  nav: Num
  value: Num
  total_cost: Num
  folio: string | null
}
interface DematBond {
  name: string | null
  isin: string
  num_bonds: Num
  value: Num
  market_price: Num
}
interface DematAccount {
  name: string
  type: string
  dp_id: string | null
  client_id: string | null
  equities: DematEquity[]
  mutual_funds: DematMf[]
  bonds?: DematBond[]
}
export interface DepositoryCas {
  statement_period: { from: string; to: string }
  accounts: DematAccount[]
  file_type: 'NSDL' | 'CDSL'
  nps?: {
    pran: string | null
    schemes: { scheme: string; tier: string | null; units: Num; nav: Num; value: Num }[]
  } | null
  parse_warnings?: string[]
}

export type CasJson = CamsCas | DepositoryCas

export class CasHelperError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** Runs the bundled casparser.exe. The password goes over stdin, never argv. */
export function runCasparser(
  exePath: string,
  pdfPath: string,
  password: string,
  timeoutMs = 120_000
): Promise<CasJson> {
  return runHelper<CasJson>(exePath, [pdfPath], password, timeoutMs)
}

/** Every page's text from any PDF (RC, insurance policy, card statement), via the same helper. */
export async function runPdfText(exePath: string, pdfPath: string, password = '', timeoutMs = 60_000): Promise<string[]> {
  return (await runHelper<{ pages: string[] }>(exePath, ['--text', pdfPath], password, timeoutMs)).pages
}

function runHelper<T>(exePath: string, args: string[], password: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, { windowsHide: true })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new CasHelperError('timeout', 'Reading the PDF took too long'))
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new CasHelperError('helper_missing', `Could not start casparser.exe: ${e.message}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
      const text = Buffer.concat(out).toString('utf8').trim()
      let payload: { ok: boolean; data?: T; error?: string; message?: string }
      try {
        payload = JSON.parse(text)
      } catch {
        const stderr = Buffer.concat(err).toString('utf8').trim().slice(-500)
        return reject(new CasHelperError('internal', `Unexpected output from casparser.exe. ${stderr}`))
      }
      if (payload.ok && payload.data) resolve(payload.data)
      else reject(new CasHelperError(payload.error ?? 'internal', payload.message ?? 'Unknown error'))
    })

    child.stdin.end(password + '\n')
  })
}

// ---- mapping ----

const num = (v: Num): number | null => (v === null || v === undefined ? null : parseNumber(String(v)))

export function platformFromBroker(name: string): Platform {
  const n = name.toUpperCase()
  if (n.includes('ZERODHA')) return 'ZERODHA'
  if (n.includes('GROWW') || n.includes('NEXTBILLION')) return 'GROWW'
  if (n.includes('INDMONEY') || n.includes('INDSTOCKS') || n.includes('FINWIZARD')) return 'INDMONEY'
  return 'DEMAT_OTHER'
}

const folioKey = (folio: string) => `FOLIO:${folio.replace(/\s+/g, '')}`

function mfAccount(folio: string, amc: string): NormAccount {
  const clean = folio.replace(/\s+/g, '')
  return {
    key: folioKey(folio),
    platform: 'MF_RTA',
    kind: 'MF_FOLIO',
    name: `${amc.replace(/\s+/g, ' ').trim()} · ${clean}`,
    externalId: clean,
    currency: 'INR'
  }
}

function mfInstrument(name: string, isin: string | null, amfi: string | null, type: string | null): NormInstrument {
  return {
    key: isin ? `ISIN:${isin}` : amfi ? `AMFI:${amfi}` : `NAME:${name}`,
    isin,
    name: name.replace(/\s+/g, ' ').trim(),
    assetClass: 'MF',
    amfiCode: amfi,
    mfType: type && type !== 'N/A' ? type : null,
    currency: 'INR'
  }
}

/** casparser TransactionType → our type + sign convention (buy cash < 0, sell/dividend cash > 0). */
function mapMfTxnType(t: string): TxnType {
  switch (t) {
    case 'PURCHASE':
    case 'PURCHASE_SIP':
    case 'SWITCH_IN':
    case 'SWITCH_IN_MERGER':
    case 'GIFT_IN':
    case 'SEGREGATION':
      return 'BUY'
    case 'DIVIDEND_REINVEST':
      return 'DIVIDEND_REINVEST'
    case 'REDEMPTION':
    case 'SWITCH_OUT':
    case 'SWITCH_OUT_MERGER':
    case 'GIFT_OUT':
      return 'SELL'
    case 'DIVIDEND_PAYOUT':
      return 'DIVIDEND'
    case 'STT_TAX':
    case 'STAMP_DUTY_TAX':
    case 'TDS_TAX':
      return 'TAX'
    default:
      return 'OTHER'
  }
}

function signedAmount(type: TxnType, casAmount: number): number {
  const abs = Math.abs(casAmount)
  switch (type) {
    case 'BUY':
    case 'DIVIDEND_REINVEST':
    case 'TAX':
      return -abs
    case 'SELL':
    case 'DIVIDEND':
      return abs
    default:
      return -casAmount // CAS prints money invested as positive
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** "ZERODHA BROKING LIMITED" + "CDSL Demat Account" → "Zerodha demat (CDSL)". */
function dematName(a: DematAccount): string {
  const depository = a.type.replace(' Demat Account', '')
  const platform = platformFromBroker(a.name)
  const broker = platform === 'DEMAT_OTHER' ? titleCase(a.name.trim()) : PLATFORM_LABELS[platform]
  return `${broker} demat (${depository})`
}

export function isDepositoryCas(j: CasJson): j is DepositoryCas {
  return Array.isArray((j as DepositoryCas).accounts)
}

export function mapCasJson(j: CasJson): ImportBundle {
  return isDepositoryCas(j) ? mapDepository(j) : mapCams(j)
}

function mapCams(j: CamsCas): ImportBundle {
  const b = emptyBundle()
  const source = `CAS_${j.file_type}`
  b.warnings.push(...(j.parse_warnings ?? []))
  const seenInstr = new Set<string>()

  for (const f of j.folios) {
    const acct = mfAccount(f.folio, f.amc)
    b.accounts.push(acct)
    for (const s of f.schemes) {
      const instr = mfInstrument(s.scheme, s.isin, s.amfi, s.type)
      if (!seenInstr.has(instr.key)) {
        b.instruments.push(instr)
        seenInstr.add(instr.key)
      }

      for (const t of s.transactions) {
        const date = parseDate(t.date)
        if (!date) {
          b.warnings.push(`Skipped a ${s.scheme} transaction with unreadable date "${t.date}"`)
          continue
        }
        const type = mapMfTxnType(t.type)
        const units = num(t.units) ?? 0
        const casAmount = num(t.amount) ?? 0
        b.transactions.push({
          accountKey: acct.key,
          instrumentKey: instr.key,
          date,
          type,
          quantity: units,
          price: num(t.nav),
          amount: signedAmount(type, casAmount),
          fees: 0,
          currency: 'INR',
          description: t.description?.trim() || null,
          source,
          externalId: rowHash(f.folio, instr.key, t.date, t.description, t.amount, t.units, t.balance)
        })
      }

      const date = parseDate(s.valuation.date) ?? parseDate(j.statement_period.to)
      const qty = num(s.close)
      if (date && qty !== null) {
        b.snapshots.push({
          accountKey: acct.key,
          instrumentKey: instr.key,
          date,
          quantity: qty,
          price: num(s.valuation.nav),
          value: num(s.valuation.value),
          cost: num(s.valuation.cost),
          source
        })
      }
    }
  }
  return b
}

function mapDepository(j: DepositoryCas): ImportBundle {
  const b = emptyBundle()
  const source = `CAS_${j.file_type}`
  b.warnings.push(...(j.parse_warnings ?? []))
  const date = parseDate(j.statement_period.to)
  if (!date) {
    b.warnings.push(`Could not read the statement date "${j.statement_period.to}"; holdings were not recorded`)
    return b
  }

  const instrByKey = new Map<string, NormInstrument>()
  const addInstr = (i: NormInstrument) => {
    if (!instrByKey.has(i.key)) instrByKey.set(i.key, i)
  }
  const acctByKey = new Map<string, NormAccount>()
  const addAcct = (a: NormAccount) => {
    if (!acctByKey.has(a.key)) acctByKey.set(a.key, a)
  }

  for (const a of j.accounts) {
    // "Mutual Fund Folios" lists units held directly with the RTAs (not in demat).
    // Key them by folio so they merge with the same folio from a CAMS/KFintech CAS.
    if (a.type === 'Mutual Fund Folios') {
      for (const mf of a.mutual_funds) {
        const folio = mf.folio ?? 'UNKNOWN'
        const acct = mfAccount(folio, mf.name?.split(' ')[0] ?? 'Mutual fund')
        addAcct(acct)
        const instr = mfInstrument(mf.name ?? mf.isin, mf.isin, mf.amfi, mf.type)
        addInstr(instr)
        pushSnapshot(acct.key, instr.key, mf.balance, mf.nav, mf.value, mf.total_cost)
      }
      continue
    }

    const externalId = [a.dp_id, a.client_id].filter(Boolean).join('-') || null
    const acct: NormAccount = {
      key: `DEMAT:${externalId ?? a.name}`,
      platform: platformFromBroker(a.name),
      kind: 'DEMAT',
      name: dematName(a),
      externalId,
      currency: 'INR'
    }
    addAcct(acct)

    for (const e of a.equities) {
      const onNse = !e.exchange || e.exchange.toUpperCase() === 'NSE'
      const instr: NormInstrument = {
        key: `ISIN:${e.isin}`,
        isin: e.isin,
        name: e.name?.trim() || e.symbol || e.isin,
        // The equity table also lists ETFs, government securities, NCDs and REIT/InvIT units.
        assetClass: dematClass(e.isin, e.name),
        symbolNse: onNse ? e.symbol : null,
        symbolBse: onNse ? null : e.symbol,
        currency: 'INR'
      }
      addInstr(instr)
      pushSnapshot(acct.key, instr.key, e.num_shares, e.price, e.value, null)
    }
    for (const mf of a.mutual_funds) {
      const instr = mfInstrument(mf.name ?? mf.isin, mf.isin, mf.amfi, mf.type)
      // CDSL lists ETF units (NIFTYBEES, MOM100) with the demat account's mutual funds; they trade
      // like shares and are priced live, as the broker shows them.
      if (isEtfName(instr.name)) instr.assetClass = 'ETF'
      addInstr(instr)
      pushSnapshot(acct.key, instr.key, mf.balance, mf.nav, mf.value, mf.total_cost)
    }
    for (const bond of a.bonds ?? []) {
      const instr: NormInstrument = {
        key: `ISIN:${bond.isin}`,
        isin: bond.isin,
        name: bond.name?.trim() || bond.isin,
        assetClass: 'BOND',
        currency: 'INR'
      }
      addInstr(instr)
      pushSnapshot(acct.key, instr.key, bond.num_bonds, bond.market_price, bond.value, null)
    }
  }

  if (j.nps && j.nps.schemes.length > 0) {
    const pran = j.nps.pran?.replace(/\s+/g, '') || null
    const acct: NormAccount = {
      key: `NPS:${pran ?? 'default'}`,
      platform: 'NPS',
      kind: 'NPS',
      name: pran ? `NPS · ${pran}` : 'NPS',
      externalId: pran,
      currency: 'INR'
    }
    addAcct(acct)
    for (const s of j.nps.schemes) {
      const name = s.tier ? `${s.scheme} (Tier ${s.tier})` : s.scheme
      const instr: NormInstrument = { key: `NPS:${name}`, isin: null, name, assetClass: 'NPS', currency: 'INR' }
      addInstr(instr)
      pushSnapshot(acct.key, instr.key, s.units, s.nav, s.value, null)
    }
  }

  b.accounts.push(...acctByKey.values())
  b.instruments.push(...instrByKey.values())
  return b

  function pushSnapshot(accountKey: string, instrumentKey: string, qty: Num, price: Num, value: Num, cost: Num) {
    const q = num(qty)
    if (q === null) return
    b.snapshots.push({
      accountKey,
      instrumentKey,
      date: date!,
      quantity: q,
      price: num(price),
      value: num(value),
      cost: num(cost),
      source
    })
  }
}
