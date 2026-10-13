import { describe, expect, it } from 'vitest'
import type { ManualMeta } from '../src/shared/assets'
import { addMonths, financialYearOf, monthEnds } from '../src/main/portfolio/dates'
import { engineFor, ppfMaturity, type PriceBook } from '../src/main/portfolio/engines'
import { xirr } from '../src/main/portfolio/xirr'

const book: PriceBook = {
  metal: (m) => (m === 'GOLD' ? 10000 : 120),
  crypto: (s) => (s === 'BTC' ? 8000000 : null)
}
const eng = (meta: ManualMeta, today: string, entries: { date: string; value: number }[] = []) =>
  engineFor(meta, entries, book, today)

describe('dates', () => {
  it('adds months clamping to month end', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28')
    expect(addMonths('2024-11-15', 3)).toBe('2025-02-15')
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
  })
  it('knows Indian financial years', () => {
    expect(financialYearOf('2026-05-10')).toEqual({ start: '2026-04-01', end: '2027-03-31', label: 'FY27' })
    expect(financialYearOf('2026-02-10').label).toBe('FY26')
  })
  it('lists month ends', () => {
    expect(monthEnds('2026-01-15', '2026-03-10')).toEqual(['2026-01-31', '2026-02-28', '2026-03-10'])
  })
})

describe('xirr', () => {
  it('matches a simple doubling over one year', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 200 }])).toBeCloseTo(1, 4)
  })
  it('solves SIP-style flows so that their present value is zero', () => {
    const flows = [
      { date: '2024-01-01', amount: -10000 },
      { date: '2024-04-01', amount: -10000 },
      { date: '2024-07-01', amount: -10000 },
      { date: '2024-10-01', amount: -10000 },
      { date: '2025-01-01', amount: 42500 }
    ]
    const r = xirr(flows)!
    const t0 = Date.parse('2024-01-01')
    const npv = flows.reduce((s, f) => s + f.amount / (1 + r) ** ((Date.parse(f.date) - t0) / 86400000 / 365), 0)
    expect(Math.abs(npv)).toBeLessThan(0.01)
    // ₹2,500 gain on money that was invested for ~0.6 years on average ≈ 10% a year
    expect(r).toBeGreaterThan(0.095)
    expect(r).toBeLessThan(0.106)
  })
  it('returns negative rates for losses and null when undefined', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 80 }])).toBeCloseTo(-0.2, 3)
    expect(xirr([{ date: '2025-01-01', amount: -100 }])).toBeNull()
    expect(xirr([{ date: '2025-01-01', amount: 100 }, { date: '2026-01-01', amount: 80 }])).toBeNull()
  })
})

describe('deposits', () => {
  const fd = (over: Partial<Extract<ManualMeta, { kind: 'DEPOSIT' }>> = {}): ManualMeta => ({
    kind: 'DEPOSIT', name: 'SBI FD', subtype: 'BANK_FD', principal: 100000, rate: 8, startDate: '2025-01-01',
    maturityDate: '2027-01-01', compounding: 'QUARTERLY', payout: 'CUMULATIVE', ...over
  })

  it('compounds a cumulative FD quarterly to maturity', () => {
    const e = eng(fd(), '2026-01-01')
    const m = e.maturity()!
    expect(m.date).toBe('2027-01-01')
    expect(m.value).toBeCloseTo(100000 * 1.02 ** 8, -1) // 2 years × 4 quarters at 2%
    expect(e.current().value).toBeCloseTo(100000 * 1.02 ** 4, -1)
    expect(e.liquidity().bucket).toBe('BREAKABLE')
  })

  it('pays out quarterly interest and keeps principal constant', () => {
    const e = eng(fd({ payout: 'QUARTERLY', compounding: 'QUARTERLY' }), '2026-01-01')
    expect(e.current().value).toBe(100000)
    const ev = e.events('2025-01-01', '2026-01-01')
    expect(ev).toHaveLength(4)
    expect(ev[0]).toMatchObject({ date: '2025-04-01', kind: 'INTEREST' })
    expect(ev[0].amount).toBeCloseTo(2000, 6)
    expect(e.incomeBetween('2025-03-31', '2026-03-31').interest).toBeCloseTo(8000)
  })

  it('accrues cumulative interest into the financial year it was earned', () => {
    const e = eng(fd(), '2027-06-01')
    // Periods are (from, to], so consecutive financial years share their boundary day.
    const fy26 = e.incomeBetween('2025-03-31', '2026-03-31').interest
    const fy27 = e.incomeBetween('2026-03-31', '2027-03-31').interest
    const before = e.incomeBetween('2024-03-31', '2025-03-31').interest
    expect(before + fy26 + fy27).toBeCloseTo(e.maturity()!.value - 100000, 0)
  })

  it('gives a sensible XIRR for a matured FD', () => {
    const e = eng(fd(), '2027-06-01')
    expect(xirr(e.flows())).toBeCloseTo(1.02 ** 4 - 1, 3) // effective annual rate of 8% quarterly
    expect(e.liquidity().bucket).toBe('LIQUID')
  })

  it('locks NSC until maturity and KVP for 30 months', () => {
    expect(eng(fd({ subtype: 'NSC' }), '2026-01-01').liquidity()).toEqual({ bucket: 'LOCKED', lockedUntil: '2027-01-01' })
    expect(eng(fd({ subtype: 'KVP', maturityDate: '2034-08-01' }), '2026-01-01').liquidity()).toEqual({
      bucket: 'LOCKED',
      lockedUntil: '2027-07-01'
    })
  })
})

describe('recurring deposit', () => {
  it('values instalments with quarterly compounding', () => {
    const e = eng({ kind: 'RD', name: 'RD', installment: 5000, rate: 7, startDate: '2025-01-05', months: 12 }, '2026-06-01')
    expect(e.invested()).toBe(60000)
    const m = e.maturity()!
    expect(m.date).toBe('2026-01-05')
    expect(m.value).toBeGreaterThan(60000 + 2000)
    expect(m.value).toBeLessThan(60000 + 2600)
    expect(e.events('2025-01-01', '2025-03-31').filter((x) => x.kind === 'INSTALMENT')).toHaveLength(3)
  })
})

describe('PPF and SSY', () => {
  it('matures PPF 15 financial years after opening and SSY after 21 years', () => {
    expect(ppfMaturity({ scheme: 'PPF', openDate: '2015-06-10' })).toBe('2031-04-01')
    expect(ppfMaturity({ scheme: 'PPF', openDate: '2016-02-10' })).toBe('2031-04-01')
    expect(ppfMaturity({ scheme: 'SSY', openDate: '2020-05-01' })).toBe('2041-05-01')
  })

  it('projects from the last passbook balance', () => {
    const e = eng(
      { kind: 'PPF', name: 'PPF', scheme: 'PPF', openDate: '2015-06-10', rate: 7.1, yearlyContribution: 150000 },
      '2026-03-31',
      [{ date: '2025-03-31', value: 2000000 }]
    )
    const v = e.current().value!
    expect(v).toBeGreaterThan(2000000 + 150000)
    expect(v).toBeLessThan(2000000 + 150000 + 160000)
    expect(e.liquidity()).toEqual({ bucket: 'LOCKED', lockedUntil: '2031-04-01' })
    expect(e.projection().at(-1)!.date).toBe('2031-04-01')
  })
})

describe('bonds and SGB', () => {
  it('pays half-yearly coupons and redeems at face value', () => {
    const e = eng(
      { kind: 'BOND', name: 'NCD', faceValue: 1000, units: 100, couponRate: 9, couponFrequency: 'HALF_YEARLY', purchasePrice: 990, purchaseDate: '2025-02-01', maturityDate: '2028-01-15' },
      '2026-02-01'
    )
    expect(e.invested()).toBe(99000)
    const coupons = e.events('2025-02-01', '2026-02-01')
    expect(coupons.map((c) => [c.date, c.amount])).toEqual([
      ['2025-07-15', 4500],
      ['2026-01-15', 4500]
    ])
    expect(e.current().value).toBeGreaterThan(100000) // face value plus accrued interest
  })

  it('values SGB at the gold price and pays 2.5% on the issue price', () => {
    const e = eng({ kind: 'SGB', name: 'SGB 2021-22 S-V', grams: 10, issuePrice: 4790, issueDate: '2021-08-17' }, '2026-02-01')
    expect(e.current()).toMatchObject({ value: 100000, source: 'LIVE' })
    expect(e.invested()).toBe(47900)
    const ev = e.events('2025-04-01', '2026-03-31')
    expect(ev.map((x) => x.amount)).toEqual([598.75, 598.75])
    expect(e.maturity()!.date).toBe('2029-08-17')
    expect(xirr([...e.flows(), { date: '2026-02-01', amount: 100000 }])).toBeGreaterThan(0.15)
  })
})

describe('gold, crypto, property, cash, other', () => {
  it('values gold by grams × purity × price', () => {
    const e = eng({ kind: 'METAL', name: 'Coins', metal: 'GOLD', form: 'PHYSICAL', grams: 20, purity: 0.916, cost: 120000, purchaseDate: '2020-01-01' }, '2026-01-01')
    expect(e.current().value).toBeCloseTo(20 * 0.916 * 10000)
    expect(e.liquidity().bucket).toBe('BREAKABLE')
  })

  it('values crypto at the coin price and reports a missing price', () => {
    expect(eng({ kind: 'CRYPTO', name: 'BTC', symbol: 'BTC', quantity: 0.05, cost: 200000, purchaseDate: '2024-01-01' }, '2026-01-01').current().value).toBe(400000)
    expect(eng({ kind: 'CRYPTO', name: 'X', symbol: 'NOPE', quantity: 1, cost: 1, purchaseDate: '2024-01-01' }, '2026-01-01').current()).toMatchObject({ value: null, source: 'STATEMENT' })
  })

  it('grows property from the last estimate and counts rent', () => {
    const e = eng(
      { kind: 'PROPERTY', name: 'Flat', propertyType: 'RESIDENTIAL', purchasePrice: 5000000, purchaseDate: '2020-01-01', appreciation: 5, monthlyRent: 20000 },
      '2026-01-01',
      [{ date: '2025-01-01', value: 8000000 }]
    )
    expect(e.current().value).toBeCloseTo(8000000 * 1.05 ** (365 / 365), -3)
    // Rent arrives on the 1st: 1 Apr 2025 … 1 Jan 2026 (today) is ten payments.
    expect(e.incomeBetween('2025-03-31', '2026-03-31').rent).toBe(20000 * 10)
    expect(e.liquidity().bucket).toBe('ILLIQUID')
  })

  it('uses the latest cash balance and other-asset estimate', () => {
    const c = eng({ kind: 'CASH', name: 'Savings', rate: 3 }, '2026-01-01', [
      { date: '2025-06-01', value: 100000 },
      { date: '2025-12-01', value: 150000 }
    ])
    expect(c.current().value).toBe(150000)
    expect(c.valueOn('2025-07-01')).toBe(100000)
    const o = eng({ kind: 'OTHER', name: 'P2P', cost: 50000, purchaseDate: '2024-01-01' }, '2026-01-01')
    expect(o.current().value).toBe(50000)
  })
})
