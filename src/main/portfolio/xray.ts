import type { HoldingRow } from '@shared/types'
import type { XrayCompany, XrayReport } from '@shared/xray'
import { schema, type Db } from '../db'
import { listHoldings } from './holdings'
import { loadExposureInputs } from './exposure'

type FundRow = typeof schema.fundHoldings.$inferSelect

export function computeXray(db: Db, personId?: number): XrayReport {
  const { funds, sectors } = loadExposureInputs(db)
  return buildXray(listHoldings(db, personId), funds, sectors)
}

/** Pure, for tests: holdings plus each fund's latest disclosure. */
export function buildXray(rows: HoldingRow[], funds: Map<number, FundRow[]>, sectorByIsin: Map<string, string> = new Map()): XrayReport {
  const companies = new Map<string, XrayCompany>()
  const fundValue = new Map<number, { name: string; valueInr: number }>()
  const fundWeights = new Map<number, Map<string, number>>()
  let unknownInr = 0
  const add = (isin: string, name: string, sector: string | null, v: number, via?: { instrumentId: number; fund: string }) => {
    const key = isin.toUpperCase()
    const c = companies.get(key) ?? { isin: key, name, sector: sector ?? sectorByIsin.get(key) ?? null, valueInr: 0, share: 0, directInr: 0, via: [] }
    c.valueInr += v
    if (via) {
      const v0 = c.via.find((x) => x.instrumentId === via.instrumentId)
      if (v0) v0.valueInr += v
      else c.via.push({ ...via, valueInr: v })
    } else c.directInr += v
    if (!c.sector) c.sector = sector ?? sectorByIsin.get(key) ?? null
    companies.set(key, c)
  }

  // Positions in the same instrument across people and accounts count once per instrument.
  const byInstrument = new Map<number, HoldingRow & { total: number }>()
  for (const h of rows) {
    if (!h.marketValueInr || h.marketValueInr <= 0) continue
    const cur = byInstrument.get(h.instrumentId)
    if (cur) cur.total += h.marketValueInr
    else byInstrument.set(h.instrumentId, { ...h, total: h.marketValueInr })
  }
  for (const h of byInstrument.values()) {
    if (h.assetClass === 'EQUITY_IN' && h.isin) {
      add(h.isin, h.instrumentName, h.sector, h.total)
    } else if (h.assetClass === 'MF' || h.assetClass === 'ETF') {
      const list = funds.get(h.instrumentId)
      const equity = (list ?? []).filter((r) => r.assetType === 'EQUITY' && r.isin)
      if (equity.length === 0) {
        // A fund with no holdings on file: its equity can't be looked into (a debt fund adds nothing).
        if (!list) unknownInr += /debt|liquid|gilt|bond|money market|overnight/i.test(h.instrumentName) ? 0 : h.total
        continue
      }
      fundValue.set(h.instrumentId, { name: h.instrumentName, valueInr: h.total })
      const weights = new Map<string, number>()
      for (const r of equity) {
        const key = r.isin!.toUpperCase()
        weights.set(key, (weights.get(key) ?? 0) + r.weight)
        add(key, r.name, r.sector, h.total * r.weight, { instrumentId: h.instrumentId, fund: h.instrumentName })
      }
      fundWeights.set(h.instrumentId, weights)
    }
  }

  const list = [...companies.values()].sort((a, b) => b.valueInr - a.valueInr)
  const equityInr = list.reduce((s, c) => s + c.valueInr, 0)
  for (const c of list) {
    c.share = equityInr ? c.valueInr / equityInr : 0
    c.via.sort((a, b) => b.valueInr - a.valueInr)
  }
  const topShare = (n: number) => list.slice(0, n).reduce((s, c) => s + c.share, 0)
  const hhi = list.reduce((s, c) => s + c.share * c.share, 0)

  const fundIds = [...fundWeights.keys()].sort((a, b) => fundValue.get(b)!.valueInr - fundValue.get(a)!.valueInr)
  const common = fundIds.map((a) =>
    fundIds.map((b) => {
      if (a === b) return 1
      const wa = fundWeights.get(a)!
      const wb = fundWeights.get(b)!
      let s = 0
      for (const [isin, w] of wa) {
        const o = wb.get(isin)
        if (o) s += Math.min(w, o)
      }
      return s
    })
  )

  return {
    equityInr,
    unknownInr,
    companies: list,
    concentration: { top5: topShare(5), top10: topShare(10), top20: topShare(20), hhi, effectiveStocks: hhi > 0 ? 1 / hhi : 0 },
    overlap: { funds: fundIds.map((id) => ({ instrumentId: id, ...fundValue.get(id)! })), common },
    repeated: list
      .map((c) => ({ isin: c.isin, name: c.name, ways: c.via.length + (c.directInr > 0 ? 1 : 0), valueInr: c.valueInr }))
      .filter((r) => r.ways >= 3)
  }
}
