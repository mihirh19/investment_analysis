import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { readMandiBill } from '../src/main/farmBill'

const reply = (o: Record<string, unknown>) => {
  const sent: unknown[] = []
  const client = {
    beta: {
      messages: {
        stream: (req: unknown) => {
          sent.push(req)
          return { finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(o) }] }) }
        }
      }
    }
  } as unknown as Anthropic
  return { client, sent }
}

const BILL = {
  isMandiBill: true,
  date: '2026-10-21',
  mandi: 'Gondal',
  trader: 'Shree Ram Traders',
  crop: 'GROUNDNUT',
  variety: 'G20',
  quantity: 42.5,
  unit: 'MAN',
  rate: 1310,
  rateUnit: 'MAN',
  gross: 55675,
  charges: 1240,
  net: 54435,
  notes: 'Hamali figure is smudged.'
}

describe('reading a mandi bill from a photo', () => {
  it('sends the picture and returns the sale to check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-bill-'))
    try {
      const photo = join(dir, 'patti.jpg')
      writeFileSync(photo, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
      const { client, sent } = reply(BILL)
      const b = await readMandiBill(client, photo, () => {})
      expect(b).toMatchObject({ crop: 'GROUNDNUT', quantity: 42.5, unit: 'MAN', rate: 1310, charges: 1240, mandi: 'Gondal' })
      const req = sent[0] as { messages: { content: { type: string; source?: { media_type: string } }[] }[]; system: string }
      expect(req.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } })
      expect(req.system).toMatch(/મણ/)

      await expect(readMandiBill(reply({ ...BILL, isMandiBill: false }).client, photo, () => {})).rejects.toThrow(/doesn’t look like a mandi/)
      await expect(readMandiBill(reply({ ...BILL, unit: 'TONNE' }).client, photo, () => {})).rejects.toThrow(/didn’t check out/)
      writeFileSync(join(dir, 'bill.pdf'), 'x')
      await expect(readMandiBill(reply(BILL).client, join(dir, 'bill.pdf'), () => {})).rejects.toThrow(/photo/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
