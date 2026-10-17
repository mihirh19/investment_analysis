import { and, asc, eq, inArray } from 'drizzle-orm'
import type { ManualAssetInput, ManualAssetView, ManualKind, ManualMeta, MetalPrices } from '@shared/assets'
import { ENTRY_KINDS } from '@shared/assets'
import type { AssetClass, HoldingRow, Platform } from '@shared/types'
import { schema, type Db } from './db'
import { todayIso } from './portfolio/dates'
import { engineFor, type PriceBook } from './portfolio/engines'
import { residexKey, type SizeBand } from './market/residex'

const CLASS_BY_KIND: Record<ManualKind, AssetClass> = {
  DEPOSIT: 'FD',
  RD: 'FD',
  PPF: 'PPF',
  BOND: 'BOND',
  SGB: 'GOLD',
  METAL: 'GOLD',
  PROPERTY: 'REAL_ESTATE',
  CRYPTO: 'CRYPTO',
  CASH: 'CASH',
  OTHER: 'OTHER'
}

export const GOLD_PREMIUM_KEY = 'gold_premium_pct'
/** Basic customs duty on gold imports since the July 2024 budget; adjustable in Settings. */
export const DEFAULT_GOLD_PREMIUM = 6

// ---------------- prices ----------------

/** Nearest weekly close on or before a date, from a sorted series. */
function seriesLookup(points: { date: string; close: number }[]) {
  return (date: string): number | null => {
    if (points.length === 0 || date < points[0].date) return null
    let lo = 0
    let hi = points.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (points[mid].date <= date) lo = mid
      else hi = mid - 1
    }
    return points[lo].close
  }
}

/** Value on a date between dated points; null before the first, the last after the last. */
export function interpolate(points: { date: string; close: number }[], date: string): number | null {
  if (points.length === 0 || date < points[0].date) return null
  const i = points.findIndex((p) => p.date > date)
  if (i === -1) return points[points.length - 1].close
  const a = points[i - 1]
  const b = points[i]
  const t = (Date.parse(date) - Date.parse(a.date)) / (Date.parse(b.date) - Date.parse(a.date))
  return a.close + (b.close - a.close) * t
}

export function loadPriceBook(db: Db): PriceBook {
  const live = new Map(
    db
      .select()
      .from(schema.marketPrices)
      .all()
      .map((p) => [p.key, p.price])
  )
  const history = new Map<string, ReturnType<typeof seriesLookup>>()
  const hist = (key: string) => {
    if (!history.has(key)) {
      const pts = db
        .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
        .from(schema.priceHistory)
        .where(eq(schema.priceHistory.key, key))
        .orderBy(asc(schema.priceHistory.date))
        .all()
      history.set(key, seriesLookup(pts))
    }
    return history.get(key)!
  }
  const today = todayIso()
  const at = (key: string, date?: string) =>
    !date || date >= today ? (live.get(key) ?? hist(key)(today)) : (hist(key)(date) ?? null)
  // City home prices by quarter, read between quarters by straight line.
  const housing = new Map<string, { date: string; close: number }[]>()
  const housingPoints = (cityId: number, band: SizeBand) => {
    const key = residexKey(cityId, band)
    if (!housing.has(key))
      housing.set(
        key,
        db
          .select({ date: schema.priceHistory.date, close: schema.priceHistory.close })
          .from(schema.priceHistory)
          .where(eq(schema.priceHistory.key, key))
          .orderBy(asc(schema.priceHistory.date))
          .all()
      )
    return housing.get(key)!
  }
  return {
    metal: (m, date) => at(m === 'GOLD' ? 'XAU' : 'XAG', date),
    crypto: (sym, date) => at(`CRYPTO:${sym.toUpperCase()}`, date),
    housing: (cityId, band, date) => interpolate(housingPoints(cityId, band), date),
    housingStart: (cityId, band) => housingPoints(cityId, band)[0]?.date ?? null
  }
}

export function getMetalPrices(db: Db): MetalPrices {
  const rows = new Map(
    db
      .select()
      .from(schema.marketPrices)
      .all()
      .map((p) => [p.key, p])
  )
  const premium = Number(
    db.select().from(schema.settings).where(eq(schema.settings.key, GOLD_PREMIUM_KEY)).get()?.value ??
      DEFAULT_GOLD_PREMIUM
  )
  return {
    goldPerGram: rows.get('XAU')?.price ?? null,
    silverPerGram: rows.get('XAG')?.price ?? null,
    premiumPct: premium,
    asOf: rows.get('XAU')?.asOf ?? null
  }
}

// ---------------- validation ----------------

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const positive = (n: unknown, label: string) => {
  if (typeof n !== 'number' || !(n > 0)) throw new Error(`${label} must be more than zero`)
}
const date = (d: unknown, label: string) => {
  if (!isDate(d)) throw new Error(`${label} is required`)
}

function validate(m: ManualMeta): void {
  if (!m.name?.trim()) throw new Error('Give it a name you will recognise')
  switch (m.kind) {
    case 'DEPOSIT':
      positive(m.principal, 'Amount')
      positive(m.rate, 'Interest rate')
      date(m.startDate, 'Start date')
      date(m.maturityDate, 'Maturity date')
      if (m.maturityDate <= m.startDate) throw new Error('Maturity must be after the start date')
      break
    case 'RD':
      positive(m.installment, 'Monthly instalment')
      positive(m.rate, 'Interest rate')
      positive(m.months, 'Number of months')
      date(m.startDate, 'Start date')
      break
    case 'PPF':
      date(m.openDate, 'Opening date')
      positive(m.rate, 'Interest rate')
      if (!(m.yearlyContribution >= 0)) throw new Error('Yearly contribution must be zero or more')
      break
    case 'BOND':
      positive(m.faceValue, 'Face value')
      positive(m.units, 'Units')
      positive(m.purchasePrice, 'Price paid')
      if (!(m.couponRate >= 0)) throw new Error('Coupon rate must be zero or more')
      date(m.purchaseDate, 'Purchase date')
      date(m.maturityDate, 'Maturity date')
      break
    case 'SGB':
      positive(m.grams, 'Grams')
      positive(m.issuePrice, 'Issue price')
      date(m.issueDate, 'Issue date')
      break
    case 'METAL':
      positive(m.grams, 'Weight')
      if (!(m.purity > 0 && m.purity <= 1)) throw new Error('Purity must be between 0 and 1, e.g. 0.916 for 22K')
      date(m.purchaseDate, 'Purchase date')
      break
    case 'PROPERTY':
      positive(m.purchasePrice, 'Purchase price')
      date(m.purchaseDate, 'Purchase date')
      for (const t of m.tenancies ?? []) {
        if (!t.tenant?.trim()) throw new Error('Enter the tenant’s name')
        positive(t.monthlyRent, 'Monthly rent')
        date(t.startDate, 'Tenancy start')
        if (t.endDate) {
          date(t.endDate, 'Tenancy end')
          if (t.endDate < t.startDate) throw new Error('The tenancy ends before it starts')
        }
      }
      for (const p of m.rentPayments ?? []) {
        positive(p.amount, 'Rent received')
        date(p.date, 'Date received')
        if (!/^\d{4}-\d{2}$/.test(p.forMonth)) throw new Error('Choose the month the rent is for')
      }
      for (const e of m.expenses ?? []) {
        positive(e.amount, 'Expense amount')
        date(e.date, 'Expense date')
      }
      break
    case 'CRYPTO':
      if (!/^[A-Za-z0-9]{2,10}$/.test(m.symbol ?? '')) throw new Error('Enter the coin ticker, e.g. BTC')
      positive(m.quantity, 'Quantity')
      date(m.purchaseDate, 'Purchase date')
      break
    case 'CASH':
    case 'OTHER':
      break
  }
}

function platformFor(m: ManualMeta): Platform {
  if (m.kind === 'DEPOSIT' && ['POST_OFFICE_TD', 'NSC', 'KVP', 'SCSS', 'POMIS'].includes(m.subtype))
    return 'POST_OFFICE'
  if (m.kind === 'DEPOSIT' || m.kind === 'RD' || m.kind === 'CASH') return 'BANK'
  return 'MANUAL'
}

// ---------------- CRUD ----------------

interface StoredMeta {
  meta: ManualMeta
  instrumentId: number
}

function readStored(json: string | null): StoredMeta | null {
  try {
    const v = JSON.parse(json ?? 'null') as StoredMeta | null
    return v && v.meta && v.instrumentId ? v : null
  } catch {
    return null
  }
}

export function saveManualAsset(db: Db, input: ManualAssetInput): number {
  const meta = { ...input.meta, name: input.meta.name.trim() } as ManualMeta
  if (meta.kind === 'CRYPTO') meta.symbol = meta.symbol.trim().toUpperCase()
  validate(meta)
  const assetClass = CLASS_BY_KIND[meta.kind]
  return db.transaction((tx) => {
    if (input.accountId) {
      const a = tx.select().from(schema.accounts).where(eq(schema.accounts.id, input.accountId)).get()
      const stored = readStored(a?.metaJson ?? null)
      if (!a || !stored) throw new Error('That asset no longer exists')
      tx.update(schema.instruments)
        .set({ name: meta.name, assetClass, tickerUs: meta.kind === 'CRYPTO' ? meta.symbol : null })
        .where(eq(schema.instruments.id, stored.instrumentId))
        .run()
      tx.update(schema.accounts)
        .set({
          personId: input.personId,
          name: meta.institution ? `${meta.institution} · ${meta.name}` : meta.name,
          platform: platformFor(meta),
          metaJson: JSON.stringify({ meta, instrumentId: stored.instrumentId })
        })
        .where(eq(schema.accounts.id, a.id))
        .run()
      return a.id
    }
    const instrument = tx
      .insert(schema.instruments)
      .values({
        name: meta.name,
        assetClass,
        isin: null,
        tickerUs: meta.kind === 'CRYPTO' ? meta.symbol : null,
        currency: 'INR'
      })
      .returning({ id: schema.instruments.id })
      .get()
    const account = tx
      .insert(schema.accounts)
      .values({
        personId: input.personId,
        platform: platformFor(meta),
        kind: 'MANUAL_ASSET',
        name: meta.institution ? `${meta.institution} · ${meta.name}` : meta.name,
        externalId: `manual:${instrument.id}`,
        currency: 'INR',
        metaJson: JSON.stringify({ meta, instrumentId: instrument.id })
      })
      .returning({ id: schema.accounts.id })
      .get()
    return account.id
  })
}

function getStored(db: Db, accountId: number) {
  const a = db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.kind, 'MANUAL_ASSET')))
    .get()
  const stored = readStored(a?.metaJson ?? null)
  if (!a || !stored) throw new Error('That asset no longer exists')
  return { account: a, ...stored }
}

export function deleteManualAsset(db: Db, accountId: number): void {
  const { instrumentId } = getStored(db, accountId)
  db.transaction((tx) => {
    tx.delete(schema.holdingSnapshots).where(eq(schema.holdingSnapshots.accountId, accountId)).run()
    tx.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run()
    tx.delete(schema.instruments).where(eq(schema.instruments.id, instrumentId)).run()
  })
}

export function addManualEntry(db: Db, accountId: number, entryDate: string, value: number): void {
  const { meta, instrumentId } = getStored(db, accountId)
  if (!ENTRY_KINDS.includes(meta.kind)) throw new Error('This kind of asset is valued automatically')
  if (!isDate(entryDate) || entryDate > todayIso()) throw new Error('Pick a date that is not in the future')
  if (!(value >= 0)) throw new Error('Value must be zero or more')
  db.insert(schema.holdingSnapshots)
    .values({ accountId, instrumentId, date: entryDate, quantity: 1, price: value, value, source: 'MANUAL' })
    .onConflictDoUpdate({
      target: [
        schema.holdingSnapshots.accountId,
        schema.holdingSnapshots.instrumentId,
        schema.holdingSnapshots.date,
        schema.holdingSnapshots.source
      ],
      set: { price: value, value }
    })
    .run()
}

export function deleteManualEntry(db: Db, accountId: number, entryDate: string): void {
  db.delete(schema.holdingSnapshots)
    .where(and(eq(schema.holdingSnapshots.accountId, accountId), eq(schema.holdingSnapshots.date, entryDate)))
    .run()
}

// ---------------- read models ----------------

export interface LoadedManual {
  account: typeof schema.accounts.$inferSelect
  meta: ManualMeta
  instrumentId: number
  entries: { date: string; value: number }[]
}

export function loadManualAssets(db: Db, personId?: number): LoadedManual[] {
  const accounts = db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.kind, 'MANUAL_ASSET'), personId ? eq(schema.accounts.personId, personId) : undefined))
    .all()
  if (accounts.length === 0) return []
  const snaps = db
    .select()
    .from(schema.holdingSnapshots)
    .where(
      inArray(
        schema.holdingSnapshots.accountId,
        accounts.map((a) => a.id)
      )
    )
    .orderBy(asc(schema.holdingSnapshots.date))
    .all()
  const out: LoadedManual[] = []
  for (const a of accounts) {
    const stored = readStored(a.metaJson)
    if (!stored) continue
    out.push({
      account: a,
      meta: stored.meta,
      instrumentId: stored.instrumentId,
      entries: snaps.filter((s) => s.accountId === a.id).map((s) => ({ date: s.date, value: s.value ?? 0 }))
    })
  }
  return out
}

export function manualAssetViews(db: Db, personId?: number): ManualAssetView[] {
  const book = loadPriceBook(db)
  const today = todayIso()
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  return loadManualAssets(db, personId).map((x) => {
    const e = engineFor(x.meta, x.entries, book, today)
    const cur = e.current()
    const mat = e.maturity()
    const liq = e.liquidity()
    const next = e.events(today, '9999-12-31')[0] ?? null
    return {
      accountId: x.account.id,
      instrumentId: x.instrumentId,
      personId: x.account.personId,
      personName: persons.get(x.account.personId) ?? '',
      meta: x.meta,
      entries: x.entries,
      value: cur.value,
      invested: e.invested(),
      priceSource: cur.source,
      maturityDate: mat?.date ?? null,
      maturityValue: mat?.value ?? null,
      matured: !!mat && mat.date <= today,
      liquidity: liq.bucket,
      lockedUntil: liq.lockedUntil,
      nextEvent: next,
      projection: e.projection()
    }
  })
}

/** Units for display: bond units, grams, coins; one "unit" for balances. */
function quantityOf(m: ManualMeta): number {
  switch (m.kind) {
    case 'BOND':
      return m.units
    case 'SGB':
    case 'METAL':
      return m.grams
    case 'CRYPTO':
      return m.quantity
    default:
      return 1
  }
}

export function manualHoldings(db: Db, personId?: number): HoldingRow[] {
  const book = loadPriceBook(db)
  const today = todayIso()
  const persons = new Map(
    db
      .select()
      .from(schema.persons)
      .all()
      .map((p) => [p.id, p.name])
  )
  const prev = new Map(
    db
      .select()
      .from(schema.marketPrices)
      .all()
      .map((p) => [p.key, p])
  )
  const rows: HoldingRow[] = []
  for (const x of loadManualAssets(db, personId)) {
    const e = engineFor(x.meta, x.entries, book, today)
    const { value, source } = e.current()
    if (value === null && e.invested() === null) continue
    const invested = e.invested()
    const qty = quantityOf(x.meta)
    // Day change for things priced off a live market (gold, silver, crypto).
    const key =
      x.meta.kind === 'CRYPTO'
        ? `CRYPTO:${x.meta.symbol}`
        : x.meta.kind === 'METAL'
          ? x.meta.metal === 'GOLD'
            ? 'XAU'
            : 'XAG'
          : x.meta.kind === 'SGB'
            ? 'XAU'
            : null
    const mp = key ? prev.get(key) : undefined
    const dayChange = value !== null && mp?.prevClose && mp.price ? value * (1 - mp.prevClose / mp.price) : null
    const lastEntry = x.entries[x.entries.length - 1]
    rows.push({
      personId: x.account.personId,
      personName: persons.get(x.account.personId) ?? '',
      accountId: x.account.id,
      accountName: x.account.name,
      platform: x.account.platform,
      instrumentId: x.instrumentId,
      instrumentName: x.meta.name,
      isin: x.meta.kind === 'BOND' ? (x.meta.isin ?? null) : null,
      symbol: x.meta.kind === 'CRYPTO' ? x.meta.symbol : null,
      assetClass: CLASS_BY_KIND[x.meta.kind],
      currency: 'INR',
      quantity: qty,
      avgCost: invested !== null ? invested / qty : null,
      invested,
      lastPrice: value !== null ? value / qty : null,
      priceDate: source === 'MANUAL' && lastEntry ? lastEntry.date : today,
      marketValue: value,
      unrealizedPnl: value !== null && invested !== null ? value - invested : null,
      realizedPnl: 0,
      dividends: 0,
      tradesQuantity: null,
      prevClose: mp?.prevClose && value !== null ? (value / qty) * (mp.prevClose / mp.price) : null,
      dayChange,
      priceSource: source,
      sector: null,
      fxRate: 1,
      marketValueInr: value,
      investedInr: invested,
      unrealizedPnlInr: value !== null && invested !== null ? value - invested : null,
      dayChangeInr: dayChange,
      costSource: invested !== null ? 'MANUAL' : null
    })
  }
  return rows
}
