import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * Returns the database encryption key, creating it on first run. The key file is
 * encrypted with Windows DPAPI via Electron safeStorage, so it only opens for this
 * Windows user on this machine.
 */
export function loadOrCreateDbKey(keyFile: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption (safeStorage) is unavailable; refusing to store data unencrypted.')
  }
  if (existsSync(keyFile)) {
    return safeStorage.decryptString(readFileSync(keyFile))
  }
  const key = randomBytes(32).toString('hex')
  writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 })
  return key
}

export function encryptSecret(plain: string): string {
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(stored: string): string {
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

/** Replaces the stored database key (used when restoring a backup with its recovery key). */
export function writeDbKey(keyFile: string, key: string): void {
  writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 })
}
