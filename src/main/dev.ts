import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeTheme, type BrowserWindow } from 'electron'
import type { Db } from './db'
import { persistBundle } from './importers/bundle'
import { mapCasJson, type CasJson } from './importers/cas'
import type { Services } from './services'
import type { ManualMeta } from '@shared/assets'
import { addManualEntry, saveManualAsset } from './manualAssets'
import { saveVehicle } from './vehicles'
import { seedFarm, type FarmSeed } from './farm'
import { saveLoan } from './loans'
import type { LoanInput } from '@shared/loans'
import { loadPlan, savePlan } from './portfolio/forecast'
import type { VehicleMeta } from '@shared/vehicles'
import type { DayQuote, Filing } from '@shared/research'
import { schema } from './db'
import { markChecked, saveIndices, saveQuotes } from './research/store'
import type { IndexLevel } from '@shared/screener'
import { SYNC_KEY } from './research/sync'
import * as worldStore from './world/store'
import { WORLD_SYNC_KEY } from './world/sync'
import type { Figure } from './world/parse'
import type { FreightPoint, TradeRow, TrafficDay, WorldEvent, WorldMetricKey, WorldPlace } from '@shared/world'

/**
 * Development-only helpers, never active in the packaged app:
 *   FP_USER_DATA=<dir>        keep data in a throwaway folder instead of the real profile
 *   FP_SEED_DIR=<dir>         import demo files named "<person>-*.cas.json" / "-zerodha-*.csv" / "-indmoney-*.csv" / "-*.assets.json" / "-*.vehicles.json" / "*.plan.json" / "*.research.json" / "*.world.json"
 *   FP_SCREENSHOT_DIR=<dir>   capture each page to PNG, then quit (FP_ROUTES, FP_SCOPES pick which)
 *   FP_THEME=light|dark|terminal  force the colour scheme (terminal is saved as the theme setting)
 *   FP_SHOT_DELAY=<ms>       wait before the first screenshot (lets live prices load)
 *   FP_SHOT_WAIT=<ms>        wait after opening each page before its screenshot (default 1500)
 */
const enabled = () => !app.isPackaged

export function applyDevPaths(): void {
  if (!enabled()) return
  if (process.env.FP_USER_DATA) app.setPath('userData', process.env.FP_USER_DATA)
  const theme = process.env.FP_THEME
  if (theme === 'light' || theme === 'dark' || theme === 'terminal')
    void app.whenReady().then(() => (nativeTheme.themeSource = theme === 'terminal' ? 'dark' : theme))
}

/** FP_THEME=terminal: the terminal look is a saved setting the window reads, so save it. */
export function applyDevTheme(services: Services): void {
  if (enabled() && process.env.FP_THEME === 'terminal') services.setTheme('terminal')
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
    } else if (file.endsWith('.plan.json')) {
      savePlan(db, { ...loadPlan(db), ...JSON.parse(readFileSync(path, 'utf8')) })
    } else if (file.endsWith('.vehicles.json')) {
      for (const meta of JSON.parse(readFileSync(path, 'utf8')) as VehicleMeta[]) saveVehicle(db, { personId, meta })
    } else if (file.endsWith('.loans.json')) {
      for (const l of JSON.parse(readFileSync(path, 'utf8')) as Omit<LoanInput, 'personId'>[]) saveLoan(db, { ...l, personId })
    } else if (file.endsWith('.world.json')) {
      seedWorld(db, JSON.parse(readFileSync(path, 'utf8')) as WorldSeed)
    } else if (file.endsWith('.research.json')) {
      seedResearch(db, JSON.parse(readFileSync(path, 'utf8')))
    } else if (file.endsWith('.farm.json')) {
      seedFarm(db, personId, JSON.parse(readFileSync(path, 'utf8')) as FarmSeed)
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
        await wait(Number(process.env.FP_SHOT_WAIT ?? 1500))
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

/** Stored results and prices for a few companies; the background download stays off on demo data. */
function seedResearch(
  db: Db,
  seed: { listings: { isin: string; symbol: string; name: string }[]; quotes: DayQuote[]; filings: Filing[]; indices?: IndexLevel[] }
): void {
  const at = new Date().toISOString()
  for (const l of seed.listings)
    db.insert(schema.nseListings).values({ ...l, kind: 'EQ', updatedAt: at }).onConflictDoNothing().run()
  saveQuotes(db, seed.quotes)
  saveIndices(db, seed.indices ?? [])
  for (const f of seed.filings) {
    db.insert(schema.researchFilings)
      .values({ symbol: f.symbol, periodEnd: f.periodEnd, basis: f.basis, url: 'demo', status: 'DONE', dataJson: JSON.stringify(f) })
      .onConflictDoNothing()
      .run()
    markChecked(db, f.symbol, null)
  }
  db.insert(schema.settings).values({ key: SYNC_KEY, value: 'off' }).onConflictDoNothing().run()
}

interface WorldSeed {
  figures: Partial<Record<WorldMetricKey, Figure[]>>
  places: Omit<WorldPlace, 'followed' | 'latestDate' | 'recent' | 'yearAgo' | 'imports7' | 'exports7' | 'weekly'>[]
  traffic: (TrafficDay & { id: string })[]
  trade: TradeRow[]
  events: WorldEvent[]
  freight: FreightPoint[]
}

/** A saved copy of the World map's data; its background updates stay off on demo data. */
function seedWorld(db: Db, seed: WorldSeed): void {
  for (const [metric, rows] of Object.entries(seed.figures)) worldStore.saveFigures(db, metric as WorldMetricKey, rows ?? [])
  worldStore.savePlaces(db, seed.places)
  worldStore.saveTraffic(db, seed.traffic)
  worldStore.saveTrade(db, seed.trade)
  worldStore.saveEvents(db, seed.events)
  worldStore.saveFreight(db, 'SCFI', seed.freight)
  db.insert(schema.settings).values({ key: WORLD_SYNC_KEY, value: 'off' }).onConflictDoNothing().run()
}
