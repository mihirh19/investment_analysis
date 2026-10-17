import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { INBOX_PREFIX, SNAPSHOT_FILE, type PhoneEntry, type PhoneSnapshot } from '@shared/phone'
import { open, seal, vaultKey, WrongPassphraseError, type Sealed, type VaultKey } from '@shared/vault'
import { clientId, createFile, currentToken, finishSignIn, listFiles, readFile, signIn, SignInNeeded } from './google'
import { store } from './store'

type Phase = 'starting' | 'setup' | 'signin' | 'empty' | 'locked' | 'ready'
/** An entry and where it is: not yet uploaded, or uploaded and waiting for the computer. */
export type Pending = PhoneEntry & { uploaded?: boolean }
type NewEntry = PhoneEntry extends infer E ? (E extends PhoneEntry ? Omit<E, 'id' | 'at'> : never) : never

interface Data {
  phase: Phase
  snapshot: PhoneSnapshot | null
  /** When the locked copy was downloaded. */
  fetchedAt: string | null
  syncing: boolean
  error: string | null
  pending: Pending[]
  sync(): Promise<void>
  unlock(passphrase: string, remember: boolean): Promise<void>
  record(e: NewEntry): Promise<void>
  lock(): Promise<void>
}

const Ctx = createContext<Data | null>(null)
export const useData = () => useContext(Ctx)!

export function DataProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [snapshot, setSnapshot] = useState<PhoneSnapshot | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const key = useRef<VaultKey | null>(null)
  const sealedRef = useRef<Sealed | null>(null)

  /** Drops entries the computer has applied; keeps the rest. */
  const settle = useCallback(async (snap: PhoneSnapshot | null) => {
    const all = await store.entries()
    const left = snap ? all.filter((e) => !snap.applied.includes(e.id)) : all
    if (left.length !== all.length) await store.setEntries(left)
    setPending(left)
  }, [])

  const openWith = useCallback(
    async (sealed: Sealed, k: VaultKey) => {
      const snap = await open<PhoneSnapshot>(sealed, k)
      key.current = k
      setSnapshot(snap)
      setPhase('ready')
      await settle(snap)
      return snap
    },
    [settle]
  )

  /** Uploads entries not yet in Drive. */
  const flush = useCallback(async () => {
    const k = key.current
    if (!k || !currentToken()) return
    const all = await store.entries()
    let changed = false
    for (const e of all) {
      if (e.uploaded) continue
      const { uploaded: _u, ...entry } = e
      await createFile(`${INBOX_PREFIX}${Date.now()}-${e.id}.json`, JSON.stringify(await seal(entry, k)))
      e.uploaded = true
      changed = true
    }
    if (changed) {
      await store.setEntries(all)
      setPending([...all])
    }
  }, [])

  const sync = useCallback(async () => {
    if (!currentToken()) {
      signIn()
      return
    }
    setSyncing(true)
    setError(null)
    try {
      const file = (await listFiles(SNAPSHOT_FILE)).find((f) => f.name === SNAPSHOT_FILE)
      if (!file) {
        if (!sealedRef.current) setPhase('empty')
        return
      }
      const sealed = JSON.parse(await readFile(file.id)) as Sealed
      sealedRef.current = sealed
      await store.setSealed(sealed)
      setFetchedAt(new Date().toISOString())
      const k = key.current ?? (await store.key()) ?? null
      if (k && k.salt === sealed.salt) {
        await openWith(sealed, k)
        await flush()
      } else {
        // A new passphrase was set on the computer: ask for it again.
        key.current = null
        await store.setKey(undefined)
        setPhase('locked')
      }
    } catch (e) {
      if (e instanceof SignInNeeded) setPhase((p) => (p === 'ready' || p === 'locked' ? p : 'signin'))
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }, [flush, openWith])

  // Start: finish a sign-in, show what is stored, then fetch what is new.
  useEffect(() => {
    void (async () => {
      const problem = await finishSignIn()
      if (problem) setError(problem)
      if (!clientId()) return setPhase('setup')
      const cached = await store.sealed()
      const k = await store.key()
      if (cached) {
        sealedRef.current = cached.sealed
        setFetchedAt(cached.fetchedAt)
        if (k && k.salt === cached.sealed.salt) {
          try {
            await openWith(cached.sealed, k)
          } catch {
            setPhase('locked')
          }
        } else setPhase('locked')
      } else setPhase(currentToken() ? 'empty' : 'signin')
      if (currentToken()) await sync()
      else await settle(null)
    })()
    // Sync again when the app comes back to the front.
    const onShow = () => document.visibilityState === 'visible' && currentToken() && void sync()
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [])

  const unlock = useCallback(
    async (passphrase: string, remember: boolean) => {
      const sealed = sealedRef.current
      if (!sealed) return
      setError(null)
      try {
        const k = await vaultKey(passphrase, sealed.salt, sealed.iter)
        await openWith(sealed, k)
        if (remember) await store.setKey(k)
        await flush()
      } catch (e) {
        setError(e instanceof WrongPassphraseError ? 'That passphrase doesn’t open it. Check it on the computer.' : String(e))
      }
    },
    [flush, openWith]
  )

  const record = useCallback(
    async (e: NewEntry) => {
      const entry = { ...e, id: crypto.randomUUID(), at: new Date().toISOString() } as PhoneEntry
      const all = [...(await store.entries()), entry]
      await store.setEntries(all)
      setPending(all)
      try {
        await flush()
      } catch (err) {
        if (!(err instanceof SignInNeeded)) setError(err instanceof Error ? err.message : String(err))
      }
    },
    [flush]
  )

  const lock = useCallback(async () => {
    key.current = null
    await store.setKey(undefined)
    setSnapshot(null)
    setPhase('locked')
  }, [])

  return (
    <Ctx.Provider value={{ phase, snapshot, fetchedAt, syncing, error, pending, sync, unlock, record, lock }}>
      {children}
    </Ctx.Provider>
  )
}
