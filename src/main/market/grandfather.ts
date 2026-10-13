import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import { fmvKey } from '../portfolio/tax'
import { GRANDFATHER_DATE, taxClassOf } from '../portfolio/taxRules'
import { mfapiHistory } from './funds'
import { mapLimit, type FetchFn } from './http'
import { yahooHighOn } from './yahoo'

/**
 * Stores the 31 Jan 2018 value used for grandfathered long-term gains (section 112A): the day's
 * highest price on the exchange for shares and ETFs, the NAV for mutual funds. Only fetched for
 * equity holdings with purchases on or before that date, once each.
 */
export async function refreshGrandfathering(db: Db, f: FetchFn): Promise<string[]> {
  const ids = db
    .selectDistinct({ id: schema.transactions.instrumentId })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.type, 'BUY'), lte(schema.transactions.date, GRANDFATHER_DATE)))
    .all()
    .map((r) => r.id)
  if (!ids.length) return []
  const have = new Set(
    db
      .select({ key: schema.priceHistory.key })
      .from(schema.priceHistory)
      .where(sql`${schema.priceHistory.key} LIKE 'FMV2018:I:%'`)
      .all()
      .map((r) => r.key)
  )
  const todo = db
    .select()
    .from(schema.instruments)
    .where(inArray(schema.instruments.id, ids))
    .all()
    .filter((i) => taxClassOf(i) === 'EQUITY' && !have.has(fmvKey(i.id)))

  const results = await mapLimit(todo, 3, async (i) => {
    let value: number | null = null
    if (i.assetClass === 'MF') {
      if (!i.amfiCode) throw new Error('no AMFI code')
      const navs = await mfapiHistory(i.amfiCode, '2018-01-20', f)
      value = navs.filter((p) => p.date <= GRANDFATHER_DATE).at(-1)?.close ?? null
    } else {
      const symbol = i.yahooSymbol ?? (i.symbolNse ? `${i.symbolNse}.NS` : null)
      if (!symbol) throw new Error('no exchange symbol')
      value = await yahooHighOn(symbol, GRANDFATHER_DATE, f)
    }
    if (value === null) throw new Error('no price on 31 Jan 2018')
    db.insert(schema.priceHistory)
      .values({ key: fmvKey(i.id), date: GRANDFATHER_DATE, close: value })
      .onConflictDoUpdate({ target: [schema.priceHistory.key, schema.priceHistory.date], set: { close: value } })
      .run()
  })
  return results.filter((r) => !r.ok).map((r) => r.item.name)
}
