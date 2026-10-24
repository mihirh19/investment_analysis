import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ApiResult, ImportKind, RequestApi } from '@shared/types'
import type { Services } from './services'

const FILE_FILTERS: Record<ImportKind | 'BACKUP' | 'DOCUMENT' | 'STATEMENT', Electron.FileFilter[]> = {
  STATEMENT: [{ name: 'Statement (PDF)', extensions: ['pdf'] }],
  DOCUMENT: [{ name: 'PDF or photo', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }],
  CAS_PDF: [{ name: 'CAS statement (PDF)', extensions: ['pdf'] }],
  ZERODHA_TRADEBOOK: [{ name: 'Zerodha tradebook', extensions: ['csv', 'xlsx', 'xls'] }],
  GROWW_ORDERS: [{ name: 'Groww order history', extensions: ['xlsx', 'xls', 'csv'] }],
  GENERIC_TRADES: [{ name: 'Trades file', extensions: ['csv', 'xlsx', 'xls'] }],
  FUND_PORTFOLIO: [{ name: 'Fund portfolio disclosure', extensions: ['xlsx', 'xls', 'xlsb', 'csv'] }],
  BROKER_HOLDINGS: [{ name: 'Broker holdings file', extensions: ['xlsx', 'xls', 'csv'] }],
  INDMONEY_US: [{ name: 'INDmoney US report', extensions: ['xls', 'xlsx'] }],
  MANUAL: [],
  BACKUP: [{ name: 'Family Portfolio backup', extensions: ['fpbackup', 'db'] }]
}

type Handlers = { [K in keyof RequestApi]: (...args: Parameters<RequestApi[K]>) => unknown }

const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

export function registerIpc(services: Services): void {
  rmSync(join(app.getPath('temp'), 'family-portfolio-documents'), { recursive: true, force: true })
  const handlers: Handlers = {
    listPersons: () => services.listPersons(),
    savePerson: (p) => services.savePerson(p),
    listAccounts: () => services.listAccounts(),
    listHoldings: (personId) => services.listHoldings(personId),
    listTransactions: (filter) => services.listTransactions(filter),
    addManualTransaction: (input) => services.addManualTransaction(input),
    deleteTransaction: (id) => services.deleteTransaction(id),
    hasSavedCasPassword: (personId) => services.hasSavedCasPassword(personId),
    runImport: (req) => services.runImport(req),
    listImports: () => services.listImports(),
    undoImport: (id) => services.undoImport(id),
    pickFile: async (kind) => {
      const res = await dialog.showOpenDialog(focused(), { properties: ['openFile'], filters: FILE_FILTERS[kind] })
      return res.canceled ? null : res.filePaths[0]
    },

    getMarketStatus: () => services.getMarketStatus(),
    refreshMarket: () => services.refreshMarket(),
    getFx: () => services.getFx(),
    getPriceHistory: (id, range) => services.getPriceHistory(id, range),
    listDividends: (personId) => services.listDividends(personId),
    getExposure: (personId) => services.getExposure(personId),

    listEpf: () => services.listEpf(),
    saveEpf: (input) => services.saveEpf(input),
    addEpfEntry: (id, date, balance) => services.addEpfEntry(id, date, balance),
    deleteEpfEntry: (id, date) => services.deleteEpfEntry(id, date),
    listPolicies: () => services.listPolicies(),
    savePolicy: (input) => services.savePolicy(input),
    deletePolicy: (id) => services.deletePolicy(id),
    listNpsSchemes: () => services.listNpsSchemes(),
    addNpsHolding: (input) => services.addNpsHolding(input),
    addNpsAccount: (input) => services.addNpsAccount(input),
    removeHolding: (accountId, instrumentId) => services.removeHolding(accountId, instrumentId),

    listManualAssets: (personId) => services.listManualAssets(personId),
    saveManualAsset: (input) => services.saveManualAsset(input),
    deleteManualAsset: (id) => services.deleteManualAsset(id),
    addManualEntry: (id, date, value) => services.addManualEntry(id, date, value),
    deleteManualEntry: (id, date) => services.deleteManualEntry(id, date),
    getMetalPrices: () => services.getMetalPrices(),
    setGoldPremium: (pct) => services.setGoldPremium(pct),
    getAnalysis: (personId) => services.getAnalysis(personId),
    getProperties: (personId) => services.getProperties(personId),
    getHousingCities: () => services.getHousingCities(),
    listVehicles: (personId) => services.listVehicles(personId),
    saveVehicle: (input) => services.saveVehicle(input),
    deleteVehicle: (id) => services.deleteVehicle(id),
    readVehicleDocument: (filePath, password) => services.readVehicleDocument(filePath, password),
    addVehicleDocument: (vehicleId, kind, filePath) => services.addVehicleDocument(vehicleId, kind, filePath),
    openDocument: async (id) => {
      // A temporary decrypted copy for the viewer; the folder is emptied when the app starts.
      const d = services.getDocument(id)
      const dir = join(app.getPath('temp'), 'family-portfolio-documents')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `${id}-${d.fileName.replace(/[^\w.\- ]+/g, '_')}`)
      writeFileSync(file, d.data)
      const err = await shell.openPath(file)
      if (err) throw new Error(err)
      return null
    },
    deleteDocument: (id) => services.deleteDocument(id),
    getFarm: (personId) => services.getFarm(personId),
    getLoans: (personId) => services.getLoans(personId),
    saveLoan: (input) => services.saveLoan(input),
    deleteLoan: (id) => services.deleteLoan(id),
    addLoanPayment: (loanId, payment) => services.addLoanPayment(loanId, payment),
    deleteLoanPayment: (loanId, paymentId) => services.deleteLoanPayment(loanId, paymentId),
    loanPrepayment: (loanId, amount) => services.loanPrepayment(loanId, amount),
    saveFarmSeason: (input) => services.saveFarmSeason(input),
    deleteFarmSeason: (id) => services.deleteFarmSeason(id),
    saveFarmEntry: (input) => services.saveFarmEntry(input),
    deleteFarmEntry: (id) => services.deleteFarmEntry(id),
    setFarmMarket: (market) => services.setFarmMarket(market),
    getCropVarieties: (crop, market) => services.getCropVarieties(crop, market),
    setFarmPriceTarget: (crop, price) => services.setFarmPriceTarget(crop, price),
    setFarmHolding: (costs) => services.setFarmHolding(costs),
    setFarmTransport: (market, perQtl) => services.setFarmTransport(market, perQtl),
    getMarketNote: (crop, fresh) => services.getMarketNote(crop, fresh),
    refreshFarmPrices: () => services.refreshFarmPrices(),
    getResearchHome: () => services.getResearchHome(),
    getCompany: (symbol, basis) => services.getCompany(symbol, basis),
    searchCompanies: (query) => services.searchCompanies(query),
    getCompanyChart: (symbol, range) => services.getCompanyChart(symbol, range),
    setResearchSync: (on) => services.setResearchSync(on),
    getScreenData: () => services.getScreenData(),
    getMarketMonitor: () => services.getMarketMonitor(),
    getWorldBoard: () => services.getWorldBoard(),
    getSavedScreens: () => services.getSavedScreens(),
    getFlows: () => services.getFlows(),
    refreshFlows: () => services.refreshFlows(),
    setFlowsSync: (on) => services.setFlowsSync(on),
    getChartBars: (symbol, interval) => services.getChartBars(symbol, interval),
    getQuotes: (symbols) => services.getQuotes(symbols),
    getWorkspaces: () => services.getWorkspaces(),
    saveWorkspaces: (list) => services.saveWorkspaces(list),
    listWatchlists: () => services.listWatchlists(),
    saveWatchlist: (list) => services.saveWatchlist(list),
    deleteWatchlist: (id) => services.deleteWatchlist(id),
    getNote: (symbol) => services.getNote(symbol),
    saveNote: (symbol, text) => services.saveNote(symbol, text),
    exportExcel: async (fileName, sheets) => {
      const safe = fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'export'
      const res = await dialog.showSaveDialog(focused(), {
        title: 'Save as Excel',
        defaultPath: join(app.getPath('documents'), safe.endsWith('.xlsx') ? safe : `${safe}.xlsx`),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
      })
      return res.canceled || !res.filePath ? null : services.writeExcel(res.filePath, sheets)
    },
    saveScreens: (screens) => services.saveScreens(screens),
    getWorldMap: () => services.getWorldMap(),
    setWorldSync: (on) => services.setWorldSync(on),
    refreshWorld: () => services.refreshWorld(),
    getWorldShips: () => services.getWorldShips(),
    getAisStatus: () => services.getAisStatus(),
    setAisKey: (key) => services.setAisKey(key),
    removeAisKey: () => services.removeAisKey(),
    getGoogleSetup: () => services.getGoogleSetup(),
    saveGoogleClient: (input) => services.saveGoogleClient(input),
    connectGoogleAccount: (personId) => services.connectGoogleAccount(personId),
    setGoogleAccountPerson: (email, personId) => services.setGoogleAccountPerson(email, personId),
    disconnectGoogleAccount: (email) => services.disconnectGoogleAccount(email),
    checkMail: (email) => services.checkMail(email),
    getForecast: (personId) => services.getForecast(personId),
    savePlan: (plan) => services.savePlan(plan),
    getSectorInsights: (personId) => services.getSectorInsights(personId),
    getAiStatus: () => services.getAiStatus(),
    setAiKey: (apiKey) => services.setAiKey(apiKey),
    removeAiKey: () => services.removeAiKey(),
    setAiFeatures: (f) => services.setAiFeatures(f),
    pdfPasswordCount: () => services.pdfPasswordCount(),
    forgetPdfPasswords: () => services.forgetPdfPasswords(),
    importStatement: (input) => services.importStatement(input),
    getSpending: (personId) => services.getSpending(personId),
    setSpendCategory: (txnId, category) => services.setSpendCategory(txnId, category),
    deleteStatement: (id) => services.deleteStatement(id),
    askMoney: (id, history) => services.askMoney(id, history),
    getFundComparisons: (personId) => services.getFundComparisons(personId),
    getPhoneSync: () => services.getPhoneSync(),
    configurePhoneSync: (input) => services.configurePhoneSync(input),
    allowPhoneDrive: (email) => services.allowPhoneDrive(email),
    syncPhone: () => services.syncPhone(),
    turnOffPhoneSync: () => services.turnOffPhoneSync(),
    getSparklines: (ids) => services.getSparklines(ids),
    listBenchmarks: (since) => services.listBenchmarks(since),
    getPerformance: (personId) => services.getPerformance(personId),
    getTheme: () => services.getTheme(),
    setTheme: (theme) => services.setTheme(theme),
    getHealth: (personId) => services.getHealth(personId),
    getTax: (personId) => services.getTax(personId),
    getFunds: (personId) => services.getFunds(personId),
    getRisk: (personId) => services.getRisk(personId),
    setRiskFreeRate: (rate) => services.setRiskFreeRate(rate),
    getRebalance: (personId, opts) => services.getRebalance(personId, opts),
    setTargets: (personId, targets) => services.setTargets(personId, targets),
    setBuyPrice: (input) => services.setBuyPrice(input),

    getDisclosureStatus: () => services.getDisclosureStatus(),
    syncDisclosures: (force) => services.syncDisclosures(force),
    openExternal: async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened')
      await shell.openExternal(url)
      return null
    },

    getRecoveryKey: () => services.getRecoveryKey(),
    backupDatabase: async () => {
      const stamp = new Date().toISOString().slice(0, 10)
      const res = await dialog.showSaveDialog(focused(), {
        title: 'Save an encrypted backup',
        defaultPath: join(app.getPath('documents'), `family-portfolio-${stamp}.fpbackup`),
        filters: FILE_FILTERS.BACKUP
      })
      return res.canceled || !res.filePath ? null : services.backupTo(res.filePath)
    },
    restoreDatabase: (filePath, key) => services.restoreDatabase(filePath, key)
  }

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(`api:${channel}`, async (_e, ...args: unknown[]): Promise<ApiResult<unknown>> => {
      try {
        return { ok: true, data: await (fn as (...a: unknown[]) => unknown)(...args) }
      } catch (err) {
        console.error(`[ipc] ${channel} failed`, err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}
