import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  COMPOUNDING,
  COUPON_FREQUENCIES,
  DEPOSIT_SUBTYPES,
  ENTRY_KINDS,
  MANUAL_KINDS,
  PAYOUTS,
  type DepositSubtype,
  type ManualAssetView,
  type ManualKind,
  type ManualMeta
} from '@shared/assets'
import { PriceLine } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  useAddManualEntry,
  useDeleteManual,
  useDeleteManualEntry,
  useManualAssets,
  useMetalPrices,
  usePersons,
  useSaveManual
} from '../lib/api'
import { compactMoney, money, percent, shortDate, signedMoney, toneClass, units } from '../lib/format'
import { DEPOSIT_LABELS, KIND_LABELS, LIQUIDITY_LABELS, PRICE_SOURCE_LABELS } from '../lib/labels'
import { stagger, useCountUp } from '../lib/motion'
import { useScope } from '../lib/scope'

const today = () => new Date().toISOString().slice(0, 10)

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
  SIMPLE: 'Simple interest',
  CUMULATIVE: 'At maturity (cumulative)',
  ZERO: 'Zero coupon'
}

/** Usual terms for each scheme, filled in when the type is picked (all editable). */
const SCHEME_DEFAULTS: Record<DepositSubtype, { compounding: string; payout: string; rate?: string; years?: number }> =
  {
    BANK_FD: { compounding: 'QUARTERLY', payout: 'CUMULATIVE' },
    CORPORATE_FD: { compounding: 'YEARLY', payout: 'CUMULATIVE' },
    POST_OFFICE_TD: { compounding: 'QUARTERLY', payout: 'YEARLY', years: 5 },
    NSC: { compounding: 'YEARLY', payout: 'CUMULATIVE', years: 5 },
    KVP: { compounding: 'YEARLY', payout: 'CUMULATIVE' },
    SCSS: { compounding: 'SIMPLE', payout: 'QUARTERLY', years: 5 },
    POMIS: { compounding: 'SIMPLE', payout: 'MONTHLY', years: 5 },
    RBI_BOND: { compounding: 'SIMPLE', payout: 'HALF_YEARLY', years: 7 },
    OTHER: { compounding: 'QUARTERLY', payout: 'CUMULATIVE' }
  }

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
  hint?: string
  optional?: boolean
}
const opts = (xs: readonly string[], labels: Record<string, string>) =>
  xs.map((x) => ({ value: x, label: labels[x] ?? x }))

const FIELDS: Record<ManualKind, FieldDef[]> = {
  DEPOSIT: [
    { key: 'subtype', label: 'Type', type: 'select', options: opts(DEPOSIT_SUBTYPES, DEPOSIT_LABELS) },
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. SBI FD 2027' },
    { key: 'institution', label: 'Bank or office', type: 'text', optional: true },
    { key: 'principal', label: 'Amount deposited (₹)', type: 'number' },
    { key: 'rate', label: 'Interest rate (% a year)', type: 'number' },
    { key: 'startDate', label: 'Start date', type: 'date' },
    { key: 'maturityDate', label: 'Maturity date', type: 'date' },
    { key: 'compounding', label: 'Compounding', type: 'select', options: opts(COMPOUNDING, FREQ_LABELS) },
    { key: 'payout', label: 'Interest paid', type: 'select', options: opts(PAYOUTS, FREQ_LABELS) }
  ],
  RD: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'institution', label: 'Bank or office', type: 'text', optional: true },
    { key: 'installment', label: 'Monthly instalment (₹)', type: 'number' },
    { key: 'rate', label: 'Interest rate (% a year)', type: 'number' },
    { key: 'startDate', label: 'First instalment', type: 'date' },
    { key: 'months', label: 'Number of months', type: 'number' }
  ],
  PPF: [
    {
      key: 'scheme',
      label: 'Scheme',
      type: 'select',
      options: [
        { value: 'PPF', label: 'Public Provident Fund' },
        { value: 'SSY', label: 'Sukanya Samriddhi Yojana' }
      ]
    },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'institution', label: 'Bank or post office', type: 'text', optional: true },
    { key: 'openDate', label: 'Account opened', type: 'date' },
    { key: 'rate', label: 'Interest rate (% a year)', type: 'number', hint: 'Set by the government each quarter' },
    { key: 'yearlyContribution', label: 'Deposited each year (₹)', type: 'number', hint: 'PPF up to ₹1.5 lakh' }
  ],
  BOND: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. Muthoot NCD 9% 2028' },
    { key: 'institution', label: 'Issuer', type: 'text', optional: true },
    { key: 'isin', label: 'ISIN', type: 'text', optional: true },
    { key: 'units', label: 'Units', type: 'number' },
    { key: 'faceValue', label: 'Face value per unit (₹)', type: 'number' },
    { key: 'purchasePrice', label: 'Price paid per unit (₹)', type: 'number' },
    { key: 'couponRate', label: 'Coupon (% a year)', type: 'number' },
    { key: 'couponFrequency', label: 'Coupon paid', type: 'select', options: opts(COUPON_FREQUENCIES, FREQ_LABELS) },
    { key: 'purchaseDate', label: 'Bought on', type: 'date' },
    { key: 'maturityDate', label: 'Matures on', type: 'date' },
    {
      key: 'marketPrice',
      label: 'Current market price per unit (₹)',
      type: 'number',
      optional: true,
      hint: 'Leave empty to value at face value'
    }
  ],
  SGB: [
    { key: 'name', label: 'Series', type: 'text', hint: 'e.g. SGB 2021-22 Series V' },
    { key: 'grams', label: 'Grams', type: 'number' },
    { key: 'issuePrice', label: 'Issue price per gram (₹)', type: 'number' },
    { key: 'issueDate', label: 'Issue date', type: 'date' },
    {
      key: 'purchasePrice',
      label: 'Price you paid per gram (₹)',
      type: 'number',
      optional: true,
      hint: 'Only if bought on the exchange'
    },
    { key: 'purchaseDate', label: 'Bought on', type: 'date', optional: true }
  ],
  METAL: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. Gold coins, Digital gold' },
    {
      key: 'metal',
      label: 'Metal',
      type: 'select',
      options: [
        { value: 'GOLD', label: 'Gold' },
        { value: 'SILVER', label: 'Silver' }
      ]
    },
    {
      key: 'form',
      label: 'Form',
      type: 'select',
      options: [
        { value: 'PHYSICAL', label: 'Coins or bars' },
        { value: 'JEWELLERY', label: 'Jewellery' },
        { value: 'DIGITAL', label: 'Digital' }
      ]
    },
    { key: 'grams', label: 'Weight (grams)', type: 'number' },
    {
      key: 'purity',
      label: 'Purity',
      type: 'select',
      options: [
        { value: '0.999', label: '24K / 999' },
        { value: '0.995', label: '995' },
        { value: '0.916', label: '22K / 916' },
        { value: '0.75', label: '18K / 750' },
        { value: '0.925', label: 'Sterling silver 925' }
      ]
    },
    { key: 'cost', label: 'Total paid (₹)', type: 'number' },
    { key: 'purchaseDate', label: 'Bought on', type: 'date' }
  ],
  PROPERTY: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. Flat in Pune' },
    {
      key: 'propertyType',
      label: 'Type',
      type: 'select',
      options: [
        { value: 'RESIDENTIAL', label: 'Home or flat' },
        { value: 'COMMERCIAL', label: 'Shop or office' },
        { value: 'LAND', label: 'Land or plot' },
        { value: 'OTHER', label: 'Other' }
      ]
    },
    { key: 'purchasePrice', label: 'Total cost (₹)', type: 'number', hint: 'Including registration and stamp duty' },
    { key: 'purchaseDate', label: 'Bought on', type: 'date' },
    { key: 'currentValue', label: 'What it is worth today (₹)', type: 'number', optional: true },
    {
      key: 'appreciation',
      label: 'Yearly growth to assume (%)',
      type: 'number',
      optional: true,
      hint: 'Used between your own estimates'
    },
    { key: 'monthlyRent', label: 'Monthly rent received (₹)', type: 'number', optional: true }
  ],
  CRYPTO: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. Bitcoin on WazirX' },
    { key: 'symbol', label: 'Ticker', type: 'text', hint: 'BTC, ETH, SOL…' },
    { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'cost', label: 'Total paid (₹)', type: 'number' },
    { key: 'purchaseDate', label: 'Bought on', type: 'date' }
  ],
  CASH: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. HDFC savings' },
    { key: 'institution', label: 'Bank', type: 'text', optional: true },
    { key: 'currentValue', label: 'Balance today (₹)', type: 'number' },
    { key: 'rate', label: 'Savings rate (% a year)', type: 'number', optional: true }
  ],
  OTHER: [
    { key: 'name', label: 'Name', type: 'text', hint: 'e.g. P2P lending, unlisted shares, art' },
    { key: 'institution', label: 'Where', type: 'text', optional: true },
    { key: 'cost', label: 'Amount put in (₹)', type: 'number', optional: true },
    { key: 'purchaseDate', label: 'Since', type: 'date', optional: true },
    { key: 'currentValue', label: 'Worth today (₹)', type: 'number', optional: true }
  ]
}

const NUMERIC = new Set([
  'principal',
  'rate',
  'installment',
  'months',
  'yearlyContribution',
  'faceValue',
  'units',
  'couponRate',
  'purchasePrice',
  'marketPrice',
  'grams',
  'issuePrice',
  'purity',
  'cost',
  'appreciation',
  'monthlyRent',
  'quantity'
])

function toMeta(kind: ManualKind, v: Record<string, string>): ManualMeta {
  const meta: Record<string, unknown> = { kind }
  for (const f of FIELDS[kind]) {
    if (f.key === 'currentValue') continue
    const raw = (v[f.key] ?? '').trim()
    if (raw === '') continue
    meta[f.key] = NUMERIC.has(f.key) ? Number(raw) : raw
  }
  return meta as unknown as ManualMeta
}

function fromMeta(m: ManualMeta): Record<string, string> {
  return Object.fromEntries(
    Object.entries(m)
      .filter(([k]) => k !== 'kind')
      .map(([k, val]) => [k, String(val ?? '')])
  )
}

function defaultsFor(kind: ManualKind): Record<string, string> {
  const t = today()
  switch (kind) {
    case 'DEPOSIT':
      return { subtype: 'BANK_FD', compounding: 'QUARTERLY', payout: 'CUMULATIVE', startDate: t }
    case 'RD':
      return { startDate: t, months: '12' }
    case 'PPF':
      return { scheme: 'PPF', rate: '7.1', yearlyContribution: '150000', name: 'PPF' }
    case 'BOND':
      return { faceValue: '1000', couponFrequency: 'YEARLY', purchaseDate: t }
    case 'METAL':
      return { metal: 'GOLD', form: 'PHYSICAL', purity: '0.999', purchaseDate: t }
    case 'PROPERTY':
      return { propertyType: 'RESIDENTIAL' }
    case 'CRYPTO':
      return { purchaseDate: t }
    default:
      return {}
  }
}

/** One line of the asset's key terms, as separate spans rather than a dotted string. */
function terms(a: ManualAssetView): string[] {
  const m = a.meta
  switch (m.kind) {
    case 'DEPOSIT':
      return [DEPOSIT_LABELS[m.subtype], `${m.rate}% a year`, FREQ_LABELS[m.payout]]
    case 'RD':
      return [`${money(m.installment)} a month`, `${m.rate}%`, `${m.months} months`]
    case 'PPF':
      return [m.scheme === 'SSY' ? 'Sukanya Samriddhi' : 'PPF', `${m.rate}%`, `${money(m.yearlyContribution)} a year`]
    case 'BOND':
      return [
        `${units(m.units)} units`,
        m.couponFrequency === 'ZERO'
          ? 'Zero coupon'
          : `${m.couponRate}% ${FREQ_LABELS[m.couponFrequency].toLowerCase()}`,
        m.isin ?? ''
      ]
    case 'SGB':
      return [`${units(m.grams)} g`, `issued ${shortDate(m.issueDate)}`, '2.5% interest']
    case 'METAL':
      return [`${units(m.grams)} g`, m.metal === 'GOLD' ? 'Gold' : 'Silver', `purity ${m.purity}`]
    case 'PROPERTY':
      return [
        `bought ${shortDate(m.purchaseDate)}`,
        m.monthlyRent ? `${money(m.monthlyRent)} rent a month` : '',
        m.appreciation ? `${m.appreciation}% growth assumed` : ''
      ]
    case 'CRYPTO':
      return [`${units(m.quantity)} ${m.symbol}`]
    case 'CASH':
      return [m.rate ? `${m.rate}% interest` : '']
    case 'OTHER':
      return []
  }
}

export function OtherAssets() {
  const { scope } = useScope()
  const assets = useManualAssets()
  const metals = useMetalPrices()
  const [filter, setFilter] = useState<ManualKind | 'ALL'>('ALL')
  const [editing, setEditing] = useState<ManualAssetView | 'new' | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  const mine = (assets.data ?? []).filter((a) => scope === 'family' || a.personId === scope)
  const kinds = MANUAL_KINDS.filter((k) => mine.some((a) => a.meta.kind === k))
  const list = mine.filter((a) => filter === 'ALL' || a.meta.kind === filter)
  const total = mine.reduce((s, a) => s + (a.value ?? 0), 0)
  const shownTotal = useCountUp(total)
  const g = metals.data

  return (
    <>
      <PageHeader title="Other assets">
        {editing === null && <Button onClick={() => setEditing('new')}>Add an asset</Button>}
      </PageHeader>
      <ErrorNote error={assets.error} />

      <div className="mb-6 flex flex-wrap items-baseline gap-x-10 gap-y-2">
        <div>
          <div className="text-[13px] text-ink-muted">Deposits, bonds, gold, property, crypto and more</div>
          <div className="wide text-[30px] font-semibold">{money(shownTotal)}</div>
        </div>
        {g?.goldPerGram && (
          <div className="text-[14px] text-ink-muted">
            <span className="mr-6">
              Gold <span className="num font-medium text-ink">{money(g.goldPerGram, 'INR', 0)}</span>/g (24K)
            </span>
            <span className="mr-6">
              Silver <span className="num font-medium text-ink">{money((g.silverPerGram ?? 0) * 1000, 'INR', 0)}</span>
              /kg
            </span>
            <span>Live, international price plus {g.premiumPct}% import duty</span>
          </div>
        )}
      </div>

      {editing !== null && <AssetForm asset={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}

      {mine.length === 0 && editing === null && !assets.isLoading && (
        <div className="max-w-[72ch] py-4">
          <p className="text-ink-muted">
            Add anything that isn&rsquo;t in a demat or fund statement: bank and post office deposits, NSC, KVP, SCSS,
            PPF and Sukanya Samriddhi, bonds and NCDs, Sovereign Gold Bonds, gold and silver, property, crypto, savings
            accounts. Deposits and bonds grow by their own terms, gold and crypto follow live prices.
          </p>
          <Button className="mt-4" onClick={() => setEditing('new')}>
            Add your first asset
          </Button>
        </div>
      )}

      {kinds.length > 1 && (
        <div role="tablist" aria-label="Filter by kind" className="mb-4 flex flex-wrap gap-1.5">
          {(['ALL', ...kinds] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={
                'rounded-full border px-3 py-1 text-[14px] transition-colors ' +
                (filter === k
                  ? 'border-stamp bg-stamp-wash font-medium text-stamp'
                  : 'border-rule-strong text-ink-muted hover:text-ink')
              }
            >
              {k === 'ALL'
                ? `All ${mine.length}`
                : `${KIND_LABELS[k].plural} ${mine.filter((a) => a.meta.kind === k).length}`}
            </button>
          ))}
        </div>
      )}

      <ul className="border-t border-rule-strong">
        {list.map((a, i) => (
          <AssetRow
            key={a.accountId}
            a={a}
            index={i}
            open={open === a.accountId}
            showPerson={scope === 'family'}
            onToggle={() => setOpen(open === a.accountId ? null : a.accountId)}
            onEdit={() => setEditing(a)}
          />
        ))}
      </ul>
    </>
  )
}

function Progress({ start, end }: { start: string; end: string }) {
  const t0 = Date.parse(start)
  const t1 = Date.parse(end)
  const frac = Math.max(0, Math.min(1, (Date.now() - t0) / (t1 - t0 || 1)))
  return (
    <div className="mt-1.5 flex items-center gap-2" title={`${Math.round(frac * 100)}% of the term done`}>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-rule">
        <div className="anim-grow-x h-full rounded-full bg-stamp" style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="text-[12px] text-ink-muted">{frac >= 1 ? 'Matured' : `matures ${shortDate(end)}`}</span>
    </div>
  )
}

function AssetRow({
  a,
  index,
  open,
  showPerson,
  onToggle,
  onEdit
}: {
  a: ManualAssetView
  index: number
  open: boolean
  showPerson: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const del = useDeleteManual()
  const navigate = useNavigate()
  // Payout deposits (SCSS, POMIS, monthly-interest FDs) hand their interest over instead of growing.
  const paysOut = a.meta.kind === 'DEPOSIT' && a.meta.payout !== 'CUMULATIVE'
  const gain = !paysOut && a.value !== null && a.invested !== null ? a.value - a.invested : null
  const start =
    'startDate' in a.meta
      ? a.meta.startDate
      : 'purchaseDate' in a.meta
        ? a.meta.purchaseDate
        : 'openDate' in a.meta
          ? a.meta.openDate
          : 'issueDate' in a.meta
            ? a.meta.issueDate
            : null
  return (
    <li className="anim-page border-b border-rule" style={stagger(index, 30, 300)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_140px_140px_180px] items-start gap-4 py-3 hover:bg-sheet/60"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">{a.meta.name}</span>
            <span className="shrink-0 rounded-full bg-stamp-wash px-2 py-0.5 text-[11px] text-stamp">
              {KIND_LABELS[a.meta.kind].plural}
            </span>
            {a.matured && (
              <span className="shrink-0 rounded-full bg-warn-wash px-2 py-0.5 text-[11px] text-warn">
                Matured, update or remove
              </span>
            )}
          </div>
          <div className="condensed mt-0.5 text-[13px] text-ink-muted">
            {[a.meta.institution, ...terms(a), showPerson ? a.personName : null].filter(Boolean).map((t) => (
              <span key={t} className="mr-3">
                {t}
              </span>
            ))}
          </div>
          {start && a.maturityDate && <Progress start={start} end={a.maturityDate} />}
        </div>
        <div className="num">
          <div className="font-medium">{money(a.value)}</div>
          <div className="text-[12px] text-ink-muted">{PRICE_SOURCE_LABELS[a.priceSource]}</div>
        </div>
        <div className={`num ${toneClass(gain)}`}>
          {gain !== null ? signedMoney(gain) : ''}
          {gain !== null && a.invested ? <div className="text-[12px]">{percent(gain / a.invested)}</div> : null}
          {paysOut && <div className="text-[13px] text-ink-muted">Pays interest out</div>}
        </div>
        <div className="text-right text-[13px]">
          {a.nextEvent ? (
            <>
              <div className="num">{signedMoney(a.nextEvent.amount)}</div>
              <div className="text-ink-muted">
                {a.nextEvent.label}, {shortDate(a.nextEvent.date)}
              </div>
            </>
          ) : (
            <div className="text-ink-muted">{LIQUIDITY_LABELS[a.liquidity].label}</div>
          )}
        </div>
      </div>

      {open && (
        <div className="anim-page grid grid-cols-1 gap-8 pb-6 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            {a.projection.length > 1 ? (
              <>
                <div className="mb-1 text-[14px] text-ink-muted">
                  {a.maturityDate ? `Growth to ${shortDate(a.maturityDate)}` : 'Projected value'}
                  {a.maturityValue ? (
                    <span className="num ml-2 font-medium text-ink">{money(a.maturityValue)}</span>
                  ) : null}
                </div>
                <PriceLine
                  points={a.projection.map((p) => ({ date: p.date, close: p.value }))}
                  label={`${a.meta.name} projected value`}
                  format={(v) => money(v)}
                  axisFormat={(v) => compactMoney(v)}
                  reference={a.invested ? { value: a.invested, label: 'Put in' } : null}
                  height={200}
                />
              </>
            ) : (
              <p className="text-[14px] text-ink-muted">
                {a.meta.kind === 'METAL' || a.meta.kind === 'SGB' || a.meta.kind === 'CRYPTO'
                  ? 'Valued at the live market price each time prices refresh.'
                  : 'Valued from the amounts you enter.'}
              </p>
            )}
          </div>
          <div>
            <dl className="text-[14px]">
              {[
                ['Put in', money(a.invested)],
                ['Worth now', money(a.value)],
                [
                  'Can be used',
                  LIQUIDITY_LABELS[a.liquidity].label +
                    (a.lockedUntil ? ` (locked till ${shortDate(a.lockedUntil)})` : '')
                ],
                ...(a.maturityDate
                  ? [['Matures', `${shortDate(a.maturityDate)}${a.maturityValue ? `, ${money(a.maturityValue)}` : ''}`]]
                  : [])
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-rule py-1.5">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="num text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {ENTRY_KINDS.includes(a.meta.kind) && <Entries a={a} />}
            <div className="mt-4 flex gap-3">
              {a.meta.kind === 'PROPERTY' && (
                <Button onClick={() => navigate('/property')}>Rent, city price and tax</Button>
              )}
              <Button variant="quiet" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="danger" onClick={() => confirm(`Remove ${a.meta.name}?`) && del.mutate([a.accountId])}>
                Remove
              </Button>
            </div>
            <ErrorNote error={del.error} />
          </div>
        </div>
      )}
    </li>
  )
}

function Entries({ a }: { a: ManualAssetView }) {
  const add = useAddManualEntry()
  const del = useDeleteManualEntry()
  const [date, setDate] = useState(today())
  const [value, setValue] = useState('')
  const label = a.meta.kind === 'PPF' ? 'Passbook balance' : a.meta.kind === 'CASH' ? 'Balance' : 'Estimated value'
  return (
    <div className="mt-4">
      <div className="mb-1 text-[13px] font-medium">{label} history</div>
      <table className="w-full text-[13px]">
        <tbody>
          {[...a.entries].reverse().map((e) => (
            <tr key={e.date} className="border-b border-rule">
              <td className="py-1">{shortDate(e.date)}</td>
              <td className="num py-1">{money(e.value)}</td>
              <td className="py-0.5 text-right">
                <button className="px-2 text-loss hover:underline" onClick={() => del.mutate([a.accountId, e.date])}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          add.mutate([a.accountId, date, Number(value)], { onSuccess: () => setValue('') })
        }}
      >
        <Field label="Date">
          <Input type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`${label} (₹)`}>
          <Input
            type="number"
            required
            min="0"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-36"
          />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      <ErrorNote error={add.error ?? del.error} />
    </div>
  )
}

function AssetForm({ asset, onDone }: { asset: ManualAssetView | null; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveManual()
  const addEntry = useAddManualEntry()
  const [kind, setKind] = useState<ManualKind>(asset?.meta.kind ?? 'DEPOSIT')
  const [personId, setPersonId] = useState<number>(
    asset?.personId ?? (scope === 'family' ? (persons[0]?.id ?? 1) : scope)
  )
  const [v, setV] = useState<Record<string, string>>(asset ? fromMeta(asset.meta) : defaultsFor('DEPOSIT'))
  const fields = useMemo(() => FIELDS[kind].filter((f) => !(asset && f.key === 'currentValue')), [kind, asset])

  const pickKind = (k: ManualKind) => {
    setKind(k)
    setV(defaultsFor(k))
  }
  const set = (key: string, value: string) => {
    setV((s) => {
      const next = { ...s, [key]: value }
      // Picking a scheme fills its usual compounding, payout and tenure.
      if (kind === 'DEPOSIT' && key === 'subtype') {
        const d = SCHEME_DEFAULTS[value as DepositSubtype]
        next.compounding = d.compounding
        next.payout = d.payout
        if (d.years && next.startDate) {
          const [y, m, dd] = next.startDate.split('-')
          next.maturityDate = `${Number(y) + d.years}-${m}-${dd}`
        }
      }
      if (kind === 'PPF' && key === 'scheme') next.rate = value === 'SSY' ? '8.2' : '7.1'
      return next
    })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Keep what this form doesn't show, such as a property's city, tenancies, rent and expenses.
    const shown = new Set(FIELDS[kind].map((f) => f.key))
    const kept =
      asset && asset.meta.kind === kind ? Object.fromEntries(Object.entries(asset.meta).filter(([k]) => !shown.has(k))) : {}
    const meta = { ...kept, ...toMeta(kind, v) } as ManualMeta
    save.mutate([{ accountId: asset?.accountId, personId, meta }], {
      onSuccess: (id) => {
        const cv = Number(v.currentValue)
        if (!asset && v.currentValue && cv >= 0) addEntry.mutate([id, today(), cv])
        onDone()
      }
    })
  }

  return (
    <form onSubmit={submit} className="anim-pop mb-8 rounded-md border border-rule bg-sheet p-5">
      {!asset && (
        <fieldset className="mb-5">
          <legend className="mb-2 text-[14px] font-medium">What is it?</legend>
          <div className="flex flex-wrap gap-1.5">
            {MANUAL_KINDS.map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => pickKind(k)}
                aria-pressed={kind === k}
                className={
                  'rounded-full border px-3 py-1 text-[14px] transition-colors ' +
                  (kind === k
                    ? 'border-stamp bg-stamp-wash font-medium text-stamp'
                    : 'border-rule-strong text-ink-muted hover:text-ink')
                }
              >
                {KIND_LABELS[k].label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-4 @5xl:grid-cols-4">
        <Field label="Whose">
          <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {fields.map((f) => (
          <Field
            key={f.key}
            label={f.label + (f.optional ? '' : '')}
            hint={f.hint ?? (f.optional ? 'Optional' : undefined)}
          >
            {f.type === 'select' ? (
              <Select value={v[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={f.type}
                required={!f.optional}
                step={f.type === 'number' ? 'any' : undefined}
                min={f.type === 'number' ? '0' : undefined}
                value={v[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
      <ErrorNote error={save.error ?? addEntry.error} />
      <div className="mt-5 flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
