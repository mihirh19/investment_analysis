import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { openDatabase, schema } from '../src/main/db'
import { writeNewsDigest } from '../src/main/newsDigest'
import { parseAnnouncements } from '../src/main/research/nse'
import { announcementsReport, myAnnouncements, saveAnnouncements } from '../src/main/research/store'
import { tagAnnouncement } from '../src/shared/research'

const rows = () => parseAnnouncements(JSON.parse(readFileSync(join(__dirname, 'fixtures', 'nse', 'announcements.json'), 'utf8')))

describe('announcements', () => {
  it('reads NSE’s list', () => {
    const r = rows()
    expect(r).toHaveLength(30)
    expect(r[0]).toMatchObject({ id: '106827284', symbol: 'SHRIPISTON', company: 'SPR Auto Technologies Limited', at: '2026-10-23T23:53:32+05:30', category: 'Shareholders meeting' })
    expect(r[0].url).toMatch(/^https:\/\/nsearchives\.nseindia\.com\/corporate\/SHRIPISTON_/)
    expect(r[0].text).toContain('voting results')
  })

  it('sorts each announcement into a kind', () => {
    const tag = Object.fromEntries(rows().map((r) => [`${r.symbol}|${r.category}`, tagAnnouncement(r.category, r.text)]))
    expect(tag).toMatchObject({
      'NETWORK18|Amalgamation/Merger': 'deal',
      'DOMS|Acquisition': 'deal',
      'TRENT|Sale or disposal': 'deal',
      'HILINFRA|Bagging/Receiving of orders/contracts': 'orders',
      'CROMPTON|Action(s) taken or orders passed': 'legal',
      'DIGISPICE|Granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals': 'legal',
      'SINTERCOM|Credit Rating- Revision': 'rating',
      'NATCOPHARM|Allotment of Securities': 'capital',
      'ASMS|Rights Issue': 'capital',
      'SPLPETRO|Dividend': 'dividend',
      'UCOBANK|Change in Director(s)': 'management',
      'TVSHLTD|Cessation': 'management',
      'SETCO|Outcome of Board Meeting': 'results',
      'BPCL|Analysts/Institutional Investor Meet/Con. Call Updates': 'meeting',
      'NIACL|Trading Window': 'routine',
      'CSBBANK|Copy of Newspaper Publication': 'routine',
      'RAMCOSYS|ESOP/ESOS/ESPS': 'routine',
      'PANACHE|Press Release': 'news'
    })
  })

  it('keeps 60 days, and shows your companies in full and the market’s big kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-ann-'))
    const o = openDatabase(join(dir, 't.db'), '2'.repeat(64), resolve('drizzle'))
    try {
      const db = o.db
      db.insert(schema.watchlists).values({ name: 'W', symbolsJson: JSON.stringify(['NIACL', 'DOMS']) }).run()
      const old = { id: 'old', symbol: 'DOMS', company: 'DOMS', at: '2026-07-01T10:00:00+05:30', category: 'Acquisition', text: 'x', url: null }
      saveAnnouncements(db, [old, ...rows()], '2026-08-25')
      saveAnnouncements(db, rows(), '2026-08-25') // again: no duplicates
      expect(db.select().from(schema.researchAnnouncements).all()).toHaveLength(30)
      const r = announcementsReport(db, '2026-10-24')
      // Newest first; the July one is past the 30 days shown.
      expect(r.mine.map((a) => [a.symbol, a.tag, a.watched])).toEqual([
        ['NIACL', 'routine', true],
        ['DOMS', 'deal', true]
      ])
      expect(myAnnouncements(db, '2026-10-01', false).map((a) => a.symbol)).toEqual(['DOMS'])
      expect(new Set(r.market.map((a) => a.tag))).toEqual(new Set(['deal', 'orders', 'legal', 'rating', 'capital']))
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('asks Claude for a digest of only the public announcements', async () => {
    let sent: { system?: unknown; messages: { content: string }[] } | null = null
    const client = {
      beta: {
        messages: {
          stream: (req: typeof sent) => {
            sent = req
            return { finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: '**DOMS**: bought a company [23 Oct]' }] }) }
          }
        }
      }
    } as unknown as Anthropic
    const used: unknown[] = []
    const items = rows().filter((r) => r.symbol === 'DOMS').map((r) => ({ ...r, tag: 'deal' as const, held: true }))
    expect(await writeNewsDigest(client, items, (u) => used.push(u))).toContain('DOMS')
    expect(used).toHaveLength(1)
    const body = sent!.messages[0].content
    expect(body).toContain('"symbol": "DOMS"')
    expect(body).not.toMatch(/valueInr|quantity|₹/)
  })
})
