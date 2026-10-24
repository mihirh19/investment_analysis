import { useMemo, useState, type ReactNode } from 'react'
import { INSTITUTION, longShare, type FlowsReport, type FoPosition } from '@shared/flows'
import { ErrorNote, PageHeader } from '../components/Shell'
import { FlowBars } from '../components/FlowBars'
import { Button } from '../components/ui'
import { useFlows, useRefreshFlows, useSetFlowsSync } from '../lib/api'
import { shortDate, toneClass } from '../lib/format'
import { useOpenSymbol } from '../lib/links'

// Where the big money is going: foreign (FII/FPI) and domestic (DII) institutions in the cash
// market and in F&O, foreign investors month by month, mutual fund flows, and the big deals.

type View = 'cash' | 'fo' | 'fpi' | 'mf' | 'deals'
const VIEWS: { key: View; label: string }[] = [
  { key: 'cash', label: 'FII & DII' },
  { key: 'fo', label: 'F&O positions' },
  { key: 'fpi', label: 'Foreign investors by month' },
  { key: 'mf', label: 'Mutual funds' },
  { key: 'deals', label: 'Big deals' }
]

const cr = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: digits })}`
const plain = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: digits })
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export function Flows() {
  const q = useFlows()
  const refresh = useRefreshFlows()
  const toggle = useSetFlowsSync()
  const [view, setView] = useState<View>('cash')
  const d = q.data
  const s = d?.status
  return (
    <>
      <PageHeader title="Money flows">
        {s && (
          <span className="text-[12.5px] text-ink-muted" aria-live="polite">
            {!s.enabled ? 'Downloads paused' : s.refreshing ? 'Fetching flows…' : 'Up to date as far as the sources go'}
          </span>
        )}
        {s && (
          <>
            <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={refresh.isPending || !s.enabled} onClick={() => refresh.mutate()}>
              Update now
            </Button>
            <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={toggle.isPending} onClick={() => toggle.mutate(!s.enabled)}>
              {s.enabled ? 'Pause' : 'Resume'}
            </Button>
          </>
        )}
      </PageHeader>
      <ErrorNote error={q.error} />
      {s?.lastError && <p className="mb-3 rounded-sm border border-warn/40 bg-warn-wash px-3 py-1.5 text-[13px]">{s.lastError}. Tried again on the next update.</p>}
      <div role="radiogroup" aria-label="Flows view" className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="radio"
            aria-checked={view === v.key}
            onClick={() => setView(v.key)}
            className={'rounded-sm px-2.5 py-1 text-[13.5px] ' + (view === v.key ? 'bg-stamp font-semibold text-black' : 'text-ink-muted hover:bg-sheet hover:text-ink')}
          >
            {v.label}
          </button>
        ))}
      </div>
      {q.isLoading && <p className="text-ink-muted">Opening the flows…</p>}
      {d && view === 'cash' && <Cash d={d} />}
      {d && view === 'fo' && <Fo d={d} />}
      {d && view === 'fpi' && <Fpi d={d} />}
      {d && view === 'mf' && <Mf d={d} />}
      {d && view === 'deals' && <Deals d={d} />}
      {s && (
        <p className="mt-8 text-[12px] text-ink-muted">
          Sources:{' '}
          {s.sources.map((x, i) => (
            <span key={x.key}>
              {i ? '; ' : ''}
              {x.label}, {x.latest ? `latest ${x.latest.length === 7 ? monthLabel(x.latest) : shortDate(x.latest)}` : 'nothing yet'}
            </span>
          ))}
          . Figures in ₹ crore. The first download takes a few minutes; after that it is a handful of small files a day. This is information about what
          institutions did, not a view on what to buy.
        </p>
      )}
    </>
  )
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: number | null }) {
  return (
    <div className="rounded-sm border border-rule bg-sheet px-3 py-2">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className={`num text-left text-[20px] font-semibold ${tone === undefined ? '' : toneClass(tone)}`}>{value}</div>
      {note && <div className="text-[11.5px] text-ink-muted">{note}</div>}
    </div>
  )
}
const Tiles = ({ children }: { children: ReactNode }) => <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">{children}</div>
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-sm border border-rule bg-sheet px-3 py-3 text-[13.5px] text-ink-muted">{children}</p>
const H = ({ children }: { children: ReactNode }) => <h2 className="mt-6 mb-2 text-[15px] font-semibold text-stamp">{children}</h2>

// ---------------- FII & DII ----------------

function Cash({ d }: { d: FlowsReport }) {
  const days = useMemo(() => {
    const by = new Map<string, { date: string; fii?: (typeof d.cash)[number]; dii?: (typeof d.cash)[number] }>()
    for (const r of d.cash) {
      const cur = by.get(r.date) ?? { date: r.date }
      if (r.category === 'FII') cur.fii = r
      else cur.dii = r
      by.set(r.date, cur)
    }
    return [...by.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [d.cash])
  if (days.length === 0) return <Empty>NSE publishes FII and DII buying and selling each evening for that day only, so the history builds up from the day this screen was first opened. The first day appears after about 6 pm.</Empty>
  const last = days[0]
  const month = last.date.slice(0, 7)
  const sum = (k: 'fii' | 'dii', list = days) => list.reduce((s, x) => s + (x[k]?.net ?? 0), 0)
  const inMonth = days.filter((x) => x.date.startsWith(month))
  return (
    <>
      <Tiles>
        <Tile label={`FII net, ${shortDate(last.date)}`} value={cr(last.fii?.net)} tone={last.fii?.net ?? null} />
        <Tile label={`DII net, ${shortDate(last.date)}`} value={cr(last.dii?.net)} tone={last.dii?.net ?? null} />
        <Tile label={`FII net, ${monthLabel(month)} so far`} value={cr(sum('fii', inMonth))} tone={sum('fii', inMonth)} note={`${inMonth.length} trading days stored`} />
        <Tile label={`DII net, ${monthLabel(month)} so far`} value={cr(sum('dii', inMonth))} tone={sum('dii', inMonth)} />
      </Tiles>
      <div className="grid gap-4 @5xl:grid-cols-2">
        <section>
          <H>FII net, daily</H>
          <FlowBars bars={days.filter((x) => x.fii).map((x) => ({ time: x.date, value: x.fii!.net }))} label="Foreign institutions' net buying each day" />
        </section>
        <section>
          <H>DII net, daily</H>
          <FlowBars bars={days.filter((x) => x.dii).map((x) => ({ time: x.date, value: x.dii!.net }))} label="Domestic institutions' net buying each day" />
        </section>
      </div>
      <H>Day by day</H>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
            <th className="py-1 text-left font-medium">Date</th>
            {['FII buy', 'FII sell', 'FII net', 'DII buy', 'DII sell', 'DII net'].map((h) => (
              <th key={h} className="px-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.slice(0, 40).map((x) => (
            <tr key={x.date} className="border-b border-rule">
              <td className="py-1">{shortDate(x.date)}</td>
              <td className="num px-2">{plain(x.fii?.buy)}</td>
              <td className="num px-2">{plain(x.fii?.sell)}</td>
              <td className={`num px-2 font-semibold ${toneClass(x.fii?.net ?? null)}`}>{cr(x.fii?.net)}</td>
              <td className="num px-2">{plain(x.dii?.buy)}</td>
              <td className="num px-2">{plain(x.dii?.sell)}</td>
              <td className={`num px-2 font-semibold ${toneClass(x.dii?.net ?? null)}`}>{cr(x.dii?.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-muted">NSE’s provisional figures for all exchanges. NSDL’s custodian figures (in “Foreign investors by month”) can differ.</p>
    </>
  )
}

// ---------------- F&O positions ----------------

const CLIENTS: FoPosition['client'][] = ['FII', 'DII', 'Pro', 'Client']
const CLIENT_LABEL: Record<FoPosition['client'], string> = { FII: 'Foreign institutions', DII: 'Domestic institutions', Pro: 'Brokers’ own trading', Client: 'Retail and others' }

function Fo({ d }: { d: FlowsReport }) {
  const dates = [...new Set(d.fo.map((r) => r.date))].sort().reverse()
  if (dates.length === 0) return <Empty>F&O positions are downloading: one small NSE file per trading day, a year back.</Empty>
  const at = (date: string, c: FoPosition['client']) => d.fo.find((r) => r.date === date && r.client === c)
  const [last, prev] = dates
  const fii = at(last, 'FII')!
  const fiiPrev = prev ? at(prev, 'FII') : undefined
  const share = longShare(fii)
  const sharePrev = fiiPrev ? longShare(fiiPrev) : null
  const fiiSeries = dates.map((dt) => at(dt, 'FII')).filter((r): r is FoPosition => !!r)
  return (
    <>
      <Tiles>
        <Tile
          label="FII index futures held long"
          value={share === null ? '—' : `${(share * 100).toFixed(1)}%`}
          note={sharePrev === null || share === null ? undefined : `${share >= sharePrev ? '+' : '−'}${Math.abs((share - sharePrev) * 100).toFixed(1)} points on the day before`}
        />
        <Tile label="FII index futures, long less short" value={cr(fii.futIdxLong - fii.futIdxShort)} tone={fii.futIdxLong - fii.futIdxShort} note="contracts" />
        <Tile label="FII index puts bought less sold" value={cr(fii.putIdxLong - fii.putIdxShort)} tone={null} note="contracts" />
        <Tile label="As of" value={shortDate(last)} />
      </Tiles>
      <H>Foreign institutions in index futures</H>
      <FlowBars
        bars={fiiSeries.map((r) => ({ time: r.date, value: r.futIdxLong - r.futIdxShort }))}
        line={fiiSeries.map((r) => ({ time: r.date, value: (longShare(r) ?? 0) * 100 }))}
        lineLabel="Long %"
        unit="Net contracts"
        label="FII net index futures contracts and the share held long, by day"
      />
      <p className="mt-1 text-[12px] text-ink-muted">Bars: contracts long less short. Amber line (left scale): the share of their index futures that is long.</p>
      <H>Everyone’s open positions on {shortDate(last)}</H>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
            <th className="py-1 text-left font-medium">Who</th>
            {['Index fut. long', 'Index fut. short', 'Net', 'Long %', 'Calls bought', 'Calls sold', 'Puts bought', 'Puts sold', 'Stock fut. net'].map((h) => (
              <th key={h} className="px-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CLIENTS.map((c) => {
            const r = at(last, c)
            if (!r) return null
            const ls = longShare(r)
            return (
              <tr key={c} className="border-b border-rule">
                <th scope="row" className="py-1 text-left font-normal">
                  {CLIENT_LABEL[c]}
                </th>
                <td className="num px-2">{plain(r.futIdxLong)}</td>
                <td className="num px-2">{plain(r.futIdxShort)}</td>
                <td className={`num px-2 font-semibold ${toneClass(r.futIdxLong - r.futIdxShort)}`}>{cr(r.futIdxLong - r.futIdxShort)}</td>
                <td className="num px-2">{ls === null ? '—' : `${(ls * 100).toFixed(1)}%`}</td>
                <td className="num px-2">{plain(r.callIdxLong)}</td>
                <td className="num px-2">{plain(r.callIdxShort)}</td>
                <td className="num px-2">{plain(r.putIdxLong)}</td>
                <td className="num px-2">{plain(r.putIdxShort)}</td>
                <td className={`num px-2 ${toneClass(r.futStkLong - r.futStkShort)}`}>{cr(r.futStkLong - r.futStkShort)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-muted">Open contracts at the day’s close, from NSE’s participant-wise open interest file.</p>
    </>
  )
}

// ---------------- foreign investors (NSDL) ----------------

function Fpi({ d }: { d: FlowsReport }) {
  if (d.fpi.length === 0) return <Empty>Foreign investors’ monthly figures are downloading from NSDL (one page a year, back to 2015).</Empty>
  const months = [...d.fpi].sort((a, b) => b.month.localeCompare(a.month))
  const years = new Map<string, { equity: number; debt: number; total: number }>()
  for (const m of months) {
    const y = years.get(m.month.slice(0, 4)) ?? { equity: 0, debt: 0, total: 0 }
    y.equity += m.equity
    y.debt += m.debt
    y.total += m.total
    years.set(m.month.slice(0, 4), y)
  }
  const last12 = months.slice(0, 12)
  return (
    <>
      <Tiles>
        <Tile label={`Equity, ${monthLabel(months[0].month)}`} value={cr(months[0].equity)} tone={months[0].equity} note="so far, if this month" />
        <Tile label="Equity, last 12 months" value={cr(last12.reduce((s, m) => s + m.equity, 0))} tone={last12.reduce((s, m) => s + m.equity, 0)} />
        <Tile label="Debt, last 12 months" value={cr(last12.reduce((s, m) => s + m.debt, 0))} tone={last12.reduce((s, m) => s + m.debt, 0)} />
        <Tile label="All assets, last 12 months" value={cr(last12.reduce((s, m) => s + m.total, 0))} tone={last12.reduce((s, m) => s + m.total, 0)} />
      </Tiles>
      <H>Net investment in Indian equity, month by month</H>
      <FlowBars bars={months.map((m) => ({ time: m.month, value: m.equity }))} label="Foreign investors' net equity investment by month" height={240} />
      <H>Net investment in Indian debt</H>
      <FlowBars bars={months.map((m) => ({ time: m.month, value: m.debt }))} label="Foreign investors' net debt investment by month" height={180} />
      <H>By year</H>
      <table className="w-full max-w-xl text-[13px]">
        <thead>
          <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
            <th className="py-1 text-left font-medium">Year</th>
            <th className="px-2 text-right font-medium">Equity</th>
            <th className="px-2 text-right font-medium">Debt</th>
            <th className="px-2 text-right font-medium">All</th>
          </tr>
        </thead>
        <tbody>
          {[...years.entries()].map(([y, v]) => (
            <tr key={y} className="border-b border-rule">
              <td className="py-1">{y}</td>
              <td className={`num px-2 ${toneClass(v.equity)}`}>{cr(v.equity)}</td>
              <td className={`num px-2 ${toneClass(v.debt)}`}>{cr(v.debt)}</td>
              <td className={`num px-2 font-semibold ${toneClass(v.total)}`}>{cr(v.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-muted">NSDL, from custodians’ reports to SEBI. Debt includes the general, VRR and FAR routes.</p>
    </>
  )
}

// ---------------- mutual funds (AMFI) ----------------

function Mf({ d }: { d: FlowsReport }) {
  if (d.mf.length === 0) return <Empty>Mutual fund flows are downloading from AMFI (one report a month, back to April 2019).</Empty>
  const month = d.mf[0].month
  const groups = [...new Set(d.mf.map((r) => r.group))]
  const m0 = d.mfEquityByMonth[0]
  const yearEq = d.mfEquityByMonth.slice(0, 12).reduce((s, m) => s + m.equity, 0)
  return (
    <>
      <Tiles>
        <Tile label={`Into equity funds, ${monthLabel(month)}`} value={cr(m0?.equity)} tone={m0?.equity ?? null} note="net of redemptions" />
        <Tile label="Into equity funds, last 12 months" value={cr(yearEq)} tone={yearEq} />
        <Tile label={`Debt funds, ${monthLabel(month)}`} value={cr(m0?.debt)} tone={m0?.debt ?? null} />
        <Tile label={`All funds, ${monthLabel(month)}`} value={cr(m0?.total)} tone={m0?.total ?? null} />
      </Tiles>
      <H>Net money into equity funds, month by month</H>
      <FlowBars bars={d.mfEquityByMonth.map((m) => ({ time: m.month, value: m.equity }))} label="Net inflow into equity mutual funds by month" height={240} />
      <H>Every category, {monthLabel(month)}</H>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
            <th className="py-1 text-left font-medium">Category</th>
            {['Money in', 'Money out', 'Net', 'Assets', 'Folios', 'Schemes'].map((h) => (
              <th key={h} className="px-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g}>
            <tr>
              <th colSpan={7} className="pt-3 pb-1 text-left text-[12.5px] font-semibold text-stamp">
                {g}
              </th>
            </tr>
            {d.mf
              .filter((r) => r.group === g)
              .sort((a, b) => b.net - a.net)
              .map((r) => (
                <tr key={r.category} className="border-b border-rule">
                  <td className="py-1">{r.category}</td>
                  <td className="num px-2">{plain(r.raised)}</td>
                  <td className="num px-2">{plain(r.redeemed)}</td>
                  <td className={`num px-2 font-semibold ${toneClass(r.net)}`}>{cr(r.net)}</td>
                  <td className="num px-2">{plain(r.aum)}</td>
                  <td className="num px-2">{plain(r.folios)}</td>
                  <td className="num px-2">{plain(r.schemes)}</td>
                </tr>
              ))}
          </tbody>
        ))}
      </table>
      <p className="mt-2 text-[12px] text-ink-muted">AMFI’s monthly report, published around the 10th of the next month.</p>
    </>
  )
}

// ---------------- big deals ----------------

function Deals({ d }: { d: FlowsReport }) {
  const open = useOpenSymbol()
  const [institutions, setInstitutions] = useState(true)
  const [find, setFind] = useState('')
  const q = find.trim().toUpperCase()
  const deals = d.deals.filter((r) => (!institutions || INSTITUTION.test(r.client)) && (!q || r.symbol.includes(q) || r.client.toUpperCase().includes(q)))
  const stakes = d.stakes.filter((r) => !q || r.symbol.includes(q) || r.party.toUpperCase().includes(q))
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[13.5px]">
        <label className="flex items-center gap-1.5 text-ink-muted">
          <input type="checkbox" checked={institutions} onChange={(e) => setInstitutions(e.target.checked)} />
          Institutions only (funds, insurers, banks, foreign investors)
        </label>
        <input
          aria-label="Find a stock or buyer"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a stock or buyer"
          className="w-52 rounded-sm border border-rule bg-transparent px-2 py-0.5 placeholder:text-ink-muted/70 focus:border-stamp focus:outline-none"
        />
      </div>
      <H>Bulk and block deals, last 60 days</H>
      {deals.length === 0 ? (
        <Empty>{d.deals.length ? 'No deal matches.' : 'Deals are downloading from NSE.'}</Empty>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
              {['Date', 'Stock', 'Buyer or seller', '', 'Shares', 'Price', 'Value (₹ Cr)'].map((h, i) => (
                <th key={i} className={'py-1 font-medium ' + (i < 4 ? 'pr-2 text-left' : 'px-2 text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.slice(0, 300).map((r, i) => (
              <tr key={i} className="border-b border-rule">
                <td className="py-1 pr-2 whitespace-nowrap">{shortDate(r.date)}</td>
                <td className="pr-2">
                  <button type="button" onClick={() => open(r.symbol)} className="font-semibold text-stamp hover:underline">
                    {r.symbol}
                  </button>
                  {r.kind === 'BLOCK' && <span className="ml-1 text-[11px] text-ink-muted">block</span>}
                </td>
                <td className="max-w-[340px] truncate pr-2" title={r.client}>
                  {r.client}
                </td>
                <td className={'pr-2 font-semibold ' + (r.side === 'BUY' ? 'text-gain' : 'text-loss')}>{r.side === 'BUY' ? 'Bought' : 'Sold'}</td>
                <td className="num px-2">{plain(r.qty)}</td>
                <td className="num px-2">{plain(r.price, 2)}</td>
                <td className="num px-2">{plain((r.qty * r.price) / 1e7, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <H>5% stakes crossed (takeover code disclosures)</H>
      {stakes.length === 0 ? (
        <Empty>{d.stakes.length ? 'No disclosure matches.' : 'Disclosures are downloading from NSE.'}</Empty>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
              {['Filed', 'Stock', 'Who', '', 'Change', 'Holds after', 'How'].map((h, i) => (
                <th key={i} className={'py-1 font-medium ' + (i < 4 || i === 6 ? 'pr-2 text-left' : 'px-2 text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stakes.slice(0, 200).map((r) => (
              <tr key={r.id} className="border-b border-rule">
                <td className="py-1 pr-2 whitespace-nowrap">{shortDate(r.date)}</td>
                <td className="pr-2">
                  <button type="button" onClick={() => open(r.symbol)} className="font-semibold text-stamp hover:underline">
                    {r.symbol}
                  </button>
                </td>
                <td className="max-w-[360px] truncate pr-2" title={r.party}>
                  {r.party}
                  {r.promoter && <span className="ml-1 text-[11px] text-ink-muted">promoter</span>}
                </td>
                <td className={'pr-2 font-semibold ' + (r.side === 'BUY' ? 'text-gain' : 'text-loss')}>{r.side === 'BUY' ? 'Bought' : 'Sold'}</td>
                <td className="num px-2">{r.changePct === null ? '—' : `${r.changePct.toFixed(2)}%`}</td>
                <td className="num px-2">{r.afterPct === null ? '—' : `${r.afterPct.toFixed(2)}%`}</td>
                <td className="pr-2 text-ink-muted">{r.mode ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[12px] text-ink-muted">From NSE. A bulk deal is 0.5% or more of a company’s shares in a day; a block deal is a large trade in the special window. Names as reported.</p>
    </>
  )
}

