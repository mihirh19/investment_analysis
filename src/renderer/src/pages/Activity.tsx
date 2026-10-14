import { useState, type FormEvent } from 'react'
import { PLATFORM_LABELS, type AssetClass, type ManualTxnInput, type Platform } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { useAddManual, useDeleteTransaction, usePersons, useTransactions } from '../lib/api'
import { financialYear, money, shortDate, units } from '../lib/format'
import { DataTable } from '../components/DataTable'
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
        <DataTable
          id="activity"
          rows={txns.data!}
          rowKey={(t) => String(t.id)}
          initialSort={{ key: 'date', desc: true }}
          filterPlaceholder="Filter by holding, account, entry or source"
          csvName="activity"
          groups={[
            { key: 'holding', label: 'Holding', value: (t) => t.instrumentName },
            { key: 'account', label: 'Account', value: (t) => t.accountName },
            { key: 'type', label: 'Entry', value: (t) => TXN_LABELS[t.type] },
            { key: 'year', label: 'Financial year', value: (t) => financialYear(t.date) }
          ]}
          columns={[
            { key: 'date', header: 'Date', value: (t) => t.date, render: (t) => shortDate(t.date), className: 'whitespace-nowrap' },
            {
              key: 'holding',
              header: 'Holding',
              always: true,
              value: (t) => t.instrumentName,
              render: (t) => (
                <>
                  <div className="leading-snug">{t.instrumentName}</div>
                  <div className="condensed text-[13px] text-ink-muted">
                    <span className="mr-3">{t.accountName}</span>
                    {sourceLabel(t.source)}
                  </div>
                </>
              )
            },
            { key: 'account', header: 'Account', hidden: true, value: (t) => t.accountName },
            { key: 'source', header: 'Source', hidden: true, value: (t) => sourceLabel(t.source) },
            { key: 'type', header: 'Entry', value: (t) => TXN_LABELS[t.type] },
            { key: 'units', header: 'Units', align: 'right', value: (t) => t.quantity || null, render: (t) => (t.quantity ? units(t.quantity) : '') },
            {
              key: 'price',
              header: 'Price',
              align: 'right',
              value: (t) => t.price,
              render: (t) => (t.price !== null ? money(t.price, t.currency, 2) : '')
            },
            { key: 'currency', header: 'Currency', hidden: true, value: (t) => t.currency },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              value: (t) => t.amount,
              render: (t) => <span className={t.amount > 0 ? 'text-gain' : ''}>{money(t.amount, t.currency, 2)}</span>
            },
            {
              key: 'actions',
              header: '',
              always: true,
              sortable: false,
              noCsv: true,
              value: () => null,
              render: (t) =>
                t.source === 'MANUAL' ? (
                  <Button
                    variant="danger"
                    className="px-2 py-0.5 text-[13px]"
                    disabled={del.isPending}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Delete this ${TXN_LABELS[t.type].toLowerCase()} of ${t.instrumentName}?`)) del.mutate(t.id)
                    }}
                  >
                    Delete
                  </Button>
                ) : null
            }
          ]}
        />
      )}    </>
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
