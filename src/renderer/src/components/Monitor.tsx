import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { IndexLevel, ScreenRow, WorldSeries } from '@shared/screener'
import { ErrorNote } from './Shell'
import { Treemap, Sparkline } from './viz'
import { useMarketMonitor, useWorldBoard } from '../lib/api'
import { bigMoney, money, percent, shortDate, toneClass } from '../lib/format'

/** A bordered terminal panel with an amber title line. */
export function Panel({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-sm border border-rule bg-sheet ${className}`} aria-label={title}>
      <h2 className="flex items-baseline justify-between gap-3 border-b border-rule px-3 py-1.5 text-[13px] font-semibold text-stamp">
        {title}
        {note && <span className="truncate text-[12px] font-normal text-ink-muted">{note}</span>}
      </h2>
      <div className="p-3">{children}</div>
    </section>
  )
}

const level = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: v >= 1000 ? 0 : 2, minimumFractionDigits: v >= 1000 ? 0 : 2 })

export function Monitor() {
  const m = useMarketMonitor()
  const d = m.data
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={m.error} />
      <Panel title="NSE indices" note={d?.date ? `close of ${shortDate(d.date)}` : 'arrive with the first daily file'}>
        {d && d.indices.length > 0 ? <Indices list={d.indices} /> : <Empty>Index levels come with NSE’s end-of-day file, once the download is running.</Empty>}
      </Panel>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="World markets" note="six months, Yahoo Finance">
          <World />
        </Panel>
        <Panel title="Market breadth and sectors" note="Nifty 500 industries, sized by market cap">
          {d && d.sectors.length > 0 ? (
            <>
              <Breadth b={d.breadth} />
              <Treemap
                items={d.sectors.map((s) => ({ key: s.name, name: s.name, value: s.mcap, gainPct: s.change }))}
                format={(v) => bigMoney(v)}
                label="Sectors by market cap, coloured by the day's move"
                height={260}
                full={0.03}
                changeLabel="today"
                sizeLabel="market cap"
              />
            </>
          ) : (
            <Empty>Sector moves show once NSE’s daily prices are in.</Empty>
          )}
        </Panel>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Top gainers" note="₹1,000 Cr and up">
          <Movers rows={d?.gainers ?? []} />
        </Panel>
        <Panel title="Top losers" note="₹1,000 Cr and up">
          <Movers rows={d?.losers ?? []} />
        </Panel>
        <Panel title="Your stocks" note="held by the family">
          {d && d.yours.length === 0 ? <Empty>No Indian stocks held yet.</Empty> : <Movers rows={d?.yours ?? []} withPe />}
        </Panel>
      </div>
      <p className="max-w-[80ch] text-[12.5px] text-ink-muted">
        Prices, market caps and P/E come from NSE’s end-of-day files; results from the XBRL files companies file with NSE; world markets from
        Yahoo Finance. NSE’s terms of use don’t allow automated collection, so the download goes slowly, one file at a time, for your own use on
        this computer, and nothing is shared. Pause it above at any time.
      </p>
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-[13.5px] text-ink-muted">{children}</p>

function Indices({ list }: { list: IndexLevel[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {list.map((i) => {
        const ch = i.prevClose ? i.close / i.prevClose - 1 : null
        return (
          <li key={i.name} className="flex items-baseline justify-between gap-2 border-b border-rule pb-1">
            <span className="truncate text-[13px] text-ink-muted" title={i.name}>
              {i.name}
            </span>
            <span className="text-right">
              <span className="num block text-[14px] text-ink">{level(i.close)}</span>
              <span className={`num block text-[12px] ${toneClass(ch)}`}>{percent(ch)}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function World() {
  const w = useWorldBoard()
  if (w.isLoading) return <Empty>Fetching world markets…</Empty>
  if (w.error) return <ErrorNote error={w.error} />
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {(w.data ?? []).map((s) => (
        <WorldTile key={s.key} s={s} />
      ))}
    </ul>
  )
}

function WorldTile({ s }: { s: WorldSeries }) {
  const pts = s.points
  const last = pts[pts.length - 1].close
  const prev = pts[pts.length - 2]?.close
  const day = prev ? last / prev - 1 : null
  const half = last / pts[0].close - 1
  return (
    <li className="min-w-0 border-b border-rule pb-2">
      <div className="truncate text-[12.5px] text-ink-muted">{s.label}</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-[15px] text-ink">{level(last)}</span>
        <span className={`num text-[12px] ${toneClass(day)}`}>{percent(day)}</span>
      </div>
      <Sparkline values={pts.map((p) => p.close)} width={150} height={38} />
      <div className="text-[11.5px] text-ink-muted">
        <span className={toneClass(half)}>{percent(half)}</span> in 6 months
      </div>
    </li>
  )
}

function Breadth({ b }: { b: { up: number; down: number; flat: number; atHigh: number; atLow: number } }) {
  const total = b.up + b.down + b.flat || 1
  return (
    <div className="mb-3">
      <div className="flex h-2 overflow-hidden rounded-sm" aria-hidden>
        <span className="bg-gain" style={{ width: `${(b.up / total) * 100}%` }} />
        <span className="bg-rule-strong" style={{ width: `${(b.flat / total) * 100}%` }} />
        <span className="bg-loss" style={{ width: `${(b.down / total) * 100}%` }} />
      </div>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        <span className="text-gain">{b.up.toLocaleString('en-IN')} up</span>, <span className="text-loss">{b.down.toLocaleString('en-IN')} down</span>,{' '}
        {b.flat.toLocaleString('en-IN')} unchanged. {b.atHigh} at a 52-week high, {b.atLow} at a 52-week low.
      </p>
    </div>
  )
}

function Movers({ rows, withPe = false }: { rows: ScreenRow[]; withPe?: boolean }) {
  const navigate = useNavigate()
  if (rows.length === 0) return <Empty>Shows once NSE’s daily prices are in.</Empty>
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {rows.slice(0, 12).map((r) => (
          <tr
            key={r.symbol}
            tabIndex={0}
            onClick={() => navigate(`/research/${encodeURIComponent(r.symbol)}`)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/research/${encodeURIComponent(r.symbol)}`)}
            className="cursor-pointer border-b border-rule last:border-0 hover:bg-paper focus:bg-paper focus:outline-none"
          >
            <th scope="row" className="max-w-[150px] py-1 pr-2 text-left font-normal">
              <span className="font-semibold text-stamp">{r.symbol}</span>
              <div className="truncate text-[11.5px] text-ink-muted">{r.name}</div>
            </th>
            <td className="num px-1">{r.close === null ? '—' : money(r.close, 'INR', 2)}</td>
            {withPe && <td className="num px-1 text-ink-muted">{r.pe === null ? '—' : `${r.pe.toFixed(1)}×`}</td>}
            <td className={`num pl-1 ${toneClass(r.change)}`}>{percent(r.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
