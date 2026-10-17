import { and, asc, eq } from 'drizzle-orm'
import type { PropertyMeta, PropertyView } from '@shared/assets'
import { schema, type Db } from '../db'
import { manualAssetViews } from '../manualAssets'
import { residexKey, sizeBandOf, type SizeBand } from '../market/residex'
import { addDays, addMonths, financialYearOf, todayIso, yearsBetween } from './dates'
import { propertyMode } from './engines'
import { expensesBetween, recordsPayments, rentMonths, rentReceived, tenanciesOf } from './rent'
import { xirr } from './xirr'

const BAND_LABEL: Record<SizeBand, string> = {
  ALL: 'all sizes',
  LT60: 'homes under 645 sq ft carpet',
  '60TO110': 'homes of 645–1,185 sq ft carpet',
  GT110: 'homes over 1,185 sq ft carpet'
}

const money = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

function series(db: Db, cityId: number, band: SizeBand) {
  return db
    .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
    .from(schema.priceHistory)
    .where(and(eq(schema.priceHistory.key, residexKey(cityId, band))))
    .orderBy(asc(schema.priceHistory.date))
    .all()
}

/** Every property with its value, its city's market, rent and this year's figures. */
export function computeProperties(db: Db, personId?: number, today = todayIso()): PropertyView[] {
  const fy = financialYearOf(today)
  const out: PropertyView[] = []
  for (const a of manualAssetViews(db, personId)) {
    if (a.meta.kind !== 'PROPERTY') continue
    const m = a.meta as PropertyMeta
    const mode = propertyMode(m)
    const invested = m.purchasePrice + (m.buyingCosts ?? 0)

    // The city's market: this home's size band if reported, else the city overall.
    let market: PropertyView['market'] = null
    if (m.cityId) {
      let band = sizeBandOf(m.carpetAreaSqft)
      let pts = series(db, m.cityId, band)
      if (pts.length === 0 && band !== 'ALL') {
        band = 'ALL'
        pts = series(db, m.cityId, band)
      }
      const cityAll = band === 'ALL' ? pts : series(db, m.cityId, 'ALL')
      const latest = pts.at(-1) ?? null
      const yearAgo = latest ? [...pts].reverse().find((p) => p.date <= addMonths(latest.date, -12)) : undefined
      market = {
        cityId: m.cityId,
        cityName: m.cityName ?? `City ${m.cityId}`,
        band,
        series: pts,
        cityAll,
        latest,
        yoyPct: latest && yearAgo ? latest.close / yearAgo.close - 1 : null
      }
    }
    const pricePerSqft = market?.latest?.close ?? null
    const areaCheck = m.carpetAreaSqft && pricePerSqft ? { pricePerSqft, value: m.carpetAreaSqft * pricePerSqft } : null

    const lastEstimate = a.entries.length ? a.entries[a.entries.length - 1] : null
    const valuationNote = (() => {
      const city = market?.cityName
      if (mode === 'AREA' && areaCheck)
        return `${m.carpetAreaSqft!.toLocaleString('en-IN')} sq ft × ${city}'s average ${money(pricePerSqft!)}/sq ft for ${BAND_LABEL[market!.band]}${m.premiumPct ? `, ${m.premiumPct > 0 ? '+' : ''}${m.premiumPct}% for the locality` : ''} (NHB RESIDEX, quarter to ${day(market!.latest!.date)}).`
      if (mode !== 'MANUAL' && market?.latest)
        return `${lastEstimate ? `Your estimate of ${money(lastEstimate.value)} on ${day(lastEstimate.date)}` : `The purchase price of ${money(m.purchasePrice)}`}, grown with ${city}'s home prices (NHB RESIDEX, ${BAND_LABEL[market.band]}, to ${day(market.latest.date)}).`
      if (mode !== 'MANUAL' && m.cityId)
        return `${city}'s price series hasn't downloaded yet; it is fetched with the daily refresh. Until then: ${lastEstimate ? 'your latest estimate' : 'the purchase price'}${m.appreciation ? `, grown ${m.appreciation}% a year` : ''}.`
      if (m.appreciation)
        return `${lastEstimate ? 'Your latest estimate' : 'The purchase price'}, grown ${m.appreciation}% a year.`
      return lastEstimate
        ? `Your estimate of ${money(lastEstimate.value)} on ${day(lastEstimate.date)}.`
        : 'The purchase price; add an estimate or choose a city for a live value.'
    })()

    // Rent.
    const tenancies = tenanciesOf(m)
    let rent: PropertyView['rent'] = null
    if (tenancies.length) {
      const current =
        [...tenancies]
          .sort((x, y) => y.startDate.localeCompare(x.startDate))
          .find((t) => t.startDate <= today && (!t.endDate || t.endDate >= addDays(today, -60))) ?? null
      const months = rentMonths(m, fy.start, addMonths(today, 1), today)
      const overdueRows = months.filter((x) => x.status === 'OVERDUE' || (x.status === 'PART' && x.dueDate < today))
      const assumed = !recordsPayments(m)
      rent = {
        current,
        months,
        overdue: assumed ? 0 : overdueRows.reduce((s, x) => s + x.amount - x.paid, 0),
        overdueMonths: assumed ? 0 : overdueRows.length,
        receivedThisFy: assumed
          ? months.filter((x) => x.dueDate <= today).reduce((s, x) => s + x.amount, 0)
          : rentReceived(m, addDays(fy.start, -1), today),
        receivedLast12m: assumed ? (current?.monthlyRent ?? 0) * 12 : rentReceived(m, addMonths(today, -12), today),
        endsInDays: current?.endDate ? Math.round((Date.parse(current.endDate) - Date.parse(today)) / 86400000) : null,
        assumed
      }
    }

    // This financial year, as the ITR's "Income from house property" for a let-out property.
    const before = addDays(fy.start, -1)
    const rentFy = rent ? rent.receivedThisFy : 0
    const propertyTax = expensesBetween(m, before, fy.end, ['PROPERTY_TAX'])
    const loanInterest = expensesBetween(m, before, fy.end, ['LOAN_INTEREST'])
    const otherExpenses = expensesBetween(m, before, fy.end) - propertyTax - loanInterest
    const netAnnual = Math.max(0, rentFy - propertyTax)
    const taxableIncome = rent ? netAnnual - 0.3 * netAnnual - loanInterest : null

    const value = a.value
    const years = yearsBetween(m.purchaseDate, today)
    const cagr = value && invested > 0 && years >= 1 ? (value / invested) ** (1 / years) - 1 : null
    const flows = [
      { date: m.purchaseDate, amount: -invested },
      ...(m.rentPayments ?? []).filter((p) => p.date <= today).map((p) => ({ date: p.date, amount: p.amount })),
      ...(m.expenses ?? []).filter((e) => e.date <= today).map((e) => ({ date: e.date, amount: -e.amount })),
      ...(value ? [{ date: today, amount: value }] : [])
    ]
    let totalReturn: number | null = null
    try {
      totalReturn = value && years >= 1 ? xirr(flows) : null
    } catch {
      totalReturn = null
    }
    const yearExpenses = expensesBetween(m, addMonths(today, -12), today, [
      'PROPERTY_TAX',
      'MAINTENANCE',
      'REPAIR',
      'INSURANCE',
      'OTHER'
    ])
    out.push({
      accountId: a.accountId,
      personId: a.personId,
      personName: a.personName,
      meta: m,
      value,
      invested,
      gain: value !== null ? value - invested : null,
      cagr,
      totalReturn,
      mode,
      valuationNote,
      lastEstimate,
      market,
      areaCheck,
      rent,
      fy: { label: fy.label, rentReceived: rentFy, propertyTax, otherExpenses, loanInterest, taxableIncome },
      yield:
        rent && value && rent.receivedLast12m > 0
          ? { gross: rent.receivedLast12m / value, net: (rent.receivedLast12m - yearExpenses) / value }
          : null
    })
  }
  return out.sort((x, y) => (y.value ?? 0) - (x.value ?? 0))
}
