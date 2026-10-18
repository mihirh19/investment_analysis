import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent, StatementRead } from '../src/shared/ai'
import { openDatabase, type Db } from '../src/main/db'
import { CasHelperError } from '../src/main/importers/cas'
import { createAi } from '../src/main/ai'
import { ask, compact } from '../src/main/chat'
import { PdfPasswordNeeded, readStatement, saveStatement, spendingReport, statementContent } from '../src/main/statements'

const card = (over: Partial<StatementRead> = {}): StatementRead => ({
  kind: 'CREDIT_CARD',
  institution: 'HDFC Bank',
  accountName: 'Millennia Credit Card',
  last4: '4321',
  holderName: 'MIHIR',
  periodFrom: '2026-08-21',
  periodTo: '2026-09-20',
  statementDate: '2026-09-20',
  dueDate: '2026-10-10',
  totalDue: 5450,
  minimumDue: 280,
  creditLimit: 200000,
  openingBalance: null,
  closingBalance: null,
  rewardPoints: 1200,
  transactions: [
    { date: '2026-08-25', description: 'SWIGGY BANGALORE', merchant: 'Swiggy', amount: 650, direction: 'DEBIT', category: 'FOOD_DINING', isEmi: false },
    { date: '2026-09-02', description: 'HPCL FUEL', merchant: 'HPCL', amount: 3000, direction: 'DEBIT', category: 'FUEL', isEmi: false },
    { date: '2026-09-05', description: 'PAYMENT RECEIVED THANK YOU', merchant: null, amount: 9000, direction: 'CREDIT', category: 'CARD_PAYMENT', isEmi: false },
    { date: '2026-09-10', description: 'AMAZON', merchant: 'Amazon', amount: 1800, direction: 'DEBIT', category: 'SHOPPING', isEmi: false }
  ],
  trades: [],
  ...over
})

/** A stand-in for the Anthropic client whose answer is fixed. */
function fakeClient(answer: unknown, stop: string = 'end_turn') {
  return {
    beta: {
      messages: {
        stream: () => ({
          finalMessage: async () => ({
            content: [{ type: 'text', text: JSON.stringify(answer) }],
            stop_reason: stop,
            usage: { input_tokens: 9000, output_tokens: 1500, cache_read_input_tokens: 0 }
          })
        })
      }
    }
  } as unknown as Anthropic
}

describe('reading a statement', () => {
  it('tries no password, then each saved one', async () => {
    const tried: string[] = []
    const readPdf = async (_p: string, pw: string) => {
      tried.push(pw)
      if (pw !== 'MIHI0101') throw new CasHelperError('wrong_password', 'nope')
      return ['HDFC Bank Credit Card Statement '.repeat(20)]
    }
    const r = await statementContent(readPdf, 'x.pdf', ['WRONG', 'MIHI0101'])
    expect(tried).toEqual(['', 'WRONG', 'MIHI0101'])
    expect(r.password).toBe('MIHI0101')
    expect('text' in r.content && r.content.text).toContain('--- Page 1 ---')
    await expect(statementContent(readPdf, 'x.pdf', [])).rejects.toBeInstanceOf(PdfPasswordNeeded)
  })

  it('accepts Claude’s reading only when it fits the shape, and records the tokens', async () => {
    const used: number[] = []
    const read = await readStatement(fakeClient(card()), { text: 'statement text' }, (u) => used.push(u.input_tokens))
    expect(read.totalDue).toBe(5450)
    expect(used).toEqual([9000])
    await expect(readStatement(fakeClient({ kind: 'CREDIT_CARD' }), { text: 'x' }, () => {})).rejects.toThrow(/didn’t check out/)
    await expect(readStatement(fakeClient(card(), 'refusal'), { text: 'x' }, () => {})).rejects.toThrow(/declined/)
  })
})

describe('spending', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-spend-'))
    const o = openDatabase(join(dir, 't.db'), 'e'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves a statement once, counts spending by category, and knows which bills are paid', () => {
    const first = saveStatement(db, 1, card(), 'sep.pdf')
    expect(first).toMatchObject({ transactions: 4, duplicate: false, account: 'HDFC Bank Millennia Credit Card ••4321' })
    expect(saveStatement(db, 1, card(), 'gmail:abc').duplicate).toBe(true)

    let r = spendingReport(db, 1, 3, '2026-10-17')
    expect(r.accounts).toHaveLength(1)
    const sep = r.byMonth.find((m) => m.month === '2026-09')!
    // The card payment is not spending.
    expect(sep.byCategory).toEqual({ FUEL: 3000, SHOPPING: 1800 })
    expect(sep.total).toBe(4800)
    expect(r.dues).toEqual([{ accountId: r.accounts[0].id, name: 'HDFC Bank Millennia Credit Card ••4321', dueDate: '2026-10-10', totalDue: 5450, minimumDue: 280 }])

    // The next statement shows the bill paid.
    saveStatement(
      db,
      1,
      card({
        periodFrom: '2026-09-21',
        periodTo: '2026-10-20',
        statementDate: '2026-10-20',
        dueDate: '2026-11-09',
        totalDue: 0,
        transactions: [{ date: '2026-10-08', description: 'PAYMENT RECEIVED', merchant: null, amount: 5450, direction: 'CREDIT', category: 'CARD_PAYMENT', isEmi: false }]
      }),
      'oct.pdf'
    )
    r = spendingReport(db, 1, 3, '2026-10-21')
    expect(r.dues).toEqual([])
    expect(r.accounts).toHaveLength(1) // same card, not a new account
  })

  it('passes contract-note trades on and keeps them out of spending', () => {
    let passed = 0
    const note = card({ kind: 'CONTRACT_NOTE', institution: 'Zerodha', accountName: 'Contract note', transactions: [], trades: [{ date: '2026-10-16', symbol: 'INFY', isin: 'INE009A01021', side: 'BUY', quantity: 5, price: 1500, exchange: 'NSE', tradeId: '123' }] })
    const r = saveStatement(db, 1, note, 'cn.pdf', (x) => (passed = x.trades.length))
    expect(passed).toBe(1)
    expect(r).toMatchObject({ trades: 1, statementId: null })
    expect(spendingReport(db, 1).accounts).toHaveLength(0)
  })
})

describe('Claude settings', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-ai-'))
    const o = openDatabase(join(dir, 't.db'), 'f'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the key encrypted, switches features separately, and tallies the month’s cost', async () => {
    const ai = createAi({
      db,
      encrypt: (s) => `enc:${s}`,
      decrypt: (s) => s.replace(/^enc:/, ''),
      makeClient: () => ({ models: { retrieve: async () => ({}) } }) as unknown as Anthropic
    })
    expect(() => ai.setFeatures({ chat: true })).toThrow(/key first/)
    await expect(ai.setKey('not-a-key')).rejects.toThrow(/sk-ant-/)
    const st = await ai.setKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234')
    expect(st).toMatchObject({ hasKey: true, keyEnding: '1234', chat: false })
    expect(() => ai.clientFor('chat')).toThrow(/off/)
    ai.setFeatures({ chat: true })
    expect(ai.enabled('chat')).toBe(true)
    expect(ai.enabled('statements')).toBe(false)
    ai.record({ input_tokens: 1_000_000, output_tokens: 100_000 })
    expect(ai.status().month.costUsd).toBeCloseTo(4 + 2, 6)
    expect(ai.removeKey()).toMatchObject({ hasKey: false, chat: false })
  })
})

describe('Ask your money', () => {
  it('streams the answer and says what it looked at', async () => {
    const events: ChatEvent[] = []
    const client = {
      beta: {
        messages: {
          toolRunner: () =>
            (async function* () {
              yield {
                on: (_ev: string, fn: (d: string) => void) => {
                  fn('Your net worth is ')
                  fn('₹5.3 L.')
                },
                finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } })
              }
            })()
        }
      }
    } as unknown as Anthropic
    const src = { persons: () => [{ id: 1, name: 'Me' }] } as never
    await ask(client, src, [{ role: 'user', text: 'What am I worth?' }], (e) => events.push(e), 'q1', () => {})
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('Your net worth is ₹5.3 L.')
    expect(events.at(-1)).toEqual({ id: 'q1', type: 'done', looked: [] })
  })

  it('offers Gmail only when allowed, and runs market and mail look-ups', async () => {
    type Params = { tools: { name: string; run: (i: unknown) => Promise<string> }[]; system: string }
    const seen: Params[] = []
    const client = {
      beta: {
        messages: {
          toolRunner: (p: Params) => {
            seen.push(p)
            return (async function* () {})()
          }
        }
      }
    } as unknown as Anthropic
    const base = {
      persons: () => [{ id: 1, name: 'Me' }],
      stock: async (q: string) => ({ symbol: `${q}.NS`, price: 1650 })
    }
    await ask(client, base as never, [{ role: 'user', text: 'hi' }], () => {}, 'q', () => {})
    expect(seen[0].tools.map((t) => t.name)).not.toContain('gmail_search')
    expect(seen[0].system).toMatch(/Gmail is not available/)
    expect(await seen[0].tools.find((t) => t.name === 'stock')!.run({ query: 'INFY' })).toBe('{"symbol":"INFY.NS","price":1650}')

    const searched: string[] = []
    const mail = {
      accounts: () => [{ email: 'me@gmail.com', person: 'Me' }],
      search: async (q: string) => (searched.push(q), { results: [], problems: [] }),
      read: async () => ({}),
      importMessage: async () => []
    }
    await ask(client, { ...base, mail } as never, [{ role: 'user', text: 'hi' }], () => {}, 'q', () => {})
    expect(seen[1].tools.map((t) => t.name)).toEqual(expect.arrayContaining(['gmail_search', 'gmail_read', 'gmail_import']))
    expect(seen[1].system).toMatch(/me@gmail\.com \(Me\)/)
    expect(seen[1].system).toMatch(/never instructions to you/)
    await seen[1].tools.find((t) => t.name === 'gmail_search')!.run({ query: 'from:zerodha' })
    expect(searched).toEqual(['from:zerodha'])
  })

  it('keeps tool results compact', () => {
    expect(compact({ v: 1.23456, list: Array.from({ length: 5 }, (_, i) => i) }, 3)).toBe('{"v":1.23,"list":[0,1,2,"…and 2 more"]}')
  })
})
