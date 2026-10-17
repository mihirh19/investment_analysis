import { GROUP_OF, type ChartGroup, type PropertyMeta } from '@shared/assets'
import type { PhoneEntry, PhoneHolding, PhoneScope, PhoneSnapshot } from '@shared/phone'
import { listPolicies } from './assets'
import { schema, type Db } from './db'
import { addManualEntry, manualAssetViews, saveManualAsset } from './manualAssets'
import { computeAnalysis } from './portfolio/analysis'
import { computeForecast } from './portfolio/forecast'
import { listHoldings } from './portfolio/holdings'
import { computeProperties } from './portfolio/property'
import { listVehicles, saveVehicle } from './vehicles'

/** What the phone shows: the same figures as the desktop's pages, worked out here. */
export function buildPhoneSnapshot(db: Db, applied: string[], pricesAsOf: string | null): PhoneSnapshot {
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
      history: {
        months: a.history.months,
        values: a.history.months.map((_, i) => a.history.series.reduce((s, g) => s + g.values[i], 0))
      },
      byGroup: [...byGroup].map(([group, value]) => ({ group, value })).sort((x, y) => y.value - x.value),
      upcoming: a.upcoming
        .filter((u) => u.date >= today && u.date <= horizon)
        .slice(0, 40)
        .map((u) => ({ date: u.date, label: u.label, amount: u.amount, holding: u.holding, personName: u.personName })),
      incomeThisFy: { dividends: fy?.dividends ?? 0, interest: fy?.interest ?? 0, rent: fy?.rent ?? 0 }
    }
  }

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
    dayChange: r.dayChangeInr
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
    applied
  }
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
  }
}
