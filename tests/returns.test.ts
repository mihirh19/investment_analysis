import { describe, expect, it } from 'vitest'
import {
  annualise,
  chain,
  drawdowns,
  growthIndex,
  indexReturn,
  maxDrawdown,
  modifiedDietz,
  periodReturns,
  priceOn,
  replayIntoIndex,
  rolling,
  yearSpans
} from '../src/main/portfolio/returns'

describe('modifiedDietz', () => {
  it('is the plain return with no flows', () => {
    expect(modifiedDietz(100, 110, [], '2024-01-31', '2024-02-29')).toBeCloseTo(0.1)
  })

  it('does not count new money as growth', () => {
    // ₹100 grows to ₹110, then ₹50 more is added on the last day: still a 10% month.
    expect(modifiedDietz(100, 160, [{ date: '2024-02-29', amount: -50 }], '2024-01-31', '2024-02-29')).toBeCloseTo(0.1)
  })

  it('weights a mid-period deposit by the time it was invested', () => {
    // 30-day period, ₹100 added on day 15 (weight 0.5), gain ₹15 → 15 / (100 + 50) = 10%.
    const r = modifiedDietz(100, 215, [{ date: '2024-04-15', amount: -100 }], '2024-03-31', '2024-04-30')
    expect(r).toBeCloseTo(15 / 150, 6)
  })

  it('handles a sale: money taken out is not a loss', () => {
    expect(modifiedDietz(200, 110, [{ date: '2024-02-29', amount: 100 }], '2024-01-31', '2024-02-29')).toBeCloseTo(0.05)
  })

  it('is null when nothing was invested', () => {
    expect(modifiedDietz(0, 0, [], '2024-01-31', '2024-02-29')).toBeNull()
  })

  it('a first deposit during the month earns on its invested share only', () => {
    // Opens at 0, ₹1000 in on the first day of a 29-day period (weight 28/29), ends at ₹1010.
    const r = modifiedDietz(0, 1010, [{ date: '2024-02-01', amount: -1000 }], '2024-01-31', '2024-02-29')!
    expect(r).toBeCloseTo(10 / (1000 * (28 / 29)), 6)
  })
})

describe('periodReturns + chain', () => {
  const dates = ['2024-01-31', '2024-02-29', '2024-03-31']

  it('assigns each flow to the period it falls in, and ignores flows before the first date', () => {
    const r = periodReturns(
      dates,
      [100, 110, 231],
      [
        { date: '2023-12-01', amount: -100 }, // part of the opening value
        { date: '2024-03-31', amount: -100 } // end-of-period deposit
      ]
    )
    expect(r[0]).toBeCloseTo(0.1)
    expect(r[1]).toBeCloseTo((231 - 110 - 100) / 110)
  })

  it('time-weighted: a deposit before a fall does not change the return', () => {
    // +10% then −10% gives −1% whatever money was added in between.
    const flat = periodReturns(dates, [100, 110, 99], [])
    // ₹100 added on 29 Feb is in February's closing value (210), which then falls 10% to 189.
    const withDeposit = periodReturns(dates, [100, 210, 189], [{ date: '2024-02-29', amount: -100 }])
    expect(chain(flat)).toBeCloseTo(-0.01)
    expect(chain(withDeposit)).toBeCloseTo(-0.01)
  })

  it('chain treats null periods as flat', () => {
    expect(chain([0.1, null, 0.1])).toBeCloseTo(0.21)
    expect(growthIndex([0.1, -0.5])).toEqual([100, 110.00000000000001, 55.00000000000001])
  })
})

describe('annualise', () => {
  it('compounds over several years and leaves a year or less unchanged', () => {
    expect(annualise(0.21, 2)).toBeCloseTo(0.1)
    expect(annualise(0.05, 0.5)).toBe(0.05)
  })
})

describe('drawdowns and maxDrawdown', () => {
  const dates = ['a', 'b', 'c', 'd', 'e', 'f']
  const idx = [100, 120, 90, 100, 125, 110]

  it('measures the fall from the running peak', () => {
    const dd = drawdowns(idx)
    expect(dd[2]).toBeCloseTo(-0.25)
    expect(dd[4]).toBe(0)
    expect(dd[5]).toBeCloseTo(110 / 125 - 1)
  })

  it('finds the deepest fall and when the old peak was regained', () => {
    expect(maxDrawdown(dates, idx)).toEqual({ depth: -0.25, peak: 'b', trough: 'c', recovered: 'e' })
  })

  it('reports an unrecovered fall and no fall at all', () => {
    expect(maxDrawdown(['a', 'b', 'c'], [100, 80, 90])?.recovered).toBeNull()
    expect(maxDrawdown(['a', 'b'], [100, 110])).toBeNull()
  })
})

describe('rolling', () => {
  it('is null until there are enough periods', () => {
    expect(rolling([0.1, 0.1, 0.1], 2).map((x) => x && +x.toFixed(4))).toEqual([null, 0.21, 0.21])
  })
})

describe('yearSpans', () => {
  const months = ['2023-11-30', '2023-12-31', '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']

  it('splits calendar years and flags the partial first and last years', () => {
    const cy = yearSpans(months, 'CY')
    expect(cy.map((s) => [s.label, months[s.from], months[s.to], s.partial])).toEqual([
      ['2023', '2023-11-30', '2023-12-31', true],
      ['2024', '2023-12-31', '2024-04-30', true]
    ])
  })

  it('splits financial years at 31 March', () => {
    const fy = yearSpans(months, 'FY')
    expect(fy.map((s) => [s.label, months[s.from], months[s.to]])).toEqual([
      ['FY24', '2023-11-30', '2024-03-31'],
      ['FY25', '2024-03-31', '2024-04-30']
    ])
  })

  it('a full year from boundary to boundary is not partial', () => {
    const ms = ['2022-12-31', ...Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2023, i + 1, 0)).toISOString().slice(0, 10))]
    const [y2023] = yearSpans(ms, 'CY')
    expect(y2023).toMatchObject({ label: '2023', partial: false })
  })
})

describe('benchmarks', () => {
  const idx = [
    { date: '2024-01-05', close: 100 },
    { date: '2024-01-12', close: 110 },
    { date: '2024-01-19', close: 121 }
  ]

  it('priceOn takes the last close on or before the date', () => {
    expect(priceOn(idx, '2024-01-15')).toBe(110)
    expect(priceOn(idx, '2024-01-01')).toBeNull()
    expect(indexReturn(idx, '2024-01-05', '2024-01-19')).toBeCloseTo(0.21)
  })

  it('replays your money into the index on the same days', () => {
    const dates = ['2024-01-05', '2024-01-12', '2024-01-19']
    // ₹1000 already held at the start, ₹1100 more on the 12th, ₹605 taken out on the 19th.
    const v = replayIntoIndex(
      dates,
      [
        { date: '2024-01-12', amount: -1100 },
        { date: '2024-01-19', amount: 605 }
      ],
      idx,
      1000
    )
    // 10 units → 20 units → sell 5 → 15 units × 121.
    expect(v.map((x) => x && Math.round(x))).toEqual([1000, 2200, 1815])
  })
})
