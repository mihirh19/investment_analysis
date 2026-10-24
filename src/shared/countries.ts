import codes from 'i18n-iso-countries/codes.json'
import en from 'i18n-iso-countries/langs/en.json'

/**
 * ISO 3166 country codes and English names, for joining world data: world-atlas shapes carry the
 * numeric code, the BIS the two-letter one, and most other sources the three-letter one.
 */
const rows = codes as string[][]
const names = en.countries as Record<string, string | string[]>

const by2 = new Map<string, string>()
const byNum = new Map<string, string>()
const name3 = new Map<string, string>()
for (const [a2, a3, num] of rows) {
  by2.set(a2, a3)
  byNum.set(num, a3)
  const n = names[a2]
  name3.set(a3, Array.isArray(n) ? n[0] : (n ?? a3))
}

/** Places without an ISO code of their own, with the codes the app uses for them. */
export const EXTRA_PLACES: Record<string, { code: string; name: string }> = {
  Kosovo: { code: 'XKX', name: 'Kosovo' },
  Somaliland: { code: 'SOL', name: 'Somaliland' },
  'N. Cyprus': { code: 'CYN', name: 'Northern Cyprus' },
  'Indian Ocean Ter.': { code: 'IOA', name: 'Indian Ocean Territories' },
  'Siachen Glacier': { code: 'KAS', name: 'Siachen Glacier' }
}
for (const p of Object.values(EXTRA_PLACES)) name3.set(p.code, p.name)
by2.set('XK', 'XKX')

/** Shorter everyday names for a few long official ones. */
const SHORT: Record<string, string> = {
  USA: 'United States',
  GBR: 'United Kingdom',
  RUS: 'Russia',
  KOR: 'South Korea',
  PRK: 'North Korea',
  IRN: 'Iran',
  SYR: 'Syria',
  VNM: 'Vietnam',
  LAO: 'Laos',
  BOL: 'Bolivia',
  VEN: 'Venezuela',
  TZA: 'Tanzania',
  MDA: 'Moldova',
  TWN: 'Taiwan',
  COD: 'DR Congo',
  COG: 'Congo',
  ARE: 'UAE',
  CZE: 'Czechia',
  BRN: 'Brunei',
  FSM: 'Micronesia',
  PSE: 'Palestine'
}
for (const [k, v] of Object.entries(SHORT)) name3.set(k, v)

export const alpha3From2 = (a2: string): string | null => by2.get(a2.toUpperCase()) ?? null
export const alpha3FromNumeric = (num: string | number): string | null =>
  byNum.get(String(num).padStart(3, '0')) ?? null
export const countryName = (a3: string): string => name3.get(a3) ?? a3
/** A real country (or a place the map draws), not a region or income group such as "World" or "EAS". */
export const isCountry = (a3: string): boolean => name3.has(a3)

/** Euro-area members in 2026; the ECB's rate and the euro's moves apply to each. */
export const EURO_AREA = [
  'AUT',
  'BEL',
  'BGR',
  'HRV',
  'CYP',
  'EST',
  'FIN',
  'FRA',
  'DEU',
  'GRC',
  'IRL',
  'ITA',
  'LVA',
  'LTU',
  'LUX',
  'MLT',
  'NLD',
  'PRT',
  'SVK',
  'SVN',
  'ESP'
]
