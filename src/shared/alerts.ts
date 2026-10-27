// Alerts: price levels the person sets, and automatic ones for held and watched companies (results
// days, ex-dividend dates, important announcements, stake changes, 52-week highs and lows). Each
// fires once, as a desktop notification and a line in the Alerts screen.

export const RULE_KINDS = ['above', 'below', 'moveUp', 'moveDown'] as const
export type RuleKind = (typeof RULE_KINDS)[number]
export const RULE_LABEL: Record<RuleKind, string> = {
  above: 'Price goes above',
  below: 'Price goes below',
  moveUp: 'Up in a day by at least (%)',
  moveDown: 'Down in a day by at least (%)'
}

export interface AlertRule {
  id: number
  symbol: string
  kind: RuleKind
  value: number
  note: string | null
  /** Price levels switch off once reached; day moves stay on and fire at most once a day. */
  active: boolean
  firedAt: string | null
  createdAt: string
}

export interface AlertRuleInput {
  id?: number
  symbol: string
  kind: RuleKind
  value: number
  note?: string | null
}

export const AUTO_ALERTS = ['results', 'exDates', 'news', 'stakes', 'highs', 'weather', 'chokepoints'] as const
export type AutoAlert = (typeof AUTO_ALERTS)[number]
export const AUTO_LABEL: Record<AutoAlert, { title: string; help: string }> = {
  results: { title: 'Results days', help: 'The day before and the day a held company’s board meets on results.' },
  exDates: { title: 'Ex-dividend dates', help: 'The day before a held company goes ex-dividend, bonus or split.' },
  news: { title: 'Important announcements', help: 'Deals, orders, ratings, legal matters and new shares, from held and watched companies.' },
  stakes: { title: 'Stake changes', help: 'Promoters or foreign investors moving a point or more in a held company’s latest pattern.' },
  highs: { title: '52-week highs and lows', help: 'A held stock closing at its highest or lowest in a year.' },
  weather: { title: 'Farm weather', help: 'Heavy rain, rain on the way, heat, frost or strong wind at the farm today or tomorrow (set the village on the Farm page).' },
  chokepoints: { title: 'Shipping chokepoints', help: 'A sea route like Hormuz, Bab el-Mandeb or Suez carrying 30% fewer ships than a year ago (once the World map has been opened).' }
}

export interface AlertEvent {
  key: string
  at: string
  kind: RuleKind | AutoAlert
  symbol: string | null
  title: string
  body: string
  read: boolean
}

export interface AlertsReport {
  rules: AlertRule[]
  events: AlertEvent[]
  auto: Record<AutoAlert, boolean>
  unread: number
}

/** Whether a rule is met at this price (and the day's change from the previous close). */
export function ruleHit(rule: Pick<AlertRule, 'kind' | 'value'>, price: number, prevClose: number | null): boolean {
  switch (rule.kind) {
    case 'above':
      return price >= rule.value
    case 'below':
      return price <= rule.value
    case 'moveUp':
      return !!prevClose && (price / prevClose - 1) * 100 >= rule.value
    case 'moveDown':
      return !!prevClose && (1 - price / prevClose) * 100 >= rule.value
  }
}

/** Indian market hours, Monday to Friday 9:15 to 15:30 IST (holidays aren't known here; quotes just don't move). */
export function marketOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + 330 * 60_000)
  const day = ist.getUTCDay()
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 35
}
