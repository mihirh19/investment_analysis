import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDb {
  db: Db
  sqlite: Database.Database
}

/**
 * Opens (or creates) the SQLite database, encrypted with SQLite3MultipleCiphers
 * when `hexKey` is given, then applies pending migrations and seeds defaults.
 */
export function openDatabase(filePath: string, hexKey: string | null, migrationsFolder: string): OpenedDb {
  if (hexKey && !/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('Database key must be 32 bytes of hex')
  const sqlite = new Database(filePath)
  try {
    if (hexKey) sqlite.pragma(`hexkey='${hexKey}'`)
    // Fails here (rather than on first query) if the key is wrong.
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')

    // "better-sqlite3" is aliased to better-sqlite3-multiple-ciphers in package.json.
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })
    seedDefaults(db)
    return { db, sqlite }
  } catch (err) {
    sqlite.close()
    throw err
  }
}

function seedDefaults(db: Db): void {
  const existing = db.select({ id: schema.persons.id }).from(schema.persons).limit(1).all()
  if (existing.length > 0) return
  db.insert(schema.persons)
    .values([
      { name: 'Me', relation: 'SELF' },
      { name: 'Dad', relation: 'PARENT' }
    ])
    .run()
}

export { schema }
