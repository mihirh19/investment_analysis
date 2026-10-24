import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, Notification, shell } from 'electron'
import { CROPS } from '@shared/farm'
import { newlyReachedTargets } from './farm'
import { CHAT_EVENT, MARKET_UPDATED, RESEARCH_UPDATED } from '@shared/api'
import { openDatabase } from './db'
import { applyDevPaths, captureScreens, seedDemo } from './dev'
import { registerIpc } from './ipc'
import { decryptSecret, encryptSecret, loadOrCreateDbKey, writeDbKey } from './keystore'
import { MarketData } from './market/refresh'
import { ResearchSync } from './research/sync'
import { renderLinks } from './market/render'
import { createServices, type Services } from './services'

function resourcePath(...parts: string[]): string {
  // Packaged: files listed under extraResources sit next to app.asar.
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), ...parts)
}

applyDevPaths()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Family Portfolio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
  captureScreens(win)

  // Links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(async () => {
    let market: MarketData
    let researchSync: ResearchSync
    let services: Services
    try {
      const userData = app.getPath('userData')
      const keyFile = join(userData, 'db.key')
      const dbFile = join(userData, 'portfolio.db')

      // Data without its key (e.g. after a Windows reinstall) can only be opened with the recovery key.
      if (existsSync(dbFile) && !existsSync(keyFile)) {
        const locked = join(userData, `portfolio-locked-${Date.now()}.db`)
        renameSync(dbFile, locked)
        for (const ext of ['-wal', '-shm']) if (existsSync(dbFile + ext)) renameSync(dbFile + ext, locked + ext)
        dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Family Portfolio',
          message: 'Your previous data is locked',
          detail:
            `The key for the existing data file is missing, so a fresh empty book has been started.\n\n` +
            `To get your data back, open Settings → Restore and choose:\n${locked}\nthen enter your recovery key.`
        })
      }

      const key = loadOrCreateDbKey(keyFile)
      const { db, sqlite } = openDatabase(dbFile, key, resourcePath('drizzle'))
      market = new MarketData(
        db,
        () => {
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send(MARKET_UPDATED)
          // A crop reaching the price the family is waiting for: say so once.
          for (const t of newlyReachedTargets(db))
            if (Notification.isSupported())
              new Notification({
                title: `${CROPS[t.crop].label}: ₹${t.price.toLocaleString('en-IN')} a quintal`,
                body: `${t.market} mandi has reached your target of ₹${t.target.toLocaleString('en-IN')}.`
              }).show()
        },
        fetch,
        { renderLinks }
      )
      // Company results and NSE's daily files; told to the window at most every few seconds.
      let pending: NodeJS.Timeout | null = null
      researchSync = new ResearchSync(db, () => {
        pending ??= setTimeout(() => {
          pending = null
          for (const w of BrowserWindow.getAllWindows()) w.webContents.send(RESEARCH_UPDATED)
        }, 3000)
      })
      services = createServices({
        db,
        casparserExe: app.isPackaged
          ? join(process.resourcesPath, 'bin', 'casparser.exe')
          : join(app.getAppPath(), 'resources', 'bin', 'casparser.exe'),
        encrypt: encryptSecret,
        decrypt: decryptSecret,
        market,
        research: researchSync,
        dbKey: key,
        applyTheme: (t) => (nativeTheme.themeSource = t),
        openUrl: (url) => shell.openExternal(url),
        emitChat: (e) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(CHAT_EVENT, e)),
        replaceDatabase(filePath, newKey) {
          market.stop()
          researchSync.stop()
          sqlite.close()
          for (const ext of ['', '-wal', '-shm']) rmSync(dbFile + ext, { force: true })
          copyFileSync(filePath, dbFile)
          writeDbKey(keyFile, newKey)
          app.relaunch()
          app.exit(0)
        }
      })
      registerIpc(services)
      // The saved light/dark choice (the FP_THEME development switch wins when set).
      if (!process.env.FP_THEME) nativeTheme.themeSource = services.getTheme()
      await seedDemo(db, services)
    } catch (err) {
      dialog.showErrorBox('Family Portfolio could not start', err instanceof Error ? err.message : String(err))
      app.quit()
      return
    }
    createWindow()
    market.start()
    // After the first price refresh has had the network to itself.
    setTimeout(() => researchSync.start(), 45_000)
    // Connected Gmail accounts are checked for new statements a minute after start, then every 12 hours.
    const checkMail = () => {
      if (services.mailDue())
        void services
          .checkMail()
          .then(() => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(MARKET_UPDATED)))
          .catch(() => null)
    }
    setTimeout(checkMail, 60_000)
    setInterval(checkMail, 30 * 60_000)
    // The phone app's copy: entries from the phone come in, fresh figures go out (only when changed).
    const syncPhone = () => {
      if (services.phoneSyncEnabled())
        void services
          .syncPhone()
          .then((s) => {
            if (s.lastApplied) BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(MARKET_UPDATED))
          })
          .catch(() => null)
    }
    setTimeout(syncPhone, 90_000)
    setInterval(syncPhone, 10 * 60_000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
