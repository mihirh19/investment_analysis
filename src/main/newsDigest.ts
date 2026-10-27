import type Anthropic from '@anthropic-ai/sdk'
import { AI_MODEL, FALLBACK_BETA } from '@shared/ai'
import type { Announcement } from '@shared/research'

/**
 * A short digest of what the family's companies told the exchange lately: which announcements
 * matter and why, in plain words. Only the public announcements go in (company, date, kind, NSE's
 * summary line), which also shows Anthropic which companies are held or watched; never amounts.
 */

const SYSTEM = `You read Indian stock-exchange announcements for a family that holds or watches these companies, and write a short digest of what matters.

Write in plain English, short sentences, no jargon. Group by company, the most important first. For each company with something material, one or two bullets: what happened and why it can matter (results, big orders or contracts, deals and mergers, fund raising or new shares, credit rating changes, top management leaving or joining, regulator or court actions, defaults). End each bullet with the date in brackets.

Leave out routine filings (newspaper copies, trading window, certificates, lost share certificates, meeting schedules) unless something in them is unusual. If nothing is material, say so in one line.

Never tell the family to buy, sell or hold anything, and don't predict prices; say what happened and what it bears on. Under 250 words.`

export async function writeNewsDigest(
  client: Anthropic,
  items: (Announcement & { held: boolean })[],
  record: (u: Anthropic.Beta.BetaUsage) => void
): Promise<string> {
  const input = items.map((a) => ({ company: a.company, symbol: a.symbol, held: a.held, date: a.at.slice(0, 10), kind: a.category, summary: a.text }))
  const msg = await client.beta.messages
    .stream({
      model: AI_MODEL,
      max_tokens: 3000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Announcements from the last few days:\n${JSON.stringify(input, null, 1)}` }]
    })
    .finalMessage()
  record(msg.usage)
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this digest.')
  const text = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  if (!text) throw new Error('Claude sent no digest. Try again in a while.')
  return text
}
