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
import { saveStatement } from '../src/main/statements'
import { saveTargets } from '../src/main/portfolio/rebalance'
import type { SpendCategory } from '../src/shared/ai'

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
  // A made-up card statement, so the Spending tab and bill reminders have something to show.
  const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
  const txn = (n: number, merchant: string, amount: number, category: SpendCategory) => ({
    date: d(n),
    description: merchant.toUpperCase(),
    merchant,
    amount,
    direction: 'DEBIT' as const,
    category,
    isEmi: false
  })
  saveStatement(
    db,
    1,
    {
      kind: 'CREDIT_CARD',
      institution: 'Demo Bank',
      accountName: 'Rewards Card',
      last4: '4321',
      holderName: null,
      periodFrom: d(70),
      periodTo: d(4),
      statementDate: d(4),
      dueDate: d(-5),
      totalDue: 18640,
      minimumDue: 932,
      creditLimit: 200000,
      openingBalance: null,
      closingBalance: null,
      rewardPoints: null,
      transactions: [
        txn(66, 'BigBasket', 3120, 'GROCERIES'),
        txn(60, 'Swiggy', 640, 'FOOD_DINING'),
        txn(52, 'HPCL', 3000, 'FUEL'),
        txn(40, 'Amazon', 2499, 'SHOPPING'),
        txn(33, 'BigBasket', 2860, 'GROCERIES'),
        txn(27, 'Apollo Pharmacy', 1180, 'HEALTH'),
        txn(20, 'Zomato', 820, 'FOOD_DINING'),
        txn(14, 'HPCL', 2500, 'FUEL'),
        txn(9, 'Netflix', 649, 'ENTERTAINMENT'),
        txn(6, 'BigBasket', 3410, 'GROCERIES')
      ],
      trades: []
    },
    'demo'
  )
  // A target mix, so the Doing tab's Mix has something to compare with.
  saveTargets(db, null, { buckets: { EQUITY_IN: 0.45, EQUITY_INTL: 0.1, DEBT: 0.35, GOLD: 0.07, CASH: 0.03 }, band: 0.05 })
  // A made-up key so the demo shows the Ask button (no request with it can succeed).
  const snapshot = buildPhoneSnapshot(db, [], new Date().toISOString(), { apiKey: 'sk-ant-demo-not-a-real-key', model: 'claude-opus-5-5' })
  const passphrase = 'demo passphrase 123'
  const sealed = await seal(snapshot, await vaultKey(passphrase, undefined, 1000))
  writeFileSync(resolve('dist-phone/demo.json'), JSON.stringify({ sealed, passphrase }))
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
}, 60_000)
