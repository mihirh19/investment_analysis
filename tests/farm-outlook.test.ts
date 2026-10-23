import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { openDatabase, schema, type Db } from '../src/main/db'
import {
  farmReport,
  holdFigures,
  mandiKey,
  monthlyKey,
  saveEntry,
  saveSeason,
  saveStatePrices,
  seasonalPattern,
  setHoldingCosts,
  setTransportCost
} from '../src/main/farm'
import { parseRangeLine, writeMarketNote } from '../src/main/farmNote'

describe('the outlook', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-outlook-'))
    const o = openDatabase(join(dir, 't.db'), 'a'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const month = (ym: string, price: number) =>
    db.insert(schema.priceHistory).values({ key: monthlyKey('GROUNDNUT', 'Rajkot'), date: `${ym}-15`, close: price }).run()

  it('works out past seasons from this month, the years each way', () => {
    // October to January in three past years: +10%, −5%, +2%.
    month('2023-10', 6000)
    month('2024-01', 6600)
    month('2024-10', 7000)
    month('2025-01', 6650)
    month('2025-10', 5000)
    month('2026-01', 5100)
    month('2026-10', 7900) // this year's October: no future month yet
    const p = seasonalPattern(db, 'GROUNDNUT', 'Rajkot', '2026-10-23')!
    expect(p.fromMonth).toBe('October')
    const three = p.horizons.find((h) => h.months === 3)!
    expect(three.changes).toEqual([
      { year: 2025, pct: 2 },
      { year: 2024, pct: -5 },
      { year: 2023, pct: 10 }
    ])
    expect(three).toMatchObject({ median: 2, min: -5, max: 10 })
    expect(p.horizons.find((h) => h.months === 1)!.changes).toEqual([])
  })

  it('puts selling today against waiting, after drying, storage and interest', () => {
    const pattern = { fromMonth: 'October', horizons: [{ months: 3, changes: [], median: 2, min: -5, max: 10 }] }
    const h = holdFigures(100, 8000, pattern, { storagePerQtlMonth: 10, lossPctPerMonth: 0.5, interestPct: 7 })
    expect(h.sellNow).toBe(800000)
    const three = h.horizons.find((x) => x.months === 3)!
    // 98.5 qtl left; costs: 100 × 10 × 3 storage + 8,00,000 × 7% × 3/12 interest = 3,000 + 14,000.
    expect(three.cost).toBe(17000)
    expect(three.typical).toBe(Math.round(98.5 * 8000 * 1.02 - 17000 - 800000))
    expect(three.low).toBe(Math.round(98.5 * 8000 * 0.95 - 17000 - 800000))
    expect(three.high).toBe(Math.round(98.5 * 8000 * 1.1 - 17000 - 800000))
    // No past years for that horizon: only the cost is known.
    expect(h.horizons.find((x) => x.months === 1)).toMatchObject({ typical: null, low: null, high: null })
  })

  it('compares the state’s mandis after transport, and gives the godown’s figures', () => {
    const s = saveSeason(db, { personId: 2, crop: 'GROUNDNUT', season: 'STOCK', year: 2026, status: 'HARVESTED' })
    saveEntry(db, { seasonId: s, date: '2026-10-20', type: 'HARVEST', costKind: null, quantityQtl: 50, rate: null, amount: 0, charges: null, mandi: null, note: null })
    db.insert(schema.priceHistory).values({ key: mandiKey('GROUNDNUT', 'Rajkot'), date: '2026-10-22', close: 7950 }).run()
    saveStatePrices(db, 'GROUNDNUT', {
      date: '2026-10-22',
      markets: [
        { id: 61, name: 'Gondal APMC', district: 'Rajkot', modal: 8120, arrivalsT: 310 },
        { id: 60, name: 'Rajkot APMC', district: 'Rajkot', modal: 7950, arrivalsT: 142 }
      ]
    })
    setTransportCost(db, 'Gondal', 60)
    setHoldingCosts(db, { storagePerQtlMonth: 0, lossPctPerMonth: 0.5, interestPct: 7 })
    expect(() => setHoldingCosts(db, { storagePerQtlMonth: 0, lossPctPerMonth: 50, interestPct: 7 })).toThrow(/too high/)
    const o = farmReport(db, undefined, '2026-10-23').outlook[0]
    expect(o.mandis!.rows).toEqual([
      { name: 'Gondal APMC', district: 'Rajkot', modal: 8120, arrivalsT: 310, transport: 60, net: 8060, here: false },
      { name: 'Rajkot APMC', district: 'Rajkot', modal: 7950, arrivalsT: 142, transport: null, net: null, here: true }
    ])
    expect(o.hold).toMatchObject({ qtl: 50, sellNow: 397500 })
  })
})

describe('Claude’s market note', () => {
  it('reads the range line, and copes without one', () => {
    expect(parseRangeLine('RANGE: ₹7,200–₹8,400 a quintal at Rajkot, next 1–3 months; CONFIDENCE: Medium\n**What is moving the price now**\n- x')).toEqual({
      range: { low: 7200, high: 8400 },
      confidence: 'medium',
      body: '**What is moving the price now**\n- x'
    })
    expect(parseRangeLine('No range given.').range).toBeNull()
  })

  it('searches, carries on after a pause, and keeps the sources it cited', async () => {
    const calls: { tools: { type: string }[]; messages: unknown[] }[] = []
    const replies = [
      { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'groundnut prices Gujarat' } }] },
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'RANGE: ₹7,300–₹8,300 a quintal at Rajkot, next 1–3 months; CONFIDENCE: low\n**What is moving the price now**\n' },
          { type: 'text', text: '- Kharif sowing is up 4% (22 Oct).', citations: [{ type: 'web_search_result_location', url: 'https://example.org/a', title: 'Sowing report', cited_text: '', encrypted_index: '' }] }
        ]
      }
    ]
    const client = {
      beta: {
        messages: {
          stream: (p: { tools: { type: string }[]; messages: unknown[] }) => {
            calls.push(p)
            const r = replies[calls.length - 1]
            return { finalMessage: async () => ({ ...r, usage: { input_tokens: 1000, output_tokens: 300 } }) }
          }
        }
      }
    } as unknown as Anthropic
    const used: number[] = []
    const price = {
      crop: 'GROUNDNUT',
      market: 'Rajkot',
      latest: { crop: 'GROUNDNUT', market: 'Rajkot', date: '2026-10-22', modal: 7900, min: null, max: null },
      avg30: 7800,
      avg90: 7700,
      avg180: 7500,
      yearAgo: 6000,
      msp: 7517,
      mspSeason: 'Kharif 2026-27',
      varieties: [],
      history: [],
      target: 9999,
      targetReached: false
    } as never
    const note = await writeMarketNote(client, { crop: 'GROUNDNUT', market: 'Rajkot', today: '2026-10-23', price, pattern: null, arrivals: null }, (u) => used.push(u.input_tokens))
    expect(calls).toHaveLength(2)
    expect(calls[0].tools[0].type).toBe('web_search_20260209')
    // The family's own target (and anything about their stock) is not sent.
    expect(JSON.stringify(calls[0].messages)).not.toContain('9999')
    expect(calls[1].messages).toHaveLength(2)
    expect(note).toMatchObject({ range: { low: 7300, high: 8300 }, confidence: 'low', sources: [{ url: 'https://example.org/a', title: 'Sowing report' }] })
    expect(note.text).toContain('Kharif sowing is up 4%')
    expect(used).toEqual([1000, 1000])
  })
})
