import { unzipSync, strFromU8 } from 'fflate'
import { fetchWith, HttpError, type FetchFn } from '../market/http'
import { OWNER_GROUPS, type Basis, type DayQuote, type OwnerGroup, type ShpHolder } from '@shared/research'
import type { IndexLevel } from '@shared/screener'
import type { Bar } from '@shared/technicals'

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

export const deliveryUrl = (date: string) => `${NSE_ARCHIVES}/products/content/sec_bhavdata_full_${DDMMYYYY(date)}.csv`

/**
 * NSE's daily "full bhavcopy with delivery": every stock's prices, volume and delivery %. Equity
 * series only; when a stock appears twice, EQ wins.
 */
export function parseDeliveryFile(text: string): (Bar & { symbol: string })[] {
  const [head, ...rows] = csvRows(text)
  if (!head) return []
  const col = (h: string) => head.indexOf(h)
  const c = {
    symbol: col('SYMBOL'), series: col('SERIES'), date: col('DATE1'), prev: col('PREV_CLOSE'), open: col('OPEN_PRICE'),
    high: col('HIGH_PRICE'), low: col('LOW_PRICE'), close: col('CLOSE_PRICE'), qty: col('TTL_TRD_QNTY'), deliv: col('DELIV_PER')
  }
  if (c.symbol < 0 || c.close < 0 || c.date < 0) throw new Error('NSE’s delivery file has unexpected columns')
  const series = new Set(['EQ', 'BE', 'BZ', 'SM', 'ST'])
  const out = new Map<string, Bar & { symbol: string }>()
  for (const r of rows) {
    const symbol = r[c.symbol]
    const close = num(r[c.close])
    const date = nseDate(r[c.date])
    if (!symbol || !series.has(r[c.series]) || close === null || close <= 0 || !date) continue
    if (out.has(symbol) && r[c.series] !== 'EQ') continue
    out.set(symbol, {
      symbol,
      date,
      open: num(r[c.open]),
      high: num(r[c.high]),
      low: num(r[c.low]),
      close,
      prevClose: num(r[c.prev]),
      volume: num(r[c.qty]),
      delivPct: num(r[c.deliv])
    })
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

/** NSE's board-meeting calendar: results days and other meetings coming up, for every company. */
export function parseEventCalendar(json: unknown): { symbol: string; company: string; date: string; purpose: string; details: string }[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out = []
  for (const r of data as Record<string, string | null>[]) {
    const date = nseDate(r.date)
    if (!date || !r.symbol) continue
    out.push({ symbol: r.symbol.toUpperCase(), company: r.company ?? r.symbol, date, purpose: (r.purpose ?? '').trim(), details: (r.bm_desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) })
  }
  return out
}

export type ActionKind = 'DIVIDEND' | 'BONUS' | 'SPLIT' | 'RIGHTS' | 'BUYBACK' | 'DEMERGER' | 'OTHER'

/** NSE's corporate actions: dividends (₹ a share), bonuses, splits, rights, buybacks, with ex and record dates. */
export function parseCorporateActions(json: unknown): { symbol: string; exDate: string; recordDate: string | null; subject: string; kind: ActionKind; amount: number | null }[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out = []
  for (const r of data as Record<string, string | null>[]) {
    const exDate = nseDate(r.exDate)
    const subject = (r.subject ?? '').replace(/\s+/g, ' ').trim()
    if (!exDate || !r.symbol || !subject) continue
    if (r.series && !['EQ', 'BE', 'BZ', 'SM', 'ST'].includes(r.series)) continue
    const kind: ActionKind = /dividend/i.test(subject)
      ? 'DIVIDEND'
      : /bonus/i.test(subject)
        ? 'BONUS'
        : /split|sub-division/i.test(subject)
          ? 'SPLIT'
          : /rights/i.test(subject)
            ? 'RIGHTS'
            : /buy\s*back/i.test(subject)
              ? 'BUYBACK'
              : /demerger/i.test(subject)
                ? 'DEMERGER'
                : 'OTHER'
    // "Interim Dividend - Rs 12 Per Share"; several dividends in one line are added up.
    const amounts = kind === 'DIVIDEND' ? [...subject.matchAll(/(?:Rs|Re)\.?\s*([\d.]+)/gi)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n)) : []
    out.push({ symbol: r.symbol.toUpperCase(), exDate, recordDate: nseDate(r.recDate), subject, kind, amount: amounts.length ? amounts.reduce((a, b) => a + b, 0) : null })
  }
  return out
}

/** NSE's shareholding-pattern list: one row per filing, promoters' share and the XBRL file's address. */
export function parseShpList(json: unknown): { symbol: string; asOf: string; promoter: number | null; url: string | null; filedAt: string | null }[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out = []
  for (const r of data as Record<string, string | null>[]) {
    const asOf = nseDate(r.date)
    if (!asOf || !r.symbol) continue
    const p = Number(r.pr_and_prgrp)
    out.push({
      symbol: r.symbol.toUpperCase(),
      asOf,
      promoter: r.pr_and_prgrp && Number.isFinite(p) ? Math.round(p * 100) / 10000 : null,
      url: r.xbrl && /^https:\/\/nsearchives\.nseindia\.com\//.test(r.xbrl) ? r.xbrl : null,
      filedAt: nseDate(r.submissionDate)
    })
  }
  return out
}

// The pattern's categories, as XBRL members, added up into the app's groups.
const SHP_GROUP: Record<string, OwnerGroup> = {
  ShareholdingOfPromoterAndPromoterGroupMember: 'promoter',
  InstitutionsForeignPortfolioInvestorCategoryOneMember: 'fpi',
  InstitutionsForeignPortfolioInvestorCategoryTwoMember: 'fpi',
  MutualFundsOrUTIMember: 'mf',
  InsuranceCompaniesMember: 'insurance',
  ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakhMember: 'retail',
  ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakhMember: 'hni',
  BodiesCorporateMember: 'corporate'
}
const SHP_HOLDER_KIND: Record<string, string> = {
  OthersIndianShareholders: 'Promoter',
  OtherForeignShareholders: 'Promoter',
  MutualFundsOrUTI: 'Mutual fund',
  InsuranceCompanies: 'Insurance',
  Banks: 'Bank',
  ProvidentFundsOrPensionFunds: 'Pension fund',
  AlternativeInvestmentFunds: 'AIF',
  InstitutionsForeignPortfolioInvestorCategoryOne: 'Foreign investor',
  InstitutionsForeignPortfolioInvestorCategoryTwo: 'Foreign investor',
  DetailsOfSharesHeldByOtherInstitutionsForeign: 'Foreign institution',
  ForeignPortfolioInvestorCategoryOne: 'Foreign investor',
  ForeignPortfolioInvestorCategoryTwo: 'Foreign investor',
  BodiesCorporate: 'Company',
  OtherNonInstitutions: 'Other'
}

/**
 * A quarterly shareholding pattern (SHP XBRL): the share held by each group (promoters, foreign
 * investors, mutual funds…) and the named holders of 1% or more.
 */
export function parseShpXbrl(xml: string): { asOf: string; groups: Record<OwnerGroup, number>; shareholders: number | null; holders: ShpHolder[] } | null {
  const asOf = /<xbrli:context id="MainI">[\s\S]*?<xbrli:instant>(\d{4}-\d{2}-\d{2})</.exec(xml)?.[1]
  if (!asOf) return null
  // Contexts that name one category of shareholders and nothing else.
  const category = new Map<string, string>()
  for (const m of xml.matchAll(/<xbrli:context id="([^"]+)">([\s\S]*?)<\/xbrli:context>/g)) {
    const dims = [...m[2].matchAll(/explicitMember dimension="[^"]*CategoryOfShareholdersAxis">[^:<]*:([A-Za-z]+)</g)]
    if (dims.length === 1 && !m[2].includes('typedMember')) category.set(m[1], dims[0][1])
  }
  const fact = (el: string) => {
    const out = new Map<string, string>()
    for (const m of xml.matchAll(new RegExp(`<in-bse-shp:${el} contextRef="([^"]+)"[^>]*>([^<]*)<`, 'g'))) out.set(m[1], m[2])
    return out
  }
  const share = fact('ShareholdingAsAPercentageOfTotalNumberOfShares')
  const count = fact('NumberOfShareholders')
  const byMember = new Map<string, number>()
  for (const [ctx, member] of category) {
    const v = Number(share.get(ctx))
    if (Number.isFinite(v)) byMember.set(member, v)
  }
  if (!byMember.has('ShareholdingOfPromoterAndPromoterGroupMember')) return null
  const groups = Object.fromEntries(OWNER_GROUPS.map((g) => [g, 0])) as Record<OwnerGroup, number>
  for (const [member, g] of Object.entries(SHP_GROUP)) groups[g] += byMember.get(member) ?? 0
  groups.otherDii = Math.max(0, (byMember.get('InstitutionsDomesticMember') ?? 0) - groups.mf - groups.insurance)
  const known = OWNER_GROUPS.filter((g) => g !== 'other').reduce((s, g) => s + groups[g], 0)
  groups.other = Math.max(0, 1 - known)
  for (const g of OWNER_GROUPS) groups[g] = Math.round(groups[g] * 1e6) / 1e6
  const totalCtx = [...category].find(([, m]) => m === 'ShareholdingPatternMember')?.[0]
  const total = totalCtx ? Number(count.get(totalCtx)) : NaN

  const names = fact('NameOfTheShareholder')
  const holders: ShpHolder[] = []
  for (const [ctx, name] of names) {
    const key = ctx.replace(/^D_/, '')
    const kind = SHP_HOLDER_KIND[key.replace(/_Context\d+$/, '')]
    const v = Number(share.get(key))
    if (!kind || !Number.isFinite(v) || v < 0.01) continue
    holders.push({ name: name.replace(/\s+/g, ' ').trim(), kind, share: v })
  }
  holders.sort((a, b) => b.share - a.share)
  return { asOf, groups, shareholders: Number.isFinite(total) ? total : null, holders }
}

/** One company's details from NSE's quote API: its classification, sector P/E and index memberships. */
export function parseSymbolData(json: unknown): {
  symbol: string
  macro: string | null
  sector: string | null
  industry: string | null
  basicIndustry: string | null
  sectorIndex: string | null
  sectorPe: number | null
  symbolPe: number | null
  indices: string[]
  listedOn: string | null
} | null {
  const e = (json as { equityResponse?: { metaData?: Record<string, unknown>; secInfo?: Record<string, unknown> }[] } | null)?.equityResponse?.[0]
  const symbol = e?.metaData?.symbol
  if (typeof symbol !== 'string' || !e?.secInfo) return null
  const i = e.secInfo
  const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== '-' && v.trim().toUpperCase() !== 'NA' ? v.trim() : null)
  const num = (v: unknown) => {
    const n = Number(v)
    return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    symbol: symbol.toUpperCase(),
    macro: str(i.macro),
    sector: str(i.sector),
    industry: str(i.industryInfo),
    basicIndustry: str(i.basicIndustry),
    sectorIndex: str(i.pdSectorInd),
    sectorPe: num(i.pdSectorPe),
    symbolPe: num(i.pdSymbolPe),
    indices: Array.isArray(i.indexList) ? (i.indexList as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    listedOn: nseDate(typeof i.listingDate === 'string' ? i.listingDate.slice(0, 11) : null)
  }
}

/** NSE's corporate announcements: what each company told the exchange, with the attachment's address. */
export function parseAnnouncements(json: unknown): { id: string; symbol: string; company: string; at: string; category: string; text: string; url: string | null }[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown[] } | null)?.data
  if (!Array.isArray(data)) return []
  const out = []
  for (const r of data as Record<string, string | null>[]) {
    const at = nseStamp(r.an_dt ?? r.exchdisstime)
    if (!r.seq_id || !r.symbol || !at) continue
    out.push({
      id: String(r.seq_id),
      symbol: r.symbol.toUpperCase(),
      company: (r.sm_name ?? r.symbol).trim(),
      at,
      category: (r.desc ?? '').trim(),
      text: (r.attchmntText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      url: r.attchmntFile && /^https:\/\/nsearchives\.nseindia\.com\//.test(r.attchmntFile) ? r.attchmntFile : null
    })
  }
  return out
}
