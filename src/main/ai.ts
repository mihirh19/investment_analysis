import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { AI_MODEL, FALLBACK_BETA, type AiFeatures, type AiStatus } from '@shared/ai'
import { schema, type Db } from './db'

/**
 * Claude, with the person's own API key. Off until a key is entered, and each use is a separate
 * switch (reading statements, answering questions), because each sends something off this computer.
 * The key is kept encrypted with the OS key store; usage is tallied by month so the cost is visible.
 */

export { AI_MODEL, FALLBACK_BETA }
/** Claude Opus 5.5 list prices, US$ per million tokens (input, output, cache read). */
const PRICE = { input: 4, output: 20, cacheRead: 0.2 }

const KEY = 'ai:config'
const USAGE_KEY = 'ai:usage'

interface Stored {
  /** Encrypted. */
  apiKey: string | null
  keyEnding: string | null
  statements: boolean
  chat: boolean
  /** Ask your money may search and read the connected Gmail accounts. */
  chatMail: boolean
  /** The key goes to the phone app (inside the passphrase-locked copy) for Ask your money there. */
  phoneChat: boolean
}

interface Month {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface AiDeps {
  db: Db
  encrypt(plain: string): string
  decrypt(stored: string): string
  /** For tests: a client in place of the real one. */
  makeClient?(apiKey: string): Anthropic
}

export class AiDisabledError extends Error {}

export function createAi(d: AiDeps) {
  const get = (k: string) => d.db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value ?? null
  const set = (k: string, value: string) =>
    d.db
      .insert(schema.settings)
      .values({ key: k, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  const load = (): Stored => ({ apiKey: null, keyEnding: null, statements: false, chat: false, chatMail: false, phoneChat: false, ...JSON.parse(get(KEY) ?? '{}') })
  const month = () => new Date().toISOString().slice(0, 7)
  const usage = (): Record<string, Month> => JSON.parse(get(USAGE_KEY) ?? '{}')

  let cached: { key: string; client: Anthropic } | null = null
  const client = (): Anthropic => {
    const s = load()
    if (!s.apiKey) throw new AiDisabledError('Add your Claude API key in Settings → Claude first.')
    const key = d.decrypt(s.apiKey)
    if (cached?.key !== key) cached = { key, client: d.makeClient ? d.makeClient(key) : new Anthropic({ apiKey: key, maxRetries: 2 }) }
    return cached.client
  }

  return {
    status(): AiStatus {
      const s = load()
      const m = usage()[month()] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
      const costUsd =
        ((m.inputTokens * PRICE.input + m.outputTokens * PRICE.output + m.cacheReadTokens * PRICE.cacheRead) / 1e6) || 0
      return { hasKey: !!s.apiKey, keyEnding: s.keyEnding, statements: s.statements, chat: s.chat, chatMail: s.chatMail, phoneChat: s.phoneChat, model: AI_MODEL, month: { ...m, costUsd } }
    },

    /** Saves the key after checking it with Anthropic (a free model lookup, no tokens). */
    async setKey(apiKey: string): Promise<AiStatus> {
      const k = apiKey.trim()
      if (!/^sk-ant-[\w-]{20,}$/.test(k)) throw new Error('That doesn’t look like a Claude API key (it starts with sk-ant-).')
      const c = d.makeClient ? d.makeClient(k) : new Anthropic({ apiKey: k, maxRetries: 1 })
      try {
        await c.models.retrieve(AI_MODEL)
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic didn’t accept that key. Check it in the Claude Console.')
        if (e instanceof Anthropic.PermissionDeniedError) throw new Error('That key can’t use Claude Opus 5.5. Check its workspace in the Claude Console.')
        if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach Anthropic. Check the internet connection.')
        throw e
      }
      set(KEY, JSON.stringify({ ...load(), apiKey: d.encrypt(k), keyEnding: k.slice(-4) }))
      cached = null
      return this.status()
    },

    setFeatures(f: AiFeatures): AiStatus {
      const s = load()
      if ((f.statements || f.chat || f.chatMail || f.phoneChat) && !s.apiKey) throw new Error('Add your Claude API key first.')
      set(KEY, JSON.stringify({ ...s, ...f }))
      return this.status()
    },

    removeKey(): AiStatus {
      set(KEY, JSON.stringify({ apiKey: null, keyEnding: null, statements: false, chat: false, chatMail: false, phoneChat: false }))
      cached = null
      return this.status()
    },

    /** The client, only when the feature is switched on. */
    clientFor(feature: 'statements' | 'chat'): Anthropic {
      if (!load()[feature])
        throw new AiDisabledError(
          feature === 'statements'
            ? 'Reading statements with Claude is off. Turn it on in Settings → Claude.'
            : 'Ask your money is off. Turn it on in Settings → Claude.'
        )
      return client()
    },

    /** The key itself, for the phone app's locked copy; only while that is switched on. */
    phoneKey(): string | null {
      const s = load()
      return s.apiKey && s.chat && s.phoneChat ? d.decrypt(s.apiKey) : null
    },

    enabled: (feature: keyof AiFeatures) => !!load().apiKey && load()[feature],

    /** Adds a response's token use to this month's tally. */
    record(u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): void {
      const all = usage()
      const m = all[month()] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
      m.calls++
      m.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      m.outputTokens += u.output_tokens ?? 0
      m.cacheReadTokens += u.cache_read_input_tokens ?? 0
      all[month()] = m
      set(USAGE_KEY, JSON.stringify(all))
    }
  }
}

export type Ai = ReturnType<typeof createAi>
