import { getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Db } from './index'

/**
 * Saves many rows a few hundred at a time, each slice one statement in its own transaction, with a
 * pause between slices so the app keeps answering. Writing thousands of rows one statement each
 * (a market's listings, ten years of exchange rates) held the app for a second or more.
 *
 * With `target`, a row that is already there is updated with the new values (all but the key
 * columns); without, it is left as it was.
 */
export async function saveMany<T extends SQLiteTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
  target?: SQLiteColumn | SQLiteColumn[]
): Promise<void> {
  if (!rows.length) return
  const keys = new Set((Array.isArray(target) ? target : target ? [target] : []).map((c) => c.name))
  const set: Record<string, SQL> = {}
  for (const [prop, col] of Object.entries(getTableColumns(table)))
    if (!keys.has(col.name) && prop in rows[0]) set[prop] = sql.raw(`excluded."${col.name}"`)
  // SQLite allows 32766 values in one statement; a few hundred rows stays far below and keeps each slice short.
  const size = Math.max(1, Math.floor(4000 / Object.keys(rows[0]).length))
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size)
    const insert = db.insert(table).values(slice)
    if (target && Object.keys(set).length) insert.onConflictDoUpdate({ target, set }).run()
    else insert.onConflictDoNothing().run()
    if (i + size < rows.length) await new Promise((r) => setImmediate(r))
  }
}
