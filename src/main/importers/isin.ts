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
  return changed
}
