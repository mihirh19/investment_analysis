import { eq } from 'drizzle-orm'
import type { ResearchStatus } from '@shared/research'
import { schema, type Db } from '../db'
import type { FetchFn } from '../market/http'
import { HttpError } from '../market/http'
import { deliveryUrl, NseClient, parseDayFiles, parseDeliveryFile, parseIndices, peUrl, prUrl } from './nse'
import { parseResultsXbrl } from './xbrl'
import {
  BAR_YEARS,
  barDaysSeen,
  barProgress,
  companiesToCheck,
  markNoBars,
  pruneBars,
  refreshTechnicals,
  saveBars,
  heldStocks,
  latestQuoteDate,
  markChecked,
  pendingFilings,
  progress,
  refreshFundamentals,
  saveIndices,
  saveQuotes,
  saveRefs,
  storeFiling
} from './store'

export const SYNC_KEY = 'research:sync'
const SINCE_KEY = 'research:filingsSince'
const HOUR = 3600_000

const istNow = () => new Date(Date.now() + 5.5 * HOUR)
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** Trading days to look for NSE's end-of-day files, newest first (today only after 7 pm IST). */
export function candidateDays(now = istNow(), back = 7): string[] {
  const out: string[] = []
  const d = new Date(now)
  if (d.getUTCHours() < 19) d.setUTCDate(d.getUTCDate() - 1)
  while (out.length < back) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(isoDay(d))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

/**
 * Keeps the research data current in the background: NSE's end-of-day prices once a day, and every
 * listed company's quarterly results, oldest-missing first. Paused when the person turns it off;
 * opening a company always fetches that one company's results.
 */
export class ResearchSync {
  private readonly nse: NseClient
  private running: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private current: string | null = null
  private lastError: string | null = null
  private failures = 0
  private restUntil = 0
  private lastDaily = 0
  private lastNew = 0
  /** Finish times of recent companies, for the time-left estimate. */
  private finished: number[] = []
  private inFlight = new Map<string, Promise<void>>()
  private technicalsDone = false

  constructor(
    private readonly db: Db,
    private readonly onUpdate: () => void = () => {},
    f: FetchFn = fetch,
    gapMs = 600
  ) {
    this.nse = new NseClient(f, gapMs)
  }

  enabled(): boolean {
    return this.db.select().from(schema.settings).where(eq(schema.settings.key, SYNC_KEY)).get()?.value !== 'off'
  }

  setEnabled(on: boolean): void {
    const value = on ? 'on' : 'off'
    this.db
      .insert(schema.settings)
      .values({ key: SYNC_KEY, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run()
    if (on) {
      this.restUntil = 0
      void this.run()
    }
  }

  status(): ResearchStatus {
    const p = progress(this.db)
    const enabled = this.enabled()
    const left = p.companies - p.companiesDone
    const recent = this.finished.filter((t) => Date.now() - t < HOUR)
    const perMin = recent.length >= 3 ? recent.length / ((Date.now() - recent[0]) / 60_000) : null
    return {
      enabled,
      state: !enabled
        ? 'PAUSED'
        : left <= 0 && p.pending === 0 && p.companies > 0
          ? 'DONE'
          : this.running && Date.now() >= this.restUntil
            ? 'RUNNING'
            : 'WAITING',
      companies: p.companies,
      companiesDone: p.companiesDone,
      filings: p.filings,
      etaMinutes: enabled && perMin && left > 0 ? Math.round(left / perMin) : null,
      pricesDate: latestQuoteDate(this.db),
      history: { ...barProgress(this.db), want: BAR_YEARS * 250 },
      lastError: this.lastError,
      current: this.current
    }
  }

  start(): void {
    void this.run()
    this.timer = setInterval(() => void this.run(), 20 * 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass: today's prices, newly filed results, then the backlog until done or paused. */
  run(): Promise<void> {
    if (this.running) return this.running
    this.running = (async () => {
      // Yield first, so a pass that ends at once still clears `running` after it is set.
      await Promise.resolve()
      try {
        if (!this.enabled() || Date.now() < this.restUntil) return
        await this.step(() => this.dailyFiles())
        await this.step(() => this.newFilings())
        await this.step(() => this.priceHistory())
        const held = new Set(heldStocks(this.db).keys())
        while (this.enabled() && Date.now() >= this.restUntil) {
          const next = companiesToCheck(this.db, held)[0]
          if (next) {
            await this.step(() => this.company(next))
            continue
          }
          // Everything listed: whatever is still waiting (new results, earlier misses).
          const left = pendingFilings(this.db, undefined, 20)
          if (left.length === 0) break
          for (const f of left) {
            if (!this.enabled()) break
            await this.step(() => this.readFiling(f))
          }
          refreshFundamentals(this.db, [...new Set(left.map((f) => f.symbol))])
        }
      } finally {
        this.current = null
        this.running = null
        this.onUpdate()
      }
    })()
    return this.running
  }

  /** The results for one company now (the person opened it), whether or not the backlog is running. */
  open(symbol: string): Promise<void> {
    const s = symbol.toUpperCase()
    const company = this.db.select().from(schema.researchCompanies).where(eq(schema.researchCompanies.symbol, s)).get()
    // Already in, unless its list failed last time (then it is tried again).
    if (company?.checkedAt && !company.error && pendingFilings(this.db, s, 1).length === 0) return Promise.resolve()
    return this.company(s)
  }

  private async step(work: () => Promise<void>): Promise<void> {
    try {
      await work()
      this.failures = 0
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      // NSE not answering: rest for half an hour rather than keep knocking.
      if (++this.failures >= 5) {
        this.restUntil = Date.now() + 30 * 60_000
        this.failures = 0
      }
    }
  }

  private company(symbol: string): Promise<void> {
    const busy = this.inFlight.get(symbol)
    if (busy) return busy
    const work = (async () => {
      this.current = symbol
      this.onUpdate()
      const checked = this.db.select().from(schema.researchCompanies).where(eq(schema.researchCompanies.symbol, symbol)).get()
      if (!checked?.checkedAt || checked.error) {
        try {
          saveRefs(this.db, await this.nse.companyFilings(symbol))
          markChecked(this.db, symbol, null)
        } catch (e) {
          markChecked(this.db, symbol, e instanceof Error ? e.message : String(e))
          throw e
        }
      }
      try {
        for (const f of pendingFilings(this.db, symbol, 60)) await this.readFiling(f)
      } finally {
        refreshFundamentals(this.db, [symbol])
      }
      this.finished = [...this.finished.slice(-40), Date.now()]
      this.lastError = null
      this.onUpdate()
    })().finally(() => this.inFlight.delete(symbol))
    this.inFlight.set(symbol, work)
    return work
  }

  private async readFiling(f: { symbol: string; periodEnd: string; basis: 'C' | 'S'; url: string; attempts: number }) {
    let filing = null
    try {
      filing = parseResultsXbrl(await this.nse.text(f.url))
      if (!filing) throw new Error('not a results filing')
    } catch (e) {
      storeFiling(this.db, f, null, f.attempts + 1)
      throw e
    }
    // The listing decides the period and basis; the file's own symbol can be an older one.
    storeFiling(this.db, f, { ...filing, symbol: f.symbol, periodEnd: f.periodEnd, basis: f.basis }, f.attempts + 1)
  }

  /** NSE's end-of-day price, market-cap and P/E files, once for each trading day. */
  private async dailyFiles(): Promise<void> {
    if (Date.now() - this.lastDaily < 3 * HOUR) return
    const have = latestQuoteDate(this.db)
    for (const day of candidateDays()) {
      if (have && day <= have) break
      let zip: Uint8Array
      try {
        zip = await this.nse.bytes(prUrl(day))
      } catch {
        continue // a holiday, or not published yet
      }
      const pe = await this.nse.text(peUrl(day)).catch(() => null)
      saveQuotes(this.db, parseDayFiles(zip, day, pe))
      saveIndices(this.db, parseIndices(zip, day))
      this.onUpdate()
      break
    }
    this.lastDaily = Date.now()
  }

  /**
   * NSE's daily delivery file for every trading day of the last two years that isn't stored yet,
   * newest first, then each stock's technicals worked out again. The first run is about 500 small
   * files; after that it is one a day.
   */
  private async priceHistory(): Promise<void> {
    const seen = barDaysSeen(this.db)
    const days = candidateDays(istNow(), BAR_YEARS * 261).filter((d) => !seen.has(d))
    const recent = candidateDays(istNow(), 3)
    let added = 0
    for (const day of days) {
      if (!this.enabled() || Date.now() < this.restUntil) break
      this.current = `prices of ${day}`
      try {
        const bars = parseDeliveryFile(await this.nse.text(deliveryUrl(day)))
        saveBars(this.db, day, bars)
        added++
        if (added % 25 === 0) this.onUpdate()
      } catch (e) {
        // No file: a holiday. The last few days may simply not be published yet, so they're asked again.
        if (e instanceof HttpError && e.status === 404) {
          if (!recent.includes(day)) markNoBars(this.db, day)
          continue
        }
        throw e
      } finally {
        this.current = null
      }
    }
    if (added > 0 || !this.technicalsDone) {
      const first = candidateDays(istNow(), BAR_YEARS * 261).at(-1)
      if (first) pruneBars(this.db, first)
      if (barProgress(this.db).days > 0) refreshTechnicals(this.db)
      this.technicalsDone = true
      this.onUpdate()
    }
  }

  /** Results filed across the market since the last look (the backlog covers older ones). */
  private async newFilings(): Promise<void> {
    if (Date.now() - this.lastNew < 6 * HOUR) return
    const today = isoDay(istNow())
    const since = this.db.select().from(schema.settings).where(eq(schema.settings.key, SINCE_KEY)).get()?.value
    const from = since ? isoDay(new Date(Date.parse(since) - 2 * 86400_000)) : today
    saveRefs(this.db, await this.nse.filingsBetween(from, today))
    this.db
      .insert(schema.settings)
      .values({ key: SINCE_KEY, value: today })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: today } })
      .run()
    this.lastNew = Date.now()
  }
}
