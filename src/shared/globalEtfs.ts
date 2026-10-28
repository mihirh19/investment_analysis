import type { Benchmark } from './fundScreener'

// US and UCITS ETFs in the screener: what kind each is, read from its name, and the index its
// ratios are measured against. The index is quoted in the ETF's own trading currency (an ETF
// tracking it where Yahoo has no such index), so a currency's moves don't pass for the fund's.

export type GlobalMarket = 'US' | 'UCITS'

export interface GlobalProfile {
  /** Equity, Debt or Other (commodities, crypto, leveraged). */
  group: string
  category: string
  leveraged: boolean
  bench: Benchmark | null
}

type BenchKey = 'sp500' | 'nasdaq' | 'small' | 'world' | 'em' | 'europe' | 'uk' | 'japan'

const LABEL: Record<BenchKey, string> = {
  sp500: 'S&P 500',
  nasdaq: 'Nasdaq 100',
  small: 'Russell 2000',
  world: 'MSCI World',
  em: 'MSCI Emerging Markets',
  europe: 'Europe',
  uk: 'FTSE 100',
  japan: 'MSCI Japan'
}

/** Each index by trading currency: Yahoo's index where it has one, else a big ETF that tracks it. */
const BY_CURRENCY: Record<'USD' | 'EUR' | 'GBP' | 'UCITS-USD', Partial<Record<BenchKey, string>>> = {
  USD: { sp500: '^GSPC', nasdaq: '^NDX', small: '^RUT', world: 'URTH', em: 'EEM', europe: 'VGK', uk: 'EWU', japan: 'EWJ' },
  EUR: { sp500: 'SXR8.DE', nasdaq: 'SXRV.DE', world: 'EUNL.DE', em: 'IS3N.DE', europe: 'EXSA.DE' },
  GBP: { sp500: 'VUSA.L', nasdaq: 'EQQQ.L', world: 'SWDA.L', em: 'EMIM.L', europe: 'VEUR.L', uk: 'VUKE.L' },
  // Dollar lines in Europe trade in European hours; a US index's day closes hours later, so its daily
  // moves would not line up. Dollar ETFs on London stand in.
  'UCITS-USD': { sp500: 'CSPX.L', nasdaq: 'CNDX.L', world: 'IWDA.L', em: 'EIMI.L' }
}

/** GBp (pence) and GBX are pounds for this purpose; francs and the rest are compared in dollars. */
export function baseCurrency(currency: string | null | undefined): string {
  const c = (currency ?? 'USD').trim()
  if (c === 'GBp' || c.toUpperCase() === 'GBX') return 'GBP'
  return c.toUpperCase()
}

function benchmark(key: BenchKey, currency: string, market: GlobalMarket): Benchmark {
  const base = baseCurrency(currency)
  const cur = market === 'UCITS' && base !== 'EUR' && base !== 'GBP' ? 'UCITS-USD' : base
  const table = BY_CURRENCY[cur as keyof typeof BY_CURRENCY] ?? BY_CURRENCY.USD
  const symbol = table[key] ?? (cur === 'USD' ? BY_CURRENCY.USD[key]! : table.world!)
  const usedKey = table[key] ? key : cur === 'USD' ? key : 'world'
  const label = LABEL[usedKey]
  return { symbol, label: symbol.startsWith('^') ? label : `${label} (via ${symbol})` }
}

const LEVERAGED = /\b(-?\d(\.\d+)?x|ultra(pro)?\b(?![- ]short)|leveraged|inverse|bear|daily .*(bull|bear|long|short))\b|^proshares (short|ultra)/i
const COMMODITY = /\b(gold|silver|platinum|palladium|copper|commodit\w*|oil|natural gas|metals?|bitcoin|ether(eum)?|crypto|carbon)\b/i
const BOND =
  /\b(bonds?|treasur\w*|t-bills?|gilts?|govt|government|aggregate|corporates?|credit|high yield|muni\w*|tips|fixed income|floating rate|mortgage|loans?|duration|maturity|sovereign|inflation[- ]linked|\d+-\d+ ?(yr|year))\b/i

const SECTORS: [RegExp, string][] = [
  [/semiconductor|technolog|software|internet|cloud|cyber|robot|automation|artificial|\bai\b|fintech|digital|tech\b/i, 'Technology'],
  [/health|biotech|pharma|medical|genomic/i, 'Healthcare'],
  [/financ|bank|insurance/i, 'Financials'],
  [/clean energy|solar|wind|uranium|nuclear|lithium|battery|hydrogen|energy|oil & gas/i, 'Energy'],
  [/real estate|reit|property/i, 'Real estate'],
  [/consumer|retail|staples|discretionary/i, 'Consumer'],
  [/industrial|infrastructure|aerospace|defen[cs]e|transport/i, 'Industrials'],
  [/utilit/i, 'Utilities'],
  [/materials|mining|miners|steel/i, 'Materials'],
  [/communication|media/i, 'Communication']
]

/** The kind of ETF and its index, from its name, market and trading currency. */
export function globalProfile(name: string, market: GlobalMarket, currency: string): GlobalProfile {
  const n = name.replace(/\bucits\b/gi, ' ')
  if (LEVERAGED.test(n)) return { group: 'Other', category: 'Leveraged & inverse', leveraged: true, bench: null }
  if (COMMODITY.test(n) && !/miners|mining|equit|exploration|producers|services|equipment|e&p/i.test(n)) return { group: 'Other', category: 'Commodities & crypto', leveraged: false, bench: null }
  if (/liquidity|money market|overnight|\bcash\b|ultra[- ]?short/i.test(n) && !/\bequit/i.test(n)) return { group: 'Debt', category: 'Money market', leveraged: false, bench: null }
  if (BOND.test(n) && !/\bequit|\bstocks?\b/i.test(n)) {
    const category = /treasur|t-bill|gilt|govt|government|sovereign/i.test(n) ? 'Government bonds' : /corporate|credit|high yield/i.test(n) ? 'Corporate bonds' : 'Bonds'
    return { group: 'Debt', category, leveraged: false, bench: null }
  }
  // Geography first; a sector fund then gets its sector as the category and its region's index.
  let region: { category: string; key: BenchKey }
  if (/emerging|\bem\b|frontier/i.test(n)) region = { category: 'Emerging markets', key: 'em' }
  else if (/china|india|brazil|korea|taiwan|asia|latin|mexico|saudi|indonesia/i.test(n)) region = { category: 'Single country & region', key: 'em' }
  else if (/world|global|all[- ]world|acwi|international|developed|ex[- ]us|eafe|all[- ]country/i.test(n)) region = { category: 'Global', key: 'world' }
  else if (/europe|euro ?stoxx|stoxx|eurozone|emu\b|dax|germany|france|switzerland/i.test(n)) region = { category: 'Europe', key: 'europe' }
  else if (/\buk\b|ftse 100|ftse 250|united kingdom/i.test(n)) region = { category: 'United Kingdom', key: 'uk' }
  else if (/japan|nikkei|topix/i.test(n)) region = { category: 'Japan', key: 'japan' }
  else if (/nasdaq/i.test(n)) region = { category: 'US large cap growth', key: 'nasdaq' }
  else if (/small[- ]?cap|russell 2000|s&p 600|mid[- ]?cap|s&p 400|smallcap|midcap/i.test(n)) region = { category: 'US small & mid cap', key: 'small' }
  else if (/s&p 500|large[- ]?cap|dow jones|russell 1000|total (us |stock )?market|\b500\b/i.test(n)) region = { category: 'US large cap', key: 'sp500' }
  else if (market === 'US' || /\busa?\b|u\.s\.|america|russell/i.test(n)) region = { category: 'US equity', key: 'sp500' }
  else region = { category: 'Global', key: 'world' }

  const sector = SECTORS.find(([re]) => re.test(n))
  if (sector) return { group: 'Equity', category: sector[1], leveraged: false, bench: benchmark(sector[1] === 'Technology' && region.key === 'sp500' ? 'nasdaq' : region.key, currency, market) }
  return { group: 'Equity', category: region.category, leveraged: false, bench: benchmark(region.key, currency, market) }
}

/**
 * Whether a European listing from Yahoo's screener is a UCITS ETF: not one of London's "0ABC.L"
 * lines (US shares traded there) or a US trust, and named like a UCITS share class.
 */
export function isUcitsListing(symbol: string, name: string): boolean {
  if (/^\d/.test(symbol)) return false
  if (/\btrust\b/i.test(name) && !/ucits/i.test(name)) return false
  return /ucits|\bplc\b|\b(acc|dist?|inc)\b|\((acc|dist?|inc)\)/i.test(name)
}

/** The same fund on several exchanges: one line, London first (dollars before pounds), then Xetra, then Amsterdam. */
export function pickListings<T extends { symbol: string; name: string; currency: string }>(rows: T[]): T[] {
  const rank = (r: T) => (r.symbol.endsWith('.L') ? (r.currency === 'USD' ? 0 : 1) : r.symbol.endsWith('.DE') ? 2 : r.symbol.endsWith('.AS') ? 3 : 4)
  const best = new Map<string, T>()
  for (const r of rows) {
    const k = r.name.toLowerCase().replace(/\s+/g, ' ').trim()
    const have = best.get(k)
    if (!have || rank(r) < rank(have)) best.set(k, r)
  }
  return [...best.values()]
}
/** Big issuers first, so the screener measures the ETFs people mostly hold before the long tail. */
export function issuerRank(name: string): number {
  const big = [/^ishares/i, /^vanguard/i, /^spdr|state street/i, /^invesco/i, /^schwab/i, /^xtrackers/i, /^amundi/i, /^jpmorgan/i, /^global x/i, /^wisdomtree/i]
  const i = big.findIndex((re) => re.test(name))
  return i < 0 ? big.length : i
}
