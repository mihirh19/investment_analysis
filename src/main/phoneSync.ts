import { createHash } from 'node:crypto'
import { INBOX_PREFIX, SNAPSHOT_FILE, type PhoneEntry, type PhoneSnapshot, type PhoneSyncStatus } from '@shared/phone'
import { open, seal, vaultKey, WrongPassphraseError, type Sealed, type VaultKey } from '@shared/vault'
import { AppFolder, GoogleReconnectError } from './google'
import type { FetchFn } from './market/http'

/**
 * The phone app's link to the desktop, through the hidden app folder of one Google account's
 * Drive. Each sync first applies what was recorded on the phone (rent received, a fuel bill, a
 * PUC renewal…), then uploads a fresh copy of the figures the phone shows. Both directions are
 * sealed with a passphrase the person chooses, so Google stores only scrambled bytes.
 */

const KEY = 'phone:sync'
/** Where the phone app is published (GitHub Pages of the project). */
export const PHONE_APP_URL = 'https://mihirh19.github.io/investment_analysis/'

interface Stored {
  account: string | null
  /** Encrypted (OS-level) passphrase, so the desktop can sync unattended. */
  passphrase: string | null
  salt: string | null
  lastSync: string | null
  lastError: string | null
  lastHash: string | null
  applied: string[]
  lastApplied: number
}

export interface PhoneSyncDeps {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  encrypt(plain: string): string
  decrypt(stored: string): string
  fetch?: FetchFn
  /** A Drive-enabled access token for the account. */
  tokenFor(email: string): Promise<string>
  hasDrive(email: string): boolean
  clientInfo(): { clientId: string; web: boolean } | null
  buildSnapshot(applied: string[]): PhoneSnapshot
  /** Applies one phone entry to the books. */
  apply(entry: PhoneEntry): void
  now?(): Date
}

export function createPhoneSync(d: PhoneSyncDeps) {
  const now = () => (d.now ? d.now() : new Date())
  const load = (): Stored => ({
    account: null,
    passphrase: null,
    salt: null,
    lastSync: null,
    lastError: null,
    lastHash: null,
    applied: [],
    lastApplied: 0,
    ...(JSON.parse(d.getSetting(KEY) ?? '{}') as Partial<Stored>)
  })
  const save = (patch: Partial<Stored>) => d.setSetting(KEY, JSON.stringify({ ...load(), ...patch }))
  let cachedKey: VaultKey | null = null
  const keyFor = async (s: Stored): Promise<VaultKey> => {
    if (!s.passphrase || !s.salt) throw new Error('Choose a passphrase for the phone app first.')
    if (cachedKey?.salt !== s.salt) cachedKey = await vaultKey(d.decrypt(s.passphrase), s.salt)
    return cachedKey
  }
  let running: Promise<PhoneSyncStatus> | null = null

  const status = (): PhoneSyncStatus => {
    const s = load()
    const c = d.clientInfo()
    return {
      account: s.account,
      webClient: !!c?.web,
      driveAllowed: !!s.account && d.hasDrive(s.account),
      passphraseSet: !!s.passphrase,
      lastSync: s.lastSync,
      lastError: s.lastError,
      lastApplied: s.lastApplied,
      phoneUrl: c?.web ? `${PHONE_APP_URL}?client=${encodeURIComponent(c.clientId)}` : null
    }
  }

  async function run(): Promise<PhoneSyncStatus> {
    const s = load()
    if (!s.account || !s.passphrase) return status()
    try {
      const key = await keyFor(s)
      const folder = new AppFolder(await d.tokenFor(s.account), d.fetch)

      // 1. What the phone recorded, oldest first.
      const inbox = (await folder.list(INBOX_PREFIX)).sort((a, b) => a.name.localeCompare(b.name))
      const applied = [...s.applied]
      let count = 0
      let skipped = 0
      const failed: string[] = []
      for (const file of inbox) {
        let entry: PhoneEntry
        try {
          entry = await open<PhoneEntry>(JSON.parse(await folder.read(file.id)) as Sealed, key)
        } catch (e) {
          // Locked with another passphrase (changed since): leave it for the person to sort out.
          if (e instanceof WrongPassphraseError) {
            skipped++
            continue
          }
          throw e
        }
        if (!applied.includes(entry.id)) {
          try {
            d.apply(entry)
          } catch (e) {
            // Kept in Drive and reported; the rest still go through.
            failed.push(e instanceof Error ? e.message : String(e))
            continue
          }
          applied.push(entry.id)
          count++
        }
        await folder.remove(file.id)
      }

      // 2. The figures, uploaded only when they changed.
      const recent = applied.slice(-300)
      const snapshot = d.buildSnapshot(recent.slice(-100))
      const hash = createHash('sha256')
        .update(JSON.stringify({ ...snapshot, generatedAt: '' }))
        .digest('hex')
      const existing = (await folder.list(SNAPSHOT_FILE)).find((f) => f.name === SNAPSHOT_FILE)
      if (hash !== s.lastHash || !existing || count > 0)
        await folder.write(SNAPSHOT_FILE, JSON.stringify(await seal(snapshot, key)), existing?.id)

      save({
        applied: recent,
        lastHash: hash,
        lastSync: now().toISOString(),
        lastApplied: count,
        lastError: failed.length
          ? `${failed.length} phone entr${failed.length === 1 ? 'y' : 'ies'} could not be applied: ${failed[0]}`
          : skipped
            ? `${skipped} phone entr${skipped === 1 ? 'y was' : 'ies were'} locked with a different passphrase. Set the phone to the current passphrase and record them again.`
            : null
      })
    } catch (e) {
      save({
        lastError:
          e instanceof GoogleReconnectError
            ? `${e.message} (Settings → Google accounts)`
            : e instanceof Error
              ? e.message
              : String(e)
      })
    }
    return status()
  }

  return {
    status,

    /** Picks the Google account and passphrase. A new passphrase starts a new key (and a new upload). */
    async configure(input: { account: string; passphrase?: string }): Promise<PhoneSyncStatus> {
      const s = load()
      const patch: Partial<Stored> = { account: input.account.trim().toLowerCase() }
      if (input.passphrase !== undefined) {
        const p = input.passphrase
        if (p.length < 10) throw new Error('Use a passphrase of at least 10 characters: a few unrelated words work well.')
        if (!s.passphrase || d.decrypt(s.passphrase) !== p) {
          const k = await vaultKey(p)
          cachedKey = k
          Object.assign(patch, { passphrase: d.encrypt(p), salt: k.salt, lastHash: null })
        }
      }
      save(patch)
      return status()
    },

    /** Syncs now: applies phone entries, then uploads the figures. Overlapping calls share a run. */
    sync(): Promise<PhoneSyncStatus> {
      if (running) return running
      running = run().finally(() => {
        running = null
      })
      return running
    },

    /** Stops syncing (the copy in Drive stays until the account is disconnected). */
    turnOff(): PhoneSyncStatus {
      save({ account: null, passphrase: null, salt: null, lastHash: null })
      cachedKey = null
      return status()
    },

    enabled: () => {
      const s = load()
      return !!s.account && !!s.passphrase
    }
  }
}

export type PhoneSync = ReturnType<typeof createPhoneSync>
