// End-to-end encryption for what the desktop and the phone exchange through Google Drive.
// Runs on Web Crypto, which both Node (Electron's main process) and Safari provide, so the same
// code locks on one side and unlocks on the other. Google only ever stores the locked bytes.

import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'

/** OWASP's 2023 figure for PBKDF2-SHA256: slow to guess, about a second on a phone. */
export const PBKDF2_ITERATIONS = 600_000

export interface Sealed {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iter: number
  /** base64 */
  salt: string
  iv: string
  data: string
}

const subtle = () => globalThis.crypto.subtle
/** A Web Crypto key (typed so it works with and without the browser's type library). */
type Key = InstanceType<typeof CryptoKey>
/** Web Crypto takes any bytes; typed as an ArrayBuffer for both type libraries. */
const bytes = (u: Uint8Array) => u as unknown as ArrayBuffer
const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))

/** The AES key for a passphrase and salt. Not extractable: it can be kept, never read back. */
export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Key> {
  const base = await subtle().importKey('raw', bytes(strToU8(passphrase.normalize('NFC'))), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** A key plus the salt it came from, so many messages can be sealed without deriving again. */
export interface VaultKey {
  key: Key
  salt: string
  iter: number
}

export async function vaultKey(passphrase: string, salt?: string, iterations = PBKDF2_ITERATIONS): Promise<VaultKey> {
  const s = salt ? unb64(salt) : random(16)
  return { key: await deriveKey(passphrase, s, iterations), salt: b64(s), iter: iterations }
}

export async function seal(value: unknown, k: VaultKey): Promise<Sealed> {
  const iv = random(12)
  const plain = gzipSync(strToU8(JSON.stringify(value)), { level: 6 })
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: bytes(iv) }, k.key, bytes(plain)))
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: k.iter, salt: k.salt, iv: b64(iv), data: b64(data) }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not unlock the data')
  }
}

/** Opens a sealed value. Pass a key already derived for this salt to skip the slow step. */
export async function open<T>(sealed: Sealed, passphraseOrKey: string | VaultKey): Promise<T> {
  if (sealed.v !== 1 || sealed.kdf !== 'PBKDF2-SHA256') throw new Error('This data was locked by a newer version of the app')
  const k =
    typeof passphraseOrKey === 'string'
      ? await vaultKey(passphraseOrKey, sealed.salt, sealed.iter)
      : passphraseOrKey.salt === sealed.salt && passphraseOrKey.iter === sealed.iter
        ? passphraseOrKey
        : null
  if (!k) throw new WrongPassphraseError()
  let plain: ArrayBuffer
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes(unb64(sealed.iv)) }, k.key, bytes(unb64(sealed.data)))
  } catch {
    throw new WrongPassphraseError()
  }
  return JSON.parse(strFromU8(gunzipSync(new Uint8Array(plain)))) as T
}
