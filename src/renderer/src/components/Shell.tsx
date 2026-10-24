import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMarketStatus, useMarketSubscription, usePersons, useRefreshMarket, useResearchSubscription, useTheme } from '../lib/api'
import { pageActive, sectionOf, SECTIONS } from '../lib/nav'
import { GoTo, openGoTo } from './GoTo'
import { AskPanel, openAsk } from './AskPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { timeAgo } from '../lib/format'
import { useScope, type Scope } from '../lib/scope'

const LAST_KEY = 'nav:last'

/** Where each section was last left, so its sidebar link returns to the same page. */
function lastPages(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function SideNav({ pathname }: { pathname: string }) {
  const here = sectionOf(pathname)
  const [last, setLast] = useState(lastPages)
  useEffect(() => {
    if (!here || here.pages.length < 2) return
    setLast((l) => {
      if (l[here.label] === pathname) return l
      const next = { ...l, [here.label]: pathname }
      try {
        sessionStorage.setItem(LAST_KEY, JSON.stringify(next))
      } catch {
        // Not kept; the section opens on its first page instead.
      }
      return next
    })
  }, [here, pathname])
  return (
    <nav aria-label="Sections" className="mt-3 flex min-h-0 flex-col gap-px overflow-y-auto border-t border-rule px-3 pt-2.5 pb-2">
      {SECTIONS.map((s) => {
        const active = s === here
        const to = (s.pages.length > 1 && last[s.label]) || s.pages[0].to
        return (
          <NavLink
            key={s.label}
            to={to}
            end={s.pages[0].end}
            aria-current={active ? 'page' : undefined}
            className={
              'flex items-center justify-between rounded-md px-3 py-[5px] text-[15px] ' +
              (active ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-paper hover:text-ink')
            }
          >
            {s.label}
            {s.pages.length > 1 && (
              <span className={'text-[12px] tabular-nums ' + (active ? 'text-stamp/70' : 'text-ink-muted/70')}>
                {s.pages.length}
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

/** A section's pages as tabs above the page, when it has more than one. */
function SectionTabs({ pathname }: { pathname: string }) {
  const s = sectionOf(pathname)
  if (!s || s.pages.length < 2) return null
  return (
    <nav aria-label={`${s.label} pages`} className="-mt-3 mb-5 flex flex-wrap gap-x-1 border-b border-rule">
      {[...s.pages, ...(s.pages.some((p) => pageActive(p, pathname)) ? [] : [{ to: pathname, label: decodeURIComponent(pathname.split('/').pop() ?? '') }])].map((p) => (
        <NavLink
          key={p.to}
          to={p.to}
          end={'end' in p ? p.end : undefined}
          className={({ isActive }) =>
            '-mb-px border-b-2 px-3 pt-1 pb-2 text-[14.5px] ' +
            (isActive || pageActive(p, pathname)
              ? 'border-stamp font-medium text-ink'
              : 'border-transparent text-ink-muted hover:border-rule-strong hover:text-ink')
          }
        >
          {p.label}
        </NavLink>
      ))}
    </nav>
  )
}
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
  const { pathname } = useLocation()
  useMarketSubscription()
  useResearchSubscription()
  const theme = useTheme().data ?? 'terminal'
  // The terminal look: the default (or chosen in Settings), and always on in Research.
  const terminal = theme === 'terminal' || pathname.startsWith('/research')
  useEffect(() => {
    document.documentElement.classList.toggle('terminal', terminal)
  }, [terminal])
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
        <div className="px-5 pt-5 pb-4">
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
                  'relative -mr-px rounded-l-md border py-1.5 pr-4 pl-4 text-left text-[15px] transition-colors ' +
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

        <button
          type="button"
          onClick={openAsk}
          className="mx-3 mt-3 rounded-md bg-stamp px-3 py-2 text-left text-[14.5px] font-semibold text-white hover:brightness-110 dark:text-[#10162a]"
        >
          Ask your money
        </button>
        <button
          type="button"
          onClick={openGoTo}
          className="mx-3 mt-2 flex items-center justify-between rounded-md border border-rule px-3 py-1.5 text-left text-[14px] text-ink-muted hover:border-rule-strong hover:text-ink"
        >
          Go to…
          <kbd className="font-sans text-[12px] text-ink-muted">Ctrl K</kbd>
        </button>

        <SideNav pathname={pathname} />
        <LiveStatus />
      </aside>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className={'mx-auto pt-8 pb-16 ' + (pathname === '/research/world' ? 'max-w-[1800px] px-6' : 'max-w-[1180px] px-10')}>
          <SectionTabs pathname={pathname} />
          <ErrorBoundary resetKey={pathname}>
            {/* Keyed by route so each page plays its entrance once. */}
            <div key={pathname} className="anim-page">
              <Outlet />
            </div>
          </ErrorBoundary>
        </div>
      </main>
      <ErrorBoundary resetKey={pathname}>
        <AskPanel />
      </ErrorBoundary>
      <GoTo />
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
