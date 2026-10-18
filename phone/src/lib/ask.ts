// Ask your money on the phone: the desktop's chat (same prompt, same tools) answering from the
// figures in the synced copy. Claude is called straight from the phone with the person's own key,
// which arrives inside the passphrase-locked copy; there is no server in between.

import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent, ChatTurn } from '@shared/ai'
import { ask, type ChatSources } from '@shared/chat'
import type { PhoneSnapshot } from '@shared/phone'
import { fundHistory, type PricePoint } from '@shared/returns'

const ON_COMPUTER = (page: string) => ({ note: `Not in the phone app: see the ${page} page on the computer.` })

/** mfapi.in's NAV history (it allows requests from browsers). */
async function navHistory(code: string, since: string): Promise<PricePoint[]> {
  const until = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}?startDate=${since}&endDate=${until}`)
  if (!res.ok) throw new Error(`mfapi.in: ${res.status}`)
  const json = (await res.json()) as { data?: { date: string; nav: string }[] }
  return (json.data ?? [])
    .map((d) => {
      const [dd, mm, yyyy] = d.date.split('-')
      return { date: `${yyyy}-${mm}-${dd}`, close: Number(d.nav) }
    })
    .filter((p) => p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** What the phone's chat can look up: the synced copy, cut to what each question needs. */
export function phoneSources(s: PhoneSnapshot): ChatSources {
  const scope = (pid?: number) => s.scopes[pid === undefined ? 'family' : String(pid)] ?? s.scopes.family
  const mine = <T extends { personId: number }>(xs: T[], pid?: number) => (pid === undefined ? xs : xs.filter((x) => x.personId === pid))
  const personName = (id: number) => s.persons.find((p) => p.id === id)?.name ?? ''
  return {
    where: 'phone',
    persons: () => s.persons,
    overview(pid) {
      const x = scope(pid)
      return {
        pricesAsOf: s.pricesAsOf,
        syncedAt: s.generatedAt,
        netWorthInr: x.netWorth,
        investedInr: x.invested,
        dayChangeInr: x.dayChange,
        xirr: x.xirr,
        xirrCoverage: x.xirrCoverage,
        byKind: x.byGroup,
        netWorthByMonth: x.history.months.slice(-24).map((m, i, all) => ({ month: m, value: x.history.values[x.history.values.length - all.length + i] }))
      }
    },
    holdings: (pid) =>
      mine(s.holdings, pid).map((h) => ({
        person: personName(h.personId),
        name: h.name,
        account: h.account,
        kind: h.assetClass,
        units: h.quantity,
        price: h.price,
        priceDate: h.priceDate,
        valueInr: h.value,
        investedInr: h.invested,
        gainInr: h.invested === null ? null : h.value - h.invested,
        dayChangeInr: h.dayChange,
        amfiCode: h.amfiCode ?? null
      })),
    tax: (pid) => scope(pid).tax ?? { note: 'No capital gains figures in the synced copy yet; sync the computer (version 0.15 or later).' },
    performance: (pid) => ({ xirr: scope(pid).xirr, xirrCoverage: scope(pid).xirrCoverage, ...ON_COMPUTER('Performance') }),
    income: (pid) => ({ incomeThisFy: scope(pid).incomeThisFy, upcoming: scope(pid).upcoming }),
    spending(pid, search) {
      const sp = scope(pid).spending
      if (!sp) return { note: 'No card or bank statements read for this person yet (Spending page on the computer).' }
      const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      return {
        spendingByMonth: sp.months,
        cardBillsDue: sp.dues,
        latest: words.length ? sp.recent.filter((t) => words.every((w) => `${t.merchant} ${t.category} ${t.account}`.toLowerCase().includes(w))) : sp.recent.slice(0, 20)
      }
    },
    property: (pid) => mine(s.properties, pid).map((p) => ({ ...p, market: p.market ? { ...p.market, series: undefined, cityAll: undefined } : null })),
    vehicles: (pid) => mine(s.vehicles, pid).map(({ costs, ...v }) => ({ ...v, costs: { ...costs, monthly: undefined } })),
    forecast: () =>
      s.forecast
        ? { ...s.forecast, years: s.forecast.years.filter((y, i, all) => i === 0 || y.year % 5 === 0 || i === all.length - 1).map(({ byBucket: _b, ...y }) => y) }
        : { note: 'No forecast in the synced copy.' },
    sectors: () => ON_COMPUTER('Sectors & exposure'),
    funds: () => ON_COMPUTER('Funds'),
    retirement: () => ({
      retirementHoldings: s.holdings.filter((h) => ['EPF', 'NPS', 'PPF'].includes(h.assetClass)).map((h) => ({ person: personName(h.personId), name: h.name, valueInr: h.value })),
      insurance: s.policies
    }),
    fundHistory: (code) => fundHistory(code, navHistory)
  }
}

let client: { key: string; c: Anthropic } | null = null

/** Asks one question; the answer streams to `emit`. */
export async function askOnPhone(s: PhoneSnapshot, history: ChatTurn[], emit: (e: ChatEvent) => void, id: string): Promise<void> {
  if (!s.ai) throw new Error('Ask your money is off for the phone. Turn it on on the computer: Settings → Claude.')
  if (client?.key !== s.ai.apiKey) client = { key: s.ai.apiKey, c: new Anthropic({ apiKey: s.ai.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }) }
  try {
    await ask(client.c, phoneSources(s), history, emit, id, () => {})
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    emit({ id, type: 'error', message: /401|authentication/i.test(m) ? 'Claude didn’t accept the key. Check it on the computer (Settings → Claude), then sync.' : m })
  }
}
