import type { DebtRating, DebtType } from '@shared/types'

/**
 * The two-character security type in a company ISIN (characters 8–9). Older ISINs use digits
 * (01 equity, 07/08 debentures, 14 commercial paper, 16 certificates of deposit, 15 securitised
 * debt); newer ones put a letter first once the digits run out ("A7" a debenture, "D6" a CD), so
 * the second character carries the kind.
 */
export const securityType = (isin: string | null | undefined): string => {
  const id = (isin ?? '').toUpperCase()
  return /^IN[A-Z]/.test(id) && id.length === 12 ? id.slice(7, 9) : ''
}

/**
 * What a debt instrument is, from its ISIN (and name as a backstop). A digit after "IN" is
 * government paper (IN0… central, IN1–IN3… state development loans).
 */
export function debtTypeOf(isin: string | null | undefined, name: string): DebtType {
  const id = (isin ?? '').toUpperCase()
  if (/^IN[0-9]/.test(id)) {
    if (/t[\s-]?bill|treasury bill|\b\d{2,3}\s*d(ays?)?\s*tb\b|\btb\b/i.test(name)) return 'TBILL'
    return id[2] === '0' ? 'GSEC' : 'SDL'
  }
  const code = securityType(id)
  const kind = code[1]
  if (code === '15' || /securiti[sz]ation trust|\bptc\b|pass through/i.test(name)) return 'SECURITISED'
  if (kind === '4' || kind === '6' || /commercial paper|certificate of deposit|\bc\.?p\.?\b|\bc\.?d\.?\b/i.test(name))
    return 'MONEY_MARKET'
  if (kind === '7' || kind === '8' || /\b(ncd|debentures?|bonds?|zcb|perpetual)\b/i.test(name)) return 'CORPORATE'
  if (/government of india|\bgoi\b|g-?sec|gilt/i.test(name)) return 'GSEC'
  if (/\bsdl\b|state development loan/i.test(name)) return 'SDL'
  return 'OTHER'
}

/**
 * Credit rating from the "Industry / Rating" text in a disclosure ("CRISIL AAA", "ICRA A1+",
 * "IND AA+(CE)", "SOVEREIGN"). Government paper is sovereign whatever the column says.
 */
export function ratingOf(raw: string | null | undefined, type: DebtType): DebtRating {
  if (type === 'GSEC' || type === 'SDL' || type === 'TBILL') return 'SOVEREIGN'
  const t = (raw ?? '').toUpperCase()
  if (/SOVEREIGN|\bSOV\b/.test(t)) return 'SOVEREIGN'
  const m = t.match(/(?:^|[\s(/-])(AAA|AA|A1|A2|A3|A4|BBB|BB|A|B|C|D)\s*[+-]?(?=$|[\s()/,-])/)
  if (!m) return 'UNRATED'
  if (m[1] === 'AAA' || m[1] === 'A1') return 'AAA' // A1+ is the top short-term rating
  if (m[1] === 'AA') return 'AA'
  return 'A_BELOW'
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Ltd|Llp|Nabard|Sidbi|Nhb|Ntpc|Rec|Pfc|Hdfc|Icici|Sbi|Lic|Psu|Irfc|Nhai|Ongc|Iifcl)\b/gi, (w) =>
      w.length <= 4 ? w.toUpperCase() : w
    )

/**
 * Who owes the money: "7.18% Government of India 2033" → Government of India; "8.75% Bajaj
 * Finance Ltd NCD 2027" → Bajaj Finance Ltd. Issuers are grouped by ISIN issuer code, so the
 * name only needs to read well.
 */
export function issuerOf(name: string, type: DebtType): string {
  if (type === 'GSEC' || type === 'TBILL') return 'Government of India'
  if (type === 'SDL') {
    // "6.54% Tamilnadu State Development Loans (25/02/2029)" or "SDL TAMIL NADU 2026".
    const state =
      name.match(/(?:^|%)\s*([a-z][a-z ]*?)\s+(?:state development loans?|sdl)\b/i)?.[1] ??
      name.match(/\b(?:sdl|state development loans?)\b[\s-]*([a-z][a-z ]*?)(?:\s+\d|\s*\(|\s*$)/i)?.[1]
    return state ? `${titleCase(state.trim())} (state loans)` : 'State governments'
  }
  const cleaned = name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^\s*[\d.]+\s*%\s*/, '')
    .replace(/\b\d{1,2}[-/ .](?:\d{1,2}|[a-z]{3})[-/ .]\d{2,4}\b/gi, ' ')
    .replace(
      /\b(ncd|debentures?|bonds?|series|tranche|perpetual|zcb|cp|cd|commercial paper|certificate of deposit|sr|option|str(?:pp)?)\b.*$/i,
      ' '
    )
    .replace(/\*+|#/g, ' ')
    .replace(/\s+\d{4}\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? (/[a-z]/.test(cleaned) ? cleaned : titleCase(cleaned)) : name
}

/** The ISIN's issuer part (company code), to group one issuer's many papers together. */
export function issuerKey(isin: string | null | undefined, issuer: string): string {
  const id = (isin ?? '').toUpperCase()
  if (/^IN[A-Z]/.test(id) && id.length === 12) return id.slice(0, 7)
  return issuer.toLowerCase()
}
