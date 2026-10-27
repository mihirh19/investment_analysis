import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { ask } from '../src/shared/chat'
import type { ChatEvent } from '../src/shared/ai'
import { ALL_PAGES } from '../src/shared/screens'

describe('Ask your money opens screens', () => {
  it('opens a screen, a company view and a workspace in the terminal', async () => {
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
    const events: ChatEvent[] = []
    const src = {
      persons: () => [{ id: 1, name: 'Me' }],
      screens: ALL_PAGES.map((p) => ({ code: p.code, label: p.label, route: p.to })),
      workspaces: () => ['Home', 'Markets']
    }
    await ask(client, src as never, [{ role: 'user', text: 'show my tax' }], (e) => events.push(e), 'q', () => {})
    const t = (n: string) => seen[0].tools.find((x) => x.name === n)!
    expect(seen[0].system).toMatch(/open_screen/)
    expect(await t('open_screen').run({ screen: 'TAX' })).toBe('"Opened Tax in a new tab."')
    expect(await t('open_screen').run({ screen: 'x-ray' })).toBe('"Opened X-ray in a new tab."')
    expect(await t('open_screen').run({ symbol: 'infy', view: 'ownership' })).toBe('"Opened INFY (ownership) in a new tab."')
    expect(await t('open_screen').run({ screen: 'nowhere' })).toMatch(/^Error: No screen called nowhere/)
    expect(await t('open_workspace').run({ name: 'markets' })).toBe('"Switched to the Markets workspace."')
    expect(events.filter((e) => e.type === 'open' || e.type === 'workspace')).toEqual([
      { id: 'q', type: 'open', route: '/tax' },
      { id: 'q', type: 'open', route: '/xray' },
      { id: 'q', type: 'open', route: '/research/INFY?view=ownership' },
      { id: 'q', type: 'workspace', name: 'Markets' }
    ])

    // The phone has no screens to open.
    await ask(client, { ...src, where: 'phone' } as never, [{ role: 'user', text: 'hi' }], () => {}, 'q', () => {})
    expect(seen[1].tools.map((x) => x.name)).not.toContain('open_screen')
  })
})
