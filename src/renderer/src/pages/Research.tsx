import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ResearchStatus } from '@shared/research'
import { ErrorNote, PageHeader } from '../components/Shell'
import { CompanyPage, VIEWS, type View } from '../components/Company'
import { Button } from '../components/ui'
import { useCompanySearch, useResearchHome, useSetResearchSync } from '../lib/api'
import { bigMoney, lakhCrore, money, percent, shortDate, toneClass } from '../lib/format'

/** "infy fin" → INFY's financials. The last word picks the view when it names one. */
export function parseCommand(text: string): { query: string; view: View | null } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const last = words.at(-1)?.toLowerCase()
  const view = VIEWS.find((v) => v.codes.includes(last ?? ''))?.key ?? null
  return { query: (view && words.length > 1 ? words.slice(0, -1) : words).join(' '), view }
}

export function Research() {
  const { symbol } = useParams()
  const [params] = useSearchParams()
  const view = (VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'overview') as View
  return (
    <>
      <PageHeader title="Research">
        <SyncLine />
      </PageHeader>
      <CommandBar key={symbol ?? ''} />
      {symbol ? <CompanyPage symbol={symbol.toUpperCase()} view={view} /> : <Home />}
    </>
  )
}

function CommandBar() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { query, view } = parseCommand(text)
  const hits = useCompanySearch(query).data ?? []
  const shown = query ? hits.slice(0, 8) : []

  // "/" anywhere on the page jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (symbol: string | undefined) => {
    if (!symbol) return
    setOpen(false)
    setText('')
    navigate(`/research/${encodeURIComponent(symbol)}${view && view !== 'overview' ? `?view=${view}` : ''}`)
  }
  const current = Math.min(active, shown.length - 1)
  return (
    <div className="relative mb-7">
      <label htmlFor="research-search" className="sr-only">
        Find a company
      </label>
      <input
        id="research-search"
        ref={input}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls="research-hits"
        aria-activedescendant={open && shown[current] ? `hit-${current}` : undefined}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            // An exact symbol goes straight there, even before the list catches up.
            const exact = hits.find((h) => h.symbol === query.toUpperCase())
            go(exact?.symbol ?? shown[current]?.symbol)
          } else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Company or symbol, e.g. TCS or HDFC Bank. Add FIN or CHART to jump there."
        className="w-full rounded-lg border border-rule-strong bg-sheet px-4 py-2.5 text-[16px] text-ink placeholder:text-ink-muted/80 focus:border-stamp focus:outline-none"
      />
      {open && shown.length > 0 && (
        <ul
          id="research-hits"
          role="listbox"
          aria-label="Companies"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-rule-strong bg-sheet py-1 shadow-lg"
        >
          {shown.map((h, i) => (
            <li
              key={h.symbol}
              id={`hit-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseDown={(e) => {
                e.preventDefault()
                go(h.symbol)
              }}
              onMouseEnter={() => setActive(i)}
              className={
                'flex cursor-pointer items-baseline gap-3 px-4 py-1.5 text-[14.5px] ' +
                (i === current ? 'bg-stamp-wash text-stamp' : 'text-ink')
              }
            >
              <span className="w-28 shrink-0 font-medium">{h.symbol}</span>
              <span className="truncate">{h.name}</span>
              {h.held && <span className="ml-auto shrink-0 text-[12.5px] text-ink-muted">you hold it</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function syncText(s: ResearchStatus): string {
  const n = (x: number) => x.toLocaleString('en-IN')
  const of = `${n(s.companiesDone)} of ${n(s.companies)} companies`
  if (s.companies === 0) return 'The company list arrives with the first price refresh'
  if (s.state === 'PAUSED') return `Results download paused, ${of}`
  if (s.state === 'DONE') return `Results in for all ${n(s.companies)} companies`
  const eta =
    s.etaMinutes === null ? '' : s.etaMinutes >= 90 ? `, about ${Math.round(s.etaMinutes / 60)} h left` : `, about ${s.etaMinutes} min left`
  return s.state === 'RUNNING' ? `Downloading results: ${of}${eta}` : `Results: ${of}, resuming shortly`
}

function SyncLine() {
  const home = useResearchHome()
  const toggle = useSetResearchSync()
  const s = home.data?.status
  if (!s) return null
  return (
    <div className="flex items-center gap-3 text-[13.5px] text-ink-muted" aria-live="polite">
      <span>
        {syncText(s)}
        {s.pricesDate && <> · prices of {shortDate(s.pricesDate)}</>}
      </span>
      <Button variant="quiet" className="!px-2.5 !py-0.5 !text-[13px]" disabled={toggle.isPending} onClick={() => toggle.mutate(!s.enabled)}>
        {s.enabled ? 'Pause' : 'Resume'}
      </Button>
    </div>
  )
}

function Home() {
  const home = useResearchHome()
  const navigate = useNavigate()
  const r = home.data
  return (
    <>
      <ErrorNote error={home.error} />
      {r?.status.lastError && r.status.state !== 'PAUSED' && (
        <p className="mb-5 rounded-md border border-warn/40 bg-warn-wash px-3 py-2 text-[14px]">
          NSE didn't answer the last request ({r.status.lastError}). The download tries again by itself.
        </p>
      )}
      <section>
        <h2 className="wide mb-1 text-[19px] font-semibold">Your stocks</h2>
        <p className="mb-3 text-[14px] text-ink-muted">
          The companies the family holds. Open one for its results, ratios and price history, or search above for any listed
          company.
        </p>
        {r && r.yours.length === 0 && (
          <p className="text-[14.5px] text-ink-muted">No Indian stocks held yet. Search above to look at any listed company.</p>
        )}
        {r && r.yours.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[14.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-[13px] text-ink-muted">
                  <th className="py-1.5 pr-3 text-left font-medium">Company</th>
                  <th className="px-3 text-right font-medium">Price</th>
                  <th className="px-3 text-right font-medium">Day</th>
                  <th className="px-3 text-right font-medium">Market cap</th>
                  <th className="px-3 text-right font-medium">P/E</th>
                  <th className="px-3 text-right font-medium">ROE</th>
                  <th className="px-3 text-right font-medium" title="Latest quarter against the same quarter a year before">
                    Sales growth
                  </th>
                  <th className="pl-3 text-right font-medium">Yours</th>
                </tr>
              </thead>
              <tbody>
                {r.yours.map((c) => (
                  <tr
                    key={c.symbol}
                    tabIndex={0}
                    onClick={() => navigate(`/research/${encodeURIComponent(c.symbol)}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/research/${encodeURIComponent(c.symbol)}`)}
                    className="cursor-pointer border-b border-rule hover:bg-sheet focus:bg-sheet focus:outline-none"
                  >
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[12.5px] text-ink-muted">
                        {c.symbol}
                        {c.industry ? ` · ${c.industry}` : ''}
                      </div>
                    </td>
                    <td className="num px-3">{c.close === null ? '—' : money(c.close, 'INR', 2)}</td>
                    <td className={`num px-3 ${toneClass(c.change)}`}>{percent(c.change)}</td>
                    <td className="num px-3">{bigMoney(c.mcap)}</td>
                    <td className="num px-3">{c.pe === null ? '—' : c.pe.toFixed(1)}</td>
                    <td className="num px-3">{c.roe === null ? '—' : `${(c.roe * 100).toFixed(1)}%`}</td>
                    <td className={`num px-3 ${toneClass(c.salesGrowthQ)}`}>{percent(c.salesGrowthQ)}</td>
                    <td className="num pl-3">{lakhCrore(c.held?.valueInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="mt-10 max-w-[70ch] text-[13.5px] text-ink-muted">
        <h2 className="mb-1 text-[14px] font-semibold text-ink">Where the figures come from</h2>
        <p>
          Results are read from the XBRL files companies file with NSE each quarter (consolidated where filed). Prices, market
          caps and P/E come from NSE's end-of-day files, and price history from Yahoo Finance. Ratios such as ROE and the
          Piotroski score are worked out here from those filings. NSE's terms of use don't allow automated collection, so the
          download goes slowly, one file at a time, for your own use on this computer, and nothing is shared. Pause it above
          at any time.
        </p>
      </section>
    </>
  )
}
