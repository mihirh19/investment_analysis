import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import Database from 'better-sqlite3'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DisclosureStatus, ManualAssetInput, MetalPrices } from '@shared/assets'
import type {
  Account,
  BenchmarkSeries,
  FxInfo,
  ImportBatch,
  ImportRequest,
  ImportResult,
  ManualTxnInput,
  MarketStatus,
  Person,
  PricePoint,
  Transaction
} from '@shared/types'
import { PLATFORM_LABELS } from '@shared/types'
import * as assets from './assets'
import * as manual from './manualAssets'
import { historyFor } from './market/extra'
import { BENCHMARKS, seriesFor } from './market/benchmarks'
import { computePerformance } from './portfolio/performance'
import { computeTax } from './portfolio/tax'
import { computeFunds } from './portfolio/fundInsights'
import { fillSchemeNames, getDisclosureStatus, syncDisclosures } from './market/disclosures'
import { computeAnalysis } from './portfolio/analysis'
import { schema, type Db } from './db'
import { importAmcPortfolio } from './importers/amcPortfolio'
import { importBrokerHoldings, setManualCost } from './importers/brokerHoldings'
import { reclassifyDemat } from './importers/isin'
import { persistBundle, rowHash, type ImportBundle } from './importers/bundle'
import { CasHelperError, mapCasJson, runCasparser } from './importers/cas'
import {
  GENERIC_HEADERS,
  GROWW_HEADERS,
  ZERODHA_HEADERS,
  mapGenericTrades,
  mapGrowwOrders,
  mapZerodhaTradebook,
  readTableFile
} from './importers/trades'
import { mfapiHistory, npsHistory, npsSchemes } from './market/funds'
import type { FetchFn } from './market/http'
import { yahooHistory } from './market/yahoo'
import { listDividends } from './portfolio/dividends'
import { computeExposure } from './portfolio/exposure'
import { listHoldings } from './portfolio/holdings'

export interface ServiceDeps {
  db: Db
  casparserExe: string
  encrypt(plain: string): string
  decrypt(stored: string): string
  /** Background market data; absent in tests. */
  market?: {
    getStatus(): MarketStatus
    refresh(what?: { full?: boolean; quotes?: boolean; funds?: boolean; meta?: boolean }): Promise<void>
    syncDisclosures?(force?: boolean): Promise<void>
  }
  /** The database's encryption key, shown to the user as the recovery key. */
  dbKey?: string
  /** Swaps in a verified backup and restarts the app (Electron-specific). */
  replaceDatabase?(filePath: string, key: string): void
  fetch?: FetchFn
}

const RANGE_DAYS = { '1mo': 31, '6mo': 183, '1y': 366, '5y': 1827 } as const

const casPasswordKey = (personId: number) => `cas_password:${personId}`

export function createServices(deps: ServiceDeps) {
  const { db } = deps
  // Statements read by older versions recorded bonds and REIT units as shares.
  reclassifyDemat(db)

  function getSetting(key: string): string | null {
    return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
  }
  function setSetting(key: string, value: string): void {
    db.insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }

  return {
    listPersons(): Person[] {
      return db
        .select({ id: schema.persons.id, name: schema.persons.name, relation: schema.persons.relation })
        .from(schema.persons)
        .all()
    },

    savePerson(p: Omit<Person, 'id'> & { id?: number }): Person {
      const name = p.name.trim()
      if (!name) throw new Error('Name is required')
      if (p.id) {
        db.update(schema.persons).set({ name, relation: p.relation }).where(eq(schema.persons.id, p.id)).run()
        return { id: p.id, name, relation: p.relation }
      }
      const row = db.insert(schema.persons).values({ name, relation: p.relation }).returning().get()
      return { id: row.id, name: row.name, relation: row.relation }
    },

    listAccounts(): Account[] {
      return db
        .select({
          id: schema.accounts.id,
          personId: schema.accounts.personId,
          platform: schema.accounts.platform,
          kind: schema.accounts.kind,
          name: schema.accounts.name,
          externalId: schema.accounts.externalId,
          currency: schema.accounts.currency
        })
        .from(schema.accounts)
        .all()
    },

    listHoldings: (personId?: number) => listHoldings(db, personId),

    listTransactions(filter: { personId?: number; accountId?: number; limit?: number }) {
      const t = schema.transactions
      return db
        .select({
          id: t.id,
          accountId: t.accountId,
          instrumentId: t.instrumentId,
          date: t.date,
          type: t.type,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          fees: t.fees,
          currency: t.currency,
          description: t.description,
          source: t.source,
          instrumentName: schema.instruments.name,
          accountName: schema.accounts.name
        })
        .from(t)
        .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
        .innerJoin(schema.instruments, eq(schema.instruments.id, t.instrumentId))
        .where(
          and(
            filter.personId ? eq(schema.accounts.personId, filter.personId) : undefined,
            filter.accountId ? eq(t.accountId, filter.accountId) : undefined
          )
        )
        .orderBy(desc(t.date), desc(t.id))
        .limit(filter.limit ?? 500)
        .all() satisfies (Transaction & { instrumentName: string; accountName: string })[]
    },

    addManualTransaction(input: ManualTxnInput): number {
      if (!input.symbol.trim() || !input.date) throw new Error('Symbol and date are required')
      if (input.type !== 'DIVIDEND' && !(input.quantity > 0)) throw new Error('Quantity must be positive')
      if (!(input.price >= 0)) throw new Error('Price must be zero or more')
      const isUs = input.assetClass === 'EQUITY_US'
      const symbol = input.symbol.trim().toUpperCase()
      const q = Math.abs(input.quantity)
      const bundle: ImportBundle = {
        accounts: [
          {
            key: 'A',
            platform: input.platform,
            kind: isUs ? 'US_BROKER' : 'DEMAT',
            name: `${PLATFORM_LABELS[input.platform]} ${isUs ? 'US stocks' : 'demat'}`,
            externalId: null,
            currency: input.currency
          }
        ],
        instruments: [
          {
            key: 'I',
            isin: input.isin?.trim().toUpperCase() || null,
            name: input.name.trim() || symbol,
            assetClass: input.assetClass,
            symbolNse: isUs ? null : symbol,
            tickerUs: isUs ? symbol : null,
            currency: input.currency
          }
        ],
        transactions: [
          {
            accountKey: 'A',
            instrumentKey: 'I',
            date: input.date,
            type: input.type,
            quantity: input.type === 'BUY' ? q : input.type === 'SELL' ? -q : 0,
            price: input.type === 'DIVIDEND' ? null : input.price,
            amount: input.type === 'BUY' ? -q * input.price : input.type === 'SELL' ? q * input.price : input.price,
            fees: input.fees ?? 0,
            currency: input.currency,
            description: 'Manual entry',
            source: 'MANUAL',
            externalId: rowHash('manual', Date.now(), Math.random())
          }
        ],
        snapshots: [],
        warnings: []
      }
      return persistBundle(db, { personId: input.personId, kind: 'MANUAL', fileName: 'Manual entry', bundle }).batchId
    },

    deleteTransaction(id: number): null {
      db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run()
      return null
    },

    hasSavedCasPassword(personId: number): boolean {
      return getSetting(casPasswordKey(personId)) !== null
    },

    async runImport(req: ImportRequest): Promise<ImportResult> {
      const fileName = basename(req.filePath)
      let bundle: ImportBundle

      switch (req.kind) {
        case 'CAS_PDF': {
          let password = req.password ?? ''
          if (!password) {
            const saved = getSetting(casPasswordKey(req.personId))
            if (saved) password = deps.decrypt(saved)
          }
          if (!password)
            throw new Error(
              'Enter the PDF password (usually your PAN in capitals, or the one you set when requesting the CAS)'
            )
          try {
            bundle = mapCasJson(await runCasparser(deps.casparserExe, req.filePath, password))
          } catch (e) {
            if (e instanceof CasHelperError && e.code === 'wrong_password') throw new Error('Wrong PDF password')
            throw e
          }
          if (req.password && req.rememberPassword) setSetting(casPasswordKey(req.personId), deps.encrypt(req.password))
          break
        }
        case 'ZERODHA_TRADEBOOK':
          bundle = mapZerodhaTradebook(readTableFile(req.filePath, ZERODHA_HEADERS).rows)
          break
        case 'GROWW_ORDERS':
          bundle = mapGrowwOrders(readTableFile(req.filePath, GROWW_HEADERS).rows)
          break
        case 'GENERIC_TRADES':
          bundle = mapGenericTrades(readTableFile(req.filePath, GENERIC_HEADERS).rows, req.platform ?? 'OTHER')
          break
        case 'FUND_PORTFOLIO': {
          const heldFundIds = [
            ...new Set(
              listHoldings(db)
                .filter((h) => h.assetClass === 'MF' || h.assetClass === 'ETF')
                .map((h) => h.instrumentId)
            )
          ]
          // Renamed schemes are matched by their current name; look it up if the refresh hasn't yet.
          await fillSchemeNames(db, heldFundIds, deps.fetch)
          return importAmcPortfolio(db, {
            personId: req.personId,
            fileName,
            data: readFileSync(req.filePath),
            heldFundIds
          })
        }
        case 'BROKER_HOLDINGS':
          return importBrokerHoldings(db, { personId: req.personId, fileName, data: readFileSync(req.filePath) })
        case 'MANUAL':
          throw new Error('Manual entries are added from their own screens, not imported')
      }

      if (bundle.transactions.length === 0 && bundle.snapshots.length === 0) {
        throw new Error(['Nothing to import was found in this file.', ...bundle.warnings.slice(0, 5)].join(' '))
      }
      return persistBundle(db, { personId: req.personId, kind: req.kind, fileName, bundle })
    },

    listImports(): ImportBatch[] {
      const b = schema.importBatches
      return db
        .select({
          id: b.id,
          kind: b.kind,
          fileName: b.fileName,
          personId: b.personId,
          personName: schema.persons.name,
          importedAt: b.importedAt,
          summaryJson: b.summaryJson
        })
        .from(b)
        .innerJoin(schema.persons, eq(schema.persons.id, b.personId))
        .orderBy(desc(b.id))
        .all()
        .map(({ summaryJson, ...rest }) => ({
          ...rest,
          summary: summaryJson ? (JSON.parse(summaryJson) as ImportResult) : null
        }))
    },

    undoImport(batchId: number): null {
      db.transaction((tx) => {
        tx.delete(schema.transactions).where(eq(schema.transactions.importBatchId, batchId)).run()
        tx.delete(schema.holdingSnapshots).where(eq(schema.holdingSnapshots.importBatchId, batchId)).run()
        tx.delete(schema.fundHoldings).where(eq(schema.fundHoldings.importBatchId, batchId)).run()
        tx.delete(schema.costBasis).where(eq(schema.costBasis.importBatchId, batchId)).run()
        tx.delete(schema.importBatches).where(eq(schema.importBatches.id, batchId)).run()
      })
      return null
    },

    // ---------------- market data ----------------

    getMarketStatus(): MarketStatus {
      if (!deps.market) throw new Error('Market data is not running')
      return deps.market.getStatus()
    },

    async refreshMarket(): Promise<MarketStatus> {
      if (!deps.market) throw new Error('Market data is not running')
      await deps.market.refresh({ full: true })
      return deps.market.getStatus()
    },

    getFx(): FxInfo {
      const r = db.select().from(schema.fxRates).where(eq(schema.fxRates.pair, 'USDINR')).get()
      return { usdInr: r?.rate ?? null, prevClose: r?.prevClose ?? null, asOf: r?.asOf ?? null }
    },

    async getPriceHistory(instrumentId: number, range: keyof typeof RANGE_DAYS): Promise<PricePoint[]> {
      const i = db.select().from(schema.instruments).where(eq(schema.instruments.id, instrumentId)).get()
      if (!i) throw new Error('Unknown holding')
      const since = new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10)
      if (i.assetClass === 'MF') {
        if (!i.amfiCode) throw new Error('No NAV history yet; it appears after the first price refresh')
        return mfapiHistory(i.amfiCode, since, deps.fetch)
      }
      if (i.assetClass === 'NPS') {
        if (!i.npsCode) throw new Error('No NAV history yet; it appears after the first price refresh')
        return (await npsHistory(i.npsCode, deps.fetch)).filter((p) => p.date >= since)
      }
      const symbol = i.yahooSymbol ?? (i.symbolNse ? `${i.symbolNse}.NS` : i.tickerUs)
      if (!symbol) throw new Error('No price history for this holding')
      return (await yahooHistory(symbol, range, deps.fetch)).prices
    },

    listDividends: (personId?: number) => listDividends(db, personId),
    getExposure: (personId?: number) => computeExposure(db, personId),

    // ---------------- EPF, insurance, NPS ----------------

    listEpf: () => assets.listEpf(db),
    saveEpf: (input: Parameters<typeof assets.saveEpf>[1]) => assets.saveEpf(db, input),
    addEpfEntry(accountId: number, date: string, balance: number): null {
      assets.addEpfEntry(db, accountId, date, balance)
      return null
    },
    deleteEpfEntry(accountId: number, date: string): null {
      assets.deleteEpfEntry(db, accountId, date)
      return null
    },
    listPolicies: () => assets.listPolicies(db),
    savePolicy: (input: Parameters<typeof assets.savePolicy>[1]) => assets.savePolicy(db, input),
    deletePolicy(accountId: number): null {
      assets.deletePolicy(db, accountId)
      return null
    },
    listNpsSchemes: () => npsSchemes(deps.fetch),
    async addNpsHolding(input: Parameters<typeof assets.addNpsHolding>[1]): Promise<null> {
      assets.addNpsHolding(db, input)
      await deps.market?.refresh({ full: true })
      return null
    },

    // ---------------- deposits, bonds, gold, property, crypto, cash, other ----------------

    listManualAssets: (personId?: number) => manual.manualAssetViews(db, personId),
    async saveManualAsset(input: ManualAssetInput): Promise<number> {
      const id = manual.saveManualAsset(db, input)
      // Gold, silver and coins need a live price straight away.
      if (['METAL', 'SGB', 'CRYPTO'].includes(input.meta.kind)) await deps.market?.refresh({ quotes: true })
      return id
    },
    deleteManualAsset(accountId: number): null {
      manual.deleteManualAsset(db, accountId)
      return null
    },
    addManualEntry(accountId: number, date: string, value: number): null {
      manual.addManualEntry(db, accountId, date, value)
      return null
    },
    deleteManualEntry(accountId: number, date: string): null {
      manual.deleteManualEntry(db, accountId, date)
      return null
    },
    getMetalPrices: () => manual.getMetalPrices(db),
    async setGoldPremium(pct: number): Promise<MetalPrices> {
      if (!(pct >= 0 && pct <= 30)) throw new Error('Enter a percentage between 0 and 30')
      setSetting(manual.GOLD_PREMIUM_KEY, String(pct))
      // Stored gold/silver prices include the premium, so recompute them (history too).
      db.delete(schema.priceHistory)
        .where(inArray(schema.priceHistory.key, ['XAU', 'XAG']))
        .run()
      await deps.market?.refresh({ quotes: true, meta: true })
      return manual.getMetalPrices(db)
    },
    getAnalysis: (personId?: number) => computeAnalysis(db, personId),
    getPerformance: (personId?: number) => computePerformance(db, personId),
    getTax: (personId?: number) => computeTax(db, personId),
    getFunds: (personId?: number) => computeFunds(db, personId),
    setBuyPrice(input: { personId: number; accountId: number; instrumentId: number; avgCost: number | null }): null {
      setManualCost(db, input)
      return null
    },

    getSparklines(instrumentIds: number[]): Record<number, number[]> {
      const since = new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10)
      const out: Record<number, number[]> = {}
      for (const id of instrumentIds.slice(0, 300)) {
        const pts = historyFor(db, `I:${id}`, since)
        if (pts.length >= 3) out[id] = pts.map((p) => p.close)
      }
      return out
    },

    listBenchmarks(since?: string): BenchmarkSeries[] {
      return BENCHMARKS.map((b) => ({
        key: b.key,
        label: b.label,
        totalReturn: b.totalReturn,
        points: seriesFor(db, b.key, { since })
      })).filter((b) => b.points.length > 0)
    },

    // ---------------- fund house disclosures ----------------

    getDisclosureStatus: () => getDisclosureStatus(db),
    async syncDisclosures(force = false): Promise<DisclosureStatus[]> {
      if (deps.market?.syncDisclosures) await deps.market.syncDisclosures(force)
      else await syncDisclosures(db, { fetch: deps.fetch }, force)
      return getDisclosureStatus(db)
    },

    // ---------------- backup ----------------

    getRecoveryKey(): string {
      if (!deps.dbKey) throw new Error('No recovery key available')
      return deps.dbKey
    },

    /** Writes an encrypted copy (same key) of the database to `filePath`. */
    backupTo(filePath: string): string {
      db.run(sql`VACUUM INTO ${filePath}`)
      return filePath
    },

    restoreDatabase(filePath: string, recoveryKey: string): null {
      const key = recoveryKey.trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('A recovery key is 64 characters of 0-9 and a-f')
      let check: Database.Database | null = null
      try {
        check = new Database(filePath, { readonly: true, fileMustExist: true })
        check.pragma(`hexkey='${key}'`)
        check.prepare('SELECT count(*) FROM persons').get()
      } catch {
        throw new Error('That key does not open this backup. Check the key and the file.')
      } finally {
        check?.close()
      }
      if (!deps.replaceDatabase) throw new Error('Restore is not available here')
      deps.replaceDatabase(filePath, key)
      return null
    }
  }
}

export type Services = ReturnType<typeof createServices>
