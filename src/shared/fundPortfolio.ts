// What a fund owns, period by period: how it is split between shares, bonds and cash against the
// range its category allows, and its sectors in each period. Indian funds: the fund house's monthly
// portfolio files, against SEBI's category rules (SEBI circular of 6 Oct 2017 on categorising
// mutual fund schemes). US ETFs: their quarterly N-PORT filings with the SEC. US and UCITS ETFs
// otherwise: Yahoo Finance's summary of the top holdings and sectors, kept once a month.

export type AllocLabel = 'Equity' | 'Debt' | 'Cash & equivalents' | 'Other'

export interface TargetRange {
  label: AllocLabel
  /** Shares of the fund, 0..1. */
  min: number
  max: number
}

export interface PortfolioPeriod {
  /** Date of the portfolio (month or quarter end, or the day Yahoo's summary was read). */
  asOf: string
  alloc: { label: AllocLabel; weight: number }[]
  sectors: { sector: string; weight: number }[]
}

export interface PortfolioView {
  periods: PortfolioPeriod[]
  /** The range SEBI's rules allow the category; null where none applies. */
  target: TargetRange[] | null
  source: string
}

/** A snapshot of a global ETF's portfolio, as stored. */
export interface PortfolioSnapshot {
  asOf: string
  source: 'NPORT' | 'YAHOO'
  alloc: { label: AllocLabel; weight: number }[]
  sectors: { sector: string; weight: number }[]
  holdings: { name: string; isin: string | null; sector: string | null; assetType: 'EQUITY' | 'DEBT' | 'CASH' | 'OTHER'; country: string | null; weight: number }[]
}

const eq = (min: number, max: number): TargetRange[] => [
  { label: 'Equity', min, max },
  { label: 'Cash & equivalents', min: 0, max: 1 - min }
]
const mix = (eMin: number, eMax: number, dMin: number, dMax: number): TargetRange[] => [
  { label: 'Equity', min: eMin, max: eMax },
  { label: 'Debt', min: dMin, max: dMax }
]

/**
 * SEBI's limits for an AMFI category name (as the NAV file writes it). Equity categories must keep
 * at least the stated share in shares (the rest may be cash and bonds); hybrids have ranges for both.
 */
export function sebiTarget(category: string, passiveEquity = false): TargetRange[] | null {
  const c = category.toLowerCase()
  if (/large & mid|large and mid/.test(c)) return eq(0.7, 1)
  if (/large cap/.test(c)) return eq(0.8, 1)
  if (/mid cap|small cap|flexi cap|focused|value|contra|dividend yield/.test(c)) return eq(0.65, 1)
  if (/multi cap/.test(c)) return eq(0.75, 1)
  if (/elss|tax saver/.test(c)) return eq(0.8, 1)
  if (/sectoral|thematic/.test(c)) return eq(0.8, 1)
  if (/aggressive hybrid/.test(c)) return mix(0.65, 0.8, 0.2, 0.35)
  if (/conservative hybrid/.test(c)) return mix(0.1, 0.25, 0.75, 0.9)
  if (/balanced hybrid/.test(c)) return mix(0.4, 0.6, 0.4, 0.6)
  if (/equity savings/.test(c)) return mix(0.65, 0.9, 0.1, 0.35)
  if (/arbitrage/.test(c)) return eq(0.65, 1)
  if (/multi asset/.test(c)) return mix(0.1, 0.8, 0.1, 0.8)
  if (/dynamic asset|balanced advantage/.test(c)) return mix(0, 1, 0, 1)
  if (passiveEquity && /index|etf/.test(c)) return eq(0.95, 1)
  return null
}

/** Asset types in the stored holdings, as the allocation's labels. */
export function allocLabel(assetType: string): AllocLabel {
  return assetType === 'EQUITY' ? 'Equity' : assetType === 'DEBT' ? 'Debt' : assetType === 'CASH' ? 'Cash & equivalents' : 'Other'
}

/** The allocation of a list of holdings, largest first. */
export function allocOf(rows: { assetType: string; weight: number }[]): { label: AllocLabel; weight: number }[] {
  const m = new Map<AllocLabel, number>()
  for (const r of rows) m.set(allocLabel(r.assetType), (m.get(allocLabel(r.assetType)) ?? 0) + r.weight)
  return [...m].filter(([, w]) => Math.abs(w) > 1e-6).map(([label, weight]) => ({ label, weight })).sort((a, b) => b.weight - a.weight)
}

// ---------------- SEC N-PORT ----------------

const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1]?.trim() ?? null

/** N-PORT asset categories (Form N-PORT, Item C.4) as the app's asset types. */
function nportType(cat: string | null): PortfolioSnapshot['holdings'][number]['assetType'] {
  if (!cat) return 'OTHER'
  if (/^(EC|EP)$/.test(cat)) return 'EQUITY'
  if (/^(DBT|ABS-|LON|SN)/.test(cat)) return 'DEBT'
  if (/^(STIV|RA|RE)$/.test(cat)) return 'CASH'
  return 'OTHER'
}

/**
 * A filing's primary_doc.xml: the report date and every holding with its share of net assets.
 * N-PORT names issuers but gives no sector, so sectors are left empty (countries are kept).
 */
export function parseNport(xml: string): PortfolioSnapshot {
  const asOf = tag(xml, 'repPdDate') ?? tag(xml, 'repPdEnd')
  if (!asOf) throw new Error('No report date in the N-PORT filing')
  const holdings: PortfolioSnapshot['holdings'] = []
  for (const m of xml.matchAll(/<(?:\w+:)?invstOrSec>([\s\S]*?)<\/(?:\w+:)?invstOrSec>/g)) {
    const b = m[1]
    const pct = Number(tag(b, 'pctVal'))
    if (!Number.isFinite(pct)) continue
    const isin = /<(?:\w+:)?isin\s+value="([A-Z0-9]{12})"/.exec(b)?.[1] ?? null
    holdings.push({
      name: (tag(b, 'name') ?? tag(b, 'title') ?? '?').replace(/&amp;/g, '&'),
      isin,
      sector: null,
      assetType: nportType(tag(b, 'assetCat')),
      country: tag(b, 'invCountry'),
      weight: pct / 100
    })
  }
  if (!holdings.length) throw new Error('No holdings in the N-PORT filing')
  holdings.sort((a, b) => b.weight - a.weight)
  return { asOf: asOf.slice(0, 10), source: 'NPORT', alloc: allocOf(holdings), sectors: [], holdings }
}

/** EDGAR's Atom list of a series' filings: the NPORT-P filings' index pages, newest first. */
export function nportFilings(atom: string): { accession: string; cik: string; filed: string }[] {
  const out: { accession: string; cik: string; filed: string }[] = []
  for (const e of atom.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const b = e[1]
    if (!/NPORT-P/.test(b)) continue
    const href = /edgar\/data\/(\d+)\/(\d{18})\//.exec(b)
    if (!href) continue
    out.push({ cik: href[1], accession: href[2], filed: tag(b, 'filing-date') ?? tag(b, 'updated')?.slice(0, 10) ?? '' })
  }
  return out.sort((a, b) => b.filed.localeCompare(a.filed))
}

/**
 * A global ETF's periods from its stored snapshots. N-PORT filings give the allocation and every
 * holding but no sectors, so a filing takes the sectors of Yahoo's summary read in the same month;
 * Yahoo's summaries from other months (with sectors) are periods of their own, so the sector charts
 * fill in as months pass. `holdings` is the N-PORT snapshots (or Yahoo's, where there are none).
 */
export function globalPeriods(snaps: PortfolioSnapshot[]): { holdings: PortfolioSnapshot[]; periods: PortfolioPeriod[] } {
  const toPeriod = (s: PortfolioSnapshot): PortfolioPeriod => ({ asOf: s.asOf, alloc: s.alloc, sectors: s.sectors })
  const nport = snaps.filter((s) => s.source === 'NPORT')
  const yahoo = snaps.filter((s) => s.source === 'YAHOO')
  if (!nport.length) return { holdings: yahoo, periods: yahoo.map(toPeriod) }
  const month = (s: PortfolioSnapshot) => s.asOf.slice(0, 7)
  const enriched = nport.map((n) => {
    const y = n.sectors.length ? undefined : yahoo.find((x) => month(x) === month(n) && x.sectors.length)
    return y ? { ...n, sectors: y.sectors } : n
  })
  const extra = yahoo.filter((y) => y.sectors.length && !nport.some((n) => month(n) === month(y)))
  return { holdings: enriched, periods: [...enriched, ...extra].map(toPeriod).sort((a, b) => a.asOf.localeCompare(b.asOf)) }
}
