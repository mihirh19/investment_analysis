import { and, eq, isNotNull } from 'drizzle-orm'
import type { AssetClass } from '@shared/types'
import { schema, type Db } from '../db'

/**
 * What a demat holding is, from its ISIN (and name as a backstop). CDSL and NSDL statements list
 * government securities, NCDs and REIT/InvIT units in the same table as shares.
 *
 * Indian ISINs: IN + issuer type (E company, F mutual fund, a digit for central/state
 * government) + issuer code + a two-digit security type (01 equity shares, 07/08 debentures and
 * bonds, 14 commercial paper, 16 certificates of deposit, 23 InvIT units, 25 REIT units) + serial
 * + check digit.
 */
export function dematClass(isin: string, name?: string | null): AssetClass {
  const id = isin.trim().toUpperCase()
  const n = name ?? ''
  if (/^IN[0-9]/.test(id)) {
    // Government paper: Sovereign Gold Bonds are gold, the rest (G-secs, SDLs, T-bills) debt.
    return /\bsgb\b|sovereign gold/i.test(n) ? 'GOLD' : 'BOND'
  }
  if (id.startsWith('INF')) return 'ETF'
  const type = id.slice(7, 9)
  if (type === '25' || type === '23' || isTrustUnit(n)) return 'REIT'
  // Newer ISINs put a letter first ("A7" is a debenture), so the second character carries the kind.
  if (/^[0-9A-Z][78]$/.test(type) || ['14', '16', '15'].includes(type) || /^[A-Z][46]$/.test(type)) return 'BOND'
  if (/\b(ncd|debentures?|bonds?|commercial paper)\b/i.test(n)) return 'BOND'
  return 'EQUITY_IN'
}

/**
 * An exchange-traded fund, by name: "NIPPON INDIA ETF NIFTY 50 BEES", "MOTILAL OSWAL NIFTY MIDCAP
 * 100 ETF". Funds that invest in ETFs ("… ETF FOF", "Fund of Funds") are ordinary mutual funds.
 */
export const isEtfName = (name: string) =>
  /\betf\b|\bbees\b|exchange traded/i.test(name) && !/\bfof\b|fund of funds?|\bfund of fund\b/i.test(name)

const isTrustUnit = (name: string) =>
  /\breit\b|\binvit\b|real estate investment trust|infrastructure investment trust/i.test(name)

/** An InvIT (roads, power lines, towers) rather than a REIT (offices, malls). */
export function isInvit(isin: string | null, name: string): boolean {
  if (/\binvit\b|infrastructure investment trust|infra(structure)? trust/i.test(name)) return true
  return !!isin && isin.toUpperCase().slice(7, 9) === '23'
}

/**
 * Fixes holdings imported before the classification above: statements read earlier recorded
 * bonds and REIT units as shares. Returns how many were changed.
 */
export function reclassifyDemat(db: Db): number {
  let changed = 0
  const rows = db
    .select({ id: schema.instruments.id, isin: schema.instruments.isin, name: schema.instruments.name })
    .from(schema.instruments)
    .where(and(eq(schema.instruments.assetClass, 'EQUITY_IN'), isNotNull(schema.instruments.isin)))
    .all()
  for (const r of rows) {
    const cls = dematClass(r.isin!, r.name)
    if (cls === 'EQUITY_IN') continue
    // Forget the stock lookups (sector, symbol) so the right source is used from now on.
    db.update(schema.instruments)
      .set({ assetClass: cls, sector: null, industry: null, metaUpdatedAt: null })
      .where(eq(schema.instruments.id, r.id))
      .run()
    changed++
  }
  // ETF units held in demat that a statement listed with its mutual funds (CDSL does).
  const etfIsins = new Set(
    db
      .select({ isin: schema.nseListings.isin })
      .from(schema.nseListings)
      .where(eq(schema.nseListings.kind, 'ETF'))
      .all()
      .map((r) => r.isin)
  )
  for (const i of db
    .select({ id: schema.instruments.id, isin: schema.instruments.isin, name: schema.instruments.name })
    .from(schema.instruments)
    .where(eq(schema.instruments.assetClass, 'MF'))
    .all()) {
    if (!(isEtfName(i.name) || (i.isin && etfIsins.has(i.isin)))) continue
    db.update(schema.instruments)
      .set({ assetClass: 'ETF', metaUpdatedAt: null })
      .where(eq(schema.instruments.id, i.id))
      .run()
    changed++
  }
  return changed
}

/**
 * Statement names carry corporate-action notes and fund-house prefixes ("AFTER SUB-DIVISION GRASIM
 * INDUSTRIES LIMITED # NEW EQ SH WITH FV RE 2/-", "NIPPON LIFE INDIA AM LTD#NIPPON INDIA MF-…").
 * Shares take NSE's listed name; funds and ETFs their AMFI scheme name.
 */
const NOISY_NAME =
  /after (sub[\s-]?division|split|bonus)|new eq(uity)?\s+sh|equity shares|#|\bfv\b|face value|\bre\.?\s*\d|\brs\.?\s*\d/i

export function tidyListedNames(db: Db): number {
  let changed = 0
  const listed = new Map(
    db
      .select({ isin: schema.nseListings.isin, name: schema.nseListings.name })
      .from(schema.nseListings)
      .where(eq(schema.nseListings.kind, 'EQ'))
      .all()
      .map((l) => [l.isin, l.name])
  )
  for (const i of db
    .select({
      id: schema.instruments.id,
      isin: schema.instruments.isin,
      name: schema.instruments.name,
      schemeName: schema.instruments.schemeName,
      assetClass: schema.instruments.assetClass
    })
    .from(schema.instruments)
    .where(isNotNull(schema.instruments.isin))
    .all()) {
    const plain = i.assetClass === 'MF' || i.assetClass === 'ETF' ? i.schemeName : listed.get(i.isin!)
    if (!plain || plain === i.name || !NOISY_NAME.test(i.name)) continue
    db.update(schema.instruments).set({ name: plain }).where(eq(schema.instruments.id, i.id)).run()
    changed++
  }
  return changed
}
