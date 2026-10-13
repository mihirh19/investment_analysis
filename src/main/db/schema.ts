import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AccountKind, AssetClass, ImportKind, Platform, Relation, TxnType } from '@shared/types'

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`)

export const persons = sqliteTable('persons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  relation: text('relation').$type<Relation>().notNull(),
  createdAt: createdAt()
})

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id),
    platform: text('platform').$type<Platform>().notNull(),
    kind: text('kind').$type<AccountKind>().notNull(),
    name: text('name').notNull(),
    // DP ID + client ID for demat, folio number for MF, PRAN for NPS, policy no. for insurance
    externalId: text('external_id'),
    currency: text('currency').notNull().default('INR'),
    // Kind-specific settings, e.g. EPF contribution/rate or insurance policy details (JSON)
    metaJson: text('meta_json'),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('accounts_person_platform_kind_ext').on(t.personId, t.platform, t.kind, t.externalId)]
)

export const instruments = sqliteTable(
  'instruments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    isin: text('isin'),
    name: text('name').notNull(),
    assetClass: text('asset_class').$type<AssetClass>().notNull(),
    symbolNse: text('symbol_nse'),
    symbolBse: text('symbol_bse'),
    tickerUs: text('ticker_us'),
    amfiCode: text('amfi_code'),
    mfType: text('mf_type'),
    sector: text('sector'),
    industry: text('industry'),
    currency: text('currency').notNull().default('INR'),
    // Resolved market-data identifiers, cached after the first successful lookup
    yahooSymbol: text('yahoo_symbol'),
    npsCode: text('nps_code'),
    mfCategory: text('mf_category'),
    /** Fund house (AMFI name) for funds and ETFs, used to find its monthly portfolio disclosure. */
    fundHouse: text('fund_house'),
    /** The scheme's current name in AMFI's NAV file (statements can carry an older name). */
    schemeName: text('scheme_name'),
    metaUpdatedAt: text('meta_updated_at'),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('instruments_isin').on(t.isin),
    index('instruments_symbol_nse').on(t.symbolNse),
    index('instruments_ticker_us').on(t.tickerUs)
  ]
)

export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').$type<ImportKind>().notNull(),
  fileName: text('file_name').notNull(),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  importedAt: text('imported_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  summaryJson: text('summary_json')
})

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),
    date: text('date').notNull(),
    type: text('type').$type<TxnType>().notNull(),
    quantity: real('quantity').notNull().default(0),
    price: real('price'),
    amount: real('amount').notNull().default(0),
    fees: real('fees').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    description: text('description'),
    source: text('source').notNull(),
    // Stable key from the source (trade id, or a hash of the CAS row) used to skip duplicates on re-import
    externalId: text('external_id'),
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' }),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('transactions_dedupe').on(t.accountId, t.source, t.externalId),
    index('transactions_account_instrument').on(t.accountId, t.instrumentId, t.date)
  ]
)

/** Holdings exactly as printed in a statement (CAS), used for valuation and reconciliation. */
export const holdingSnapshots = sqliteTable(
  'holding_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),
    date: text('date').notNull(),
    quantity: real('quantity').notNull(),
    price: real('price'),
    value: real('value'),
    cost: real('cost'),
    source: text('source').notNull(),
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' })
  },
  (t) => [uniqueIndex('snapshots_unique').on(t.accountId, t.instrumentId, t.date, t.source)]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

// ---------------- market data (refreshed from free public sources) ----------------

/** Latest known price per instrument. */
export const quotes = sqliteTable('quotes', {
  instrumentId: integer('instrument_id')
    .primaryKey()
    .references(() => instruments.id, { onDelete: 'cascade' }),
  price: real('price').notNull(),
  prevClose: real('prev_close'),
  currency: text('currency').notNull(),
  asOf: text('as_of').notNull(), // when the price was set by the market (ISO)
  source: text('source').notNull(),
  fetchedAt: text('fetched_at').notNull()
})

export const fxRates = sqliteTable('fx_rates', {
  pair: text('pair').primaryKey(), // e.g. USDINR
  rate: real('rate').notNull(),
  prevClose: real('prev_close'),
  asOf: text('as_of').notNull(),
  fetchedAt: text('fetched_at').notNull()
})

export const fxHistory = sqliteTable(
  'fx_history',
  {
    pair: text('pair').notNull(),
    date: text('date').notNull(),
    rate: real('rate').notNull()
  },
  (t) => [primaryKey({ columns: [t.pair, t.date] })]
)

/** Per-share dividends by ex-date, as published by the market data source. */
export const dividends = sqliteTable(
  'dividends',
  {
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    exDate: text('ex_date').notNull(),
    amount: real('amount').notNull(),
    currency: text('currency').notNull(),
    source: text('source').notNull()
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.exDate] })]
)

/** ISIN → NSE industry for listed Indian companies (from NSE's index constituent lists). */
export const sectorMap = sqliteTable('sector_map', {
  isin: text('isin').primaryKey(),
  symbol: text('symbol'),
  name: text('name'),
  industry: text('industry').notNull(),
  source: text('source').notNull(),
  updatedAt: text('updated_at').notNull()
})

/**
 * Average buy price for a holding whose statement carries none (NSDL/CDSL statements give units
 * and value only): from a broker's holdings download, or typed in by the user. accountId 0 means
 * "any account of this person" (the file did not say which demat account).
 */
export const costBasis = sqliteTable(
  'cost_basis',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: integer('person_id')
      .notNull()
      .references(() => persons.id),
    accountId: integer('account_id').notNull().default(0),
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),
    avgCost: real('avg_cost').notNull(),
    /** Units the price was given for, when known. */
    quantity: real('quantity'),
    asOf: text('as_of').notNull(),
    source: text('source').$type<'BROKER' | 'MANUAL'>().notNull(),
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' })
  },
  (t) => [uniqueIndex('cost_basis_unique').on(t.personId, t.accountId, t.instrumentId, t.source)]
)

/** SEBI market-cap band of every listed Indian company, from AMFI's half-yearly list. */
export const marketCaps = sqliteTable('market_caps', {
  isin: text('isin').primaryKey(),
  name: text('name').notNull(),
  /** LARGE (ranks 1–100), MID (101–250) or SMALL (251 onwards). */
  category: text('category').$type<'LARGE' | 'MID' | 'SMALL'>().notNull(),
  rank: integer('rank'),
  /** Six-month average market capitalisation, ₹ crore. */
  avgCapCr: real('avg_cap_cr'),
  /** The half-year the list is for, e.g. 2026-06-30. */
  period: text('period').notNull(),
  updatedAt: text('updated_at').notNull()
})

/** What a fund or ETF holds, from an AMC portfolio disclosure or the market data source. */
export const fundHoldings = sqliteTable(
  'fund_holdings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fundInstrumentId: integer('fund_instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    asOf: text('as_of').notNull(),
    source: text('source').notNull(),
    name: text('name').notNull(),
    isin: text('isin'),
    sector: text('sector'),
    industryRaw: text('industry_raw'),
    assetType: text('asset_type').$type<'EQUITY' | 'DEBT' | 'CASH' | 'OTHER'>().notNull(),
    country: text('country'),
    weight: real('weight').notNull(), // fraction of the fund, 0..1
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' })
  },
  (t) => [index('fund_holdings_fund').on(t.fundInstrumentId, t.asOf)]
)

/** Live prices that are not tied to one instrument: gold/silver (INR per gram, pure) and crypto (INR per coin). */
export const marketPrices = sqliteTable('market_prices', {
  key: text('key').primaryKey(), // XAU, XAG, CRYPTO:BTC
  price: real('price').notNull(),
  prevClose: real('prev_close'),
  asOf: text('as_of').notNull(),
  source: text('source').notNull(),
  fetchedAt: text('fetched_at').notNull()
})

/**
 * Weekly closing prices for the net-worth-over-time chart and sparklines. Keyed by "I:<instrumentId>"
 * for holdings, "XAU"/"XAG" for metals (INR per gram) and "CRYPTO:<SYM>" for coins (INR).
 */
export const priceHistory = sqliteTable(
  'price_history',
  {
    key: text('key').notNull(),
    date: text('date').notNull(),
    close: real('close').notNull()
  },
  (t) => [primaryKey({ columns: [t.key, t.date] })]
)

/** Every NSE-listed stock and ETF by ISIN (from NSE's EQUITY_L and ETF lists), refreshed weekly. */
export const nseListings = sqliteTable('nse_listings', {
  isin: text('isin').primaryKey(),
  symbol: text('symbol').notNull(),
  name: text('name'),
  kind: text('kind').$type<'EQ' | 'ETF'>().notNull(),
  updatedAt: text('updated_at').notNull()
})
