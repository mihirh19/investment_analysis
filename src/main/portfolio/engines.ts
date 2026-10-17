import type {
  BondMeta,
  CashEvent,
  CashMeta,
  Compounding,
  CryptoMeta,
  DepositMeta,
  Liquidity,
  ManualMeta,
  MetalMeta,
  OtherMeta,
  PpfMeta,
  PropertyMeta,
  RdMeta,
  SgbMeta
} from '@shared/assets'
import type { PriceSource } from '@shared/types'
import { addMonths, addYears, financialYearOf, maxDate, minDate, yearsBetween } from './dates'
import { estimateEpfBalance } from './epf'
import { sizeBandOf, type SizeBand } from '../market/residex'
import { expensesBetween, rentDues, rentFlows, rentIncome, rentMonths, recordsPayments } from './rent'

/** Live and historical prices the engines need: INR per gram of pure metal, INR per coin. */
export interface PriceBook {
  metal(metal: 'GOLD' | 'SILVER', date?: string): number | null
  crypto(symbol: string, date?: string): number | null
  /**
   * A city's average home price per sq ft (NHB RESIDEX) on a date, between quarters by straight
   * line; null before the series starts. After the latest quarter it stays at that quarter.
   */
  housing?(cityId: number, band: SizeBand, date: string): number | null
  /** First quarter of a city's series. */
  housingStart?(cityId: number, band: SizeBand): string | null
}

export interface Flow {
  date: string
  amount: number
}

/** Valuation and cash-flow model for one hand-maintained asset. */
export interface Engine {
  start: string | null
  valueOn(date: string): number
  current(): { value: number | null; source: PriceSource; prevValue: number | null }
  invested(): number | null
  /** Dated cash flows for XIRR (investor's view, terminal value excluded); empty when unknowable. */
  flows(): Flow[]
  /** Cash events in the period (from, to]. */
  events(from: string, to: string): CashEvent[]
  /** Interest, coupons or rent earned in the period (from, to] (accrued, as for tax). */
  incomeBetween(from: string, to: string): { interest: number; rent: number }
  maturity(): { date: string; value: number } | null
  liquidity(): { bucket: Liquidity; lockedUntil: string | null }
  projection(): { date: string; value: number }[]
}

const PER_YEAR = { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, YEARLY: 1 } as const

function growth(principal: number, ratePct: number, compounding: Compounding, years: number): number {
  if (years <= 0) return principal
  const r = ratePct / 100
  if (compounding === 'SIMPLE') return principal * (1 + r * years)
  const n = PER_YEAR[compounding]
  return principal * (1 + r / n) ** (n * years)
}

/** Dates every `everyMonths` from `start` (exclusive) up to `end` (inclusive). */
function schedule(start: string, end: string, everyMonths: number): string[] {
  const out: string[] = []
  for (let k = 1; ; k++) {
    const d = addMonths(start, k * everyMonths)
    if (d > end) break
    out.push(d)
  }
  return out
}

const within = (d: string, from: string, to: string) => d > from && d <= to
const sumEvents = (events: CashEvent[], kinds: CashEvent['kind'][]) =>
  events.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amount, 0)

/** Points from `from` to `to`, yearly plus the end date, for a growth chart. */
function yearlyPoints(from: string, to: string, valueOn: (d: string) => number) {
  const pts: { date: string; value: number }[] = []
  for (let d = from; d < to; d = addYears(d, 1)) pts.push({ date: d, value: valueOn(d) })
  pts.push({ date: to, value: valueOn(to) })
  return pts
}

/** Latest entry on or before `date`. */
function entryOn(entries: { date: string; value: number }[], date: string) {
  let found: { date: string; value: number } | null = null
  for (const e of entries) if (e.date <= date && (!found || e.date >= found.date)) found = e
  return found
}

// ---------------- deposits: FD, NSC, KVP, Post office TD/MIS, SCSS, RBI bonds ----------------

function deposit(m: DepositMeta, today: string): Engine {
  const isCumulative = m.payout === 'CUMULATIVE'
  const p = m.payout === 'CUMULATIVE' ? 0 : PER_YEAR[m.payout]
  const payoutAmount = (() => {
    if (isCumulative) return 0
    if (m.compounding === 'SIMPLE' || PER_YEAR[m.compounding] < p) return (m.principal * m.rate) / 100 / p
    const n = PER_YEAR[m.compounding]
    return m.principal * ((1 + m.rate / 100 / n) ** (n / p) - 1)
  })()
  const payoutDates = isCumulative ? [] : schedule(m.startDate, m.maturityDate, 12 / p)

  const valueOn = (date: string) => {
    if (date < m.startDate) return 0
    if (!isCumulative) return m.principal
    return growth(m.principal, m.rate, m.compounding, yearsBetween(m.startDate, minDate(date, m.maturityDate)))
  }
  const maturityValue = isCumulative ? valueOn(m.maturityDate) : m.principal

  const events = (from: string, to: string): CashEvent[] => {
    const out: CashEvent[] = payoutDates
      .filter((d) => within(d, from, to))
      .map((d) => ({ date: d, label: 'Interest payout', amount: payoutAmount, kind: 'INTEREST' }))
    if (within(m.maturityDate, from, to))
      out.push({ date: m.maturityDate, label: 'Matures', amount: maturityValue, kind: 'MATURITY' })
    return out
  }

  const liquidity = (): { bucket: Liquidity; lockedUntil: string | null } => {
    if (today >= m.maturityDate) return { bucket: 'LIQUID', lockedUntil: null }
    switch (m.subtype) {
      case 'NSC':
      case 'RBI_BOND':
        return { bucket: 'LOCKED', lockedUntil: m.maturityDate }
      case 'KVP': {
        const lock = addMonths(m.startDate, 30)
        return today < lock ? { bucket: 'LOCKED', lockedUntil: lock } : { bucket: 'BREAKABLE', lockedUntil: null }
      }
      default:
        return { bucket: 'BREAKABLE', lockedUntil: null }
    }
  }

  return {
    start: m.startDate,
    valueOn,
    current: () => ({ value: valueOn(today), source: 'ESTIMATE', prevValue: null }),
    invested: () => m.principal,
    flows: () => [
      { date: m.startDate, amount: -m.principal },
      ...events(m.startDate, today)
        .filter((e) => e.kind === 'INTEREST')
        .map((e) => ({ date: e.date, amount: e.amount })),
      ...(today >= m.maturityDate ? [{ date: m.maturityDate, amount: maturityValue }] : [])
    ],
    events,
    incomeBetween: (from, to) => {
      if (!isCumulative) return { interest: sumEvents(events(from, to), ['INTEREST']), rent: 0 }
      const a = maxDate(from, m.startDate)
      const b = minDate(to, m.maturityDate)
      return { interest: b > a ? valueOn(b) - valueOn(a) : 0, rent: 0 }
    },
    maturity: () => ({ date: m.maturityDate, value: maturityValue }),
    liquidity,
    projection: () => yearlyPoints(m.startDate, m.maturityDate, valueOn)
  }
}

// ---------------- recurring deposit ----------------

function rd(m: RdMeta, today: string): Engine {
  const maturityDate = addMonths(m.startDate, m.months)
  const instalments = Array.from({ length: m.months }, (_, k) => addMonths(m.startDate, k))
  const valueOn = (date: string) => {
    const end = minDate(date, maturityDate)
    // Banks compound RDs quarterly.
    return instalments
      .filter((d) => d <= end)
      .reduce((s, d) => s + growth(m.installment, m.rate, 'QUARTERLY', yearsBetween(d, end)), 0)
  }
  const paidBy = (date: string) => instalments.filter((d) => d <= date).length * m.installment
  const events = (from: string, to: string): CashEvent[] => [
    ...instalments
      .filter((d) => within(d, from, to))
      .map((d) => ({ date: d, label: 'Instalment', amount: -m.installment, kind: 'INSTALMENT' as const })),
    ...(within(maturityDate, from, to)
      ? [{ date: maturityDate, label: 'Matures', amount: valueOn(maturityDate), kind: 'MATURITY' as const }]
      : [])
  ]
  return {
    start: m.startDate,
    valueOn,
    current: () => ({ value: valueOn(today), source: 'ESTIMATE', prevValue: null }),
    invested: () => paidBy(today),
    flows: () => [
      ...instalments.filter((d) => d <= today).map((d) => ({ date: d, amount: -m.installment })),
      ...(today >= maturityDate ? [{ date: maturityDate, amount: valueOn(maturityDate) }] : [])
    ],
    events,
    incomeBetween: (from, to) => {
      const a = maxDate(from, m.startDate)
      const b = minDate(to, maturityDate)
      if (b <= a) return { interest: 0, rent: 0 }
      return { interest: valueOn(b) - valueOn(a) - (paidBy(b) - paidBy(a)), rent: 0 }
    },
    maturity: () => ({ date: maturityDate, value: valueOn(maturityDate) }),
    liquidity: () =>
      today >= maturityDate ? { bucket: 'LIQUID', lockedUntil: null } : { bucket: 'BREAKABLE', lockedUntil: null },
    projection: () => yearlyPoints(m.startDate, maturityDate, valueOn)
  }
}

// ---------------- PPF and Sukanya Samriddhi ----------------

/** PPF matures 15 full financial years after the FY of opening; SSY 21 years from opening. */
export function ppfMaturity(m: Pick<PpfMeta, 'scheme' | 'openDate'>): string {
  if (m.scheme === 'SSY') return addYears(m.openDate, 21)
  const fy = financialYearOf(m.openDate)
  return `${Number(fy.end.slice(0, 4)) + 15}-04-01`
}

function ppf(m: PpfMeta, entries: { date: string; value: number }[], today: string): Engine {
  const maturityDate = ppfMaturity(m)
  // SSY deposits stop after 15 years; both schemes keep earning interest until maturity.
  const contributionEnd = m.scheme === 'SSY' ? addYears(m.openDate, 15) : maturityDate
  const valueOn = (date: string) => {
    if (date < m.openDate) return 0
    const end = minDate(date, maturityDate)
    const base = entryOn(entries, end) ?? { date: m.openDate, value: 0 }
    const monthly = end <= contributionEnd ? m.yearlyContribution / 12 : 0
    return estimateEpfBalance(base.value, base.date, end, { monthlyContribution: monthly, interestRate: m.rate })
  }
  return {
    start: m.openDate,
    valueOn,
    current: () => ({ value: valueOn(today), source: 'ESTIMATE', prevValue: null }),
    invested: () => null,
    flows: () => [],
    events: (from, to) =>
      within(maturityDate, from, to)
        ? [{ date: maturityDate, label: 'Matures', amount: valueOn(maturityDate), kind: 'MATURITY' }]
        : [],
    incomeBetween: (from, to) => {
      const a = maxDate(from, m.openDate)
      const b = minDate(to, maturityDate)
      if (b <= a) return { interest: 0, rent: 0 }
      const contributed = a < contributionEnd ? m.yearlyContribution * yearsBetween(a, minDate(b, contributionEnd)) : 0
      return { interest: Math.max(0, valueOn(b) - valueOn(a) - contributed), rent: 0 }
    },
    maturity: () => ({ date: maturityDate, value: valueOn(maturityDate) }),
    liquidity: () =>
      today >= maturityDate ? { bucket: 'LIQUID', lockedUntil: null } : { bucket: 'LOCKED', lockedUntil: maturityDate },
    projection: () => yearlyPoints(maxDate(m.openDate, entries[0]?.date ?? m.openDate), maturityDate, valueOn)
  }
}

// ---------------- bonds: NCDs, G-secs, 54EC, zero-coupon ----------------

function bond(m: BondMeta, today: string): Engine {
  const zero = m.couponFrequency === 'ZERO'
  const p = m.couponFrequency === 'ZERO' ? 0 : PER_YEAR[m.couponFrequency]
  const coupon = zero ? 0 : (m.units * m.faceValue * m.couponRate) / 100 / p
  // Coupon dates run backwards from maturity in whole periods.
  const couponDates: string[] = []
  if (!zero)
    for (let k = 0; ; k++) {
      const d = addMonths(m.maturityDate, -k * (12 / p))
      if (d <= m.purchaseDate) break
      couponDates.unshift(d)
    }
  const redemption = m.units * m.faceValue

  const cleanPrice = (date: string) => {
    if (m.marketPrice && date >= today) return m.marketPrice
    if (zero) {
      const total = yearsBetween(m.purchaseDate, m.maturityDate)
      const done = Math.min(total, Math.max(0, yearsBetween(m.purchaseDate, date)))
      return total > 0 ? m.purchasePrice * (m.faceValue / m.purchasePrice) ** (done / total) : m.faceValue
    }
    return m.marketPrice ?? m.faceValue
  }
  const accrued = (date: string) => {
    if (zero) return 0
    const prev = [m.purchaseDate, ...couponDates].filter((d) => d <= date).pop() ?? m.purchaseDate
    return (m.units * m.faceValue * m.couponRate * yearsBetween(prev, date)) / 100
  }
  const valueOn = (date: string) => {
    if (date < m.purchaseDate) return 0
    if (date >= m.maturityDate) return redemption
    return m.units * cleanPrice(date) + accrued(date)
  }
  const events = (from: string, to: string): CashEvent[] => [
    ...couponDates
      .filter((d) => within(d, from, to))
      .map((d) => ({ date: d, label: 'Coupon', amount: coupon, kind: 'COUPON' as const })),
    ...(within(m.maturityDate, from, to)
      ? [{ date: m.maturityDate, label: 'Redeems', amount: redemption, kind: 'MATURITY' as const }]
      : [])
  ]
  return {
    start: m.purchaseDate,
    valueOn,
    current: () => ({ value: valueOn(today), source: m.marketPrice ? 'MANUAL' : 'ESTIMATE', prevValue: null }),
    invested: () => m.units * m.purchasePrice,
    flows: () => [
      { date: m.purchaseDate, amount: -m.units * m.purchasePrice },
      ...events(m.purchaseDate, today).map((e) => ({ date: e.date, amount: e.amount }))
    ],
    events,
    incomeBetween: (from, to) => {
      if (!zero) return { interest: sumEvents(events(from, to), ['COUPON']), rent: 0 }
      const a = maxDate(from, m.purchaseDate)
      const b = minDate(to, m.maturityDate)
      return { interest: b > a ? m.units * (cleanPrice(b) - cleanPrice(a)) : 0, rent: 0 }
    },
    maturity: () => ({ date: m.maturityDate, value: redemption + (zero ? 0 : coupon) }),
    liquidity: () =>
      today >= m.maturityDate ? { bucket: 'LIQUID', lockedUntil: null } : { bucket: 'BREAKABLE', lockedUntil: null },
    projection: () => yearlyPoints(m.purchaseDate, m.maturityDate, valueOn)
  }
}

// ---------------- Sovereign Gold Bonds ----------------

export const SGB_INTEREST = 2.5

function sgb(m: SgbMeta, book: PriceBook, today: string): Engine {
  const bought = m.purchaseDate ?? m.issueDate
  const maturityDate = addYears(m.issueDate, 8)
  const interest = (m.grams * m.issuePrice * SGB_INTEREST) / 100 / 2
  const interestDates = schedule(m.issueDate, maturityDate, 6).filter((d) => d > bought)
  const goldValue = (date?: string) => {
    const g = book.metal('GOLD', date)
    return g === null ? null : m.grams * g
  }
  const valueOn = (date: string) =>
    date < bought ? 0 : (goldValue(minDate(date, maturityDate)) ?? m.grams * m.issuePrice)
  const events = (from: string, to: string): CashEvent[] => [
    ...interestDates
      .filter((d) => within(d, from, to))
      .map((d) => ({ date: d, label: 'SGB interest (2.5%)', amount: interest, kind: 'INTEREST' as const })),
    ...(within(maturityDate, from, to)
      ? [
          {
            date: maturityDate,
            label: 'Redeems at gold price',
            amount: goldValue() ?? m.grams * m.issuePrice,
            kind: 'MATURITY' as const
          }
        ]
      : [])
  ]
  const live = goldValue()
  return {
    start: bought,
    valueOn,
    current: () => ({
      value: live ?? m.grams * m.issuePrice,
      source: live === null ? 'STATEMENT' : 'LIVE',
      prevValue: null
    }),
    invested: () => m.grams * (m.purchasePrice ?? m.issuePrice),
    flows: () => [
      { date: bought, amount: -m.grams * (m.purchasePrice ?? m.issuePrice) },
      ...events(bought, today)
        .filter((e) => e.kind === 'INTEREST')
        .map((e) => ({ date: e.date, amount: e.amount }))
    ],
    events,
    incomeBetween: (from, to) => ({ interest: sumEvents(events(from, to), ['INTEREST']), rent: 0 }),
    maturity: () => ({ date: maturityDate, value: live ?? m.grams * m.issuePrice }),
    // Tradable on NSE any time; RBI buys back only from year five.
    liquidity: () => ({
      bucket: 'BREAKABLE',
      lockedUntil: today < addYears(m.issueDate, 5) ? addYears(m.issueDate, 5) : null
    }),
    projection: () => []
  }
}

// ---------------- gold & silver, crypto ----------------

function metal(m: MetalMeta, book: PriceBook): Engine {
  const valueAt = (date?: string) => {
    const per = book.metal(m.metal, date)
    return per === null ? null : m.grams * m.purity * per
  }
  return marketLike(m.purchaseDate, m.cost, valueAt, m.form === 'DIGITAL' ? 'LIQUID' : 'BREAKABLE')
}

function crypto(m: CryptoMeta, book: PriceBook): Engine {
  const valueAt = (date?: string) => {
    const p = book.crypto(m.symbol, date)
    return p === null ? null : m.quantity * p
  }
  return marketLike(m.purchaseDate, m.cost, valueAt, 'LIQUID')
}

function marketLike(start: string, cost: number, valueAt: (date?: string) => number | null, bucket: Liquidity): Engine {
  const live = valueAt()
  return {
    start,
    valueOn: (date) => (date < start ? 0 : (valueAt(date) ?? 0)),
    current: () => ({ value: live, source: live === null ? 'STATEMENT' : 'LIVE', prevValue: null }),
    invested: () => cost,
    flows: () => (cost > 0 ? [{ date: start, amount: -cost }] : []),
    events: () => [],
    incomeBetween: () => ({ interest: 0, rent: 0 }),
    maturity: () => null,
    liquidity: () => ({ bucket, lockedUntil: null }),
    projection: () => []
  }
}

// ---------------- property, cash, other (valued from entries) ----------------

/** How a property is valued: the city's price index, its area at the city average, or your estimates. */
export function propertyMode(m: PropertyMeta): 'INDEX' | 'AREA' | 'MANUAL' {
  if (m.valuation) return m.valuation
  return m.cityId ? 'INDEX' : 'MANUAL'
}

function property(m: PropertyMeta, entries: { date: string; value: number }[], today: string, book: PriceBook): Engine {
  const band = sizeBandOf(m.carpetAreaSqft)
  const city = m.cityId
  // The home's size band if the city reports it, else the city as a whole.
  const px = (date: string) =>
    city && book.housing ? (book.housing(city, band, date) ?? (band !== 'ALL' ? book.housing(city, 'ALL', date) : null)) : null
  const seriesStart = () =>
    city && book.housingStart ? (book.housingStart(city, band) ?? book.housingStart(city, 'ALL')) : null
  const mode = propertyMode(m)
  const grow = (value: number, from: string, to: string) =>
    m.appreciation && to > from ? value * (1 + m.appreciation / 100) ** yearsBetween(from, to) : value

  const valueOn = (date: string) => {
    if (date < m.purchaseDate) return 0
    const priceNow = px(date)
    if (mode === 'AREA' && m.carpetAreaSqft && priceNow) return m.carpetAreaSqft * priceNow * (1 + (m.premiumPct ?? 0) / 100)
    const base = entryOn(entries, date) ?? { date: m.purchaseDate, value: m.purchasePrice }
    if (mode !== 'MANUAL' && priceNow) {
      const priceThen = px(base.date)
      if (priceThen) return (base.value * priceNow) / priceThen
      // Bought before the city series starts: your growth rate (if any) up to its first quarter.
      const first = seriesStart()
      const priceFirst = first ? px(first) : null
      if (first && priceFirst) return (grow(base.value, base.date, first) * priceNow) / priceFirst
    }
    return grow(base.value, base.date, date)
  }
  const latestEntry = entryOn(entries, today)
  const indexed = mode !== 'MANUAL' && px(today) !== null
  const expected = (from: string, to: string) => rentDues(m, from, to).filter((d) => d.dueDate > from)
  return {
    start: m.purchaseDate,
    valueOn,
    current: () => ({
      value: valueOn(today),
      source: indexed || m.appreciation ? 'ESTIMATE' : latestEntry ? 'MANUAL' : 'STATEMENT',
      prevValue: null
    }),
    invested: () => m.purchasePrice + (m.buyingCosts ?? 0),
    flows: () => [
      { date: m.purchaseDate, amount: -(m.purchasePrice + (m.buyingCosts ?? 0)) },
      ...rentFlows(m, today),
      ...(m.expenses ?? []).filter((e) => e.date <= today).map((e) => ({ date: e.date, amount: -e.amount }))
    ],
    // Rent still to come: the months not yet paid.
    events: (from, until) => {
      // Open-ended tenancies would run forever: look a year ahead at most.
      const to = until < addYears(today, 1) ? until : addYears(today, 1)
      const unpaid = recordsPayments(m)
        ? new Set(rentMonths(m, from, to, today).filter((x) => x.status !== 'PAID').map((x) => `${x.tenancyId}|${x.month}`))
        : null
      return expected(from, to)
        .filter((d) => !unpaid || unpaid.has(`${d.tenancyId}|${d.month}`))
        .map((d) => ({ date: d.dueDate, label: d.tenant ? `Rent from ${d.tenant}` : 'Rent', amount: d.amount, kind: 'RENT' as const }))
    },
    // Rent counts as it arrives: up to today, never the rest of the period.
    incomeBetween: (from, to) => ({ interest: 0, rent: rentIncome(m, from, to < today ? to : today) }),
    maturity: () => null,
    liquidity: () => ({ bucket: 'ILLIQUID', lockedUntil: null }),
    projection: () => (m.appreciation ? yearlyPoints(today, addYears(today, 10), valueOn) : [])
  }
}

/** Expenses of a property in (from, to], for reports. */
export const propertyExpenses = expensesBetween

function cash(m: CashMeta, entries: { date: string; value: number }[], today: string): Engine {
  const valueOn = (date: string) => entryOn(entries, date)?.value ?? 0
  return {
    start: entries[0]?.date ?? null,
    valueOn,
    current: () => ({ value: entries.length ? valueOn(today) : null, source: 'MANUAL', prevValue: null }),
    invested: () => null,
    flows: () => [],
    events: () => [],
    incomeBetween: (from, to) => {
      if (!m.rate) return { interest: 0, rent: 0 }
      const a = maxDate(from, entries[0]?.date ?? to)
      const b = minDate(to, today)
      return { interest: b > a ? (valueOn(b) * m.rate * yearsBetween(a, b)) / 100 : 0, rent: 0 }
    },
    maturity: () => null,
    liquidity: () => ({ bucket: 'LIQUID', lockedUntil: null }),
    projection: () => []
  }
}

function other(m: OtherMeta, entries: { date: string; value: number }[], today: string): Engine {
  const start = m.purchaseDate ?? entries[0]?.date ?? null
  const valueOn = (date: string) => entryOn(entries, date)?.value ?? (start && date >= start && m.cost ? m.cost : 0)
  return {
    start,
    valueOn,
    current: () => ({ value: entries.length || m.cost ? valueOn(today) : null, source: 'MANUAL', prevValue: null }),
    invested: () => m.cost ?? null,
    flows: () => (m.cost && m.purchaseDate ? [{ date: m.purchaseDate, amount: -m.cost }] : []),
    events: () => [],
    incomeBetween: () => ({ interest: 0, rent: 0 }),
    maturity: () => null,
    liquidity: () => ({ bucket: 'ILLIQUID', lockedUntil: null }),
    projection: () => []
  }
}

export function engineFor(
  meta: ManualMeta,
  entries: { date: string; value: number }[],
  book: PriceBook,
  today: string
): Engine {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  switch (meta.kind) {
    case 'DEPOSIT':
      return deposit(meta, today)
    case 'RD':
      return rd(meta, today)
    case 'PPF':
      return ppf(meta, sorted, today)
    case 'BOND':
      return bond(meta, today)
    case 'SGB':
      return sgb(meta, book, today)
    case 'METAL':
      return metal(meta, book)
    case 'CRYPTO':
      return crypto(meta, book)
    case 'PROPERTY':
      return property(meta, sorted, today, book)
    case 'CASH':
      return cash(meta, sorted, today)
    case 'OTHER':
      return other(meta, sorted, today)
  }
}
