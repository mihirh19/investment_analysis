import { describe, expect, it } from 'vitest'
import { parseDate, parseNumber } from '../src/main/importers/parse'

describe('parseDate', () => {
  it.each([
    ['2024-03-15', '2024-03-15'],
    ['2024-03-15T10:11:12', '2024-03-15'],
    ['15-03-2024', '2024-03-15'],
    ['15/03/2024 10:21 AM', '2024-03-15'],
    ['05-Mar-2024', '2024-03-05'],
    ['5 Mar 2024, 10:21 AM', '2024-03-05'],
    ['15-Sept-2024', '2024-09-15'],
    ['Mar 5, 2024', '2024-03-05'],
    ['SEPTEMBER 30, 2026', '2026-09-30'],
    ['15 March 2024', '2024-03-15'],
    ['31-December-2025', '2025-12-31'],
    ['15-03-24', '2024-03-15']
  ])('%s → %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected)
  })

  it('reads Excel serial numbers and Date objects', () => {
    expect(parseDate(45366)).toBe('2024-03-15')
    expect(parseDate(new Date(2024, 2, 15, 13, 0))).toBe('2024-03-15')
  })

  it('rejects garbage', () => {
    expect(parseDate('hello')).toBeNull()
    expect(parseDate('31-13-2024')).toBeNull()
    expect(parseDate('')).toBeNull()
  })
})

describe('parseNumber', () => {
  it.each([
    ['1,23,456.78', 123456.78],
    ['(1,234.50)', -1234.5],
    ['₹ 500', 500],
    ['-12.5', -12.5],
    ['$1,000', 1000],
    ['.196', 0.196]
  ])('%s → %d', (input, expected) => {
    expect(parseNumber(input)).toBe(expected)
  })

  it('returns null for blanks and dashes', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })
})
