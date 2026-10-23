import { and, asc, desc, eq, gte, inArray, like } from 'drizzle-orm'
import {
  CROPS,
  findVariety,
  PRICE_CLASSES,
  type CropKey,
  type CropPrice,
  type FarmCostKind,
  type FarmEntry,
  type FarmEntryInput,
  type FarmReport,
  type FarmSeasonInput,
  type FarmSeasonView,
  type FarmStock,
  type HoldingCosts,
  type MarketNote,
  type SeasonalPattern,
  type CropOutlook
} from '@shared/farm'
import type { HoldingRow } from '@shared/types'
import { schema, type Db } from './db'
import { MSP } from './market/msp'

/**
 * The family farm. Each season of a crop collects its costs, harvests, sales and losses; what was
 * harvested and not yet sold or lost is in the godown and counts in net worth at today's mandi
 * price. A crop still in the field is shown at its expected yield but not counted: weather and yield
 * can change it a lot before harvest.
 */

const DEFAULT_MARKET_KEY = 'farm:market'
const TARGETS_KEY = 'farm:targets'
export const DEFAULT_MARKET = 'Rajkot'
/** Mandi prices live in price_history under this key: one row per day, the modal price. */
export const mandiKey = (crop: CropKey, market: string) => `MANDI:${crop}:${market.trim().toUpperCase()}`
/** A yard class's daily price (Rajkot APMC: middle of the day's low and high), e.g. groundnut Jini. */
export const classKey = (crop: CropKey, market: string, cls: string) => `MANDIC:${crop}:${market.trim().toUpperCase()}:${cls.trim().toUpperCase()}`
/** One variety's daily modal price at a mandi (Agmarknet reports G20 and Bold groundnut separately). */
export const varietyKey = (crop: CropKey, market: string, variety: string) =>
  `MANDIV:${crop}:${market.trim().toUpperCase()}:${variety.trim().toUpperCase()}`
/** Monthly average prices (dated the 15th), for the trend and "a year ago" before daily prices build up. */
export const monthlyKey = (crop: CropKey, market: string) => `MANDIM:${crop}:${market.trim().toUpperCase()}`

const todayIso = () => new Date().toISOString().slice(0, 10)
const round2 = (v: number) => Math.round(v * 100) / 100

function getSetting(db: Db, key: string): string | null {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}
function setSetting(db: Db, key: string, value: string): void {
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}

export const defaultMarket = (db: Db) => getSetting(db, DEFAULT_MARKET_KEY) ?? DEFAULT_MARKET
export function setDefaultMarket(db: Db, market: string): void {
  const m = market.trim()
  if (!m) throw new Error('Enter a mandi name, e.g. Rajkot.')
  setSetting(db, DEFAULT_MARKET_KEY, m)
}

/** Price targets per crop, ₹/quintal: "tell me when groundnut reaches ₹7,500". */
export const priceTargets = (db: Db): Partial<Record<CropKey, number>> => JSON.parse(getSetting(db, TARGETS_KEY) ?? '{}')
export function setPriceTarget(db: Db, crop: CropKey, price: number | null): void {
  if (!(crop in CROPS)) throw new Error('Unknown crop.')
  const t = priceTargets(db)
  if (price === null || !(price > 0)) delete t[crop]
  else t[crop] = Math.round(price)
  setSetting(db, TARGETS_KEY, JSON.stringify(t))
}

const ALERTED_KEY = 'farm:alerted'

/**
 * Crops whose price reached the family's target since they were last told, so the app can say so
 * once (not on every refresh). A crop is told again only after its price drops below and returns.
 */
export function newlyReachedTargets(db: Db): { crop: CropKey; price: number; target: number; market: string }[] {
  const targets = priceTargets(db)
  const alerted: Partial<Record<CropKey, boolean>> = JSON.parse(getSetting(db, ALERTED_KEY) ?? '{}')
  const market = defaultMarket(db)
  const out: { crop: CropKey; price: number; target: number; market: string }[] = []
  for (const crop of Object.keys(targets) as CropKey[]) {
    const p = priceFor(db, crop, market)
    const reached = !!p && p.price >= targets[crop]!
    if (reached && !alerted[crop]) out.push({ crop, price: p!.price, target: targets[crop]!, market: p!.market })
    alerted[crop] = reached
  }
  setSetting(db, ALERTED_KEY, JSON.stringify(alerted))
  return out
}

// ---------------- the outlook: past patterns, mandis, arrivals, holding ----------------

const STATE_KEY = 'farm:statePrices'
const HOLDING_KEY = 'farm:holding'
const TRANSPORT_KEY = 'farm:transport'
const NOTES_KEY = 'farm:notes'

/** A day's prices across a state's mandis: weighted modal price (₹/qtl) and arrivals (tonnes). */
export interface StatePrices {
  date: string
  markets: { id: number; name: string; district: string; modal: number; arrivalsT: number | null }[]
}
/** Arrivals at a mandi, tonnes a day, kept like a price series. */
export const arrivalKey = (crop: CropKey, market: string) => `ARRIVAL:${crop}:${market.trim().toUpperCase()}`

export const storedStatePrices = (db: Db, crop: CropKey): StatePrices | null =>
  (JSON.parse(getSetting(db, STATE_KEY) ?? '{}') as Record<string, StatePrices>)[crop] ?? null
export function saveStatePrices(db: Db, crop: CropKey, st: StatePrices): void {
  const all = JSON.parse(getSetting(db, STATE_KEY) ?? '{}') as Record<string, StatePrices>
  all[crop] = st
  setSetting(db, STATE_KEY, JSON.stringify(all))
}

export const DEFAULT_HOLDING: HoldingCosts = { storagePerQtlMonth: 0, lossPctPerMonth: 0.5, interestPct: 7 }
export const holdingCosts = (db: Db): HoldingCosts => ({ ...DEFAULT_HOLDING, ...JSON.parse(getSetting(db, HOLDING_KEY) ?? '{}') })
export function setHoldingCosts(db: Db, c: HoldingCosts): void {
  if (![c.storagePerQtlMonth, c.lossPctPerMonth, c.interestPct].every((v) => Number.isFinite(v) && v >= 0)) throw new Error('Costs can’t be negative.')
  if (c.lossPctPerMonth > 20 || c.interestPct > 60) throw new Error('That looks too high: weight loss is a few % a month at most, interest under 60% a year.')
  setSetting(db, HOLDING_KEY, JSON.stringify(c))
}

export const transportCosts = (db: Db): Record<string, number> => JSON.parse(getSetting(db, TRANSPORT_KEY) ?? '{}')
export function setTransportCost(db: Db, market: string, perQtl: number | null): void {
  const t = transportCosts(db)
  const k = market.trim()
  if (!k) throw new Error('Which mandi?')
  if (perQtl === null || !(perQtl >= 0)) delete t[k]
  else t[k] = Math.round(perQtl)
  setSetting(db, TRANSPORT_KEY, JSON.stringify(t))
}

export const marketNotes = (db: Db): Partial<Record<CropKey, MarketNote>> => JSON.parse(getSetting(db, NOTES_KEY) ?? '{}')
export function saveMarketNote(db: Db, note: MarketNote): void {
  const all = marketNotes(db)
  all[note.crop] = note
  setSetting(db, NOTES_KEY, JSON.stringify(all))
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const normMarket = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bapmc\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * How the price moved from this month in past years: for each year with both months reported,
 * the change from this month's average to the one 1, 3 and 6 months on.
 */
export function seasonalPattern(db: Db, crop: CropKey, market: string, today = todayIso()): SeasonalPattern | null {
  const pts = new Map(
    db
      .select({ date: schema.priceHistory.date, price: schema.priceHistory.close })
      .from(schema.priceHistory)
      .where(eq(schema.priceHistory.key, monthlyKey(crop, market)))
      .all()
      .map((p) => [p.date.slice(0, 7), p.price])
  )
  const y0 = Number(today.slice(0, 4))
  const m0 = Number(today.slice(5, 7))
  const at = (y: number, m: number) => pts.get(`${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12) + 1).padStart(2, '0')}`)
  const horizons = [1, 3, 6].map((k) => {
    const changes: { year: number; pct: number }[] = []
    // Past years only: the move from this month a year (or more) ago, already over.
    for (let y = y0 - 1; y >= y0 - 8; y--) {
      const a = at(y, m0)
      const b = at(y, m0 + k)
      if (a && b) changes.push({ year: y, pct: Math.round((b / a - 1) * 1000) / 10 })
    }
    const pcts = changes.map((c) => c.pct)
    const mid = median(pcts)
    return { months: k, changes, median: mid === null ? null : Math.round(mid * 10) / 10, min: pcts.length ? Math.min(...pcts) : null, max: pcts.length ? Math.max(...pcts) : null }
  })
  if (horizons.every((h) => !h.changes.length)) return null
  return { fromMonth: MONTH_NAMES[m0 - 1], horizons }
}

/** Selling today against waiting k months, at past years' worst, typical and best moves, after holding costs. */
export function holdFigures(qtl: number, price: number, pattern: SeasonalPattern | null, c: HoldingCosts): NonNullable<CropOutlook['hold']> {
  const sellNow = Math.round(qtl * price)
  return {
    qtl,
    sellNow,
    horizons: [1, 3, 6].map((k) => {
      const h = pattern?.horizons.find((x) => x.months === k)
      const left = qtl * Math.max(0, 1 - (c.lossPctPerMonth / 100) * k)
      const cost = Math.round(c.storagePerQtlMonth * qtl * k + (sellNow * c.interestPct * k) / 1200)
      // Against selling now: what is left (after drying) at the moved price, less storage and interest.
      const gain = (pct: number | null | undefined) => (pct == null ? null : Math.round(left * price * (1 + pct / 100) - cost - sellNow))
      return { months: k, cost, low: gain(h?.min), typical: gain(h?.median), high: gain(h?.max) }
    })
  }
}

function outlookFor(db: Db, crop: CropKey, market: string, stockQtl: number, today: string): CropOutlook {
  const price = priceFor(db, crop, market)?.price ?? null
  const pattern = seasonalPattern(db, crop, market, today)
  const st = storedStatePrices(db, crop)
  const transport = transportCosts(db)
  const tFor = (name: string) => {
    const k = Object.keys(transport).find((t) => normMarket(t) === normMarket(name))
    return k !== undefined ? transport[k] : null
  }
  const arrivals = db
    .select({ date: schema.priceHistory.date, t: schema.priceHistory.close })
    .from(schema.priceHistory)
    .where(and(eq(schema.priceHistory.key, arrivalKey(crop, market)), gte(schema.priceHistory.date, daysBefore(today, 30))))
    .orderBy(asc(schema.priceHistory.date))
    .all()
  return {
    crop,
    market,
    price,
    pattern,
    mandis: st
      ? {
          date: st.date,
          rows: st.markets.map((m) => {
            const t = tFor(m.name)
            return { name: m.name, district: m.district, modal: m.modal, arrivalsT: m.arrivalsT, transport: t, net: t !== null ? m.modal - t : null, here: normMarket(m.name) === normMarket(market) }
          })
        }
      : null,
    arrivals: arrivals.length
      ? { latest: arrivals.at(-1)!.t, latestDate: arrivals.at(-1)!.date, avg30: Math.round((arrivals.reduce((s, a) => s + a.t, 0) / arrivals.length) * 10) / 10 }
      : null,
    hold: stockQtl > 0 && price ? holdFigures(stockQtl, price, pattern, holdingCosts(db)) : null,
    note: marketNotes(db)[crop] ?? null
  }
}

// ---------------- seasons and entries ----------------

export function saveSeason(db: Db, s: FarmSeasonInput): number {
  if (!(s.crop in CROPS)) throw new Error('Pick a crop.')
  if (!Number.isInteger(s.year) || s.year < 1990 || s.year > 2100) throw new Error('Enter the harvest year, e.g. 2026.')
  if (s.areaAcres != null && !(s.areaAcres > 0)) throw new Error('Acres must be more than zero.')
  if (s.expectedQtl != null && !(s.expectedQtl >= 0)) throw new Error('Expected yield can’t be negative.')
  const row = {
    personId: s.personId,
    crop: s.crop,
    variety: s.variety?.trim() || null,
    priceClass: s.priceClass?.trim() || null,
    season: s.season,
    year: s.year,
    field: s.field?.trim() || null,
    areaAcres: s.areaAcres ?? null,
    sownOn: s.sownOn || null,
    expectedQtl: s.expectedQtl ?? null,
    status: s.status,
    market: s.market?.trim() || null,
    note: s.note?.trim() || null
  }
  if (s.id) {
    db.update(schema.farmSeasons).set(row).where(eq(schema.farmSeasons.id, s.id)).run()
    return s.id
  }
  return db.insert(schema.farmSeasons).values(row).returning({ id: schema.farmSeasons.id }).get().id
}

export function deleteSeason(db: Db, id: number): void {
  db.transaction((tx) => {
    tx.delete(schema.farmEntries).where(eq(schema.farmEntries.seasonId, id)).run()
    tx.delete(schema.farmSeasons).where(eq(schema.farmSeasons.id, id)).run()
  })
}

export function saveEntry(db: Db, e: FarmEntryInput): number {
  const season = db.select().from(schema.farmSeasons).where(eq(schema.farmSeasons.id, e.seasonId)).get()
  if (!season) throw new Error('That season no longer exists.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('Pick a date.')
  const qty = e.quantityQtl ?? null
  if (e.type !== 'COST' && !(qty !== null && qty > 0)) throw new Error('Enter how much, in quintals (or man / kg).')
  if (e.type === 'COST' && !(e.amount > 0)) throw new Error('Enter what it cost.')
  if (e.type === 'COST' && !e.costKind) throw new Error('Pick what the cost was for.')
  let amount = e.amount
  if (e.type === 'SALE') {
    if (!(e.rate && e.rate > 0) && !(amount > 0)) throw new Error('Enter the rate per quintal or what the sale brought in.')
    amount = amount > 0 ? amount : round2(qty! * e.rate!)
    // Selling more than is in stock is a typing mistake more often than not.
    const v = seasonView(db, season.id)
    const stillThere = v.inStockQtl + (e.id ? (v.entries.find((x) => x.id === e.id)?.quantityQtl ?? 0) : 0)
    if (qty! > stillThere + 1e-6)
      throw new Error(`Only ${round2(stillThere)} quintals of this season are in stock. Record the harvest first, or check the quantity.`)
  }
  if (e.type === 'HARVEST' && season.status === 'GROWING')
    db.update(schema.farmSeasons).set({ status: 'HARVESTED' }).where(eq(schema.farmSeasons.id, season.id)).run()
  const row = {
    seasonId: e.seasonId,
    date: e.date,
    type: e.type,
    costKind: e.type === 'COST' ? e.costKind : null,
    quantityQtl: e.type === 'COST' ? null : qty,
    rate: e.type === 'SALE' ? (e.rate ?? round2(amount / qty!)) : null,
    amount: e.type === 'HARVEST' || e.type === 'LOSS' ? 0 : amount,
    charges: e.type === 'SALE' ? (e.charges ?? null) : null,
    mandi: e.mandi?.trim() || null,
    note: e.note?.trim() || null
  }
  if (e.id) {
    db.update(schema.farmEntries).set(row).where(eq(schema.farmEntries.id, e.id)).run()
    return e.id
  }
  const id = db.insert(schema.farmEntries).values(row).returning({ id: schema.farmEntries.id }).get().id
  // Everything sold: the season is done.
  const after = seasonView(db, season.id)
  if (after.status === 'HARVESTED' && after.harvestedQtl > 0 && after.inStockQtl <= 1e-6)
    db.update(schema.farmSeasons).set({ status: 'CLOSED' }).where(eq(schema.farmSeasons.id, season.id)).run()
  return id
}

export function deleteEntry(db: Db, id: number): void {
  db.delete(schema.farmEntries).where(eq(schema.farmEntries.id, id)).run()
}

// ---------------- prices ----------------

/** Daily modal prices for a crop at a mandi, oldest first. */
export function priceSeries(db: Db, crop: CropKey, market: string, since?: string): { date: string; modal: number }[] {
  return db
    .select({ date: schema.priceHistory.date, modal: schema.priceHistory.close })
    .from(schema.priceHistory)
    .where(eq(schema.priceHistory.key, mandiKey(crop, market)))
    .orderBy(asc(schema.priceHistory.date))
    .all()
    .filter((p) => !since || p.date >= since)
}

/** The day's min and max, kept beside the modal series (which holds only the modal). */
const RANGE_KEY = 'farm:ranges'
export const priceRanges = (db: Db): Record<string, { date: string; min: number | null; max: number | null }> =>
  JSON.parse(getSetting(db, RANGE_KEY) ?? '{}')
export function saveRange(db: Db, key: string, r: { date: string; min: number | null; max: number | null }): void {
  const all = priceRanges(db)
  if (!all[key] || all[key].date <= r.date) all[key] = r
  setSetting(db, RANGE_KEY, JSON.stringify(all))
}

/** "G20" stays "G20"; "BOLD" becomes "Bold", "NARMA BT COTTON" becomes "Narma Bt Cotton". */
const titleCase = (s: string) => s.replace(/\b([A-Z])([A-Z]+)\b/g, (_m, a: string, b: string) => (b.length > 1 ? a + b.toLowerCase() : a + b))

const avgSince = (pts: { date: string; modal: number }[], since: string) => {
  const xs = pts.filter((p) => p.date >= since)
  return xs.length ? Math.round(xs.reduce((s, p) => s + p.modal, 0) / xs.length) : null
}
const daysBefore = (iso: string, n: number) => new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10)

export function cropPrice(db: Db, crop: CropKey, market: string, today = todayIso()): CropPrice {
  // A little over a year, so "a year ago" finds the price even when that exact day had none.
  const full = priceSeries(db, crop, market, daysBefore(today, 380))
  const history = full.filter((p) => p.date >= daysBefore(today, 366))
  const last = full.at(-1) ?? null
  const range = priceRanges(db)[mandiKey(crop, market)]
  const yearAgoPts = full.filter((p) => p.date <= daysBefore(today, 365) && p.date >= daysBefore(today, 380))
  // Monthly averages fill in where the daily prices kept so far don't reach back far enough.
  const monthly = db
    .select({ date: schema.priceHistory.date, modal: schema.priceHistory.close })
    .from(schema.priceHistory)
    .where(eq(schema.priceHistory.key, monthlyKey(crop, market)))
    .orderBy(asc(schema.priceHistory.date))
    .all()
    .filter((p) => p.date >= daysBefore(today, 400))
  const firstDaily = history[0]?.date ?? today
  const avg = (days: number) => {
    const since = daysBefore(today, days)
    if (firstDaily <= daysBefore(today, days - 15)) return avgSince(history, since)
    const pts = [...monthly.filter((p) => p.date >= since && p.date < firstDaily.slice(0, 7)), ...history]
    return pts.length ? Math.round(pts.reduce((s, p) => s + p.modal, 0) / pts.length) : null
  }
  const sameMonthLastYear = `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-15`
  const yearAgo = yearAgoPts.at(-1)?.modal ?? monthly.find((p) => p.date === sameMonthLastYear)?.modal ?? null
  const chart = history.length >= 30 ? history : [...monthly.filter((p) => p.date < firstDaily && p.date >= daysBefore(today, 366)), ...history]
  const msp = MSP[crop] ?? null
  const target = priceTargets(db)[crop] ?? null
  // Each variety (Agmarknet) and yard class (Rajkot APMC) at this mandi, latest day within the fortnight.
  const ranges = priceRanges(db)
  const latestByVariety = new Map<string, CropPrice['varieties'][number]>()
  for (const [prefix, source] of [
    [`MANDIV:${crop}:${market.trim().toUpperCase()}:`, 'AGMARKNET'],
    [`MANDIC:${crop}:${market.trim().toUpperCase()}:`, 'APMC']
  ] as const)
    for (const r of db
      .select()
      .from(schema.priceHistory)
      .where(and(like(schema.priceHistory.key, `${prefix}%`), gte(schema.priceHistory.date, daysBefore(today, 14))))
      .orderBy(asc(schema.priceHistory.date))
      .all()) {
      const cls = r.key.slice(prefix.length)
      const label = source === 'APMC' ? (PRICE_CLASSES[crop]?.find((c) => c.key.toUpperCase() === cls)?.label ?? (cls === 'YARD' ? 'Yard rate' : titleCase(cls))) : titleCase(cls)
      const range = ranges[r.key]
      latestByVariety.set(r.key, { name: label, modal: r.close, date: r.date, min: range?.date === r.date ? range.min : null, max: range?.date === r.date ? range.max : null, source })
    }
  // Agmarknet's catch-all variety named after the crop itself ("Cummin Seed(Jeera)") says nothing more.
  const varieties = [...latestByVariety.values()]
    .filter((v) => !(v.source === 'AGMARKNET' && v.name.toLowerCase() === CROPS[crop].agmark.toLowerCase()))
    .sort((a, b) => b.modal - a.modal)
  return {
    crop,
    market,
    latest: last
      ? { crop, market, date: last.date, modal: last.modal, min: range?.date === last.date ? range.min : null, max: range?.date === last.date ? range.max : null }
      : null,
    avg30: avgSince(history, daysBefore(today, 30)),
    avg90: avg(90),
    avg180: avg(180),
    yearAgo,
    msp: msp?.price ?? null,
    mspSeason: msp?.season ?? null,
    varieties,
    history: chart,
    target,
    targetReached: !!(target && last && last.modal >= target)
  }
}

/** Agmarknet's name for a yard class, where it reports one (Rajkot's bold groundnut is "Bold"). */
const AGMARK_CLASS: Record<string, string> = { 'GROUNDNUT:JADI': 'Bold', 'WHEAT:LOKWAN': 'Lokwan' }

type Priced = { price: number; date: string; market: string; pricedAs: { kind: 'VARIETY' | 'CLASS' | 'CROP'; name: string | null } }

/** The newest row under a price key within the last fortnight (one row read: this runs for every holdings list). */
function latestRow(db: Db, key: string, fresh = true) {
  const r = db.select().from(schema.priceHistory).where(eq(schema.priceHistory.key, key)).orderBy(desc(schema.priceHistory.date)).limit(1).get()
  return r && (!fresh || r.date >= daysBefore(todayIso(), 14)) ? r : null
}

/**
 * The price a crop is valued at, most specific first: the variety's own price at the mandi (under
 * any of its names: "G20" is GG-20), then the class it sells as (jini or jadi, from Rajkot APMC or
 * Agmarknet), then the middle of all varieties that day; at its season's mandi, else the farm's,
 * else any mandi with a price.
 */
function priceFor(db: Db, crop: CropKey, market: string, variety?: string | null, priceClass?: string | null): Priced | null {
  const known = findVariety(crop, variety)
  if (variety) {
    for (const name of [...new Set([variety, ...(known ? [known.name, ...(known.aka ?? [])] : [])])]) {
      const v = latestRow(db, varietyKey(crop, market, name))
      if (v) return { price: v.close, date: v.date, market, pricedAs: { kind: 'VARIETY', name } }
    }
  }
  const cls = priceClass || known?.cls
  if (cls) {
    const c = latestRow(db, classKey(crop, market, cls)) ?? (AGMARK_CLASS[`${crop}:${cls.toUpperCase()}`] ? latestRow(db, varietyKey(crop, market, AGMARK_CLASS[`${crop}:${cls.toUpperCase()}`])) : null)
    if (c) return { price: c.close, date: c.date, market, pricedAs: { kind: 'CLASS', name: cls } }
  }
  const p = latestRow(db, mandiKey(crop, market), false)
  if (p) return { price: p.close, date: p.date, market, pricedAs: { kind: 'CROP', name: null } }
  const any = db
    .select()
    .from(schema.priceHistory)
    .where(like(schema.priceHistory.key, `MANDI:${crop}:%`))
    .orderBy(desc(schema.priceHistory.date))
    .limit(1)
    .get()
  return any ? { price: any.close, date: any.date, market: any.key.split(':').slice(2).join(':'), pricedAs: { kind: 'CROP', name: null } } : null
}

// ---------------- the report ----------------

function seasonsOf(db: Db, personId?: number) {
  return db
    .select()
    .from(schema.farmSeasons)
    .where(personId ? eq(schema.farmSeasons.personId, personId) : undefined)
    .orderBy(desc(schema.farmSeasons.year), asc(schema.farmSeasons.crop))
    .all()
}

function build(db: Db, rows: (typeof schema.farmSeasons.$inferSelect)[], today: string): FarmSeasonView[] {
  if (!rows.length) return []
  const names = new Map(db.select().from(schema.persons).all().map((p) => [p.id, p.name]))
  const entries = db
    .select()
    .from(schema.farmEntries)
    .where(inArray(schema.farmEntries.seasonId, rows.map((r) => r.id)))
    .orderBy(asc(schema.farmEntries.date), asc(schema.farmEntries.id))
    .all()
  const market = defaultMarket(db)
  return rows.map((r) => {
    const es: FarmEntry[] = entries
      .filter((e) => e.seasonId === r.id)
      .map(({ createdAt: _c, ...e }) => e)
    const sum = (f: (e: FarmEntry) => number, t: FarmEntry['type']) => es.filter((e) => e.type === t).reduce((s, e) => s + f(e), 0)
    const costsByKind: Partial<Record<FarmCostKind, number>> = {}
    for (const e of es) if (e.type === 'COST' && e.costKind) costsByKind[e.costKind] = (costsByKind[e.costKind] ?? 0) + e.amount
    const costs = sum((e) => e.amount, 'COST')
    const harvestedQtl = sum((e) => e.quantityQtl ?? 0, 'HARVEST')
    const soldQtl = sum((e) => e.quantityQtl ?? 0, 'SALE')
    const lostQtl = sum((e) => e.quantityQtl ?? 0, 'LOSS')
    const salesNet = sum((e) => e.amount - (e.charges ?? 0), 'SALE')
    const inStockQtl = Math.max(0, round2(harvestedQtl - soldQtl - lostQtl))
    const p = priceFor(db, r.crop, r.market ?? market, r.variety, r.priceClass)
    const price = p?.price ?? null
    const stockValue = price ? Math.round(inStockQtl * price) : 0
    const expectedValue = r.status === 'GROWING' && r.expectedQtl && price ? Math.round(r.expectedQtl * price) : null
    const profit = Math.round(salesNet + stockValue + (expectedValue ?? 0) - costs)
    void today
    return {
      id: r.id,
      personId: r.personId,
      personName: names.get(r.personId) ?? '',
      crop: r.crop,
      variety: r.variety,
      priceClass: r.priceClass,
      season: r.season,
      year: r.year,
      field: r.field,
      areaAcres: r.areaAcres,
      sownOn: r.sownOn,
      expectedQtl: r.expectedQtl,
      status: r.status,
      market: r.market,
      note: r.note,
      entries: es,
      costs,
      costsByKind,
      harvestedQtl: round2(harvestedQtl),
      soldQtl: round2(soldQtl),
      lostQtl: round2(lostQtl),
      salesNet: Math.round(salesNet),
      inStockQtl,
      costPerQtl: costs > 0 && harvestedQtl > 0 ? Math.round(costs / harvestedQtl) : null,
      stockValue,
      expectedValue,
      profit,
      profitPerAcre: r.areaAcres ? Math.round(profit / r.areaAcres) : null,
      price
    }
  })
}

function seasonView(db: Db, id: number): FarmSeasonView {
  return build(db, db.select().from(schema.farmSeasons).where(eq(schema.farmSeasons.id, id)).all(), todayIso())[0]
}

const fyOf = (iso: string) => {
  const y = Number(iso.slice(0, 4))
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1
  return { label: `FY${String(start + 1).slice(2)}`, from: `${start}-04-01`, to: `${start + 1}-03-31` }
}

/** In the godown: by person, crop and variety, valued at the latest price for the crop's mandi. */
function stockOf(db: Db, seasons: FarmSeasonView[], market: string): FarmStock[] {
  const stockBy = new Map<string, FarmStock>()
  for (const s of seasons) {
    if (s.inStockQtl <= 0) continue
    const k = `${s.personId}:${s.crop}:${(s.variety ?? '').toUpperCase()}:${(s.priceClass ?? '').toUpperCase()}`
    const p = priceFor(db, s.crop, s.market ?? market, s.variety, s.priceClass)
    const cur = stockBy.get(k) ?? {
      personId: s.personId,
      personName: s.personName,
      crop: s.crop,
      variety: s.variety,
      pricedAs: p?.pricedAs ?? { kind: 'CROP', name: null },
      quantityQtl: 0,
      price: p?.price ?? null,
      priceDate: p?.date ?? null,
      market: p?.market ?? s.market ?? market,
      value: 0,
      cost: 0 as number | null
    }
    cur.quantityQtl = round2(cur.quantityQtl + s.inStockQtl)
    cur.value += s.stockValue
    cur.cost = cur.cost !== null && s.costPerQtl !== null ? cur.cost + Math.round(s.inStockQtl * s.costPerQtl) : null
    stockBy.set(k, cur)
  }
  return [...stockBy.values()].sort((a, b) => b.value - a.value)
}

export function farmReport(db: Db, personId?: number, today = todayIso()): FarmReport {
  const seasons = build(db, seasonsOf(db, personId), today)
  const market = defaultMarket(db)
  const stock = stockOf(db, seasons, market)

  // Prices for what is still growing or in stock, and for crops with a target; finished seasons drop out.
  const crops = [...new Set([...seasons.filter((s) => s.status !== 'CLOSED').map((s) => s.crop), ...(Object.keys(priceTargets(db)) as CropKey[])])]
  const prices = crops.map((c) => cropPrice(db, c, seasons.find((s) => s.crop === c && s.market)?.market ?? market, today))

  const fy = fyOf(today)
  const inFy = (d: string) => d >= fy.from && d <= fy.to
  const all = seasons.flatMap((s) => s.entries)
  const lastPrice = db
    .select({ date: schema.priceHistory.date })
    .from(schema.priceHistory)
    .where(like(schema.priceHistory.key, 'MANDI:%'))
    .orderBy(desc(schema.priceHistory.date))
    .limit(1)
    .get()

  return {
    defaultMarket: market,
    stock,
    stockValue: stock.reduce((s, x) => s + x.value, 0),
    growing: seasons
      .filter((s) => s.status === 'GROWING')
      .map((s) => ({ seasonId: s.id, personName: s.personName, crop: s.crop, season: s.season, year: s.year, areaAcres: s.areaAcres, expectedQtl: s.expectedQtl, expectedValue: s.expectedValue })),
    seasons,
    prices,
    thisFy: {
      fy: fy.label,
      sales: Math.round(all.filter((e) => e.type === 'SALE' && inFy(e.date)).reduce((s, e) => s + e.amount - (e.charges ?? 0), 0)),
      costs: Math.round(all.filter((e) => e.type === 'COST' && inFy(e.date)).reduce((s, e) => s + e.amount, 0))
    },
    pricesAsOf: lastPrice?.date ?? null,
    priceError: getSetting(db, 'farm:priceError'),
    outlook: crops.map((c) =>
      outlookFor(
        db,
        c,
        seasons.find((x) => x.crop === c && x.market)?.market ?? market,
        stock.filter((x) => x.crop === c).reduce((t, x) => t + x.quantityQtl, 0),
        today
      )
    ),
    holdingCosts: holdingCosts(db),
    transport: transportCosts(db)
  }
}

// ---------------- net worth ----------------

/** One account and one instrument per person and crop, so the godown shows up with the holdings. */
function ensureLedger(db: Db, personId: number, crop: CropKey, variety: string | null): { accountId: number; instrumentId: number; accountName: string } {
  const name = `${CROPS[crop].label}${variety ? ` ${variety}` : ''} in the godown`
  const ext = `farm:${crop}`
  let inst = db.select().from(schema.instruments).where(eq(schema.instruments.name, name)).get()
  if (!inst || inst.assetClass !== 'AGRI')
    inst = db
      .insert(schema.instruments)
      .values({ name, assetClass: 'AGRI', currency: 'INR' })
      .returning()
      .get()
  const accountName = 'Farm godown'
  let acct = db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.personId, personId), eq(schema.accounts.kind, 'FARM'), eq(schema.accounts.externalId, ext)))
    .get()
  if (!acct)
    acct = db
      .insert(schema.accounts)
      .values({ personId, platform: 'MANUAL', kind: 'FARM', name: accountName, externalId: ext })
      .returning()
      .get()
  return { accountId: acct.id, instrumentId: inst.id, accountName }
}

/** The godown as holdings rows: quantity in quintals, today's mandi price, the growing cost. */
export function farmHoldings(db: Db, personId?: number): HoldingRow[] {
  // Only seasons that can still have stock, and no price cards: this runs for every holdings list.
  const open = seasonsOf(db, personId).filter((s) => s.status !== 'CLOSED')
  if (!open.length) return []
  return stockOf(db, build(db, open, todayIso()), defaultMarket(db)).map((s) => {
    const l = ensureLedger(db, s.personId, s.crop, s.variety)
    const value = s.price !== null ? s.value : null
    return {
      personId: s.personId,
      personName: s.personName,
      accountId: l.accountId,
      accountName: l.accountName,
      platform: 'MANUAL',
      instrumentId: l.instrumentId,
      instrumentName: `${CROPS[s.crop].label}${s.variety ? ` ${s.variety}` : ''} (${s.quantityQtl} qtl)`,
      isin: null,
      symbol: null,
      assetClass: 'AGRI',
      currency: 'INR',
      quantity: s.quantityQtl,
      avgCost: s.cost !== null && s.quantityQtl ? Math.round(s.cost / s.quantityQtl) : null,
      invested: s.cost,
      lastPrice: s.price,
      priceDate: s.priceDate,
      marketValue: value,
      unrealizedPnl: value !== null && s.cost !== null ? value - s.cost : null,
      realizedPnl: 0,
      dividends: 0,
      tradesQuantity: null,
      prevClose: null,
      dayChange: null,
      priceSource: s.price !== null ? 'LIVE' : 'MANUAL',
      sector: null,
      fxRate: 1,
      marketValueInr: value,
      investedInr: s.cost,
      unrealizedPnlInr: value !== null && s.cost !== null ? value - s.cost : null,
      dayChangeInr: null,
      costSource: s.cost !== null ? 'MANUAL' : null
    }
  })
}

// ---------------- demo data ----------------

export interface FarmSeed {
  market?: string
  targets?: Partial<Record<CropKey, number>>
  seasons: { season: Omit<FarmSeasonInput, 'personId'>; entries: (Partial<Omit<FarmEntryInput, 'seasonId'>> & Pick<FarmEntryInput, 'date' | 'type'>)[] }[]
}

/** Loads a farm from a demo file (seasons with their entries, the mandi, price targets). */
export function seedFarm(db: Db, personId: number, seed: FarmSeed): void {
  if (seed.market) setDefaultMarket(db, seed.market)
  for (const [crop, price] of Object.entries(seed.targets ?? {})) setPriceTarget(db, crop as CropKey, price ?? null)
  for (const s of seed.seasons) {
    const seasonId = saveSeason(db, { ...s.season, personId })
    for (const e of s.entries)
      saveEntry(db, { seasonId, costKind: null, quantityQtl: null, rate: null, amount: 0, charges: null, mandi: null, note: null, ...e })
  }
}
