import { dmyToIso, getJson, getText, type FetchFn } from './http'
import type { PricePoint } from './yahoo'

// ---------------- Mutual fund NAVs: mfapi.in (per scheme) + AMFI NAVAll.txt (all schemes) ----------------

export interface NavQuote {
  nav: number
  prevNav: number | null
  date: string
  category: string | null
  fundHouse: string | null
}

interface MfapiResponse {
  meta?: { scheme_category?: string; scheme_name?: string; fund_house?: string }
  data?: { date: string; nav: string }[]
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

export async function mfapiLatest(amfiCode: string, f?: FetchFn): Promise<NavQuote> {
  const json = await getJson<MfapiResponse>(
    `https://api.mfapi.in/mf/${encodeURIComponent(amfiCode)}?startDate=${isoDaysAgo(20)}&endDate=${isoDaysAgo(-1)}`,
    { fetch: f }
  )
  const rows = (json.data ?? []).map((d) => ({ date: dmyToIso(d.date), nav: Number(d.nav) })).filter((d) => d.nav > 0)
  rows.sort((a, b) => b.date.localeCompare(a.date))
  if (rows.length === 0) throw new Error(`No recent NAV for scheme ${amfiCode}`)
  return {
    nav: rows[0].nav,
    prevNav: rows[1]?.nav ?? null,
    date: rows[0].date,
    category: json.meta?.scheme_category ?? null,
    fundHouse: json.meta?.fund_house ?? null
  }
}

export async function mfapiHistory(amfiCode: string, sinceIso: string, f?: FetchFn): Promise<PricePoint[]> {
  const json = await getJson<MfapiResponse>(
    `https://api.mfapi.in/mf/${encodeURIComponent(amfiCode)}?startDate=${sinceIso}&endDate=${isoDaysAgo(-1)}`,
    { fetch: f }
  )
  return (json.data ?? [])
    .map((d) => ({ date: dmyToIso(d.date), close: Number(d.nav) }))
    .filter((d) => d.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface AmfiScheme {
  code: string
  isinGrowth: string | null
  isinReinvest: string | null
  name: string
  nav: number
  date: string
  /** Fund house heading the row sits under, e.g. "Nippon India Mutual Fund". */
  fundHouse: string | null
  /** Category heading, e.g. "Exchange Traded Funds (ETFs) - Other ETF". */
  category: string | null
}

/**
 * AMFI's daily NAV file. Rows are "Code;ISIN growth;ISIN reinvest;Name;…;NAV;Date" (the current file
 * adds Plan and Option before NAV, so NAV and date are read from the end). Rows sit under a category
 * heading ("Open Ended Schemes(…)") and a fund-house heading ("Axis Mutual Fund").
 */
export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = []
  let fundHouse: string | null = null
  let category: string | null = null
  const months: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12'
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (!line.includes(';')) {
      const heading = line.match(
        /^(?:Open|Close|Interval)\w* Ended Schemes?\s*\((.*)\)$|^Interval Fund Schemes?\s*\((.*)\)$/i
      )
      if (heading) category = (heading[1] ?? heading[2] ?? '').trim() || null
      else fundHouse = line
      continue
    }
    const p = line.split(';')
    if (p.length < 6 || !/^\d+$/.test(p[0])) continue
    const nav = Number(p[p.length - 2])
    const m = p[p.length - 1].trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
    if (!Number.isFinite(nav) || nav <= 0 || !m) continue
    const isin = (s: string) => (/^INF[A-Z0-9]{9}$/.test(s.trim()) ? s.trim() : null)
    out.push({
      code: p[0],
      isinGrowth: isin(p[1]),
      isinReinvest: isin(p[2]),
      name: p[3].trim(),
      nav,
      date: `${m[3]}-${months[m[2]] ?? '01'}-${m[1]}`,
      fundHouse,
      category
    })
  }
  return out
}

// ---------------- NSE listings: every stock and ETF by ISIN ----------------

export interface NseListing {
  isin: string
  symbol: string
  name: string
  kind: 'EQ' | 'ETF'
}

function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(
      (line) =>
        line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim()) ?? []
    )
}

/** Parses NSE's EQUITY_L.csv (all listed stocks) or eq_etfseclist.csv (all ETFs). */
export function parseNseListing(text: string, kind: 'EQ' | 'ETF'): NseListing[] {
  const [header, ...rows] = csvRows(text)
  if (!header) return []
  const h = header.map((x) => x.toLowerCase())
  const iSym = h.findIndex((x) => x === 'symbol')
  const iIsin = h.findIndex((x) => x.startsWith('isin'))
  const iName = h.findIndex((x) => x.includes('name of company') || x === 'underlying asset' || x === 'securityname')
  if (iSym < 0 || iIsin < 0) return []
  return rows
    .filter((r) => /^IN[A-Z0-9]{10}$/.test(r[iIsin] ?? ''))
    .map((r) => ({ isin: r[iIsin], symbol: r[iSym], name: iName >= 0 ? r[iName] : r[iSym], kind }))
}

export async function fetchNseListings(f?: FetchFn): Promise<NseListing[]> {
  const [eq, etf] = await Promise.all([
    getText('https://archives.nseindia.com/content/equities/EQUITY_L.csv', { fetch: f, timeoutMs: 30_000 }),
    getText('https://archives.nseindia.com/content/equities/eq_etfseclist.csv', { fetch: f, timeoutMs: 30_000 })
  ])
  return [...parseNseListing(eq, 'EQ'), ...parseNseListing(etf, 'ETF')]
}

export async function fetchNavAll(f?: FetchFn): Promise<AmfiScheme[]> {
  return parseNavAll(await getText('https://portal.amfiindia.com/spages/NAVAll.txt', { fetch: f, timeoutMs: 30_000 }))
}

// ---------------- NPS NAVs: npsnav.in ----------------

export async function npsSchemes(f?: FetchFn): Promise<{ code: string; name: string }[]> {
  const json = await getJson<{ data?: [string, string][] }>('https://npsnav.in/api/schemes', { fetch: f })
  return (json.data ?? []).map(([code, name]) => ({ code, name }))
}

export async function npsLatest(code: string, f?: FetchFn): Promise<NavQuote> {
  const rows = await npsHistory(code, f)
  if (rows.length === 0) throw new Error(`No NAV for NPS scheme ${code}`)
  const last = rows[rows.length - 1]
  return {
    nav: last.close,
    prevNav: rows[rows.length - 2]?.close ?? null,
    date: last.date,
    category: null,
    fundHouse: null
  }
}

export async function npsHistory(code: string, f?: FetchFn): Promise<PricePoint[]> {
  const json = await getJson<{ data?: { date: string; nav: number | string }[] }>(
    `https://npsnav.in/api/historical/${encodeURIComponent(code)}`,
    { fetch: f }
  )
  return (json.data ?? [])
    .map((d) => ({ date: dmyToIso(d.date), close: Number(d.nav) }))
    .filter((d) => d.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const npsTokens = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .replace(/TIER\s*-?\s*(I{1,2}|1|2)\b/g, (_, t) => ` TIER${t === '1' ? 'I' : t === '2' ? 'II' : t} `)
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !['FUND', 'FUNDS', 'PENSION', 'SCHEME', 'LIMITED', 'LTD', 'PVT', 'THE'].includes(w))
  )

/**
 * Matches a scheme name printed in a CAS (e.g. "SBI PENSION FUND SCHEME E (Tier I)") to an
 * npsnav scheme code. Requires the fund manager word, the asset-class letter and the tier to agree.
 */
export function matchNpsScheme(name: string, schemes: { code: string; name: string }[]): string | null {
  const want = npsTokens(name)
  let best: { code: string; score: number } | null = null
  for (const s of schemes) {
    const have = npsTokens(s.name)
    const tierWant = [...want].find((t) => t.startsWith('TIER'))
    const tierHave = [...have].find((t) => t.startsWith('TIER'))
    if (tierWant && tierHave && tierWant !== tierHave) continue
    const common = [...want].filter((t) => have.has(t)).length
    const score = common / Math.max(want.size, have.size)
    if (!best || score > best.score) best = { code: s.code, score }
  }
  return best && best.score >= 0.75 ? best.code : null
}

// ---------------- NSE industry list ----------------

export interface NseIndustryRow {
  isin: string
  symbol: string
  name: string
  industry: string
}

/** Parses NSE index constituent CSVs: "Company Name,Industry,Symbol,Series,ISIN Code". */
export function parseNseIndexCsv(text: string): NseIndustryRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const header =
    lines
      .shift()
      ?.split(',')
      .map((h) => h.trim().toLowerCase()) ?? []
  const col = (n: string) => header.indexOf(n)
  const [iName, iInd, iSym, iIsin] = [col('company name'), col('industry'), col('symbol'), col('isin code')]
  if ([iName, iInd, iSym, iIsin].some((i) => i < 0)) return []
  const out: NseIndustryRow[] = []
  for (const line of lines) {
    // Company names can contain commas inside quotes.
    const cells =
      line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim()) ?? []
    const isin = cells[iIsin]
    if (!/^IN[A-Z0-9]{10}$/.test(isin ?? '')) continue
    out.push({ isin, symbol: cells[iSym], name: cells[iName], industry: cells[iInd] })
  }
  return out
}

export async function fetchNseIndustries(f?: FetchFn): Promise<NseIndustryRow[]> {
  // Nifty Total Market covers ~750 companies; MidSmallcap 400 adds nothing new, so one file suffices.
  const text = await getText('https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv', {
    fetch: f,
    timeoutMs: 30_000
  })
  return parseNseIndexCsv(text)
}
