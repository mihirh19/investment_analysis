import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/main/db'
import { cropPrice, farmReport, saveEntry, saveSeason } from '../src/main/farm'
import { parseRajkotRates } from '../src/main/market/apmcRajkot'
import { findVariety } from '../src/shared/farm'
import { findMarket, parseLastWeek, parseMonthly, parseVarieties, refreshMandiPrices } from '../src/main/market/mandi'

// Shaped like Agmarknet's answers (trimmed).
const WEEK = {
  success: true,
  columns: [{ key: 'variety' }, { key: '2026-10-21' }, { key: '2026-10-20' }, { key: '2026-10-19' }, { key: 'unitOfPrice' }],
  data: [
    { variety: 'Rajkot APMC - Bold', '2026-10-21': 7800.0, '2026-10-20': 'NR', '2026-10-19': 7750.0, unitOfPrice: 'Rs./Quintal' },
    { variety: 'Rajkot APMC - G20', '2026-10-21': 8100.0, '2026-10-20': 'NR', '2026-10-19': 8050.0, unitOfPrice: 'Rs./Quintal' }
  ]
}
/** Rajkot's monthly average, the same whichever month's report it appears in. */
const rajkot = (y: number, m: number) => 6000 + (y - 2025) * 1000 + m * 10
const MONTHLY = (y: number, m: number) => {
  const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1]
  return {
    rows: [
      { market: 'Dhoraji APMC', [`prices_${names[m - 1]}_${y}`]: 6000 },
      { market: 'Rajkot APMC', [`prices_${names[m - 1]}_${y}`]: rajkot(y, m), [`prices_${names[prev[1] - 1]}_${prev[0]}`]: rajkot(prev[0], prev[1]), [`prices_${names[m - 1]}_${y - 1}`]: rajkot(y - 1, m) }
    ]
  }
}
const MARKETS = [
  { id: 61, mkt_name: 'Gondal APMC', state_id: 11, district_id: 157 },
  { id: 2546, mkt_name: 'Gondal(Veg.market Gondal) APMC', state_id: 11, district_id: 157 },
  { id: 60, mkt_name: 'Rajkot APMC', state_id: 11, district_id: 157 },
  { id: 9999, mkt_name: 'Rajkot APMC', state_id: 5, district_id: 1 }
]

describe('reading Agmarknet', () => {
  it('takes the middle of the varieties’ prices each day, skipping days not reported', () => {
    expect(parseLastWeek(WEEK)).toEqual([
      { date: '2026-10-19', modal: 7900, min: 7750, max: 8050 },
      { date: '2026-10-21', modal: 7950, min: 7800, max: 8100 }
    ])
  })
  it('reads each variety’s prices on their own', () => {
    expect(parseVarieties(WEEK)).toEqual([
      { variety: 'Bold', points: [{ date: '2026-10-21', price: 7800 }, { date: '2026-10-19', price: 7750 }] },
      { variety: 'G20', points: [{ date: '2026-10-21', price: 8100 }, { date: '2026-10-19', price: 8050 }] }
    ])
  })
  it('finds the mandi a typed name means, Gujarat first, the plain market before the vegetable yard', () => {
    const list = MARKETS.map((m) => ({ id: m.id, name: m.mkt_name, stateId: m.state_id, districtId: m.district_id }))
    expect(findMarket(list, 'rajkot')?.id).toBe(60)
    expect(findMarket(list, 'Gondal APMC')?.id).toBe(61)
    expect(findMarket(list, 'Gondal')?.id).toBe(61)
    expect(findMarket(list, 'Nowhere')).toBeNull()
  })
  it('reads one market’s monthly averages: this month, the last, and a year before', () => {
    expect(parseMonthly(MONTHLY(2026, 9), 'Rajkot APMC', 2026, 9)).toEqual([
      { date: '2026-09-15', price: 7090 },
      { date: '2026-08-15', price: 7080 },
      { date: '2025-09-15', price: 6090 }
    ])
  })
})

const RAJKOT = readFileSync(resolve('tests/fixtures/web/apmc-rajkot-daily-rates.html'), 'utf8')

describe('Rajkot APMC’s own rates and the varieties', () => {
  it('reads the yard’s Gujarati table: groundnut jini and jadi, per quintal', () => {
    const r = parseRajkotRates(RAJKOT)
    expect(r.find((x) => x.crop === 'GROUNDNUT' && x.cls === 'Jini')).toEqual({ crop: 'GROUNDNUT', cls: 'Jini', date: '2026-10-22', min: 6355, max: 8975 })
    expect(r.find((x) => x.crop === 'GROUNDNUT' && x.cls === 'Jadi')).toMatchObject({ min: 6125, max: 8780 })
    expect(r.find((x) => x.crop === 'WHEAT' && x.cls === 'Lokwan')).toMatchObject({ min: 2800, max: 3120 })
    // "મગ" (moong) is not mistaken for groundnut, and the vegetable list's repeats are left out.
    expect(r.find((x) => x.crop === 'MOONG')).toMatchObject({ min: 6500, max: 9800 })
    expect(r.filter((x) => x.crop === 'GROUNDNUT')).toHaveLength(2)
  })
  it('knows varieties by the names farmers use', () => {
    for (const n of ['37', 'G37', 'g-37', 'TJ-37', 'tg 37']) expect(findVariety('GROUNDNUT', n)?.name).toBe('TG-37A')
    expect(findVariety('GROUNDNUT', 'gini')).toMatchObject({ name: 'Jini', cls: 'Jini' })
    expect(findVariety('GROUNDNUT', 'G20')).toMatchObject({ name: 'GG-20', cls: 'Jadi' })
    expect(findVariety('GROUNDNUT', 'Unknown 99')).toBeNull()
  })
})

describe('fetching the farm’s prices', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-mandi-'))
    const o = openDatabase(join(dir, 't.db'), '6'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fetches only the crops the farm has, values the godown, and keeps a year of monthly averages', async () => {
    const asked: string[] = []
    const f = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      asked.push(url.pathname + url.search)
      const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
      if (url.pathname.endsWith('/filters')) return json({ data: { market_data: MARKETS } })
      if (url.pathname.endsWith('/lastweek')) return json(WEEK)
      if (url.pathname.endsWith('/wholesale-prices-monthly'))
        return json(MONTHLY(Number(url.searchParams.get('year')), Number(url.searchParams.get('month'))))
      if (url.hostname === 'www.apmcrajkot.com') return new Response(RAJKOT)
      return new Response('', { status: 404 })
    }) as typeof fetch

    expect(await refreshMandiPrices(db, f, false, new Date('2026-10-22T06:00:00Z'))).toEqual([])
    expect(asked).toEqual([]) // nothing grown, nothing fetched

    const s = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', season: 'KHARIF', year: 2026, status: 'GROWING' })
    saveEntry(db, { seasonId: s, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 50, rate: null, amount: 0, charges: null, mandi: null, note: null })
    expect(await refreshMandiPrices(db, f, false, new Date('2026-10-22T06:00:00Z'))).toEqual([])
    expect(asked.filter((a) => a.includes('lastweek'))).toEqual(['/v1/prices-and-arrivals/market-price/lastweek?marketId=60&stateId=11&commodityId=10&includeExcel=false'])
    expect(asked.filter((a) => a.includes('monthly'))).toHaveLength(12)
    expect(asked.filter((a) => a.includes('daily_rates'))).toHaveLength(1)

    const r = farmReport(db, undefined, '2026-10-22')
    expect(r.stock).toMatchObject([{ crop: 'GROUNDNUT', quantityQtl: 50, price: 7950, priceDate: '2026-10-21', value: 397500 }])
    const p = cropPrice(db, 'GROUNDNUT', 'Rajkot', '2026-10-22')
    expect(p.latest).toMatchObject({ modal: 7950, min: 7800, max: 8100 })
    // A year ago comes from the monthly average for October 2025.
    expect(p.yearAgo).toBe(6100)
    expect(p.msp).toBe(7517)
    // The chart has the months before the daily prices start.
    expect(p.history.length).toBeGreaterThan(10)

    // A variety the mandi reports is valued at its own price; one it doesn't, at the middle of all.
    const g20 = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', variety: 'G20', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: g20, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 10, rate: null, amount: 0, charges: null, mandi: null, note: null })
    const javeri = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', variety: 'Javeri', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: javeri, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 5, rate: null, amount: 0, charges: null, mandi: null, note: null })
    const byVariety = farmReport(db, undefined, '2026-10-22').stock
    expect(byVariety.find((x) => x.variety === 'G20')).toMatchObject({ price: 8100, pricedAs: { kind: 'VARIETY' }, value: 81000 })
    expect(byVariety.find((x) => x.variety === 'Javeri')).toMatchObject({ price: 7950, pricedAs: { kind: 'CROP' } })
    // TG-37A isn't quoted by name: it sells as jini, at the yard's jini rate (middle of ₹6,355–8,975).
    const tg = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', variety: 'TG-37A', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: tg, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 4, rate: null, amount: 0, charges: null, mandi: null, note: null })
    // GG-20 is quoted by Agmarknet as "G20".
    const gg = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', variety: 'GG-20', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: gg, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 2, rate: null, amount: 0, charges: null, mandi: null, note: null })
    // Marked by hand as jadi, though the variety isn't known.
    const other = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', variety: 'Our own seed', priceClass: 'Jadi', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: other, date: '2026-10-18', type: 'HARVEST', costKind: null, quantityQtl: 1, rate: null, amount: 0, charges: null, mandi: null, note: null })
    const st = farmReport(db, undefined, '2026-10-22').stock
    expect(st.find((x) => x.variety === 'TG-37A')).toMatchObject({ price: 7665, pricedAs: { kind: 'CLASS', name: 'Jini' } })
    expect(st.find((x) => x.variety === 'GG-20')).toMatchObject({ price: 8100, pricedAs: { kind: 'VARIETY', name: 'G20' } })
    expect(st.find((x) => x.variety === 'Our own seed')).toMatchObject({ price: 7453, pricedAs: { kind: 'CLASS', name: 'Jadi' } })
    expect(cropPrice(db, 'GROUNDNUT', 'Rajkot', '2026-10-22').varieties.map((v) => [v.name, v.source, v.min])).toEqual([
      ['G20', 'AGMARKNET', null],
      ['Bold', 'AGMARKNET', null],
      ['Jini (fine)', 'APMC', 6355],
      ['Jadi (bold)', 'APMC', 6125]
    ])

    // Within six hours: nothing fetched again unless asked.
    const before = asked.length
    await refreshMandiPrices(db, f, false, new Date('2026-10-22T09:00:00Z'))
    expect(asked.length).toBe(before)
    await refreshMandiPrices(db, f, true, new Date('2026-10-22T09:00:00Z'))
    // Forced: the week again, and only the last two months now that the year is there.
    expect(asked.length).toBe(before + 1 + 2 + 1)
  })

  it('says which crops it found no price for, and why', async () => {
    const f = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/filters')) return new Response(JSON.stringify({ data: { market_data: MARKETS } }))
      if (url.pathname.endsWith('/lastweek')) return new Response(JSON.stringify({ columns: [], data: [] }))
      return new Response(JSON.stringify({ rows: [] }))
    }) as typeof fetch
    saveSeason(db, { personId: 1, crop: 'CUMIN', season: 'RABI', year: 2027, status: 'GROWING', market: 'Unknownpur' })
    saveSeason(db, { personId: 1, crop: 'WHEAT', season: 'RABI', year: 2027, status: 'GROWING' })
    const missed = await refreshMandiPrices(db, f, true, new Date('2026-10-22T06:00:00Z'))
    expect(missed).toEqual([
      'Cumin (jeera) at Unknownpur (Agmarknet has no mandi by that name)',
      'Wheat at Rajkot',
      'Rajkot APMC’s own daily rates (the site didn’t answer)'
    ])
    expect(farmReport(db).priceError).toMatch(/Unknownpur/)
  })
})
