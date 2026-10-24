import { eq, lt, max } from 'drizzle-orm'
import {
  summariseTraffic,
  type FreightPoint,
  type TradeRow,
  type TrafficDay,
  type WorldEvent,
  type WorldFigures,
  type WorldMap,
  type WorldMetricKey,
  type WorldPlace,
  type WorldSourceStatus
} from '@shared/world'
import { schema, type Db } from '../db'
import type { Figure } from './parse'

/** Replaces a metric's figures (for the periods given, or all of them when `all`). */
export function saveFigures(db: Db, metric: WorldMetricKey, rows: Figure[], all = false): void {
  const t = schema.worldFigures
  db.transaction((tx) => {
    if (all) tx.delete(t).where(eq(t.metric, metric)).run()
    for (const r of rows)
      tx.insert(t)
        .values({ metric, iso3: r.iso3, period: r.period, value: r.value })
        .onConflictDoUpdate({ target: [t.metric, t.iso3, t.period], set: { value: r.value } })
        .run()
  })
}

export function figures(db: Db): WorldFigures {
  const out: WorldFigures = {}
  for (const r of db.select().from(schema.worldFigures).all()) {
    const m = (out[r.metric as WorldMetricKey] ??= {})
    ;(m[r.iso3] ??= {})[r.period] = r.value
  }
  return out
}

export function saveTrade(db: Db, rows: TradeRow[]): void {
  const t = schema.worldTrade
  db.transaction((tx) => {
    for (const r of rows)
      tx.insert(t)
        .values(r)
        .onConflictDoUpdate({
          target: [t.partner, t.flow, t.cmd, t.period],
          set: { value: r.value, weight: r.weight, partnerName: r.partnerName }
        })
        .run()
  })
}

export function trade(db: Db): TradeRow[] {
  return db.select().from(schema.worldTrade).all()
}

export function savePlaces(
  db: Db,
  places: Omit<WorldPlace, 'followed' | 'latestDate' | 'recent' | 'yearAgo' | 'imports7' | 'exports7' | 'weekly'>[]
): void {
  const t = schema.worldPlaces
  db.transaction((tx) => {
    for (const p of places) tx.insert(t).values(p).onConflictDoUpdate({ target: t.id, set: p }).run()
  })
}

export function placeCount(db: Db, kind: WorldPlace['kind']): number {
  return db.select().from(schema.worldPlaces).where(eq(schema.worldPlaces.kind, kind)).all().length
}

export function saveTraffic(db: Db, rows: (TrafficDay & { id: string })[]): void {
  const t = schema.worldTraffic
  db.transaction((tx) => {
    for (const r of rows)
      tx.insert(t)
        .values(r)
        .onConflictDoUpdate({
          target: [t.id, t.date],
          set: {
            total: r.total,
            tanker: r.tanker,
            container: r.container,
            dryBulk: r.dryBulk,
            imports: r.imports,
            exports: r.exports
          }
        })
        .run()
  })
}

/** Latest stored traffic date for chokepoints (ids "chokepoint…") or ports. */
export function latestTraffic(db: Db, kind: WorldPlace['kind']): string | null {
  const t = schema.worldTraffic
  const rows = db
    .select({ id: t.id, d: max(t.date) })
    .from(t)
    .groupBy(t.id)
    .all()
    .filter((r) => r.id.startsWith('chokepoint') === (kind === 'chokepoint'))
  return rows.reduce<string | null>((m, r) => (r.d && (!m || r.d > m) ? r.d : m), null)
}

/** Keeps a little over a year of daily traffic, enough to compare with the same week last year. */
export function pruneTraffic(db: Db, keepFrom: string): void {
  db.delete(schema.worldTraffic).where(lt(schema.worldTraffic.date, keepFrom)).run()
}

export function saveEvents(db: Db, events: WorldEvent[]): void {
  db.transaction((tx) => {
    tx.delete(schema.worldEvents).run()
    for (const e of events)
      tx.insert(schema.worldEvents)
        .values({ id: e.id, dataJson: JSON.stringify(e) })
        .onConflictDoNothing()
        .run()
  })
}

export function events(db: Db): WorldEvent[] {
  return db
    .select()
    .from(schema.worldEvents)
    .all()
    .map((r) => JSON.parse(r.dataJson) as WorldEvent)
    .sort((a, b) => b.time.localeCompare(a.time))
}

export function saveFreight(db: Db, name: string, points: FreightPoint[]): void {
  const t = schema.worldFreight
  db.transaction((tx) => {
    for (const p of points)
      tx.insert(t)
        .values({ name, ...p })
        .onConflictDoUpdate({ target: [t.name, t.date], set: { value: p.value } })
        .run()
  })
}

export function freight(db: Db, name = 'SCFI'): FreightPoint[] {
  return db
    .select({ date: schema.worldFreight.date, value: schema.worldFreight.value })
    .from(schema.worldFreight)
    .where(eq(schema.worldFreight.name, name))
    .all()
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Every chokepoint and port with its traffic summary; ports without daily figures are reference dots only. */
export function places(db: Db): WorldPlace[] {
  const days = new Map<string, TrafficDay[]>()
  for (const r of db.select().from(schema.worldTraffic).all()) {
    const list = days.get(r.id) ?? []
    list.push(r)
    days.set(r.id, list)
  }
  return db
    .select()
    .from(schema.worldPlaces)
    .all()
    .map((p) => {
      const d = days.get(p.id) ?? []
      return { ...p, followed: d.length > 0, ...summariseTraffic(d) }
    })
}

export function worldMap(
  db: Db,
  status: { sources: WorldSourceStatus[]; enabled: boolean; refreshing: boolean }
): WorldMap {
  return {
    figures: figures(db),
    places: places(db),
    trade: trade(db),
    events: events(db),
    freight: freight(db),
    ...status
  }
}
