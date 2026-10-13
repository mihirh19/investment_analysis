import { describe, expect, it } from 'vitest'
import { niceTicks } from '../src/renderer/src/lib/ticks'

describe('niceTicks', () => {
  it('always reaches the maximum', () => {
    for (const max of [4400, 999, 1, 17.3, 123456, 2500]) {
      const t = niceTicks(0, max, 4)
      expect(t[0]).toBe(0)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
      expect(t.length).toBeLessThanOrEqual(7)
    }
  })

  it('covers a price range that does not start at zero', () => {
    const t = niceTicks(980.4, 1728, 4)
    expect(t[0]).toBeLessThanOrEqual(980.4)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1728)
    expect(t).toEqual([800, 1000, 1200, 1400, 1600, 1800])
  })

  it('handles a flat series', () => {
    const t = niceTicks(50, 50, 4)
    expect(t[0]).toBeLessThan(50)
    expect(t[t.length - 1]).toBeGreaterThan(50)
  })
})
