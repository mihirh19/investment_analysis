import { desc, eq, like } from 'drizzle-orm'
import type { FundPlan, FundsReport } from '@shared/types'
import { schema, type Db } from '../db'
import { pickLatestDisclosure } from './exposure'
import { listHoldings } from './holdings'

// Mutual fund and ETF insights: how much the funds hold the same companies, where the money sits by
// fund house and category, and which holdings are in Regular plans (with the cost of that).

type FundRow = typeof schema.fundHoldings.$inferSelect

/** settings key holding the Direct-plan counterpart of a Regular-plan fund: {"code","name"}. */
export const directPlanKey = (instrumentId: number) => `directPlan:${instrumentId}`
/** price_history key for a scheme that is not held, by AMFI code (e.g. a Direct counterpart). */
export const amfiHistoryKey = (code: string) => `MF:${code}`

export function planOf(name: string, assetClass: string): FundPlan {
  if (assetClass === 'ETF') return 'ETF'
  if (/\bdirect\b/i.test(name)) return 'DIRECT'
  if (/\bregular\b/i.test(name)) return 'REGULAR'
  return 'NOT_STATED'
}

/** "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" → "Parag Parikh Flexi Cap Fund". */
export function shortFundName(name: string): string {
  const head = name.split(/\s+[-–]\s+|\s*\(/)[0].trim()
  const cleaned = head.replace(/\s+(direct|regular)(\s+plan)?$/i, '').trim()
  return cleaned.length > 40 ? cleaned.slice(0, 39).trimEnd() + '…' : cleaned
}

/** "Equity Scheme - Flexi Cap Fund" → { group: 'Equity', name: 'Flexi Cap Fund' }. */
export function splitCategory(raw: string | null): { group: string; name: string } {
  if (!raw) return { group: 'Other', name: 'Not known' }
  const m = raw.match(/^\s*(equity|debt|hybrid|solution oriented|other)\s+schemes?\s*-\s*(.+)$/i)
  if (m) {
    const g = m[1].toLowerCase()
    return { group: g === 'solution oriented' ? 'Solution oriented' : g[0].toUpperCase() + g.slice(1), name: m[2].trim() }
  }
  const t = raw.trim()
  if (/etf|exchange traded/i.test(t)) return { group: 'ETF', name: t.replace(/^exchange traded funds?\s*\(etfs?\)\s*-?\s*/i, '') || 'ETF' }
  if (/^equity$/i.test(t)) return { group: 'Equity', name: 'Equity' }
  if (/^debt$|liquid/i.test(t)) return { group: 'Debt', name: t }
  return { group: 'Other', name: t }
}

/** Words that name the plan or option rather than the scheme. */
const PLAN_WORDS = /\b(direct|regular|plan|option|options|growth|idcw|dividend|payout|reinvestment|reinvest|of|the|and|fund|scheme|retail)\b/g

function baseTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(PLAN_WORDS, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

const optionOf = (name: string) => (/\b(idcw|dividend|payout|reinvest)/i.test(name) ? 'IDCW' : 'GROWTH')

const optionKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\boption\b/g, '').replace(/\s+/g, ' ').trim()

interface SchemeLike {
  code: string
  name: string
  fundHouse: string | null
  isinGrowth?: string | null
  isinReinvest?: string | null
  plan?: string | null
  option?: string | null
}

/**
 * The Direct plan of the same scheme and option in AMFI's list. Prefers AMFI's own columns: the row
 * with the fund's ISIN gives the scheme name and option, and the Direct row with the same name and
 * option is the counterpart. Falls back to comparing names with plan and option words removed.
 */
export function findDirectCounterpart<T extends SchemeLike>(
  regular: { isin?: string | null; name: string; fundHouse: string | null },
  schemes: T[]
): T | null {
  const lowest = (xs: T[]) => (xs.length ? [...xs].sort((a, b) => a.code.localeCompare(b.code))[0] : null)
  const self = regular.isin
    ? schemes.find((s) => s.isinGrowth === regular.isin || s.isinReinvest === regular.isin)
    : undefined
  if (self?.plan) {
    const same = schemes.filter(
      (s) => s.name === self.name && s.fundHouse === self.fundHouse && /\bdirect\b/i.test(s.plan ?? '')
    )
    return lowest(same.filter((s) => optionKey(s.option) === optionKey(self.option))) ??
      lowest(same.filter((s) => optionOf(s.option ?? '') === optionOf(self.option ?? '')))
  }
  const full = (s: { name: string; plan?: string | null; option?: string | null }) =>
    `${s.name} ${s.plan ?? ''} ${s.option ?? ''}`
  const want = baseTokens(regular.name).join(' ')
  const opt = optionOf(regular.name)
  const sameHouse = (s: T) =>
    !regular.fundHouse || !s.fundHouse || s.fundHouse.toLowerCase() === regular.fundHouse.toLowerCase()
  return lowest(
    schemes.filter(
      (s) =>
        /\bdirect\b/i.test(full(s)) &&
        sameHouse(s) &&
        optionOf(full(s)) === opt &&
        baseTokens(full(s)).join(' ') === want
    )
  )
}
/** Overlap of two portfolios: the sum over shared holdings of the smaller weight (0 = none, 1 = identical). */
export function overlapOf(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0
  for (const [k, wa] of a) {
    const wb = b.get(k)
    if (wb !== undefined) s += Math.min(wa, wb)
  }
  return s
}

/** Disclosure rows can carry a type prefix: "EQ - HDFC BANK LIMITED". */
export const cleanHoldingName = (name: string) => name.replace(/^\s*(eq|equity|debt|dt)\s*[-:]\s*/i, '').trim()

const keyOf = (r: { isin: string | null; name: string }) =>
  r.isin ? r.isin.toUpperCase() : r.name.toLowerCase().replace(/\b(ltd|limited)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Weights by holding from one disclosure, scaled to add up to 1; aggregates (sector-only rows) dropped. */
export function weightsOf(rows: FundRow[]): Map<string, { weight: number; name: string; isin: string | null }> {
  const usable = rows.filter((r) => r.weight > 0 && !(r.source === 'YAHOO' && !r.isin) && r.assetType !== 'CASH')
  const total = usable.reduce((s, r) => s + r.weight, 0)
  const m = new Map<string, { weight: number; name: string; isin: string | null }>()
  if (total <= 0) return m
  for (const r of usable) {
    const k = keyOf(r)
    const e = m.get(k) ?? { weight: 0, name: cleanHoldingName(r.name), isin: r.isin }
    e.weight += r.weight / total
    m.set(k, e)
  }
  return m
}

/** Return over the last year from a close series (weekly is fine): null without a year of history. */
export function oneYearReturn(series: { date: string; close: number }[]): number | null {
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - 365 * 86400000).toISOString().slice(0, 10)
  let start: { date: string; close: number } | null = null
  for (const p of series) if (p.date <= cutoff) start = p
  // Allow a week of slack for weekly series.
  if (!start || Date.parse(cutoff) - Date.parse(start.date) > 10 * 86400000) return null
  return last.close / start.close - 1
}

export const YOUR_SHARES = 0

export function computeFunds(db: Db, personId?: number): FundsReport {
  const rows = listHoldings(db, personId)
  const instruments = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const disclosures = pickLatestDisclosure(db.select().from(schema.fundHoldings).orderBy(desc(schema.fundHoldings.asOf)).all())
  const settings = new Map(
    db
      .select()
      .from(schema.settings)
      .where(like(schema.settings.key, 'directPlan:%'))
      .all()
      .map((s) => [s.key, s.value])
  )
  const history = (key: string) =>
    db
      .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
      .from(schema.priceHistory)
      .where(eq(schema.priceHistory.key, key))
      .orderBy(schema.priceHistory.date)
      .all()

  // ---------- one entry per fund (summed across accounts and people) ----------
  const byFund = new Map<number, { value: number; people: Set<string> }>()
  const direct = new Map<string, { value: number; name: string; isin: string | null }>()
  for (const r of rows) {
    const v = r.marketValueInr ?? r.investedInr ?? 0
    if (v <= 0) continue
    if (r.assetClass === 'MF' || r.assetClass === 'ETF') {
      const f = byFund.get(r.instrumentId) ?? { value: 0, people: new Set<string>() }
      f.value += v
      f.people.add(r.personName)
      byFund.set(r.instrumentId, f)
    } else if (r.assetClass === 'EQUITY_IN' || r.assetClass === 'EQUITY_US') {
      const k = keyOf({ isin: r.isin, name: r.instrumentName })
      const d = direct.get(k) ?? { value: 0, name: r.instrumentName, isin: r.isin }
      d.value += v
      direct.set(k, d)
    }
  }

  const funds: FundsReport['funds'] = [...byFund]
    .map(([id, f]) => {
      const i = instruments.get(id)!
      // The statement's name, as on every other page (AMFI's current name can differ after a rename).
      const name = i.name
      const plan = planOf(`${i.name} ${i.schemeName ?? ''}`, i.assetClass)
      const cat = splitCategory(i.mfCategory ?? i.mfType ?? (i.assetClass === 'ETF' ? 'ETF' : null))
      const disc = disclosures.get(id)
      let directPlan: FundsReport['funds'][number]['directPlan'] = null
      if (plan === 'REGULAR') {
        const raw = settings.get(directPlanKey(id))
        const cp = raw ? (JSON.parse(raw) as { code: string; name: string }) : null
        if (cp) {
          const rReg = oneYearReturn(history(`I:${id}`))
          const rDir = oneYearReturn(history(amfiHistoryKey(cp.code)))
          const gap = rReg !== null && rDir !== null ? rDir - rReg : null
          directPlan = { code: cp.code, name: cp.name, gap1y: gap, extraCostInr: gap !== null ? gap * f.value : null }
        } else directPlan = { code: null, name: null, gap1y: null, extraCostInr: null }
      }
      return {
        instrumentId: id,
        name: i.name,
        shortName: shortFundName(name),
        fundHouse: i.fundHouse,
        categoryGroup: cat.group,
        category: cat.name,
        plan,
        valueInr: f.value,
        people: [...f.people].sort(),
        holdingsAsOf: disc?.[0]?.asOf ?? null,
        holdingsSource: disc?.[0]?.source ?? null,
        holdingsCount: disc ? weightsOf(disc).size : 0,
        directPlan
      }
    })
    .sort((a, b) => b.valueInr - a.valueInr)
  const totalFundsInr = funds.reduce((s, f) => s + f.valueInr, 0)

  // ---------- overlap ----------
  const directTotal = [...direct.values()].reduce((s, d) => s + d.value, 0)
  const portfolios: { id: number; label: string; w: Map<string, { weight: number; name: string; isin: string | null }> }[] = []
  if (directTotal > 0)
    portfolios.push({
      id: YOUR_SHARES,
      label: 'Your shares',
      w: new Map([...direct].map(([k, d]) => [k, { weight: d.value / directTotal, name: d.name, isin: d.isin }]))
    })
  for (const f of funds) {
    // Debt funds hold bonds, not companies: they would show 0% against everything.
    if (f.categoryGroup === 'Debt' || /\b(liquid|overnight|money market|gilt)\b/i.test(f.name)) continue
    const disc = disclosures.get(f.instrumentId)
    const w = disc ? weightsOf(disc) : null
    if (w && w.size >= 3) portfolios.push({ id: f.instrumentId, label: f.shortName, w })
  }
  const plain = portfolios.map((p) => new Map([...p.w].map(([k, v]) => [k, v.weight])))
  const matrix = portfolios.map((_, a) => portfolios.map((__, b) => (a === b ? null : overlapOf(plain[a], plain[b]))))
  const pairs: FundsReport['overlap']['pairs'] = []
  for (let a = 0; a < portfolios.length; a++)
    for (let b = a + 1; b < portfolios.length; b++) {
      const shared = [...portfolios[a].w]
        .filter(([k]) => portfolios[b].w.has(k))
        .map(([k, va]) => ({ name: va.name, isin: va.isin, weightA: va.weight, weightB: portfolios[b].w.get(k)!.weight }))
        .sort((x, y) => Math.min(y.weightA, y.weightB) - Math.min(x.weightA, x.weightB))
      pairs.push({ a: portfolios[a].id, b: portfolios[b].id, overlap: matrix[a][b]!, sharedCount: shared.length, shared: shared.slice(0, 20) })
    }
  pairs.sort((x, y) => y.overlap - x.overlap)

  // ---------- where each company comes from ----------
  const companies = new Map<string, { name: string; isin: string | null; directInr: number; sources: Map<string, number> }>()
  const addCo = (k: string, name: string, isin: string | null, label: string, v: number, isDirect: boolean) => {
    const c = companies.get(k) ?? { name, isin, directInr: 0, sources: new Map<string, number>() }
    if (isDirect) c.directInr += v
    c.sources.set(label, (c.sources.get(label) ?? 0) + v)
    companies.set(k, c)
  }
  for (const [k, d] of direct) addCo(k, d.name, d.isin, 'Held directly', d.value, true)
  for (const f of funds) {
    const disc = disclosures.get(f.instrumentId)
    if (!disc) continue
    const eq = disc.filter((r) => r.assetType === 'EQUITY' && !(r.source === 'YAHOO' && !r.isin))
    const sum = disc.reduce((s, r) => s + r.weight, 0)
    const scale = sum > 0.5 ? 1 / sum : 1
    for (const r of eq) addCo(keyOf(r), cleanHoldingName(r.name), r.isin, f.shortName, f.valueInr * r.weight * scale, false)
  }
  const companyList = [...companies.values()]
    .map((c) => ({
      name: c.name,
      isin: c.isin,
      valueInr: [...c.sources.values()].reduce((s, v) => s + v, 0),
      directInr: c.directInr,
      sources: [...c.sources].map(([label, valueInr]) => ({ label, valueInr })).sort((a, b) => b.valueInr - a.valueInr)
    }))
    .filter((c) => c.sources.length > 1)
    .sort((a, b) => b.valueInr - a.valueInr)
    .slice(0, 25)

  // ---------- fund house and category ----------
  const group = <K extends string>(key: (f: (typeof funds)[number]) => K) => {
    const m = new Map<K, { valueInr: number; funds: string[] }>()
    for (const f of funds) {
      const g = m.get(key(f)) ?? { valueInr: 0, funds: [] }
      g.valueInr += f.valueInr
      g.funds.push(f.shortName)
      m.set(key(f), g)
    }
    return [...m].sort((a, b) => b[1].valueInr - a[1].valueInr)
  }
  const byHouse = group((f) => f.fundHouse ?? 'Not known').map(([name, g]) => ({ name, ...g }))
  const byCategory = group((f) => `${f.categoryGroup}|${f.category}`).map(([k, g]) => {
    const [grp, name] = k.split('|')
    return { group: grp, name, ...g }
  })

  // ---------- findings ----------
  const notes: string[] = []
  const top = byHouse[0]
  if (top && totalFundsInr > 0 && top.valueInr / totalFundsInr > 0.5 && funds.length > 2 && top.name !== 'Not known')
    notes.push(`${Math.round((top.valueInr / totalFundsInr) * 100)}% of your fund money is with ${top.name}.`)
  for (const c of byCategory)
    if (c.funds.length >= 3 && c.group !== 'Debt' && c.name !== 'Not known')
      notes.push(`You hold ${c.funds.length} ${c.name} funds; funds in one category tend to own the same companies.`)
  for (const p of pairs.filter((x) => x.overlap >= 0.5 && x.a !== YOUR_SHARES).slice(0, 3)) {
    const la = portfolios.find((x) => x.id === p.a)!.label
    const lb = portfolios.find((x) => x.id === p.b)!.label
    notes.push(`${la} and ${lb} overlap by ${Math.round(p.overlap * 100)}%: much of the second adds little variety.`)
  }
  const regular = funds.filter((f) => f.plan === 'REGULAR')
  const extra = regular.reduce((s, f) => s + Math.max(0, f.directPlan?.extraCostInr ?? 0), 0)
  if (regular.length)
    notes.push(
      `${regular.length} fund${regular.length > 1 ? 's are' : ' is'} in a Regular plan` +
        (extra > 0 ? `, costing about ₹${Math.round(extra).toLocaleString('en-IN')} a year more than the Direct plan.` : '.')
    )
  const missing = funds.filter((f) => !f.holdingsAsOf && f.categoryGroup !== 'Debt').map((f) => f.shortName)
  if (missing.length)
    notes.push(`No portfolio yet for ${missing.join(', ')}, so ${missing.length > 1 ? 'they are' : 'it is'} not in the overlap.`)

  return {
    totalFundsInr,
    funds,
    overlap: { portfolios: portfolios.map((p) => ({ id: p.id, label: p.label })), matrix, pairs },
    companies: companyList,
    byHouse,
    byCategory,
    notes
  }
}
