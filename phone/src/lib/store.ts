// The phone's own storage (IndexedDB): the locked copy of the data, the unlocking key (a Web Crypto
// key that can't be read back out), and entries waiting to go to Drive. Nothing is kept unlocked.

import type { PhoneEntry } from '@shared/phone'
import type { Sealed, VaultKey } from '@shared/vault'

const DB = 'family-portfolio'
const STORE = 'kv'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function get<T>(key: string): Promise<T | undefined> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
}

async function put(key: string, value: unknown): Promise<void> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite')
    if (value === undefined) t.objectStore(STORE).delete(key)
    else t.objectStore(STORE).put(value, key)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export const store = {
  /** The data as last downloaded, still locked, and when. */
  sealed: () => get<{ sealed: Sealed; fetchedAt: string }>('sealed'),
  setSealed: (sealed: Sealed) => put('sealed', { sealed, fetchedAt: new Date().toISOString() }),
  /** The key, kept only when the person asks the phone to remember the passphrase. */
  key: () => get<VaultKey>('key'),
  setKey: (k: VaultKey | undefined) => put('key', k),
  /** Entries recorded here: waiting to upload, or uploaded and waiting for the computer. */
  entries: async () => (await get<(PhoneEntry & { uploaded?: boolean })[]>('entries')) ?? [],
  setEntries: (e: (PhoneEntry & { uploaded?: boolean })[]) => put('entries', e),
  forget: async () => {
    await put('sealed', undefined)
    await put('key', undefined)
    await put('entries', undefined)
  }
}
