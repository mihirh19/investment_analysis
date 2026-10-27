import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import {
  AUTO_ALERTS,
  marketOpen,
  ruleHit,
  RULE_LABEL,
  type AlertEvent,
  type AlertRule,
  type AlertRuleInput,
  type AlertsReport,
  type AutoAlert,
  type RuleKind
} from '@shared/alerts'
import { ANN_TAG_LABEL, type AnnTag, type LiveQuote } from '@shared/research'
import { schema, type Db } from './db'
import { heldStocks, ownershipReport, watchedSymbols } from './research/store'
import { storedWeather } from './farmWeather'
import { places } from './world/store'

/**
 * The alerts engine: checks the person's price rules against delayed quotes during market hours,
 * and the automatic alerts against what the research download has stored. Every alert is stored
 * under a key that says what it was about, so it fires once however often the checks run.
 */

const AUTO_KEY = 'alerts:auto'
const IMPORTANT: AnnTag[] = ['deal', 'orders', 'rating', 'legal', 'capital', 'results']

const istDay = (offsetDays = 0, now = Date.now()) => new Date(now + 330 * 60_000 + offsetDays * 86400_000).toISOString().slice(0, 10)

function getSetting(db: Db, key: string): string | null {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
}

export function autoAlerts(db: Db): Record<AutoAlert, boolean> {
  return { ...(Object.fromEntries(AUTO_ALERTS.map((a) => [a, true])) as Record<AutoAlert, boolean>), ...JSON.parse(getSetting(db, AUTO_KEY) ?? '{}') }
}

export function setAutoAlerts(db: Db, auto: Partial<Record<AutoAlert, boolean>>): void {
  const value = JSON.stringify({ ...autoAlerts(db), ...auto })
  db.insert(schema.settings).values({ key: AUTO_KEY, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
}

const toRule = (r: typeof schema.alertRules.$inferSelect): AlertRule => ({ ...r, kind: r.kind as RuleKind })

export function saveAlertRule(db: Db, input: AlertRuleInput): AlertRule {
  const symbol = input.symbol.trim().toUpperCase()
  if (!/^[\^A-Z0-9&.=_-]{1,30}$/.test(symbol)) throw new Error('Enter an NSE symbol, like INFY.')
  if (!(input.value > 0)) throw new Error('Enter a number above zero.')
  const v = { symbol, kind: input.kind, value: input.value, note: input.note?.trim() || null, active: true, firedAt: null }
  const row = input.id
    ? db.update(schema.alertRules).set(v).where(eq(schema.alertRules.id, input.id)).returning().get()
    : db.insert(schema.alertRules).values({ ...v, createdAt: new Date().toISOString() }).returning().get()
  if (!row) throw new Error('That alert no longer exists.')
  return toRule(row)
}

export function deleteAlertRule(db: Db, id: number): void {
  db.delete(schema.alertRules).where(eq(schema.alertRules.id, id)).run()
}

/** Symbols with an active rule: the only ones the watcher asks quotes for. */
export function ruleSymbols(db: Db): string[] {
  return [...new Set(db.select().from(schema.alertRules).where(eq(schema.alertRules.active, true)).all().map((r) => r.symbol))]
}

function record(db: Db, e: Omit<AlertEvent, 'read' | 'at'>, at = new Date().toISOString()): AlertEvent | null {
  const row = db.insert(schema.alertEvents).values({ ...e, at, read: false }).onConflictDoNothing().returning().get()
  return row ? { ...row, kind: row.kind as AlertEvent['kind'] } : null
}

/** Rules met by these quotes. Price levels switch off once reached; day moves fire once a day. */
export function checkRules(db: Db, quotes: LiveQuote[], now = Date.now()): AlertEvent[] {
  const by = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]))
  const today = istDay(0, now)
  const out: AlertEvent[] = []
  for (const r of db.select().from(schema.alertRules).where(eq(schema.alertRules.active, true)).all()) {
    const q = by.get(r.symbol)
    if (!q || !ruleHit({ kind: r.kind as RuleKind, value: r.value }, q.price, q.prevClose)) continue
    const daily = r.kind === 'moveUp' || r.kind === 'moveDown'
    if (daily && r.firedAt && istDay(0, Date.parse(r.firedAt)) === today) continue
    const change = q.prevClose ? (q.price / q.prevClose - 1) * 100 : null
    const e = record(db, {
      // A level fires once and switches off; set again, it fires again under a new key.
      key: `rule:${r.id}:${daily ? today : new Date(now).toISOString()}`,
      kind: r.kind as RuleKind,
      symbol: r.symbol,
      title: `${r.symbol} at ₹${q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${change !== null ? ` (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)` : ''}`,
      body: `${RULE_LABEL[r.kind as RuleKind]} ${daily ? `${r.value}%` : `₹${r.value.toLocaleString('en-IN')}`}${r.note ? `: ${r.note}` : ''}. Prices are delayed.`
    })
    db.update(schema.alertRules)
      .set({ firedAt: new Date(now).toISOString(), active: daily })
      .where(eq(schema.alertRules.id, r.id))
      .run()
    if (e) out.push(e)
  }
  return out
}

/** The automatic alerts that are switched on, from what is stored. Only recent things count, so a first run doesn't flood. */
export function checkAuto(db: Db, now = Date.now()): AlertEvent[] {
  const on = autoAlerts(db)
  const held = heldStocks(db)
  const heldSet = new Set(held.keys())
  const out: AlertEvent[] = []
  const push = (e: AlertEvent | null) => e && out.push(e)
  const today = istDay(0, now)
  const tomorrow = istDay(1, now)
  const symbols = [...heldSet]

  if (on.results && symbols.length) {
    for (const r of db.select().from(schema.researchEvents).where(and(inArray(schema.researchEvents.symbol, symbols), inArray(schema.researchEvents.date, [today, tomorrow]))).all()) {
      if (!/result/i.test(r.purpose)) continue
      push(record(db, { key: `results:${r.symbol}:${r.date}`, kind: 'results', symbol: r.symbol, title: `${r.symbol} results ${r.date === today ? 'today' : 'tomorrow'}`, body: `${r.company}: ${r.purpose}.` }))
    }
  }
  if (on.exDates && symbols.length) {
    for (const a of db.select().from(schema.researchActions).where(and(inArray(schema.researchActions.symbol, symbols), eq(schema.researchActions.exDate, tomorrow))).all()) {
      const h = held.get(a.symbol)
      const expected = h && a.kind === 'DIVIDEND' && a.amount ? ` About ₹${Math.round(h.quantity * a.amount).toLocaleString('en-IN')} on your shares, before tax.` : ''
      push(record(db, { key: `ex:${a.symbol}:${a.exDate}:${a.subject}`, kind: 'exDates', symbol: a.symbol, title: `${a.symbol} goes ex tomorrow`, body: `${a.subject}.${expected}` }))
    }
  }
  if (on.news) {
    const mine = [...new Set([...heldSet, ...watchedSymbols(db)])]
    const since = new Date(now - 6 * 3600_000).toISOString()
    if (mine.length)
      for (const a of db
        .select()
        .from(schema.researchAnnouncements)
        .where(and(inArray(schema.researchAnnouncements.symbol, mine), inArray(schema.researchAnnouncements.tag, IMPORTANT)))
        .all()) {
        if (Date.parse(a.at) < Date.parse(since)) continue
        push(record(db, { key: `news:${a.id}`, kind: 'news', symbol: a.symbol, title: `${a.symbol}: ${ANN_TAG_LABEL[a.tag as AnnTag]}`, body: (a.text || a.category).slice(0, 220) }, a.at))
      }
  }
  if (on.stakes) {
    const recent = istDay(-10, now)
    for (const c of ownershipReport(db, today).mine) {
      if (!c.held || c.asOf < istDay(-120, now)) continue
      const moves = [
        c.promoterChange !== null && Math.abs(c.promoterChange) >= 0.01 ? `promoters ${c.promoterChange > 0 ? 'up' : 'down'} ${Math.abs(c.promoterChange * 100).toFixed(2)} points` : null,
        c.fpiChange !== null && Math.abs(c.fpiChange) >= 0.01 ? `foreign investors ${c.fpiChange > 0 ? 'up' : 'down'} ${Math.abs(c.fpiChange * 100).toFixed(2)} points` : null
      ].filter(Boolean)
      if (moves.length === 0) continue
      const filed = db.select({ f: schema.researchShp.filedAt }).from(schema.researchShp).where(and(eq(schema.researchShp.symbol, c.symbol), eq(schema.researchShp.asOf, c.asOf))).get()?.f
      if (filed && filed < recent) continue
      push(record(db, { key: `stake:${c.symbol}:${c.asOf}`, kind: 'stakes', symbol: c.symbol, title: `${c.symbol}: who owns it changed`, body: `In the latest pattern, ${moves.join(' and ')}.` }))
    }
  }
  if (on.highs && symbols.length) {
    for (const q of db.select().from(schema.researchQuotes).where(and(inArray(schema.researchQuotes.symbol, symbols), gte(schema.researchQuotes.date, istDay(-3, now)))).all()) {
      if (q.high52 && q.close >= q.high52) push(record(db, { key: `high:${q.symbol}:${q.date}`, kind: 'highs', symbol: q.symbol, title: `${q.symbol} at a 52-week high`, body: `Closed at ₹${q.close.toLocaleString('en-IN')} on ${q.date}.` }))
      else if (q.low52 && q.close <= q.low52) push(record(db, { key: `low:${q.symbol}:${q.date}`, kind: 'highs', symbol: q.symbol, title: `${q.symbol} at a 52-week low`, body: `Closed at ₹${q.close.toLocaleString('en-IN')} on ${q.date}.` }))
    }
  }
  if (on.weather) {
    const w = storedWeather(db)
    for (const x of w.warnings)
      if (x.date <= tomorrow) push(record(db, { key: `weather:${x.date}:${x.kind}`, kind: 'weather', symbol: null, title: `${x.title} at ${w.place?.name ?? 'the farm'}`, body: x.detail }))
  }
  if (on.chokepoints) {
    for (const p of places(db)) {
      if (p.kind !== 'chokepoint' || !p.followed || !p.latestDate || p.recent === null || !p.yearAgo || p.yearAgo < 3) continue
      if (p.latestDate < istDay(-10, now)) continue
      const fall = 1 - p.recent / p.yearAgo
      if (fall < 0.3) continue
      // At most once a fortnight for the same chokepoint.
      const fortnight = Math.floor(Date.parse(p.latestDate) / (14 * 86400_000))
      push(
        record(db, {
          key: `choke:${p.id}:${fortnight}`,
          kind: 'chokepoints',
          symbol: null,
          title: `${p.name}: ${Math.round(fall * 100)}% fewer ships`,
          body: `About ${p.recent.toFixed(0)} ships a day over the week to ${p.latestDate}, against ${p.yearAgo.toFixed(0)} a year before (IMF PortWatch). Disruption on a sea route can raise freight and oil prices.`
        })
      )
    }
  }
  return out
}

export function alertsReport(db: Db): AlertsReport {
  const events = db
    .select()
    .from(schema.alertEvents)
    .orderBy(desc(schema.alertEvents.at))
    .limit(150)
    .all()
    .map((e) => ({ ...e, kind: e.kind as AlertEvent['kind'] }))
  return {
    rules: db.select().from(schema.alertRules).orderBy(desc(schema.alertRules.id)).all().map(toRule),
    events,
    auto: autoAlerts(db),
    unread: db.select().from(schema.alertEvents).where(eq(schema.alertEvents.read, false)).all().length
  }
}

export function markAlertsRead(db: Db): void {
  db.update(schema.alertEvents).set({ read: true }).where(eq(schema.alertEvents.read, false)).run()
}

/** Runs the checks every few minutes; quotes only for symbols with a rule, and only while the market is open. */
export class AlertWatcher {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  constructor(
    private readonly db: Db,
    private readonly quotes: (symbols: string[]) => Promise<LiveQuote[]>,
    private readonly onEvents: (events: AlertEvent[]) => void,
    /** Brings stored data up to date first (the farm's forecast). */
    private readonly before: () => Promise<unknown> = async () => null
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.check(), 5 * 60_000)
    setTimeout(() => void this.check(), 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.before().catch(() => null)
      const events = checkAuto(this.db)
      const symbols = ruleSymbols(this.db)
      if (symbols.length && marketOpen()) events.push(...checkRules(this.db, await this.quotes(symbols).catch(() => [])))
      if (events.length) this.onEvents(events)
    } finally {
      this.busy = false
    }
  }
}
