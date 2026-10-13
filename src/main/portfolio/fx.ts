import { asc, eq } from 'drizzle-orm'
import { schema, type Db } from '../db'

/** Exchange-rate lookup: the live rate, and the last known daily rate on or before any date. */
export class FxTable {
  private constructor(
    private readonly dates: string[],
    private readonly rates: number[],
    private readonly live: number | null
  ) {}

  static load(db: Db, pair: string): FxTable {
    const hist = db
      .select({ date: schema.fxHistory.date, rate: schema.fxHistory.rate })
      .from(schema.fxHistory)
      .where(eq(schema.fxHistory.pair, pair))
      .orderBy(asc(schema.fxHistory.date))
      .all()
    const live = db.select().from(schema.fxRates).where(eq(schema.fxRates.pair, pair)).get()?.rate ?? null
    return new FxTable(
      hist.map((h) => h.date),
      hist.map((h) => h.rate),
      live
    )
  }

  static of(history: { date: string; rate: number }[], live: number | null): FxTable {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
    return new FxTable(
      sorted.map((h) => h.date),
      sorted.map((h) => h.rate),
      live
    )
  }

  latest(): number | null {
    return this.live ?? this.rates[this.rates.length - 1] ?? null
  }

  /** Rate on `date`, or the closest earlier day (weekends/holidays); the earliest known rate for older dates. */
  on(date: string): number | null {
    if (this.dates.length === 0) return this.live
    let lo = 0
    let hi = this.dates.length - 1
    if (date < this.dates[0]) return this.rates[0]
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.dates[mid] <= date) lo = mid
      else hi = mid - 1
    }
    return this.rates[lo]
  }
}
