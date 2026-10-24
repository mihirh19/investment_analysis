import XLSX from 'xlsx'
import type { CashFlow, DealRow, FoPosition, FpiMonth, MfCategoryMonth, StakeDisclosure } from '@shared/flows'

// Readers for the money-flow sources: NSE (FII/DII cash, F&O positions, deals, takeover
// disclosures), NSDL (foreign investors by month) and AMFI (mutual fund flows by category).

const MON: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
}
/** "23-Oct-2026" or "01-OCT-2026" → "2026-10-23". */
export function dmy(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec((s ?? '').trim())
  const mon = m && MON[m[2].toUpperCase()]
  return m && mon ? `${m[3]}-${mon}-${m[1].padStart(2, '0')}` : null
}
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** NSE's /api/fiidiiTradeReact: the latest day's buying, selling and net, in ₹ crore. */
export function parseFiiDii(json: unknown): CashFlow[] {
  if (!Array.isArray(json)) return []
  const out: CashFlow[] = []
  for (const r of json as Record<string, string>[]) {
    const date = dmy(r.date)
    const category = /FII|FPI/i.test(r.category ?? '') ? 'FII' : /DII/i.test(r.category ?? '') ? 'DII' : null
    const buy = num(r.buyValue)
    const sell = num(r.sellValue)
    const net = num(r.netValue)
    if (!date || !category || buy === null || sell === null) continue
    out.push({ date, category, buy, sell, net: net ?? buy - sell })
  }
  return out
}

/** One CSV line, honouring quotes. */
function csvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

const FO_COLUMNS: [keyof Omit<FoPosition, 'date' | 'client'>, RegExp][] = [
  ['futIdxLong', /^future index long/i],
  ['futIdxShort', /^future index short/i],
  ['futStkLong', /^future stock long/i],
  ['futStkShort', /^future stock short/i],
  ['callIdxLong', /^option index call long/i],
  ['putIdxLong', /^option index put long/i],
  ['callIdxShort', /^option index call short/i],
  ['putIdxShort', /^option index put short/i]
]

/** NSE's daily participant-wise open interest file: long and short contracts by type of trader. */
export function parseParticipantOi(csv: string, date: string): FoPosition[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const head = lines.findIndex((l) => /^"?client type/i.test(l))
  if (head < 0) return []
  const cols = csvLine(lines[head])
  const idx = FO_COLUMNS.map(([k, re]) => [k, cols.findIndex((c) => re.test(c))] as const)
  const out: FoPosition[] = []
  for (const l of lines.slice(head + 1)) {
    const r = csvLine(l)
    const client = r[0]
    if (!['Client', 'DII', 'FII', 'Pro'].includes(client)) continue
    const row = { date, client: client as FoPosition['client'] } as FoPosition
    for (const [k, i] of idx) row[k] = i >= 0 ? (num(r[i]) ?? 0) : 0
    out.push(row)
  }
  return out
}

/** The hidden form fields of an ASP.NET page, needed to ask it for another year. */
export function aspFormFields(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<input[^>]*type=["']hidden["'][^>]*>/gi)) {
    const name = /name=["']([^"']+)["']/.exec(m[0])?.[1]
    const value = /value=["']([^"']*)["']/.exec(m[0])?.[1] ?? ''
    if (name) out[name] = value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  }
  return out
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * NSDL's "FPI Net Investment Details (Calendar Year)": each month's net investment in ₹ crore by
 * asset. The table's rows are not closed properly, so it is read cell by cell: a month's name,
 * then its twelve figures (equity; three kinds of debt; hybrid; five kinds of mutual fund; AIF; total).
 */
export function parseNsdlYear(html: string): FpiMonth[] {
  const year = /Calendar Year\s*-\s*(\d{4})/i.exec(html)?.[1]
  const start = html.search(/id=["']rpt["']/)
  if (!year || start < 0) return []
  const cells = [...html.slice(start).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\*/g, '').trim()
  )
  const out: FpiMonth[] = []
  for (let i = 0; i < cells.length; i++) {
    const mi = MONTHS.indexOf(cells[i].toLowerCase())
    if (mi < 0) continue
    const v = cells.slice(i + 1, i + 13).map(num)
    if (v.length < 12 || v.some((x) => x === null)) continue
    const [eq, dGen, dVrr, dFar, hyb, mfEq, mfDebt, mfHyb, mfSol, mfOther, aif, total] = v as number[]
    out.push({
      month: `${year}-${String(mi + 1).padStart(2, '0')}`,
      equity: eq,
      debt: dGen + dVrr + dFar,
      hybrid: hyb,
      mutualFunds: mfEq + mfDebt + mfHyb + mfSol + mfOther,
      aif,
      total
    })
    i += 12
  }
  return out
}

/**
 * AMFI's monthly report (amMMMYYYYrepo.xls): for each category, schemes, folios, money raised and
 * redeemed, net inflow and assets, in ₹ crore. Groups are Debt, Equity, Hybrid, Index, ETFs…
 */
export function parseAmfiMonthly(buf: Uint8Array, month: string): MfCategoryMonth[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null })
  const headIdx = rows.findIndex((r) => r.some((c) => /scheme name/i.test(String(c ?? ''))))
  if (headIdx < 0) return []
  const head = rows[headIdx].map((c) => String(c ?? '').toLowerCase())
  const col = (re: RegExp) => head.findIndex((h) => re.test(h))
  const c = {
    schemes: col(/no\. of schemes/),
    folios: col(/no\. of folios/),
    raised: col(/funds mobili[sz]ed/),
    redeemed: col(/repurchase|redemption/),
    net: col(/net inflow/),
    aum: col(/net assets under management/),
    avgAum: col(/average net assets/)
  }
  const out: MfCategoryMonth[] = []
  let group = ''
  for (const r of rows.slice(headIdx + 1)) {
    const tag = String(r[0] ?? '').trim()
    const name = String(r[1] ?? '').replace(/\*/g, '').trim()
    if (!name) continue
    // Upper-case Roman numerals start a group ("II Equity Schemes"); lower-case ones are categories.
    if (/^[IVX]+$/.test(tag) && r[2] === null) {
      group = name.replace(/\s*schemes?$/i, '').trim()
      continue
    }
    if (!/^[ivx]+$/.test(tag)) continue
    const net = num(r[c.net])
    if (net === null) continue
    out.push({
      month,
      group,
      category: name,
      schemes: num(r[c.schemes]) ?? 0,
      folios: num(r[c.folios]) ?? 0,
      raised: num(r[c.raised]) ?? 0,
      redeemed: num(r[c.redeemed]) ?? 0,
      net,
      aum: c.aum >= 0 ? num(r[c.aum]) : null
    })
  }
  return out
}

/** NSE's bulk or block deals history as CSV (?csv=true, which, unlike the JSON, isn't cut at 70 rows). */
export function parseDealsCsv(csv: string, kind: DealRow['kind']): DealRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const head = csvLine(lines[0]).map((h) => h.toLowerCase())
  const col = (re: RegExp) => head.findIndex((h) => re.test(h))
  const c = { date: col(/^date/), symbol: col(/^symbol/), name: col(/security name/), client: col(/client name/), side: col(/buy\s*\/\s*sell/), qty: col(/quantity/), price: col(/price/) }
  const out: DealRow[] = []
  for (const l of lines.slice(1)) {
    const r = csvLine(l)
    const date = dmy(r[c.date])
    const qty = num(r[c.qty])
    const price = num(r[c.price])
    const side = /buy/i.test(r[c.side] ?? '') ? 'BUY' : /sell/i.test(r[c.side] ?? '') ? 'SELL' : null
    if (!date || !r[c.symbol] || !side || qty === null || price === null) continue
    out.push({ date, kind, symbol: r[c.symbol].toUpperCase(), company: r[c.name] ?? '', client: r[c.client] ?? '', side, qty, price })
  }
  return out
}

/** NSE's takeover-code disclosures (SAST regulation 29): who bought or sold 5% or more, and after. */
export function parseSast(json: unknown): StakeDisclosure[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out: StakeDisclosure[] = []
  for (const r of data as Record<string, string | null>[]) {
    const id = r.application_no
    const date = dmy(r.timestamp ?? r.sysTime)
    if (!id || !date || !r.symbol) continue
    const buy = /acq/i.test(r.acqSaleType ?? '')
    out.push({
      id: String(id),
      date,
      symbol: r.symbol.toUpperCase(),
      company: r.company ?? r.symbol,
      party: (r.acquirerName ?? '').replace(/\s+/g, ' ').trim(),
      side: buy ? 'BUY' : 'SELL',
      shares: num(buy ? r.noOfShareAcq : r.noOfShareSale),
      changePct: num(buy ? r.totAcqShare : r.totSaleShare),
      afterPct: num(r.totAftShare),
      mode: r.acquisitionMode ?? null,
      promoter: r.promoterType === 'Y'
    })
  }
  return out
}
