import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VehicleMeta } from '../src/shared/vehicles'
import { openDatabase, type Db } from '../src/main/db'
import { displayRegNo, normalizeRegNo, readVehicleDocument } from '../src/main/importers/vehicleDocs'
import { addDocument, deleteVehicle, idvDepreciation, listVehicles, saveVehicle } from '../src/main/vehicles'

describe('registration numbers', () => {
  it('reads the ways a number is written', () => {
    expect(normalizeRegNo('GJ-01-AB-1234')).toBe('GJ01AB1234')
    expect(normalizeRegNo('gj 1 ab 234')).toBe('GJ01AB0234')
    expect(normalizeRegNo('Vehicle No: MH12DE1433 Chassis')).toBe('MH12DE1433')
    expect(normalizeRegNo('22 BH 1234 AA')).toBe('22BH1234AA')
    expect(normalizeRegNo('valid up to 12-03-2027')).toBeNull()
    expect(displayRegNo('GJ01AB1234')).toBe('GJ 01 AB 1234')
  })
})

describe('reading documents', () => {
  it('reads an RC from DigiLocker or mParivahan', () => {
    const r = readVehicleDocument([
      [
        'Registration Certificate',
        'Registration Number: GJ01KP4321',
        'Date of Registration: 15-Mar-2019',
        'Registration Valid Upto: 14-Mar-2034',
        "Owner Name: MIHIR HADAVANI",
        'Chassis Number: MA3XXXXXXXXX12345',
        'Engine Number: K12MN1234567',
        'Vehicle Class: Motor Car (LMV)',
        'Fuel: PETROL',
        'Maker Name: MARUTI SUZUKI INDIA LTD',
        'Model Name: SWIFT VXI',
        'Insurance Company: ICICI Lombard General Insurance Co. Ltd.',
        'Insurance Upto: 11/03/2027',
        'PUCC Upto: 20-Jan-2027'
      ].join('\n')
    ])
    expect(r.kind).toBe('RC')
    expect(r.regNo).toBe('GJ01KP4321')
    expect(r.meta).toMatchObject({
      registrationDate: '2019-03-15',
      registrationValidUntil: '2034-03-14',
      ownerName: 'MIHIR HADAVANI',
      type: 'CAR',
      fuel: 'PETROL',
      make: 'MARUTI SUZUKI',
      model: 'SWIFT VXI'
    })
    expect(r.policy).toMatchObject({ endDate: '2027-03-11', insurer: 'ICICI Lombard' })
    expect(r.puc).toEqual({ validUntil: '2027-01-20' })
  })

  it('reads a motor policy schedule', () => {
    const r = readVehicleDocument([
      [
        'HDFC ERGO General Insurance Company Limited',
        'Private Car Package Policy - Policy Schedule cum Certificate of Insurance',
        'Policy No : 2311 2045 6789 0001 000',
        'Period of Insurance : From 12/03/2026 00:00 Hrs To Midnight of 11/03/2027',
        'Registration No. GJ-01-KP-4321',
        'Make : MARUTI   Model : SWIFT',
        'Total IDV (₹) 4,25,000',
        'No Claim Bonus (%) 35',
        'Total Premium Payable ₹ 14,862.00'
      ].join('\n')
    ])
    expect(r.kind).toBe('INSURANCE')
    expect(r.regNo).toBe('GJ01KP4321')
    expect(r.policy).toMatchObject({
      insurer: 'HDFC ERGO',
      startDate: '2026-03-12',
      endDate: '2027-03-11',
      idv: 425000,
      ncbPct: 35,
      premium: 14862,
      type: 'COMPREHENSIVE'
    })
    expect(r.policy?.policyNumber).toMatch(/^2311/)
  })

  it('reads a PUC certificate', () => {
    const r = readVehicleDocument([
      [
        'Pollution Under Control Certificate',
        'Certificate SL. No: GJ00123450012345',
        'Registration No: GJ01KP4321',
        'Date of Test: 21-01-2026',
        'Validity upto: 20-01-2027',
        'CO % 0.02 HC (ppm) 45'
      ].join('\n')
    ])
    expect(r.kind).toBe('PUC')
    expect(r.puc).toEqual({ validUntil: '2027-01-20', date: '2026-01-21', certificateNo: 'GJ00123450012345' })
  })
})

describe('vehicles', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-veh-'))
    const o = openDatabase(join(dir, 't.db'), '4'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const car = (over: Partial<VehicleMeta> = {}): VehicleMeta => ({
    regNo: 'GJ 01 KP 4321',
    type: 'CAR',
    fuel: 'PETROL',
    registrationDate: '2023-03-15',
    exShowroomPrice: 700000,
    ...over
  })

  it('depreciates like an insured declared value', () => {
    expect(idvDepreciation(0.3)).toBe(0.05)
    expect(idvDepreciation(3.5)).toBe(0.4)
    expect(idvDepreciation(6.2)).toBeCloseTo(0.6, 9)
  })

  it('values a car from its price, then from the policy IDV', () => {
    const id = saveVehicle(db, { personId: 1, meta: car() })
    let [v] = listVehicles(db, 1, '2026-10-17')
    expect(v.regDisplay).toBe('GJ 01 KP 4321')
    expect(v.value).toBeCloseTo(700000 * 0.6, 0) // 3.6 years old: 40% off
    saveVehicle(db, {
      id,
      personId: 1,
      meta: car({ policies: [{ id: 'p', startDate: '2026-03-12', endDate: '2027-03-11', idv: 450000 }] })
    })
    ;[v] = listVehicles(db, 1, '2026-10-17')
    // 3.0 years at the policy start (30% off), 3.6 now (40%): 450,000 × 0.6 / 0.7.
    expect(v.value).toBeCloseTo((450000 * 0.6) / 0.7, 0)
  })

  it('lists what is due, most urgent first', () => {
    saveVehicle(db, {
      personId: 1,
      meta: car({
        policies: [{ id: 'p', endDate: '2026-11-01' }],
        puc: [{ id: 'u', validUntil: '2026-10-01' }],
        expenses: [
          { id: 's', date: '2025-09-01', kind: 'SERVICE', amount: 6500, km: 30000 },
          { id: 'f1', date: '2026-08-01', kind: 'FUEL', amount: 3000, km: 38000, litres: 30 },
          { id: 'f2', date: '2026-09-01', kind: 'FUEL', amount: 3000, km: 38600, litres: 30 }
        ]
      })
    })
    const [v] = listVehicles(db, 1, '2026-10-17')
    expect(v.reminders.map((r) => [r.key, r.level])).toEqual([
      ['PUC', 'OVERDUE'],
      ['SERVICE', 'OVERDUE'],
      ['INSURANCE', 'SOON'],
      ['REGISTRATION', 'OK']
    ])
    expect(v.costs.kmPerLitre).toBeCloseTo(600 / 30, 9)
    expect(v.costs.last12m).toBe(6000)
    expect(v.lastKm).toEqual({ date: '2026-09-01', km: 38600 })
  })

  it('needs no PUC for an EV and refuses a duplicate number', () => {
    saveVehicle(db, { personId: 1, meta: car({ fuel: 'EV' }) })
    expect(listVehicles(db, 1, '2026-10-17')[0].reminders.some((r) => r.key === 'PUC')).toBe(false)
    expect(() => saveVehicle(db, { personId: 1, meta: car({ regNo: 'GJ01KP4321' }) })).toThrow(/already added/)
    expect(() => saveVehicle(db, { personId: 1, meta: car({ regNo: 'hello' }) })).toThrow(/registration number/)
  })

  it('keeps documents with the vehicle and removes them with it', () => {
    const id = saveVehicle(db, { personId: 1, meta: car() })
    addDocument(db, { type: 'VEHICLE', id }, 'RC', 'rc.pdf', Buffer.from('%PDF-1.4 test'))
    expect(listVehicles(db, 1)[0].documents).toMatchObject([{ kind: 'RC', fileName: 'rc.pdf', size: 13 }])
    expect(() => addDocument(db, { type: 'VEHICLE', id }, 'RC', 'rc.exe', Buffer.from('x'))).toThrow(/PDF or a photo/)
    deleteVehicle(db, id)
    expect(listVehicles(db, 1)).toEqual([])
  })
})
