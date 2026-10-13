import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeTheme, type BrowserWindow } from 'electron'
import type { Db } from './db'
import { persistBundle } from './importers/bundle'
import { mapCasJson, type CasJson } from './importers/cas'
import type { Services } from './services'
import type { ManualMeta } from '@shared/assets'
import { addManualEntry, saveManualAsset } from './manualAssets'

/**
 * Development-only helpers, never active in the packaged app:
 *   FP_USER_DATA=<dir>        keep data in a throwaway folder instead of the real profile
 *   FP_SEED_DIR=<dir>         import demo files named "<person>-*.cas.json" / "-zerodha-*.csv" / "-indmoney-*.csv" / "-*.assets.json"
 *   FP_SCREENSHOT_DIR=<dir>   capture each page to PNG, then quit (FP_ROUTES, FP_SCOPES pick which)
 *   FP_THEME=light|dark      force the colour scheme
 *   FP_SHOT_DELAY=<ms>       wait before the first screenshot (lets live prices load)
 */
const enabled = () => !app.isPackaged

export function applyDevPaths(): void {
  if (!enabled()) return
  if (process.env.FP_USER_DATA) app.setPath('userData', process.env.FP_USER_DATA)
  const theme = process.env.FP_THEME
  if (theme === 'light' || theme === 'dark') void app.whenReady().then(() => (nativeTheme.themeSource = theme))
}

export async function seedDemo(db: Db, services: Services): Promise<void> {
  const dir = process.env.FP_SEED_DIR
  if (!enabled() || !dir || services.listImports().length > 0) return
  const people = new Map(services.listPersons().map((p) => [p.name.toLowerCase(), p.id]))
  const personFor = (file: string) => (file.startsWith('dad-') ? people.get('dad') : people.get('me')) ?? 1

  for (const file of readdirSync(dir).sort()) {
    const path = join(dir, file)
    const personId = personFor(file)
    if (file.endsWith('.cas.json')) {
      const json = JSON.parse(readFileSync(path, 'utf8')) as CasJson
      persistBundle(db, { personId, kind: 'CAS_PDF', fileName: file, bundle: mapCasJson(json) })
    } else if (file.includes('zerodha')) {
      await services.runImport({ kind: 'ZERODHA_TRADEBOOK', personId, filePath: path })
    } else if (file.includes('indmoney')) {
      await services.runImport({ kind: 'GENERIC_TRADES', personId, filePath: path, platform: 'INDMONEY' })
    } else if (file.endsWith('.assets.json')) {
      const items = JSON.parse(readFileSync(path, 'utf8')) as {
        meta: ManualMeta
        entries?: { date: string; value: number }[]
      }[]
      for (const it of items) {
        const id = saveManualAsset(db, { personId, meta: it.meta })
        for (const e of it.entries ?? []) addManualEntry(db, id, e.date, e.value)
      }
    }
  }
}

export function captureScreens(win: BrowserWindow): void {
  const out = process.env.FP_SCREENSHOT_DIR
  if (!enabled() || !out) return
  mkdirSync(out, { recursive: true })
  const routes = (process.env.FP_ROUTES ?? '/,/holdings,/activity,/import,/people').split(',')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  win.webContents.once('did-finish-load', async () => {
    // Give the first live price refresh time to land before the first capture.
    await wait(Number(process.env.FP_SHOT_DELAY ?? 0))
    for (const scope of (process.env.FP_SCOPES ?? 'family').split(',')) {
      await win.webContents.executeJavaScript(`localStorage.setItem('scope', ${JSON.stringify(scope)})`)
      for (const route of routes) {
        await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + route)}; location.reload()`)
        await wait(1500)
        const name = `${scope}${route.replace(/\//g, '_') || '_'}.png`
        try {
          writeFileSync(join(out, name), (await win.webContents.capturePage()).toPNG())
        } catch (e) {
          console.error(`[dev] capture failed for ${name}`, e)
        }
      }
    }
    app.quit()
  })
}
