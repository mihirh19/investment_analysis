import { eq } from 'drizzle-orm'
import {
  TRADE_PRODUCTS,
  WB_INDICATORS,
  WORLD_INDICES,
  type WorldMetricKey,
  type WorldSourceStatus
} from '@shared/world'
import { schema, type Db } from '../db'
import { getJson, getText, HttpError, type FetchFn } from '../market/http'
import {
  mergeEvents,
  parseArcgis,
  parseBisFx,
  parseBisPolicy,
  parseComtrade,
  parseGdacs,
  parseOecdLatest,
  parsePlaces,
  parseScfi,
  parseTraffic,
  parseUsgs,
  parseWorldBank,
  parseYahooSpark,
  type Figure
} from './parse'
import * as store from './store'

export const WORLD_SYNC_KEY = 'world:sync'
const STATUS_KEY = 'world:sources'
/** When each World Bank indicator last arrived. */
const WB_DONE_KEY = 'world:worldbank'
/** Every source is told who is asking; none of them needs an account or a key. */
export const WORLD_UA = 'FamilyPortfolio (personal desktop app)'
const HOUR = 3600_000
const DAY = 24 * HOUR
const PORTWATCH = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services'
/** About 13 months of daily traffic: enough to compare a week with the same week a year before. */
const HISTORY_DAYS = 400

interface SourceState {
  /** Last successful fetch. */
  ok: string | null
  /** Last attempt, successful or not. */
  tried: string | null
  error: string | null
  /** When a slow-changing reference list (PortWatch's ports) was last read. */
  refAt?: string | null
}

interface Source {
  key: string
  label: string
  credit: string
  every: number
  run(): Promise<void>
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Keeps the World map's data current in the background: each source on its own timetable (weekly,
 * monthly, every 15 minutes for disasters), one request at a time, slowly. Off until the map is
 * first opened, and the person can pause it.
 */
export class WorldSync {
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  readonly sources: Source[]

  constructor(
    private readonly db: Db,
    private readonly onUpdate: () => void = () => {},
    private readonly f: FetchFn = fetch,
    private readonly gapMs = 1000,
    /** UN Comtrade's preview answers HTTP 429 when asked more often than every few seconds. */
    private readonly comtradeGapMs = 6000,
    private readonly now: () => Date = () => new Date()
  ) {
    this.sources = [
      {
        key: 'events',
        label: 'Earthquakes and disasters',
        credit: 'USGS, GDACS',
        every: 15 * 60_000,
        run: () => this.events()
      },
      { key: 'markets', label: 'Stock indices', credit: 'Yahoo Finance', every: 6 * HOUR, run: () => this.markets() },
      {
        key: 'chokepoints',
        label: 'Chokepoint transits',
        credit: 'IMF PortWatch',
        every: 7 * DAY,
        run: () => this.chokepoints()
      },
      { key: 'ports', label: 'Port calls (India)', credit: 'IMF PortWatch', every: 7 * DAY, run: () => this.ports() },
      { key: 'bis', label: 'Policy rates and currencies', credit: 'BIS', every: 7 * DAY, run: () => this.bis() },
      {
        key: 'oecd',
        label: 'Bond yields and leading indicators',
        credit: 'OECD',
        every: 7 * DAY,
        run: () => this.oecd()
      },
      {
        key: 'freight',
        label: 'Container freight (SCFI)',
        credit: 'Shanghai Shipping Exchange',
        every: DAY,
        run: () => this.freight()
      },
      {
        key: 'worldbank',
        label: 'Country figures',
        credit: 'World Bank',
        every: 30 * DAY,
        run: () => this.worldBank()
      },
      { key: 'comtrade', label: 'Trade with India', credit: 'UN Comtrade', every: 30 * DAY, run: () => this.comtrade() }
    ]
  }

  // ---- switch and status ----

  private setting(key: string): string | null {
    return this.db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null
  }
  private setSetting(key: string, value: string): void {
    this.db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
  }

  enabled(): boolean {
    return this.setting(WORLD_SYNC_KEY) === 'on'
  }

  /** The map was opened: the background updates start the first time (unless paused before). */
  opened(): void {
    if (this.setting(WORLD_SYNC_KEY) === null) this.setEnabled(true)
  }

  setEnabled(on: boolean): void {
    this.setSetting(WORLD_SYNC_KEY, on ? 'on' : 'off')
    if (on) void this.run()
  }

  private states(): Record<string, SourceState> {
    try {
      return JSON.parse(this.setting(STATUS_KEY) ?? '{}') as Record<string, SourceState>
    } catch {
      return {}
    }
  }
  private record(key: string, patch: Partial<SourceState>): void {
    const all = this.states()
    const base: SourceState = { ok: null, tried: null, error: null }
    all[key] = Object.assign(base, all[key], patch)
    this.setSetting(STATUS_KEY, JSON.stringify(all))
  }

  status(): { sources: WorldSourceStatus[]; enabled: boolean; refreshing: boolean } {
    const st = this.states()
    return {
      enabled: this.enabled(),
      refreshing: this.running !== null,
      sources: this.sources.map((s) => ({
        key: s.key,
        label: s.label,
        credit: s.credit,
        updatedAt: st[s.key]?.ok ?? null,
        error: st[s.key]?.error ?? null,
        everyHours: s.every / HOUR
      }))
    }
  }

  // ---- timing ----

  start(): void {
    this.first = setTimeout(() => void this.run(), 60_000)
    this.timer = setInterval(() => void this.run(), 5 * 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.first) clearTimeout(this.first)
    this.timer = this.first = null
  }

  private due(s: Source, st: SourceState | undefined): boolean {
    if (!st?.tried) return true
    const since = this.now().getTime() - Date.parse(st.tried)
    // A failed source is tried again within two hours rather than waiting its whole period.
    return since >= (st.error ? Math.min(s.every, 2 * HOUR) : s.every)
  }

  /** Fetches every source that is due (all of them when forced), one after another. */
  run(force = false): Promise<void> {
    if (!this.enabled()) return Promise.resolve()
    this.running ??= (async () => {
      try {
        for (const s of this.sources) {
          if (!this.enabled()) break
          if (!force && !this.due(s, this.states()[s.key])) continue
          const tried = this.now().toISOString()
          try {
            await s.run()
            this.record(s.key, { ok: this.now().toISOString(), tried, error: null })
          } catch (e) {
            this.record(s.key, { tried, error: e instanceof Error ? e.message : String(e) })
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

  // ---- fetching ----

  /** One more try, after a pause, when a server is briefly unwell (5xx) or asks us to slow down (429). */
  private async again<T>(get: () => Promise<T>): Promise<T> {
    try {
      return await get()
    } catch (e) {
      if (!(e instanceof HttpError) || !(e.status >= 500 || e.status === 429)) throw e
      await sleep(this.gapMs * 10)
      return get()
    }
  }
  private json<T>(url: string, headers: Record<string, string> = {}, timeoutMs = 30_000): Promise<T> {
    return this.again(() =>
      getJson<T>(url, {
        fetch: this.f,
        timeoutMs,
        headers: { 'User-Agent': WORLD_UA, Accept: 'application/json', ...headers }
      })
    )
  }
  private text(url: string, headers: Record<string, string> = {}): Promise<string> {
    return this.again(() =>
      getText(url, { fetch: this.f, timeoutMs: 30_000, headers: { 'User-Agent': WORLD_UA, ...headers } })
    )
  }

  /** Every row of a PortWatch query, a thousand at a time. */
  private async arcgis(service: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    for (let page = 0; page < 80; page++) {
      const q = new URLSearchParams({
        ...params,
        orderByFields: 'ObjectId',
        resultOffset: String(out.length),
        resultRecordCount: '1000',
        f: 'json'
      })
      const p = parseArcgis(await this.json(`${PORTWATCH}/${service}/FeatureServer/0/query?${q}`))
      out.push(...p.rows)
      if (!p.more || p.rows.length === 0) break
      await sleep(this.gapMs)
    }
    return out
  }

  /** The first day to ask for: two weeks before the latest stored (PortWatch revises recent days), or 13 months back. */
  private since(kind: 'chokepoint' | 'port'): string {
    const latest = store.latestTraffic(this.db, kind)
    const from = latest ? Date.parse(latest) - 14 * DAY : this.now().getTime() - HISTORY_DAYS * DAY
    return isoDay(new Date(from))
  }

  async chokepoints(): Promise<void> {
    const refs = await this.arcgis('PortWatch_chokepoints_database', {
      where: '1=1',
      outFields: 'portid,portname,lat,lon,vessel_count_total'
    })
    store.savePlaces(this.db, parsePlaces(refs, 'chokepoint'))
    await sleep(this.gapMs)
    const rows = await this.arcgis('Daily_Chokepoints_Data', {
      where: `date >= DATE '${this.since('chokepoint')}'`,
      outFields: 'date,portid,n_total,n_tanker,n_container,n_dry_bulk'
    })
    store.saveTraffic(this.db, parseTraffic(rows))
    store.pruneTraffic(this.db, isoDay(new Date(this.now().getTime() - HISTORY_DAYS * DAY)))
  }

  async ports(): Promise<void> {
    // The list of the world's ports hardly changes: read it once a month.
    const st = this.states().ports
    if (
      !st?.refAt ||
      this.now().getTime() - Date.parse(st.refAt) > 30 * DAY ||
      store.placeCount(this.db, 'port') === 0
    ) {
      const refs = await this.arcgis('PortWatch_ports_database', {
        where: '1=1',
        outFields: 'portid,portname,ISO3,lat,lon,vessel_count_total,LOCODE'
      })
      store.savePlaces(this.db, parsePlaces(refs, 'port'))
      this.record('ports', { refAt: this.now().toISOString() })
      await sleep(this.gapMs)
    }
    const rows = await this.arcgis('Daily_Ports_Data', {
      where: `ISO3 = 'IND' AND date >= DATE '${this.since('port')}'`,
      outFields: 'date,portid,portcalls,portcalls_tanker,portcalls_container,portcalls_dry_bulk,import,export'
    })
    store.saveTraffic(this.db, parseTraffic(rows))
  }

  async comtrade(): Promise<void> {
    const year = this.now().getUTCFullYear()
    const have = new Set(store.trade(this.db).map((r) => `${r.period}:${r.cmd}`))
    const call = async (period: number, cmd: string) => {
      const q = new URLSearchParams({
        reporterCode: '699',
        period: String(period),
        cmdCode: cmd,
        flowCode: 'X,M',
        partner2Code: '0',
        customsCode: 'C00',
        motCode: '0',
        includeDesc: 'true'
      })
      const r = parseComtrade(await this.json(`https://comtradeapi.un.org/public/v1/preview/C/A/HS?${q}`))
      await sleep(this.comtradeGapMs)
      return r
    }
    let got = 0
    // Last year is re-read each month (late reports and revisions); the year before only once.
    for (const period of [year - 1, year - 2]) {
      if (period === year - 2 && have.has(`${period}:TOTAL`)) continue
      const totals = await call(period, 'TOTAL')
      if (totals.rows.length === 0) continue
      store.saveTrade(this.db, totals.rows)
      got += totals.rows.length
      for (const p of TRADE_PRODUCTS.filter((x) => x.cmd !== 'TOTAL')) {
        const r = await call(period, p.cmd)
        store.saveTrade(this.db, r.rows)
        got += r.rows.length
      }
    }
    if (got === 0 && have.size === 0) throw new Error('UN Comtrade has no annual figures for India yet')
  }

  async worldBank(): Promise<void> {
    const year = this.now().getUTCFullYear()
    // Each indicator remembers its own last success, so a retry asks only for the ones that failed.
    let done: Record<string, string> = {}
    try {
      done = JSON.parse(this.setting(WB_DONE_KEY) ?? '{}') as Record<string, string>
    } catch {
      done = {}
    }
    const failed: string[] = []
    for (const [metric, code] of Object.entries(WB_INDICATORS) as [WorldMetricKey, string][]) {
      if (done[metric] && this.now().getTime() - Date.parse(done[metric]) < 25 * DAY) continue
      try {
        const r = parseWorldBank(
          await this.json(
            `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&date=2000:${year}&per_page=20000`,
            {},
            60_000
          )
        )
        if (r.figures.length) store.saveFigures(this.db, metric, r.figures, true)
        done[metric] = this.now().toISOString()
        this.setSetting(WB_DONE_KEY, JSON.stringify(done))
      } catch (e) {
        failed.push(`${metric}: ${(e as Error).message}`)
      }
      await sleep(this.gapMs)
    }
    if (failed.length) throw new Error(`World Bank ${failed.join('; ')}`)
  }

  async bis(): Promise<void> {
    const csv = { Accept: 'application/vnd.sdmx.data+csv;version=1.0.0' }
    const rates = parseBisPolicy(
      await this.text('https://stats.bis.org/api/v1/data/WS_CBPOL/D./all?lastNObservations=1&detail=dataonly', csv),
      this.now()
    )
    if (rates.length) store.saveFigures(this.db, 'policyRate', rates, true)
    await sleep(this.gapMs)
    const fx = parseBisFx(
      await this.text('https://stats.bis.org/api/v1/data/WS_XRU/M...A/all?lastNObservations=2&detail=dataonly', csv)
    )
    if (fx.length) store.saveFigures(this.db, 'currency1m', fx, true)
    if (!rates.length && !fx.length) throw new Error('BIS sent no figures')
  }

  async oecd(): Promise<void> {
    const from = new Date(this.now().getTime() - 200 * DAY).toISOString().slice(0, 7)
    const base = 'https://sdmx.oecd.org/public/rest/data'
    const series: [WorldMetricKey, string][] = [
      ['yield10y', `${base}/OECD.SDD.STES,DSD_STES@DF_FINMARK,/.M.IRLT.PA.....?startPeriod=${from}&format=csvfile`],
      ['cli', `${base}/OECD.SDD.STES,DSD_STES@DF_CLI,/.M.LI...AA...H?startPeriod=${from}&format=csvfile`]
    ]
    // Each series stands alone: one failing keeps the other's update.
    const failed: string[] = []
    for (const [metric, url] of series) {
      try {
        const rows = parseOecdLatest(await this.text(url))
        if (rows.length) store.saveFigures(this.db, metric, rows, true)
        else failed.push(`${metric}: no figures`)
      } catch (e) {
        failed.push(`${metric}: ${(e as Error).message}`)
      }
      await sleep(this.gapMs * 2)
    }
    if (failed.length) throw new Error(`OECD ${failed.join('; ')}`)
  }

  async markets(): Promise<void> {
    const byIso = new Map(WORLD_INDICES.map((i) => [i.symbol, i.iso3]))
    const out: Figure[] = []
    for (let i = 0; i < WORLD_INDICES.length; i += 20) {
      const symbols = WORLD_INDICES.slice(i, i + 20).map((x) => x.symbol)
      const moves = parseYahooSpark(
        await this.json(
          `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1mo&interval=1d`
        )
      )
      for (const m of moves) {
        const iso3 = byIso.get(m.symbol)
        if (iso3) out.push({ iso3, period: m.date, value: m.change })
      }
      await sleep(this.gapMs)
    }
    if (out.length === 0) throw new Error('Yahoo Finance sent no index prices')
    store.saveFigures(this.db, 'index1m', out, true)
  }

  async events(): Promise<void> {
    const to = this.now()
    const from = new Date(to.getTime() - 30 * DAY)
    const [usgs, gdacs] = await Promise.allSettled([
      this.json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson').then(parseUsgs),
      this.json(
        `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&eventlist=EQ;TC;FL;VO;DR;WF&fromDate=${isoDay(from)}&toDate=${isoDay(to)}`
      ).then(parseGdacs)
    ])
    if (usgs.status === 'rejected' && gdacs.status === 'rejected') throw usgs.reason
    // A source that failed this time keeps its earlier events.
    const old = store.events(this.db)
    const quakes = usgs.status === 'fulfilled' ? usgs.value : old.filter((e) => e.source === 'USGS')
    const other = gdacs.status === 'fulfilled' ? gdacs.value : old.filter((e) => e.source === 'GDACS')
    store.saveEvents(this.db, mergeEvents(quakes, other))
    if (usgs.status === 'rejected') throw new Error(`USGS: ${(usgs.reason as Error).message}`)
    if (gdacs.status === 'rejected') throw new Error(`GDACS: ${(gdacs.reason as Error).message}`)
  }

  async freight(): Promise<void> {
    store.saveFreight(this.db, 'SCFI', parseScfi(await this.json('https://en.sse.net.cn/currentIndex?indexName=scfi')))
  }
}
