import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import type { HoldingRow } from '../src/shared/types'
import { capPeriods, capUrls, parseCapList } from '../src/main/market/marketcap'
import { debtTypeOf, issuerOf, ratingOf } from '../src/main/portfolio/debt'
import { buildExposure } from '../src/main/portfolio/exposure'

describe("AMFI's market-cap list", () => {
  it('reads company, ISIN, average market cap and SEBI band', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Average Market Capitalization of listed companies during the six months ended 30 June 2026'],
        [
          'Sr. No.',
          'Company name',
          'ISIN',
          'BSE Symbol',
          'BSE 6 month Avg Total Market Cap in (Rs. Crs.)',
          'NSE Symbol',
          'NSE 6 month Avg Total Market Cap (Rs. Crs.)',
          'MSEI Symbol',
          'MSEI 6 month Avg Total Market Cap in (Rs Crs.)',
          'Average of All Exchanges (Rs. Cr.)',
          'Categorization as per SEBI Circular dated Oct 6, 2017'
        ],
        [1, 'Reliance Industries Ltd', 'INE002A01018', 'RELIANCE', 1, 'RELIANCE', 1, '-', '', 1873286.77, 'Large Cap'],
        [249, 'Godfrey Phillips India Ltd.', 'INE260B01028', 'GODFRYPHLP', 1, 'GODFRYPHLP', 1, '-', '', 33668.5, 'Mid Cap'],
        [251, 'Navin Fluorine International Limited', 'INE048G01026', 'N', 1, 'N', 1, '-', '', 33441.9, 'Small Cap']
      ]),
      'FINAL'
    )
    const rows = parseCapList(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    expect(rows.map((r) => [r.isin, r.category, r.rank])).toEqual([
      ['INE002A01018', 'LARGE', 1],
      ['INE260B01028', 'MID', 249],
      ['INE048G01026', 'SMALL', 251]
    ])
  })

  it('looks for the newest half-year first, at AMFI’s addresses', () => {
    expect(capPeriods(new Date('2026-10-11T00:00:00Z'))).toEqual(['2026-06-30', '2025-12-31', '2025-06-30'])
    expect(capPeriods(new Date('2027-02-01T00:00:00Z'))[0]).toBe('2026-12-31')
    expect(capUrls('2026-06-30')[0]).toBe('https://portal.amfiindia.com/spages/AverageMarketCapitalization30Jun2026.xlsx')
  })
})

describe('debt papers', () => {
  it('tells government, corporate, money-market and securitised paper apart, including newer ISINs', () => {
    expect(debtTypeOf('IN0020230085', '7.18% Government of India (14/08/2033)')).toBe('GSEC')
    expect(debtTypeOf('IN1520160087', '6.54% Tamilnadu State Development Loans (25/02/2029)')).toBe('SDL')
    expect(debtTypeOf('IN002026X123', '91 Days Tbill (MD 12/11/2026)')).toBe('TBILL')
    expect(debtTypeOf('INE296A07RX7', '8.75% Bajaj Finance Ltd (2027)')).toBe('CORPORATE')
    expect(debtTypeOf('INE916DA7TE6', '7.288% Kotak Mahindra Prime Limited (24/10/2028)')).toBe('CORPORATE')
    expect(debtTypeOf('INE090AD6337', 'ICICI Bank Limited (25/03/2027)')).toBe('MONEY_MARKET')
    expect(debtTypeOf('INE2I7F15012', 'Siddhivinayak Securitisation Trust (28/09/2030)')).toBe('SECURITISED')
  })

  it('reads ratings as printed by fund houses', () => {
    expect(ratingOf('CRISIL AAA', 'CORPORATE')).toBe('AAA')
    expect(ratingOf('ICRA A1+', 'MONEY_MARKET')).toBe('AAA')
    expect(ratingOf('IND AA+(CE)', 'CORPORATE')).toBe('AA')
    expect(ratingOf('CARE A-', 'CORPORATE')).toBe('A_BELOW')
    expect(ratingOf('BWR BBB', 'CORPORATE')).toBe('A_BELOW')
    expect(ratingOf('Sovereign', 'CORPORATE')).toBe('SOVEREIGN')
    expect(ratingOf('', 'GSEC')).toBe('SOVEREIGN')
    expect(ratingOf('Realty', 'OTHER')).toBe('UNRATED')
  })

  it('names the issuer', () => {
    expect(issuerOf('7.42% Power Finance Corporation Limited (15/04/2028) **', 'CORPORATE')).toBe(
      'Power Finance Corporation Limited'
    )
    expect(issuerOf('6.54% Tamilnadu State Development Loans (25/02/2029)', 'SDL')).toBe('Tamilnadu (state loans)')
    expect(issuerOf('91 Days Tbill (MD 12/11/2026)', 'TBILL')).toBe('Government of India')
  })
})

describe('market-cap bands and debt in the exposure report', () => {
  const row = (over: Partial<HoldingRow>): HoldingRow =>
    ({
      instrumentId: 1,
      instrumentName: 'X',
      isin: null,
      assetClass: 'EQUITY_IN',
      marketValueInr: 0,
      investedInr: 0,
      sector: null,
      ...over
    }) as HoldingRow
  const fundRow = (name: string, isin: string | null, assetType: string, weight: number, industryRaw: string | null) =>
    ({
      id: 0,
      fundInstrumentId: 10,
      asOf: '2026-09-30',
      source: 'AMC_AUTO',
      name,
      isin,
      sector: null,
      industryRaw,
      assetType,
      country: 'IN',
      weight,
      importBatchId: null
    }) as never

  it('bands each company and splits debt by type, rating and issuer', () => {
    const e = buildExposure(
      [
        row({ instrumentId: 1, instrumentName: 'Reliance', isin: 'INE002A01018', marketValueInr: 1000 }),
        row({ instrumentId: 2, instrumentName: 'Unlisted Co', isin: 'INE00ZZ01017', marketValueInr: 500 }),
        row({ instrumentId: 3, instrumentName: 'PPF', assetClass: 'PPF', marketValueInr: 2000 }),
        row({ instrumentId: 10, instrumentName: 'Hybrid Fund', assetClass: 'MF', marketValueInr: 1000 })
      ],
      new Map([
        [
          10,
          [
            fundRow('Navin Fluorine', 'INE048G01026', 'EQUITY', 0.4, 'Chemicals'),
            fundRow('7.18% Government of India (2033)', 'IN0020230085', 'DEBT', 0.3, 'Sovereign'),
            fundRow('8.75% Bajaj Finance Ltd (2027)', 'INE296A07RX7', 'DEBT', 0.3, 'CRISIL AA+')
          ]
        ]
      ]),
      new Map(),
      new Map(),
      {
        byIsin: new Map([
          ['INE002A01018', 'LARGE'],
          ['INE048G01026', 'SMALL']
        ]),
        period: '2026-06-30'
      }
    )
    expect(Object.fromEntries(e.marketCap.map((m) => [m.cap, m.valueInr]))).toEqual({
      LARGE: 1000,
      UNLISTED: 500,
      SMALL: 400
    })
    expect(e.capListPeriod).toBe('2026-06-30')
    expect(e.companies.find((c) => c.isin === 'INE048G01026')).toMatchObject({ cap: 'SMALL', viaFundsInr: 400 })

    expect(e.debt.totalInr).toBe(2600)
    expect(Object.fromEntries(e.debt.types.map((t) => [t.type, t.valueInr]))).toEqual({
      SMALL_SAVINGS: 2000,
      GSEC: 300,
      CORPORATE: 300
    })
    expect(Object.fromEntries(e.debt.ratings.map((r) => [r.rating, r.valueInr]))).toEqual({
      SOVEREIGN: 2300,
      AA: 300
    })
    expect(e.debt.items.find((i) => i.isin === 'INE296A07RX7')).toMatchObject({
      issuer: 'Bajaj Finance Ltd',
      ratingRaw: 'CRISIL AA+',
      viaFundsInr: 300
    })
  })
})
