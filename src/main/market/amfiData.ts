import { eq } from 'drizzle-orm'
import XLSX from 'xlsx'
import type { SchemeFacts } from '@shared/insights'
import { schema, type Db } from '../db'
import { nameSimilarity } from '../importers/amcPortfolio'
import type { FetchFn } from './http'

/**
 * Facts about every mutual fund and ETF from AMFI's own pages (the ones behind amfiindia.com's
 * "Fund performance" and "TER of MF schemes"): returns over 1, 3, 5 and 10 years for the Regular
 * and Direct plans and the benchmark, fund size, benchmark name and riskometer, and the total
 * expense ratio. Refreshed weekly; kept as JSON in settings.
 */

const BASE = 'https://www.amfiindia.com'
const POLL = `${BASE}/gateway/pollingsebi/api/amfi`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const KEY = 'amfi:schemes'

interface PerfRow {
  schemeName: string
  benchmark: string | null
  riskometerScheme: string | null
  navDate: string
  dailyAUM: number | null
  [k: string]: unknown
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const amfiDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`

async function post<T>(f: FetchFn, path: string, body: unknown): Promise<T> {
  const res = await f(`${POLL}${path}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Referer: `${BASE}/otherdata/fund-performance` },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`AMFI fund performance: ${res.status}`)
  return (await res.json()) as T
}

/** Every open-ended scheme's returns, size and benchmark on the latest day AMFI has published. */
export async function fetchFundPerformance(f: FetchFn = fetch, today = new Date()): Promise<{ date: string; schemes: SchemeFacts[] }> {
  const categories = [1, 2, 3, 4, 5]
  const subs: { category: number; id: number; name: string }[] = []
  for (const category of categories) {
    const r = await post<{ data?: { id: number; name: string }[] }>(f, '/getsubcategory', { category })
    for (const s of r.data ?? []) subs.push({ category, id: s.id, name: s.name })
  }
  if (subs.length === 0) throw new Error('AMFI fund performance: no categories')

  // The latest business day with figures: try back from yesterday.
  let date: string | null = null
  const first = subs.find((s) => s.category === 1) ?? subs[0]
  for (let back = 1; back <= 10 && !date; back++) {
    const d = amfiDate(new Date(today.getTime() - back * 86400000))
    const r = await post<{ data?: PerfRow[] }>(f, '/fundperformance', {
      maturityType: 1,
      category: first.category,
      subCategory: first.id,
      mfid: 0,
      reportDate: d
    })
    if ((r.data?.length ?? 0) > 0) date = d
  }
  if (!date) throw new Error('AMFI fund performance: nothing published in the last ten days')

  const schemes: SchemeFacts[] = []
  for (const s of subs) {
    const r = await post<{ data?: PerfRow[] }>(f, '/fundperformance', {
      maturityType: 1,
      category: s.category,
      subCategory: s.id,
      mfid: 0,
      reportDate: date
    })
    for (const row of r.data ?? []) {
      const ret = (p: string) => ({
        regular: num(row[`return${p}Regular`]),
        direct: num(row[`return${p}Direct`]),
        benchmark: num(row[`return${p}Benchmark`])
      })
      schemes.push({
        name: row.schemeName.trim(),
        category: s.name,
        categoryGroup: ['', 'Equity', 'Debt', 'Hybrid', 'Solution oriented', 'Other'][s.category],
        benchmark: row.benchmark?.trim() || null,
        risk: row.riskometerScheme ?? null,
        aumCr: num(row.dailyAUM),
        navDate: row.navDate,
        r1y: ret('1Year'),
        r3y: ret('3Year'),
        r5y: ret('5Year'),
        r10y: ret('10Year'),
        terRegular: null,
        terDirect: null
      })
    }
  }
  return { date, schemes }
}

/** The latest total expense ratio of every scheme, Regular and Direct, from AMFI's monthly sheet. */
export async function fetchTer(f: FetchFn = fetch, today = new Date()): Promise<Map<string, { regular: number | null; direct: number | null }>> {
  const fy = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1
  const headers = { 'User-Agent': UA, Referer: `${BASE}/ter-of-mf-schemes` }
  const months = (await (await f(`${BASE}/api/populate-ter-month?year=${fy}-${fy + 1}`, { headers })).json()) as {
    MonthNumber: string
  }[]
  const out = new Map<string, { regular: number | null; direct: number | null; date: number }>()
  for (const m of months.slice(0, 2)) {
    const res = await f(
      `${BASE}/api/populate-te-rdata-revised?MF_ID=All&Month=${m.MonthNumber}&strCat=-1&strType=-1&excel=true`,
      { headers }
    )
    if (!res.ok) continue
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    const head = (rows[0] ?? []).map((h) => String(h).toLowerCase())
    const iName = head.findIndex((h) => h === 'scheme name')
    const iDate = head.findIndex((h) => h === 'ter date')
    const iReg = head.findIndex((h) => h.startsWith('regular plan - total ter'))
    const iDir = head.findIndex((h) => h.startsWith('direct plan - total ter'))
    if (iName < 0 || iReg < 0) continue
    for (const r of rows.slice(1)) {
      const name = String(r[iName] ?? '').trim()
      if (!name) continue
      const date = Number(r[iDate]) || 0
      const prev = out.get(name)
      if (prev && prev.date >= date) continue
      // A plan a scheme doesn't offer (an ETF has no Direct plan) is left at 0 in the sheet: not a cost.
      const n = (v: unknown) => (v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v))
      out.set(name, { regular: n(r[iReg]), direct: n(r[iDir]), date })
    }
    if (out.size) break
  }
  return new Map([...out].map(([k, v]) => [k, { regular: v.regular, direct: v.direct }]))
}

/** Downloads both and stores them together. At most weekly unless forced. */
export async function refreshSchemeFacts(db: Db, f: FetchFn = fetch, force = false): Promise<number> {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  const at = row ? (JSON.parse(row.value) as { at: string }).at : null
  if (!force && at && Date.now() - Date.parse(at) < 7 * 86400000) return 0
  const { date, schemes } = await fetchFundPerformance(f)
  const ter = await fetchTer(f).catch(() => new Map<string, { regular: number | null; direct: number | null }>())
  // TER names match the performance names nearly always (exactly, or once spacing and punctuation
  // are ignored); the rest are matched by similarity among the same fund house's names only. The
  // work is done in slices so the app stays responsive while it runs.
  const byKey = new Map([...ter].map(([n, v]) => [nameKey(n), v]))
  const byHouse = groupByHouse([...ter.keys()])
  for (let i = 0; i < schemes.length; i++) {
    const s = schemes[i]
    let t = ter.get(s.name) ?? byKey.get(nameKey(s.name))
    if (!t) {
      let best: { name: string; score: number } | null = null
      for (const n of byHouse.get(houseOf(s.name)) ?? []) {
        const score = nameSimilarity(s.name, n)
        if (!best || score > best.score) best = { name: n, score }
      }
      t = best && best.score >= 0.85 ? ter.get(best.name) : undefined
    }
    s.terRegular = t?.regular ?? null
    s.terDirect = t?.direct ?? null
    if (i % 100 === 99) await new Promise((r) => setImmediate(r))
  }
  const value = JSON.stringify({ at: new Date().toISOString(), date, schemes })
  db.insert(schema.settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
  return schemes.length
}

export function storedSchemeFacts(db: Db): { date: string | null; schemes: SchemeFacts[] } {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
  if (!row) return { date: null, schemes: [] }
  const v = JSON.parse(row.value) as { date: string; schemes: SchemeFacts[] }
  return { date: v.date, schemes: v.schemes }
}

/** A name with case, punctuation and plan words ignored, for exact matching. */
const nameKey = (n: string) =>
  n
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(direct|regular|plan|growth|option|idcw|fund)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
/** The first word of a scheme's name is its fund house ("HDFC", "Parag", "ICICI"). */
const houseOf = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
function groupByHouse(names: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const n of names) m.set(houseOf(n), [...(m.get(houseOf(n)) ?? []), n])
  return m
}

/** The AMFI facts for a fund held, by its name (plan words ignored). */
export function factsFor(schemes: SchemeFacts[], name: string): SchemeFacts | null {
  const key = nameKey(name)
  const exact = schemes.find((s) => nameKey(s.name) === key)
  if (exact) return exact
  const house = houseOf(name)
  let best: { s: SchemeFacts; score: number } | null = null
  for (const s of schemes) {
    if (houseOf(s.name) !== house) continue
    const score = nameSimilarity(name, s.name)
    if (!best || score > best.score) best = { s, score }
  }
  return best && best.score >= 0.75 ? best.s : null
}
