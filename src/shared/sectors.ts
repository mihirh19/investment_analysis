// Sectors across the whole market: NSE's four-level classification (macro, sector, industry, basic
// industry) with the screener's rows added up at each level.

import type { ScreenRow } from './screener'

export interface IndustryClass {
  symbol: string
  macro: string | null
  sector: string | null
  industry: string | null
  basicIndustry: string | null
}

export interface IndustryMap {
  classes: IndustryClass[]
  /** Listed companies, and how many have been classified so far. */
  companies: number
  classified: number
}

export const SECTOR_LEVELS = ['sector', 'industry', 'basicIndustry'] as const
export type SectorLevel = (typeof SECTOR_LEVELS)[number]
export const LEVEL_LABEL: Record<SectorLevel, string> = { sector: 'Sector', industry: 'Industry', basicIndustry: 'Basic industry' }

export interface SectorGroup {
  name: string
  companies: number
  held: number
  mcap: number
  /** Market-value weighted moves. */
  change: number | null
  ret1m: number | null
  ret1y: number | null
  /** Share of companies up on the day. */
  breadth: number | null
  medianPe: number | null
  /** The biggest companies, largest first. */
  leaders: string[]
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Rows under a path of names from the top level down (e.g. ["Financial Services", "Banks"]). */
export function rowsUnder(rows: ScreenRow[], classOf: Map<string, IndustryClass>, path: string[]): ScreenRow[] {
  return rows.filter((r) => {
    const c = classOf.get(r.symbol)
    return !!c && path.every((name, i) => c[SECTOR_LEVELS[i]] === name)
  })
}

/** The rows grouped at one level, biggest by market value first. */
export function groupRows(rows: ScreenRow[], classOf: Map<string, IndustryClass>, level: SectorLevel): SectorGroup[] {
  const by = new Map<string, ScreenRow[]>()
  for (const r of rows) {
    const name = classOf.get(r.symbol)?.[level]
    if (!name) continue
    const list = by.get(name) ?? []
    list.push(r)
    by.set(name, list)
  }
  const weighted = (list: ScreenRow[], k: 'change' | 'ret1m' | 'ret1y') => {
    let w = 0
    let s = 0
    for (const r of list) {
      const v = r[k]
      if (v === null || !r.mcap) continue
      w += r.mcap
      s += r.mcap * v
    }
    return w ? s / w : null
  }
  return [...by]
    .map(([name, list]) => {
      const moved = list.filter((r) => r.change !== null)
      return {
        name,
        companies: list.length,
        held: list.filter((r) => r.held).length,
        mcap: list.reduce((s, r) => s + (r.mcap ?? 0), 0),
        change: weighted(list, 'change'),
        ret1m: weighted(list, 'ret1m'),
        ret1y: weighted(list, 'ret1y'),
        breadth: moved.length ? moved.filter((r) => r.change! > 0).length / moved.length : null,
        medianPe: median(list.map((r) => r.pe).filter((v): v is number => v !== null && v > 0)),
        leaders: [...list].sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0)).slice(0, 3).map((r) => r.name)
      }
    })
    .sort((a, b) => b.mcap - a.mcap)
}
