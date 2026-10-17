import { and, eq, gte, inArray } from 'drizzle-orm'
import {
  EXPENSE_KEYS,
  EXPENSE_LABELS,
  PLAN_BUCKETS,
  type Forecast,
  type ForecastYear,
  type Plan,
  type PlanBucket,
  type PlanSip
} from '@shared/plan'
import type { HoldingRow } from '@shared/types'
import { schema, type Db } from '../db'
import { storedCpi } from '../market/cpi'
import { parseEpfMeta } from './epf'
import { splitCategory } from './fundInsights'
import { listHoldings } from './holdings'

/**
 * Projects today's investments forward month by month to the target year: each part grows at its
 * own assumed return, SIPs go in with their yearly step-up, EPF contributions continue until
 * retirement, goals are paid out in their year, and after retirement living costs are drawn.
 * Values are shown in rupees of each year and in today's rupees, deflated both by general
 * inflation and by the household's own spending mix (categories inflate at different rates).
 * A low and a high run, with returns moved by the spread, give the range.
 */

const PLAN_KEY = 'plan'

export const DEFAULT_RETURNS: Record<PlanBucket, number> = {
  EQUITY: 11,
  DEBT: 7,
  GOLD: 8,
  EPF: 8.25,
  PPF: 7.1,
  NPS: 9,
  PROPERTY: 5,
  CASH: 3,
  OTHER: 6
}

/** How much of the ± spread each part's return moves by in the low and high runs. */
const SPREAD_WEIGHT: Record<PlanBucket, number> = {
  EQUITY: 1,
  DEBT: 0.5,
  GOLD: 1,
  EPF: 0,
  PPF: 0,
  NPS: 0.7,
  PROPERTY: 0.5,
  CASH: 0,
  OTHER: 1
}

const zero = (): Record<PlanBucket, number> =>
  Object.fromEntries(PLAN_BUCKETS.map((b) => [b, 0])) as Record<PlanBucket, number>

export function defaultPlan(db: Db): Plan {
  const cpi = storedCpi(db)
  return {
    targetYear: 2060,
    retireYear: null,
    birthYears: {},
    returns: { ...DEFAULT_RETURNS },
    inflation: Math.round(cpi.general.tenYear * 10) / 10,
    withdrawalRate: 3.5,
    spread: 2,
    epfGrowth: 5,
    expenses: EXPENSE_KEYS.map((key) => ({ key, monthly: 0, inflation: null })),
    sips: [],
    goals: []
  }
}

export function loadPlan(db: Db): Plan {
  const base = defaultPlan(db)
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, PLAN_KEY)).get()
  if (!row) return base
  const saved = JSON.parse(row.value) as Partial<Plan>
  const expenses = EXPENSE_KEYS.map(
    (key) => saved.expenses?.find((e) => e.key === key) ?? { key, monthly: 0, inflation: null }
  )
  return { ...base, ...saved, returns: { ...base.returns, ...saved.returns }, expenses }
}

export function savePlan(db: Db, plan: Plan, today = new Date()): void {
  const year = today.getUTCFullYear()
  if (!(plan.targetYear > year && plan.targetYear <= year + 80)) throw new Error(`Pick a year between ${year + 1} and ${year + 80}`)
  if (plan.retireYear !== null && !(plan.retireYear >= year && plan.retireYear <= plan.targetYear))
    throw new Error('The retirement year should fall between now and the forecast year')
  for (const [b, r] of Object.entries(plan.returns))
    if (!Number.isFinite(r) || r < -20 || r > 40) throw new Error(`Enter a return for ${b.toLowerCase()} between −20% and 40%`)
  if (!(plan.inflation >= 0 && plan.inflation <= 25)) throw new Error('Enter inflation between 0% and 25%')
  if (!(plan.withdrawalRate > 0 && plan.withdrawalRate <= 10)) throw new Error('Enter a withdrawal rate between 0% and 10%')
  for (const s of plan.sips) {
    if (!s.name.trim()) throw new Error('Name each SIP')
    if (!(s.monthly > 0)) throw new Error(`Enter the monthly amount for ${s.name}`)
    if (!(s.stepUpPct >= 0 && s.stepUpPct <= 50)) throw new Error(`Enter a step-up between 0% and 50% for ${s.name}`)
    if (!/^\d{4}-\d{2}$/.test(s.start)) throw new Error(`Enter the month ${s.name} started`)
  }
  for (const g of plan.goals) {
    if (!g.name.trim()) throw new Error('Name each goal')
    if (!(g.costToday > 0)) throw new Error(`Enter what ${g.name} would cost today`)
    if (!(g.year >= year && g.year <= plan.targetYear)) throw new Error(`${g.name}: pick a year up to ${plan.targetYear}`)
  }
  for (const e of plan.expenses)
    if (!(e.monthly >= 0) || (e.inflation !== null && !(e.inflation >= -5 && e.inflation <= 30)))
      throw new Error(`Check the figures for ${EXPENSE_LABELS[e.key]}`)
  const value = JSON.stringify(plan)
  db.insert(schema.settings)
    .values({ key: PLAN_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
}

// ---------------- what today's money is ----------------

const DEBT_WORDS = /liquid|overnight|money market|gilt|g-?sec|bond|debt|duration|credit risk|floater|banking and psu|corporate|fixed maturity|target maturity|arbitrage|bharat bond|1d rate|treasury/i

/** Which parts a holding counts toward, as shares adding up to 1. */
export function bucketShares(
  row: Pick<HoldingRow, 'assetClass' | 'instrumentName'>,
  inst?: { name: string; mfCategory: string | null; mfType: string | null; schemeName: string | null }
): Partial<Record<PlanBucket, number>> {
  const name = `${row.instrumentName} ${inst?.schemeName ?? ''}`
  switch (row.assetClass) {
    case 'EQUITY_IN':
    case 'EQUITY_US':
      return { EQUITY: 1 }
    case 'ETF':
      return /gold|silver/i.test(name) ? { GOLD: 1 } : DEBT_WORDS.test(name) ? { DEBT: 1 } : { EQUITY: 1 }
    case 'MF': {
      if (/gold|silver|precious/i.test(name)) return { GOLD: 1 }
      const cat = splitCategory(inst?.mfCategory ?? inst?.mfType ?? null)
      const text = `${cat.name} ${name}`
      if (cat.group === 'Debt' || DEBT_WORDS.test(text)) return { DEBT: 1 }
      if (cat.group === 'Hybrid' || /hybrid|balanced|multi asset|equity savings|dynamic asset/i.test(text)) {
        if (/conservative|equity savings/i.test(text)) return { EQUITY: 0.3, DEBT: 0.7 }
        if (/aggressive/i.test(text)) return { EQUITY: 0.75, DEBT: 0.25 }
        if (/multi asset/i.test(text)) return { EQUITY: 0.6, DEBT: 0.25, GOLD: 0.15 }
        return { EQUITY: 0.5, DEBT: 0.5 }
      }
      return { EQUITY: 1 }
    }
    case 'FD':
    case 'BOND':
      return { DEBT: 1 }
    case 'GOLD':
      return { GOLD: 1 }
    case 'EPF':
      return { EPF: 1 }
    case 'PPF':
      return { PPF: 1 }
    case 'NPS':
      return { NPS: 1 }
    case 'REAL_ESTATE':
    case 'REIT':
      return { PROPERTY: 1 }
    case 'CASH':
      return { CASH: 1 }
    case 'INSURANCE':
      return {}
    default:
      return { OTHER: 1 }
  }
}

function startingPoint(db: Db, personId?: number) {
  const insts = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const byBucket = zero()
  for (const r of listHoldings(db, personId)) {
    const v = r.marketValueInr ?? r.investedInr ?? 0
    if (v <= 0) continue
    for (const [b, share] of Object.entries(bucketShares(r, insts.get(r.instrumentId))) as [PlanBucket, number][])
      byBucket[b] += v * share
  }
  const epfMonthly = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.kind, 'EPF'))
    .all()
    .filter((a) => personId === undefined || a.personId === personId)
    .reduce((s, a) => s + parseEpfMeta(a.metaJson).monthlyContribution, 0)
  return { byBucket, epfMonthly }
}

/** Mutual fund purchases in three or more of the last six months look like a SIP. */
export function detectSips(db: Db, plan: Plan, personId?: number, today = new Date()): Omit<PlanSip, 'id'>[] {
  const since = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1)).toISOString().slice(0, 10)
  const accounts = db
    .select()
    .from(schema.accounts)
    .all()
    .filter((a) => personId === undefined || a.personId === personId)
  if (!accounts.length) return []
  const personOf = new Map(accounts.map((a) => [a.id, a.personId]))
  const txns = db
    .select()
    .from(schema.transactions)
    .where(
      and(
        inArray(
          schema.transactions.accountId,
          accounts.map((a) => a.id)
        ),
        eq(schema.transactions.type, 'BUY'),
        gte(schema.transactions.date, since)
      )
    )
    .all()
  const insts = new Map(
    db
      .select()
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i])
  )
  const groups = new Map<string, { personId: number; instrumentId: number; months: Map<string, number> }>()
  for (const t of txns) {
    const inst = insts.get(t.instrumentId)
    if (!inst || inst.assetClass !== 'MF') continue
    const pid = personOf.get(t.accountId)!
    const k = `${pid}:${t.instrumentId}`
    const g = groups.get(k) ?? { personId: pid, instrumentId: t.instrumentId, months: new Map() }
    const m = t.date.slice(0, 7)
    g.months.set(m, (g.months.get(m) ?? 0) + Math.abs(t.amount))
    groups.set(k, g)
  }
  const planned = new Set(plan.sips.map((s) => s.name.toLowerCase()))
  const out: Omit<PlanSip, 'id'>[] = []
  for (const g of groups.values()) {
    if (g.months.size < 3) continue
    const amounts = [...g.months.values()].sort((a, b) => a - b)
    const monthly = Math.round(amounts[Math.floor(amounts.length / 2)])
    const inst = insts.get(g.instrumentId)!
    const name = (inst.schemeName ?? inst.name).replace(/\s*-\s*(direct|regular).*$/i, '').trim()
    if (planned.has(name.toLowerCase())) continue
    const shares = bucketShares({ assetClass: 'MF', instrumentName: inst.name }, inst)
    const bucket = (Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'EQUITY') as PlanBucket
    out.push({ personId: g.personId, name, monthly, stepUpPct: 10, bucket, start: [...g.months.keys()].sort()[0], endYear: null })
  }
  return out.sort((a, b) => b.monthly - a.monthly)
}

// ---------------- the projection ----------------

export function computeForecast(db: Db, personId?: number, today = new Date()): Forecast {
  const plan = loadPlan(db)
  const cpi = storedCpi(db)
  const household = personId === undefined
  const { byBucket: startByBucket, epfMonthly } = startingPoint(db, personId)
  const sips = plan.sips.filter((s) => personId === undefined || s.personId === personId)
  const persons = db.select().from(schema.persons).all()

  const y0 = today.getUTCFullYear()
  const m0 = today.getUTCMonth() // 0-based
  const g = plan.inflation / 100
  const notes: string[] = []

  // Spending, each category at its own rate.
  const expenses = plan.expenses.map((e) => {
    const fig = e.key === 'EMI' ? null : (cpi.byCategory[e.key] ?? null)
    const inflation = e.inflation ?? (e.key === 'EMI' ? 0 : (fig?.tenYear ?? plan.inflation))
    return {
      key: e.key,
      label: EXPENSE_LABELS[e.key],
      monthly: e.monthly,
      inflation,
      source: (e.inflation === null ? 'CPI' : 'CUSTOM') as 'CPI' | 'CUSTOM',
      cpi: fig,
      monthlyThen: 0
    }
  })
  const spend = expenses.filter((e) => e.monthly > 0)
  const monthlySpend = spend.reduce((s, e) => s + e.monthly, 0)
  /** Monthly living costs t years from now. */
  const costsAt = (t: number) => spend.reduce((s, e) => s + e.monthly * (1 + e.inflation / 100) ** t, 0)
  const basket = (t: number) => (monthlySpend > 0 ? costsAt(t) / monthlySpend : (1 + g) ** t)
  const horizon = plan.targetYear - y0 + (11 - m0) / 12
  for (const e of expenses) e.monthlyThen = e.monthly * (1 + e.inflation / 100) ** horizon
  const personalInflation = monthlySpend > 0 && horizon > 0 ? basket(horizon) ** (1 / horizon) - 1 : null

  const goals = (household ? plan.goals : []).map((goal) => {
    const rate = goal.category === 'GENERAL' ? plan.inflation : (expenses.find((e) => e.key === goal.category)?.inflation ?? plan.inflation)
    return { ...goal, costThen: goal.costToday * (1 + rate / 100) ** Math.max(0, goal.year - y0), funded: null as boolean | null }
  })

  const retireYear = plan.retireYear
  const run = (delta: number) => {
    const bal = { ...startByBucket }
    const rates = Object.fromEntries(
      PLAN_BUCKETS.map((b) => [b, (1 + (plan.returns[b] + delta * plan.spread * SPREAD_WEIGHT[b]) / 100) ** (1 / 12) - 1])
    ) as Record<PlanBucket, number>
    const years: ForecastYear[] = []
    let putIn = 0
    let drawnYear = 0
    let ranOut: number | null = null
    const goalFunded = new Map<string, boolean>()
    const investableTotal = () => PLAN_BUCKETS.reduce((s, b) => (b === 'PROPERTY' ? s : s + bal[b]), 0)
    /** Takes money out of everything but property, in proportion. Returns what was actually drawn. */
    const draw = (amount: number) => {
      const total = investableTotal()
      if (total <= 0) return 0
      const take = Math.min(amount, total)
      for (const b of PLAN_BUCKETS) if (b !== 'PROPERTY') bal[b] -= (bal[b] / total) * take
      return take
    }

    for (let i = 0; ; i++) {
      const y = y0 + Math.floor((m0 + i) / 12)
      const mo = (m0 + i) % 12
      if (y > plan.targetYear) break
      const tYears = i / 12
      const retired = retireYear !== null && y >= retireYear

      for (const b of PLAN_BUCKETS) bal[b] *= 1 + rates[b]

      if (!retired) {
        for (const s of sips) {
          const [sy, sm] = s.start.split('-').map(Number)
          if (y * 12 + mo < sy * 12 + (sm - 1)) continue
          if (s.endYear !== null && y > s.endYear) continue
          // Step-ups fall in the SIP's own month; the current amount already includes this year's.
          const first = (sm - 1 - m0 + 12) % 12 || 12
          const steps = i >= first ? 1 + Math.floor((i - first) / 12) : 0
          const amt = s.monthly * (1 + s.stepUpPct / 100) ** steps
          bal[s.bucket] += amt
          putIn += amt
        }
        if (epfMonthly > 0) {
          const amt = epfMonthly * (1 + plan.epfGrowth / 100) ** Math.floor(i / 12)
          bal.EPF += amt
          putIn += amt
        }
      } else if (household && monthlySpend > 0) {
        const need = costsAt(tYears)
        const got = draw(need)
        drawnYear += got
        if (got < need - 1 && ranOut === null) ranOut = y
      }

      if (household && mo === 5)
        for (const goal of goals)
          if (goal.year === y && goal.fromPortfolio) {
            const got = draw(goal.costThen)
            drawnYear += got
            goalFunded.set(goal.id, got >= goal.costThen - 1)
          }

      if (mo === 11 || (y === plan.targetYear && mo === 11)) {
        const nominal = PLAN_BUCKETS.reduce((s, b) => s + bal[b], 0)
        const tEnd = tYears + 1 / 12
        years.push({
          year: y,
          nominal,
          real: nominal / (1 + g) ** tEnd,
          realPersonal: nominal / basket(tEnd),
          low: 0,
          high: 0,
          putIn,
          yearlyCosts: household ? costsAt(y - y0 + 0.5) * 12 : 0,
          drawn: drawnYear,
          byBucket: { ...bal },
          ages: persons
            .filter((p) => plan.birthYears[p.id] && (personId === undefined || p.id === personId))
            .map((p) => ({ personId: p.id, name: p.name, age: y - plan.birthYears[p.id] }))
        })
        drawnYear = 0
      }
    }
    return { years, goalFunded, ranOut }
  }

  const mid = run(0)
  const low = run(-1)
  const high = run(1)
  mid.years.forEach((yr, i) => {
    yr.low = low.years[i]?.nominal ?? yr.nominal
    yr.high = high.years[i]?.nominal ?? yr.nominal
  })
  for (const goal of goals) goal.funded = goal.fromPortfolio ? (mid.goalFunded.get(goal.id) ?? null) : null

  const investable = (yr: ForecastYear) => yr.nominal - yr.byBucket.PROPERTY
  const freedomYear =
    household && monthlySpend > 0
      ? (mid.years.find((yr) => investable(yr) * (plan.withdrawalRate / 100) >= yr.yearlyCosts)?.year ?? null)
      : null
  let retirement: Forecast['retirement'] = null
  if (household && retireYear !== null && monthlySpend > 0) {
    const before = mid.years.find((yr) => yr.year === retireYear - 1) ?? mid.years[0]
    const costs = costsAt(retireYear - y0 + 0.5) * 12
    retirement = {
      year: retireYear,
      needed: costs / (plan.withdrawalRate / 100),
      projected: investable(before),
      lastsUntil: mid.ranOut
    }
  }
  if (!household && (plan.goals.length || monthlySpend > 0))
    notes.push('Living costs, goals and retirement draws are household figures: switch to Family to include them.')
  if (startByBucket.PROPERTY > 0)
    notes.push('Property is counted in the totals but never sold to pay costs or goals.')

  return {
    plan,
    cpi,
    household,
    startValue: PLAN_BUCKETS.reduce((s, b) => s + startByBucket[b], 0),
    startByBucket,
    sipMonthly: sips.reduce((s, x) => s + x.monthly, 0),
    epfMonthly,
    years: mid.years,
    personalInflation,
    expenses,
    goals,
    freedomYear,
    retirement,
    detectedSips: detectSips(db, plan, personId, today),
    notes
  }
}
