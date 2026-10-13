/**
 * One sector vocabulary for the whole portfolio, based on NSE's industry classification
 * (what Indian stocks are tagged with), with Yahoo's GICS-style sectors and the AMFI
 * industry labels used in fund portfolio disclosures mapped onto it.
 */
export const SECTORS = [
  'Financial Services',
  'Information Technology',
  'Oil Gas & Consumable Fuels',
  'Fast Moving Consumer Goods',
  'Automobile and Auto Components',
  'Healthcare',
  'Capital Goods',
  'Metals & Mining',
  'Power',
  'Telecommunication',
  'Construction',
  'Construction Materials',
  'Consumer Durables',
  'Consumer Services',
  'Chemicals',
  'Realty',
  'Media Entertainment & Publication',
  'Services',
  'Textiles',
  'Diversified',
  'Forest Materials',
  'Utilities',
  'Communication Services',
  'Consumer Discretionary'
] as const

export type Sector = (typeof SECTORS)[number] | 'Other'

const KNOWN = new Set<string>(SECTORS)

/** NSE industry strings are already canonical; tolerate small spelling variations. */
export function fromNseIndustry(industry: string): Sector {
  const s = industry.trim()
  if (KNOWN.has(s)) return s as Sector
  return fromIndustryText(s)
}

const YAHOO: Record<string, Sector> = {
  technology: 'Information Technology',
  'financial services': 'Financial Services',
  financial_services: 'Financial Services',
  healthcare: 'Healthcare',
  'consumer cyclical': 'Consumer Discretionary',
  consumer_cyclical: 'Consumer Discretionary',
  'consumer defensive': 'Fast Moving Consumer Goods',
  consumer_defensive: 'Fast Moving Consumer Goods',
  industrials: 'Capital Goods',
  energy: 'Oil Gas & Consumable Fuels',
  'basic materials': 'Metals & Mining',
  basic_materials: 'Metals & Mining',
  'communication services': 'Communication Services',
  communication_services: 'Communication Services',
  utilities: 'Power',
  'real estate': 'Realty',
  realestate: 'Realty'
}

/** Yahoo sector (profile "Technology" or ETF weighting key "consumer_cyclical"). Industry refines a few. */
export function fromYahoo(sector: string | null, industry?: string | null): Sector {
  const ind = (industry ?? '').toLowerCase()
  if (/auto (manufacturers|parts)/.test(ind)) return 'Automobile and Auto Components'
  if (/chemical/.test(ind)) return 'Chemicals'
  if (/telecom/.test(ind)) return 'Telecommunication'
  if (/construction/.test(ind)) return 'Construction'
  return YAHOO[(sector ?? '').trim().toLowerCase()] ?? 'Other'
}

// Ordered: the first matching rule wins.
const TEXT_RULES: [RegExp, Sector][] = [
  [/bank|financ|insurance|capital market|nbfc|housing finance|asset management|broking|fintech/i, 'Financial Services'],
  [
    /\bit\b|it -|software|internet software|computer|information tech|semiconductor|interactive media|it services/i,
    'Information Technology'
  ],
  [/petroleum|refiner|oil|gas|coal|consumable fuel/i, 'Oil Gas & Consumable Fuels'],
  [
    /fmcg|food|beverage|personal product|household|tobacco|cigarette|agricultural food|consumer staple/i,
    'Fast Moving Consumer Goods'
  ],
  [/automobile|auto comp|auto ancil|tyre|two wheeler/i, 'Automobile and Auto Components'],
  [/pharma|biotech|healthcare|hospital|diagnostic|medical/i, 'Healthcare'],
  [
    /aerospace|defen[cs]e|electrical equip|industrial (product|machinery|manufactur)|capital good|engineering|machinery/i,
    'Capital Goods'
  ],
  [/metal|steel|alumin|mining|mineral|ferrous/i, 'Metals & Mining'],
  [/power|electricity/i, 'Power'],
  [/telecom/i, 'Telecommunication'],
  [/cement|construction material/i, 'Construction Materials'],
  [/construction|infrastructure/i, 'Construction'],
  [/consumer durable|appliance/i, 'Consumer Durables'],
  [/retail|leisure|hotel|restaurant|e-commerce|consumer service|travel/i, 'Consumer Services'],
  [/chemical|fertili[sz]er|agrochemical|petrochemical/i, 'Chemicals'],
  [/realty|real estate/i, 'Realty'],
  [/media|entertainment|publishing|broadcast/i, 'Media Entertainment & Publication'],
  [/transport|logistic|shipping|airline|port|commercial service/i, 'Services'],
  [/textile|apparel/i, 'Textiles'],
  [/paper|forest|jute|wood/i, 'Forest Materials'],
  [/utilit|water/i, 'Utilities'],
  [/diversified|conglomerate/i, 'Diversified']
]

/** AMFI industry labels ("Banks", "IT - Software", "Pharmaceuticals & Biotechnology", …) and other free text. */
export function fromIndustryText(text: string | null | undefined): Sector {
  const t = (text ?? '').trim()
  if (!t) return 'Other'
  if (KNOWN.has(t)) return t as Sector
  for (const [re, sector] of TEXT_RULES) if (re.test(t)) return sector
  return 'Other'
}

/** Credit ratings and sovereign tags in the "Industry / Rating" column mean a debt instrument. */
export function looksLikeRating(text: string | null | undefined): boolean {
  return /\b(sovereign|aaa|aa[+-]?|a1\+?|a[+-]?|bbb[+-]?|crisil|icra|care|ind ?ra|fitch|brickwork|acuite|unrated)\b/i.test(
    text ?? ''
  )
}
