import { PLATFORM_LABELS } from '@shared/types'
import type { StatementRead } from '@shared/ai'
import type { Db } from '../db'
import { emptyBundle, persistBundle, type NormAccount } from './bundle'
import { platformFromBroker } from './cas'
import { stockInstrument } from './trades'

/**
 * A broker's securities statement (Zerodha's "Statement of Accounts of Securities" and the like):
 * each closing balance becomes a holding as of the statement date, on the broker's demat account,
 * the one the CAS and the tradebook already use. Balances split over lines (free, pledged) are
 * added. A security with a closing balance of zero is recorded too, so a sale shows. Returns how
 * many holdings were new.
 */
export function importSecurityBalances(db: Db, personId: number, fileName: string, r: StatementRead): number {
  const date = r.periodTo ?? r.statementDate
  if (!date) return 0
  const platform = platformFromBroker(r.institution)
  const acct: NormAccount = { key: `${platform}:IN`, platform, kind: 'DEMAT', name: `${PLATFORM_LABELS[platform]} demat`, externalId: null, currency: 'INR' }
  const bundle = emptyBundle()
  bundle.accounts.push(acct)
  const held = new Map<string, { instr: ReturnType<typeof stockInstrument>; quantity: number; price: number | null; value: number | null }>()
  for (const h of r.holdings) {
    const isin = h.isin?.trim().toUpperCase() || null
    const symbol = (h.symbol ?? '').trim().toUpperCase()
    if ((!isin && !symbol) || !Number.isFinite(h.quantity) || h.quantity < 0) continue
    const instr = stockInstrument({ isin, symbol: symbol || h.name.toUpperCase(), exchange: '', name: h.name, market: 'IN' })
    // Without a printed symbol the name must not become the ticker.
    if (!symbol) instr.symbolNse = null
    const cur = held.get(instr.key)
    held.set(instr.key, {
      instr: cur?.instr ?? instr,
      quantity: (cur?.quantity ?? 0) + h.quantity,
      price: h.price ?? cur?.price ?? null,
      value: h.value === null ? (cur?.value ?? null) : (cur?.value ?? 0) + h.value
    })
  }
  for (const { instr, quantity, price, value } of held.values()) {
    bundle.instruments.push(instr)
    bundle.snapshots.push({
      accountKey: acct.key,
      instrumentKey: instr.key,
      date,
      quantity,
      price,
      value: value ?? (price !== null ? price * quantity : null),
      cost: null,
      source: 'STATEMENT_SECURITIES'
    })
  }
  return persistBundle(db, { personId, kind: 'BROKER_HOLDINGS', fileName, bundle }).snapshotsAdded
}
