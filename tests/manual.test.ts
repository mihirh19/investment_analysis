import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { persistBundle } from '../src/main/importers/bundle'
import { mapCasJson, type DepositoryCas } from '../src/main/importers/cas'
import { refreshCrypto, refreshMetals, weekly } from '../src/main/market/extra'
import { addMonths, addYears, todayIso } from '../src/main/portfolio/dates'
import { createServices, type Services } from '../src/main/services'

let dir: string
let db: Db
let close: () => void
let svc: Services
const ME = 1
const today = todayIso()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fp-manual-'))
  const o = openDatabase(join(dir, 't.db'), 'f'.repeat(64), resolve('drizzle'))
  db = o.db
  close = () => o.sqlite.close()
  svc = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s })
  const now = new Date().toISOString()
  db.insert(schema.marketPrices)
    .values([
      { key: 'XAU', price: 10000, prevClose: 9900, asOf: now, source: 'TEST', fetchedAt: now },
      { key: 'XAG', price: 120, prevClose: 118, asOf: now, source: 'TEST', fetchedAt: now },
      { key: 'CRYPTO:BTC', price: 8000000, prevClose: 7600000, asOf: now, source: 'TEST', fetchedAt: now }
    ])
    .run()
})
afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const save = (meta: Parameters<Services['saveManualAsset']>[0]['meta'], personId = ME) =>
  svc.saveManualAsset({ personId, meta })

describe('manual assets in holdings', () => {
  it('values every kind and keeps each in its asset class', async () => {
    await save({ kind: 'DEPOSIT', name: 'SBI FD', institution: 'SBI', subtype: 'BANK_FD', principal: 100000, rate: 7, startDate: addYears(today, -1), maturityDate: addYears(today, 1), compounding: 'QUARTERLY', payout: 'CUMULATIVE' })
    await save({ kind: 'SGB', name: 'SGB 2021 S-V', grams: 10, issuePrice: 4790, issueDate: '2021-08-17' })
    await save({ kind: 'METAL', name: 'Coins', metal: 'GOLD', form: 'PHYSICAL', grams: 10, purity: 0.999, cost: 50000, purchaseDate: '2020-01-01' })
    await save({ kind: 'CRYPTO', name: 'Bitcoin', symbol: 'btc', quantity: 0.01, cost: 50000, purchaseDate: '2024-01-01' })
    const flat = await save({ kind: 'PROPERTY', name: 'Flat', propertyType: 'RESIDENTIAL', purchasePrice: 5000000, purchaseDate: '2019-01-01' })
    svc.addManualEntry(flat, addMonths(today, -2), 7500000)
    const cash = await save({ kind: 'CASH', name: 'HDFC savings', rate: 3 })
    svc.addManualEntry(cash, today, 200000)

    const rows = svc.listHoldings(ME)
    const by = (n: string) => rows.find((r) => r.instrumentName === n)!
    expect(by('SBI FD')).toMatchObject({ assetClass: 'FD', platform: 'BANK', priceSource: 'ESTIMATE', investedInr: 100000 })
    expect(by('SBI FD').marketValueInr!).toBeGreaterThan(107000)
    expect(by('SGB 2021 S-V')).toMatchObject({ assetClass: 'GOLD', marketValueInr: 100000, investedInr: 47900, priceSource: 'LIVE', quantity: 10 })
    expect(by('SGB 2021 S-V').dayChangeInr!).toBeCloseTo(1000, 0)
    expect(by('Coins')).toMatchObject({ assetClass: 'GOLD', marketValueInr: 99900 })
    expect(by('Bitcoin')).toMatchObject({ assetClass: 'CRYPTO', symbol: 'BTC', marketValueInr: 80000, quantity: 0.01 })
    expect(by('Bitcoin').dayChangeInr!).toBeCloseTo(4000, 0)
    expect(by('Flat')).toMatchObject({ assetClass: 'REAL_ESTATE', marketValueInr: 7500000, priceSource: 'MANUAL' })
    expect(by('HDFC savings')).toMatchObject({ assetClass: 'CASH', marketValueInr: 200000 })

    const mix = Object.fromEntries(svc.getExposure(ME).assetMix.map((m) => [m.type, m.valueInr]))
    expect(mix.GOLD).toBeCloseTo(199900)
    expect(mix.CRYPTO).toBeCloseTo(80000)
    expect(mix.REAL_ESTATE).toBeCloseTo(7500000)
    expect(mix.CASH).toBeCloseTo(200000)
    expect(mix.DEBT).toBeGreaterThan(107000)
  })

  it('validates input and can edit and delete', async () => {
    await expect(save({ kind: 'DEPOSIT', name: 'Bad', subtype: 'BANK_FD', principal: 0, rate: 7, startDate: today, maturityDate: today, compounding: 'QUARTERLY', payout: 'CUMULATIVE' })).rejects.toThrow(/Amount/)
    await expect(save({ kind: 'METAL', name: 'X', metal: 'GOLD', form: 'PHYSICAL', grams: 1, purity: 22, cost: 1, purchaseDate: today })).rejects.toThrow(/Purity/)
    const id = await save({ kind: 'OTHER', name: 'P2P', cost: 10000, purchaseDate: '2024-01-01' })
    await svc.saveManualAsset({ accountId: id, personId: 2, meta: { kind: 'OTHER', name: 'P2P lending', cost: 12000, purchaseDate: '2024-01-01' } })
    const [v] = svc.listManualAssets()
    expect(v).toMatchObject({ personId: 2, value: 12000, liquidity: 'ILLIQUID' })
    expect(v.meta.name).toBe('P2P lending')
    expect(() => svc.addManualEntry(id, '2999-01-01', 1)).toThrow(/future/)
    svc.deleteManualAsset(id)
    expect(svc.listManualAssets()).toHaveLength(0)
    expect(svc.listHoldings()).toHaveLength(0)
  })

  it('only allows value entries for kinds valued by hand', async () => {
    const fd = await save({ kind: 'DEPOSIT', name: 'FD', subtype: 'BANK_FD', principal: 1000, rate: 7, startDate: '2025-01-01', maturityDate: '2027-01-01', compounding: 'QUARTERLY', payout: 'CUMULATIVE' })
    expect(() => svc.addManualEntry(fd, today, 5)).toThrow(/automatically/)
  })
})

describe('analysis', () => {
  it('builds XIRR, scorecard, income, maturities, liquidity and history', async () => {
    await save({ kind: 'DEPOSIT', name: 'FD 1', subtype: 'BANK_FD', principal: 100000, rate: 8, startDate: addYears(today, -2), maturityDate: addMonths(today, 6), compounding: 'QUARTERLY', payout: 'CUMULATIVE' })
    await save({ kind: 'DEPOSIT', name: 'SCSS', subtype: 'SCSS', principal: 500000, rate: 8.2, startDate: addYears(today, -1), maturityDate: addYears(today, 4), compounding: 'SIMPLE', payout: 'QUARTERLY' })
    await save({ kind: 'CRYPTO', name: 'Bitcoin', symbol: 'BTC', quantity: 0.01, cost: 50000, purchaseDate: addYears(today, -1) })
    await save({ kind: 'PPF', name: 'PPF', scheme: 'PPF', openDate: '2015-06-10', rate: 7.1, yearlyContribution: 150000 })

    const a = svc.getAnalysis(ME)
    const fd = a.scorecard.find((s) => s.assetClass === 'FD')!
    expect(fd.holdings).toBe(2)
    expect(fd.xirr!).toBeCloseTo(0.0824, 2) // ≈ the two rates' effective yields
    expect(fd.xirrCoverage).toBe(1)
    expect(fd.incomeThisFy).toBeGreaterThan(0)
    expect(a.scorecard.find((s) => s.assetClass === 'CRYPTO')!.xirr!).toBeCloseTo(0.6, 1) // 50k → 80k in a year
    expect(a.scorecard.find((s) => s.assetClass === 'PPF')!.xirrCoverage).toBe(0) // passbook balances have no dated flows
    expect(a.xirr.coverage).toBeGreaterThan(0)
    expect(a.xirr.coverage).toBeLessThan(1)

    expect(a.maturities.map((m) => m.items.map((i) => i.name)).flat()).toEqual(expect.arrayContaining(['FD 1', 'SCSS', 'PPF']))
    const scssPayouts = a.upcoming.filter((u) => u.holding === 'SCSS' && u.kind === 'INTEREST')
    expect(scssPayouts).toHaveLength(4)
    expect(scssPayouts[0].amount).toBeCloseTo((500000 * 0.082) / 4)

    const liq = Object.fromEntries(a.liquidity.map((l) => [l.bucket, l.valueInr]))
    expect(liq.LIQUID).toBeCloseTo(80000)
    expect(liq.LOCKED).toBeGreaterThan(0) // PPF
    expect(liq.BREAKABLE).toBeGreaterThan(600000)

    expect(a.income.at(-1)!.interest).toBeGreaterThan(0)
    expect(a.history.months.at(-1)).toBe(today)
    const debt = a.history.series.find((s) => s.group === 'DEBT')!
    expect(debt.values.at(-1)!).toBeGreaterThan(600000)
    // With no passbook entry, PPF is projected from opening: 11+ years of ₹1.5L plus interest.
    expect(a.treemap[0].name).toBe('PPF')
    expect(a.treemap[0].valueInr).toBeGreaterThan(2500000)
    expect(a.treemap[0].valueInr).toBeLessThan(3500000)
    expect(a.concentration.top10Share).toBeCloseTo(1)
  })

  it('computes XIRR for traded stocks from their trades and dividends', () => {
    const cas: DepositoryCas = {
      statement_period: { from: '01-Sep-2026', to: '30-Sep-2026' },
      file_type: 'CDSL',
      accounts: [{ name: 'ZERODHA BROKING LIMITED', type: 'CDSL Demat Account', dp_id: '1', client_id: '2', equities: [], mutual_funds: [] }],
      nps: null
    }
    persistBundle(db, { personId: ME, kind: 'CAS_PDF', fileName: 'c.pdf', bundle: mapCasJson(cas) })
    svc.addManualTransaction({ personId: ME, platform: 'ZERODHA', date: addYears(today, -1), type: 'BUY', assetClass: 'EQUITY_IN', name: 'Infosys', symbol: 'INFY', quantity: 10, price: 1000, currency: 'INR' })
    // Price it at 1,100 today.
    const inst = db.select().from(schema.instruments).all().find((i) => i.symbolNse === 'INFY')!
    const now = new Date().toISOString()
    db.insert(schema.quotes).values({ instrumentId: inst.id, price: 1100, prevClose: 1090, currency: 'INR', asOf: now, source: 'YAHOO', fetchedAt: now }).run()
    const a = svc.getAnalysis(ME)
    const s = a.scorecard.find((x) => x.assetClass === 'EQUITY_IN')!
    expect(s.xirr!).toBeCloseTo(0.1, 2)
    expect(s.xirrCoverage).toBe(1)
    expect(a.movers[0]).toMatchObject({ name: 'Infosys', gainInr: 1000 })
  })
})

describe('metal and crypto prices', () => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
  const chart = (price: number, prev: number) => ({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: price, chartPreviousClose: prev, regularMarketTime: 1791539100 } }], error: null } })

  it('converts COMEX gold to INR per gram with the India premium', async () => {
    const now = new Date().toISOString()
    db.insert(schema.fxRates).values({ pair: 'USDINR', rate: 90, prevClose: 90, asOf: now, fetchedAt: now }).run()
    const f = (async (u: string | URL | Request) => {
      const url = String(u)
      if (url.includes('GC%3DF')) return json(chart(3110.34768, 3000))
      if (url.includes('SI%3DF')) return json(chart(31.1034768, 30))
      if (url.includes('BTC-USD')) return json(chart(80000, 79000))
      return new Response('', { status: 404 })
    }) as typeof fetch
    await refreshMetals(db, f)
    const gold = svc.getMetalPrices()
    // 3110.35 USD/oz = 100 USD/g → ₹9,000/g → +6% = ₹9,540
    expect(gold.goldPerGram).toBeCloseTo(9540, 0)
    expect(gold.silverPerGram).toBeCloseTo(95.4, 1)
    expect(gold.premiumPct).toBe(6)

    await save({ kind: 'CRYPTO', name: 'BTC', symbol: 'BTC', quantity: 1, cost: 1, purchaseDate: '2024-01-01' })
    expect(await refreshCrypto(db, f)).toEqual([])
    expect(db.select().from(schema.marketPrices).all().find((p) => p.key === 'CRYPTO:BTC')!.price).toBe(7200000)
  })

  it('downsamples daily history to one close per week', () => {
    const pts = ['2026-10-05', '2026-10-06', '2026-10-09', '2026-10-12', '2026-10-13'].map((date, i) => ({ date, close: i }))
    expect(weekly(pts)).toEqual([
      { date: '2026-10-09', close: 2 },
      { date: '2026-10-13', close: 4 }
    ])
  })
})
