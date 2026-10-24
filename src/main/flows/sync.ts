import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { FlowsReport, FlowsStatus, FoPosition } from '@shared/flows'
import { schema, type Db } from '../db'
import { fetchWith, HttpError, type FetchFn } from '../market/http'
import { NSE_API, NSE_ARCHIVES, NseClient } from '../research/nse'
import { candidateDays } from '../research/sync'
import { aspFormFields, parseAmfiMonthly, parseDealsCsv, parseFiiDii, parseNsdlYear, parseParticipantOi, parseSast } from './parse'

// Keeps the money-flow screens current: FII/DII each evening, F&O positions for a year back,
// NSDL's monthly FPI figures since 2015, AMFI's monthly report since 2019, and NSE's deals and
// takeover disclosures. Nothing is fetched until the Flows screen is first opened.

export const FLOWS_KEY = 'flows:sync'
const HOUR = 3600_000
const DAY = 24 * HOUR
const NSDL_YEARS = 'https://www.fpi.nsdl.co.in/web/Reports/Yearwise.aspx?RptType=6'
const amfiUrl = (month: string) => {
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][Number(month.slice(5, 7)) - 1]
  return `https://portal.amfiindia.com/spages/am${mon}${month.slice(0, 4)}repo.xls`
}
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`
const dash = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
const istNow = () => new Date(Date.now() + 5.5 * HOUR)
const today = () => istNow().toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SOURCES: { key: string; label: string }[] = [
  { key: 'cash', label: 'FII/DII (NSE)' },
  { key: 'fo', label: 'F&O positions (NSE)' },
  { key: 'fpi', label: 'Foreign investors by month (NSDL)' },
  { key: 'mf', label: 'Mutual fund flows (AMFI)' },
  { key: 'deals', label: 'Bulk and block deals (NSE)' },
  { key: 'stakes', label: 'Takeover disclosures (NSE)' }
]

export class FlowsSync {
  private readonly nse: NseClient
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private lastError: string | null = null

  constructor(
    private readonly db: Db,
    private readonly onUpdate: () => void = () => {},
    private readonly f: FetchFn = fetch,
    private readonly gapMs = 1000
  ) {
    this.nse = new NseClient(f, Math.min(gapMs, 600))
  }

  private setting(key: string): string | null {
    return this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
  }
  private setSetting(key: string, value: string): void {
    this.db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
  }

  enabled(): boolean {
    return this.setting(FLOWS_KEY) === 'on'
  }
  setEnabled(on: boolean): void {
    this.setSetting(FLOWS_KEY, on ? 'on' : 'off')
    if (on) void this.run()
  }
  /** The screen was opened: the first time, this switches the downloads on. */
  opened(): void {
    if (this.setting(FLOWS_KEY) === null) this.setEnabled(true)
  }

  start(): void {
    void this.run()
    this.timer = setInterval(() => void this.run(), 30 * 60_000)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): FlowsStatus {
    const latest = (sqlText: ReturnType<typeof sql<string | null>>) => this.db.get<{ v: string | null }>(sql`select ${sqlText} as v`)?.v ?? null
    return {
      enabled: this.enabled(),
      refreshing: this.running !== null,
      lastError: this.lastError,
      sources: SOURCES.map((s) => ({
        ...s,
        latest:
          s.key === 'cash'
            ? latest(sql`(select max(date) from flow_cash)`)
            : s.key === 'fo'
              ? latest(sql`(select max(date) from flow_fo)`)
              : s.key === 'fpi'
                ? latest(sql`(select max(month) from flow_fpi)`)
                : s.key === 'mf'
                  ? latest(sql`(select max(month) from flow_mf)`)
                  : s.key === 'deals'
                    ? latest(sql`(select max(date) from flow_deals)`)
                    : latest(sql`(select max(date) from flow_stakes)`)
      }))
    }
  }

  run(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      await Promise.resolve()
      try {
        if (!this.enabled()) return
        this.lastError = null
        for (const [name, step] of [
          ['cash', () => this.cash()],
          ['stakes', () => this.stakes()],
          ['deals', () => this.deals()],
          ['fo', () => this.fo()],
          ['fpi', () => this.fpi()],
          ['mf', () => this.mf()]
        ] as const) {
          if (!this.enabled()) break
          try {
            await step()
          } catch (e) {
            // One source failing doesn't stop the others; it is tried again next time.
            this.lastError = `${SOURCES.find((s) => s.key === name)?.label}: ${e instanceof Error ? e.message : String(e)}`
          }
          this.onUpdate()
        }
      } finally {
        this.running = null
        this.onUpdate()
      }
    })()
    return this.running
  }

  // ---------------- bookkeeping ----------------

  private fetched(key: string): { status: 'DONE' | 'NONE'; at: string } | undefined {
    return this.db.select().from(schema.flowFetched).where(eq(schema.flowFetched.key, key)).get()
  }
  private mark(key: string, status: 'DONE' | 'NONE'): void {
    const at = new Date().toISOString()
    this.db.insert(schema.flowFetched).values({ key, status, at }).onConflictDoUpdate({ target: schema.flowFetched.key, set: { status, at } }).run()
  }
  /** Fetched within `ms`? */
  private fresh(key: string, ms: number): boolean {
    const r = this.fetched(key)
    return !!r && Date.now() - Date.parse(r.at) < ms
  }
  /** NSDL and AMFI: plain requests, a pause after each. */
  private async getText(url: string, init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {}): Promise<string> {
    const res = await fetchWith(url, { fetch: this.f, timeoutMs: 60_000, ...init }, (r) => r.text())
    await sleep(this.gapMs)
    return res
  }
  private async getBytes(url: string): Promise<Uint8Array> {
    const res = await fetchWith(url, { fetch: this.f, timeoutMs: 60_000 }, async (r) => new Uint8Array(await r.arrayBuffer()))
    await sleep(this.gapMs)
    return res
  }

  // ---------------- sources ----------------

  /** Today's FII and DII buying and selling: NSE keeps only the latest day, so each is saved as it comes. */
  private async cash(): Promise<void> {
    const day = candidateDays(istNow(), 1)[0]
    const have = this.db.select().from(schema.flowCash).where(eq(schema.flowCash.date, day)).get()
    if (have || this.fresh('cash', 2 * HOUR)) return
    const rows = parseFiiDii(await this.nse.json(`${NSE_API}/fiidiiTradeReact`))
    this.db.transaction((tx) => {
      for (const r of rows) tx.insert(schema.flowCash).values(r).onConflictDoUpdate({ target: [schema.flowCash.date, schema.flowCash.category], set: r }).run()
    })
    this.mark('cash', 'DONE')
  }

  /** F&O open positions by type of trader, one small file a trading day, a year back. */
  private async fo(): Promise<void> {
    const recent = new Set(candidateDays(istNow(), 3))
    for (const day of candidateDays(istNow(), 250)) {
      if (!this.enabled()) return
      if (this.fetched(`fo:${day}`)) continue
      try {
        const rows = parseParticipantOi(await this.nse.text(`${NSE_ARCHIVES}/content/nsccl/fao_participant_oi_${ddmmyyyy(day)}.csv`), day)
        this.db.transaction((tx) => {
          for (const r of rows)
            tx.insert(schema.flowFo)
              .values({ date: r.date, client: r.client, dataJson: JSON.stringify(r) })
              .onConflictDoUpdate({ target: [schema.flowFo.date, schema.flowFo.client], set: { dataJson: JSON.stringify(r) } })
              .run()
        })
        this.mark(`fo:${day}`, rows.length ? 'DONE' : 'NONE')
      } catch (e) {
        // A holiday has no file; the last few days may just not be out yet.
        if (e instanceof HttpError && e.status === 404) {
          if (!recent.has(day)) this.mark(`fo:${day}`, 'NONE')
          continue
        }
        throw e
      }
    }
  }

  /** NSDL's monthly FPI net investment: each past year once, the current one twice a day. */
  private async fpi(): Promise<void> {
    const year = Number(today().slice(0, 4))
    if (!this.fresh(`fpi:${year}`, 12 * HOUR)) {
      const html = await this.getText(NSDL_YEARS)
      this.saveFpi(parseNsdlYear(html))
      this.mark(`fpi:${year}`, 'DONE')
      for (let y = year - 1; y >= 2015; y--) {
        if (!this.enabled()) return
        if (this.fetched(`fpi:${y}`)) continue
        // ASP.NET: the year is chosen by posting the form back with its hidden state.
        const body = new URLSearchParams({ ...aspFormFields(html), __EVENTTARGET: 'ddl', __EVENTARGUMENT: '', ddl: String(y) }).toString()
        const page = await this.getText(NSDL_YEARS, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        const months = parseNsdlYear(page)
        if (months.length === 0) throw new Error(`NSDL sent no figures for ${y}`)
        this.saveFpi(months)
        this.mark(`fpi:${y}`, 'DONE')
      }
    }
  }
  private saveFpi(months: ReturnType<typeof parseNsdlYear>): void {
    this.db.transaction((tx) => {
      for (const m of months) {
        const { month, ...rest } = m
        tx.insert(schema.flowFpi).values(m).onConflictDoUpdate({ target: schema.flowFpi.month, set: rest }).run()
      }
    })
  }

  /** AMFI's monthly report, from April 2019 (the current categories) to last month. */
  private async mf(): Promise<void> {
    const now = istNow()
    const months: string[] = []
    for (let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); d >= new Date(Date.UTC(2019, 3, 1)); d.setUTCMonth(d.getUTCMonth() - 1))
      months.push(d.toISOString().slice(0, 7))
    for (const month of months) {
      if (!this.enabled()) return
      if (this.fetched(`mf:${month}`)) continue
      try {
        const rows = parseAmfiMonthly(await this.getBytes(amfiUrl(month)), month)
        this.db.transaction((tx) => {
          for (const r of rows)
            tx.insert(schema.flowMf)
              .values({ ...r, grp: r.group })
              .onConflictDoUpdate({ target: [schema.flowMf.month, schema.flowMf.grp, schema.flowMf.category], set: { ...r, grp: r.group } })
              .run()
        })
        // Published around the 10th: a recent month with nothing in it may simply not be out yet.
        if (rows.length) this.mark(`mf:${month}`, 'DONE')
        else if (Date.now() - Date.parse(`${month}-01`) > 60 * DAY) this.mark(`mf:${month}`, 'NONE')
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) {
          if (Date.now() - Date.parse(`${month}-01`) > 60 * DAY) this.mark(`mf:${month}`, 'NONE')
          continue
        }
        throw e
      }
    }
  }

  /** Bulk and block deals, month by month for six months; the current month again each day. */
  private async deals(): Promise<void> {
    const now = istNow()
    for (let back = 0; back < 6; back++) {
      if (!this.enabled()) return
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
      const end = back === 0 ? now : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0))
      const key = `deals:${start.toISOString().slice(0, 7)}`
      if (back === 0 ? this.fresh(key, 12 * HOUR) : this.fetched(key)) continue
      for (const kind of ['bulk', 'block'] as const) {
        const csv = await this.nse.text(
          `${NSE_API}/historicalOR/bulk-block-short-deals?optionType=${kind}_deals&from=${dash(start.toISOString())}&to=${dash(end.toISOString())}&csv=true`
        )
        const rows = parseDealsCsv(csv, kind === 'bulk' ? 'BULK' : 'BLOCK')
        this.db.transaction((tx) => {
          for (const r of rows) tx.insert(schema.flowDeals).values(r).onConflictDoNothing().run()
        })
      }
      this.mark(key, 'DONE')
    }
  }

  /** Takeover-code disclosures (5%+ stakes): the last 90 days the first time, then each day. */
  private async stakes(): Promise<void> {
    if (this.fresh('stakes', 12 * HOUR)) return
    const from = this.fetched('stakes') ? new Date(Date.now() - 10 * DAY) : new Date(Date.now() - 90 * DAY)
    const rows = parseSast(
      await this.nse.json(`${NSE_API}/corporate-sast-reg29?index=equities&from_date=${dash(from.toISOString())}&to_date=${dash(today())}`)
    )
    this.db.transaction((tx) => {
      for (const r of rows) {
        const { id, ...rest } = r
        tx.insert(schema.flowStakes).values(r).onConflictDoUpdate({ target: schema.flowStakes.id, set: rest }).run()
      }
    })
    this.mark('stakes', 'DONE')
  }
}

/** Everything the Flows screen shows. */
export function flowsReport(db: Db, status: FlowsStatus): FlowsReport {
  const since = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10)
  const cash = db.select().from(schema.flowCash).where(gte(schema.flowCash.date, since(400))).orderBy(desc(schema.flowCash.date)).all()
  const fo = db
    .select()
    .from(schema.flowFo)
    .where(gte(schema.flowFo.date, since(400)))
    .orderBy(desc(schema.flowFo.date))
    .all()
    .map((r) => JSON.parse(r.dataJson) as FoPosition)
  const fpi = db.select().from(schema.flowFpi).orderBy(desc(schema.flowFpi.month)).all()
  const latestMf = db.get<{ m: string | null }>(sql`select max(month) as m from flow_mf`)?.m ?? null
  const mf = latestMf
    ? db
        .select()
        .from(schema.flowMf)
        .where(eq(schema.flowMf.month, latestMf))
        .all()
        .map((r) => ({ ...r, group: r.grp }))
    : []
  const byMonth = db.all<{ month: string; equity: number; debt: number; hybrid: number; total: number }>(sql`
    select month,
      sum(case when grp = 'Equity' then net else 0 end) as equity,
      sum(case when grp = 'Debt' then net else 0 end) as debt,
      sum(case when grp = 'Hybrid' then net else 0 end) as hybrid,
      sum(net) as total
    from flow_mf group by month order by month desc`)
  const deals = db.select().from(schema.flowDeals).where(gte(schema.flowDeals.date, since(60))).orderBy(desc(schema.flowDeals.date)).all()
  const stakes = db
    .select()
    .from(schema.flowStakes)
    .where(and(gte(schema.flowStakes.date, since(120))))
    .orderBy(desc(schema.flowStakes.date))
    .all()
  return {
    cash,
    fo,
    fpi,
    mf: mf.map(({ grp: _g, ...r }) => r),
    mfEquityByMonth: byMonth,
    deals,
    stakes,
    status
  }
}
