import { GROUP_OF, type ChartGroup, type PropertyMeta } from '@shared/assets'
import { NOT_SPENDING } from '@shared/ai'
import type {
  PhoneEntry,
  PhoneExposure,
  PhoneFunds,
  PhoneHolding,
  PhonePerformance,
  PhoneRebalance,
  PhoneScope,
  PhoneSnapshot,
  PhoneSpending,
  PhoneTax
} from '@shared/phone'
import { listPolicies } from './assets'
import { schema, type Db } from './db'
import { addManualEntry, manualAssetViews, saveManualAsset } from './manualAssets'
import { computeAnalysis } from './portfolio/analysis'
import { computeForecast } from './portfolio/forecast'
import { listHoldings } from './portfolio/holdings'
import { computeProperties } from './portfolio/property'
import { computeTax } from './portfolio/tax'
import { farmReport, saveEntry } from './farm'
import { loansReport } from './loans'
import { computeExposure } from './portfolio/exposure'
import { computeFunds } from './portfolio/fundInsights'
import { computeFundComparisons, computeSectorInsights } from './portfolio/insights'
import { computePerformance } from './portfolio/performance'
import { computeRebalance } from './portfolio/rebalance'
import { spendingReport } from './statements'
import { listVehicles, saveVehicle } from './vehicles'

/** What the phone shows: the same figures as the desktop's pages, worked out here. */
export function buildPhoneSnapshot(db: Db, applied: string[], pricesAsOf: string | null, ai: PhoneSnapshot['ai'] = null): PhoneSnapshot {
  const persons = db
    .select()
    .from(schema.persons)
    .all()
    .map((p) => ({ id: p.id, name: p.name }))
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)

  const scope = (personId?: number): PhoneScope => {
    const a = computeAnalysis(db, personId)
    const rows = listHoldings(db, personId)
    const byGroup = new Map<ChartGroup, number>()
    for (const r of rows) {
      const g = GROUP_OF[r.assetClass]
      byGroup.set(g, (byGroup.get(g) ?? 0) + (r.marketValueInr ?? r.investedInr ?? 0))
    }
    const fy = a.income.at(-1)
    return {
      netWorth: rows.reduce((s, r) => s + (r.marketValueInr ?? r.investedInr ?? 0), 0),
      invested: rows.reduce((s, r) => s + (r.investedInr ?? 0), 0),
      dayChange: rows.reduce((s, r) => s + (r.dayChangeInr ?? 0), 0),
      xirr: a.xirr.overall,
      xirrCoverage: a.xirr.coverage,
      // Net worth over time: what was owned less what was owed on loans at each month end.
      history: {
        months: a.history.months,
        values: a.history.months.map((_, i) => a.history.series.reduce((s, g) => s + g.values[i], 0) - (a.owed.byMonth[i] ?? 0))
      },
      owed: a.owed.totalInr,
      byGroup: [...byGroup].map(([group, value]) => ({ group, value })).sort((x, y) => y.value - x.value),
      upcoming: a.upcoming
        .filter((u) => u.date >= today && u.date <= horizon)
        .slice(0, 40)
        .map((u) => ({ date: u.date, label: u.label, amount: u.amount, holding: u.holding, personName: u.personName })),
      incomeThisFy: { dividends: fy?.dividends ?? 0, interest: fy?.interest ?? 0, rent: fy?.rent ?? 0 },
      spending: spendingFor(personId),
      tax: taxFor(personId),
      performance: safe(() => performanceFor(personId)),
      exposure: safe(() => exposureFor(personId)),
      funds: safe(() => fundsFor(personId)),
      rebalance: safe(() => rebalanceFor(personId))
    }
  }

  // One page's figures failing must not stop the phone getting the rest.
  const safe = <T,>(f: () => T): T | null => {
    try {
      return f()
    } catch {
      return null
    }
  }

  const performanceFor = (personId?: number): PhonePerformance | null => {
    const p = computePerformance(db, personId)
    if (!p.dates.length) return null
    const bench = p.benchmarks[0]
    // Month ends only, at most ten years: enough for a small chart.
    const keep = p.dates.map((_, i) => i).slice(-121)
    return {
      coverage: p.coverage,
      xirr: p.xirr.overall,
      trailing: p.trailing.map((t) => ({ key: t.key, twr: t.twr, benchmarks: t.benchmarks })),
      benchmarks: p.benchmarks.map((b) => ({ key: b.key, label: b.label })),
      years: [...p.years].reverse().map((y) => ({ kind: y.kind, label: y.label, partial: y.partial, twr: y.twr, benchmarks: y.benchmarks, gain: y.gain, added: y.added })),
      maxDrawdown: p.maxDrawdown,
      growth: {
        dates: keep.map((i) => p.dates[i]),
        values: keep.map((i) => p.growth[i]),
        benchmark: bench ? { label: bench.label, values: keep.map((i) => bench.growth[i] ?? null) } : null
      },
      byAccount: p.xirr.byAccount.map((a) => ({ label: a.label, personName: a.personName, xirr: a.xirr, valueInr: a.valueInr })),
      holdings: [...p.xirr.byHolding]
        .sort((a, b) => b.valueInr - a.valueInr)
        .slice(0, 40)
        .map((h) => ({ name: h.name, personName: h.personName, xirr: h.xirr, valueInr: h.valueInr, gainInr: h.gainInr }))
    }
  }

  const exposureFor = (personId?: number): PhoneExposure | null => {
    const e = computeExposure(db, personId)
    if (!e.totalInr) return null
    const market = new Map(computeSectorInsights(db, personId).sectors.map((s) => [s.sector, s.marketShare]))
    const equity = e.sectors.reduce((s, x) => s + x.valueInr, 0)
    return {
      equityInr: equity,
      sectors: e.sectors.map((s) => ({ ...s, share: equity ? s.valueInr / equity : 0, marketShare: market.get(s.sector) ?? null })),
      marketCap: e.marketCap.map((m) => ({ cap: m.cap, valueInr: m.valueInr })),
      debt: { totalInr: e.debt.totalInr, types: e.debt.types, ratings: e.debt.ratings },
      companies: e.companies.slice(0, 30).map((c) => ({ name: c.name, sector: c.sector, valueInr: c.valueInr, directInr: c.directInr, viaFundsInr: c.viaFundsInr }))
    }
  }

  const fundsFor = (personId?: number): PhoneFunds | null => {
    const f = computeFunds(db, personId)
    if (!f.funds.length) return null
    const facts = new Map<number, { ter: number | null; r3y: number | null; benchmark3y: number | null }>()
    const pairs = computeFundComparisons(db, personId).pairs
    for (const p of pairs) for (const x of p.funds) facts.set(x.instrumentId, { ter: x.ter, r3y: x.r3y, benchmark3y: x.benchmark3y })
    const label = new Map(f.overlap.portfolios.map((p) => [p.id, p.label]))
    return {
      totalInr: f.totalFundsInr,
      regularExtraCostInr: f.funds.reduce((s, x) => s + (x.directPlan?.extraCostInr ?? 0), 0),
      funds: f.funds.map((x) => ({
        name: x.shortName || x.name,
        category: x.category,
        plan: x.plan,
        valueInr: x.valueInr,
        people: x.people,
        extraCostInr: x.directPlan?.extraCostInr ?? null,
        ter: facts.get(x.instrumentId)?.ter ?? null,
        r3y: facts.get(x.instrumentId)?.r3y ?? null,
        benchmark3y: facts.get(x.instrumentId)?.benchmark3y ?? null
      })),
      overlap: f.overlap.pairs
        .filter((p) => p.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 10)
        .map((p) => ({ a: label.get(p.a) ?? '', b: label.get(p.b) ?? '', overlap: p.overlap, sharedCount: p.sharedCount, shared: p.shared.slice(0, 5).map((s) => s.name) })),
      byCategory: f.byCategory.map((c) => ({ name: c.name, valueInr: c.valueInr }))
    }
  }

  // The mix against the targets only: the desktop's suggested trades stay on the desktop.
  const rebalanceFor = (personId?: number): PhoneRebalance | null => {
    const r = computeRebalance(db, personId, { newMoneyInr: 0, allowSells: false })
    if (!r.baseInr) return null
    return {
      targetSource: r.targetSource,
      baseInr: r.baseInr,
      buckets: r.buckets.map((b) => ({ bucket: b.bucket, valueInr: b.valueInr, share: b.share, target: b.target, status: b.status })),
      caps: r.caps
    }
  }

  const spendingFor = (personId?: number): PhoneSpending | null => {
    const r = spendingReport(db, personId, 6, today)
    if (!r.accounts.length) return null
    const names = new Map(r.accounts.map((a) => [a.id, `${a.institution} ${a.name}${a.last4 ? ` ••${a.last4}` : ''}`]))
    const owner = new Map(r.accounts.map((a) => [a.id, a.personName]))
    return {
      months: r.byMonth.slice(-6),
      dues: r.dues.map((d) => ({ name: d.name, personName: owner.get(d.accountId) ?? '', dueDate: d.dueDate, totalDue: d.totalDue, minimumDue: d.minimumDue })),
      recent: r.transactions
        .filter((t) => t.amount > 0 && !NOT_SPENDING.includes(t.category))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40)
        .map((t) => ({ date: t.date, merchant: t.merchant ?? t.description, amount: t.amount, category: t.category, account: names.get(t.accountId) ?? '' }))
    }
  }

  const taxFor = (personId?: number): PhoneTax | null => {
    const t = computeTax(db, personId, today)
    const now = t.years.filter((y) => y.current)
    if (!now.length && !t.lots.length) return null
    const sum = (f: (y: (typeof now)[number]) => number) => now.reduce((s, y) => s + f(y), 0)
    return {
      fy: t.currentFy,
      shortTermGain: sum((y) => y.shortTermGain),
      longTermGain: sum((y) => y.longTermGain),
      fixedRateTax: sum((y) => y.fixedRateTax),
      slabGain: sum((y) => y.slabGain),
      exemptionLeft: t.exemptionLeft.reduce((s, e) => s + e.left, 0),
      exemptionLimit: t.exemptionLeft.reduce((s, e) => s + e.limit, 0),
      unrealized: { shortTerm: t.unrealized.shortTermGain - t.unrealized.shortTermLoss, longTerm: t.unrealized.longTermGain - t.unrealized.longTermLoss },
      harvest: t.harvest.slice(0, 15).map((h) => ({ name: h.name, personName: h.personName, account: h.accountName, units: h.units, value: h.valueInr, gain: h.gainInr })),
      soonLongTerm: t.soonLongTerm
        .filter((l) => l.longTermFrom)
        .slice(0, 15)
        .map((l) => ({ name: l.name, personName: l.personName, gain: l.gainInr, longTermFrom: l.longTermFrom! }))
    }
  }

  const amfi = new Map(
    db
      .select({ id: schema.instruments.id, code: schema.instruments.amfiCode })
      .from(schema.instruments)
      .all()
      .map((i) => [i.id, i.code])
  )
  const holdings: PhoneHolding[] = listHoldings(db).map((r) => ({
    personId: r.personId,
    accountId: r.accountId,
    instrumentId: r.instrumentId,
    name: r.instrumentName,
    account: r.accountName,
    platform: r.platform,
    assetClass: r.assetClass,
    group: GROUP_OF[r.assetClass],
    quantity: r.quantity,
    price: r.lastPrice,
    priceDate: r.priceDate,
    currency: r.currency,
    value: r.marketValueInr ?? r.investedInr ?? 0,
    invested: r.investedInr,
    dayChange: r.dayChangeInr,
    amfiCode: amfi.get(r.instrumentId) ?? null
  }))

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pricesAsOf,
    persons,
    scopes: Object.fromEntries([['family', scope()], ...persons.map((p) => [String(p.id), scope(p.id)])]),
    holdings,
    properties: computeProperties(db),
    vehicles: listVehicles(db).map(({ documents: _d, ...v }) => v),
    forecast: computeForecast(db),
    policies: listPolicies(db).map((p) => ({
      name: p.name,
      personName: p.personName,
      nextDue: p.nextDueDate ?? null,
      premium: p.premium,
      insurer: p.insurer
    })),
    loans: loansReport(db).loans.map(({ payments: _p, ...l }) => l),
    farm: farmForPhone(db),
    ai,
    applied
  }
}

/** The farm for everyone, with each crop's price history cut to the last few months. */
function farmForPhone(db: Db): PhoneSnapshot['farm'] {
  const r = farmReport(db)
  if (!r.seasons.length && !r.prices.length) return null
  return { ...r, prices: r.prices.map((p) => ({ ...p, history: p.history.slice(-120) })) }
}

/** Applies one thing recorded on the phone, through the same checks as the desktop's forms. */
export function applyPhoneEntry(db: Db, e: PhoneEntry): void {
  switch (e.type) {
    case 'RENT':
    case 'PROPERTY_EXPENSE': {
      const a = manualAssetViews(db).find((x) => x.accountId === e.propertyId && x.meta.kind === 'PROPERTY')
      if (!a) throw new Error('That property is no longer on the desktop')
      const m = a.meta as PropertyMeta
      const meta: PropertyMeta =
        e.type === 'RENT'
          ? {
              ...m,
              rentPayments: [
                ...(m.rentPayments ?? []),
                { id: e.id, date: e.date, forMonth: e.forMonth, amount: e.amount, tenancyId: e.tenancyId, note: 'From the phone' }
              ]
            }
          : { ...m, expenses: [...(m.expenses ?? []), { id: e.id, date: e.date, kind: e.kind, amount: e.amount, note: e.note }] }
      saveManualAsset(db, { accountId: a.accountId, personId: a.personId, meta })
      return
    }
    case 'VEHICLE_EXPENSE':
    case 'VEHICLE_PUC':
    case 'VEHICLE_POLICY': {
      const v = listVehicles(db).find((x) => x.id === e.vehicleId)
      if (!v) throw new Error('That vehicle is no longer on the desktop')
      const m = { ...v.meta }
      if (e.type === 'VEHICLE_EXPENSE')
        m.expenses = [
          ...(m.expenses ?? []),
          { id: e.id, date: e.date, kind: e.kind, amount: e.amount, km: e.km, litres: e.litres, note: e.note }
        ]
      else if (e.type === 'VEHICLE_PUC') {
        m.puc = [...(m.puc ?? []), { id: e.id, date: e.date, validUntil: e.validUntil }]
        if (e.amount) m.expenses = [...(m.expenses ?? []), { id: `${e.id}-fee`, date: e.date ?? e.at.slice(0, 10), kind: 'PUC', amount: e.amount }]
      } else {
        m.policies = [
          ...(m.policies ?? []),
          { id: e.id, endDate: e.endDate, startDate: e.startDate, insurer: e.insurer, premium: e.premium, idv: e.idv }
        ]
        if (e.premium)
          m.expenses = [
            ...(m.expenses ?? []),
            { id: `${e.id}-premium`, date: e.startDate ?? e.at.slice(0, 10), kind: 'INSURANCE', amount: e.premium, note: e.insurer }
          ]
      }
      saveVehicle(db, { id: v.id, personId: v.personId, meta: m })
      return
    }
    case 'ASSET_VALUE':
      addManualEntry(db, e.accountId, e.date, e.value)
      return
    case 'FARM_ENTRY': {
      const { id: _id, at: _at, type: _t, entryType, ...rest } = e
      saveEntry(db, { ...rest, type: entryType })
      return
    }
  }
}
