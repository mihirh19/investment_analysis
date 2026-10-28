import { sql } from 'drizzle-orm'
import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AccountKind, AssetClass, ImportKind, Platform, Relation, TxnType } from '@shared/types'
import type { CropKey, FarmCostKind, FarmEntryType, FarmSeasonKind, FarmStatus } from '@shared/farm'

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
    /** First bought on (INDmoney's "Holding Since", or typed in); dates the tax lot. */
    heldSince: text('held_since'),
    /** Units held over a year as of asOf (Zerodha's "Quantity Long Term"). */
    longTermQty: real('long_term_qty'),
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

/**
 * Daily closes for about the last 13 months, for volatility, drawdown and beta. Same keys as
 * price_history ("I:<instrumentId>", "BM:<benchmark>"). Older rows are pruned on each refresh.
 */
export const priceDaily = sqliteTable(
  'price_daily',
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

// ---------------- life admin: vehicles and documents ----------------

/** A car, bike or other vehicle. Details, insurance, PUC and running costs live in meta_json. */
export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  metaJson: text('meta_json').notNull(),
  createdAt: createdAt()
})

/** Files kept inside the encrypted database: RC, insurance policies, PUC certificates and the like. */
export const documents = sqliteTable(
  'documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** What it belongs to, e.g. VEHICLE 3. */
    ownerType: text('owner_type').$type<'VEHICLE' | 'PROPERTY' | 'PERSON'>().notNull(),
    ownerId: integer('owner_id').notNull(),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    createdAt: createdAt()
  },
  (t) => [index('documents_owner').on(t.ownerType, t.ownerId)]
)

// ---------------- spending: cards and bank accounts, read from statements ----------------

export const spendAccounts = sqliteTable('spend_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  kind: text('kind').$type<'CREDIT_CARD' | 'BANK_ACCOUNT'>().notNull(),
  institution: text('institution').notNull(),
  name: text('name').notNull(),
  last4: text('last4'),
  createdAt: createdAt()
})

export const statements = sqliteTable(
  'statements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => spendAccounts.id),
    periodFrom: text('period_from'),
    periodTo: text('period_to'),
    statementDate: text('statement_date'),
    dueDate: text('due_date'),
    totalDue: real('total_due'),
    minimumDue: real('minimum_due'),
    creditLimit: real('credit_limit'),
    openingBalance: real('opening_balance'),
    closingBalance: real('closing_balance'),
    rewardPoints: real('reward_points'),
    /** File name, or "gmail:<message id>". */
    source: text('source').notNull(),
    /** Same statement read twice is skipped. */
    fingerprint: text('fingerprint').notNull(),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex('statements_fingerprint').on(t.fingerprint)]
)

export const spendTxns = sqliteTable(
  'spend_txns',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => spendAccounts.id),
    statementId: integer('statement_id')
      .notNull()
      .references(() => statements.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    description: text('description').notNull(),
    merchant: text('merchant'),
    /** Positive: money out. Negative: money in. */
    amount: real('amount').notNull(),
    category: text('category').notNull(),
    edited: integer('edited', { mode: 'boolean' }).notNull().default(false),
    isEmi: integer('is_emi', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [index('spend_txns_account_date').on(t.accountId, t.date)]
)

// ---------------- the farm: seasons, their costs, harvests and sales ----------------

export const farmSeasons = sqliteTable('farm_seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  crop: text('crop').$type<CropKey>().notNull(),
  /** e.g. G20, Bold, Lokwan; prices are taken for it when the mandi reports it. */
  variety: text('variety'),
  /** The class the mandi sells it as (groundnut: Jini or Jadi), when its own variety isn't quoted. */
  priceClass: text('price_class'),
  season: text('season').$type<FarmSeasonKind>().notNull(),
  year: integer('year').notNull(),
  field: text('field'),
  areaAcres: real('area_acres'),
  sownOn: text('sown_on'),
  expectedQtl: real('expected_qtl'),
  status: text('status').$type<FarmStatus>().notNull(),
  market: text('market'),
  note: text('note'),
  createdAt: createdAt()
})

export const farmEntries = sqliteTable(
  'farm_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => farmSeasons.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    type: text('type').$type<FarmEntryType>().notNull(),
    costKind: text('cost_kind').$type<FarmCostKind>(),
    quantityQtl: real('quantity_qtl'),
    rate: real('rate'),
    amount: real('amount').notNull().default(0),
    charges: real('charges'),
    mandi: text('mandi'),
    note: text('note'),
    createdAt: createdAt()
  },
  (t) => [index('farm_entries_season').on(t.seasonId)]
)

// ---------------- loans: what the family owes ----------------

export const loans = sqliteTable('loans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  /** LoanMeta as JSON. */
  metaJson: text('meta_json').notNull(),
  /** LoanPayment[] as JSON: recorded EMIs, prepayments, KCC drawings and repayments. */
  paymentsJson: text('payments_json').notNull().default('[]'),
  createdAt: createdAt()
})

// ---------------- research desk: listed companies ----------------

/** NSE's end-of-day figures for every listed stock: the latest day only. */
export const researchQuotes = sqliteTable('research_quotes', {
  symbol: text('symbol').primaryKey(),
  date: text('date').notNull(),
  open: real('open'),
  high: real('high'),
  low: real('low'),
  close: real('close').notNull(),
  prevClose: real('prev_close'),
  high52: real('high_52'),
  low52: real('low_52'),
  volume: real('volume'),
  mcap: real('mcap'),
  pe: real('pe')
})

/** Each company's results filings: listed first (PENDING), then read from NSE's XBRL file (DONE). */
export const researchFilings = sqliteTable(
  'research_filings',
  {
    symbol: text('symbol').notNull(),
    periodEnd: text('period_end').notNull(),
    basis: text('basis').$type<'C' | 'S'>().notNull(),
    url: text('url').notNull(),
    filedAt: text('filed_at'),
    status: text('status').$type<'PENDING' | 'DONE' | 'FAILED'>().notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    /** Filing (from @shared/research) as JSON, once read. */
    dataJson: text('data_json')
  },
  (t) => [primaryKey({ columns: [t.symbol, t.periodEnd, t.basis] }), index('research_filings_status').on(t.status)]
)

/** When each company's list of filings was last fetched from NSE. */
export const researchCompanies = sqliteTable('research_companies', {
  symbol: text('symbol').primaryKey(),
  checkedAt: text('checked_at'),
  error: text('error')
})

/** Each company's screener figures (Fundamentals as JSON), redone when its filings change. */
export const researchFundamentals = sqliteTable('research_fundamentals', {
  symbol: text('symbol').primaryKey(),
  /** Filings read when these were worked out; a different count means they are out of date. */
  filings: integer('filings').notNull(),
  dataJson: text('data_json').notNull()
})

/** NSE index levels from the day's file (Nifty 50, Nifty Bank, …): the latest day only. */
export const researchIndices = sqliteTable('research_indices', {
  name: text('name').primaryKey(),
  date: text('date').notNull(),
  close: real('close').notNull(),
  prevClose: real('prev_close'),
  high52: real('high_52'),
  low52: real('low_52')
})

/** World map: yearly (World Bank) or latest (BIS, OECD, Yahoo) figures per country. */
export const worldFigures = sqliteTable(
  'world_figures',
  {
    metric: text('metric').notNull(),
    iso3: text('iso3').notNull(),
    period: text('period').notNull(),
    value: real('value').notNull()
  },
  (t) => [primaryKey({ columns: [t.metric, t.iso3, t.period] })]
)

/** India's trade with each partner from UN Comtrade, by good (HS code) and year. */
export const worldTrade = sqliteTable(
  'world_trade',
  {
    partner: text('partner').notNull(),
    partnerName: text('partner_name').notNull(),
    flow: text('flow').$type<'X' | 'M'>().notNull(),
    cmd: text('cmd').notNull(),
    period: text('period').notNull(),
    value: real('value').notNull(),
    weight: real('weight')
  },
  (t) => [primaryKey({ columns: [t.partner, t.flow, t.cmd, t.period] })]
)

/** Shipping chokepoints and ports from IMF PortWatch's reference lists. */
export const worldPlaces = sqliteTable('world_places', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'chokepoint' | 'port'>().notNull(),
  name: text('name').notNull(),
  iso3: text('iso3'),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  locode: text('locode'),
  vessels: real('vessels')
})

/** Daily vessel counts through each chokepoint, and calls and cargo at India's ports (IMF PortWatch). */
export const worldTraffic = sqliteTable(
  'world_traffic',
  {
    id: text('id').notNull(),
    date: text('date').notNull(),
    total: integer('total').notNull(),
    tanker: integer('tanker').notNull(),
    container: integer('container').notNull(),
    dryBulk: integer('dry_bulk').notNull(),
    imports: real('imports'),
    exports: real('exports')
  },
  (t) => [primaryKey({ columns: [t.id, t.date] })]
)

/** Recent earthquakes and disasters (USGS, GDACS); replaced on each fetch. */
export const worldEvents = sqliteTable('world_events', {
  id: text('id').primaryKey(),
  dataJson: text('data_json').notNull()
})

/** Weekly freight index readings (the SCFI). */
export const worldFreight = sqliteTable(
  'world_freight',
  {
    name: text('name').notNull(),
    date: text('date').notNull(),
    value: real('value').notNull()
  },
  (t) => [primaryKey({ columns: [t.name, t.date] })]
)

/** Daily prices for every listed stock from NSE's delivery file (as printed: not adjusted). */
export const researchBars = sqliteTable(
  'research_bars',
  {
    symbol: text('symbol').notNull(),
    date: text('date').notNull(),
    open: real('open'),
    high: real('high'),
    low: real('low'),
    close: real('close').notNull(),
    prevClose: real('prev_close'),
    volume: real('volume'),
    delivPct: real('deliv_pct')
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] }), index('research_bars_date').on(t.date)]
)

/** Which trading days' files have been read (or found missing: holidays). */
export const researchBarDays = sqliteTable('research_bar_days', {
  date: text('date').primaryKey(),
  status: text('status').$type<'DONE' | 'NONE'>().notNull(),
  rows: integer('rows').notNull().default(0)
})

/** Each stock's price-based figures (Technicals as JSON) for the latest day. */
export const researchTechnicals = sqliteTable('research_technicals', {
  symbol: text('symbol').primaryKey(),
  date: text('date').notNull(),
  dataJson: text('data_json').notNull()
})

/** The family's watchlists and per-company notes. */
export const watchlists = sqliteTable('watchlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Symbols in the order shown, as JSON. */
  symbolsJson: text('symbols_json').notNull().default('[]'),
  sort: integer('sort').notNull().default(0)
})

export const companyNotes = sqliteTable('company_notes', {
  symbol: text('symbol').primaryKey(),
  text: text('text').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ---------------- money flows: FII/DII, F&O positions, FPI, mutual funds, big deals ----------------

export const flowCash = sqliteTable(
  'flow_cash',
  {
    date: text('date').notNull(),
    category: text('category').$type<'FII' | 'DII'>().notNull(),
    buy: real('buy').notNull(),
    sell: real('sell').notNull(),
    net: real('net').notNull()
  },
  (t) => [primaryKey({ columns: [t.date, t.category] })]
)

/** Open F&O contracts by type of trader (FoPosition as JSON). */
export const flowFo = sqliteTable(
  'flow_fo',
  {
    date: text('date').notNull(),
    client: text('client').notNull(),
    dataJson: text('data_json').notNull()
  },
  (t) => [primaryKey({ columns: [t.date, t.client] })]
)

export const flowFpi = sqliteTable('flow_fpi', {
  month: text('month').primaryKey(),
  equity: real('equity').notNull(),
  debt: real('debt').notNull(),
  hybrid: real('hybrid').notNull(),
  mutualFunds: real('mutual_funds').notNull(),
  aif: real('aif').notNull(),
  total: real('total').notNull()
})

export const flowMf = sqliteTable(
  'flow_mf',
  {
    month: text('month').notNull(),
    category: text('category').notNull(),
    grp: text('grp').notNull(),
    schemes: integer('schemes').notNull(),
    folios: integer('folios').notNull(),
    raised: real('raised').notNull(),
    redeemed: real('redeemed').notNull(),
    net: real('net').notNull(),
    aum: real('aum')
  },
  (t) => [primaryKey({ columns: [t.month, t.grp, t.category] })]
)

export const flowDeals = sqliteTable(
  'flow_deals',
  {
    date: text('date').notNull(),
    kind: text('kind').$type<'BULK' | 'BLOCK'>().notNull(),
    symbol: text('symbol').notNull(),
    company: text('company').notNull(),
    client: text('client').notNull(),
    side: text('side').$type<'BUY' | 'SELL'>().notNull(),
    qty: real('qty').notNull(),
    price: real('price').notNull()
  },
  (t) => [primaryKey({ columns: [t.date, t.kind, t.symbol, t.client, t.side, t.qty, t.price] }), index('flow_deals_symbol').on(t.symbol)]
)

export const flowStakes = sqliteTable(
  'flow_stakes',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    symbol: text('symbol').notNull(),
    company: text('company').notNull(),
    party: text('party').notNull(),
    side: text('side').$type<'BUY' | 'SELL'>().notNull(),
    shares: real('shares'),
    changePct: real('change_pct'),
    afterPct: real('after_pct'),
    mode: text('mode'),
    promoter: integer('promoter', { mode: 'boolean' }).notNull()
  },
  (t) => [index('flow_stakes_date').on(t.date)]
)

/** Which files or periods have been fetched (or found missing), so none is asked for twice. */
export const flowFetched = sqliteTable('flow_fetched', {
  key: text('key').primaryKey(),
  status: text('status').$type<'DONE' | 'NONE'>().notNull(),
  at: text('at').notNull()
})

/** Board meetings coming up (results days), from NSE's event calendar. */
export const researchEvents = sqliteTable(
  'research_events',
  {
    symbol: text('symbol').notNull(),
    date: text('date').notNull(),
    purpose: text('purpose').notNull(),
    company: text('company').notNull(),
    details: text('details').notNull()
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date, t.purpose] }), index('research_events_date').on(t.date)]
)

/** Dividends, bonuses, splits, rights and buybacks, from NSE's corporate actions. */
export const researchActions = sqliteTable(
  'research_actions',
  {
    symbol: text('symbol').notNull(),
    exDate: text('ex_date').notNull(),
    subject: text('subject').notNull(),
    recordDate: text('record_date'),
    kind: text('kind').notNull(),
    amount: real('amount')
  },
  (t) => [primaryKey({ columns: [t.symbol, t.exDate, t.subject] }), index('research_actions_ex').on(t.exDate)]
)

/** Quarterly shareholding patterns from NSE: promoters' share for every filing, the full split once its XBRL is read. */
export const researchShp = sqliteTable(
  'research_shp',
  {
    symbol: text('symbol').notNull(),
    asOf: text('as_of').notNull(),
    promoter: real('promoter'),
    url: text('url'),
    filedAt: text('filed_at'),
    /** Groups, shareholder count and named holders, as JSON, once the XBRL has been read. */
    detailJson: text('detail_json'),
    attempts: integer('attempts').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.symbol, t.asOf] }), index('research_shp_filed').on(t.filedAt)]
)

/** When each company's full shareholding history was last asked for. */
export const researchShpChecked = sqliteTable('research_shp_checked', {
  symbol: text('symbol').primaryKey(),
  at: text('at').notNull()
})

/** NSE's four-level classification of every listed company (macro, sector, industry, basic industry). */
export const researchIndustry = sqliteTable('research_industry', {
  symbol: text('symbol').primaryKey(),
  macro: text('macro'),
  sector: text('sector'),
  industry: text('industry'),
  basicIndustry: text('basic_industry'),
  /** The sector index NSE compares the stock with, and the two P/Es it shows. */
  sectorIndex: text('sector_index'),
  sectorPe: real('sector_pe'),
  symbolPe: real('symbol_pe'),
  indicesJson: text('indices_json'),
  listedOn: text('listed_on'),
  checkedAt: text('checked_at').notNull()
})

/** Corporate announcements from NSE, kept for 60 days. */
export const researchAnnouncements = sqliteTable(
  'research_announcements',
  {
    id: text('id').primaryKey(),
    symbol: text('symbol').notNull(),
    company: text('company').notNull(),
    at: text('at').notNull(),
    category: text('category').notNull(),
    tag: text('tag').notNull(),
    text: text('text').notNull(),
    url: text('url')
  },
  (t) => [index('research_ann_symbol').on(t.symbol, t.at), index('research_ann_at').on(t.at)]
)

/** Price alerts the person sets. */
export const alertRules = sqliteTable('alert_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  kind: text('kind').notNull(),
  value: real('value').notNull(),
  note: text('note'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  firedAt: text('fired_at'),
  createdAt: text('created_at').notNull()
})

/** Alerts that fired, each once (the key says what it was about). */
export const alertEvents = sqliteTable(
  'alert_events',
  {
    key: text('key').primaryKey(),
    at: text('at').notNull(),
    kind: text('kind').notNull(),
    symbol: text('symbol'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    read: integer('read', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [index('alert_events_at').on(t.at)]
)

/** Government support for farming: PM-KISAN instalments, crop insurance or crop-loss claims, subsidies. */
export const farmSupport = sqliteTable('farm_support', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id')
    .notNull()
    .references(() => persons.id),
  scheme: text('scheme').notNull(),
  date: text('date').notNull(),
  amount: real('amount').notNull(),
  note: text('note')
})

/** The fund screener's figures for one fund (an AMFI scheme code): ratios from its NAVs, and month-end NAVs for its chart. */
export const fundStats = sqliteTable('fund_stats', {
  code: text('code').primaryKey(),
  metricsJson: text('metrics_json'),
  monthsJson: text('months_json').notNull(),
  indexSymbol: text('index_symbol'),
  computedAt: text('computed_at').notNull(),
  error: text('error')
})
