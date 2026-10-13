import XLSX from 'xlsx'
import { and, eq, inArray } from 'drizzle-orm'
import type { ImportResult } from '@shared/types'
import { schema, type Db } from '../db'
import { fromIndustryText, looksLikeRating } from '../market/sectors'
import { normalizeHeader, parseDate, parseNumber } from './parse'

export interface DisclosedHolding {
  name: string
  isin: string | null
  industryRaw: string | null
  assetType: 'EQUITY' | 'DEBT' | 'CASH' | 'OTHER'
  weight: number // fraction of net assets
}

export interface DisclosedPortfolio {
  sheet: string
  title: string
  asOf: string | null
  holdings: DisclosedHolding[]
}

const NAME_COLS = [
  'name of the instrument',
  'name of instrument',
  'name of the instrument issuer',
  'instrument',
  'security name',
  'name of security',
  'company name',
  'issuer',
  'name'
]
const isWeightHeader = (h: string) => /(to|of) (net assets|nav|aum)|net asset|^nav$|weight|percentage to nav/.test(h)
const isIndustryHeader = (h: string) => /industry|rating|sector/.test(h)

const CASH_SECTION = /treps|tri ?party|repo|cblo|net receivable|net current|cash|margin|money market deposit/i

/**
 * Classifies a holding from its ISIN. Indian ISINs: IN + issuer type (E company, F fund, 0-3 government)
 * + 4-char issuer + 2-digit security type (01 = equity shares) + serial + check digit.
 */
export function classifyIsin(isin: string, industry: string | null): DisclosedHolding['assetType'] {
  if (looksLikeRating(industry)) return 'DEBT'
  if (/^IN[0-3]/.test(isin)) return 'DEBT'
  if (/^INF/.test(isin)) return 'OTHER' // units of another fund/ETF
  if (/^IN[E9]/.test(isin)) {
    const type = isin.slice(7, 9)
    if (type === '01') return 'EQUITY'
    if (type === '23' || type === '25') return 'OTHER' // InvIT and REIT units
    return 'DEBT'
  }
  return 'EQUITY' // foreign listed shares (US…, KYG…)
}

export function parseAmcWorkbook(data: Buffer | ArrayBuffer): DisclosedPortfolio[] {
  const wb = XLSX.read(data, { type: 'buffer', cellDates: true })
  const out: DisclosedPortfolio[] = []
  for (const sheet of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '', raw: true })
    out.push(...parseSheet(sheet, grid).filter((p) => p.holdings.length > 0))
  }
  return out
}

interface HeaderRow {
  row: number
  iIsin: number
  iWeight: number
  iName: number
  iIndustry: number
}

function headerAt(grid: unknown[][], r: number): HeaderRow | null {
  const headers = grid[r].map(normalizeHeader)
  const iIsin = headers.findIndex((h) => h === 'isin' || h.startsWith('isin'))
  const iWeight = headers.findIndex(isWeightHeader)
  if (iIsin < 0 || iWeight < 0) return null
  let iName = -1
  for (const n of NAME_COLS) {
    iName = headers.findIndex((h) => h === n || h.startsWith(n))
    if (iName >= 0) break
  }
  if (iName < 0) iName = Math.max(0, iIsin - 1)
  return { row: r, iIsin, iWeight, iName, iIndustry: headers.findIndex(isIndustryHeader) }
}

const ISIN_CELL = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/
const textCells = (row: unknown[]) =>
  row.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim())
// A scheme's own heading, as opposed to a section heading repeated with its column headers.
const NAMES_A_SCHEME = /scheme\s*(name)?\s*:|\bfund\b|\betf\b|\bfof\b/i

/**
 * The portfolios on a sheet: usually one, but some houses stack every scheme on one sheet (UTI),
 * each block with its own name rows and column headers.
 */
export function parseSheet(sheet: string, grid: unknown[][]): DisclosedPortfolio[] {
  const first = grid.slice(0, 60).findIndex((_, r) => headerAt(grid, r))
  if (first < 0) return []
  const blocks: { header: HeaderRow; titleFrom: number }[] = [{ header: headerAt(grid, first)!, titleFrom: 0 }]
  for (let r = first + 1; r < grid.length; r++) {
    const header = headerAt(grid, r)
    if (!header) continue
    // Name rows just above the repeated headers (up to six, stopping at a holding row).
    let from = r
    while (from > r - 6 && from - 1 > blocks[blocks.length - 1].header.row) {
      const row = grid[from - 1]
      if (row.some((c) => ISIN_CELL.test(String(c).trim()))) break
      from--
    }
    const heading = grid.slice(from, r).flatMap(textCells).join(' ')
    if (NAMES_A_SCHEME.test(heading)) blocks.push({ header, titleFrom: from })
  }
  return blocks.flatMap((b, i) => {
    const end = i + 1 < blocks.length ? blocks[i + 1].titleFrom : grid.length
    const p = parseBlock(sheet, grid.slice(b.titleFrom, b.header.row), b.header, grid.slice(b.header.row + 1, end))
    return p ? [p] : []
  })
}

function parseBlock(
  sheet: string,
  titleRows: unknown[][],
  h: HeaderRow,
  lines: unknown[][]
): DisclosedPortfolio | null {
  const { iIsin, iWeight, iName, iIndustry } = h
  const titleLines = titleRows
    .map((row) => row.filter((c) => typeof c === 'string' && c.trim()).join(' '))
    .filter(Boolean)
  // Each title cell is a name candidate on its own: a row can repeat the name across cells.
  const title = [sheet, ...new Set(titleRows.flatMap(textCells))].join(' | ')
  // Some AMCs (e.g. SBI) put the date in a real date cell next to "Portfolio statement as on".
  const dateCell = titleRows
    .filter((row) => row.some((c) => typeof c === 'string' && /as (on|at|of)/i.test(c)))
    .flatMap((row) => row.filter((c): c is Date => c instanceof Date))[0]
  const asOf = findDate(titleLines) ?? (dateCell ? parseDate(dateCell) : null)

  const raw: (DisclosedHolding & { rawWeight: number })[] = []
  let section = ''
  for (const line of lines) {
    const name = String(line[iName] ?? '').trim()
    const isin = String(line[iIsin] ?? '')
      .trim()
      .toUpperCase()
    const w = parseNumber(line[iWeight])
    if (!name && !isin) continue
    if (/total/i.test(name) && !isin) continue
    if (!isin && (w === null || w === 0)) {
      section = name // a heading such as "Equity & Equity related" or "TREPS"
      continue
    }
    if (w === null) continue
    const industry = iIndustry >= 0 ? String(line[iIndustry] ?? '').trim() || null : null
    if (ISIN_CELL.test(isin)) {
      raw.push({
        name,
        isin,
        industryRaw: industry,
        assetType: classifyIsin(isin, industry),
        weight: 0,
        rawWeight: w
      })
    } else if (CASH_SECTION.test(name) || CASH_SECTION.test(section)) {
      raw.push({ name, isin: null, industryRaw: null, assetType: 'CASH', weight: 0, rawWeight: w })
    }
  }
  if (raw.length === 0) return null

  // Weights come either as fractions (0.0523) or percentages (5.23).
  const total = raw.reduce((s, h) => s + h.rawWeight, 0)
  const divisor = total > 2 ? 100 : 1
  return {
    sheet,
    title,
    asOf,
    holdings: raw.map(({ rawWeight, ...h }) => ({ ...h, weight: rawWeight / divisor }))
  }
}

function findDate(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(
      /as (?:on|at|of)\s*:?\s*([0-9]{1,2}[-/ .][A-Za-z0-9]{2,9}[-/ .,]+[0-9]{2,4}|[A-Za-z]{3,9}\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s*[0-9]{4})/i
    )
    if (m) {
      const d = parseDate(m[1].replace(/(\d)(st|nd|rd|th)/, '$1'))
      if (d) return d
    }
  }
  return null
}

const STOP = new Set([
  'direct',
  'regular',
  'plan',
  'growth',
  'option',
  'idcw',
  'dividend',
  'payout',
  'reinvestment',
  'fund',
  'scheme',
  'the',
  'mutual',
  'of',
  'an',
  'open',
  'ended',
  'portfolio',
  'statement',
  'as',
  'on',
  'monthly',
  'ltd',
  'limited',
  'and',
  'gr',
  'dir'
])
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/&/g, ' and ')
      // "Small Cap", "Small-Cap" and "Smallcap" are the same word to every fund house.
      .replace(/\b(small|mid|large|flexi|multi|micro|focused)\s*-?\s*cap\b/g, '$1cap')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d{4}$/.test(w))
  )

/**
 * The scheme name candidates in a sheet title: each title line on its own, minus sheet codes
 * ("RLMF752", "BC IB01-"), bracketed descriptions, "Scheme name:" labels, tickers and "as on" dates.
 */
export function nameCandidates(title: string): string[] {
  return title
    .split(' | ')
    .map((seg) =>
      seg
        .replace(/\([^)]*\)?/g, ' ')
        .replace(
          /\b(scheme name|name of the scheme|portfolio statement of|portfolio of|monthly portfolio( statement)?( of)?)\s*:?/gi,
          ' '
        )
        .replace(/\b(symbol|ticker|isin)\b.*$/i, ' ')
        .replace(/\b(portfolio )?(statement )?as (on|at|of)\b.*$/i, ' ')
        .replace(/\bback to index\b/gi, ' ')
        .replace(/\b[A-Z]{1,5}\d{2,}[A-Z0-9]*-?/g, ' ')
        .trim()
    )
    .filter((s) => s.length > 3)
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  const common = [...a].filter((t) => b.has(t)).length
  return common / new Set([...a, ...b]).size
}

/**
 * The names a held fund can go by: its statement name without bracketed or "erstwhile …" parts,
 * the bracketed text itself (often the old or new name), and any other names given (AMFI's
 * current scheme name).
 */
export function fundNameVariants(name: string, others: (string | null | undefined)[] = []): string[] {
  const out = new Set<string>()
  const add = (s: string | null | undefined) => {
    const t = (s ?? '')
      .replace(/[()]/g, ' ')
      .replace(/\b(erstwhile|formerly|earlier|previously|now)\b(\s+(known|called|named))?(\s+as)?\s*:?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length > 3) out.add(t)
  }
  add(name.replace(/\([^)]*\)?/g, ' ').replace(/\b(erstwhile|formerly|earlier known as|previously)\b.*$/i, ' '))
  for (const m of name.matchAll(/\(([^)]*)\)/g)) add(m[1])
  const tail = name.match(/\b(?:erstwhile|formerly|earlier known as|previously)\b(.*)$/i)
  if (tail) add(tail[1])
  others.forEach(add)
  return [...out]
}

export interface MatchResult {
  fundId: number
  fundName: string
  portfolio: DisclosedPortfolio
  score: number
}

/** Each held fund's closest sheet and its score, whether or not it is close enough to use. */
export function closestPortfolios(
  portfolios: DisclosedPortfolio[],
  funds: { id: number; name: string; aliases?: (string | null)[] }[]
): MatchResult[] {
  const candidates = portfolios.map((p) => ({ p, names: nameCandidates(p.title).map(tokens) }))
  const out: MatchResult[] = []
  for (const f of funds) {
    let best: { p: DisclosedPortfolio; score: number } | null = null
    for (const variant of fundNameVariants(f.name, f.aliases)) {
      const want = tokens(variant)
      if (want.size < 2) continue
      for (const c of candidates) {
        const score = Math.max(0, ...c.names.map((n) => jaccard(want, n)))
        if (!best || score > best.score) best = { p: c.p, score }
      }
    }
    if (best) out.push({ fundId: f.id, fundName: f.name, portfolio: best.p, score: best.score })
  }
  return out
}

/**
 * Best sheet for each held fund. Scores are Jaccard overlaps between the fund's name words and the
 * best title line, so extra words count against a sheet ("SBI Small Cap Fund" does not match
 * "SBI Nifty Small Cap 250 ETF").
 */
export function matchPortfolios(
  portfolios: DisclosedPortfolio[],
  funds: { id: number; name: string; aliases?: (string | null)[] }[]
): MatchResult[] {
  return closestPortfolios(portfolios, funds).filter((m) => m.score >= 0.6)
}

/** How alike two fund or company names are (0–1), ignoring plan/option words and spellings of "cap". */
export function nameSimilarity(a: string, b: string): number {
  let best = 0
  for (const x of fundNameVariants(a))
    for (const y of fundNameVariants(b)) {
      const tx = tokens(x)
      const ty = tokens(y)
      if (tx.size && ty.size) best = Math.max(best, jaccard(tx, ty))
    }
  return best
}

/** The scheme's own name in a sheet title, for messages. */
const schemeLabel = (p: DisclosedPortfolio) => nameCandidates(p.title)[0]?.slice(0, 60) ?? p.sheet

/** Replaces one fund's holdings for a month from one source. Returns the number of rows stored. */
export function saveFundHoldings(
  db: Db,
  opts: { fundId: number; asOf: string; holdings: DisclosedHolding[]; source: 'AMC' | 'AMC_AUTO'; batchId?: number }
): number {
  db.delete(schema.fundHoldings)
    .where(
      and(
        eq(schema.fundHoldings.fundInstrumentId, opts.fundId),
        eq(schema.fundHoldings.source, opts.source),
        eq(schema.fundHoldings.asOf, opts.asOf)
      )
    )
    .run()
  for (const h of opts.holdings) {
    db.insert(schema.fundHoldings)
      .values({
        fundInstrumentId: opts.fundId,
        asOf: opts.asOf,
        source: opts.source,
        name: h.name,
        isin: h.isin,
        sector: h.assetType === 'EQUITY' ? fromIndustryText(h.industryRaw) : null,
        industryRaw: h.industryRaw,
        assetType: h.assetType,
        country: h.isin && !h.isin.startsWith('IN') ? h.isin.slice(0, 2) : 'IN',
        weight: h.weight,
        importBatchId: opts.batchId ?? null
      })
      .run()
  }
  return opts.holdings.length
}

export function importAmcPortfolio(
  db: Db,
  opts: { personId: number; fileName: string; data: Buffer; heldFundIds: number[] }
): ImportResult {
  const portfolios = parseAmcWorkbook(opts.data)
  if (portfolios.length === 0) {
    throw new Error(
      'No portfolio table found. Expected columns like "Name of the Instrument", "ISIN" and "% to Net Assets".'
    )
  }
  const funds = opts.heldFundIds.length
    ? db
        .select({ id: schema.instruments.id, name: schema.instruments.name, schemeName: schema.instruments.schemeName })
        .from(schema.instruments)
        .where(inArray(schema.instruments.id, opts.heldFundIds))
        .all()
        .map((f) => ({ id: f.id, name: f.name, aliases: [f.schemeName] }))
    : []
  const closest = closestPortfolios(portfolios, funds)
  const matches = closest.filter((m) => m.score >= 0.6)
  if (matches.length === 0) {
    // Say what was compared, so a naming difference is easy to spot.
    const near = closest
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((m) => `"${m.fundName}" → closest is "${schemeLabel(m.portfolio)}" (${Math.round(m.score * 100)}% alike)`)
    throw new Error(
      `This file has ${portfolios.length} scheme portfolios, but none match a fund or ETF you hold. ` +
        (near.length
          ? `Closest: ${near.join('; ')}.`
          : `You hold no funds or ETFs yet. Schemes in the file: ${portfolios.slice(0, 4).map(schemeLabel).join('; ')}.`)
    )
  }

  return db.transaction((tx) => {
    const batch = tx
      .insert(schema.importBatches)
      .values({ kind: 'FUND_PORTFOLIO', fileName: opts.fileName, personId: opts.personId })
      .returning({ id: schema.importBatches.id })
      .get()
    let rows = 0
    const notes: string[] = []
    for (const m of matches) {
      const asOf = m.portfolio.asOf ?? new Date().toISOString().slice(0, 10)
      rows += saveFundHoldings(tx as unknown as Db, {
        fundId: m.fundId,
        asOf,
        holdings: m.portfolio.holdings,
        source: 'AMC',
        batchId: batch.id
      })
      const equity = m.portfolio.holdings.filter((h) => h.assetType === 'EQUITY').reduce((s, h) => s + h.weight, 0)
      notes.push(
        `${m.fundName}: ${m.portfolio.holdings.length} holdings as of ${asOf} (${Math.round(equity * 100)}% equity)`
      )
    }
    const unmatchedFunds = funds.filter((f) => !matches.some((m) => m.fundId === f.id)).length
    const result: ImportResult = {
      batchId: batch.id,
      kind: 'FUND_PORTFOLIO',
      fileName: opts.fileName,
      accountsCreated: 0,
      instrumentsCreated: 0,
      transactionsAdded: 0,
      transactionsSkipped: 0,
      snapshotsAdded: rows,
      warnings: [],
      notes: [...notes, ...(unmatchedFunds ? [`${unmatchedFunds} other fund(s) you hold are not in this file.`] : [])]
    }
    tx.update(schema.importBatches)
      .set({ summaryJson: JSON.stringify(result) })
      .where(eq(schema.importBatches.id, batch.id))
      .run()
    return result
  })
}
