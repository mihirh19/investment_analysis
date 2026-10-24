import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ResearchStatus } from '@shared/research'
import { PageHeader } from '../components/Shell'
import { CompanyPage, VIEWS, type View } from '../components/Company'
import { Monitor } from '../components/Monitor'
import { Screener } from '../components/Screener'
import { Button } from '../components/ui'
import { useCompanySearch, useResearchHome, useSetResearchSync, useWorldMap } from '../lib/api'
import { shortDate, timeAgo } from '../lib/format'

// The map and its drawing library load only when the World tab is opened.
const World = lazy(() => import('../components/World'))

/** "infy fin" → INFY's financials. The last word picks the view when it names one. */
export function parseCommand(text: string): { query: string; view: View | null } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const last = words.at(-1)?.toLowerCase()
  const view = VIEWS.find((v) => v.codes.includes(last ?? ''))?.key ?? null
  return { query: (view && words.length > 1 ? words.slice(0, -1) : words).join(' '), view }
}

/** Words that open a page of the desk rather than a company. */
const PAGES: Record<string, string> = {
  scr: '/research/screener',
  screener: '/research/screener',
  mon: '/research',
  monitor: '/research',
  wld: '/research/world',
  world: '/research/world',
  map: '/research/world'
}

export function Research({ mode }: { mode?: 'screener' | 'world' }) {
  const { symbol } = useParams()
  const [params] = useSearchParams()
  const view = (VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'overview') as View
  return (
    <>
      <PageHeader title={mode === 'screener' ? 'Screener' : mode === 'world' ? 'World' : 'Research'}>{mode === 'world' ? <WorldLine /> : <SyncLine />}</PageHeader>
      <CommandBar key={symbol ?? ''} />
      {mode === 'screener' ? (
        <Screener />
      ) : mode === 'world' ? (
        <Suspense fallback={<p className="text-[13.5px] text-ink-muted">Loading the map…</p>}>
          <World />
        </Suspense>
      ) : symbol ? (
        <CompanyPage symbol={symbol.toUpperCase()} view={view} />
      ) : (
        <Monitor />
      )}
    </>
  )
}

/** When the World map's data last changed, or that its updates are paused. */
function WorldLine() {
  const d = useWorldMap().data
  if (!d) return null
  const latest = d.sources.map((s) => s.updatedAt).filter((x): x is string => !!x).sort().at(-1) ?? null
  return (
    <span className="text-[13.5px] text-ink-muted" aria-live="polite">
      {!d.enabled ? 'World updates paused' : d.refreshing ? 'Updating world data…' : latest ? `World data updated ${timeAgo(latest)}` : 'Fetching world data for the first time…'}
    </span>
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
            const page = PAGES[text.trim().toLowerCase()]
            if (page) {
              setText('')
              navigate(page)
              return
            }
            // An exact symbol goes straight there, even before the list catches up.
            const exact = hits.find((h) => h.symbol === query.toUpperCase())
            go(exact?.symbol ?? shown[current]?.symbol)
          } else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Company or symbol (TCS, HDFC Bank), then FIN, CHART or PEERS to jump there. SCR opens the screener, WLD the world map."
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
