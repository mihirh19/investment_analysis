import type { MoneyByCountry } from '@shared/world'
import { alpha3From2, countryName, isCountry } from '@shared/countries'
import type { Db } from '../db'
import { loadExposureInputs } from '../portfolio/exposure'
import { listHoldings } from '../portfolio/holdings'

/**
 * Where the family's investments sit, by country: shares by where the company is listed (its ISIN),
 * funds opened up into what they hold (their monthly disclosures give each holding's country).
 * Funds whose holdings aren't on file count by their own country, except overseas funds of funds,
 * which can't be placed and are counted apart.
 */

const OVERSEAS = /international|global|overseas|world|nasdaq|s&p 500|us equity|u\.s\.|china|japan|europe|asean|emerging market/i
const NAMES = new Map<string, string>([
  ['INDIA', 'IND'],
  ['UNITED STATES', 'USA'],
  ['UNITED STATES OF AMERICA', 'USA'],
  ['USA', 'USA'],
  ['UK', 'GBR'],
  ['UNITED KINGDOM', 'GBR'],
  ['TAIWAN', 'TWN'],
  ['SOUTH KOREA', 'KOR'],
  ['KOREA', 'KOR'],
  ['CHINA', 'CHN'],
  ['HONG KONG', 'HKG'],
  ['JAPAN', 'JPN'],
  ['GERMANY', 'DEU'],
  ['FRANCE', 'FRA'],
  ['NETHERLANDS', 'NLD'],
  ['SWITZERLAND', 'CHE'],
  ['IRELAND', 'IRL'],
  ['CANADA', 'CAN']
])

/** ISO 2 or 3 letters, or a country's name, to ISO 3. */
export function countryOf(raw: string | null | undefined): string | null {
  const s = raw?.trim().toUpperCase()
  if (!s) return null
  if (s.length === 2) return alpha3From2(s)
  if (s.length === 3 && isCountry(s)) return s
  return NAMES.get(s) ?? null
}
const fromIsin = (isin: string | null | undefined) => (isin && /^[A-Z]{2}/.test(isin) && !isin.startsWith('XS') ? alpha3From2(isin.slice(0, 2)) : null)

export function moneyByCountry(db: Db, personId?: number): MoneyByCountry {
  const { funds } = loadExposureInputs(db)
  const by = new Map<string, { direct: number; viaFunds: number }>()
  let total = 0
  let unknown = 0
  const add = (iso3: string, v: number, via: boolean) => {
    const c = by.get(iso3) ?? { direct: 0, viaFunds: 0 }
    if (via) c.viaFunds += v
    else c.direct += v
    by.set(iso3, c)
  }
  for (const h of listHoldings(db, personId)) {
    const v = h.marketValueInr ?? 0
    if (v <= 0) continue
    total += v
    const look = funds.get(h.instrumentId)
    if (look && look.length) {
      const sum = look.reduce((s, x) => s + x.weight, 0)
      const scale = sum > 0.5 ? 1 / sum : 1
      const home = fromIsin(h.isin) ?? 'IND'
      for (const x of look) add(countryOf(x.country) ?? fromIsin(x.isin) ?? home, v * x.weight * scale, true)
      continue
    }
    if (h.assetClass === 'EQUITY_US') add('USA', v, false)
    else if ((h.assetClass === 'MF' || h.assetClass === 'ETF') && OVERSEAS.test(h.instrumentName)) unknown += v
    else add(fromIsin(h.isin) ?? 'IND', v, h.assetClass === 'MF' || h.assetClass === 'ETF')
  }
  const countries = [...by]
    .map(([iso3, c]) => ({ iso3, name: countryName(iso3), valueInr: c.direct + c.viaFunds, share: total ? (c.direct + c.viaFunds) / total : 0, direct: c.direct, viaFunds: c.viaFunds }))
    .sort((a, b) => b.valueInr - a.valueInr)
  return { totalInr: total, unknownInr: unknown, countries }
}
