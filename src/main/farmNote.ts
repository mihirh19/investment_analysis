import type Anthropic from '@anthropic-ai/sdk'
import { AI_MODEL, FALLBACK_BETA } from '@shared/ai'
import { CROPS, type CropKey, type CropPrice, type MarketNote, type SeasonalPattern } from '@shared/farm'

/**
 * A market note for one crop: Claude searches the web for what is moving the price now (the
 * season's sowing and crop estimates, crop condition and weather, government buying at MSP, export
 * and processor demand, arrivals) and writes it up with a likely range and how sure it is. Only
 * public facts go in: the crop, the mandi and its prices. Never the family's stock or money.
 */

const SYSTEM = `You write short market notes on Indian agricultural commodity prices for a farming family in Gujarat. Each note is about one crop at one mandi (APMC), for the next one to three months.

Use web search to find what is moving the price now: this season's sowing area and crop or production estimates, crop condition and weather in Gujarat and other big producing states, government procurement at the minimum support price (agencies, quantities, dates), export demand and policy, demand from processors (for groundnut: oil mills and edible oil prices; for cotton: ginners and mills), arrivals at mandis, and anything else that matters for this crop. Prefer reports from the last few weeks; give dates.

Write exactly this, and nothing before it:
RANGE: ₹<low>–₹<high> a quintal at <mandi>, next 1–3 months; CONFIDENCE: <low|medium|high>
Then, in plain English (short sentences, no jargon):
**What is moving the price now** — 3 to 5 bullets, each with its date and source.
**What could push it up** — 1 to 3 bullets.
**What could push it down** — 1 to 3 bullets.
**Past seasons** — one sentence on the past-years figures you are given.

Rules:
- The range is an outlook, not a promise. Base it on today's price, the figures given and what you found; make it wider and the confidence lower when the evidence is thin or conflicting. If you found little, say so.
- Never tell the family to sell, hold, store or wait, or when to sell. Lay out the facts that bear on the choice; the decision is theirs.
- Mention the minimum support price only as a floor where the government is actually buying; say whether it is.
- Under 260 words after the RANGE line.`

export interface NoteFacts {
  crop: CropKey
  market: string
  today: string
  price: CropPrice
  pattern: SeasonalPattern | null
  arrivals: { latest: number | null; avg30: number | null } | null
}

/** "RANGE: ₹7,200–₹8,400 a quintal …; CONFIDENCE: medium" → the numbers. */
export function parseRangeLine(text: string): { range: MarketNote['range']; confidence: MarketNote['confidence']; body: string } {
  const lines = text.trim().split('\n')
  const first = lines[0] ?? ''
  const m = first.match(/RANGE:\s*₹?\s*([\d,]+)\s*[–-]\s*₹?\s*([\d,]+)/i)
  const c = first.match(/CONFIDENCE:\s*(low|medium|high)/i)
  if (!m) return { range: null, confidence: c ? (c[1].toLowerCase() as 'low' | 'medium' | 'high') : null, body: text.trim() }
  const low = Number(m[1].replace(/,/g, ''))
  const high = Number(m[2].replace(/,/g, ''))
  return {
    range: low > 0 && high >= low ? { low, high } : null,
    confidence: c ? (c[1].toLowerCase() as 'low' | 'medium' | 'high') : null,
    body: lines.slice(1).join('\n').trim()
  }
}

export async function writeMarketNote(
  client: Anthropic,
  facts: NoteFacts,
  record: (u: Anthropic.Beta.BetaUsage) => void
): Promise<MarketNote> {
  const c = CROPS[facts.crop]
  const p = facts.price
  const input = {
    crop: `${c.label} (${c.gu}); Agmarknet name ${c.agmark}`,
    mandi: `${facts.market} APMC, Gujarat`,
    today: facts.today,
    pricesRupeesPerQuintal: {
      latestModal: p.latest ? { date: p.latest.date, modal: p.latest.modal } : null,
      byVarietyOrClass: p.varieties.map((v) => ({ name: v.name, modal: v.modal, low: v.min, high: v.max, date: v.date })),
      average30Days: p.avg30,
      average90Days: p.avg90,
      average180Days: p.avg180,
      aYearAgo: p.yearAgo,
      msp: p.msp ? { price: p.msp, season: p.mspSeason } : null
    },
    pastYearsFromThisMonth: facts.pattern?.horizons.map((h) => ({
      monthsAhead: h.months,
      changesByYear: h.changes,
      typical: h.median,
      worst: h.min,
      best: h.max
    })),
    arrivalsTonnesAtThisMandi: facts.arrivals
  }
  let messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Write the market note for these facts:\n${JSON.stringify(input, null, 1)}` }
  ]
  const text: string[] = []
  const sources = new Map<string, string>()
  // A long search can pause the turn; carry on from where it stopped, a few times at most.
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client.beta.messages
      .stream({
        model: AI_MODEL,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 6,
            user_location: { type: 'approximate', country: 'IN', region: 'Gujarat', city: facts.market }
          }
        ],
        messages
      })
      .finalMessage()
    record(msg.usage)
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this note.')
    for (const b of msg.content)
      if (b.type === 'text') {
        text.push(b.text)
        for (const cit of b.citations ?? []) if (cit.type === 'web_search_result_location') sources.set(cit.url, cit.title ?? cit.url)
      }
    if (msg.stop_reason !== 'pause_turn') break
    messages = [...messages, { role: 'assistant', content: msg.content }]
  }
  const all = text.join('').trim()
  if (!all) throw new Error('Claude sent no note. Try again in a while.')
  const { range, confidence, body } = parseRangeLine(all)
  return {
    at: new Date().toISOString(),
    crop: facts.crop,
    market: facts.market,
    text: body,
    range,
    confidence,
    sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 12)
  }
}
