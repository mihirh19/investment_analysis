import { useEffect, useRef, useState } from 'react'
import type { HoldingRow } from '@shared/types'
import { Link } from 'react-router-dom'
import { useDividends, usePriceHistory, useSetBuyPrice } from '../lib/api'
import { compactMoney, money, percent, shortDate, signedMoney, toneClass, units } from '../lib/format'
import { ASSET_LABELS, COST_SOURCE_LABELS, PRICE_SOURCE_LABELS } from '../lib/labels'
import { Button, Input } from './ui'
import { PriceLine } from './charts'
import { ErrorNote } from './Shell'

const RANGES = [
  { key: '1mo', label: '1M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '5y', label: '5Y' }
] as const

/** Side panel with a price chart and the full position for one holding. */
export function HoldingDetail({ row: r, onClose }: { row: HoldingRow; onClose: () => void }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('1y')
  const hasChart = !['EPF', 'INSURANCE'].includes(r.assetClass)
  const history = usePriceHistory(hasChart ? r.instrumentId : null, range)
  const dividends = useDividends(r.personId)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const points = history.data ?? []
  const first = points[0]?.close
  const last = points[points.length - 1]?.close
  const rangeChange = first && last ? (last - first) / first : null
  const paid = (dividends.data?.payments ?? []).filter((p) => p.instrumentId === r.instrumentId)
  const gainPct = r.unrealizedPnlInr !== null && r.investedInr ? r.unrealizedPnlInr / r.investedInr : null

  const facts: [string, React.ReactNode][] = [
    ['Held in', `${r.accountName}, ${r.personName}`],
    ['Type', ASSET_LABELS[r.assetClass]],
    ...(r.sector ? ([['Sector', r.sector]] as [string, string][]) : []),
    ...(r.isin ? ([['ISIN', r.isin]] as [string, string][]) : []),
    ...(r.assetClass === 'EPF' || r.assetClass === 'INSURANCE'
      ? []
      : ([
          ['Units', units(r.quantity)],
          ['Average cost', money(r.avgCost, r.currency, 2)]
        ] as [string, string][])),
    ['Invested', money(r.investedInr)],
    [
      'Price',
      <>
        {money(r.lastPrice, r.currency, 2)}{' '}
        <span className="text-ink-muted">
          {PRICE_SOURCE_LABELS[r.priceSource]}
          {r.priceDate ? `, ${shortDate(r.priceDate)}` : ''}
        </span>
      </>
    ],
    [
      'Value',
      <>
        {money(r.marketValueInr)}
        {r.currency !== 'INR' && (
          <span className="text-ink-muted">
            {' '}
            ({money(r.marketValue, r.currency)} at ₹{r.fxRate.toFixed(2)})
          </span>
        )}
      </>
    ],
    [
      'Gain',
      <span className={toneClass(r.unrealizedPnlInr)}>
        {signedMoney(r.unrealizedPnlInr)} {percent(gainPct)}
      </span>
    ],
    ...(r.dayChangeInr !== null
      ? ([['Day change', <span className={toneClass(r.dayChangeInr)}>{signedMoney(r.dayChangeInr)}</span>]] as [
          string,
          React.ReactNode
        ][])
      : []),
    ...(r.realizedPnl
      ? ([
          ['Booked profit', <span className={toneClass(r.realizedPnl)}>{signedMoney(r.realizedPnl, r.currency)}</span>]
        ] as [string, React.ReactNode][])
      : [])
  ]

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={r.instrumentName}
        className="h-full w-[640px] max-w-full overflow-y-auto border-l border-rule-strong bg-paper px-8 py-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule-strong pb-3">
          <div>
            <h2 className="wide text-[22px] leading-tight font-semibold">{r.instrumentName}</h2>
            <div className="text-[14px] text-ink-muted">{r.symbol}</div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="rounded-md border border-rule-strong px-3 py-1 text-[14px] hover:bg-sheet"
          >
            Close
          </button>
        </div>

        {hasChart && (
          <section aria-label="Price history" className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[14px]">
                <span className="text-ink-muted">Price</span>
                {rangeChange !== null && (
                  <span className={`num ml-3 ${toneClass(rangeChange)}`}>
                    {percent(rangeChange)} over {RANGES.find((x) => x.key === range)!.label}
                  </span>
                )}
              </div>
              <div role="radiogroup" aria-label="Range" className="flex gap-1">
                {RANGES.map((x) => (
                  <button
                    key={x.key}
                    role="radio"
                    aria-checked={range === x.key}
                    onClick={() => setRange(x.key)}
                    className={
                      'rounded px-2.5 py-0.5 text-[13px] ' +
                      (range === x.key ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet')
                    }
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={history.isFetching ? 'opacity-60' : ''}>
              {history.error ? (
                <ErrorNote error={history.error} />
              ) : points.length > 1 ? (
                <PriceLine
                  points={points}
                  label={`${r.instrumentName} price, ${RANGES.find((x) => x.key === range)!.label}`}
                  format={(v) => money(v, r.currency, 2)}
                  axisFormat={(v) => compactMoney(v, r.currency)}
                  reference={r.avgCost ? { value: r.avgCost, label: 'Your cost' } : null}
                />
              ) : (
                <div className="h-[240px] py-10 text-[14px] text-ink-muted">
                  {history.isLoading ? 'Loading prices…' : 'No price history.'}
                </div>
              )}
            </div>
          </section>
        )}

        <dl className="mt-6 text-[15px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-6 border-b border-rule py-1.5">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="num text-right">{v}</dd>
            </div>
          ))}
        </dl>

        <BuyPrice row={r} />

        {paid.length > 0 && (
          <section aria-label="Dividends" className="mt-8">
            <h3 className="wide mb-2 text-[17px] font-semibold">Dividends</h3>
            <table className="w-full text-[14px]">
              <tbody>
                {paid.slice(0, 10).map((p) => (
                  <tr key={p.exDate + p.accountName} className="border-b border-rule">
                    <td className="py-1.5">{shortDate(p.exDate)}</td>
                    <td className="num py-1.5 text-ink-muted">
                      {p.perShare !== null && p.quantity !== null
                        ? `${units(p.quantity)} × ${money(p.perShare, p.currency, 2)}`
                        : 'Received'}
                    </td>
                    <td className="num py-1.5">{money(p.netInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </aside>
    </div>
  )
}

// Holdings whose cost comes from statements or files, where a typed price applies.
const PRICED = ['EQUITY_IN', 'ETF', 'MF', 'EQUITY_US', 'REIT', 'BOND']

/**
 * What you paid. NSDL/CDSL statements don't say, so the gain stays blank until a broker's
 * holdings file is imported or a price is typed here. Your own trades, when imported, decide.
 */
function BuyPrice({ row: r }: { row: HoldingRow }) {
  const save = useSetBuyPrice()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [since, setSince] = useState('')
  if (!PRICED.includes(r.assetClass) || r.costSource === 'TRADES' || r.platform === 'MANUAL') return null
  const known = r.avgCost !== null && r.costSource !== null
  const submit = (avgCost: number | null) =>
    save.mutate(
      {
        personId: r.personId,
        accountId: r.accountId,
        instrumentId: r.instrumentId,
        avgCost,
        heldSince: avgCost !== null && since ? since : null
      },
      {
        onSuccess: () => setEditing(false)
      }
    )

  return (
    <section aria-label="Buy price" className="mt-6 rounded-md border border-rule bg-sheet px-4 py-3 text-[14px]">
      {known && !editing ? (
        <div className="flex items-baseline justify-between gap-4">
          <p>
            Average buy price <span className="num font-medium">{money(r.avgCost, r.currency, 2)}</span>
            <span className="text-ink-muted">, from {COST_SOURCE_LABELS[r.costSource!]}</span>
            {r.heldSince ? (
              <span className="text-ink-muted">. First bought {shortDate(r.heldSince)}</span>
            ) : (
              <span className="block text-[13px] text-ink-muted">
                No purchase date: add when it was first bought so tax treats it as long or short term.
              </span>
            )}
          </p>
          <button
            className="shrink-0 text-stamp hover:underline"
            onClick={() => {
              setValue(String(r.avgCost))
              setSince(r.heldSince ?? '')
              setEditing(true)
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value)
            if (n > 0) submit(n)
          }}
        >
          {!known && (
            <p className="mb-2 text-warn">
              Your statement doesn&rsquo;t say what you paid, so the gain can&rsquo;t be worked out. Enter your average
              buy price per {r.assetClass === 'MF' ? 'unit' : 'share'}, or{' '}
              <Link to="/import?kind=BROKER_HOLDINGS" className="underline">
                import your broker&rsquo;s holdings file
              </Link>{' '}
              to fill in every holding at once.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="buy-price" className="text-ink-muted">
              Average buy price ({r.currency === 'INR' ? '₹' : r.currency})
            </label>
            <Input
              id="buy-price"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-36"
            />
            <label htmlFor="held-since" className="ml-2 text-ink-muted">
              First bought on
            </label>
            <Input
              id="held-since"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="w-40"
            />
            <Button type="submit" disabled={save.isPending || !(Number(value) > 0)}>
              Save
            </Button>
            {editing && (
              <Button type="button" variant="quiet" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
          {r.costSource === 'MANUAL' && editing && (
            <button type="button" className="mt-2 text-stamp hover:underline" onClick={() => submit(null)}>
              Remove my price
            </button>
          )}
          <ErrorNote error={save.error} />
        </form>
      )}
    </section>
  )
}
