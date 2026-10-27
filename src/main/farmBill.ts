import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { AI_MODEL, FALLBACK_BETA } from '@shared/ai'
import { CROP_KEYS, CROPS, type MandiBill } from '@shared/farm'

/**
 * A mandi sale bill (patti/bill of the commission agent), photographed or scanned, read by Claude
 * into one sale: date, crop, weight, rate, gross and the deductions. Gujarati, Hindi or English,
 * printed or handwritten. Only the picture goes to Anthropic; the form is filled for the person to
 * check before anything is saved.
 */

const MEDIA: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export const MandiBillSchema = z.object({
  isMandiBill: z.boolean().describe('False if the picture is not a sale bill from a mandi or trader'),
  date: z.string().nullable().describe('Sale date as YYYY-MM-DD'),
  mandi: z.string().nullable().describe('The APMC or market yard, in English, e.g. "Rajkot", "Gondal"'),
  trader: z.string().nullable().describe('Commission agent or buyer named on the bill'),
  crop: z.enum(CROP_KEYS as [string, ...string[]]).nullable(),
  variety: z.string().nullable(),
  quantity: z.number().nullable().describe('Net weight sold, as written'),
  unit: z.enum(['QTL', 'MAN', 'KG']).nullable().describe('MAN is 20 kg (મણ), QTL is 100 kg (ક્વિન્ટલ)'),
  rate: z.number().nullable().describe('Rate as written on the bill'),
  rateUnit: z.enum(['QTL', 'MAN', 'KG']).nullable().describe('What the rate is per'),
  gross: z.number().nullable().describe('Gross amount before deductions, ₹'),
  charges: z.number().nullable().describe('All deductions added up (commission, hamali, weighing, market fee, transport…), ₹'),
  net: z.number().nullable().describe('Amount paid to the farmer, ₹'),
  notes: z.string().describe('In English: anything unclear or worth checking, short')
})

const SYSTEM = `You read photos of sale bills from Indian agricultural markets (APMC mandis), mostly from Gujarat. They may be printed or handwritten, in Gujarati, Hindi or English, with Gujarati digits (૦૧૨૩૪૫૬૭૮૯).

Read the one sale on the bill. Weights in મણ (man) are 20 kg; ક્વિન્ટલ is 100 kg. Rates are usually per મણ (20 kg) in Saurashtra yards, or per quintal. Add up all deductions (કમિશન commission, હમાલી hamali, તોલાઈ weighing, માર્કેટ ફી market fee, transport, bags) into charges.

Crops: ${CROP_KEYS.map((k) => `${k} = ${CROPS[k].label} (${CROPS[k].gu})`).join(', ')}.

Write only what is on the bill; leave a field null when it is missing or can't be read. Never guess numbers. Put anything doubtful in notes.`

export async function readMandiBill(client: Anthropic, filePath: string, record: (u: Anthropic.Beta.BetaUsage) => void): Promise<MandiBill> {
  const media = MEDIA[extname(filePath).toLowerCase()]
  if (!media) throw new Error('Choose a photo (JPG, PNG or WebP) of the bill.')
  const data = readFileSync(filePath)
  if (data.length > 5 * 1024 * 1024) throw new Error('That photo is over 5 MB; take it at a lower resolution, or crop it to the bill.')
  const stream = client.beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(MandiBillSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } },
          { type: 'text', text: 'Read this mandi bill.' }
        ]
      }
    ]
  })
  const msg = await stream.finalMessage()
  record(msg.usage)
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this picture.')
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = MandiBillSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error('Claude’s reading of the bill didn’t check out; try again.')
  const b = parsed.data
  if (!b.isMandiBill) throw new Error('That doesn’t look like a mandi sale bill.')
  return { ...b, crop: (b.crop as MandiBill['crop']) ?? null }
}
