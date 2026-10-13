import { eq, max, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import { amfiHistoryKey, directPlanKey, findDirectCounterpart, planOf } from '../portfolio/fundInsights'
import { fetchNavAll, mfapiHistory } from './funds'
import { mapLimit, type FetchFn } from './http'

const DAY = 86400000

/**
 * For every Regular-plan fund held, finds the Direct plan of the same scheme in AMFI's list (once)
 * and keeps about 13 months of its weekly NAVs, so the yearly cost of the Regular plan can be read
 * from the two NAV series. Returns funds whose Direct plan couldn't be found or fetched.
 */
export async function refreshDirectPlans(db: Db, f: FetchFn): Promise<string[]> {
  const held = db.all<{ id: number }>(sql`
    SELECT DISTINCT instrument_id AS id FROM holding_snapshots
    UNION SELECT DISTINCT instrument_id FROM transactions`)
  const ids = new Set(held.map((h) => h.id))
  const regular = db
    .select()
    .from(schema.instruments)
    .where(eq(schema.instruments.assetClass, 'MF'))
    .all()
    .filter((i) => ids.has(i.id) && planOf(`${i.name} ${i.schemeName ?? ''}`, 'MF') === 'REGULAR')
  if (!regular.length) return []

  const setting = (k: string) => db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value
  const failed: string[] = []
  const unmapped = regular.filter((i) => !setting(directPlanKey(i.id)))
  if (unmapped.length) {
    const schemes = await fetchNavAll(f)
    for (const i of unmapped) {
      const hit = findDirectCounterpart({ isin: i.isin, name: i.name, fundHouse: i.fundHouse }, schemes)
      if (!hit) {
        failed.push(i.name)
        continue
      }
      const value = JSON.stringify({ code: hit.code, name: [hit.name, hit.plan, hit.option].filter(Boolean).join(' - ') })
      db.insert(schema.settings)
        .values({ key: directPlanKey(i.id), value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
        .run()
    }
  }

  const codes = [
    ...new Set(
      regular
        .map((i) => setting(directPlanKey(i.id)))
        .filter((v): v is string => !!v)
        .map((v) => (JSON.parse(v) as { code: string }).code)
    )
  ]
  const since = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10)
  const results = await mapLimit(codes, 3, async (code) => {
    const key = amfiHistoryKey(code)
    const last = db.select({ d: max(schema.priceHistory.date) }).from(schema.priceHistory).where(eq(schema.priceHistory.key, key)).get()?.d
    if (last && Date.now() - Date.parse(last) < 6 * DAY) return
    const pts = await mfapiHistory(code, since, f)
    // Keep one close a week, like every other stored series.
    const byWeek = new Map<string, { date: string; close: number }>()
    for (const p of pts) {
      const d = new Date(`${p.date}T00:00:00Z`)
      byWeek.set(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10), p)
    }
    db.transaction((tx) => {
      for (const p of byWeek.values())
        tx.insert(schema.priceHistory)
          .values({ key, date: p.date, close: p.close })
          .onConflictDoUpdate({ target: [schema.priceHistory.key, schema.priceHistory.date], set: { close: p.close } })
          .run()
    })
  })
  for (const r of results) if (!r.ok) failed.push(`Direct plan ${r.item}`)
  return failed
}
