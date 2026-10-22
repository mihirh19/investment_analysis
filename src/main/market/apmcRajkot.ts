import type { CropKey } from '@shared/farm'
import { getText, type FetchFn } from './http'

/**
 * Rajkot APMC's own daily rates (apmcrajkot.com/daily_rates): the yard's low and high for the day,
 * in rupees per 20 kg (a man), with groundnut split into jini (fine) and jadi (bold), wheat into
 * lokwan and tukda, chana into white and yellow. Only today's rates are on the page, so the app
 * keeps them day by day. Converted here to rupees per quintal.
 */

const URL = 'https://www.apmcrajkot.com/daily_rates'

/** The yard's Gujarati names for the crops the app knows; YARD is a crop quoted as one. */
const NAMES: { gu: string; crop: CropKey; cls: string }[] = [
  { gu: 'મગફળી જીણી', crop: 'GROUNDNUT', cls: 'Jini' },
  { gu: 'મગફળી જાડી', crop: 'GROUNDNUT', cls: 'Jadi' },
  { gu: 'ઘઉં લોકવન', crop: 'WHEAT', cls: 'Lokwan' },
  { gu: 'ઘઉં ટુકડા', crop: 'WHEAT', cls: 'Tukda' },
  { gu: 'ચણા સફેદ', crop: 'CHANA', cls: 'White' },
  { gu: 'ચણા પીળા', crop: 'CHANA', cls: 'Yellow' },
  { gu: 'કપાસ બી.ટી.', crop: 'COTTON', cls: 'BT' },
  { gu: 'જીરૂ', crop: 'CUMIN', cls: 'YARD' },
  { gu: 'એરંડા', crop: 'CASTOR', cls: 'YARD' },
  { gu: 'તલી', crop: 'SESAME', cls: 'YARD' },
  { gu: 'બાજરી', crop: 'BAJRA', cls: 'YARD' },
  { gu: 'રાયડો', crop: 'MUSTARD', cls: 'YARD' },
  { gu: 'તુવેર', crop: 'TUR', cls: 'YARD' },
  { gu: 'અડદ', crop: 'URAD', cls: 'YARD' },
  { gu: 'મગ', crop: 'MOONG', cls: 'YARD' },
  { gu: 'સોયાબીન', crop: 'SOYBEAN', cls: 'YARD' },
  { gu: 'ધાણા', crop: 'CORIANDER', cls: 'YARD' },
  { gu: 'વરીયાળી', crop: 'FENNEL', cls: 'YARD' },
  { gu: 'લસણ', crop: 'GARLIC', cls: 'YARD' },
  { gu: 'ડુંગળી સુકી', crop: 'ONION', cls: 'YARD' },
  { gu: 'બટેટા', crop: 'POTATO', cls: 'YARD' }
]

export interface YardRate {
  crop: CropKey
  cls: string
  date: string
  /** ₹ a quintal. */
  min: number
  max: number
}

/** The rates on the page: name, low, high (₹ a man) in order, under the date picker's date. */
export function parseRajkotRates(html: string): YardRate[] {
  const dmy = html.match(/id="date"[^>]*value="(\d{2})\/(\d{2})\/(\d{4})"|value="(\d{2})\/(\d{2})\/(\d{4})"[^>]*id="date"/)
  if (!dmy) throw new Error('Rajkot APMC page has no date.')
  const [d, m, y] = dmy[1] ? [dmy[1], dmy[2], dmy[3]] : [dmy[4], dmy[5], dmy[6]]
  const date = `${y}-${m}-${d}`
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const out: YardRate[] = []
  const seen = new Set<string>()
  for (let i = 0; i + 2 < text.length; i++) {
    if (!/^\d+$/.test(text[i + 1]) || !/^\d+$/.test(text[i + 2])) continue
    const n = NAMES.find((x) => x.gu === text[i])
    // The vegetable list further down repeats some names (methi, vatana); the grain list comes first.
    if (!n || seen.has(n.gu)) continue
    seen.add(n.gu)
    const min = Number(text[i + 1]) * 5
    const max = Number(text[i + 2]) * 5
    if (min > 0 && max >= min) out.push({ crop: n.crop, cls: n.cls, date, min, max })
  }
  return out
}

export async function fetchRajkotRates(f?: FetchFn): Promise<YardRate[]> {
  return parseRajkotRates(await getText(URL, { fetch: f, timeoutMs: 30_000 }))
}
