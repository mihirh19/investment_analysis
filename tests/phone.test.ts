import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PhoneEntry, PhoneSnapshot } from '../src/shared/phone'
import { open, seal, vaultKey, WrongPassphraseError, type Sealed } from '../src/shared/vault'
import { openDatabase, type Db } from '../src/main/db'
import { saveManualAsset } from '../src/main/manualAssets'
import { applyPhoneEntry, buildPhoneSnapshot } from '../src/main/phoneData'
import { createPhoneSync } from '../src/main/phoneSync'
import { computeProperties } from '../src/main/portfolio/property'
import { listVehicles, saveVehicle } from '../src/main/vehicles'

describe('the vault', () => {
  it('opens only with the right passphrase', async () => {
    const k = await vaultKey('correct horse battery staple', undefined, 1000)
    const sealed = await seal({ netWorth: 532132, note: 'नमस्ते' }, k)
    expect(sealed.data).not.toContain('532132')
    expect(await open(sealed, 'correct horse battery staple')).toEqual({ netWorth: 532132, note: 'नमस्ते' })
    // A key kept on the phone opens it without the slow derivation.
    expect(await open(sealed, k)).toEqual({ netWorth: 532132, note: 'नमस्ते' })
    await expect(open(sealed, 'wrong horse')).rejects.toBeInstanceOf(WrongPassphraseError)
  })
})

/** Google Drive's app-data folder, in memory, answering the calls the sync makes. */
function fakeDrive() {
  const files = new Map<string, { name: string; content: string }>()
  let n = 0
  const calls: string[] = []
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url.pathname}`)
    if (url.pathname === '/drive/v3/files' && method === 'GET')
      return json({ files: [...files].map(([id, x]) => ({ id, name: x.name, modifiedTime: '' })) })
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const body = String(init?.body)
      const meta = JSON.parse(body.match(/\{"name"[^\n]*\}/)![0]) as { name: string }
      const parts = body.split(/\r\n--fp\w+/)
      const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n')
      const id = `f${++n}`
      files.set(id, { name: meta.name, content })
      return json({ id })
    }
    const up = url.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/)
    if (up && method === 'PATCH') {
      files.get(up[1])!.content = String(init?.body)
      return json({ id: up[1] })
    }
    const one = url.pathname.match(/^\/drive\/v3\/files\/(\w+)$/)
    if (one && method === 'DELETE') {
      files.delete(one[1])
      return new Response(null, { status: 204 })
    }
    if (one) return new Response(files.get(one[1])!.content)
    return new Response('?', { status: 404 })
  }) as typeof fetch
  return { f, files, calls }
}

describe('syncing with the phone', () => {
  const snapshot = (applied: string[]): PhoneSnapshot => ({
    version: 1,
    generatedAt: new Date().toISOString(),
    pricesAsOf: null,
    persons: [{ id: 1, name: 'Me' }],
    scopes: {},
    holdings: [],
    properties: [],
    vehicles: [],
    forecast: null,
    policies: [],
    applied
  })

  it('applies what the phone recorded, then uploads the figures only when they change', async () => {
    const drive = fakeDrive()
    const settings = new Map<string, string>()
    const applied: PhoneEntry[] = []
    let version = 1
    const sync = createPhoneSync({
      getSetting: (k) => settings.get(k) ?? null,
      setSetting: (k, v) => settings.set(k, v),
      encrypt: (s) => `enc:${s}`,
      decrypt: (s) => s.replace(/^enc:/, ''),
      fetch: drive.f,
      tokenFor: async () => 'token',
      hasDrive: () => true,
      clientInfo: () => ({ clientId: 'x.apps.googleusercontent.com', web: true }),
      buildSnapshot: (ids) => ({ ...snapshot(ids), pricesAsOf: String(version) }),
      apply: (e) => {
        if (e.type === 'ASSET_VALUE' && e.value < 0) throw new Error('Value must be zero or more')
        applied.push(e)
      }
    })
    await expect(sync.configure({ account: 'me@gmail.com', passphrase: 'short' })).rejects.toThrow(/10 characters/)
    const st = await sync.configure({ account: 'Me@Gmail.com', passphrase: 'mango river window seven' })
    expect(st.phoneUrl).toBe('https://mihirh19.github.io/investment_analysis/?client=x.apps.googleusercontent.com')

    let s = await sync.sync()
    expect(s.lastError).toBeNull()
    const [snapId] = [...drive.files].find(([, x]) => x.name === 'fp-snapshot.json')!
    const sealed = JSON.parse(drive.files.get(snapId)!.content) as Sealed
    // The phone unlocks it with the passphrase alone.
    expect((await open<PhoneSnapshot>(sealed, 'mango river window seven')).persons).toEqual([{ id: 1, name: 'Me' }])

    // The phone records rent and a bad value, sealed with the key from the snapshot's salt.
    const phoneKey = await vaultKey('mango river window seven', sealed.salt, sealed.iter)
    const rent: PhoneEntry = { id: 'e1', at: '2026-10-17T10:00:00Z', type: 'RENT', propertyId: 5, date: '2026-10-17', forMonth: '2026-10', amount: 14000 }
    const bad: PhoneEntry = { id: 'e2', at: '2026-10-17T10:01:00Z', type: 'ASSET_VALUE', accountId: 3, date: '2026-10-17', value: -1 }
    drive.files.set('i1', { name: 'fp-inbox-001-e1.json', content: JSON.stringify(await seal(rent, phoneKey)) })
    drive.files.set('i2', { name: 'fp-inbox-002-e2.json', content: JSON.stringify(await seal(bad, phoneKey)) })

    s = await sync.sync()
    expect(applied.map((e) => e.id)).toEqual(['e1'])
    expect(s.lastApplied).toBe(1)
    expect(s.lastError).toMatch(/1 phone entry could not be applied: Value must be zero or more/)
    expect(drive.files.has('i1')).toBe(false) // done
    expect(drive.files.has('i2')).toBe(true) // kept for another try
    const after = await open<PhoneSnapshot>(JSON.parse(drive.files.get(snapId)!.content) as Sealed, phoneKey)
    expect(after.applied).toEqual(['e1'])

    // Nothing changed: no new upload.
    drive.files.delete('i2')
    const patches = drive.calls.filter((c) => c.startsWith('PATCH')).length
    await sync.sync()
    expect(drive.calls.filter((c) => c.startsWith('PATCH')).length).toBe(patches)
    version = 2 // prices moved
    await sync.sync()
    expect(drive.calls.filter((c) => c.startsWith('PATCH')).length).toBe(patches + 1)
  })
})

describe('phone entries on the books', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-phone-'))
    const o = openDatabase(join(dir, 't.db'), '7'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records rent and a fuel bill, and shows them in the next snapshot', () => {
    const flat = saveManualAsset(db, {
      personId: 1,
      meta: {
        kind: 'PROPERTY',
        name: 'Flat',
        propertyType: 'RESIDENTIAL',
        purchasePrice: 3800000,
        purchaseDate: '2019-11-15',
        tenancies: [{ id: 't1', tenant: 'R. Patel', startDate: '2026-01-01', monthlyRent: 14000, dueDay: 5 }]
      }
    })
    const car = saveVehicle(db, { personId: 1, meta: { regNo: 'GJ01KP4321', type: 'CAR', fuel: 'PETROL' } })
    applyPhoneEntry(db, { id: 'p1', at: 'x', type: 'RENT', propertyId: flat, date: '2026-10-06', forMonth: '2026-10', amount: 14000, tenancyId: 't1' })
    applyPhoneEntry(db, { id: 'p2', at: 'x', type: 'VEHICLE_EXPENSE', vehicleId: car, date: '2026-10-16', kind: 'FUEL', amount: 3000, km: 37900, litres: 31 })
    applyPhoneEntry(db, { id: 'p3', at: '2026-10-16T09:00:00Z', type: 'VEHICLE_PUC', vehicleId: car, validUntil: '2027-10-15', amount: 100 })

    const p = computeProperties(db)[0]
    expect(p.meta.rentPayments).toMatchObject([{ id: 'p1', amount: 14000, forMonth: '2026-10' }])
    const v = listVehicles(db)[0]
    expect(v.meta.expenses?.map((e) => e.kind)).toEqual(['FUEL', 'PUC'])
    expect(v.puc?.validUntil).toBe('2027-10-15')
    expect(() =>
      applyPhoneEntry(db, { id: 'p4', at: 'x', type: 'VEHICLE_EXPENSE', vehicleId: 999, date: '2026-10-16', kind: 'FUEL', amount: 1 })
    ).toThrow(/no longer on the desktop/)

    const snap = buildPhoneSnapshot(db, ['p1', 'p2'], null)
    expect(snap.properties).toHaveLength(1)
    expect(snap.vehicles[0]).not.toHaveProperty('documents')
    expect(snap.scopes.family).toBeDefined()
    expect(snap.applied).toEqual(['p1', 'p2'])
  })
})
