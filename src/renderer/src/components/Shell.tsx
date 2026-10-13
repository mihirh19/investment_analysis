import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMarketStatus, useMarketSubscription, usePersons, useRefreshMarket } from '../lib/api'
import { ErrorBoundary } from './ErrorBoundary'
import { timeAgo } from '../lib/format'
import { useScope, type Scope } from '../lib/scope'

// Grouped by what the reader is doing: looking at money, recording it, keeping the app.
const NAV = [
  [
    { to: '/', label: 'Overview', end: true },
    { to: '/analysis', label: 'Analysis' },
    { to: '/performance', label: 'Performance' },
    { to: '/tax', label: 'Tax' },
    { to: '/rebalance', label: 'Rebalance' },
    { to: '/holdings', label: 'Holdings' },
    { to: '/other-assets', label: 'Other assets' },
    { to: '/exposure', label: 'Sectors & exposure' },
    { to: '/funds', label: 'Funds' },
    { to: '/dividends', label: 'Dividends' },
    { to: '/retirement', label: 'EPF & NPS' },
    { to: '/insurance', label: 'Insurance' }
  ],
  [
    { to: '/activity', label: 'Activity' },
    { to: '/import', label: 'Import statements' },
    { to: '/people', label: 'People & accounts' },
    { to: '/settings', label: 'Settings & backup' }
  ]
]

function LiveStatus() {
  const status = useMarketStatus()
  const refresh = useRefreshMarket()
  const s = status.data
  const down = s?.sources.filter((x) => x.lastError) ?? []
  const priceSources = new Set(['stocks', 'funds', 'nps'])
  const missing = new Set(s?.sources.filter((x) => priceSources.has(x.key)).flatMap((x) => x.failed) ?? [])
  const busy = refresh.isPending || s?.refreshing
  const Dot = ({ open, label }: { open: boolean; label: string }) => (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={'inline-block size-2 rounded-full ' + (open ? 'bg-gain' : 'bg-rule-strong')} />
      {label} {open ? 'open' : 'closed'}
    </span>
  )
  return (
    <div className="mt-auto border-t border-rule px-5 py-4 text-[13px] text-ink-muted">
      {s && (
        <div className="mb-2 flex gap-4">
          <Dot open={s.nseOpen} label="NSE" />
          <Dot open={s.usOpen} label="US" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span aria-live="polite">{busy ? 'Updating prices…' : `Prices ${timeAgo(s?.lastRefresh ?? null)}`}</span>
        <button
          onClick={() => refresh.mutate([])}
          disabled={!!busy}
          className="rounded px-2 py-0.5 text-stamp hover:bg-stamp-wash disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {!busy && (down.length > 0 || missing.size > 0) && (
        <NavLink to="/settings" className="mt-1 block text-warn hover:underline">
          {down.length > 0
            ? `${down.length === 1 ? '1 price source' : `${down.length} price sources`} not responding`
            : `No live price for ${missing.size === 1 ? [...missing][0] : `${missing.size} holdings`}`}
        </NavLink>
      )}
    </div>
  )
}

export function Shell() {
  useMarketSubscription()
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  // Block body on purpose: Chromium's scrollTo returns a Promise, which React would treat as a cleanup.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [pathname])
  const { scope, setScope } = useScope()
  const persons = usePersons().data ?? []
  const tabs: { id: Scope; label: string }[] = [
    ...persons.map((p) => ({ id: p.id as Scope, label: p.name })),
    { id: 'family', label: 'Family' }
  ]
  // The stamp-blue marker slides to whichever passbook tab is open.
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const el = tabRefs.current.get(String(scope))
    if (el) setMarker({ top: el.offsetTop + 8, height: el.offsetHeight - 16 })
  }, [scope, persons.length])

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-rule bg-sheet">
        <div className="px-5 pt-6 pb-5">
          <div className="wide text-[17px] font-semibold tracking-tight text-ink">Family Portfolio</div>
          <div className="text-[13px] text-ink-muted">Kept on this computer</div>
        </div>

        {/* Passbook tabs: whose book is open. */}
        <div role="tablist" aria-label="Whose investments" className="relative flex flex-col gap-1 pr-0 pl-3">
          {marker && (
            <span
              aria-hidden
              className="absolute left-3 z-10 w-[3px] rounded-r bg-stamp transition-[top,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ top: marker.top, height: marker.height }}
            />
          )}
          {tabs.map((t) => {
            const active = scope === t.id
            return (
              <button
                key={String(t.id)}
                ref={(el) => {
                  if (el) tabRefs.current.set(String(t.id), el)
                }}
                role="tab"
                aria-selected={active}
                onClick={() => setScope(t.id)}
                className={
                  'relative -mr-px rounded-l-md border py-2 pr-4 pl-4 text-left text-[15px] transition-colors ' +
                  (active
                    ? 'border-rule border-r-paper bg-paper font-semibold text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink')
                }
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <nav aria-label="Sections" className="mt-5 flex flex-col overflow-y-auto border-t border-rule px-3">
          {NAV.map((group, gi) => (
            <div key={gi} className={'flex flex-col py-3 ' + (gi > 0 ? 'border-t border-rule' : '')}>
              {group.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={'end' in n ? n.end : undefined}
                  className={({ isActive }) =>
                    'rounded-md px-3 py-1.5 text-[15px] ' +
                    (isActive ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-paper hover:text-ink')
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <LiveStatus />
      </aside>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1180px] px-10 pt-8 pb-16">
          <ErrorBoundary resetKey={pathname}>
            {/* Keyed by route so each page plays its entrance once. */}
            <div key={pathname} className="anim-page">
              <Outlet />
            </div>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-6 border-b border-rule-strong pb-3">
      <h1 className="wide text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </header>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p role="alert" className="mt-3 rounded-md border border-loss/40 bg-loss/5 px-3 py-2 text-[14px] text-loss">
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}
