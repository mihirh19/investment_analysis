import { useState, type FormEvent } from 'react'
import { PLATFORM_LABELS, type AssetClass, type ManualTxnInput, type Platform } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { useAddManual, useDeleteTransaction, usePersons, useTransactions } from '../lib/api'
import { money, shortDate, units } from '../lib/format'
import { ASSET_LABELS, TXN_LABELS } from '../lib/labels'
import { scopePersonId, useScope } from '../lib/scope'

const SOURCE_LABELS: Record<string, string> = {
  CAS_CAMS: 'CAMS statement',
  CAS_KFINTECH: 'KFintech statement',
  CAS_NSDL: 'NSDL statement',
  CAS_CDSL: 'CDSL statement',
  TRADEBOOK_ZERODHA: 'Zerodha tradebook',
  ORDERS_GROWW: 'Groww orders',
  MANUAL: 'Entered by hand'
}
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? (s.startsWith('GENERIC_') ? 'Trades file' : s)

export function Activity() {
  const { scope } = useScope()
  const txns = useTransactions(scopePersonId(scope))
  const del = useDeleteTransaction()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader title="Activity">
        {!adding && <Button onClick={() => setAdding(true)}>Add a trade by hand</Button>}
      </PageHeader>

      {adding && <ManualForm onDone={() => setAdding(false)} />}
      <ErrorNote error={txns.error ?? del.error} />

      {!txns.isLoading && (txns.data ?? []).length === 0 && (
        <p className="py-8 text-ink-muted">
          No trades recorded yet. Statements in summary form only bring in holdings; import a detailed CAS or a
          tradebook to see each purchase and sale here.
        </p>
      )}

      {(txns.data ?? []).length > 0 && (
        <table className="w-full text-[15px]">
          <thead className="sticky top-0 bg-paper">
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 font-medium">Date</th>
              <th className="py-1.5 font-medium">Holding</th>
              <th className="py-1.5 font-medium">Entry</th>
              <th className="num py-1.5 font-medium">Units</th>
              <th className="num py-1.5 font-medium">Price</th>
              <th className="num py-1.5 font-medium">Amount</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {txns.data!.map((t) => (
              <tr key={t.id} className="border-b border-rule align-top">
                <td className="num py-2 pr-4 text-left">{shortDate(t.date)}</td>
                <td className="py-2 pr-4">
                  <div className="leading-snug">{t.instrumentName}</div>
                  <div className="condensed text-[13px] text-ink-muted">
                    <span className="mr-3">{t.accountName}</span>
                    {sourceLabel(t.source)}
                  </div>
                </td>
                <td className="py-2">{TXN_LABELS[t.type]}</td>
                <td className="num py-2">{t.quantity ? units(t.quantity) : ''}</td>
                <td className="num py-2">{t.price !== null ? money(t.price, t.currency, 2) : ''}</td>
                <td className={`num py-2 ${t.amount > 0 ? 'text-gain' : ''}`}>{money(t.amount, t.currency, 2)}</td>
                <td className="py-1 pl-2 text-right">
                  {t.source === 'MANUAL' && (
                    <Button
                      variant="danger"
                      className="px-2 py-0.5 text-[13px]"
                      disabled={del.isPending}
                      onClick={() => {
                        if (confirm(`Delete this ${TXN_LABELS[t.type].toLowerCase()} of ${t.instrumentName}?`))
                          del.mutate(t.id)
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function ManualForm({ onDone }: { onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const add = useAddManual()
  const [f, setF] = useState({
    personId: scope === 'family' ? (persons[0]?.id ?? 1) : scope,
    platform: 'INDMONEY' as Platform,
    assetClass: 'EQUITY_US' as AssetClass,
    type: 'BUY' as ManualTxnInput['type'],
    date: today(),
    symbol: '',
    name: '',
    quantity: '',
    price: '',
    fees: ''
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))
  const currency = f.assetClass === 'EQUITY_US' ? 'USD' : 'INR'
  const isDividend = f.type === 'DIVIDEND'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(
      {
        personId: Number(f.personId),
        platform: f.platform,
        assetClass: f.assetClass,
        type: f.type,
        date: f.date,
        symbol: f.symbol,
        name: f.name,
        quantity: isDividend ? 0 : Number(f.quantity),
        price: Number(f.price),
        fees: f.fees ? Number(f.fees) : 0,
        currency
      },
      { onSuccess: onDone }
    )
  }

  return (
    <form onSubmit={submit} className="mb-8 rounded-md border border-rule bg-sheet p-5">
      <div className="grid grid-cols-4 gap-4">
        <Field label="Whose">
          <Select value={f.personId} onChange={(e) => set('personId', Number(e.target.value))}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Held with">
          <Select value={f.platform} onChange={(e) => set('platform', e.target.value as Platform)}>
            {(['INDMONEY', 'ZERODHA', 'GROWW', 'OTHER'] as Platform[]).map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Market">
          <Select value={f.assetClass} onChange={(e) => set('assetClass', e.target.value as AssetClass)}>
            {(['EQUITY_US', 'EQUITY_IN', 'ETF'] as AssetClass[]).map((a) => (
              <option key={a} value={a}>
                {ASSET_LABELS[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Entry">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as ManualTxnInput['type'])}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="DIVIDEND">Dividend received</option>
          </Select>
        </Field>

        <Field label="Date">
          <Input type="date" required value={f.date} max={today()} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label={currency === 'USD' ? 'Ticker' : 'NSE symbol'}>
          <Input
            required
            placeholder={currency === 'USD' ? 'AAPL' : 'INFY'}
            value={f.symbol}
            onChange={(e) => set('symbol', e.target.value)}
          />
        </Field>
        <Field label="Name" hint="Optional">
          <Input
            placeholder={currency === 'USD' ? 'Apple Inc' : 'Infosys'}
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        {!isDividend ? (
          <Field label="Units" hint="Fractions are fine">
            <Input
              required
              type="number"
              step="any"
              min="0"
              value={f.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}

        <Field label={isDividend ? `Amount received (${currency})` : `Price per unit (${currency})`}>
          <Input
            required
            type="number"
            step="any"
            min="0"
            value={f.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </Field>
        <Field label={`Charges (${currency})`} hint="Brokerage, fees">
          <Input type="number" step="any" min="0" value={f.fees} onChange={(e) => set('fees', e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={add.error} />
      <div className="mt-5 flex gap-3">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Save trade'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
