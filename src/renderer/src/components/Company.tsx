import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fyLabel,
  quarterLabel,
  type Balance,
  type Basis,
  type CompanyView,
  type Flow,
  type Metrics
} from '@shared/research'
import { ErrorNote } from './Shell'
import { FlashNum } from './FlashNum'
import { useLive } from '../lib/live'
import { Ownership } from './Ownership'
import { Valuation } from './Valuation'
import { Columns } from './charts'
import { BASE_COLUMNS, ScreenTable } from './ScreenTable'
import { StockChart, useStoredChart } from './StockChart'
import { scorecard, stockContext } from '@shared/scorecard'
import { ScoreList } from './ScoreList'
import { useOpenSymbol } from '../lib/links'
import { useCompany, useScreenData } from '../lib/api'
import { axisCrore, bigMoney, compactMoney, lakhCrore, money, percent, shortDate, toneClass, units } from '../lib/format'

export type View = 'overview' | 'financials' | 'valuation' | 'ownership' | 'chart' | 'peers'
export const VIEWS: { key: View; label: string; codes: string[] }[] = [
  { key: 'overview', label: 'Overview', codes: ['ov', 'overview'] },
  { key: 'financials', label: 'Financials', codes: ['fin', 'financials', 'fa'] },
  { key: 'valuation', label: 'Valuation', codes: ['val', 'valuation', 'dcf'] },
  { key: 'ownership', label: 'Ownership', codes: ['own', 'ownership', 'hds'] },
  { key: 'chart', label: 'Price chart', codes: ['ch', 'chart', 'gp'] },
  { key: 'peers', label: 'Peers', codes: ['peer', 'peers', 'rv'] }
]

const crore = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : (v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1e9 ? 0 : 1 })
const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
const times = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1))

export function CompanyPage({ symbol, view }: { symbol: string; view: View }) {
  const [basis, setBasis] = useState<Basis | null>(null)
  const q = useCompany(symbol, basis)
  const navigate = useNavigate()
  const c = q.data
  if (q.isLoading) return <p className="text-ink-muted">Opening {symbol}…</p>
  if (q.error) return <ErrorNote error={q.error} />
  if (!c)
    return (
      <p className="text-[15px] text-ink-muted">
        {symbol} isn't on NSE's list of listed companies. Check the symbol, or search by name above.
      </p>
    )
  const setView = (v: View) => navigate(`/research/${encodeURIComponent(symbol)}${v === 'overview' ? '' : `?view=${v}`}`, { replace: true })
  return (
    // Tickertape's arrangement: the price and the scorecard stay at the left while the views change.
    <article aria-labelledby="company-name" className="grid items-start gap-8 @5xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-4 @5xl:sticky @5xl:top-16">
        <PriceCard c={c} />
        <Scorecard c={c} />
      </aside>
      <div className="min-w-0">
      <ResultsNote c={c} />
      <div role="tablist" aria-label="Company views" className="mb-5 flex gap-1 overflow-x-auto border-b border-rule">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={
              '-mb-px border-b-2 px-3 pb-2 text-[14.5px] ' +
              (view === v.key ? 'border-stamp font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink')
            }
          >
            {v.label}
          </button>
        ))}
        {c.bases.length > 1 && (view === 'overview' || view === 'financials') && (
          <div role="radiogroup" aria-label="Figures for" className="ml-auto flex items-center gap-1 pb-1.5">
            {(['C', 'S'] as const).map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={c.basis === b}
                onClick={() => setBasis(b)}
                className={
                  'rounded px-2.5 py-0.5 text-[13px] ' +
                  (c.basis === b ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet')
                }
              >
                {b === 'C' ? 'Consolidated' : 'Standalone'}
              </button>
            ))}
          </div>
        )}
      </div>
      {view === 'overview' && <Overview c={c} onPeers={() => setView('peers')} />}
      {view === 'financials' && <Financials c={c} />}
      {view === 'valuation' && <Valuation c={c} />}
      {view === 'ownership' && <Ownership symbol={symbol} name={c.name} />}
      {view === 'chart' && <Chart symbol={symbol} />}
      {view === 'peers' && <Peers c={c} />}
      </div>
    </article>
  )
}

export function Header({ c }: { c: CompanyView }) {
  const live = useLive([c.symbol]).get(c.symbol.toUpperCase())
  // While NSE is open the price is live; otherwise the last end-of-day close.
  const q = c.quote && live ? { ...c.quote, close: live.price, prevClose: live.prevClose ?? c.quote.prevClose, date: live.time.slice(0, 10) } : c.quote
  const change = q?.prevClose ? q.close - q.prevClose : null
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
      <div className="min-w-0">
        <h2 id="company-name" className="wide text-[24px] leading-tight font-semibold">
          {c.name}
        </h2>
        <div className="text-[14px] text-ink-muted">
          {c.symbol}
          {c.industry ? ` · ${c.industry}` : ''}
          {c.held && (
            <span className="text-stamp">
              {' '}
              · {units(c.held.quantity)} shares held by {c.held.people.join(' and ')} ({lakhCrore(c.held.valueInr)})
            </span>
          )}
        </div>
      </div>
      {q && (
        <div className="flex items-end gap-6">
          <div className="text-right">
            <div className="wide num text-[28px] leading-none font-semibold">
              <FlashNum value={q.close} text={money(q.close, 'INR', 2)} />
            </div>
            <div className={`num text-[14px] ${toneClass(change)}`}>
              {change === null ? '' : `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)} (${percent(q.prevClose ? q.close / q.prevClose - 1 : null)})`}{' '}
              <span className="text-ink-muted">{live ? `live, ${new Date(live.time).toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' })}` : `on ${shortDate(q.date)}`}</span>
            </div>
          </div>
          {q.low52 !== null && q.high52 !== null && q.high52 > q.low52 && <Range52 low={q.low52} high={q.high52} close={q.close} />}
        </div>
      )}
    </header>
  )
}

function Range52({ low, high, close }: { low: number; high: number; close: number }) {
  const at = Math.min(1, Math.max(0, (close - low) / (high - low)))
  return (
    <figure className="w-44" aria-label={`52-week range ${money(low, 'INR', 0)} to ${money(high, 'INR', 0)}`}>
      <figcaption className="mb-1 text-[12px] text-ink-muted">52-week range</figcaption>
      <div className="relative h-1.5 rounded-full bg-rule">
        <span
          aria-hidden
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sheet bg-stamp"
          style={{ left: `${at * 100}%` }}
        />
      </div>
      <div className="num mt-1 flex justify-between text-[12px] text-ink-muted">
        <span>{compactMoney(low)}</span>
        <span>{compactMoney(high)}</span>
      </div>
    </figure>
  )
}

export function ResultsNote({ c }: { c: CompanyView }) {
  const r = c.results
  if (r.state === 'DONE') return null
  return (
    <p role="status" className="mb-5 rounded-md border border-rule bg-sheet px-3 py-2 text-[14px] text-ink-muted">
      {r.state === 'WAITING'
        ? `Fetching ${c.name}'s results from NSE, one file at a time. ${r.stored ? `${r.stored} quarters in so far.` : 'This takes about half a minute.'}`
        : r.error
          ? `NSE didn't send ${c.name}'s list of results (${r.error}). Opening the page again retries.`
          : `NSE has no results files for ${c.name}. Newly listed companies and some small ones file only as PDFs.`}
    </p>
  )
}

// ---------------- the left column: price and scorecard ----------------

/** The company, its price (live while NSE is open) and where it sits in its year's range. */
function PriceCard({ c }: { c: CompanyView }) {
  const live = useLive([c.symbol]).get(c.symbol.toUpperCase())
  const q = c.quote && live ? { ...c.quote, close: live.price, prevClose: live.prevClose ?? c.quote.prevClose, date: live.time.slice(0, 10) } : c.quote
  const change = q?.prevClose ? q.close - q.prevClose : null
  return (
    <section className="rounded-xl border border-rule p-5">
      <h2 id="company-name" className="text-[19px] leading-snug font-semibold text-ink">
        {c.name}
      </h2>
      <div className="mt-0.5 text-[13px] text-ink-muted">
        {c.symbol} · NSE{c.industry ? ` · ${c.industry}` : ''}
      </div>
      {q && (
        <>
          <div className="num mt-4 text-left text-[26px] leading-none font-semibold">
            <FlashNum value={q.close} text={money(q.close, 'INR', 2)} />
          </div>
          <div className={`num mt-1 text-left text-[13.5px] ${toneClass(change)}`}>
            {change === null ? '' : `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)} (${percent(q.prevClose ? q.close / q.prevClose - 1 : null)})`}{' '}
            <span className="text-ink-muted">
              {live ? `live, ${new Date(live.time).toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' })}` : `on ${shortDate(q.date)}`}
            </span>
          </div>
          {q.low52 !== null && q.high52 !== null && q.high52 > q.low52 && (
            <div className="mt-4">
              <Range52 low={q.low52} high={q.high52} close={q.close} />
            </div>
          )}
        </>
      )}
      {c.held && (
        <p className="mt-4 rounded-lg bg-stamp-wash px-3 py-2 text-[13px] text-stamp">
          {units(c.held.quantity)} shares held by {c.held.people.join(' and ')}, worth {lakhCrore(c.held.valueInr)}
        </p>
      )}
    </section>
  )
}

/** Performance, valuation, growth, profitability, momentum and red flags, each in a line of plain words. */
function Scorecard({ c }: { c: CompanyView }) {
  const data = useScreenData()
  const rows = data.data?.rows ?? []
  const row = rows.find((r) => r.symbol === c.symbol)
  if (!row) return null
  return (
    <ScoreList id="scorecard" cards={scorecard(row, rows, c.bank)} note="Against its industry and the market, from NSE results and prices. A description, not advice to buy or sell." />
  )
}

// ---------------- overview ----------------

/** Three cards: its industry, its size among listed companies, and how much its price swings. */
function InfoCards({ c }: { c: CompanyView }) {
  const data = useScreenData()
  const rows = data.data?.rows ?? []
  const row = rows.find((r) => r.symbol === c.symbol)
  if (!row) return null
  const ctx = stockContext(row, rows)
  const card = 'rounded-xl border border-rule p-4'
  return (
    <div className="mb-6 grid gap-4 @3xl:grid-cols-3">
      <div className={card}>
        <div className="text-[14px] font-semibold">{c.industry ?? 'Industry not given'}</div>
        <p className="mt-1 text-[13px] text-ink-muted">{c.industry ? `${ctx.peers} listed companies in this industry.` : 'NSE gives industries for Nifty 500 companies.'}</p>
      </div>
      <div className={card}>
        <div className="text-[14px] font-semibold">{ctx.capBand ?? 'Size not known'}</div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {ctx.capRank ? `Market cap of ${bigMoney(row.mcap)}, ranked ${ctx.capRank.toLocaleString('en-IN')} among listed companies.` : 'No market cap yet.'}
        </p>
      </div>
      <div className={card}>
        <div className="text-[14px] font-semibold">
          {ctx.volatilityPercentile === null ? 'Risk not known' : ctx.volatilityPercentile >= 0.67 ? 'High risk' : ctx.volatilityPercentile <= 0.33 ? 'Low risk' : 'Moderate risk'}
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {row.volatility === null || ctx.volatilityPercentile === null
            ? 'Needs a year of prices.'
            : `Price swings ${pct(row.volatility, 0)} a year; steadier than ${Math.round((1 - ctx.volatilityPercentile) * 100)}% of listed stocks.`}
        </p>
      </div>
    </div>
  )
}

/** The headline figures, with the industry's middle company for comparison. */
function KeyMetrics({ c }: { c: CompanyView }) {
  const data = useScreenData()
  const rows = data.data?.rows ?? []
  const row = rows.find((r) => r.symbol === c.symbol)
  const ctx = row ? stockContext(row, rows) : null
  const items: [string, string][] = [
    ['P/E (last 4 quarters)', times(c.metrics.pe)],
    ['Price to book', times(c.metrics.pb)],
    ['Dividend yield', pct(row?.dividendYield ?? null, 2)],
    ['Industry P/E', times(ctx?.industryPe ?? null)],
    ['Industry price to book', times(ctx?.industryPb ?? null)]
  ]
  return (
    <section className="mb-6">
      <h3 className="mb-3 text-[16px] font-semibold">Key figures</h3>
      <dl className="grid grid-cols-2 gap-4 @2xl:grid-cols-3 @4xl:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[12.5px] text-ink-muted">{label}</dt>
            <dd className="num mt-0.5 text-left text-[17px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** A few companies like it, as cards (the full table is under Peers). */
function SimilarStocks({ c, onPeers }: { c: CompanyView; onPeers: () => void }) {
  const data = useScreenData()
  const open = useOpenSymbol()
  if (!c.industry) return null
  const peers = (data.data?.rows ?? [])
    .filter((r) => r.industry === c.industry && r.symbol !== c.symbol)
    .sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
    .slice(0, 4)
  if (!peers.length) return null
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[16px] font-semibold">Similar stocks</h3>
        <button type="button" onClick={onPeers} className="text-[13.5px] text-stamp hover:underline">
          Compare with all peers
        </button>
      </div>
      <ul className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-4">
        {peers.map((p) => (
          <li key={p.symbol}>
            <button type="button" onClick={() => open(p.symbol)} className="block w-full rounded-xl border border-rule p-4 text-left hover:border-rule-strong hover:bg-sheet">
              <div className="truncate text-[14px] font-semibold">{p.name}</div>
              <div className="text-[12px] text-ink-muted">{p.symbol}</div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <dt className="text-ink-muted">P/E</dt>
                  <dd className="font-semibold">{times(p.pe)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">1 year</dt>
                  <dd className={`font-semibold ${toneClass(p.ret1y)}`}>{pct(p.ret1y, 1)}</dd>
                </div>
              </dl>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Overview({ c, onPeers }: { c: CompanyView; onPeers?: () => void }) {
  const m = c.metrics
  const quarters = [...c.quarters].reverse().slice(-12)
  const rev = (f: Flow) => f.revenue ?? f.totalIncome
  const profit = (f: Flow) => f.ownersProfit ?? f.netProfit
  const [chart, setChart] = useStoredChart('chart:company-overview')
  return (
    <>
      <div className="mb-6">
        <StockChart symbol={c.symbol} settings={chart} onSettings={setChart} height={300} />
      </div>
      <InfoCards c={c} />
      <KeyMetrics c={c} />
      <h3 className="mb-2 text-[16px] font-semibold">More figures</h3>
      <Ratios m={m} bank={c.bank} />
      {quarters.length > 1 && (
        <div className="mt-8 grid gap-8 @5xl:grid-cols-2">
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">{c.bank ? 'Total income' : 'Sales'} by quarter</h3>
            <Columns
              points={quarters.map((q) => ({ key: q.periodEnd, label: quarterLabel(q.periodEnd), value: rev(q) ?? 0 }))}
              format={(v) => `₹${crore(v)} Cr`}
              axisFormat={axisCrore}
              label={`${c.name} quarterly ${c.bank ? 'income' : 'sales'}`}
              seriesLabel={c.bank ? 'Income' : 'Sales'}
            />
          </section>
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Profit by quarter</h3>
            <Columns
              points={quarters.map((q) => ({ key: q.periodEnd, label: quarterLabel(q.periodEnd), value: profit(q) ?? 0 }))}
              format={(v) => `₹${crore(v)} Cr`}
              axisFormat={axisCrore}
              label={`${c.name} quarterly profit`}
              seriesLabel="Profit"
            />
          </section>
        </div>
      )}
      {m.piotroski && (
        <section className="mt-8 max-w-xl">
          <h3 className="text-[15px] font-semibold">
            Piotroski score {m.piotroski.score} of 9 <span className="font-normal text-ink-muted">({m.piotroski.year} against the year before)</span>
          </h3>
          <p className="mb-2 text-[13.5px] text-ink-muted">Nine yes-or-no checks of financial strength; 7 or more is usually read as strong, 3 or less as weak.</p>
          <ul className="grid gap-x-6 gap-y-0.5 text-[14px] @2xl:grid-cols-2">
            {m.piotroski.tests.map((t) => (
              <li key={t.label} className="flex gap-2">
                <span aria-hidden className={t.pass ? 'text-gain' : 'text-loss'}>
                  {t.pass ? '✓' : '✗'}
                </span>
                <span className={t.pass ? '' : 'text-ink-muted'}>
                  {t.label}
                  <span className="sr-only">{t.pass ? ': yes' : ': no'}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {onPeers && <SimilarStocks c={c} onPeers={onPeers} />}
    </>
  )
}

function Ratios({ m, bank }: { m: Metrics; bank: boolean }) {
  const items: [string, string, string?][] = [
    ['Market cap', bigMoney(m.mcap)],
    ['P/E', times(m.pe), 'Price against the last four quarters’ profit'],
    ['Price to book', times(m.pb)],
    ['Book value a share', m.bookValue === null ? '—' : money(m.bookValue, 'INR', 0)],
    ['ROE', pct(m.roe), 'Last full year’s profit against shareholders’ money'],
    ...(bank ? [] : ([['ROCE', pct(m.roce), 'Profit before interest and tax against all capital used']] as [string, string, string][])),
    [`${bank ? 'Income' : 'Sales'}, last 4 quarters`, bigMoney(m.ttmRevenue)],
    ['Profit, last 4 quarters', bigMoney(m.ttmProfit)],
    ['EPS, last 4 quarters', m.epsTtm === null ? '—' : money(m.epsTtm, 'INR', 2)],
    [bank ? 'Margin before provisions' : 'Operating margin', pct(m.opm)],
    [`${bank ? 'Income' : 'Sales'} growth, 3 years`, pct(m.salesGrowth3y), 'A year, compounded'],
    ['Profit growth, 3 years', pct(m.profitGrowth3y), 'A year, compounded'],
    ...(bank
      ? []
      : ([
          ['Debt to equity', m.debtToEquity === null ? '—' : m.debtToEquity.toFixed(2)],
          ['Current ratio', m.currentRatio === null ? '—' : m.currentRatio.toFixed(2)],
          ['Interest cover', times(m.interestCover), 'Times over, last 4 quarters']
        ] as [string, string, string][]))
  ]
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-6">
      {items.map(([label, value, hint]) => (
        <div key={label} title={hint} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
          <dt className="truncate text-[13px] text-ink-muted">{label}</dt>
          <dd className={'num shrink-0 text-right text-[15px] font-semibold ' + (value === '—' ? 'text-ink-muted' : 'text-ink')}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------- financials ----------------

type Line<T> = { label: string; get: (r: T) => number | null | undefined; kind?: 'pct' | 'rs'; strong?: boolean }

const opCosts = (f: Flow) => (f.revenue !== undefined && f.operatingProfit !== undefined ? f.revenue - f.operatingProfit : undefined)
const PL: Line<Flow>[] = [
  { label: 'Sales', get: (f) => f.revenue, strong: true },
  { label: 'Operating costs', get: opCosts },
  { label: 'Operating profit', get: (f) => f.operatingProfit, strong: true },
  { label: 'Operating margin', get: (f) => (f.revenue ? (f.operatingProfit ?? NaN) / f.revenue : null), kind: 'pct' },
  { label: 'Other income', get: (f) => f.otherIncome },
  { label: 'Interest', get: (f) => f.finance },
  { label: 'Depreciation', get: (f) => f.depreciation },
  { label: 'One-off items', get: (f) => f.exceptional },
  { label: 'Profit before tax', get: (f) => f.pbt },
  { label: 'Tax rate', get: (f) => (f.pbt ? (f.tax ?? NaN) / f.pbt : null), kind: 'pct' },
  { label: 'Net profit', get: (f) => f.ownersProfit ?? f.netProfit, strong: true },
  { label: 'EPS (₹)', get: (f) => f.eps, kind: 'rs' }
]
const BANK_PL: Line<Flow>[] = [
  { label: 'Total income', get: (f) => f.totalIncome ?? f.revenue, strong: true },
  { label: 'Interest earned', get: (f) => f.interestEarned },
  { label: 'Other income', get: (f) => f.otherIncome },
  { label: 'Interest paid', get: (f) => f.interestExpended },
  { label: 'Operating costs', get: (f) => (f.expenses !== undefined ? f.expenses - (f.interestExpended ?? 0) : undefined) },
  { label: 'Profit before provisions', get: (f) => f.operatingProfit, strong: true },
  { label: 'Provisions', get: (f) => f.provisions },
  { label: 'One-off items', get: (f) => f.exceptional },
  { label: 'Profit before tax', get: (f) => f.pbt },
  { label: 'Tax rate', get: (f) => (f.pbt ? (f.tax ?? NaN) / f.pbt : null), kind: 'pct' },
  { label: 'Net profit', get: (f) => f.ownersProfit ?? f.netProfit, strong: true },
  { label: 'EPS (₹)', get: (f) => f.eps, kind: 'rs' }
]
const BS: Line<Balance>[] = [
  { label: "Shareholders' equity", get: (b) => b.equity, strong: true },
  { label: 'Borrowings', get: (b) => b.borrowings },
  { label: 'Trade payables', get: (b) => b.payables },
  { label: 'Current liabilities', get: (b) => b.currentLiabilities },
  { label: 'Total assets', get: (b) => b.assets, strong: true },
  { label: 'Fixed assets', get: (b) => b.fixedAssets },
  { label: 'Investments', get: (b) => b.investments },
  { label: 'Inventories', get: (b) => b.inventories },
  { label: 'Receivables', get: (b) => b.receivables },
  { label: 'Cash and bank', get: (b) => b.cash }
]
const BANK_BS: Line<Balance>[] = [
  { label: "Shareholders' equity", get: (b) => b.equity, strong: true },
  { label: 'Deposits', get: (b) => b.deposits },
  { label: 'Borrowings', get: (b) => b.borrowings },
  { label: 'Total assets', get: (b) => b.assets, strong: true },
  { label: 'Advances (loans given)', get: (b) => b.advances },
  { label: 'Investments', get: (b) => b.investments },
  { label: 'Cash and bank', get: (b) => b.cash }
]
const CF: Line<Flow>[] = [
  { label: 'Cash from operations', get: (f) => f.cfo, strong: true },
  { label: 'Cash from investing', get: (f) => f.cfi },
  { label: 'Cash from financing', get: (f) => f.cff },
  { label: 'Spent on fixed assets', get: (f) => f.capex },
  { label: 'Free cash flow', get: (f) => (f.cfo !== undefined ? f.cfo - (f.capex ?? 0) : undefined), strong: true },
  { label: 'Dividends paid', get: (f) => f.dividendsPaid }
]

type Statement = 'quarters' | 'years' | 'balance' | 'cash'
const STATEMENTS: { key: Statement; label: string }[] = [
  { key: 'quarters', label: 'Quarterly results' },
  { key: 'years', label: 'Yearly results' },
  { key: 'balance', label: 'Balance sheet' },
  { key: 'cash', label: 'Cash flow' }
]

export function Financials({ c }: { c: CompanyView }) {
  const [which, setWhich] = useState<Statement>('quarters')
  if (c.quarters.length === 0 && c.balances.length === 0)
    return <p className="text-ink-muted">No results stored for this company yet.</p>
  const pl = c.bank ? BANK_PL : PL
  const table =
    which === 'quarters' ? (
      <Table rows={pl} cols={[...c.quarters].reverse()} head={(q) => quarterLabel(q.periodEnd)} />
    ) : which === 'years' ? (
      <Table rows={pl} cols={[...c.years].reverse()} head={(y) => fyLabel(y.periodEnd)} />
    ) : which === 'balance' ? (
      <Table rows={c.bank ? BANK_BS : BS} cols={[...c.balances].reverse()} head={(b) => quarterLabel(b.periodEnd)} />
    ) : (
      <Table rows={CF} cols={[...c.years].reverse().filter((y) => y.cfo !== undefined)} head={(y) => fyLabel(y.periodEnd)} />
    )
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Statement" className="flex gap-1">
          {STATEMENTS.map((s) => (
            <button
              key={s.key}
              role="radio"
              aria-checked={which === s.key}
              onClick={() => setWhich(s.key)}
              className={
                'rounded px-2.5 py-0.5 text-[13.5px] ' +
                (which === s.key ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet')
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-ink-muted">
          ₹ crore, {c.basis === 'S' ? 'standalone' : 'consolidated'}
          {which === 'balance' ? ', at each half-year end' : ''}
        </span>
      </div>
      {table}
    </>
  )
}

function Table<T extends { periodEnd: string; basis: Basis }>({
  rows,
  cols,
  head
}: {
  rows: Line<T>[]
  cols: T[]
  head: (c: T) => string
}) {
  if (cols.length === 0) return <p className="text-ink-muted">Not filed for the years stored.</p>
  const shown = rows.filter((r) => cols.some((c) => r.get(c) !== undefined && r.get(c) !== null))
  const fmt = (r: Line<T>, v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? '—' : r.kind === 'pct' ? pct(v) : r.kind === 'rs' ? v.toFixed(2) : crore(v)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong text-[13px] text-ink-muted">
            <th scope="col" className="sticky left-0 bg-paper py-1.5 pr-4 text-left font-medium">
              <span className="sr-only">Item</span>
            </th>
            {cols.map((c) => (
              <th key={c.periodEnd} scope="col" className="px-2.5 text-right font-medium whitespace-nowrap">
                {head(c)}
                {c.basis !== cols[cols.length - 1].basis && <sup title="Standalone figures for this period">s</sup>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.label} className="border-b border-rule">
              <th scope="row" className={'sticky left-0 bg-paper py-1.5 pr-4 text-left whitespace-nowrap ' + (r.strong ? 'font-semibold' : 'font-normal text-ink-muted')}>
                {r.label}
              </th>
              {cols.map((c) => {
                const v = r.get(c)
                return (
                  <td key={c.periodEnd} className={'num px-2.5 ' + (r.strong ? 'font-semibold ' : '') + (typeof v === 'number' && v < 0 ? 'text-loss' : '')}>
                    {fmt(r, v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------- price chart ----------------

function Chart({ symbol }: { symbol: string }) {
  const [settings, setSettings] = useStoredChart('chart:company')
  return <StockChart symbol={symbol} settings={settings} onSettings={setSettings} height={480} />
}

// ---------------- peers ----------------

/** Companies in the same industry (NSE's classification for the Nifty 500), largest first. */
export function Peers({ c }: { c: CompanyView }) {
  const data = useScreenData()
  if (!c.industry) return <p className="text-ink-muted">NSE gives an industry for Nifty 500 companies only, so there is no peer group for {c.name}.</p>
  if (data.isLoading) return <p className="text-ink-muted">Finding companies in {c.industry}…</p>
  if (data.error) return <ErrorNote error={data.error} />
  const peers = (data.data?.rows ?? []).filter((r) => r.industry === c.industry).sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0))
  return (
    <>
      <p className="mb-2 text-[13.5px] text-ink-muted">
        {peers.length} companies in {c.industry}, largest first. Click a heading to sort.
      </p>
      <ScreenTable rows={peers.slice(0, 40)} columns={[...BASE_COLUMNS, 'opm', 'pb', 'dividendYield']} highlight={c.symbol} initialSort={null} label={`${c.industry} peers`} />
    </>
  )
}
