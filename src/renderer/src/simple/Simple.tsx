import { useEffect, useMemo, useRef, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppRoutes } from '../terminal/routes'
import { AskPanel, openAsk } from '../components/AskPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GoTo, openGoTo } from '../components/GoTo'
import { LiveStatus } from '../components/Shell'
import {
  useAlerts,
  useLiveQuotesSubscription,
  useMarketSubscription,
  usePersons,
  useQuotes,
  useResearchSubscription
} from '../lib/api'
import { percent, toneClass } from '../lib/format'
import { pageActive } from '../lib/nav'
import { useScope, type Scope } from '../lib/scope'
import { TerminalCtx, type TerminalApi } from '../lib/terminal'
import { AREAS, MORE, areaOf } from './nav'
import { Home } from './Home'

// The simple look: one screen at a time under a plain top bar, the way an investing app works.
// The terminal (tabs, splits, function keys) is still there, chosen in Settings.

export function Simple() {
  useMarketSubscription()
  useLiveQuotesSubscription()
  useResearchSubscription()
  return (
    <HashRouter>
      <Frame />
    </HashRouter>
  )
}

/** Tool panels the terminal would open beside a screen; here each goes to the screen that holds it. */
function routeForPanel(kind: string, params: Record<string, unknown>): string {
  const symbol = typeof params.symbol === 'string' ? params.symbol : null
  if ((kind === 'chart' || kind === 'company') && symbol) return `/research/${encodeURIComponent(symbol)}`
  if (kind === 'screener') return '/research/screener'
  if (kind === 'world') return '/research/world'
  if (kind === 'sectors') return '/research/sectors'
  return '/research'
}

function Frame() {
  const navigate = useNavigate()
  const location = useLocation()
  const [more, setMore] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const app: TerminalApi = useMemo(
    () => ({
      openScreen: (route) => navigate(route),
      openPanel: (kind, params = {}) => navigate(routeForPanel(kind, params)),
      openMenu: () => setMore(true),
      openWorkspace: () => navigate('/')
    }),
    [navigate]
  )

  // Each new screen starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [location.pathname])

  const area = areaOf(location.pathname)
  const wide = location.pathname === '/research/world'
  return (
    <TerminalCtx.Provider value={app}>
      <div className="flex h-full flex-col bg-paper">
        <IndexStrip />
        <TopBar more={more} setMore={setMore} />
        <div ref={scroller} className="@container relative min-h-0 flex-1 overflow-y-auto" data-screen={location.pathname}>
          {area && area.pages.length > 1 && <AreaTabs pages={area.pages} pathname={location.pathname} />}
          <main className={'mx-auto px-6 pt-5 pb-16 ' + (wide ? 'max-w-[1900px]' : 'max-w-[1200px]')}>
            <ErrorBoundary resetKey={location.pathname + location.search}>
              <div key={location.pathname} className="anim-page">
                <Routes>
                  <Route index element={<Home />} />
                  <Route path="*" element={<AppRoutes />} />
                </Routes>
              </div>
            </ErrorBoundary>
          </main>
          <footer className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 border-t border-rule px-6 py-3 text-[12px] text-ink-muted">
            <LiveStatus />
            <span>Kept on this computer. Prices from Yahoo Finance, AMFI and NSE, often delayed.</span>
          </footer>
        </div>
      </div>
      <ErrorBoundary resetKey="ask">
        <AskPanel />
      </ErrorBoundary>
      <GoTo />
    </TerminalCtx.Provider>
  )
}

/** Indices, the rupee and gold in one quiet line across the top (Yahoo Finance). */
const INDICES: { symbol: string; label: string }[] = [
  { symbol: '^NSEI', label: 'Nifty 50' },
  { symbol: '^BSESN', label: 'Sensex' },
  { symbol: '^NSEBANK', label: 'Bank Nifty' },
  { symbol: '^CNXIT', label: 'Nifty IT' },
  { symbol: 'USDINR=X', label: 'USD/INR' },
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: '^GSPC', label: 'S&P 500' }
]

function IndexStrip() {
  const quotes = useQuotes(INDICES.map((i) => i.symbol))
  const by = new Map((quotes.data ?? []).map((q) => [q.symbol, q]))
  const items = INDICES.filter((i) => by.has(i.symbol))
  return (
    <div aria-label="Markets" className="flex h-8 shrink-0 items-center gap-6 overflow-hidden border-b border-rule px-6 text-[12.5px] whitespace-nowrap">
      {items.map((i) => {
        const q = by.get(i.symbol)!
        return (
          <span key={i.symbol}>
            <span className="text-ink-muted">{i.label}</span>{' '}
            <span className="num font-medium text-ink">{q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>{' '}
            <span className={`num ${toneClass(q.change)}`}>{percent(q.change)}</span>
          </span>
        )
      })}
    </div>
  )
}

function TopBar({ more, setMore }: { more: boolean; setMore: (b: boolean) => void }) {
  const { pathname } = useLocation()
  const { scope, setScope } = useScope()
  const persons = usePersons().data ?? []
  const people: { id: Scope; label: string }[] = [...persons.map((p) => ({ id: p.id as Scope, label: p.name })), { id: 'family', label: 'Family' }]
  const current = areaOf(pathname)
  const inMore = !current
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-rule bg-paper px-6">
      <Link to="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-stamp text-[13px] font-bold text-white">
          ₹
        </span>
        Family Portfolio
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1">
        {AREAS.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            aria-current={current === a ? 'page' : undefined}
            className={
              'rounded-full px-3 py-1.5 text-[14.5px] transition-colors ' +
              (current === a ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink')
            }
          >
            {a.label}
          </Link>
        ))}
        <MoreMenu open={more} setOpen={setMore} active={inMore} />
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={openGoTo}
          className="flex h-9 w-64 items-center gap-2 rounded-lg border border-rule-strong px-3 text-left text-[13.5px] text-ink-muted hover:border-stamp"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="2">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <span className="truncate">Search stocks, funds, screens</span>
          <kbd className="ml-auto shrink-0 text-[11px]">Ctrl K</kbd>
        </button>
        <div role="tablist" aria-label="Whose investments" className="flex rounded-full bg-sheet p-0.5">
          {people.map((t) => (
            <button
              key={String(t.id)}
              role="tab"
              aria-selected={scope === t.id}
              onClick={() => setScope(t.id)}
              className={
                'rounded-full px-3 py-1 text-[13px] transition-colors ' +
                (scope === t.id ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <AlertsDot />
        <button type="button" onClick={openAsk} className="h-9 rounded-lg bg-stamp px-4 text-[13.5px] font-semibold text-white hover:brightness-105">
          Ask
        </button>
      </div>
    </header>
  )
}

function AlertsDot() {
  const n = useAlerts().data?.unread ?? 0
  if (!n) return null
  return (
    <Link to="/alerts" className="rounded-full bg-loss px-2 py-0.5 text-[12px] font-semibold text-white" title="Alerts that have gone off">
      {n} alert{n === 1 ? '' : 's'}
    </Link>
  )
}

function MoreMenu({ open, setOpen, active }: { open: boolean; setOpen: (b: boolean) => void; active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={'flex items-center gap-1 rounded-full px-3 py-1.5 text-[14.5px] ' + (active || open ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink')}
      >
        More
        <svg aria-hidden viewBox="0 0 12 12" className={'size-3 fill-none stroke-current transition-transform ' + (open ? 'rotate-180' : '')} strokeWidth="1.6">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-2 grid w-[440px] grid-cols-2 gap-6 rounded-xl border border-rule bg-paper p-5 shadow-[0_8px_30px_rgba(20,25,40,0.12)]">
          {MORE.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="mb-2 text-[12.5px] text-ink-muted">{g.label}</h3>
              <ul className="space-y-0.5">
                {g.pages.map((p) => (
                  <li key={p.to}>
                    <NavLink to={p.to} onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 text-[14px] text-ink hover:bg-sheet">
                      {p.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** An area's screens as tabs under the top bar. */
function AreaTabs({ pages, pathname }: { pages: { to: string; label: string; end?: boolean }[]; pathname: string }) {
  return (
    <nav aria-label="Screens" className="sticky top-0 z-20 border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-[1200px] gap-6 px-6">
        {pages.map((p) => {
          const on = pageActive(p, pathname)
          return (
            <Link
              key={p.to}
              to={p.to}
              aria-current={on ? 'page' : undefined}
              className={
                '-mb-px border-b-2 py-3 text-[14px] transition-colors ' +
                (on ? 'border-stamp font-semibold text-stamp' : 'border-transparent text-ink-muted hover:text-ink')
              }
            >
              {p.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
