import { NavLink } from 'react-router-dom'
import { useMarketStatus, useRefreshMarket } from '../lib/api'
import { pageActive, sectionOf } from '../lib/nav'
import { timeAgo } from '../lib/format'
import { useTerminal } from '../lib/terminal'

// Pieces every screen shares. The frame around them (tabs, command line, status bar) is the
// terminal, in ../terminal/Terminal.tsx.

/** A section's other screens as tabs along the top of a screen, when it has more than one. */
export function SectionTabs({ pathname }: { pathname: string }) {
  const s = sectionOf(pathname)
  if (!s || s.pages.length < 2) return null
  const extra = s.pages.some((p) => pageActive(p, pathname)) ? [] : [{ to: pathname, label: decodeURIComponent(pathname.split('/').pop() ?? '').toUpperCase(), end: false }]
  return (
    <nav aria-label={`${s.label} screens`} className="mb-3 flex flex-wrap gap-x-0.5 border-b border-rule">
      {[...s.pages, ...extra].map((p) => (
        <NavLink
          key={p.to}
          to={p.to}
          end={p.end}
          className={({ isActive }) =>
            '-mb-px border-b-2 px-2.5 pt-0.5 pb-1 text-[13px] transition-colors ' +
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

/** Market hours, when prices last came in, and a refresh: the status bar's left end. */
export function LiveStatus() {
  const status = useMarketStatus()
  const refresh = useRefreshMarket()
  const terminal = useTerminal()
  const s = status.data
  const down = s?.sources.filter((x) => x.lastError) ?? []
  const priceSources = new Set(['stocks', 'funds', 'nps'])
  const missing = new Set(s?.sources.filter((x) => priceSources.has(x.key)).flatMap((x) => x.failed) ?? [])
  const busy = refresh.isPending || s?.refreshing
  const Dot = ({ open, label }: { open: boolean; label: string }) => (
    <span className="flex items-center gap-1" title={`${label} ${open ? 'open' : 'closed'}`}>
      <span aria-hidden className={'inline-block size-1.5 rounded-full ' + (open ? 'bg-gain' : 'bg-rule-strong')} />
      {label}
    </span>
  )
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {s && (
        <>
          <Dot open={s.nseOpen} label="NSE" />
          <Dot open={s.usOpen} label="US" />
        </>
      )}
      <span aria-live="polite">{busy ? 'Updating prices…' : `Prices ${timeAgo(s?.lastRefresh ?? null)}`}</span>
      <button onClick={() => refresh.mutate([])} disabled={!!busy} className="text-stamp hover:underline disabled:opacity-50">
        Refresh
      </button>
      {!busy && (down.length > 0 || missing.size > 0) && (
        <button type="button" onClick={() => terminal?.openScreen('/settings', { newTab: true })} className="text-warn hover:underline">
          {down.length > 0
            ? `${down.length === 1 ? '1 price source' : `${down.length} price sources`} not responding`
            : `No live price for ${missing.size === 1 ? [...missing][0] : `${missing.size} holdings`}`}
        </button>
      )}
    </div>
  )
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-b border-rule pb-2">
      <h1 className="wide text-[18px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
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
