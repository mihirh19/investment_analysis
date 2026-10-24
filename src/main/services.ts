import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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
  NpsAccountInput,
  Person,
  PricePoint,
  Targets,
  Theme,
  Transaction
} from '@shared/types'
import { PLATFORM_LABELS, type ImportKind } from '@shared/types'
import * as assets from './assets'
import * as manual from './manualAssets'
import { historyFor } from './market/extra'
import { BENCHMARKS, seriesFor } from './market/benchmarks'
import { computePerformance } from './portfolio/performance'
import { computeTax } from './portfolio/tax'
import { computeFunds } from './portfolio/fundInsights'
import { computeRisk, RISK_FREE_KEY } from './portfolio/risk'
import { computeRebalance, saveTargets } from './portfolio/rebalance'
import { computeHealth } from './portfolio/health'
import { fillSchemeNames, getDisclosureStatus, syncDisclosures } from './market/disclosures'
import { computeAnalysis } from './portfolio/analysis'
import { computeProperties } from './portfolio/property'
import * as vehicles from './vehicles'
import { createMail } from './mailSync'
import { detectImportKind } from './importers/detect'
import { createPhoneSync } from './phoneSync'
import { computeFundComparisons, computeSectorInsights } from './portfolio/insights'
import { AI_MODEL, AiDisabledError, createAi } from './ai'
import { ask, type ChatSources } from '@shared/chat'
import { fundHistory, fundLookup, stockLookup } from './marketLookup'
import * as farm from './farm'
import * as loans from './loans'
import type { LoanInput, LoanPayment } from '@shared/loans'
import { knownVarieties, refreshMandiPrices } from './market/mandi'
import { PRICE_CLASSES, type CropKey, type CropVarieties, type FarmEntryInput, type FarmSeasonInput, type HoldingCosts, type MarketNote } from '@shared/farm'
import { writeMarketNote } from './farmNote'
import { refreshSchemeFacts, storedSchemeFacts } from './market/amfiData'
import { storedCpi } from './market/cpi'
import { deleteStatement, PdfPasswordNeeded, readStatement, saveStatement, setCategory, spendingReport, statementContent } from './statements'
import type { AiFeatures, ChatEvent, ChatTurn, SpendCategory, StatementImportResult, StatementRead } from '@shared/ai'
import { applyPhoneEntry, buildPhoneSnapshot } from './phoneData'
import { computeForecast, savePlan } from './portfolio/forecast'
import type { Plan } from '@shared/plan'
import { readVehicleDocument } from './importers/vehicleDocs'
import type { VehicleInput } from '@shared/vehicles'
import { refreshResidex, residexCities, storedResidexCities } from './market/residex'
import { schema, type Db } from './db'
import * as research from './research/store'
import type { Basis, ResearchHome, ResearchStatus } from '@shared/research'
import { importAmcPortfolio } from './importers/amcPortfolio'
import { importBrokerHoldings, saveIndmoneyDates, setManualCost } from './importers/brokerHoldings'
import { reclassifyDemat, tidyListedNames } from './importers/isin'
import { persistBundle, rowHash, type ImportBundle } from './importers/bundle'
import { CasHelperError, mapCasJson, runCasparser, runPdfText } from './importers/cas'
import {
  GENERIC_HEADERS,
  GROWW_HEADERS,
  ZERODHA_HEADERS,
  mapGenericTrades,
  mapGrowwOrders,
  mapZerodhaTradebook,
  readTableFile,
  indmoneyReportKind,
  mapIndmoneyHoldings,
  mapIndmoneyOrders
} from './importers/trades'
import { fetchNavAll, mfapiHistory, npsHistory, npsLatest, npsSchemes, type AmfiScheme } from './market/funds'
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
  /** Switches the window between light, dark and the Windows setting (Electron-specific). */
  applyTheme?(theme: Theme): void
  /** Swaps in a verified backup and restarts the app (Electron-specific). */
  replaceDatabase?(filePath: string, key: string): void
  fetch?: FetchFn
  /** Opens a page in the person's browser (Google sign-in). */
  openUrl?(url: string): void | Promise<void>
  /** Sends "Ask your money" progress to the window. */
  emitChat?(e: ChatEvent): void
  /** The research desk's background download; absent in tests. */
  research?: {
    status(): ResearchStatus
    setEnabled(on: boolean): void
    open(symbol: string): Promise<void>
  }
}

const RANGE_DAYS = { '1mo': 31, '6mo': 183, '1y': 366, '5y': 1827 } as const

const casPasswordKey = (personId: number) => `cas_password:${personId}`
export const THEME_KEY = 'ui:theme'

export function createServices(deps: ServiceDeps) {
  const { db } = deps
  // Statements read by older versions recorded bonds and REIT units as shares.
  reclassifyDemat(db)
  tidyListedNames(db)

  function getSetting(key: string): string | null {
    return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
  }
  /** Without the background download (tests), the stored figures still report their progress. */
  function researchStatus(): ResearchStatus {
    if (deps.research) return deps.research.status()
    const p = research.progress(db)
    return {
      enabled: false,
      state: 'PAUSED',
      companies: p.companies,
      companiesDone: p.companiesDone,
      filings: p.filings,
      etaMinutes: null,
      pricesDate: research.latestQuoteDate(db),
      lastError: null,
      current: null
    }
  }
  function setSetting(key: string, value: string): void {
    db.insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }

  // Statements fetched from connected Google accounts go through the same importer as a picked file.
  const mail = createMail({
    getSetting,
    setSetting,
    encrypt: deps.encrypt,
    decrypt: deps.decrypt,
    fetch: deps.fetch,
    openUrl: deps.openUrl,
    personName: (id) => db.select().from(schema.persons).where(eq(schema.persons.id, id)).get()?.name ?? '',
    async importStatement(personId, filePath, source) {
      const r = await importStatementFile(personId, filePath, source)
      return r.duplicate ? `${r.account}: already read.` : `${r.account}: ${r.message}`
    },
    statementsEnabled: () => ai.enabled('statements'),
    async importReport(personId, filePath, fileName) {
      const kind = detectImportKind(filePath)
      if (!kind) return `${fileName}: not a report the app reads (skipped).`
      // Named as sent, so the import history shows the real file name.
      const named = join(dirname(filePath), fileName.replace(/[^\w.\- ]+/g, '_'))
      copyFileSync(filePath, named)
      try {
        const r = await services.runImport({ kind, personId, filePath: named })
        if (kind === 'BROKER_HOLDINGS') return `${fileName}: ${r.snapshotsAdded} holdings updated.`
        return `${fileName}: ${r.transactionsAdded} trades added, ${r.transactionsSkipped} already there.`
      } finally {
        rmSync(named, { force: true })
      }
    },
    async importCas(personId, filePath) {
      const r = await services.runImport({ kind: 'CAS_PDF', personId, filePath })
      return r.snapshotsAdded || r.transactionsAdded
        ? `Imported: ${r.snapshotsAdded} holdings, ${r.transactionsAdded} transactions.`
        : 'Already up to date.'
    }
  })

  // Claude, with the person's own key; each feature switched on separately.
  const ai = createAi({ db, encrypt: deps.encrypt, decrypt: deps.decrypt })
  const PDF_PASSWORDS = 'pdf:passwords'
  const pdfPasswords = (): string[] => {
    const raw = getSetting(PDF_PASSWORDS)
    return raw ? (JSON.parse(deps.decrypt(raw)) as string[]) : []
  }
  const rememberPassword = (p: string) => {
    if (!p) return
    const list = pdfPasswords()
    if (!list.includes(p)) setSetting(PDF_PASSWORDS, deps.encrypt(JSON.stringify([...list, p])))
  }
  /** Contract-note trades join the same Zerodha account as a tradebook import (and match its trades). */
  const importNoteTrades = (personId: number, fileName: string) => (r: StatementRead) => {
    if (!/zerodha/i.test(r.institution)) return 0
    const bundle = mapZerodhaTradebook(
      r.trades.map((t) => ({
        symbol: t.symbol,
        isin: t.isin ?? '',
        'trade date': t.date,
        'trade type': t.side.toLowerCase(),
        quantity: t.quantity,
        price: t.price,
        exchange: t.exchange ?? '',
        'trade id': t.tradeId ?? '',
        segment: 'EQ'
      }))
    )
    return persistBundle(db, { personId, kind: 'ZERODHA_TRADEBOOK', fileName, bundle }).transactionsAdded
  }
  /** Reads one statement PDF with Claude and saves it. */
  async function importStatementFile(personId: number, filePath: string, source: string, password?: string): Promise<StatementImportResult> {
    const client = ai.clientFor('statements')
    const { content, password: used } = await statementContent(
      (path, pw) => runPdfText(deps.casparserExe, path, pw),
      filePath,
      password ? [password, ...pdfPasswords()] : pdfPasswords()
    )
    const read = await readStatement(client, content, (u) => ai.record(u))
    if (used) rememberPassword(used)
    return saveStatement(db, personId, read, source, importNoteTrades(personId, source))
  }

  /** What "Ask your money" can look up: the pages' own figures, without chart series. */
  const chatSources: ChatSources = {
    persons: () => db.select().from(schema.persons).all().map((p) => ({ id: p.id, name: p.name })),
    overview(personId) {
      const a = computeAnalysis(db, personId)
      const months = a.history.months
      const totals = months.map((_, i) => a.history.series.reduce((s, g) => s + g.values[i], 0))
      return {
        ownedInr: a.totalInr,
        owedOnLoansInr: a.owed.totalInr,
        netWorthInr: a.totalInr - a.owed.totalInr,
        xirr: a.xirr,
        byAssetClass: a.scorecard,
        liquidity: a.liquidity,
        concentration: a.concentration,
        netWorthByMonth: months.slice(-24).map((m, i) => ({ month: m, value: totals[totals.length - Math.min(24, months.length) + i] }))
      }
    },
    holdings: (personId) =>
      listHoldings(db, personId).map((h) => ({
        person: h.personName,
        name: h.instrumentName,
        account: h.accountName,
        kind: h.assetClass,
        units: h.quantity,
        price: h.lastPrice,
        priceDate: h.priceDate,
        valueInr: h.marketValueInr,
        investedInr: h.investedInr,
        gainInr: h.unrealizedPnlInr,
        dayChangeInr: h.dayChangeInr,
        costFrom: h.costSource
      })),
    tax(personId) {
      const t = computeTax(db, personId)
      return { ...t, lots: t.lots.map(({ instrumentId: _i, accountId: _a, ...l }) => l) }
    },
    performance(personId) {
      const p = computePerformance(db, personId)
      return { coverage: p.coverage, coveredValueInr: p.coveredValueInr, totalValueInr: p.totalValueInr, statementsSince: p.statementsSince, trailing: p.trailing, years: p.years, maxDrawdown: p.maxDrawdown, xirr: p.xirr }
    },
    income(personId) {
      const a = computeAnalysis(db, personId)
      return { incomeByFinancialYear: a.income, upcoming: a.upcoming, maturities: a.maturities }
    },
    spending(personId, search) {
      const r = spendingReport(db, personId)
      const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const matches = words.length
        ? r.transactions.filter((t) => words.every((w) => `${t.description} ${t.merchant ?? ''} ${t.category}`.toLowerCase().includes(w)))
        : []
      return {
        accounts: r.accounts.map((a) => ({ person: a.personName, kind: a.kind, name: `${a.institution} ${a.name}`, last4: a.last4, latestStatement: a.latest })),
        spendingByMonth: r.byMonth,
        cardBillsDue: r.dues,
        ...(words.length ? { matchingTransactions: matches } : {}),
        note: r.accounts.length ? undefined : 'No card or bank statements read yet (Spending page).'
      }
    },
    property: (personId) =>
      computeProperties(db, personId).map((p) => ({ ...p, market: p.market ? { ...p.market, series: undefined, cityAll: undefined } : null })),
    vehicles: (personId) => vehicles.listVehicles(db, personId).map(({ documents: _d, costs, ...v }) => ({ ...v, costs: { ...costs, monthly: undefined } })),
    forecast() {
      const f = computeForecast(db)
      return { ...f, years: f.years.filter((y, i) => i === 0 || y.year % 5 === 0 || i === f.years.length - 1).map(({ byBucket: _b, ...y }) => y) }
    },
    sectors(personId) {
      const s = computeSectorInsights(db, personId)
      return {
        ...s,
        market: s.market ? { ...s.market, peHistory: undefined } : null,
        sectors: s.sectors.map((x) => ({ ...x, indices: x.indices.map((i) => ({ ...i, peHistory: undefined })), products: x.products.slice(0, 6) }))
      }
    },
    funds(personId) {
      const f = computeFunds(db, personId)
      return { funds: f.funds, byHouse: f.byHouse, byCategory: f.byCategory, notes: f.notes, overlapPairs: computeFundComparisons(db, personId).pairs }
    },
    retirement: () => ({ epf: assets.listEpf(db), insurance: assets.listPolicies(db) }),
    loans(personId) {
      const r = loans.loansReport(db, personId)
      return { ...r, loans: r.loans.map((l) => ({ ...l, payments: l.payments.slice(0, 10) })) }
    },
    farm(personId) {
      const r = farm.farmReport(db, personId)
      return {
        ...r,
        prices: r.prices.map(({ history: _h, ...p }) => p),
        seasons: r.seasons.map(({ entries, ...x }) => ({ ...x, entries: entries.slice(-20) }))
      }
    },
    stock: (query) => stockLookup(query, deps.fetch),
    async fundSearch(query) {
      if (!storedSchemeFacts(db).schemes.length) await refreshSchemeFacts(db, deps.fetch).catch(() => 0)
      return fundLookup(query, storedSchemeFacts(db), await navList())
    },
    fundHistory: (code) => fundHistory(code, (c, since) => mfapiHistory(c, since, deps.fetch)),
    inflation: () => storedCpi(db),
    // Read each time a question is asked: the switch and the connected accounts can change.
    get mail() {
      const accounts = mail.setup().accounts.filter((a) => a.status !== 'RECONNECT')
      if (!ai.enabled('chatMail') || !accounts.length) return undefined
      return {
        accounts: () => accounts.map((a) => ({ email: a.email, person: a.personName })),
        search: (query: string, max?: number, account?: string) => mail.search(query, { max, email: account }),
        read: (account: string, id: string) => mail.read(account, id),
        importMessage: (account: string, id: string) => mail.importMessage(account, id)
      }
    }
  }

  /** Today's mandi prices for every crop the farm grows or watches (problems are kept for the Farm page). */
  async function refreshMandi(force: boolean): Promise<void> {
    try {
      await refreshMandiPrices(db, deps.fetch, force)
    } catch (e) {
      if (force) throw e
    }
  }

  // AMFI's daily NAV file (every scheme's code and NAV), kept for a few hours once fetched.
  let navCache: { at: number; list: AmfiScheme[] } | null = null
  async function navList(): Promise<AmfiScheme[]> {
    if (!navCache || Date.now() - navCache.at > 6 * 3600000) navCache = { at: Date.now(), list: await fetchNavAll(deps.fetch) }
    return navCache.list
  }

  // The phone app: encrypted copies through the chosen account's Google Drive.
  const phone = createPhoneSync({
    getSetting,
    setSetting,
    encrypt: deps.encrypt,
    decrypt: deps.decrypt,
    fetch: deps.fetch,
    tokenFor: (email) => mail.tokenFor(email, { drive: true }),
    hasDrive: (email) => mail.hasDrive(email),
    clientInfo: () => mail.clientInfo(),
    buildSnapshot: (applied) => {
      const key = ai.phoneKey()
      return buildPhoneSnapshot(db, applied, deps.market?.getStatus().lastRefresh ?? null, key ? { apiKey: key, model: AI_MODEL } : null)
    },
    apply: (entry) => applyPhoneEntry(db, entry)
  })

  const services = {
    getTheme(): Theme {
      const v = getSetting(THEME_KEY)
      return v === 'light' || v === 'dark' ? v : 'system'
    },
    setTheme(theme: Theme): null {
      if (!['light', 'dark', 'system'].includes(theme)) throw new Error('Unknown theme')
      setSetting(THEME_KEY, theme)
      deps.applyTheme?.(theme)
      return null
    },

    getHealth: (personId?: number) => computeHealth(db, personId, deps.market?.getStatus() ?? null),

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
      let indmoneyHoldings: ReturnType<typeof mapIndmoneyHoldings> | null = null

      // INDmoney's reports are recognised whichever import was chosen.
      const kind: ImportKind =
        /\.xlsx?$/i.test(req.filePath) &&
        req.kind !== 'FUND_PORTFOLIO' &&
        indmoneyReportKind(readFileSync(req.filePath))
          ? 'INDMONEY_US'
          : req.kind

      switch (kind) {
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
        case 'INDMONEY_US': {
          const data = readFileSync(req.filePath)
          const report = indmoneyReportKind(data)
          if (report === 'ORDERS') bundle = mapIndmoneyOrders(data)
          else if (report === 'HOLDINGS') {
            indmoneyHoldings = mapIndmoneyHoldings(data)
            bundle = indmoneyHoldings.bundle
          } else
            throw new Error(
              'This is not an INDmoney order or holdings report. In INDmoney: US Stocks → Reports, download "Holdings" and "Orders" (Excel).'
            )
          break
        }
        case 'MANUAL':
          throw new Error('Manual entries are added from their own screens, not imported')
      }

      if (bundle.transactions.length === 0 && bundle.snapshots.length === 0) {
        throw new Error(['Nothing to import was found in this file.', ...bundle.warnings.slice(0, 5)].join(' '))
      }
      const result = persistBundle(db, { personId: req.personId, kind, fileName, bundle })
      if (indmoneyHoldings) saveIndmoneyDates(db, req.personId, result.batchId, indmoneyHoldings)
      // New holdings get today's prices and NAVs now, not at the next scheduled refresh.
      reclassifyDemat(db)
      tidyListedNames(db)
      void deps.market?.refresh({ full: true })
      return result
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
    async addNpsAccount(input: NpsAccountInput): Promise<string[]> {
      const added = await assets.addNpsAccount(db, input, {
        schemes: () => npsSchemes(deps.fetch),
        latest: (code) => npsLatest(code, deps.fetch)
      })
      await deps.market?.refresh({ funds: true })
      return added
    },
    removeHolding(accountId: number, instrumentId: number): null {
      assets.removeHolding(db, accountId, instrumentId)
      return null
    },

    // ---------------- deposits, bonds, gold, property, crypto, cash, other ----------------

    listManualAssets: (personId?: number) => manual.manualAssetViews(db, personId),
    async saveManualAsset(input: ManualAssetInput): Promise<number> {
      const id = manual.saveManualAsset(db, input)
      // Gold, silver and coins need a live price straight away.
      if (['METAL', 'SGB', 'CRYPTO'].includes(input.meta.kind)) await deps.market?.refresh({ quotes: true })
      // A property in a new city: fetch that city's home prices now (a failure leaves the value as entered).
      if (input.meta.kind === 'PROPERTY' && input.meta.cityId && !storedResidexCities(db).includes(input.meta.cityId))
        await refreshResidex(db, [input.meta.cityId], deps.fetch).catch(() => null)
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
    getProperties: (personId?: number) => computeProperties(db, personId),
    getHousingCities: () => residexCities(db, deps.fetch),

    // ---------------- vehicles and documents ----------------

    listVehicles: (personId?: number) => vehicles.listVehicles(db, personId),
    saveVehicle: (input: VehicleInput) => vehicles.saveVehicle(db, input),
    deleteVehicle(id: number): null {
      vehicles.deleteVehicle(db, id)
      return null
    },
    async readVehicleDocument(filePath: string, password?: string) {
      if (!/\.pdf$/i.test(filePath))
        throw new Error('Only PDFs can be read for now. Keep the photo as a document and type the details in.')
      try {
        return readVehicleDocument(await runPdfText(deps.casparserExe, filePath, password ?? ''))
      } catch (e) {
        if (e instanceof CasHelperError && e.code === 'wrong_password')
          throw new Error(password ? 'That password did not open the PDF.' : 'This PDF has a password. Enter it to read it.')
        throw e
      }
    },
    addVehicleDocument(vehicleId: number, kind: string, filePath: string): number {
      return vehicles.addDocument(db, { type: 'VEHICLE', id: vehicleId }, kind, basename(filePath), readFileSync(filePath))
    },
    getDocument: (id: number) => vehicles.getDocument(db, id),
    deleteDocument(id: number): null {
      vehicles.deleteDocument(db, id)
      return null
    },

    // ---------------- loans ----------------

    getLoans: (personId?: number) => loans.loansReport(db, personId),
    saveLoan: (input: LoanInput) => loans.saveLoan(db, input),
    deleteLoan(id: number): null {
      loans.deleteLoan(db, id)
      return null
    },
    addLoanPayment(loanId: number, payment: Omit<LoanPayment, 'id'>): null {
      loans.addLoanPayment(db, loanId, payment)
      return null
    },
    deleteLoanPayment(loanId: number, paymentId: string): null {
      loans.deleteLoanPayment(db, loanId, paymentId)
      return null
    },
    loanPrepayment(loanId: number, amount: number) {
      const l = loans.loansReport(db).loans.find((x) => x.id === loanId)
      if (!l) throw new Error('That loan no longer exists.')
      if (!(amount > 0)) throw new Error('Enter the amount.')
      return loans.prepaymentEffect(l.meta, l.payments, amount)
    },

    // ---------------- the farm ----------------

    getFarm: (personId?: number) => farm.farmReport(db, personId),
    saveFarmSeason(input: FarmSeasonInput) {
      const id = farm.saveSeason(db, input)
      // A crop with no price yet: fetch it now rather than at the next daily run.
      void refreshMandi(false).catch(() => {})
      return id
    },
    deleteFarmSeason(id: number): null {
      farm.deleteSeason(db, id)
      return null
    },
    saveFarmEntry: (input: FarmEntryInput) => farm.saveEntry(db, input),
    deleteFarmEntry(id: number): null {
      farm.deleteEntry(db, id)
      return null
    },
    setFarmMarket(market: string): null {
      farm.setDefaultMarket(db, market)
      void refreshMandi(false).catch(() => {})
      return null
    },
    getCropVarieties(crop: CropKey, market?: string | null): CropVarieties {
      const all = farm.cropPrice(db, crop, market?.trim() || farm.defaultMarket(db)).varieties
      const reported = all.filter((v) => v.source === 'AGMARKNET').map(({ name, modal, date }) => ({ name, modal, date }))
      const seen = new Set(reported.map((v) => v.name.toUpperCase()))
      const classes = (PRICE_CLASSES[crop] ?? []).map((c) => {
        const p = all.find((v) => v.source === 'APMC' && v.name === c.label)
        return { ...c, modal: p?.modal ?? null, min: p?.min ?? null, max: p?.max ?? null, date: p?.date ?? null }
      })
      return { reported, classes, all: knownVarieties(db, crop).filter((v) => !seen.has(v.toUpperCase())) }
    },
    setFarmHolding(costs: HoldingCosts): null {
      farm.setHoldingCosts(db, costs)
      return null
    },
    setFarmTransport(market: string, perQtl: number | null): null {
      farm.setTransportCost(db, market, perQtl)
      return null
    },
    async getMarketNote(crop: CropKey, fresh = false): Promise<MarketNote> {
      const cached = farm.marketNotes(db)[crop]
      // One a day is plenty: market conditions don't change by the hour, and each note costs.
      if (cached && !fresh && Date.now() - Date.parse(cached.at) < 20 * 3600000) return cached
      const report = farm.farmReport(db)
      const o = report.outlook.find((x) => x.crop === crop)
      const market = o?.market ?? farm.defaultMarket(db)
      const note = await writeMarketNote(
        ai.clientFor('marketNotes'),
        {
          crop,
          market,
          today: new Date().toISOString().slice(0, 10),
          price: farm.cropPrice(db, crop, market),
          pattern: o?.pattern ?? farm.seasonalPattern(db, crop, market),
          arrivals: o?.arrivals ? { latest: o.arrivals.latest, avg30: o.arrivals.avg30 } : null
        },
        (u) => ai.record(u)
      )
      farm.saveMarketNote(db, note)
      return note
    },
    setFarmPriceTarget(crop: CropKey, price: number | null): null {
      farm.setPriceTarget(db, crop, price)
      return null
    },
    async refreshFarmPrices() {
      await refreshMandi(true)
      return farm.farmReport(db)
    },

    // ---------------- research desk ----------------

    getResearchHome(): ResearchHome {
      const held = research.heldStocks(db)
      const yours = research
        .researchRows(db, [...held.keys()], held)
        .sort((a, b) => (b.held?.valueInr ?? 0) - (a.held?.valueInr ?? 0))
      return { status: researchStatus(), yours }
    },
    getCompany(symbol: string, basis?: Basis | null) {
      const s = symbol.trim().toUpperCase()
      const view = research.companyView(db, s, basis ?? null)
      // Not downloaded yet: fetch this one now; the page refreshes when it is in.
      if (view && (view.results.state === 'WAITING' || view.results.error)) void deps.research?.open(s).catch(() => {})
      return view
    },
    searchCompanies: (query: string) => research.searchCompanies(db, query),
    async getCompanyChart(symbol: string, range: '1mo' | '6mo' | '1y' | '5y' | 'max'): Promise<PricePoint[]> {
      return (await yahooHistory(`${symbol.trim().toUpperCase()}.NS`, range, deps.fetch)).prices
    },
    setResearchSync(on: boolean): ResearchStatus {
      deps.research?.setEnabled(on)
      return researchStatus()
    },
    getPerformance: (personId?: number) => computePerformance(db, personId),
    getTax: (personId?: number) => computeTax(db, personId),
    getFunds: (personId?: number) => computeFunds(db, personId),
    getRisk: (personId?: number) => computeRisk(db, personId),
    getRebalance: (personId: number | undefined, opts: { newMoneyInr: number; allowSells: boolean }) =>
      computeRebalance(db, personId, opts),
    setTargets(personId: number | null, targets: Targets | null): null {
      saveTargets(db, personId, targets)
      return null
    },
    setRiskFreeRate(rate: number): null {
      if (!(rate >= 0 && rate <= 0.2)) throw new Error('Enter a rate between 0% and 20%')
      setSetting(RISK_FREE_KEY, String(rate))
      return null
    },
    setBuyPrice(input: {
      personId: number
      accountId: number
      instrumentId: number
      avgCost: number | null
      heldSince?: string | null
    }): null {
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
    },

    // ---------------- Google accounts (statements from Gmail) ----------------

    getGoogleSetup: () => mail.setup(),
    saveGoogleClient: (input: { clientId: string; clientSecret: string; web?: boolean }) => mail.saveClient(input),
    connectGoogleAccount: (personId: number) => mail.connect(personId),
    setGoogleAccountPerson: (email: string, personId: number) => mail.setPerson(email, personId),
    disconnectGoogleAccount: (email: string) => mail.disconnect(email),
    checkMail: (email?: string) => mail.check(email),
    /** For the background timer. */
    mailDue: () => mail.due(),

    // ---------------- sector and fund facts ----------------

    getSectorInsights: (personId?: number) => computeSectorInsights(db, personId),
    getFundComparisons: (personId?: number) => computeFundComparisons(db, personId),

    // ---------------- Claude ----------------

    getAiStatus: () => ai.status(),
    setAiKey: (apiKey: string) => ai.setKey(apiKey),
    removeAiKey() {
      const s = ai.removeKey()
      if (phone.enabled()) void phone.sync().catch(() => {})
      return s
    },
    setAiFeatures(f: AiFeatures) {
      const s = ai.setFeatures(f)
      // The phone gets (or loses) the key with its next copy: send one now rather than in ten minutes.
      if ((f.phoneChat !== undefined || f.chat !== undefined) && phone.enabled()) void phone.sync().catch(() => {})
      return s
    },
    pdfPasswordCount: () => pdfPasswords().length,
    forgetPdfPasswords(): null {
      setSetting(PDF_PASSWORDS, deps.encrypt('[]'))
      return null
    },
    async importStatement(input: { personId: number; filePath: string; password?: string }): Promise<StatementImportResult> {
      try {
        return await importStatementFile(input.personId, input.filePath, basename(input.filePath), input.password)
      } catch (e) {
        if (e instanceof PdfPasswordNeeded || e instanceof AiDisabledError) throw new Error(e.message)
        throw e
      }
    },
    /** For the Gmail job: a statement attachment, read the same way. */
    importStatementFile,
    getSpending: (personId?: number) => spendingReport(db, personId),
    setSpendCategory(txnId: number, category: SpendCategory): null {
      setCategory(db, txnId, category)
      return null
    },
    deleteStatement(id: number): null {
      deleteStatement(db, id)
      return null
    },
    async askMoney(id: string, history: ChatTurn[]): Promise<null> {
      const emit = (e: ChatEvent) => deps.emitChat?.(e)
      try {
        await ask(ai.clientFor('chat'), chatSources, history, emit, id, (u) => ai.record(u))
      } catch (e) {
        emit({ id, type: 'error', message: e instanceof Error ? e.message : String(e) })
      }
      return null
    },

    // ---------------- phone app ----------------

    getPhoneSync: () => phone.status(),
    configurePhoneSync: (input: { account: string; passphrase?: string }) => phone.configure(input),
    /** Signs the account in again, this time allowing the hidden Drive folder. */
    async allowPhoneDrive(email: string) {
      const acct = mail.setup().accounts.find((a) => a.email === email)
      await mail.connect(acct?.personId ?? 1, { drive: true })
      return phone.status()
    },
    syncPhone: () => phone.sync(),
    turnOffPhoneSync: () => phone.turnOff(),
    phoneSyncEnabled: () => phone.enabled(),

    // ---------------- forecast ----------------

    getForecast: (personId?: number) => computeForecast(db, personId),
    savePlan(plan: Plan): null {
      savePlan(db, plan)
      return null
    }
  }
  return services
}

export type Services = ReturnType<typeof createServices>
