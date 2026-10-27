import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ErrorNote } from '../Shell'
import { StockChart, DEFAULT_CHART, type ChartSettings } from '../StockChart'
import { Financials, Overview, Peers, ResultsNote } from '../Company'
import { Ownership } from '../Ownership'
import { Valuation } from '../Valuation'
import { Breadth, Empty, Indices, Movers, World as WorldMarkets } from '../Monitor'
import { Screener } from '../Screener'
import { fieldOf, fieldText } from '../ScreenTable'
import { Sparkline, Treemap } from '../viz'
import {
  exportExcel,
  useCompany,
  useDeleteWatchlist,
  useMarketMonitor,
  useNote,
  useQuotes,
  useResearchHome,
  useSaveNote,
  useSaveWatchlist,
  useScreenData,
  useWatchlists
} from '../../lib/api'
import { bigMoney, money, percent, toneClass } from '../../lib/format'
import { LINK_GROUPS, OpenSymbolProvider, useLinks, useOpenSymbol, type LinkGroup } from '../../lib/links'
import type { FieldKey } from '@shared/screener'

// Each kind of panel a research workspace can hold. Panels share symbols through link groups:
// a panel on Amber shows (or sets) whatever Amber is on.

export interface PanelParams {
  /** The link group followed or driven; null to keep the panel's own symbol. */
  group?: LinkGroup | null
  symbol?: string
  view?: 'overview' | 'financials' | 'valuation' | 'ownership' | 'peers'
  chart?: ChartSettings
  /** Watchlist shown: a saved list's id, or the family's holdings. */
  list?: number | 'family'
  movers?: 'gainers' | 'losers'
  symbols?: string[]
}
type Props = IDockviewPanelProps<PanelParams>

/** The symbol a panel is on, and how to change it. */
function usePanelSymbol(p: Props): [string, (s: string) => void] {
  const links = useLinks()
  const group = p.params.group ?? null
  const symbol = group ? links.symbols[group] : (p.params.symbol ?? 'RELIANCE')
  const set = (s: string) => {
    const up = s.trim().toUpperCase()
    if (!up) return
    if (group) links.set(group, up)
    else p.api.updateParameters({ ...p.params, symbol: up })
  }
  return [symbol, set]
}

/** The thin bar along the top of a panel: its link colour, its symbol, and anything else it needs. */
function Bar({ p, showSymbol = true, children }: { p: Props; showSymbol?: boolean; children?: ReactNode }) {
  const [symbol, setSymbol] = usePanelSymbol(p)
  const [text, setText] = useState<string | null>(null)
  const group = p.params.group ?? null
  const next = () => {
    const order: (LinkGroup | null)[] = ['A', 'B', 'C', 'D', null]
    const g = order[(order.indexOf(group) + 1) % order.length]
    p.api.updateParameters({ ...p.params, group: g, symbol: g ? p.params.symbol : symbol })
  }
  const colour = LINK_GROUPS.find((g) => g.key === group)
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-rule px-2 text-[12px]">
      <button
        type="button"
        onClick={next}
        title={colour ? `Linked to ${colour.label}: click to change` : 'Not linked: click to link'}
        aria-label={colour ? `Link group ${colour.label}` : 'Not linked'}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm border text-[9.5px] font-bold text-black"
        style={colour ? { background: colour.colour, borderColor: colour.colour } : { borderColor: 'var(--rule-strong)' }}
      >
        {group ?? ''}
      </button>
      {showSymbol &&
        (text === null ? (
          <button type="button" onClick={() => setText(symbol)} className="font-semibold text-stamp hover:underline" title="Change the symbol">
            {symbol}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSymbol(text)
              setText(null)
            }}
          >
            <input
              autoFocus
              aria-label="Symbol"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setText(null)}
              className="w-28 rounded-sm border border-stamp bg-transparent px-1 py-0 text-[12px] uppercase focus:outline-none"
            />
          </form>
        ))}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

/** Clicking a stock inside a "driver" panel (screener, watchlist, movers) moves its link group. */
function Drives({ p, children }: { p: Props; children: ReactNode }) {
  const [, setSymbol] = usePanelSymbol(p)
  return <OpenSymbolProvider value={setSymbol}>{children}</OpenSymbolProvider>
}

const Body = ({ children, pad = true }: { children: ReactNode; pad?: boolean }) => (
  <div className="@container relative min-h-0 flex-1">
    <div className={'absolute inset-0 overflow-auto ' + (pad ? 'p-2.5' : '')}>{children}</div>
  </div>
)
const Frame = ({ children }: { children: ReactNode }) => <div className="flex h-full flex-col bg-paper text-[13.5px]">{children}</div>

// ---------------- chart ----------------

function ChartPanel(p: Props) {
  const [symbol] = usePanelSymbol(p)
  return (
    <Frame>
      <Bar p={p} />
      <div className="min-h-0 flex-1 p-2">
        <StockChart
          compact
          symbol={symbol}
          settings={p.params.chart ?? DEFAULT_CHART}
          onSettings={(chart) => p.api.updateParameters({ ...p.params, chart })}
        />
      </div>
    </Frame>
  )
}

// ---------------- company ----------------

const COMPANY_VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'financials', label: 'Financials' },
  { key: 'valuation', label: 'Valuation' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'peers', label: 'Peers' }
] as const

function CompanyPanel(p: Props) {
  const [symbol] = usePanelSymbol(p)
  const q = useCompany(symbol, null)
  const c = q.data
  const view = p.params.view ?? 'overview'
  // The tab says which part of the company it shows.
  useEffect(() => {
    p.api.setTitle(COMPANY_VIEWS.find((v) => v.key === view)?.label ?? 'Company')
  }, [view, p.api])
  return (
    <Frame>
      <Bar p={p}>
        <div role="radiogroup" aria-label="Company view" className="flex gap-0.5">
          {COMPANY_VIEWS.map((v) => (
            <button
              key={v.key}
              role="radio"
              aria-checked={view === v.key}
              onClick={() => p.api.updateParameters({ ...p.params, view: v.key })}
              className={'rounded px-1.5 ' + (view === v.key ? 'bg-stamp-wash text-stamp' : 'text-ink-muted hover:text-ink')}
            >
              {v.label}
            </button>
          ))}
        </div>
      </Bar>
      <Body>
        {q.isLoading && <Empty>Opening {symbol}…</Empty>}
        <ErrorNote error={q.error} />
        {q.data === null && <Empty>{symbol} isn’t on NSE’s list of companies. Indices and other symbols work in a chart panel.</Empty>}
        {c && (
          <>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 className="wide text-[16px] font-semibold">{c.name}</h3>
              {c.quote && (
                <span className="num text-[14px]">
                  {money(c.quote.close, 'INR', 2)}{' '}
                  <span className={toneClass(c.quote.prevClose ? c.quote.close / c.quote.prevClose - 1 : null)}>
                    {percent(c.quote.prevClose ? c.quote.close / c.quote.prevClose - 1 : null)}
                  </span>
                </span>
              )}
            </div>
            <ResultsNote c={c} />
            {view === 'overview' && <Overview c={c} />}
            {view === 'financials' && <Financials c={c} />}
            {view === 'valuation' && <Valuation c={c} />}
            {view === 'ownership' && <Ownership symbol={c.symbol} name={c.name} />}
            {view === 'peers' && (
              <Drives p={p}>
                <Peers c={c} />
              </Drives>
            )}
          </>
        )}
      </Body>
    </Frame>
  )
}

// ---------------- watchlist ----------------

function WatchlistPanel(p: Props) {
  const lists = useWatchlists()
  const home = useResearchHome()
  const save = useSaveWatchlist()
  const del = useDeleteWatchlist()
  const [current] = usePanelSymbol(p)
  const [adding, setAdding] = useState('')
  const listId = p.params.list ?? 'family'
  const mine = lists.data ?? []
  const list = listId === 'family' ? null : mine.find((l) => l.id === listId)
  const symbols = useMemo(
    () => (listId === 'family' ? (home.data?.yours ?? []).map((r) => r.symbol) : (list?.symbols ?? [])),
    [listId, home.data, list]
  )
  const quotes = useQuotes(symbols)
  const bySymbol = new Map((quotes.data ?? []).map((q) => [q.symbol, q]))
  const setList = (v: string) => {
    if (v === 'new') {
      const name = `List ${mine.length + 1}`
      save.mutate({ name, symbols: [] }, { onSuccess: (id) => p.api.updateParameters({ ...p.params, list: id }) })
    } else p.api.updateParameters({ ...p.params, list: v === 'family' ? 'family' : Number(v) })
  }
  return (
    <Frame>
      <Bar p={p} showSymbol={false}>
        <select
          aria-label="Watchlist"
          value={String(listId)}
          onChange={(e) => setList(e.target.value)}
          className="rounded-sm border border-rule bg-paper px-1 py-0 text-[12px]"
        >
          <option value="family">The family’s stocks</option>
          {mine.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value="new">+ New list</option>
        </select>
        {list && (
          <button
            type="button"
            className="text-ink-muted hover:text-loss"
            onClick={() => {
              if (!confirm(`Delete the list “${list.name}”?`)) return
              del.mutate(list.id)
              p.api.updateParameters({ ...p.params, list: 'family' })
            }}
          >
            Delete
          </button>
        )}
      </Bar>
      <Body pad={false}>
        <Drives p={p}>
          <WatchRows symbols={symbols} quotes={bySymbol} current={current} onRemove={list ? (s) => save.mutate({ ...list, symbols: list.symbols.filter((x) => x !== s) }) : undefined} />
        </Drives>
        {symbols.length === 0 && <p className="p-2.5 text-[12.5px] text-ink-muted">{list ? 'Add a symbol below.' : 'No Indian stocks held yet.'}</p>}
        {quotes.error && <p className="p-2.5 text-[12px] text-warn">Prices didn’t load: {String((quotes.error as Error).message)}</p>}
      </Body>
      {list && (
        <form
          className="border-t border-rule p-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const s = adding.trim().toUpperCase()
            if (s) save.mutate({ ...list, symbols: [...list.symbols, s] })
            setAdding('')
          }}
        >
          <input
            aria-label="Add a symbol"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="+ Add symbol (INFY, ^NSEI)"
            className="w-full rounded-sm border border-rule bg-transparent px-1.5 py-0.5 text-[12.5px] placeholder:text-ink-muted/70 focus:border-stamp focus:outline-none"
          />
        </form>
      )}
    </Frame>
  )
}

function WatchRows({
  symbols,
  quotes,
  current,
  onRemove
}: {
  symbols: string[]
  quotes: Map<string, { price: number; change: number | null; points: number[] }>
  current: string
  onRemove?: (s: string) => void
}) {
  const open = useOpenSymbol()
  return (
    <table className="w-full text-[12.5px]">
      <tbody>
        {symbols.map((s) => {
          const q = quotes.get(s)
          return (
            <tr
              key={s}
              tabIndex={0}
              onClick={() => open(s)}
              onKeyDown={(e) => e.key === 'Enter' && open(s)}
              className={'group cursor-pointer border-b border-rule hover:bg-sheet focus:bg-sheet focus:outline-none ' + (s === current ? 'bg-stamp-wash' : '')}
            >
              <th scope="row" className="py-1 pl-2 text-left font-semibold text-stamp">
                {s}
              </th>
              <td className="px-1">{q && q.points.length > 1 ? <Sparkline values={q.points} width={56} height={18} /> : null}</td>
              <td className="num px-1">{q ? q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
              <td className={`num pr-2 ${toneClass(q?.change ?? null)}`}>{percent(q?.change ?? null)}</td>
              {onRemove && (
                <td className="w-5 pr-1">
                  <button
                    type="button"
                    aria-label={`Remove ${s}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(s)
                    }}
                    className="invisible text-ink-muted group-hover:visible hover:text-loss"
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------- screener and market panels ----------------

function ScreenerPanel(p: Props) {
  return (
    <Frame>
      <Bar p={p} showSymbol={false}>
        <span className="text-ink-muted">Rows set the link colour’s symbol</span>
      </Bar>
      <Body>
        <Drives p={p}>
          <Screener />
        </Drives>
      </Body>
    </Frame>
  )
}

function IndicesPanel() {
  const m = useMarketMonitor()
  return (
    <Frame>
      <Body>{m.data && m.data.indices.length ? <Indices list={m.data.indices} /> : <Empty>Index levels arrive with NSE’s daily file.</Empty>}</Body>
    </Frame>
  )
}

function WorldMarketsPanel() {
  return (
    <Frame>
      <Body>
        <WorldMarkets />
      </Body>
    </Frame>
  )
}

function MoversPanel(p: Props) {
  const m = useMarketMonitor()
  const which = p.params.movers ?? 'gainers'
  return (
    <Frame>
      <Bar p={p} showSymbol={false}>
        <div role="radiogroup" aria-label="Movers" className="flex gap-0.5">
          {(['gainers', 'losers'] as const).map((w) => (
            <button
              key={w}
              role="radio"
              aria-checked={which === w}
              onClick={() => p.api.updateParameters({ ...p.params, movers: w })}
              className={'rounded px-1.5 capitalize ' + (which === w ? 'bg-stamp-wash text-stamp' : 'text-ink-muted hover:text-ink')}
            >
              {w}
            </button>
          ))}
        </div>
      </Bar>
      <Body>
        <Drives p={p}>
          <Movers rows={(which === 'gainers' ? m.data?.gainers : m.data?.losers) ?? []} />
        </Drives>
      </Body>
    </Frame>
  )
}

function SectorsPanel() {
  const m = useMarketMonitor()
  const d = m.data
  return (
    <Frame>
      <Body>
        {d && d.sectors.length > 0 ? (
          <>
            <Breadth b={d.breadth} />
            <Treemap
              items={d.sectors.map((s) => ({ key: s.name, name: s.name, value: s.mcap, gainPct: s.change }))}
              format={(v) => bigMoney(v)}
              label="Sectors by market cap, coloured by the day's move"
              height={240}
              full={0.03}
              changeLabel="today"
              sizeLabel="market cap"
            />
          </>
        ) : (
          <Empty>Sector moves show once NSE’s daily prices are in.</Empty>
        )}
      </Body>
    </Frame>
  )
}

const WorldMap = lazy(() => import('../World'))
function WorldMapPanel() {
  return (
    <Frame>
      <Body>
        <Suspense fallback={<Empty>Loading the map…</Empty>}>
          <WorldMap />
        </Suspense>
      </Body>
    </Frame>
  )
}

// ---------------- notes ----------------

function NotesPanel(p: Props) {
  const [symbol] = usePanelSymbol(p)
  const note = useNote(symbol)
  const save = useSaveNote()
  const [text, setText] = useState('')
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setText(note.data?.text ?? '')
  }, [note.data, symbol])
  // Saved a moment after typing stops, and when the symbol changes.
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      save.mutate({ symbol, text })
      dirty.current = false
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return (
    <Frame>
      <Bar p={p}>
        <span className="text-ink-muted">{save.isPending ? 'Saving…' : note.data ? 'Saved' : ''}</span>
      </Bar>
      <textarea
        aria-label={`Notes on ${symbol}`}
        value={text}
        onChange={(e) => {
          dirty.current = true
          setText(e.target.value)
        }}
        placeholder={`Your notes on ${symbol}: why you hold it, what to watch for, results dates…`}
        className="min-h-0 flex-1 resize-none bg-transparent p-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-muted/60 focus:outline-none"
      />
    </Frame>
  )
}

// ---------------- compare ----------------

const COMPARE_FIELDS: FieldKey[] = ['close', 'change', 'mcap', 'pe', 'pb', 'roe', 'roce', 'opm', 'debtToEquity', 'salesGrowth3y', 'profitGrowth3y', 'dividendYield', 'piotroski', 'ret1y', 'rsRating']

function ComparePanel(p: Props) {
  const [symbol] = usePanelSymbol(p)
  const data = useScreenData()
  const others = (p.params.symbols ?? []).filter((s) => s !== symbol).slice(0, 4)
  const all = [symbol, ...others]
  const rows = new Map((data.data?.rows ?? []).map((r) => [r.symbol, r]))
  const [adding, setAdding] = useState('')
  const setOthers = (list: string[]) => p.api.updateParameters({ ...p.params, symbols: list })
  return (
    <Frame>
      <Bar p={p}>
        {others.length < 4 && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const s = adding.trim().toUpperCase()
              if (s && !all.includes(s)) setOthers([...others, s])
              setAdding('')
            }}
          >
            <input
              aria-label="Add a company to compare"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="+ Compare with…"
              className="w-32 rounded-sm border border-rule bg-transparent px-1 py-0 text-[12px] placeholder:text-ink-muted/70 focus:border-stamp focus:outline-none"
            />
          </form>
        )}
        <button
          type="button"
          className="text-stamp hover:underline"
          onClick={() =>
            void exportExcel(`Compare ${all.join(' ')}`, [
              {
                name: 'Compare',
                rows: [['Figure', ...all], ...COMPARE_FIELDS.map((k) => [fieldOf(k).label, ...all.map((s) => (rows.get(s)?.[k] as number | null | undefined) ?? null)])]
              }
            ])
          }
        >
          Excel
        </button>
      </Bar>
      <Body>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-rule-strong">
              <th className="py-1 text-left font-medium text-ink-muted">Figure</th>
              {all.map((s, i) => (
                <th key={s} className="px-2 text-right font-semibold whitespace-nowrap text-stamp">
                  {s}
                  {i > 0 && (
                    <button type="button" aria-label={`Stop comparing ${s}`} onClick={() => setOthers(others.filter((x) => x !== s))} className="ml-1 text-ink-muted hover:text-loss">
                      ×
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_FIELDS.map((k) => {
              const f = fieldOf(k)
              const vals = all.map((s) => rows.get(s)?.[k] as number | null | undefined)
              const nums = vals.filter((v): v is number => typeof v === 'number')
              const best = nums.length > 1 ? (f.better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null
              return (
                <tr key={k} className="border-b border-rule">
                  <th scope="row" className="py-1 text-left font-normal text-ink-muted" title={f.help}>
                    {f.label}
                  </th>
                  {vals.map((v, i) => (
                    <td key={all[i]} className={'num px-2 ' + (v === best && k !== 'close' && k !== 'mcap' ? 'font-semibold text-stamp' : '')}>
                      {fieldText(f.kind, v)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-ink-muted">Amber marks the best of the row; a figure missing means it isn’t downloaded or filed yet.</p>
        {data.data && others.length > 0 && (
          <div className="mt-3 h-[260px]">
            <StockChart compact symbol={symbol} settings={{ ...DEFAULT_CHART, overlays: [], panes: [], compare: others.slice(0, 3) }} onSettings={() => {}} />
          </div>
        )}
      </Body>
    </Frame>
  )
}

// ---------------- the catalogue ----------------

export const PANELS: Record<string, { title: string; about: string; component: (p: Props) => ReactNode; defaults?: PanelParams }> = {
  chart: { title: 'Chart', about: 'Candles with averages, RSI and MACD', component: ChartPanel, defaults: { group: 'A' } },
  company: { title: 'Company', about: 'Overview, results or peers', component: CompanyPanel, defaults: { group: 'A', view: 'overview' } },
  watchlist: { title: 'Watchlist', about: 'Your lists, with delayed prices', component: WatchlistPanel, defaults: { group: 'A', list: 'family' } },
  screener: { title: 'Screener', about: 'Filter every company', component: ScreenerPanel, defaults: { group: 'A' } },
  compare: { title: 'Compare', about: 'Up to five companies side by side', component: ComparePanel, defaults: { group: 'A', symbols: [] } },
  notes: { title: 'Notes', about: 'Your notes on a company', component: NotesPanel, defaults: { group: 'A' } },
  indices: { title: 'NSE indices', about: 'Index levels from NSE’s daily file', component: IndicesPanel },
  world: { title: 'World markets', about: 'Indices, currency, oil, gold', component: WorldMarketsPanel },
  movers: { title: 'Movers', about: 'Top gainers and losers today', component: MoversPanel, defaults: { group: 'A', movers: 'gainers' } },
  sectors: { title: 'Sectors', about: 'Breadth and the sector heatmap', component: SectorsPanel },
  map: { title: 'World map', about: 'Trade, shipping and economies', component: WorldMapPanel }
}

export const PANEL_COMPONENTS = Object.fromEntries(Object.entries(PANELS).map(([k, v]) => [k, v.component])) as Record<string, (p: Props) => ReactNode>

