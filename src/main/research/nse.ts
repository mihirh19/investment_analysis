import { unzipSync, strFromU8 } from 'fflate'
import { fetchWith, HttpError, type FetchFn } from '../market/http'
import type { Basis, DayQuote } from '@shared/research'
import type { IndexLevel } from '@shared/screener'

// NSE's public results lists and end-of-day files. Requests go one at a time with a pause between
// them; NSE is asked only what a person browsing its site would see.

export const NSE_API = 'https://www.nseindia.com/api'
export const NSE_ARCHIVES = 'https://nsearchives.nseindia.com'

/** One results filing listed by NSE (the XBRL file itself is fetched separately). */
export interface FilingRef {
  symbol: string
  periodEnd: string
  basis: Basis
  url: string
  filedAt: string | null
}

const MON: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
}
/** "31-Dec-2024" or "30-SEP-2026" (optionally with a time) → "2024-12-31". */
export function nseDate(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s?.trim() ?? '')
  const mon = m && MON[m[2].toUpperCase()]
  return m && mon ? `${m[3]}-${mon}-${m[1].padStart(2, '0')}` : null
}
/** "31-Dec-2024 21:39:43" → ISO, read as Indian time. */
function nseStamp(s: string | null | undefined): string | null {
  const d = nseDate(s)
  if (!d) return null
  const t = /(\d{2}):(\d{2}):(\d{2})/.exec(s ?? '')
  return `${d}T${t ? `${t[1]}:${t[2]}:${t[3]}` : '00:00:00'}+05:30`
}

const isXml = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/nsearchives\.nseindia\.com\/.+\.xml$/i.test(u)

/** Rows of /api/corporates-financial-results (filings to Dec 2024). */
export function parseLegacyList(json: unknown): FilingRef[] {
  if (!Array.isArray(json)) return []
  const out: FilingRef[] = []
  for (const r of json as Record<string, string | null>[]) {
    const periodEnd = nseDate(r.toDate)
    if (!periodEnd || !isXml(r.xbrl) || !r.symbol) continue
    out.push({
      symbol: r.symbol.toUpperCase(),
      periodEnd,
      basis: r.consolidated === 'Consolidated' ? 'C' : 'S',
      url: r.xbrl,
      filedAt: nseStamp(r.broadCastDate)
    })
  }
  return out
}

/** Rows of /api/integrated-filing-results (SEBI's integrated filing, Mar 2025 on). */
export function parseIntegratedList(json: unknown): { refs: FilingRef[]; total: number; rows: number } {
  const data = (json as { data?: unknown; totalCount?: number } | null)?.data
  if (!Array.isArray(data)) return { refs: [], total: 0, rows: 0 }
  const refs: FilingRef[] = []
  for (const r of data as Record<string, string | null>[]) {
    const periodEnd = nseDate(r.qe_Date)
    if (!periodEnd || !isXml(r.xbrl) || !r.symbol || !/financials/i.test(r.type ?? '')) continue
    if (r.consolidated !== 'Consolidated' && r.consolidated !== 'Standalone') continue
    refs.push({
      symbol: r.symbol.toUpperCase(),
      periodEnd,
      basis: r.consolidated === 'Consolidated' ? 'C' : 'S',
      url: r.xbrl,
      filedAt: nseStamp(r.revised_Date ?? r.broadcast_Date)
    })
  }
  return { refs, total: (json as { totalCount?: number }).totalCount ?? data.length, rows: data.length }
}

/** One filing per period and basis: the latest one filed (a revision replaces the original). */
export function latestRefs(refs: FilingRef[]): FilingRef[] {
  const best = new Map<string, FilingRef>()
  for (const r of refs) {
    const k = `${r.symbol}|${r.periodEnd}|${r.basis}`
    const cur = best.get(k)
    if (!cur || (r.filedAt ?? '') > (cur.filedAt ?? '')) best.set(k, r)
  }
  return [...best.values()]
}

const num = (s: string | undefined): number | null => {
  const n = Number((s ?? '').trim())
  return (s ?? '').trim() !== '' && Number.isFinite(n) ? n : null
}

function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(',').map((c) => c.trim()))
}

const DDMMYYYY = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`
const DDMMYY = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(2, 4)}`
export const prUrl = (date: string) => `${NSE_ARCHIVES}/archives/equities/bhavcopy/pr/PR${DDMMYY(date)}.zip`
export const peUrl = (date: string) => `${NSE_ARCHIVES}/content/equities/peDetail/PE_${DDMMYY(date)}.csv`

/**
 * NSE's daily "PR" bundle: prices and 52-week range (pd file) and market caps (mcap file) for every
 * stock, plus P/E from the separate PE file. Equity series only (EQ, BE, BZ, SM, ST).
 */
export function parseDayFiles(zip: Uint8Array, date: string, peCsv: string | null): DayQuote[] {
  const files = unzipSync(zip)
  const find = (prefix: string) => {
    const name = Object.keys(files).find((n) => n.toLowerCase() === `${prefix}${DDMMYYYY(date)}.csv`)
    return name ? strFromU8(files[name]) : null
  }
  const pd = find('pd')
  if (!pd) throw new Error(`NSE's price file for ${date} has no price list`)
  const series = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST'])
  const out = new Map<string, DayQuote>()
  const [head, ...rows] = csvRows(pd)
  const col = (name: string) => head.indexOf(name)
  const c = {
    series: col('SERIES'), symbol: col('SYMBOL'), prev: col('PREV_CL_PR'), open: col('OPEN_PRICE'),
    high: col('HIGH_PRICE'), low: col('LOW_PRICE'), close: col('CLOSE_PRICE'), qty: col('NET_TRDQTY'),
    hi52: col('HI_52_WK'), lo52: col('LO_52_WK')
  }
  for (const r of rows) {
    const symbol = r[c.symbol]
    const close = num(r[c.close])
    if (!symbol || !series.has(r[c.series]) || close === null) continue
    // A stock trades in one series at a time; EQ wins if two appear.
    if (out.has(symbol) && r[c.series] !== 'EQ') continue
    out.set(symbol, {
      symbol,
      date,
      open: num(r[c.open]),
      high: num(r[c.high]),
      low: num(r[c.low]),
      close,
      prevClose: num(r[c.prev]),
      high52: num(r[c.hi52]) || null,
      low52: num(r[c.lo52]) || null,
      volume: num(r[c.qty]),
      mcap: null,
      pe: null
    })
  }
  const mcap = find('mcap')
  if (mcap) {
    const [mh, ...mrows] = csvRows(mcap)
    const sym = mh.indexOf('Symbol')
    const cap = mh.findIndex((h) => h.startsWith('Market Cap'))
    for (const r of mrows) {
      const q = out.get(r[sym])
      if (q) q.mcap = num(r[cap])
    }
  }
  if (peCsv) {
    for (const [symbol, pe] of csvRows(peCsv).slice(1)) {
      const q = out.get(symbol)
      const v = num(pe)
      if (q && v !== null && v > 0) q.pe = v
    }
  }
  return [...out.values()]
}

/** The index lines at the top of the day's price file (Nifty 50, Nifty Bank, sector indices…). */
export function parseIndices(zip: Uint8Array, date: string): IndexLevel[] {
  const files = unzipSync(zip)
  const name = Object.keys(files).find((n) => n.toLowerCase() === `pd${DDMMYYYY(date)}.csv`)
  if (!name) return []
  const [head, ...rows] = csvRows(strFromU8(files[name]))
  const col = (h: string) => head.indexOf(h)
  const c = { mkt: col('MKT'), name: col('SECURITY'), prev: col('PREV_CL_PR'), close: col('CLOSE_PRICE'), hi52: col('HI_52_WK'), lo52: col('LO_52_WK') }
  const out: IndexLevel[] = []
  for (const r of rows) {
    const close = num(r[c.close])
    if (r[c.mkt] !== 'Y' || !r[c.name] || close === null || close <= 0) continue
    out.push({ name: r[c.name], date, close, prevClose: num(r[c.prev]), high52: num(r[c.hi52]) || null, low52: num(r[c.lo52]) || null })
  }
  return out
}

/**
 * NSE politely: one request at a time, at least `gapMs` apart. After a refusal (403, 429, 503) it
 * waits a minute before the next request, so a busy or unwilling server is not hammered.
 */
export class NseClient {
  private chain: Promise<unknown> = Promise.resolve()
  private nextAt = 0
  constructor(
    private readonly f: FetchFn = fetch,
    private readonly gapMs = 600,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  private run<T>(url: string, read: (res: Response) => Promise<T>, timeoutMs = 30_000): Promise<T> {
    const go = async () => {
      const wait = this.nextAt - Date.now()
      if (wait > 0) await this.sleep(wait)
      try {
        return await fetchWith(url, { fetch: this.f, timeoutMs, headers: { Accept: 'application/json, text/plain, */*' } }, read)
      } catch (e) {
        if (e instanceof HttpError && [403, 429, 503].includes(e.status)) this.nextAt = Date.now() + 60_000
        throw e
      } finally {
        this.nextAt = Math.max(this.nextAt, Date.now() + this.gapMs + Math.random() * this.gapMs * 0.5)
      }
    }
    const p = this.chain.then(go, go)
    this.chain = p.catch(() => undefined)
    return p
  }

  json<T>(url: string): Promise<T> {
    return this.run(url, async (res) => {
      const text = await res.text()
      // An outage comes back as an HTML page with status 200.
      if (!/^\s*[[{]/.test(text)) throw new HttpError(503, url, `NSE sent a web page instead of data (${new URL(url).pathname})`)
      return JSON.parse(text) as T
    })
  }
  text(url: string): Promise<string> {
    return this.run(url, (res) => res.text())
  }
  bytes(url: string): Promise<Uint8Array> {
    return this.run(url, async (res) => new Uint8Array(await res.arrayBuffer()), 60_000)
  }

  /** Every results filing NSE lists for a company (both the old and the integrated format). */
  async companyFilings(symbol: string): Promise<FilingRef[]> {
    const s = encodeURIComponent(symbol)
    const legacy = await this.json<unknown>(`${NSE_API}/corporates-financial-results?index=equities&symbol=${s}&period=Quarterly`)
    const integrated = await this.json<unknown>(`${NSE_API}/integrated-filing-results?index=equities&symbol=${s}`)
    return [...parseLegacyList(legacy), ...parseIntegratedList(integrated).refs]
  }

  /** Results filed across the market between two dates (DD-MM-YYYY taken care of here). */
  async filingsBetween(from: string, to: string): Promise<FilingRef[]> {
    const d = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
    const out: FilingRef[] = []
    for (let page = 1; page <= 40; page++) {
      const json = await this.json<unknown>(
        `${NSE_API}/integrated-filing-results?index=equities&from_date=${d(from)}&to_date=${d(to)}&type=Integrated%20Filing-%20Financials&page=${page}&size=100`
      )
      const { refs, total, rows } = parseIntegratedList(json)
      out.push(...refs)
      if (rows === 0 || page * 100 >= total) break
    }
    return out
  }
}
