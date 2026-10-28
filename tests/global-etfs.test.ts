import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, schema } from '../src/main/db'
import { fundsFromScreen, issuerOf, portfolioSnapshots, savePortfolioSnapshot, secContact, setSecContact, storedGlobal, ucitsSeed } from '../src/main/funds/global'
import type { EtfScreenQuote } from '../src/main/market/yahoo'
import { allocOf, nportFilings, parseNport, sebiTarget } from '../src/shared/fundPortfolio'
import { computeFundMetrics, inrReturn, riskFreeFor, type PricePt } from '../src/shared/fundScreener'
import { baseCurrency, globalProfile, isUcitsListing, pickListings } from '../src/shared/globalEtfs'

const q = (symbol: string, name: string, extra: Partial<EtfScreenQuote> = {}): EtfScreenQuote => ({ symbol, name, netAssets: 1e9, expenseRatio: 0.2, exchange: 'NYSEArca', currency: 'USD', ...extra })

describe('the US ETF list', () => {
  it('reads each ETF’s kind, index, size and cost from Yahoo’s screener', () => {
    const f = fundsFromScreen('US', [
      q('IVV', 'iShares Core S&P 500 ETF', { netAssets: 881e9, expenseRatio: 0.03 }),
      q('TQQQ', 'ProShares UltraPro QQQ'),
      q('TLT', 'iShares 20+ Year Treasury Bond ETF')
    ])
    const by = (t: string) => f.find((x) => x.ticker === t)!
    expect(by('IVV')).toMatchObject({ code: 'US:IVV', market: 'US', vehicle: 'ETF', category: 'US large cap', group: 'Equity', currency: 'USD', fundHouse: 'iShares', leveraged: false, assetsUsd: 881e9, ter: 0.03 })
    expect(by('TQQQ')).toMatchObject({ category: 'Leveraged & inverse', leveraged: true })
    expect(by('TLT')).toMatchObject({ group: 'Debt', category: 'Government bonds' })
    expect(globalProfile('Invesco QQQ Trust, Series 1', 'US', 'USD').bench?.symbol).toBe('^GSPC')
    expect(globalProfile('Invesco NASDAQ 100 ETF', 'US', 'USD').bench).toEqual({ symbol: '^NDX', label: 'Nasdaq 100' })
    expect(globalProfile('iShares Russell 2000 ETF', 'US', 'USD').bench?.symbol).toBe('^RUT')
    expect(globalProfile('iShares Semiconductor ETF', 'US', 'USD')).toMatchObject({ category: 'Technology', bench: { symbol: '^NDX' } })
    expect(globalProfile('SPDR Gold Shares', 'US', 'USD')).toMatchObject({ category: 'Commodities & crypto', bench: null })
    expect(globalProfile('VanEck Gold Miners ETF', 'US', 'USD').group).toBe('Equity')
    expect(globalProfile('iShares Short Treasury Bond ETF', 'US', 'USD')).toMatchObject({ group: 'Debt', leveraged: false })
    expect(globalProfile('ProShares Short S&P500', 'US', 'USD').leveraged).toBe(true)
    expect(globalProfile('ProShares UltraShort QQQ', 'US', 'USD').leveraged).toBe(true)
    expect(globalProfile('JPMorgan Ultra-Short Income ETF', 'US', 'USD')).toMatchObject({ leveraged: false, category: 'Money market' })
    expect(globalProfile('HSBC Sterling Liquidity Fund UCITS ETF Acc', 'UCITS', 'GBP').category).toBe('Money market')
    expect(globalProfile('Schwab US Dividend Equity ETF', 'US', 'USD')).toMatchObject({ category: 'US equity', bench: { symbol: '^GSPC' } })
  })

  it('keeps UCITS listings, one per fund', () => {
    expect(isUcitsListing('0LO6.L', 'Vanguard S&P 500 ETF')).toBe(false)
    expect(isUcitsListing('DIA.AS', 'State Street SPDR Dow Jones Industrial Average ETF Trust')).toBe(false)
    expect(isUcitsListing('SXRZ.DE', 'iShares VII PLC - iShares Nikkei 225 ETF JPY Acc')).toBe(true)
    expect(isUcitsListing('VUAA.DE', 'Vanguard S&P 500 UCITS ETF USD Accumulation')).toBe(true)
    const picked = pickListings([
      { symbol: 'VUAA.DE', name: 'Vanguard S&P 500 UCITS ETF USD Accumulation', currency: 'EUR' },
      { symbol: 'VUAG.L', name: 'Vanguard S&P 500 UCITS ETF USD Accumulation', currency: 'GBp' },
      { symbol: 'VUAA.L', name: 'Vanguard S&P 500 UCITS ETF USD Accumulation', currency: 'USD' },
      { symbol: 'VUSA.AS', name: 'Vanguard S&P 500 UCITS ETF', currency: 'EUR' }
    ])
    expect(picked.map((x) => x.symbol)).toEqual(['VUAA.L', 'VUSA.AS'])
  })
})
describe('UCITS ETFs', () => {
  it('ships a checked list, measured in its own currency', () => {
    const s = ucitsSeed()
    expect(s.length).toBeGreaterThan(150)
    expect(new Set(s.map((x) => x.code)).size).toBe(s.length)
    expect(s.every((x) => x.market === 'UCITS' && x.code === `UC:${x.ticker}`)).toBe(true)
    const cspx = s.find((x) => x.ticker === 'CSPX.L')!
    expect(cspx).toMatchObject({ currency: 'USD', category: 'US large cap', fundHouse: 'iShares' })
    // A world ETF in euros against a world ETF in euros; in pence against one in pounds.
    expect(globalProfile('iShares Core MSCI World UCITS ETF USD (Acc)', 'UCITS', 'EUR').bench).toEqual({ symbol: 'EUNL.DE', label: 'MSCI World (via EUNL.DE)' })
    expect(globalProfile('iShares Core MSCI World UCITS ETF USD (Acc)', 'UCITS', 'GBp').bench?.symbol).toBe('SWDA.L')
    expect(globalProfile('Vanguard FTSE Emerging Markets UCITS ETF', 'UCITS', 'USD').bench?.symbol).toBe('EIMI.L')
    expect(globalProfile('iShares Core S&P 500 UCITS ETF USD (Acc)', 'UCITS', 'USD').bench).toEqual({ symbol: 'CSPX.L', label: 'S&P 500 (via CSPX.L)' })
    expect(globalProfile('iShares Core UK Gilts UCITS ETF', 'UCITS', 'GBP').group).toBe('Debt')
    expect(baseCurrency('GBp')).toBe('GBP')
    expect(riskFreeFor('USD')).toBe(0.04)
    expect(riskFreeFor('INR')).toBe(0.065)
    expect(issuerOf('State Street SPDR S&P 500 ETF Trust')).toBe('SPDR')
  })
})

describe('index tracking and rupee returns', () => {
  const series = (n: number, f: (i: number) => number, start = Date.parse('2022-01-03')): PricePt[] => {
    const out: PricePt[] = []
    let v = 100
    for (let i = 0, d = start; out.length < n; d += 86400_000) {
      if ([0, 6].includes(new Date(d).getUTCDay())) continue
      v *= 1 + f(i++)
      out.push({ date: new Date(d).toISOString().slice(0, 10), close: v })
    }
    return out
  }
  it('measures tracking error', () => {
    const idx = series(800, (i) => (i % 3 ? 0.006 : -0.009))
    const twin = idx.map((p) => ({ ...p, close: p.close * 0.5 }))
    expect(computeFundMetrics(twin, idx).trackingError).toBeCloseTo(0, 6)
    const loose = series(800, (i) => (i % 3 ? 0.006 : -0.009) + (i % 2 ? 0.003 : -0.003))
    expect(computeFundMetrics(loose, idx).trackingError).toBeGreaterThan(0.03)
  })
  it('turns a year’s return into rupees', () => {
    const fx = [
      { date: '2025-10-28', close: 80 },
      { date: '2026-10-28', close: 88 }
    ]
    expect(inrReturn(0.1, fx)).toBeCloseTo(0.21, 9)
    expect(inrReturn(0.1, null)).toBeNull()
  })
})

describe('portfolios', () => {
  it('knows SEBI’s ranges for each category', () => {
    expect(sebiTarget('Large Cap Fund')).toEqual([
      { label: 'Equity', min: 0.8, max: 1 },
      { label: 'Cash & equivalents', min: 0, max: expect.closeTo(0.2, 9) }
    ])
    expect(sebiTarget('Large & Mid Cap Fund')![0]).toMatchObject({ min: 0.7 })
    expect(sebiTarget('Aggressive Hybrid Fund')).toEqual([
      { label: 'Equity', min: 0.65, max: 0.8 },
      { label: 'Debt', min: 0.2, max: 0.35 }
    ])
    expect(sebiTarget('Liquid Fund')).toBeNull()
    expect(sebiTarget('Index Funds')).toBeNull()
    expect(sebiTarget('Index Funds', true)![0]).toMatchObject({ min: 0.95 })
    expect(allocOf([{ assetType: 'EQUITY', weight: 0.6 }, { assetType: 'DEBT', weight: 0.3 }, { assetType: 'EQUITY', weight: 0.05 }, { assetType: 'CASH', weight: 0.05 }])).toEqual([
      { label: 'Equity', weight: expect.closeTo(0.65, 9) },
      { label: 'Debt', weight: 0.3 },
      { label: 'Cash & equivalents', weight: 0.05 }
    ])
  })

  it('reads an N-PORT filing and the list of filings', () => {
    const xml = `<?xml version="1.0"?><edgarSubmission xmlns="http://www.sec.gov/edgar/nport"><formData><genInfo><repPdEnd>2026-12-31</repPdEnd><repPdDate>2026-06-30</repPdDate></genInfo>
      <invstOrSecs>
        <invstOrSec><name>Apple Inc</name><lei>x</lei><title>Apple Inc</title><cusip>037833100</cusip><identifiers><isin value="US0378331005"/></identifiers><balance>1</balance><valUSD>1</valUSD><pctVal>6.5</pctVal><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>
        <invstOrSec><name>US Treasury Bill</name><pctVal>0.4</pctVal><assetCat>DBT</assetCat><invCountry>US</invCountry></invstOrSec>
        <invstOrSec><name>Johnson &amp; Johnson</name><pctVal>1.2</pctVal><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>
        <invstOrSec><name>BlackRock Cash Fund</name><pctVal>0.3</pctVal><assetCat>STIV</assetCat><invCountry>US</invCountry></invstOrSec>
      </invstOrSecs></formData></edgarSubmission>`
    const s = parseNport(xml)
    expect(s.asOf).toBe('2026-06-30')
    expect(s.holdings.map((h) => [h.name, h.isin, h.assetType, h.weight])).toEqual([
      ['Apple Inc', 'US0378331005', 'EQUITY', 0.065],
      ['Johnson & Johnson', null, 'EQUITY', 0.012],
      ['US Treasury Bill', null, 'DEBT', 0.004],
      ['BlackRock Cash Fund', null, 'CASH', 0.003]
    ])
    expect(s.alloc[0]).toMatchObject({ label: 'Equity', weight: expect.closeTo(0.077, 9) })
    expect(() => parseNport('<x/>')).toThrow()

    const atom = `<feed><entry><category label="form type" term="NPORT-P"/><content><filing-date>2026-08-25</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/1100663/000175272426123456/0001752724-26-123456-index.htm</filing-href><filing-type>NPORT-P</filing-type></content></entry>
      <entry><content><filing-date>2026-05-26</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/1100663/000175272426099999/x-index.htm</filing-href><filing-type>NPORT-P</filing-type></content></entry>
      <entry><content><filing-date>2026-09-01</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/1100663/000175272426200000/x-index.htm</filing-href><filing-type>N-CEN</filing-type></content></entry></feed>`
    expect(nportFilings(atom)).toEqual([
      { cik: '1100663', accession: '000175272426123456', filed: '2026-08-25' },
      { cik: '1100663', accession: '000175272426099999', filed: '2026-05-26' }
    ])
  })

  it('stores snapshots and an SEC contact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-global-'))
    const o = openDatabase(join(dir, 't.db'), 'e'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      // Before the weekly list comes, the UCITS list is there on its own.
      expect(storedGlobal(db).funds.length).toBe(ucitsSeed().length)
      const snap = (asOf: string, source: 'YAHOO' | 'NPORT') => ({ asOf, source, alloc: [], sectors: [], holdings: [] })
      for (const m of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) savePortfolioSnapshot(db, 'US:IVV', snap(`2026-${m}-15`, 'YAHOO'))
      savePortfolioSnapshot(db, 'US:IVV', snap('2026-10-20', 'YAHOO'))
      savePortfolioSnapshot(db, 'US:IVV', snap('2026-06-30', 'NPORT'))
      const s = portfolioSnapshots(db, 'US:IVV')
      expect(s.filter((x) => x.source === 'YAHOO').map((x) => x.asOf)).toEqual(['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15', '2026-10-20'])
      expect(s.filter((x) => x.source === 'NPORT')).toHaveLength(1)

      expect(secContact(db)).toBeNull()
      db.insert(schema.settings).values({ key: 'google:accounts', value: JSON.stringify([{ email: 'family@gmail.com' }]) }).run()
      expect(secContact(db)).toBe('family@gmail.com')
      setSecContact(db, 'me@example.org')
      expect(secContact(db)).toBe('me@example.org')
      expect(() => setSecContact(db, 'not an email')).toThrow()
      setSecContact(db, '')
      expect(secContact(db)).toBe('family@gmail.com')
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
