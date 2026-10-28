import { unzipSync } from 'fflate'
import { eq, inArray } from 'drizzle-orm'
import type { DisclosureStatus } from '@shared/assets'
import { schema, type Db } from '../db'
import { matchPortfolios, parseAmcWorkbook, saveFundHoldings, type DisclosedPortfolio } from '../importers/amcPortfolio'
import { listHoldings } from '../portfolio/holdings'
import { BUNDLED_AMC_REGISTRY, type AmcEntry } from './amcRegistry'
import { fetchNavAll } from './funds'
import { fetchWith, getJson, getText, type FetchFn } from './http'

/**
 * Automatic monthly portfolio disclosures.
 *
 * 1. AMFI's portfolio-disclosure directory lists every fund house and its own disclosure page.
 * 2. Each fund and ETF you hold carries its fund house (from AMFI's NAV file).
 * 3. For each of those fund houses, its page is read (plain HTML first, then a rendered copy for
 *    pages built with JavaScript) and the newest monthly portfolio spreadsheet is picked from the links.
 * 4. The file is downloaded, unzipped if needed, parsed, and each sheet is matched to your funds.
 *
 * Nothing is downloaded when the newest month is already stored.
 */

export interface FoundLink {
  url: string
  /** The link's own text (or the title next to it in a JSON listing). */
  text: string
  /** Text around the link (its row or card, or what precedes it), used when its own text says little. */
  context?: string
}

export interface DisclosureDeps {
  fetch?: FetchFn
  /** Renders a page with a real browser and returns its links (Electron only). */
  renderLinks?: (url: string, plan?: RenderPlan) => Promise<FoundLink[]>
  now?: Date
}

const STATUS_KEY = 'disclosures:status'
const REGISTRY_KEY = 'disclosures:registry'
const SPREADSHEET = /\.(xlsx?|xlsb|zip)(?:$|[?#])/i
const MAX_BYTES = 60 * 1024 * 1024
const RENDER_LIMIT_MS = 120_000

// ---------------- AMFI directory ----------------

/** Reads the fund-house list embedded in AMFI's portfolio-disclosure page. */
export function parseAmfiRegistry(html: string): AmcEntry[] {
  const text = html.replace(/\\"/g, '"').replace(/\\u0026/g, '&')
  const re = /\{"mf_id":"(\d+)","mf_name":"([^"]+)"[^{}]*?"amc_monthly_portfolio_disclosure":"([^"]*)"/g
  const out = new Map<string, AmcEntry>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.set(m[1], { id: m[1], name: m[2], monthlyUrl: m[3] || null })
  return [...out.values()]
}

export async function loadRegistry(db: Db, f?: FetchFn): Promise<AmcEntry[]> {
  const cached = db.select().from(schema.settings).where(eq(schema.settings.key, REGISTRY_KEY)).get()
  if (cached) {
    const { at, list } = JSON.parse(cached.value) as { at: string; list: AmcEntry[] }
    if (Date.now() - Date.parse(at) < 30 * 86400000 && list.length > 20) return list
  }
  try {
    const list = parseAmfiRegistry(
      await getText('https://www.amfiindia.com/online-center/portfolio-disclosure', { fetch: f, timeoutMs: 30_000 })
    )
    if (list.length > 20) {
      const value = JSON.stringify({ at: new Date().toISOString(), list })
      db.insert(schema.settings)
        .values({ key: REGISTRY_KEY, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
        .run()
      return list
    }
  } catch {
    /* fall back below */
  }
  return BUNDLED_AMC_REGISTRY
}

const houseTokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(
        (w) => w && !['mutual', 'fund', 'mf', 'asset', 'management', 'company', 'limited', 'ltd', 'india'].includes(w)
      )
  )

/** "Nippon India Mutual Fund" (AMFI NAV file) → the registry entry, tolerating small naming differences. */
export function findAmc(fundHouse: string, registry: AmcEntry[]): AmcEntry | null {
  const want = houseTokens(fundHouse)
  let best: { e: AmcEntry; score: number } | null = null
  for (const e of registry) {
    const have = houseTokens(e.name)
    const common = [...want].filter((t) => have.has(t)).length
    const score = common / new Set([...want, ...have]).size
    if (!best || score > best.score) best = { e, score }
  }
  return best && best.score >= 0.6 ? best.e : null
}

// ---------------- reading links and months ----------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}
const MON =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const pad = (n: number) => String(n).padStart(2, '0')
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/**
 * The month a disclosure is for, as YYYY-MM, from link text or a file name:
 * "30th September 2026", "September_30_2026", "30-Sep-26", "Sep 30 2026", "sept2026", "30092026", "2026-09-30".
 */
export function periodOf(raw: string): string | null {
  const s = decodeURIComponent(raw.replace(/%(?![0-9a-f]{2})/gi, '%25'))
    .toLowerCase()
    .replace(/[_\-.,/]+/g, ' ')
    .replace(/\s+/g, ' ')
  const candidates: { y: number; m: number }[] = []
  const push = (y: number, m: number) => {
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) candidates.push({ y, m })
  }
  let m: RegExpExecArray | null
  const dayMonYear = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ?${MON} ?(\\d{4}|\\d{2})\\b`, 'g')
  while ((m = dayMonYear.exec(s))) push(fullYear(m[3]), MONTHS[m[2].slice(0, 3)])
  const monDayYear = new RegExp(`\\b${MON} (\\d{1,2})(?:st|nd|rd|th)? (\\d{4})\\b`, 'g')
  while ((m = monDayYear.exec(s))) push(Number(m[3]), MONTHS[m[1].slice(0, 3)])
  const monYear = new RegExp(`\\b${MON} ?(\\d{4})\\b`, 'g')
  while ((m = monYear.exec(s))) push(Number(m[2]), MONTHS[m[1].slice(0, 3)])
  const iso = /\b(20\d{2}) (\d{1,2}) (\d{1,2})\b/g
  while ((m = iso.exec(s))) push(Number(m[1]), Number(m[2]))
  const dmy = /\b(\d{1,2}) (\d{1,2}) (20\d{2})\b/g
  while ((m = dmy.exec(s))) push(Number(m[3]), Number(m[2]))
  const compact = /\b(\d{2})(\d{2})(20\d{2})\b/g
  while ((m = compact.exec(s))) if (Number(m[1]) <= 31) push(Number(m[3]), Number(m[2]))
  if (candidates.length === 0) return null
  // A link can mention two dates (e.g. publish month and portfolio month); the earliest is the portfolio.
  candidates.sort((a, b) => a.y - b.y || a.m - b.m)
  return `${candidates[0].y}-${pad(candidates[0].m)}`
}

const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')

/** Spreadsheet links in a page's HTML: anchors with their text and nearby text, plus bare URLs in scripts. */
export function extractLinks(html: string, baseUrl: string): FoundLink[] {
  const out = new Map<string, FoundLink>()
  const tidy = (s: string) =>
    decodeEntities(s.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
  const add = (href: string, text: string, context = '') => {
    try {
      const url = new URL(decodeEntities(href.trim()), baseUrl).toString()
      if (!SPREADSHEET.test(url)) return
      const prev = out.get(url)
      if (prev && prev.text.length + (prev.context ?? '').length >= text.length + context.length) return
      out.set(url, { url, text, context })
    } catch {
      /* not a URL */
    }
  }
  const anchor = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = anchor.exec(html))) {
    const before = tidy(html.slice(Math.max(0, m.index - 400), m.index))
    add(m[1], tidy(m[2]), before.slice(-200))
  }
  // Links built by scripts (JSON props, data attributes).
  const bare = /["'(]((?:https?:)?\/?[^"'()<>\s]+\.(?:xlsx?|xlsb|zip)(?:\?[^"'()<>\s]*)?)["')]/gi
  while ((m = bare.exec(html))) add(m[1], '')
  return [...out.values()]
}

// Paths in a site's JSON that are served from somewhere other than the page's own host.
const PATH_HOSTS: { host: RegExp; path: RegExp; base: string }[] = [
  // ICICI Prudential lists "/downloads/Files/…"; the files are served under /blob.
  { host: /(^|\.)icicipruamc\.com$/i, path: /^\/downloads\//i, base: 'https://www.icicipruamc.com/blob' }
]

function resolveListed(raw: string, baseUrl: string): string | null {
  const s = raw.trim()
  try {
    if (/^https?:\/\//i.test(s)) return new URL(s).toString()
    if (!s.includes('/')) return null
    const base = new URL(baseUrl)
    const path = s.startsWith('/') ? s : `/${s}`
    const rule = PATH_HOSTS.find((r) => r.host.test(base.hostname) && r.path.test(path))
    return new URL(rule ? rule.base + path : path, base).toString()
  } catch {
    return null
  }
}

/**
 * Spreadsheet links in a site's JSON (the data behind pages built with JavaScript): each object
 * with a field ending in .xlsx/.xls/.zip becomes a link, titled by the object's other short text.
 */
export function linksFromJson(data: unknown, baseUrl: string): FoundLink[] {
  const out = new Map<string, FoundLink>()
  const textOf = (o: Record<string, unknown>, depth: number): string[] =>
    Object.values(o).flatMap((v) =>
      typeof v === 'string' && v.length < 200 && !SPREADSHEET.test(v)
        ? [v]
        : v && typeof v === 'object' && !Array.isArray(v) && depth < 1
          ? textOf(v as Record<string, unknown>, depth + 1)
          : []
    )
  const visit = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 12) return
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1))
    const o = v as Record<string, unknown>
    const urls = Object.values(o).filter((x): x is string => typeof x === 'string' && SPREADSHEET.test(x.trim()))
    if (urls.length) {
      const text = [
        ...new Set(
          textOf(o, 0)
            .map((t) => t.trim())
            .filter(Boolean)
        )
      ]
        .join(' ')
        .slice(0, 400)
      for (const u of urls) {
        const url = resolveListed(u, baseUrl)
        if (url && !out.has(url)) out.set(url, { url, text })
      }
    }
    for (const x of Object.values(o)) if (x && typeof x === 'object') visit(x, depth + 1)
  }
  visit(data, 0)
  return [...out.values()]
}

// ---------------- fund houses whose page needs a form filled in ----------------

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/**
 * Steps for a rendered page that lists files only after you use it: a section to open, and the
 * page's own file-list request to send again for other months (as its month picker would).
 */
export interface RenderPlan {
  /** Regex (source) for the text of the element to click once the page has loaded. */
  click?: string
  repeat?: {
    /** Regex (source) for the request's URL, and optionally its JSON body. */
    url: string
    body?: string
    /** The bodies to send, from the one the page sent. */
    bodies: (sent: Record<string, unknown>) => Record<string, unknown>[]
  }
}

interface Adapter {
  host: RegExp
  /** Lists files from a public API directly, without a browser. */
  links?: (f: FetchFn | undefined, now: Date) => Promise<FoundLink[]>
  /** Steps for the rendered page. */
  render?: (now: Date) => RenderPlan
  /** The house's site cannot be read automatically: what to do instead. */
  manual?: string
}

/** The last few ended months, newest first. */
const recentMonths = (now: Date, count = 3) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1))
    return { year: String(d.getUTCFullYear()), month: MONTH_NAMES[d.getUTCMonth()] }
  })

/**
 * Fund houses whose page needs more than reading: a month picked in a form (UTI's plain JSON
 * API is called directly), a section opened and months asked for inside the page (Axis), or a
 * site that blocks automated access altogether (Kotak).
 */
const ADAPTERS: Adapter[] = [
  {
    // Axis: Statutory disclosures → "8. Portfolios" → Monthly Scheme Portfolios (year, month, "Consolidated").
    host: /(^|\.)axismf\.com$/i,
    render: (now) => ({
      click: '^\\s*\\d*\\.?\\s*Portfolios\\s*$',
      repeat: {
        url: 'get-scheme-documents',
        body: 'sdMonthSchemePortfolio',
        bodies: (sent) => recentMonths(now).map((m) => ({ ...sent, ...m, schemeCode: 'Consolidated' }))
      }
    })
  },
  {
    // Kotak's site answers automated visits with a human check (Radware), so it is not tried.
    host: /(^|\.)kotakmf\.com$/i,
    manual:
      "Kotak's website blocks automated downloads. Open its page, choose Portfolios → Consolidated & Fortnightly Portfolio, download the latest monthly file, then import it."
  },
  {
    // UTI: "Consolidate Portfolio Disclosure (All scheme)", year and month, then "Get Portfolio".
    host: /(^|\.)utimf\.com$/i,
    links: async (f, now) => {
      for (let back = 1; back <= 3; back++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
        const url = `https://www.utimf.com/api/get-consolidate-portfolio-disclosure?year=${d.getUTCFullYear()}&month=${MONTH_NAMES[d.getUTCMonth()]}`
        try {
          const links = linksFromJson(await getJson<unknown>(url, { fetch: f, timeoutMs: 30_000 }), url)
          if (links.length) return links
        } catch {
          /* try the month before */
        }
      }
      return []
    }
  }
]

const adapterFor = (pageUrl: string) => {
  try {
    const host = new URL(pageUrl).hostname
    return ADAPTERS.find((a) => a.host.test(host)) ?? null
  } catch {
    return null
  }
}

const EXCLUDE =
  /fortnight|weekly|daily|ad[\s_-]?hoc|half[\s_-]?year|semi[\s_-]?annual|\bannual|dashboard|fact[\s_-]?sheet|tracking|commission|\baum\b|complaint|\bter\b|proxy|risk[\s_-]?o?[\s_-]?meter|voting|overlap|top[\s_-]?10|summary|\bsid\b|\bkim\b|financial|unaudited|audited|dividend|idcw|investor|branch|stress|liquidity|ratio|expense|performance|nav[\s_-]?history|brokerage|scheme[\s_-]?information|valuation|bank[\s_-]?list|holdings by issuer/i
const INCLUDE = /portfolio|monthly|holding/i

const fileName = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\b(small|mid|large|flexi|multi|micro|focused)\s*-?\s*cap\b/g, '$1cap')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(
        (w) =>
          w.length > 1 &&
          ![
            'fund',
            'direct',
            'regular',
            'plan',
            'growth',
            'option',
            'the',
            'of',
            'scheme',
            'portfolio',
            'monthly',
            'details',
            'as',
            'on',
            'for',
            'xls',
            'xlsx'
          ].includes(w)
      )
  )

/**
 * Picks the files to download: monthly portfolio spreadsheets of the newest month. When a house
 * publishes one file per scheme, only the files that name a fund you hold are taken.
 */
const stem = (url: string) =>
  fileName(url)
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()

/** Share of a fund's name words found in a label (1 = every word). */
const nameScore = (fund: string, label: string) => {
  const want = words(fund)
  const have = words(label)
  return [...want].filter((t) => have.has(t)).length / Math.max(1, want.size)
}

/** Word overlap over all words: a file name with many other words does not name the fund. */
const fileNameScore = (fund: string, label: string) => {
  const want = words(fund)
  const have = words(label)
  const common = [...want].filter((t) => have.has(t)).length
  return common / Math.max(1, new Set([...want, ...have]).size)
}

/**
 * A fund held, by every name it goes by: the name on your statement and the scheme's current
 * name in AMFI's NAV file (schemes get renamed, e.g. "Equity & Debt" to "Aggressive Hybrid").
 */
export type FundNames = string | string[]
const namesOf = (f: FundNames) => (Array.isArray(f) ? f : [f])

/** The labels that best name a fund (by any of its names), if they name it well enough. */
function bestFor<T>(fund: FundNames, items: T[], label: (x: T) => string, { score = nameScore, min = 0.75 } = {}): T[] {
  const hits = new Set<T>()
  for (const name of namesOf(fund)) {
    const scored = items.map((x) => ({ x, score: score(name, label(x)) }))
    const top = Math.max(0, ...scored.map((s) => s.score))
    if (top >= min) scored.filter((s) => s.score === top).forEach((s) => hits.add(s.x))
  }
  return [...hits]
}

/**
 * The "all schemes" file among per-scheme ones: says so, or is the plain name that the
 * scheme files add a prefix to (PPFAS_Monthly_Portfolio… beside PPLF_PPFAS_Monthly_Portfolio…).
 */
function consolidatedOf<T extends FoundLink & { label: string }>(files: T[]): T | null {
  const said = files.find((l) => /\ball\b|consolidated|combined|all[\s_-]?schemes|complete/i.test(l.label))
  if (said) return said
  const stems = files.map((l) => stem(l.url))
  return (
    files.find((_, i) => {
      const s = stems[i]
      return (
        s.length >= 8 &&
        stems.filter((o, j) => j !== i && o.endsWith(s) && /[\s_-]$/.test(o.slice(0, -s.length))).length >= 2
      )
    }) ?? null
  )
}

/**
 * Picks the files to download: monthly portfolio spreadsheets of the newest month. When a house
 * publishes one file per scheme, only the files that name a fund you hold are taken, or its
 * consolidated file, or, for a handful of files, all of them (the sheets are matched afterwards).
 */
/** Every month the page offers a file for, newest first. */
export function periodsOn(links: FoundLink[]): string[] {
  return [
    ...new Set(
      links
        .map((l) => ({ ...l, label: `${l.text} ${fileName(l.url)}` }))
        .filter((l) => !EXCLUDE.test(l.label) && INCLUDE.test(`${l.label} ${l.context ?? ''} ${l.url}`))
        .map((l) => periodOf(l.label) ?? periodOf(l.context ?? '') ?? periodOf(l.url))
        .filter((p): p is string => !!p)
    )
  ].sort().reverse()
}

export function pickFiles(links: FoundLink[], heldFunds: FundNames[], onlyPeriod?: string): { period: string; files: FoundLink[] } | null {
  const candidates = links
    .map((l) => ({ ...l, label: `${l.text} ${fileName(l.url)}` }))
    .filter((l) => !EXCLUDE.test(l.label) && INCLUDE.test(`${l.label} ${l.context ?? ''} ${l.url}`))
    .map((l) => ({ ...l, period: periodOf(l.label) ?? periodOf(l.context ?? '') ?? periodOf(l.url) }))
    .filter((l): l is typeof l & { period: string } => !!l.period)
  if (candidates.length === 0) return null
  const period =
    onlyPeriod ??
    candidates
      .map((c) => c.period)
      .sort()
      .pop()!
  const latest = candidates.filter((c) => c.period === period)
  if (latest.length <= 3) return { period, files: latest }

  // Many files for one month: one per scheme. Keep those whose own name or text names your funds.
  const chosen = new Map<string, FoundLink>()
  const unmatched: FundNames[] = []
  for (const fund of heldFunds) {
    const hits = bestFor(fund, latest, (l) => l.label)
    hits.forEach((l) => chosen.set(l.url, l))
    if (hits.length === 0) unmatched.push(fund)
  }
  if (unmatched.length) {
    // The rest: the consolidated file if there is one, else the scheme named in the link's row.
    const all = consolidatedOf(latest)
    if (all) chosen.set(all.url, all)
    else
      for (const fund of unmatched)
        bestFor(fund, latest, (l) => `${l.label} ${l.context ?? ''}`).forEach((l) => chosen.set(l.url, l))
  }
  if (chosen.size === 0 && latest.length <= 12) return { period, files: latest }
  return { period, files: [...chosen.values()] }
}

// ---------------- download and parse ----------------

async function download(url: string, referer: string, f?: FetchFn): Promise<Buffer> {
  // The whole download, body included, must finish within the timeout.
  return fetchWith(url, { fetch: f, timeoutMs: 180_000, headers: { Referer: referer } }, async (res) => {
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) throw new Error(`File too large (${Math.round(len / 1e6)} MB)`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('File too large')
    return buf
  })
}

/**
 * Workbooks inside a download: the file itself, or the spreadsheets in a zip archive. A zip of
 * one file per scheme (ICICI's has 150) is narrowed to the files named after your funds, unless
 * one of your funds has no file named after it.
 */
export function workbooksIn(url: string, buf: Buffer, heldFunds: FundNames[] = []): Buffer[] {
  if (!/\.zip(?:$|[?#])/i.test(url)) return [buf]
  const data = new Uint8Array(buf)
  const names: string[] = []
  unzipSync(data, {
    filter: (f) => {
      if (/\.(xlsx?|xlsb)$/i.test(f.name) && !f.name.startsWith('__MACOSX')) names.push(f.name)
      return false
    }
  })
  let keep = new Set(names)
  if (names.length > 3 && heldFunds.length) {
    const base = (n: string) =>
      n
        .split('/')
        .pop()!
        .replace(/\.[a-z]+$/i, '')
    const hits = heldFunds.map((fund) => bestFor(fund, names, base, { score: fileNameScore, min: 0.6 }))
    if (hits.every((h) => h.length > 0)) keep = new Set(hits.flat())
  }
  return Object.values(unzipSync(data, { filter: (f) => keep.has(f.name) })).map((u) => Buffer.from(u))
}

// ---------------- the monthly run ----------------

interface HeldFund {
  id: number
  name: string
  isin: string | null
  schemeName: string | null
  fundHouse: string
  latestAsOf: string | null
}

/** Funds whose monthly portfolios are fetched though no one holds them (followed from the fund screener). */
export const FOLLOWED_KEY = 'funds:followed'

function heldFunds(db: Db): HeldFund[] {
  const followed = JSON.parse(db.select().from(schema.settings).where(eq(schema.settings.key, FOLLOWED_KEY)).get()?.value ?? '[]') as string[]
  const followedIds = followed.length
    ? db.select({ id: schema.instruments.id }).from(schema.instruments).where(inArray(schema.instruments.amfiCode, followed)).all().map((r) => r.id)
    : []
  const ids = [
    ...new Set([
      ...listHoldings(db)
        .filter((h) => h.assetClass === 'MF' || h.assetClass === 'ETF')
        .map((h) => h.instrumentId),
      ...followedIds
    ])
  ]
  if (ids.length === 0) return []
  const instruments = db.select().from(schema.instruments).where(inArray(schema.instruments.id, ids)).all()
  const latest = new Map<number, string>()
  for (const r of db
    .select({ id: schema.fundHoldings.fundInstrumentId, asOf: schema.fundHoldings.asOf })
    .from(schema.fundHoldings)
    .where(inArray(schema.fundHoldings.fundInstrumentId, ids))
    .all()) {
    if (!latest.has(r.id) || r.asOf > latest.get(r.id)!) latest.set(r.id, r.asOf)
  }
  return instruments
    .filter((i) => i.fundHouse)
    .map((i) => ({
      id: i.id,
      name: i.name,
      isin: i.isin,
      schemeName: i.schemeName,
      fundHouse: i.fundHouse!,
      latestAsOf: latest.get(i.id) ?? null
    }))
}

/** Current scheme names by ISIN, from AMFI's NAV file (empty if it cannot be read). */
async function currentSchemeNames(f?: FetchFn): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    for (const s of await fetchNavAll(f)) {
      if (s.isinGrowth) out.set(s.isinGrowth, s.name)
      if (s.isinReinvest) out.set(s.isinReinvest, s.name)
    }
  } catch {
    /* statement names alone */
  }
  return out
}

/**
 * Records the current AMFI scheme name of funds that have none yet (normally done by the fund
 * refresh), so a file can be matched to a renamed scheme. Never fails: offline, nothing changes.
 */
export async function fillSchemeNames(db: Db, ids: number[], f?: FetchFn): Promise<void> {
  if (ids.length === 0) return
  const missing = db
    .select()
    .from(schema.instruments)
    .where(inArray(schema.instruments.id, ids))
    .all()
    .filter((i) => i.isin && !i.schemeName)
  if (missing.length === 0) return
  const names = await currentSchemeNames(f)
  for (const i of missing) {
    const name = names.get(i.isin!)
    if (name) db.update(schema.instruments).set({ schemeName: name }).where(eq(schema.instruments.id, i.id)).run()
  }
}

/** The newest month a disclosure can exist for: last month (portfolios are published after month end). */
export function latestPossiblePeriod(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function getDisclosureStatus(db: Db): DisclosureStatus[] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, STATUS_KEY)).get()
  return row ? (JSON.parse(row.value) as DisclosureStatus[]) : []
}

/**
 * Checks every fund house you hold a fund or ETF from and stores any newer monthly portfolio.
 * Returns the names of houses whose file could not be found or read.
 */
export async function syncDisclosures(db: Db, deps: DisclosureDeps = {}, force = false): Promise<string[]> {
  const funds = heldFunds(db)
  const nowIso = (deps.now ?? new Date()).toISOString()
  const latestPossible = latestPossiblePeriod(deps.now ?? new Date())
  const previous = new Map(getDisclosureStatus(db).map((s) => [s.amc, s]))
  const byHouse = new Map<string, HeldFund[]>()
  for (const f of funds) byHouse.set(f.fundHouse, [...(byHouse.get(f.fundHouse) ?? []), f])
  if (byHouse.size === 0) return []

  const registry = await loadRegistry(db, deps.fetch)
  const statuses: DisclosureStatus[] = []
  let schemeNames: Promise<Map<string, string>> | null = null // read once, only if a house needs checking

  for (const [house, houseFunds] of byHouse) {
    const amc = findAmc(house, registry)
    const base: DisclosureStatus = {
      amcId: amc?.id ?? null,
      amc: amc?.name ?? house,
      page: amc?.monthlyUrl ?? null,
      period: null,
      state: 'NOT_FOUND',
      message: null,
      files: [],
      funds: [],
      unmatched: [],
      checkedAt: nowIso
    }
    const done = houseFunds.every((f) => f.latestAsOf && f.latestAsOf.slice(0, 7) >= latestPossible)
    if (done && !force) {
      statuses.push({
        ...(previous.get(base.amc) ?? base),
        state: 'UP_TO_DATE',
        checkedAt: nowIso,
        period: latestPossible
      })
      continue
    }
    if (!amc?.monthlyUrl) {
      statuses.push({ ...base, state: 'NO_PAGE', message: 'AMFI lists no monthly portfolio page for this fund house' })
      continue
    }

    try {
      const adapter = adapterFor(amc.monthlyUrl)
      if (adapter?.manual) {
        statuses.push({ ...base, message: adapter.manual })
        continue
      }
      schemeNames ??= currentSchemeNames(deps.fetch)
      const current = await schemeNames
      const fundNames = houseFunds.map((f) => ({
        f,
        names: [...new Set([f.name, f.schemeName, f.isin ? current.get(f.isin) : null].filter((n): n is string => !!n))]
      }))
      const names = fundNames.map((x) => x.names)
      // A house-specific API if the page is a form; else plain HTML; else the page rendered in a
      // hidden browser window (which also reads the JSON the page loads).
      let pick: ReturnType<typeof pickFiles> = null
      // The links the page offered, kept for a second look at the month before.
      let links: FoundLink[] = []
      if (adapter?.links) pick = pickFiles((links = await adapter.links(deps.fetch, deps.now ?? new Date())), names)
      if (!pick || pick.files.length === 0) {
        try {
          links = extractLinks(await getText(amc.monthlyUrl, { fetch: deps.fetch, timeoutMs: 30_000 }), amc.monthlyUrl)
          pick = pickFiles(links, names)
        } catch {
          /* blocked or failed: try rendering */
        }
      }
      if ((!pick || pick.files.length === 0) && deps.renderLinks) {
        // A page that never finishes must not hold up the other fund houses.
        let timer: ReturnType<typeof setTimeout> | undefined
        const gaveUp = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The fund house page did not finish loading')), RENDER_LIMIT_MS)
        })
        try {
          const plan = adapter?.render?.(deps.now ?? new Date())
          links = await Promise.race([deps.renderLinks(amc.monthlyUrl, plan), gaveUp])
          pick = pickFiles(links, names)
        } finally {
          clearTimeout(timer)
        }
      }
      if (!pick || pick.files.length === 0) {
        statuses.push({ ...base, period: pick?.period ?? null, message: 'No monthly portfolio file found on the page' })
        continue
      }
      // Already have this month for every fund? Nothing to download.
      if (!force && houseFunds.every((f) => f.latestAsOf && f.latestAsOf.slice(0, 7) >= pick!.period)) {
        statuses.push({ ...base, state: 'UP_TO_DATE', period: pick.period, files: pick.files.map((x) => x.url) })
        continue
      }

      // One month's files: downloaded, read, and each fund's best-matching sheet saved.
      const readMonth = async (p: NonNullable<ReturnType<typeof pickFiles>>, only: typeof fundNames) => {
        const portfolios: DisclosedPortfolio[] = []
        for (const file of p.files) {
          const buf = await download(file.url, amc.monthlyUrl!, deps.fetch)
          for (const wb of workbooksIn(file.url, buf, only.map((x) => x.names))) portfolios.push(...parseAmcWorkbook(wb))
        }
        const asOfFallback = monthEnd(p.period)
        // Best sheet per fund over all its names.
        const best = new Map<number, ReturnType<typeof matchPortfolios>[number]>()
        for (const m of matchPortfolios(
          portfolios,
          only.flatMap((x) => x.names.map((name) => ({ id: x.f.id, name })))
        ))
          if (!best.has(m.fundId) || m.score > best.get(m.fundId)!.score) best.set(m.fundId, m)
        const found = [...best.values()]
        db.transaction((tx) => {
          for (const m of found) {
            saveFundHoldings(tx as unknown as Db, {
              fundId: m.fundId,
              asOf: m.portfolio.asOf ?? asOfFallback,
              holdings: m.portfolio.holdings,
              source: 'AMC_AUTO'
            })
          }
        })
        return { found, sheets: portfolios.length }
      }
      const { found: matches, sheets } = await readMonth(pick, fundNames)
      // A fund with a single month on file also gets the month before, so changes show at once.
      const months = (id: number) =>
        new Set(db.select({ a: schema.fundHoldings.asOf }).from(schema.fundHoldings).where(eq(schema.fundHoldings.fundInstrumentId, id)).all().map((r) => r.a)).size
      const lonely = fundNames.filter((x) => months(x.f.id) === 1)
      const before = periodsOn(links).find((p) => p < pick!.period)
      if (lonely.length && before) {
        const prev = pickFiles(links, lonely.map((x) => x.names), before)
        if (prev?.files.length) await readMonth(prev, lonely).catch(() => null)
      }
      const portfolios = { length: sheets }
      const matchedIds = new Set(matches.map((m) => m.fundId))
      statuses.push({
        ...base,
        state: matches.length ? 'UPDATED' : 'NOT_FOUND',
        period: pick.period,
        files: pick.files.map((x) => x.url),
        funds: houseFunds.filter((f) => matchedIds.has(f.id)).map((f) => f.name),
        unmatched: houseFunds.filter((f) => !matchedIds.has(f.id)).map((f) => f.name),
        message: matches.length ? null : `Downloaded ${portfolios.length} scheme sheets but none matched your funds`
      })
    } catch (e) {
      statuses.push({ ...base, state: 'ERROR', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const value = JSON.stringify(statuses)
  db.insert(schema.settings)
    .values({ key: STATUS_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
  return statuses
    .filter((s) => s.state === 'NOT_FOUND' || s.state === 'ERROR' || s.state === 'NO_PAGE')
    .map((s) => s.amc)
}
