import type { Fuel, PolicyType, VehicleDocRead, VehicleType } from '@shared/vehicles'
import { parseDate, parseNumber } from './parse'

/**
 * Reads the text of an RC (registration certificate, from DigiLocker or mParivahan), a motor
 * insurance policy schedule or a PUC certificate. Every issuer lays these out differently, so this
 * looks for the labels they share ("Date of Registration", "Policy No", "IDV", "Valid Upto") and
 * takes the value beside or below each. The person checks what was read before it is saved.
 */

const STATES =
  'AN|AP|AR|AS|BR|CH|CG|DD|DL|DN|GA|GJ|HR|HP|JK|JH|KA|KL|LA|LD|MP|MH|MN|ML|MZ|NL|OD|OR|PY|PB|RJ|SK|TN|TS|TG|TR|UP|UK|UA|WB'
const REG = new RegExp(`\\b(${STATES})[\\s-]*(\\d{1,2})[\\s-]*([A-Z]{0,3})[\\s-]*(\\d{1,4})\\b`, 'g')
const BH = /\b(\d{2})[\s-]*BH[\s-]*(\d{4})[\s-]*([A-Z]{1,2})\b/g

/** GJ-01-AB-1234, gj 01 ab 1234 → GJ01AB1234; null if it isn't a registration number. */
export function normalizeRegNo(s: string): string | null {
  const t = s.toUpperCase()
  const bh = [...t.matchAll(BH)][0]
  if (bh) return `${bh[1]}BH${bh[2]}${bh[3]}`
  for (const m of t.matchAll(REG)) {
    // A bare "GJ 1" or a number with no digits after the series is not a plate.
    if (m[4].length >= 1 && (m[3] || m[4].length === 4)) return `${m[1]}${m[2].padStart(2, '0')}${m[3]}${m[4].padStart(4, '0')}`
  }
  return null
}

/** GJ01AB1234 → GJ 01 AB 1234 */
export function displayRegNo(r: string): string {
  const bh = r.match(/^(\d{2})BH(\d{4})([A-Z]{1,2})$/)
  if (bh) return `${bh[1]} BH ${bh[2]} ${bh[3]}`
  const m = r.match(/^([A-Z]{2})(\d{2})([A-Z]{0,3})(\d{4})$/)
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : r
}

const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3,9})[-/.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})`
const firstDate = (s: string | null) => {
  if (!s) return null
  const m = s.match(new RegExp(DATE))
  return m ? parseDate(m[1]) : null
}
const firstAmount = (s: string | null) => {
  if (!s) return null
  const m = s.replace(/(Rs\.?|₹|INR)/gi, ' ').match(/(\d[\d,]*(?:\.\d+)?)/)
  const n = m ? parseNumber(m[1]) : null
  return n && n > 0 ? n : null
}

class Lines {
  readonly lines: string[]
  readonly found: string[] = []
  constructor(text: string) {
    this.lines = text
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }
  /** The text after the first label that matches, or the next line if the label stands alone. */
  after(name: string, label: RegExp): string | null {
    for (let i = 0; i < this.lines.length; i++) {
      const m = this.lines[i].match(label)
      if (!m || m.index === undefined) continue
      let rest = this.lines[i].slice(m.index + m[0].length).replace(/^[\s:.\-–=]+/, '')
      if (!rest && i + 1 < this.lines.length) rest = this.lines[i + 1]
      if (!rest) continue
      this.found.push(name)
      return rest
    }
    return null
  }
}

/** Cuts a value short where the next label on the same line begins. */
const untilNextLabel = (s: string | null) =>
  s
    ?.split(/\s{2,}|\s(?=(?:Owner|Maker|Model|Fuel|Colou?r|Chassis|Engine|Vehicle Class|Reg(?:istration|n)?\.?|Date|Seating|Body|Unladen|Insurance|PUCC?|Fitness|Tax|Financier|Address|Father|S\/O|W\/O|D\/O|Son|Wife)\b)/i)[0]
    .replace(/[:\-–\s]+$/, '')
    .trim() || null

/** "2311 2045 6789 0001 000" or "3001/123456789/00/000" → one token without spaces. */
function policyNo(s: string | null | undefined): string | undefined {
  const m = s?.match(/[A-Z0-9][A-Z0-9/-]*(?:\s[0-9][A-Z0-9/-]*)*/i)
  const v = m?.[0].replace(/\s+/g, '')
  return v && v.length >= 6 && /\d/.test(v) ? v : undefined
}

const INSURERS: [RegExp, string][] = [
  [/icici\s*lombard/i, 'ICICI Lombard'],
  [/hdfc\s*ergo/i, 'HDFC ERGO'],
  [/bajaj\s*(allianz|general)/i, 'Bajaj Allianz'],
  [/tata\s*aig/i, 'Tata AIG'],
  [/new\s*india\s*assurance/i, 'New India Assurance'],
  [/united\s*india/i, 'United India'],
  [/oriental\s*insurance/i, 'Oriental Insurance'],
  [/national\s*insurance/i, 'National Insurance'],
  [/reliance\s*general/i, 'Reliance General'],
  [/sbi\s*general/i, 'SBI General'],
  [/go\s*digit|digit\s*general|\bdigit insurance/i, 'Digit'],
  [/acko/i, 'Acko'],
  [/kotak\s*(mahindra\s*)?general/i, 'Kotak General'],
  [/iffco[\s-]*tokio/i, 'IFFCO Tokio'],
  [/royal\s*sundaram/i, 'Royal Sundaram'],
  [/cholamandalam|chola\s*ms/i, 'Chola MS'],
  [/future\s*generali|generali\s*central/i, 'Generali Central'],
  [/liberty\s*(general|videocon)/i, 'Liberty General'],
  [/magma\s*hdi|magma\s*general/i, 'Magma General'],
  [/shriram\s*general/i, 'Shriram General'],
  [/universal\s*sompo/i, 'Universal Sompo'],
  [/zuno|edelweiss\s*general/i, 'Zuno'],
  [/navi\s*general/i, 'Navi General'],
  [/raheja\s*qbe/i, 'Raheja QBE']
]

function fuelOf(s: string | null): Fuel | undefined {
  if (!s) return undefined
  if (/hybrid/i.test(s)) return 'HYBRID'
  if (/electric|\bev\b|battery/i.test(s)) return 'EV'
  if (/cng/i.test(s)) return 'CNG'
  if (/diesel/i.test(s)) return 'DIESEL'
  if (/petrol|gasoline/i.test(s)) return 'PETROL'
  return undefined
}

function typeOf(s: string | null): VehicleType | undefined {
  if (!s) return undefined
  if (/m[\s-]*cycle|motor\s*cycle|scooter|moped|2\s*w|two[\s-]*wheeler|mcwg/i.test(s)) return 'TWO_WHEELER'
  if (/goods|transport|taxi|maxi|bus|truck|lgv|hgv|commercial/i.test(s)) return 'COMMERCIAL'
  if (/motor\s*car|lmv|car|private\s*car|jeep|suv/i.test(s)) return 'CAR'
  return undefined
}

function policyTypeOf(text: string): PolicyType | undefined {
  if (/standalone\s*own\s*damage|own\s*damage\s*only|\bSAOD\b|stand[\s-]*alone\s*od/i.test(text)) return 'OWN_DAMAGE'
  if (/liability\s*only|third\s*party\s*only|act\s*only|\bTP\s*only/i.test(text)) return 'THIRD_PARTY'
  if (/comprehensive|package\s*policy|bundled|private\s*car\s*package|two\s*wheeler\s*package/i.test(text))
    return 'COMPREHENSIVE'
  return undefined
}

function kindOf(text: string): VehicleDocRead['kind'] {
  const score = (res: RegExp[]) => res.filter((r) => r.test(text)).length
  const ins = score([
    /policy\s*(no|number|schedule)/i,
    /insured\s*declared\s*value|\bIDV\b/i,
    /certificate\s*of\s*insurance/i,
    /premium/i,
    /period\s*of\s*insurance|policy\s*period/i
  ])
  const rc = score([
    /registration\s*certificate|form\s*23/i,
    /chassis\s*(no|number)/i,
    /engine\s*(no|number)/i,
    /date\s*of\s*registration|registration\s*date|regn?\.?\s*date/i,
    /owner\s*name/i,
    /vehicle\s*class/i
  ])
  const puc = score([/pollution\s*under\s*control/i, /\bPUCC?\b.*certificate|certificate.*\bPUCC?\b/i, /emission|CO\s*%|HC\s*\(?ppm/i, /date\s*of\s*test|test\s*date/i])
  const best = Math.max(ins, rc, puc)
  if (best < 2) return 'UNKNOWN'
  return best === ins ? 'INSURANCE' : best === rc ? 'RC' : 'PUC'
}

export function readVehicleDocument(pages: string[]): VehicleDocRead {
  const text = pages.join('\n')
  const L = new Lines(text)
  const kind = kindOf(text)
  const out: VehicleDocRead = { kind, meta: {}, found: L.found }
  const regLine = L.after('Registration number', /(registration|regn?\.?|vehicle)\s*(no\.?|number|mark)/i)
  out.regNo = normalizeRegNo(regLine ?? '') ?? normalizeRegNo(text) ?? undefined

  if (kind === 'RC' || kind === 'INSURANCE') {
    const make = untilNextLabel(L.after('Make', /\b(maker'?s?\s*name|manufacturer|make)\b/i))
    const model = untilNextLabel(L.after('Model', /\b(model\s*name|maker\s*model|model)\b/i))
    if (make) {
      // "MARUTI SUZUKI INDIA LTD / SWIFT VXI": the maker and model in one field.
      const [mk, md] = make.split(/\s*\/\s*/)
      out.meta.make = mk.replace(/\b(india\s*)?(pvt\.?\s*)?(ltd\.?|limited)\b/gi, '').trim() || mk
      if (md && !model) out.meta.model = md
    }
    if (model) out.meta.model = model
    out.meta.fuel = fuelOf(L.after('Fuel', /\bfuel(\s*(type|used|norms))?\b/i))
    const cls = L.after('Vehicle class', /(vehicle\s*class|class\s*of\s*vehicle|vehicle\s*type|body\s*type)/i)
    out.meta.type = typeOf(cls) ?? typeOf(text.slice(0, 600))
  }

  if (kind === 'RC') {
    out.meta.ownerName = untilNextLabel(L.after('Owner', /owner'?s?\s*name/i)) ?? undefined
    out.meta.registrationDate =
      firstDate(L.after('Registration date', /(date\s*of\s*registration|registration\s*date|regn?\.?\s*date|reg\.?\s*dt)/i)) ??
      undefined
    out.meta.registrationValidUntil =
      firstDate(
        L.after(
          'Registration valid until',
          /(registration\s*valid(ity)?(\s*up\s*to|\s*upto|\s*till)?|regn?\.?\s*(valid\s*)?up\s*to|fitness\s*(valid\s*)?up\s*to|fitness\s*upto)/i
        )
      ) ?? undefined
    out.meta.colour = untilNextLabel(L.after('Colour', /\bcolou?r\b/i)) ?? undefined
    const insUpto = firstDate(L.after('Insurance valid until', /insurance\s*(valid(ity)?\s*)?(up\s*to|upto|till|validity|expiry)/i))
    if (insUpto) {
      out.policy = { endDate: insUpto }
      const company = untilNextLabel(L.after('Insurer', /insurance\s*company|insurer('?s)?\s*name/i))
      const known = INSURERS.find(([re]) => re.test(company ?? ''))
      if (company) out.policy.insurer = known ? known[1] : company
      const no = policyNo(L.after('Policy number', /policy\s*(no\.?|number)/i))
      if (no) out.policy.policyNumber = no
    }
    const pucUpto = firstDate(L.after('PUC valid until', /pucc?\s*(valid(ity)?\s*)?(up\s*to|upto|till|validity|expiry)/i))
    if (pucUpto) out.puc = { validUntil: pucUpto }
  }

  if (kind === 'INSURANCE') {
    const known = INSURERS.find(([re]) => re.test(text))
    const p: NonNullable<VehicleDocRead['policy']> = {}
    if (known) p.insurer = known[1]
    p.policyNumber = policyNo(L.after('Policy number', /policy\s*(no\.?|number|#)/i))
    // "Period of Insurance: From 12/03/2026 00:00 To Midnight of 11/03/2027"
    const period = L.after('Policy period', /(period\s*of\s*insurance|policy\s*period|insurance\s*period|period\s*of\s*cover)/i)
    const dates = period ? [...period.matchAll(new RegExp(DATE, 'g'))].map((m) => parseDate(m[1])).filter(Boolean) : []
    p.startDate =
      dates[0] ??
      firstDate(L.after('Policy start', /(policy\s*start\s*date|risk\s*start|start\s*date|effective\s*from|valid\s*from|from\s*date)/i)) ??
      undefined
    p.endDate =
      (dates.length > 1 ? dates[1] : null) ??
      firstDate(
        L.after('Policy end', /(policy\s*end\s*date|policy\s*expiry\s*date|expiry\s*date|risk\s*end|end\s*date|valid\s*(up\s*)?to|valid\s*till|to\s*date)/i)
      ) ??
      undefined
    p.idv = firstAmount(L.after('IDV', /(total\s*)?(idv|insured'?s?\s*declared\s*value)(\s*\(.*?\))?/i)) ?? undefined
    p.premium =
      firstAmount(
        L.after('Premium', /(total\s*premium(\s*payable)?|gross\s*premium|premium\s*payable|final\s*premium|total\s*payable|total\s*amount)(\s*\(.*?\))?/i)
      ) ?? undefined
    const ncb = L.after('No-claim bonus', /(no\s*claim\s*bonus|\bNCB\b)(\s*\(%\)|\s*%)?/i)?.match(/(\d{1,2})(?:\.\d+)?\s*%?/)
    if (ncb && Number(ncb[1]) <= 65) p.ncbPct = Number(ncb[1])
    p.type = policyTypeOf(text)
    out.policy = p
    const regDate = firstDate(L.after('Registration date', /(date\s*of\s*registration|registration\s*date|regn?\.?\s*date)/i))
    if (regDate) out.meta.registrationDate = regDate
  }

  if (kind === 'PUC') {
    const valid = firstDate(L.after('Valid until', /(valid(ity)?\s*(up\s*to|upto|till|date)|validity|expiry\s*date|valid\s*upto)/i))
    const date = firstDate(L.after('Test date', /(date\s*of\s*test|test\s*date|date\s*&\s*time|issue\s*date)/i))
    const no = L.after('Certificate number', /(certificate\s*(sl\.?\s*)?(no\.?|number)|puc\s*(sl\.?\s*)?(no\.?|number))/i)?.match(/[A-Z0-9][A-Z0-9/\-]{4,}/i)
    if (valid) out.puc = { validUntil: valid, date: date ?? undefined, certificateNo: no?.[0] }
  }

  for (const k of Object.keys(out.meta) as (keyof typeof out.meta)[]) if (out.meta[k] === undefined) delete out.meta[k]
  if (out.policy) for (const k of Object.keys(out.policy) as (keyof typeof out.policy)[]) if (out.policy[k] === undefined) delete out.policy[k]
  return out
}
