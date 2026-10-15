import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ApiResult, ImportKind, RequestApi } from '@shared/types'
import type { Services } from './services'

const FILE_FILTERS: Record<ImportKind | 'BACKUP', Electron.FileFilter[]> = {
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

    listManualAssets: (personId) => services.listManualAssets(personId),
    saveManualAsset: (input) => services.saveManualAsset(input),
    deleteManualAsset: (id) => services.deleteManualAsset(id),
    addManualEntry: (id, date, value) => services.addManualEntry(id, date, value),
    deleteManualEntry: (id, date) => services.deleteManualEntry(id, date),
    getMetalPrices: () => services.getMetalPrices(),
    setGoldPremium: (pct) => services.setGoldPremium(pct),
    getAnalysis: (personId) => services.getAnalysis(personId),
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
