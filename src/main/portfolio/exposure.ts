import { desc, eq } from 'drizzle-orm'
import type {
  CapBand,
  DebtItem,
  DebtRating,
  DebtType,
  ExposureAssetType,
  ExposureReport,
  HoldingRow
} from '@shared/types'
import { schema, type Db } from '../db'
import { isInvit } from '../importers/isin'
import { fromIndustryText, fromNseIndustry } from '../market/sectors'
import { debtTypeOf, issuerKey, issuerOf, ratingOf } from './debt'
import { listHoldings } from './holdings'

export const NOT_BROKEN_DOWN = 'Not broken down'

type FundRow = typeof schema.fundHoldings.$inferSelect

const DEBT_CATEGORY =
  /debt|liquid|money market|overnight|gilt|bond|credit risk|duration|floater|banking and psu|corporate|fixed maturity|target maturity|arbitrage/i
const GOLD_CATEGORY = /gold|silver|commodit/i
const GOVT_SAVINGS =
  /\b(scss|senior citizens? savings|nsc|national savings|kvp|kisan vikas|pomis|post office|rbi (floating|savings)|frsb)\b/i

function regionOf(isin: string | null | undefined, country?: string | null): string {
  if (country)
    return country === 'IN' || /india/i.test(country)
      ? 'India'
      : country === 'US' || /united states/i.test(country)
        ? 'US'
        : 'Other'
  if (!isin) return 'India'
  if (isin.startsWith('IN')) return 'India'
  if (isin.startsWith('US')) return 'US'
  return 'Other'
}

export function computeExposure(db: Db, personId?: number): ExposureReport {
  return buildExposure(
    listHoldings(db, personId),
    loadFundHoldings(db),
    loadSectorMap(db),
    loadCategories(db),
    loadCaps(db)
  )
}

export interface CapList {
  byIsin: Map<string, 'LARGE' | 'MID' | 'SMALL'>
  period: string | null
}

function loadCaps(db: Db): CapList {
  const rows = db
    .select({ isin: schema.marketCaps.isin, category: schema.marketCaps.category, period: schema.marketCaps.period })
    .from(schema.marketCaps)
    .all()
  return { byIsin: new Map(rows.map((r) => [r.isin, r.category])), period: rows[0]?.period ?? null }
}

/** One disclosure per fund: an AMC file beats Yahoo's summary, then the latest month wins. */
export function pickLatestDisclosure(rows: FundRow[]): Map<number, FundRow[]> {
  const byFund = new Map<number, Map<string, FundRow[]>>()
  for (const r of rows) {
    const key = `${r.source === 'YAHOO' ? 0 : 1}|${r.asOf}|${r.source}`
    const fund = byFund.get(r.fundInstrumentId) ?? new Map<string, FundRow[]>()
    fund.set(key, [...(fund.get(key) ?? []), r])
    byFund.set(r.fundInstrumentId, fund)
  }
  const out = new Map<number, FundRow[]>()
  for (const [fundId, versions] of byFund) {
    const best = [...versions.keys()].sort().pop()!
    out.set(fundId, versions.get(best)!)
  }
  return out
}

function loadFundHoldings(db: Db): Map<number, FundRow[]> {
  return pickLatestDisclosure(db.select().from(schema.fundHoldings).orderBy(desc(schema.fundHoldings.asOf)).all())
}

function loadSectorMap(db: Db): Map<string, string> {
  return new Map(
    db
      .select()
      .from(schema.sectorMap)
      .all()
      .map((r) => [r.isin, fromNseIndustry(r.industry)])
  )
}

function loadCategories(db: Db): Map<number, string> {
  const m = new Map<number, string>()
  for (const i of db.select().from(schema.instruments).where(eq(schema.instruments.assetClass, 'MF')).all()) {
    const c = i.mfCategory ?? i.mfType
    if (c) m.set(i.id, c)
  }
  return m
}

export function buildExposure(
  rows: HoldingRow[],
  funds: Map<number, FundRow[]>,
  sectorByIsin: Map<string, string>,
  categories: Map<number, string>,
  caps: CapList = { byIsin: new Map(), period: null }
): ExposureReport {
  const assetMix = new Map<ExposureAssetType, number>()
  const sectors = new Map<string, { valueInr: number; directInr: number; viaFundsInr: number }>()
  const companies = new Map<string, ExposureReport['companies'][number]>()
  const geography = new Map<string, number>()
  const fundList = new Map<number, ExposureReport['funds'][number]>()
  const capTotals = new Map<CapBand, { valueInr: number; directInr: number; viaFundsInr: number }>()
  const debtItems = new Map<string, DebtItem>()
  let totalInr = 0

  const capOf = (isin: string | null | undefined, region: string): CapBand => {
    const listed = isin ? caps.byIsin.get(isin.toUpperCase()) : undefined
    if (listed) return listed
    return region === 'India' ? 'UNLISTED' : 'FOREIGN'
  }
  const addCap = (cap: CapBand, v: number, via: boolean) => {
    const c = capTotals.get(cap) ?? { valueInr: 0, directInr: 0, viaFundsInr: 0 }
    c.valueInr += v
    if (via) c.viaFundsInr += v
    else c.directInr += v
    capTotals.set(cap, c)
  }
  const addDebt = (
    v: number,
    via: boolean,
    d: {
      name: string
      isin: string | null
      type: DebtType
      rating: DebtRating
      ratingRaw?: string | null
      issuer?: string
    }
  ) => {
    const issuer = d.issuer ?? issuerOf(d.name, d.type)
    const key = d.isin ?? d.type + '|' + d.name.toLowerCase()
    const item = debtItems.get(key) ?? {
      name: d.name,
      isin: d.isin,
      issuer,
      type: d.type,
      rating: d.rating,
      ratingRaw: d.ratingRaw ?? null,
      valueInr: 0,
      directInr: 0,
      viaFundsInr: 0
    }
    item.valueInr += v
    if (via) item.viaFundsInr += v
    else item.directInr += v
    debtItems.set(key, item)
  }

  const addAsset = (t: ExposureAssetType, v: number) => assetMix.set(t, (assetMix.get(t) ?? 0) + v)
  const addRegion = (r: string, v: number) => geography.set(r, (geography.get(r) ?? 0) + v)
  const addEquity = (
    v: number,
    via: boolean,
    sector: string,
    company: { name: string; isin: string | null } | null,
    cap: CapBand
  ) => {
    addAsset('EQUITY', v)
    addCap(cap, v, via)
    const s = sectors.get(sector) ?? { valueInr: 0, directInr: 0, viaFundsInr: 0 }
    s.valueInr += v
    if (via) s.viaFundsInr += v
    else s.directInr += v
    sectors.set(sector, s)
    if (company) {
      const key = company.isin ?? company.name.toLowerCase()
      const c = companies.get(key) ?? {
        name: company.name,
        isin: company.isin,
        sector,
        cap,
        valueInr: 0,
        directInr: 0,
        viaFundsInr: 0
      }
      c.valueInr += v
      if (via) c.viaFundsInr += v
      else c.directInr += v
      companies.set(key, c)
    }
  }
  const sectorFor = (isin: string | null | undefined, given: string | null | undefined, raw?: string | null) =>
    (isin && sectorByIsin.get(isin)) || given || fromIndustryText(raw)

  for (const r of rows) {
    const v = r.marketValueInr ?? r.investedInr ?? 0
    if (v <= 0) continue
    totalInr += v
    const look = funds.get(r.instrumentId)

    if (look && look.length > 0) {
      fundList.set(r.instrumentId, {
        instrumentId: r.instrumentId,
        name: r.instrumentName,
        valueInr: (fundList.get(r.instrumentId)?.valueInr ?? 0) + v,
        holdingsAsOf: look[0].asOf,
        source: look[0].source
      })
      // Disclosures rarely sum to exactly 100% (receivables, rounding); scale to the fund's value.
      const sum = look.reduce((s, h) => s + h.weight, 0)
      const scale = sum > 0.5 ? 1 / sum : 1
      for (const h of look) {
        const part = v * h.weight * scale
        if (part === 0) continue
        if (h.assetType === 'EQUITY') {
          const synthetic = h.source === 'YAHOO' && !h.isin
          const region = regionOf(h.isin, h.country)
          addEquity(
            part,
            true,
            sectorFor(h.isin, h.sector, h.industryRaw),
            synthetic ? null : { name: h.name, isin: h.isin },
            capOf(h.isin, region)
          )
          addRegion(region, part)
        } else {
          addAsset(h.assetType, part)
          addRegion(regionOf(h.isin, h.country), part)
          if (h.assetType === 'DEBT') {
            const type = debtTypeOf(h.isin, h.name)
            addDebt(part, true, {
              name: h.name,
              isin: h.isin,
              type,
              rating: ratingOf(h.industryRaw, type),
              ratingRaw: h.industryRaw
            })
          }
        }
      }
      continue
    }

    switch (r.assetClass) {
      case 'EQUITY_IN':
        addEquity(
          v,
          false,
          sectorFor(r.isin, r.sector),
          { name: r.instrumentName, isin: r.isin },
          capOf(r.isin, 'India')
        )
        addRegion('India', v)
        break
      case 'EQUITY_US':
        addEquity(v, false, r.sector ?? 'Other', { name: r.instrumentName, isin: r.isin }, 'FOREIGN')
        addRegion('US', v)
        break
      case 'MF':
      case 'ETF': {
        const cat = categories.get(r.instrumentId) ?? r.instrumentName
        fundList.set(r.instrumentId, {
          instrumentId: r.instrumentId,
          name: r.instrumentName,
          valueInr: (fundList.get(r.instrumentId)?.valueInr ?? 0) + v,
          holdingsAsOf: null,
          source: null
        })
        if (DEBT_CATEGORY.test(cat)) {
          addAsset('DEBT', v)
          addDebt(v, true, {
            name: r.instrumentName,
            isin: null,
            type: 'NOT_BROKEN_DOWN',
            rating: 'NOT_BROKEN_DOWN',
            issuer: r.instrumentName
          })
        } else if (GOLD_CATEGORY.test(cat)) addAsset('GOLD', v)
        else addEquity(v, true, NOT_BROKEN_DOWN, null, 'NOT_BROKEN_DOWN')
        addRegion('India', v)
        break
      }
      case 'NPS':
        if (/scheme\s*e\b|equity/i.test(r.instrumentName)) addEquity(v, true, NOT_BROKEN_DOWN, null, 'NOT_BROKEN_DOWN')
        else if (/scheme\s*[cg]\b|govt|government|corporate/i.test(r.instrumentName)) {
          addAsset('DEBT', v)
          // NPS scheme G holds government securities; scheme C corporate bonds.
          const gov = /scheme\s*g\b|govt|government/i.test(r.instrumentName)
          addDebt(v, true, {
            name: r.instrumentName,
            isin: null,
            type: gov ? 'GSEC' : 'CORPORATE',
            rating: gov ? 'SOVEREIGN' : 'NOT_BROKEN_DOWN',
            issuer: gov ? 'Government of India' : r.instrumentName
          })
        } else addAsset('OTHER', v)
        addRegion('India', v)
        break
      case 'EPF':
      case 'PPF':
        addAsset('DEBT', v)
        addRegion('India', v)
        // Government-run schemes: EPF by the EPFO, PPF and SSY by the Government of India.
        addDebt(v, false, {
          name: r.instrumentName,
          isin: null,
          type: 'SMALL_SAVINGS',
          rating: 'SOVEREIGN',
          issuer: r.assetClass === 'EPF' ? 'EPFO' : 'Government of India'
        })
        break
      case 'FD':
        addAsset('DEBT', v)
        addRegion('India', v)
        // Post office schemes (SCSS, NSC, KVP, MIS, TD) and RBI savings bonds are owed by the government.
        if (r.platform === 'POST_OFFICE' || GOVT_SAVINGS.test(r.instrumentName))
          addDebt(v, false, {
            name: r.instrumentName,
            isin: null,
            type: 'SMALL_SAVINGS',
            rating: 'SOVEREIGN',
            issuer: 'Government of India'
          })
        else
          addDebt(v, false, {
            name: r.instrumentName,
            isin: null,
            type: 'DEPOSIT',
            rating: 'DEPOSIT',
            issuer: r.instrumentName
          })
        break
      case 'BOND': {
        addAsset('DEBT', v)
        addRegion('India', v)
        const type = debtTypeOf(r.isin, r.instrumentName)
        addDebt(v, false, {
          name: r.instrumentName,
          isin: r.isin,
          type: type === 'OTHER' ? 'CORPORATE' : type,
          rating: ratingOf(null, type)
        })
        break
      }
      case 'GOLD':
        addAsset('GOLD', v)
        addRegion('India', v)
        break
      case 'REAL_ESTATE':
        addAsset('REAL_ESTATE', v)
        addRegion('India', v)
        break
      case 'REIT':
        // REITs own offices and malls; InvITs own roads, power lines and towers.
        addAsset(isInvit(r.isin, r.instrumentName) ? 'OTHER' : 'REAL_ESTATE', v)
        addRegion('India', v)
        break
      case 'CRYPTO':
        addAsset('CRYPTO', v)
        addRegion('Other', v)
        break
      case 'CASH':
        addAsset('CASH', v)
        addRegion('India', v)
        break
      default:
        addAsset('OTHER', v)
        addRegion('India', v)
    }
  }

  return {
    totalInr,
    assetMix: [...assetMix].map(([type, valueInr]) => ({ type, valueInr })).sort((a, b) => b.valueInr - a.valueInr),
    sectors: [...sectors].map(([sector, s]) => ({ sector, ...s })).sort((a, b) => b.valueInr - a.valueInr),
    companies: [...companies.values()].sort((a, b) => b.valueInr - a.valueInr),
    marketCap: [...capTotals].map(([cap, c]) => ({ cap, ...c })).sort((a, b) => b.valueInr - a.valueInr),
    capListPeriod: caps.period,
    debt: debtReport([...debtItems.values()]),
    geography: [...geography]
      .map(([region, valueInr]) => ({ region, valueInr }))
      .sort((a, b) => b.valueInr - a.valueInr),
    funds: [...fundList.values()].sort((a, b) => b.valueInr - a.valueInr)
  }
}

/** Debt totals by type and by rating; one issuer's papers share its first-seen name. */
function debtReport(items: DebtItem[]): ExposureReport['debt'] {
  const names = new Map<string, string>()
  for (const i of items.sort((a, b) => b.valueInr - a.valueInr)) {
    const key = issuerKey(i.isin, i.issuer)
    if (!names.has(key)) names.set(key, i.issuer)
    i.issuer = names.get(key)!
  }
  const sum = <K extends string>(key: (i: DebtItem) => K) => {
    const m = new Map<K, number>()
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + i.valueInr)
    return [...m].sort((a, b) => b[1] - a[1])
  }
  return {
    totalInr: items.reduce((s, i) => s + i.valueInr, 0),
    types: sum((i) => i.type).map(([type, valueInr]) => ({ type, valueInr })),
    ratings: sum((i) => i.rating).map(([rating, valueInr]) => ({ rating, valueInr })),
    items
  }
}
