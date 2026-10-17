// Builds a locked demo snapshot for trying the phone app without Google:
//   FP_PHONE_DEMO=1 npx vitest run tests/phone-demo.test.ts
// writes dist-phone/demo.json ({ sealed, passphrase }). Not part of the test suite.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import type { ManualMeta } from '../src/shared/assets'
import type { VehicleMeta } from '../src/shared/vehicles'
import { seal, vaultKey } from '../src/shared/vault'
import { openDatabase } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type CasJson } from '../src/main/importers/cas'
import { addManualEntry, saveManualAsset } from '../src/main/manualAssets'
import { buildPhoneSnapshot } from '../src/main/phoneData'
import { loadPlan, savePlan } from '../src/main/portfolio/forecast'
import { createServices } from '../src/main/services'
import { saveVehicle } from '../src/main/vehicles'

it.runIf(process.env.FP_PHONE_DEMO)('builds the demo snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-demo-'))
  const { db, sqlite } = openDatabase(join(dir, 't.db'), '8'.repeat(64), resolve('drizzle'))
  const services = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s })
  const seed = resolve('tests/fixtures/demo')
  for (const file of readdirSync(seed).sort()) {
    const path = join(seed, file)
    const personId = file.startsWith('dad-') ? 2 : 1
    if (file.endsWith('.cas.json'))
      persistBundle(db, { personId, kind: 'CAS_PDF', fileName: file, bundle: mapCasJson(JSON.parse(readFileSync(path, 'utf8')) as CasJson) })
    else if (file.includes('zerodha')) await services.runImport({ kind: 'ZERODHA_TRADEBOOK', personId, filePath: path })
    else if (file.includes('indmoney')) await services.runImport({ kind: 'GENERIC_TRADES', personId, filePath: path, platform: 'INDMONEY' })
    else if (file.endsWith('.plan.json')) savePlan(db, { ...loadPlan(db), ...JSON.parse(readFileSync(path, 'utf8')) })
    else if (file.endsWith('.vehicles.json'))
      for (const meta of JSON.parse(readFileSync(path, 'utf8')) as VehicleMeta[]) saveVehicle(db, { personId, meta })
    else if (file.endsWith('.assets.json'))
      for (const it of JSON.parse(readFileSync(path, 'utf8')) as { meta: ManualMeta; entries?: { date: string; value: number }[] }[]) {
        const id = saveManualAsset(db, { personId, meta: it.meta })
        for (const e of it.entries ?? []) addManualEntry(db, id, e.date, e.value)
      }
  }
  const snapshot = buildPhoneSnapshot(db, [], new Date().toISOString())
  const passphrase = 'demo passphrase 123'
  const sealed = await seal(snapshot, await vaultKey(passphrase, undefined, 1000))
  writeFileSync(resolve('dist-phone/demo.json'), JSON.stringify({ sealed, passphrase }))
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
}, 60_000)
