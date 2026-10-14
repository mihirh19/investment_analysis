import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_LABELS, type AssetClass, type HoldingRow } from '@shared/types'
import { downloadCsv } from '../components/DataTable'
import { HoldingDetail } from '../components/HoldingDetail'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Input } from '../components/ui'
import { useHoldings, useSparklines } from '../lib/api'
import { useFlash } from '../lib/motion'
import { Sparkline } from '../components/viz'
import { money, percent, shortDate, signedMoney, toneClass, units } from '../lib/format'
import { ASSET_COLORS, ASSET_LABELS, ASSET_ORDER, PRICE_SOURCE_LABELS } from '../lib/labels'
import { scopePersonId, useScope } from '../lib/scope'
import { groupBy, totals } from '../lib/summary'

type SortKey = 'name' | 'value' | 'day' | 'gain' | 'gainPct'
type GroupKey = 'type' | 'person' | 'platform' | 'account' | 'none'
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'person', label: 'Person' },
  { key: 'platform', label: 'Where held' },
  { key: 'account', label: 'Account' },
  { key: 'none', label: 'Nothing' }
]
const GROUP_KEY = 'holdings:group'

const gainPct = (r: HoldingRow) =>
  r.unrealizedPnlInr !== null && r.investedInr ? r.unrealizedPnlInr / r.investedInr : null
const dayPct = (r: HoldingRow) =>
  r.dayChange !== null && r.prevClose ? r.dayChange / (r.quantity * r.prevClose) : null
/** EPF and insurance are single balances, not units with a price. */
const isBalance = (r: HoldingRow) => r.assetClass === 'EPF' || r.assetClass === 'INSURANCE'

const SORTERS: Record<SortKey, (a: HoldingRow, b: HoldingRow) => number> = {
  name: (a, b) => a.instrumentName.localeCompare(b.instrumentName),
  value: (a, b) => (b.marketValueInr ?? 0) - (a.marketValueInr ?? 0),
  day: (a, b) => (dayPct(b) ?? -Infinity) - (dayPct(a) ?? -Infinity),
  gain: (a, b) => (b.unrealizedPnlInr ?? -Infinity) - (a.unrealizedPnlInr ?? -Infinity),
  gainPct: (a, b) => (gainPct(b) ?? -Infinity) - (gainPct(a) ?? -Infinity)
}

export function Holdings() {
  const { scope } = useScope()
  const holdings = useHoldings(scopePersonId(scope))
  const sparkIds = useMemo(
    () => [...new Set((holdings.data ?? []).filter((r) => !isBalance(r)).map((r) => r.instrumentId))],
    [holdings.data]
  )
  const sparks = useSparklines(sparkIds).data ?? {}
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [open, setOpen] = useState<HoldingRow | null>(null)
  const [groupKey, setGroupKey] = useState<GroupKey>(() => (localStorage.getItem(GROUP_KEY) as GroupKey) || 'type')
  const chooseGroup = (g: GroupKey) => {
    localStorage.setItem(GROUP_KEY, g)
    setGroupKey(g)
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (holdings.data ?? []).filter(
      (r) =>
        !q ||
        r.instrumentName.toLowerCase().includes(q) ||
        r.symbol?.toLowerCase().includes(q) ||
        r.isin?.toLowerCase().includes(q) ||
        r.sector?.toLowerCase().includes(q) ||
        r.accountName.toLowerCase().includes(q)
    )
    const keyOf = (r: HoldingRow): string =>
      groupKey === 'type'
        ? r.assetClass
        : groupKey === 'person'
          ? r.personName
          : groupKey === 'platform'
            ? PLATFORM_LABELS[r.platform]
            : groupKey === 'account'
              ? r.accountName
              : 'All holdings'
    return [...groupBy(rows, keyOf)]
      .sort((a, b) =>
        groupKey === 'type'
          ? ASSET_ORDER.indexOf(a[0] as AssetClass) - ASSET_ORDER.indexOf(b[0] as AssetClass)
          : totals(b[1]).value - totals(a[1]).value
      )
      .map(([key, rs]) => ({
        key,
        label: groupKey === 'type' ? ASSET_LABELS[key as AssetClass] : key,
        color: groupKey === 'type' ? ASSET_COLORS[key as AssetClass] : null,
        rows: [...rs].sort(SORTERS[sort])
      }))
  }, [holdings.data, query, sort, groupKey])

  const exportCsv = () =>
    downloadCsv('holdings.csv', [
      ['Holding', 'Symbol', 'ISIN', 'Type', 'Person', 'Account', 'Units', 'Avg cost', 'Price', 'Currency', 'Price source', 'Value (INR)', 'Invested (INR)', 'Gain (INR)', 'Return', 'Day change (INR)'],
      ...groups.flatMap((g) =>
        g.rows.map((r) => [
          r.instrumentName,
          r.symbol,
          r.isin,
          ASSET_LABELS[r.assetClass],
          r.personName,
          r.accountName,
          isBalance(r) ? null : r.quantity,
          r.avgCost,
          r.lastPrice,
          r.currency,
          PRICE_SOURCE_LABELS[r.priceSource],
          r.marketValueInr,
          r.investedInr,
          r.unrealizedPnlInr,
          gainPct(r),
          r.dayChangeInr
        ])
      )
    ])

  const flagged = (holdings.data ?? []).filter((r) => r.tradesQuantity !== null).length
  // Statements from NSDL/CDSL give units and value but no buy price.
  const noCost = (holdings.data ?? []).filter(
    (r) => ['EQUITY_IN', 'ETF', 'MF', 'EQUITY_US', 'REIT', 'BOND'].includes(r.assetClass) && r.investedInr === null
  )
  const showPerson = scope === 'family'

  const SortHeader = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      className={`py-1.5 font-medium ${k === 'name' ? '' : 'text-right'}`}
      aria-sort={sort === k ? 'descending' : 'none'}
    >
      <button onClick={() => setSort(k)} className={sort === k ? 'text-ink' : 'hover:text-ink'}>
        {children}
        {sort === k && <span aria-hidden> ↓</span>}
      </button>
    </th>
  )

  return (
    <>
      <PageHeader title="Holdings">
        <label className="flex items-center gap-1.5 text-[14px] text-ink-muted">
          Group by
          <select
            value={groupKey}
            onChange={(e) => chooseGroup(e.target.value as GroupKey)}
            className="rounded border border-rule-strong bg-sheet px-1.5 py-1 text-ink"
          >
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!groups.length}
          className="rounded border border-rule-strong px-2.5 py-1 text-[14px] hover:bg-sheet disabled:opacity-50"
        >
          Download CSV
        </button>
        <Input
          type="search"
          placeholder="Find a stock, fund, sector or ISIN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-72"
          aria-label="Filter holdings"
        />
      </PageHeader>
      <ErrorNote error={holdings.error} />

      {flagged > 0 && (
        <p className="mb-5 rounded-md bg-warn-wash px-3 py-2 text-[14px] text-warn">
          {flagged} {flagged === 1 ? 'holding has' : 'holdings have'} trades that don&rsquo;t add up to the units in the
          latest statement. Units follow the statement; import older tradebooks to fix the average cost.
        </p>
      )}

      {noCost.length > 0 && (
        <p className="mb-5 rounded-md bg-warn-wash px-3 py-2 text-[14px] text-warn">
          {noCost.length} {noCost.length === 1 ? 'holding has' : 'holdings have'} no buy price, so invested and gain are
          blank: NSDL/CDSL statements list only units and value.{' '}
          <Link to="/import?kind=BROKER_HOLDINGS" className="underline">
            Import your broker&rsquo;s holdings file
          </Link>{' '}
          (Zerodha Console or Groww) to fill them all, or click a holding to type its price.
        </p>
      )}

      {!holdings.isLoading && groups.length === 0 && (
        <p className="py-8 text-ink-muted">
          {query ? 'No holdings match that search.' : 'No holdings yet. Import a statement to begin.'}
        </p>
      )}

      {groups.length > 0 && (
        <table className="w-full text-[15px]">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <SortHeader k="name">Holding</SortHeader>
              <th className="num py-1.5 font-medium">Units</th>
              <th className="num py-1.5 font-medium">Avg cost</th>
              <th className="num py-1.5 font-medium">Price</th>
              <th className="py-1.5 pl-3 font-medium">3 months</th>
              <SortHeader k="day">Day</SortHeader>
              <SortHeader k="value">Value (₹)</SortHeader>
              <SortHeader k="gain">Gain (₹)</SortHeader>
              <SortHeader k="gainPct">Return</SortHeader>
            </tr>
          </thead>
          {groups.map(({ key, label, color, rows }) => {
            const t = totals(rows)
            return (
              <tbody key={key}>
                <tr className="border-b border-rule-strong">
                  <th colSpan={5} className="pt-6 pb-1.5 text-left">
                    {color && (
                      <span className="mr-2 inline-block size-2.5 rounded-[2px] align-middle" style={{ background: color }} />
                    )}
                    <span className="wide text-[16px] font-semibold">{label}</span>
                    <span className="ml-2 text-[13px] font-normal text-ink-muted">{rows.length}</span>
                  </th>
                  <td className={`num pt-6 pb-1.5 ${toneClass(t.dayChange)}`}>
                    {t.dayBase > 0 ? signedMoney(t.dayChange) : ''}
                  </td>
                  <td className="num pt-6 pb-1.5 font-semibold">{money(t.value)}</td>
                  <td className={`num pt-6 pb-1.5 ${toneClass(t.gain)}`}>{signedMoney(t.gain)}</td>
                  <td className={`num pt-6 pb-1.5 ${toneClass(t.gain)}`}>{percent(t.gainPct)}</td>
                </tr>
                {rows.map((r) => (
                  <tr
                    key={`${r.accountId}:${r.instrumentId}`}
                    tabIndex={0}
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                    className="cursor-pointer border-b border-rule align-top hover:bg-sheet/70 focus-visible:bg-sheet"
                  >
                    <td className="py-2 pr-4">
                      <div className="leading-snug">{r.instrumentName}</div>
                      <div className="condensed text-[13px] text-ink-muted">
                        {[r.symbol, r.accountName, showPerson ? r.personName : null, r.sector]
                          .filter(Boolean)
                          .map((s) => (
                            <span key={s} className="mr-3">
                              {s}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="num py-2">
                      {isBalance(r) ? '' : units(r.quantity)}
                      {r.tradesQuantity !== null && (
                        <div className="text-[12px] text-warn" title="Units shown are from the statement">
                          trades: {units(r.tradesQuantity)}
                        </div>
                      )}
                    </td>
                    <td className="num py-2">{isBalance(r) ? '' : money(r.avgCost, r.currency, 2)}</td>
                    <td className="num py-2">
                      {isBalance(r) ? '' : <LivePrice value={r.lastPrice} currency={r.currency} />}
                      <div
                        className={'text-[12px] ' + (r.priceSource === 'STATEMENT' ? 'text-warn' : 'text-ink-muted')}
                      >
                        {PRICE_SOURCE_LABELS[r.priceSource]}
                        {r.priceSource !== 'LIVE' && r.priceDate ? `, ${shortDate(r.priceDate)}` : ''}
                      </div>
                    </td>
                    <td className="py-2 pl-3">
                      {sparks[r.instrumentId] && <Sparkline values={sparks[r.instrumentId]} />}
                    </td>
                    <td className={`num py-2 ${toneClass(r.dayChange)}`}>{percent(dayPct(r))}</td>
                    <td className="num py-2 font-medium">
                      {money(r.marketValueInr)}
                      {r.currency !== 'INR' && (
                        <div className="text-[12px] font-normal text-ink-muted">{money(r.marketValue, r.currency)}</div>
                      )}
                    </td>
                    <td className={`num py-2 ${toneClass(r.unrealizedPnlInr)}`}>{signedMoney(r.unrealizedPnlInr)}</td>
                    <td className={`num py-2 ${toneClass(r.unrealizedPnlInr)}`}>{percent(gainPct(r))}</td>
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      )}
      {open && <HoldingDetail row={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** A price that flashes green or red for a moment when a live refresh moves it. */
function LivePrice({ value, currency }: { value: number | null; currency: string }) {
  const flash = useFlash(value)
  return (
    <span key={flash.key} className={`-mx-1 rounded px-1 ${flash.className}`}>
      {money(value, currency, 2)}
    </span>
  )
}
