import { eq } from 'drizzle-orm'
import {
  BUCKET_LABELS,
  BUCKETS,
  type Bucket,
  type HoldingRow,
  type OpenLot,
  type RebalanceReport,
  type RebalanceTrade,
  type Targets
} from '@shared/types'
import { schema, type Db } from '../db'
import { buildExposure, loadExposureInputs } from './exposure'
import { planOf } from './fundInsights'
import { listHoldings } from './holdings'
import { computeTax } from './tax'
import { FOREIGN_THEME } from './taxRules'

// Target allocation and rebalancing. Money is split into five buckets after looking inside funds
// (a hybrid fund counts partly as equity, partly as debt); property, crypto and other hard-to-sell
// assets sit outside the targets. Suggestions buy with new money first and only sell what is over
// its band, choosing the sales that cost the least tax.

export const targetsKey = (personId: number | null) => `targets:${personId ?? 'family'}`

/** Holdings that can be sold (and topped up) through a broker or fund house in a day or two. */
const SELLABLE = new Set(['EQUITY_IN', 'EQUITY_US', 'ETF', 'MF', 'REIT', 'BOND'])
const MIN_TRADE = 1000
/** For ranking sales only: slab-taxed gains are assumed to be taxed at 30%. */
const SLAB_GUESS = 0.3
const STCG_RATE = 0.2
const LTCG_RATE = 0.125
const EPS = 1e-9

/** Where the part of a bucket that can't be sold usually sits. */
const LOCKED_IN: Record<Bucket, string> = {
  EQUITY_IN: 'NPS',
  EQUITY_INTL: 'holdings that cannot be sold here',
  DEBT: 'deposits, EPF, PPF, NPS or bonds held to maturity',
  GOLD: 'physical gold and silver or SGBs',
  CASH: 'cash entered by hand'
}

const NEW_HOLDING: Record<Bucket, string> = {
  EQUITY_IN: 'A Nifty 50 or Nifty 500 index fund (Direct plan)',
  EQUITY_INTL: 'An S&P 500 or Nasdaq 100 fund or ETF',
  DEBT: 'A short-duration or liquid debt fund, or a fixed deposit',
  GOLD: 'A gold ETF or gold fund',
  CASH: 'Your savings account or a sweep-in deposit'
}

// ---------------- targets ----------------

export function validateTargets(t: Targets): Targets {
  const sum = BUCKETS.reduce((s, b) => s + (t.buckets?.[b] ?? NaN), 0)
  if (!BUCKETS.every((b) => t.buckets[b] >= 0 && t.buckets[b] <= 1)) throw new Error('Each target must be between 0% and 100%')
  if (Math.abs(sum - 1) > 0.001) throw new Error(`Targets must add up to 100% (they add up to ${Math.round(sum * 1000) / 10}%)`)
  if (!(t.band > 0 && t.band <= 0.25)) throw new Error('The allowed drift must be between 1 and 25 points')
  if (t.caps) {
    const c = t.caps.LARGE + t.caps.MID + t.caps.SMALL
    if (![t.caps.LARGE, t.caps.MID, t.caps.SMALL].every((v) => v >= 0 && v <= 1) || Math.abs(c - 1) > 0.001)
      throw new Error('Large, mid and small cap must add up to 100%')
  }
  return { buckets: { ...t.buckets }, band: t.band, caps: t.caps ? { ...t.caps } : null }
}

function readTargets(db: Db, key: string): Targets | null {
  const v = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value
  if (!v) return null
  try {
    return validateTargets(JSON.parse(v) as Targets)
  } catch {
    return null
  }
}

/** A person's own targets, else the family's; the family scope uses the family's. */
export function loadTargets(db: Db, personId?: number): { targets: Targets | null; source: 'OWN' | 'FAMILY' | null } {
  if (personId) {
    const own = readTargets(db, targetsKey(personId))
    if (own) return { targets: own, source: 'OWN' }
    const fam = readTargets(db, targetsKey(null))
    return fam ? { targets: fam, source: 'FAMILY' } : { targets: null, source: null }
  }
  const fam = readTargets(db, targetsKey(null))
  return { targets: fam, source: fam ? 'OWN' : null }
}

export function saveTargets(db: Db, personId: number | null, targets: Targets | null): void {
  const key = targetsKey(personId)
  if (!targets) {
    db.delete(schema.settings).where(eq(schema.settings.key, key)).run()
    return
  }
  const value = JSON.stringify(validateTargets(targets))
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}

/** Shares rounded to whole 5% steps that still add up to 100%. */
export function roundedTargets(shares: Record<Bucket, number>): Record<Bucket, number> {
  const steps = BUCKETS.map((b) => ({ b, n: Math.round((shares[b] ?? 0) * 20), exact: (shares[b] ?? 0) * 20 }))
  let diff = 20 - steps.reduce((s, x) => s + x.n, 0)
  // Hand out (or take back) the leftover steps where rounding moved furthest from the exact value; on a
  // tie (within float noise) the larger bucket gets the step and the smaller one gives it up.
  const off = (x: { n: number; exact: number }) => Math.round((x.n - x.exact) * 1e6) / 1e6
  while (diff !== 0) {
    const pick = [...steps]
      .filter((x) => diff > 0 || x.n > 0)
      .sort((a, b) => (diff > 0 ? off(a) - off(b) || b.exact - a.exact : off(b) - off(a) || a.exact - b.exact))[0]
    pick.n += diff > 0 ? 1 : -1
    diff += diff > 0 ? -1 : 1
  }
  return Object.fromEntries(steps.map((x) => [x.b, x.n / 20])) as Record<Bucket, number>
}

// ---------------- splitting holdings into buckets ----------------

export interface RowSplit {
  row: HoldingRow
  value: number
  buckets: Record<Bucket, number>
  outside: number
  caps: { LARGE: number; MID: number; SMALL: number; OTHER: number }
  sellable: boolean
}

const zero = (): Record<Bucket, number> => ({ EQUITY_IN: 0, EQUITY_INTL: 0, DEBT: 0, GOLD: 0, CASH: 0 })

/**
 * Splits each holding into buckets. Hand-entered assets (deposits, bonds held to maturity, gold) are
 * never sellable here, whatever their asset class: pass their account ids in manualAccounts.
 */
export function splitRows(
  rows: HoldingRow[],
  inputs: ReturnType<typeof loadExposureInputs>,
  manualAccounts: Set<number> = new Set()
): RowSplit[] {
  const out: RowSplit[] = []
  for (const row of rows) {
    const value = row.marketValueInr ?? row.investedInr ?? 0
    if (value <= 0) continue
    const e = buildExposure([row], inputs.funds, inputs.sectors, inputs.categories, inputs.caps)
    const mix = new Map(e.assetMix.map((a) => [a.type, a.valueInr]))
    const cap = (c: string) => e.marketCap.find((m) => m.cap === c)?.valueInr ?? 0
    const equity = mix.get('EQUITY') ?? 0
    let foreign = cap('FOREIGN')
    // A fund of foreign shares with no portfolio on file is counted as Indian by the exposure report.
    const looked = (inputs.funds.get(row.instrumentId)?.length ?? 0) > 0
    const text = `${row.instrumentName} ${inputs.categories.get(row.instrumentId) ?? ''}`
    if ((row.assetClass === 'MF' || row.assetClass === 'ETF') && !looked && FOREIGN_THEME.test(text)) foreign = equity
    const large = foreign === equity ? 0 : cap('LARGE')
    const mid = foreign === equity ? 0 : cap('MID')
    const small = foreign === equity ? 0 : cap('SMALL')
    out.push({
      row,
      value,
      buckets: {
        EQUITY_IN: Math.max(0, equity - foreign),
        EQUITY_INTL: foreign,
        DEBT: mix.get('DEBT') ?? 0,
        GOLD: mix.get('GOLD') ?? 0,
        CASH: mix.get('CASH') ?? 0
      },
      outside: (mix.get('REAL_ESTATE') ?? 0) + (mix.get('CRYPTO') ?? 0) + (mix.get('OTHER') ?? 0),
      caps: { LARGE: large, MID: mid, SMALL: small, OTHER: Math.max(0, equity - foreign - large - mid - small) },
      sellable: SELLABLE.has(row.assetClass) && !manualAccounts.has(row.accountId)
    })
  }
  return out
}

// ---------------- tax of a sale ----------------

export interface SaleCost {
  amountInr: number
  units: number
  gainInr: number
  taxInr: number
  slabGainInr: number
  exemptUsed: number
}

/**
 * Selling `amount` rupees of a holding, oldest lots first (as the tax rules require): the gain, the
 * fixed-rate tax at today's rates after `exemptionLeft` of 112A exemption, and gains taxed at the slab.
 */
export function saleCost(lots: OpenLot[], amount: number, exemptionLeft: number): SaleCost {
  let left = amount
  let units = 0
  const by = { '111A': 0, '112A': 0, SLAB: 0, LT_OTHER: 0 }
  let gain = 0
  for (const l of lots) {
    if (left <= EPS) break
    if (l.valueInr <= EPS) continue
    const take = Math.min(l.valueInr, left)
    const frac = take / l.valueInr
    units += l.units * frac
    by[l.kind] += l.gainInr * frac
    gain += l.gainInr * frac
    left -= take
  }
  const ltEq = by['112A']
  const exemptUsed = ltEq > 0 ? Math.min(ltEq, exemptionLeft) : 0
  const taxInr = Math.max(0, ltEq - exemptUsed) * LTCG_RATE + Math.max(0, by['111A']) * STCG_RATE + Math.max(0, by.LT_OTHER) * LTCG_RATE
  return { amountInr: amount - left, units, gainInr: gain, taxInr, slabGainInr: by.SLAB, exemptUsed }
}

const rupeesText = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`

// ---------------- the report ----------------

export function computeRebalance(
  db: Db,
  personId: number | undefined,
  opts: { newMoneyInr: number; allowSells: boolean }
): RebalanceReport {
  const newMoney = Math.max(0, Number.isFinite(opts.newMoneyInr) ? opts.newMoneyInr : 0)
  const { targets, source } = loadTargets(db, personId)
  const manualAccounts = new Set(
    db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.kind, 'MANUAL_ASSET'))
      .all()
      .map((a) => a.id)
  )
  const splits = splitRows(listHoldings(db, personId), loadExposureInputs(db), manualAccounts)

  const value = zero()
  const locked = zero()
  for (const s of splits)
    for (const b of BUCKETS) {
      value[b] += s.buckets[b]
      if (!s.sellable) locked[b] += s.buckets[b]
    }
  const baseInr = BUCKETS.reduce((t, b) => t + value[b], 0)
  const excludedInr = splits.reduce((t, s) => t + s.outside, 0)
  const share = (b: Bucket) => (baseInr > 0 ? value[b] / baseInr : 0)
  const statusOf = (b: Bucket): RebalanceReport['buckets'][number]['status'] => {
    if (!targets) return 'NO_TARGET'
    const d = share(b) - targets.buckets[b]
    return d > targets.band + EPS ? 'OVER' : d < -targets.band - EPS ? 'UNDER' : 'OK'
  }
  const buckets = BUCKETS.map((b) => ({
    bucket: b,
    valueInr: value[b],
    share: share(b),
    target: targets ? targets.buckets[b] : null,
    status: statusOf(b),
    lockedInr: locked[b]
  }))

  // ---------- Indian equity by market cap ----------
  const capValue = { LARGE: 0, MID: 0, SMALL: 0, OTHER: 0 }
  for (const s of splits) for (const k of ['LARGE', 'MID', 'SMALL', 'OTHER'] as const) capValue[k] += s.caps[k]
  const classified = capValue.LARGE + capValue.MID + capValue.SMALL
  const caps = (['LARGE', 'MID', 'SMALL', 'OTHER'] as const).map((band) => ({
    band,
    valueInr: capValue[band],
    // Large / mid / small as shares of the classified part; "other" as a share of all Indian equity.
    share:
      band === 'OTHER'
        ? value.EQUITY_IN > 0
          ? capValue.OTHER / value.EQUITY_IN
          : 0
        : classified > 0
          ? capValue[band] / classified
          : 0,
    target: band !== 'OTHER' && targets?.caps ? targets.caps[band] : null
  }))

  const suggestedTargets: Targets = {
    buckets: roundedTargets(Object.fromEntries(BUCKETS.map((b) => [b, share(b)])) as Record<Bucket, number>),
    band: 0.05,
    caps: null
  }

  const report: RebalanceReport = {
    targets,
    targetSource: source,
    baseInr,
    excludedInr,
    buckets,
    caps,
    suggestedTargets,
    plan: {
      newMoneyInr: newMoney,
      allowSells: opts.allowSells,
      trades: [],
      after: BUCKETS.map((b) => ({ bucket: b, share: share(b) })),
      taxInr: 0,
      slabGainInr: 0,
      notes: []
    }
  }
  if (!targets) {
    report.plan.notes.push('Set a target mix to see what to buy or sell.')
    return report
  }

  // ---------- the plan ----------
  const after = { ...value }
  const trades: RebalanceTrade[] = []
  const notes: string[] = []
  const applySplit = (s: RowSplit, amount: number, sign: 1 | -1) => {
    for (const b of BUCKETS) after[b] += (sign * amount * s.buckets[b]) / s.value
  }
  const baseAfter = baseInr + newMoney
  const gap = Object.fromEntries(BUCKETS.map((b) => [b, targets.buckets[b] * baseAfter - value[b]])) as Record<Bucket, number>

  // Sales: only buckets above their band, down to the target, cheapest tax first.
  let sold = 0
  if (opts.allowSells) {
    const tax = computeTax(db, personId)
    const lotsBy = new Map<string, OpenLot[]>()
    for (const l of tax.lots) {
      const k = `${l.accountId}:${l.instrumentId}`
      lotsBy.set(k, [...(lotsBy.get(k) ?? []), l])
    }
    const exemption = new Map(tax.exemptionLeft.map((e) => [e.personId, e.left]))
    const costOf = (s: RowSplit, amount: number) => {
      const lots = lotsBy.get(`${s.row.accountId}:${s.row.instrumentId}`)
      if (lots?.length) return saleCost(lots, amount, exemption.get(s.row.personId) ?? 0)
      return null
    }
    const score = (s: RowSplit, amount: number) => {
      const c = costOf(s, amount)
      // Without lots the tax is unknown: rank it behind sales known to be cheap.
      return c ? (c.taxInr + Math.max(0, c.slabGainInr) * SLAB_GUESS) / Math.max(1, c.amountInr) : 0.15
    }
    for (const b of BUCKETS.filter((x) => statusOf(x) === 'OVER')) {
      let need = -gap[b]
      if (need < MIN_TRADE) continue
      const cands = splits
        .filter((s) => s.sellable && s.buckets[b] / s.value >= 0.6)
        .map((s) => ({ s, f: s.buckets[b] / s.value }))
        .map((c) => ({ ...c, rank: score(c.s, Math.min(c.s.value, need / c.f)) }))
        .sort((x, y) => x.rank - y.rank)
      for (const { s, f } of cands) {
        if (need < MIN_TRADE) break
        const amount = Math.min(s.value, need / f)
        if (amount < MIN_TRADE) continue
        const c = costOf(s, amount)
        if (c) exemption.set(s.row.personId, (exemption.get(s.row.personId) ?? 0) - c.exemptUsed)
        const price = s.row.quantity > 0 && s.row.marketValueInr ? s.row.marketValueInr / s.row.quantity : null
        const estGain =
          !c && s.row.investedInr !== null && s.row.marketValueInr ? ((s.row.marketValueInr - s.row.investedInr) / s.row.marketValueInr) * amount : null
        trades.push({
          action: 'SELL',
          bucket: b,
          amountInr: amount,
          holding: {
            accountId: s.row.accountId,
            instrumentId: s.row.instrumentId,
            name: s.row.instrumentName,
            accountName: s.row.accountName,
            personName: s.row.personName
          },
          suggestion: null,
          units: c ? c.units : price ? amount / price : null,
          taxInr: c ? c.taxInr : null,
          slabGainInr: c ? c.slabGainInr : null,
          gainInr: c ? c.gainInr : estGain,
          note: c
            ? f < 0.99
              ? `${Math.round(f * 100)}% ${BUCKET_LABELS[b].toLowerCase()}; also lowers its other parts`
              : null
            : 'Buy dates not on record, so the tax is not estimated'
        })
        applySplit(s, amount, -1)
        sold += amount
        need -= amount * f
      }
      if (need >= MIN_TRADE) {
        const label = BUCKET_LABELS[b].toLowerCase()
        const lockedNote = locked[b] > 0 ? ` ${rupeesText(locked[b])} of it is in ${LOCKED_IN[b]}, which can't be sold to rebalance.` : ''
        notes.push(
          `About ${rupeesText(need)} more of ${label} would need selling to reach the target, but no other holding that is mostly ${label} can be sold.${lockedNote} New money into the other buckets closes the gap over time.`
        )
      }
    }
  }

  // Purchases: new money plus anything sold, shared among buckets below target in proportion to the gap.
  const cash = newMoney + sold
  const positive = BUCKETS.filter((b) => gap[b] > 0)
  const sumPos = positive.reduce((t, b) => t + gap[b], 0)
  const capLean = (() => {
    if (!targets.caps || classified <= 0) return null
    const under = (['LARGE', 'MID', 'SMALL'] as const)
      .map((k) => ({ k, d: capValue[k] / classified - targets.caps![k] }))
      .sort((a, b) => a.d - b.d)[0]
    return under.d < -0.02 ? `${under.k.toLowerCase()}-cap` : null
  })()
  for (const b of positive) {
    const amount = sumPos > 0 ? (cash * gap[b]) / sumPos : 0
    if (amount < MIN_TRADE) continue
    // An existing holding that is mostly this bucket: funds before single shares, Direct plans first, then size.
    const pick = splits
      .filter((s) => s.sellable && s.buckets[b] / s.value >= 0.8)
      .sort((x, y) => {
        // US ETFs are stored as US shares; the name gives them away.
        const fund = (s: RowSplit) =>
          s.row.assetClass === 'MF' || s.row.assetClass === 'ETF' || /\b(etf|fund)\b/i.test(s.row.instrumentName) ? 0 : 1
        const plan = (s: RowSplit) => (['DIRECT', 'ETF'].includes(planOf(s.row.instrumentName, s.row.assetClass)) ? 0 : 1)
        return fund(x) - fund(y) || plan(x) - plan(y) || y.value - x.value
      })[0]
    trades.push({
      action: 'BUY',
      bucket: b,
      amountInr: amount,
      holding: pick
        ? {
            accountId: pick.row.accountId,
            instrumentId: pick.row.instrumentId,
            name: pick.row.instrumentName,
            accountName: pick.row.accountName,
            personName: pick.row.personName
          }
        : null,
      suggestion: pick ? null : NEW_HOLDING[b],
      units: null,
      taxInr: null,
      slabGainInr: null,
      gainInr: null,
      note: b === 'EQUITY_IN' && capLean ? `Lean towards ${capLean} funds: you're below target there` : null
    })
    if (pick) applySplit(pick, amount, 1)
    else after[b] += amount
  }

  if (!trades.length) {
    const off = BUCKETS.filter((b) => statusOf(b) !== 'OK')
    if (!off.length) notes.push('Every bucket is within its allowed drift: nothing to do.')
    else if (!newMoney && !opts.allowSells) notes.push('Enter an amount to invest, or allow selling, to see trades.')
  }
  if (trades.some((t) => t.action === 'SELL'))
    notes.push(
      "Tax uses each person's unused ₹1.25 lakh long-term exemption for this year and today's rates (20% short-term, 12.5% long-term on listed equity); gains at your slab rate are shown, not taxed. Check exit loads before selling."
    )

  const totalAfter = BUCKETS.reduce((t, b) => t + after[b], 0)
  report.plan = {
    newMoneyInr: newMoney,
    allowSells: opts.allowSells,
    trades,
    after: BUCKETS.map((b) => ({ bucket: b, share: totalAfter > 0 ? after[b] / totalAfter : 0 })),
    taxInr: trades.reduce((t, x) => t + (x.taxInr ?? 0), 0),
    slabGainInr: trades.reduce((t, x) => t + Math.max(0, x.slabGainInr ?? 0), 0),
    notes: [...report.plan.notes, ...notes]
  }
  return report
}
