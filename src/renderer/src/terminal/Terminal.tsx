import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DockviewReact, themeDark, type DockviewApi, type DockviewReadyEvent } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import type { SavedWorkspace } from '@shared/research'
import { ScreenPanel, navigators } from './ScreenPanel'
import { Menu } from './Menu'
import { PANEL_COMPONENTS, PANELS, type PanelParams } from '../components/workspace/panels'
import { AskPanel, openAsk } from '../components/AskPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { GoTo, openGoTo } from '../components/GoTo'
import { LiveStatus } from '../components/Shell'
import {
  saveWorkspaces,
  useMarketSubscription,
  usePersons,
  useQuotes,
  useResearchHome,
  useResearchSubscription,
  useTheme,
  useWorkspaces
} from '../lib/api'
import { percent, toneClass } from '../lib/format'
import { titleFor } from '../lib/nav'
import { useScope, type Scope } from '../lib/scope'
import { TerminalCtx, type TerminalApi } from '../lib/terminal'

// The whole app as a trading terminal: a command line and function keys along the top, every
// screen and tool as a tab that can be split, stacked or floated, and a status bar with a ticker.
// The arrangement is kept per named workspace.

const ACTIVE_KEY = 'ws:active'

const STARTERS: SavedWorkspace[] = [
  { id: 'home', name: 'Home', layout: null },
  { id: 'markets', name: 'Markets', layout: null },
  { id: 'company', name: 'Company', layout: null },
  { id: 'screen', name: 'Screener', layout: null }
]

/** Function keys, as on a terminal keyboard: the screens used most. F5 adds a chart. */
const FKEYS: { key: string; label: string; route?: string; panel?: string; menu?: true }[] = [
  { key: 'F1', label: 'Home', route: '/' },
  { key: 'F2', label: 'Holdings', route: '/holdings' },
  { key: 'F3', label: 'Monitor', route: '/research' },
  { key: 'F4', label: 'Screener', route: '/research/screener' },
  { key: 'F5', label: 'Chart', panel: 'chart' },
  { key: 'F6', label: 'World', route: '/research/world' },
  { key: 'F7', label: 'Farm', route: '/farm' },
  { key: 'F8', label: 'Loans', route: '/loans' },
  { key: 'F9', label: 'Plan', route: '/forecast' },
  { key: 'F10', label: 'Menu', menu: true }
]

let seq = 0
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${++seq}`
type Position = Parameters<DockviewApi['addPanel']>[0]['position']

function addScreen(api: DockviewApi, route: string, position?: Position, size?: { w?: number; h?: number }) {
  return api.addPanel({
    id: newId('screen'),
    component: 'screen',
    title: titleFor(route),
    params: { route },
    position,
    initialWidth: size?.w,
    initialHeight: size?.h
  })
}

function addTool(api: DockviewApi, kind: string, params: PanelParams = {}, position?: Position, size?: { w?: number; h?: number }) {
  const def = PANELS[kind]
  return api.addPanel({
    id: newId(kind),
    component: kind,
    title: def.title,
    params: { ...def.defaults, ...params },
    position,
    initialWidth: size?.w,
    initialHeight: size?.h
  })
}

/** Lays out a starter workspace. Column widths are set afterwards, as shares of the window. */
function build(api: DockviewApi, id: string) {
  const W = Math.max(api.width, 900)
  const width = (p: { api: { group: { api: { setSize(s: { width?: number; height?: number }): void } } } }, w: number) => p.api.group.api.setSize({ width: Math.round(w) })
  if (id === 'home') {
    const home = addScreen(api, '/')
    addScreen(api, '/holdings', { referencePanel: home.id, direction: 'within' })
    addScreen(api, '/research', { referencePanel: home.id, direction: 'within' })
    const watch = addTool(api, 'watchlist', { group: 'A', list: 'family' }, { referencePanel: home.id, direction: 'right' }, { w: 360 })
    addTool(api, 'chart', { group: 'A' }, { referencePanel: watch.id, direction: 'below' })
    width(watch, W * 0.27)
    home.api.setActive()
  } else if (id === 'markets') {
    const idx = addTool(api, 'indices')
    const chart = addTool(api, 'chart', { group: 'A' }, { referencePanel: idx.id, direction: 'below' })
    const world = addTool(api, 'world', {}, { referencePanel: chart.id, direction: 'right' }, { w: 560 })
    const movers = addTool(api, 'movers', { group: 'A' }, { referencePanel: world.id, direction: 'below' })
    addTool(api, 'sectors', {}, { referencePanel: movers.id, direction: 'within' })
    const watch = addTool(api, 'watchlist', { group: 'A', list: 'family' }, { referencePanel: chart.id, direction: 'left' }, { w: 280 })
    movers.api.setActive()
    idx.api.group.api.setSize({ height: 170 })
    width(watch, 260)
    width(world, W * 0.33)
  } else if (id === 'company') {
    const watch = addTool(api, 'watchlist', { group: 'A', list: 'family' })
    const chart = addTool(api, 'chart', { group: 'A' }, { referencePanel: watch.id, direction: 'right' })
    const overview = addTool(api, 'company', { group: 'A', view: 'overview' }, { referencePanel: chart.id, direction: 'right' }, { w: 600 })
    const fin = addTool(api, 'company', { group: 'A', view: 'financials' }, { referencePanel: chart.id, direction: 'below' })
    addTool(api, 'company', { group: 'A', view: 'peers' }, { referencePanel: fin.id, direction: 'within' })
    addTool(api, 'notes', { group: 'A' }, { referencePanel: fin.id, direction: 'within' })
    fin.api.setActive()
    width(watch, 250)
    width(overview, W * 0.36)
  } else if (id === 'screen') {
    const screener = addTool(api, 'screener', { group: 'A' })
    const chart = addTool(api, 'chart', { group: 'A' }, { referencePanel: screener.id, direction: 'right' }, { w: 680 })
    addTool(api, 'company', { group: 'A', view: 'overview' }, { referencePanel: chart.id, direction: 'below' })
    width(chart, W * 0.42)
  } else {
    addScreen(api, '/')
  }
}

export function Terminal() {
  useMarketSubscription()
  useResearchSubscription()
  const theme = useTheme().data ?? 'terminal'
  useEffect(() => {
    document.documentElement.classList.toggle('terminal', theme === 'terminal')
  }, [theme])

  const saved = useWorkspaces()
  const [list, setList] = useState<SavedWorkspace[] | null>(null)
  const [active, setActive] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) ?? 'home'
    } catch {
      return 'home'
    }
  })
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const listRef = useRef<SavedWorkspace[] | null>(null)
  const activeRef = useRef(active)
  const loading = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (saved.data && !listRef.current) {
      const l = saved.data.length ? saved.data : STARTERS
      listRef.current = l
      setList(l)
    }
  }, [saved.data])

  const persist = useCallback((next: SavedWorkspace[]) => {
    listRef.current = next
    setList(next)
    void saveWorkspaces(next).catch(() => {})
  }, [])

  const load = useCallback((id: string) => {
    const api = apiRef.current
    if (!api || !listRef.current?.length) return
    // Keep the workspace being left exactly as it is now, rather than as of the last timed save.
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const cur = listRef.current
    if (cur && api.panels.length > 0 && !loading.current) {
      const leaving = api.toJSON()
      const next = cur.map((w) => (w.id === activeRef.current ? { ...w, layout: leaving } : w))
      listRef.current = next
      setList(next)
      void saveWorkspaces(next).catch(() => {})
    }
    const ws = listRef.current.find((w) => w.id === id) ?? listRef.current[0]
    loading.current = true
    api.clear()
    try {
      if (ws.layout) api.fromJSON(ws.layout as Parameters<DockviewApi['fromJSON']>[0])
      else build(api, ws.id)
    } catch {
      api.clear()
      build(api, ws.id)
    }
    if (api.panels.length === 0) build(api, 'empty')
    loading.current = false
    setActive(ws.id)
    activeRef.current = ws.id
    try {
      localStorage.setItem(ACTIVE_KEY, ws.id)
    } catch {
      // Not kept: the first workspace opens next time.
    }
  }, [])

  // Every change to the arrangement (and each tab's screen) is saved a moment later.
  const scheduleSave = useCallback(() => {
    if (loading.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const api = apiRef.current
      const cur = listRef.current
      if (!api || !cur) return
      persist(cur.map((w) => (w.id === activeRef.current ? { ...w, layout: api.toJSON() } : w)))
    }, 700)
  }, [persist])

  const onReady = (e: DockviewReadyEvent) => {
    apiRef.current = e.api
    e.api.onDidLayoutChange(scheduleSave)
    if (listRef.current) load(activeRef.current)
  }
  useEffect(() => {
    if (list && apiRef.current && apiRef.current.panels.length === 0) load(activeRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const terminal: TerminalApi = useMemo(
    () => ({
      openScreen(route, opts = {}) {
        const api = apiRef.current
        if (!api) return
        const focused = api.activePanel
        const go = focused && !opts.newTab ? navigators.get(focused.id) : undefined
        if (focused && go) {
          go(route)
          focused.api.setActive()
          return
        }
        const p = addScreen(api, route, focused ? { referencePanel: focused.id, direction: 'within' } : undefined)
        p.api.setActive()
      },
      openPanel(kind, params = {}) {
        const api = apiRef.current
        if (!api || !PANELS[kind]) return
        const focused = api.activePanel
        addTool(api, kind, params as PanelParams, focused ? { referencePanel: focused.id, direction: 'right' } : undefined)
      },
      openMenu: () => setMenu(true)
    }),
    []
  )

  const maximise = () => {
    const api = apiRef.current
    const p = api?.activePanel
    if (!api || !p) return
    if (api.hasMaximizedGroup()) api.exitMaximizedGroup()
    else api.maximizeGroup(p)
  }
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }
  const reset = () => {
    const api = apiRef.current
    if (!api || !confirm('Put this workspace back to its starting layout? Its tabs are closed.')) return
    loading.current = true
    api.clear()
    build(api, STARTERS.some((s) => s.id === activeRef.current) ? activeRef.current : 'empty')
    loading.current = false
    scheduleSave()
  }
  const newWorkspace = () => {
    const id = newId('ws')
    persist([...(listRef.current ?? []), { id, name: `Workspace ${(listRef.current?.length ?? 0) + 1}`, layout: null }])
    load(id)
  }
  const closeWorkspace = (id: string) => {
    const cur = listRef.current ?? []
    const w = cur.find((x) => x.id === id)
    if (cur.length <= 1 || !w || !confirm(`Close the workspace “${w.name}”? Its tabs and layout are forgotten.`)) return
    const next = cur.filter((x) => x.id !== id)
    persist(next)
    if (id === activeRef.current) load(next[0].id)
  }

  // Keys: F1–F10, Ctrl+T (menu), Ctrl+W (close tab), Alt+1–9 (workspaces), Ctrl+Shift+F (maximise), F11.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = FKEYS.find((k) => k.key === e.key)
      if (f && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        if (f.menu) setMenu((m) => !m)
        else if (f.panel) terminal.openPanel(f.panel)
        else if (f.route) terminal.openScreen(f.route, { newTab: e.shiftKey })
      } else if (e.key === 'F11') {
        e.preventDefault()
        fullScreen()
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setMenu(true)
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        apiRef.current?.activePanel?.api.close()
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const w = listRef.current?.[Number(e.key) - 1]
        if (w) {
          e.preventDefault()
          load(w.id)
        }
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        maximise()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal])

  return (
    <TerminalCtx.Provider value={terminal}>
      <div className="flex h-full flex-col bg-paper text-ink">
        <TopBar onMenu={() => setMenu(true)} />
        <div className="flex h-8 shrink-0 items-stretch gap-3 border-b border-rule bg-sheet px-2 text-[12px]">
          <nav aria-label="Function keys" className="flex items-center gap-1">
            {FKEYS.map((k) => (
              <button
                key={k.key}
                type="button"
                title={k.route ? `${k.label} (Shift+${k.key} in a new tab)` : k.label}
                onClick={(e) => (k.menu ? setMenu(true) : k.panel ? terminal.openPanel(k.panel) : terminal.openScreen(k.route!, { newTab: e.ctrlKey || e.shiftKey }))}
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-ink-muted hover:bg-paper hover:text-ink"
              >
                <kbd className="rounded-[2px] bg-stamp px-1 font-mono text-[10.5px] font-bold text-black">{k.key}</kbd>
                {k.label}
              </button>
            ))}
          </nav>
          <div role="tablist" aria-label="Workspaces" className="ml-auto flex items-center gap-0.5">
            {(list ?? []).map((w, i) =>
              renaming === w.id ? (
                <form
                  key={w.id}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const name = (new FormData(e.currentTarget).get('name') as string).trim()
                    if (name) persist((listRef.current ?? []).map((x) => (x.id === w.id ? { ...x, name } : x)))
                    setRenaming(null)
                  }}
                >
                  <input
                    name="name"
                    autoFocus
                    defaultValue={w.name}
                    onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                    aria-label="Workspace name"
                    className="w-32 rounded-sm border border-stamp bg-transparent px-1.5 text-[12px] focus:outline-none"
                  />
                </form>
              ) : (
                <span key={w.id} className="group flex items-center">
                  <button
                    role="tab"
                    aria-selected={w.id === active}
                    title={`Alt+${i + 1}. Double-click to rename.`}
                    onClick={() => w.id !== active && load(w.id)}
                    onDoubleClick={() => setRenaming(w.id)}
                    className={'rounded-sm px-2 py-0.5 ' + (w.id === active ? 'bg-stamp-wash font-semibold text-stamp' : 'text-ink-muted hover:text-ink')}
                  >
                    {w.name}
                  </button>
                  {(list?.length ?? 0) > 1 && (
                    <button type="button" aria-label={`Close ${w.name}`} onClick={() => closeWorkspace(w.id)} className="invisible px-0.5 text-ink-muted group-hover:visible hover:text-loss">
                      ×
                    </button>
                  )}
                </span>
              )
            )}
            <button type="button" onClick={newWorkspace} title="A new workspace" className="rounded-sm px-1.5 text-stamp hover:bg-paper">
              +
            </button>
          </div>
          <div className="flex items-center gap-1 border-l border-rule pl-2">
            <ToolButton onClick={maximise} title="Maximise the panel you are on (Ctrl+Shift+F)">
              Maximise
            </ToolButton>
            <ToolButton onClick={fullScreen} title="Full screen (F11)">
              Full screen
            </ToolButton>
            <ToolButton onClick={reset} title="Back to this workspace's starting layout">
              Reset
            </ToolButton>
          </div>
        </div>
        <div className="fp-dock min-h-0 flex-1">
          <DockviewReact
            theme={themeDark}
            components={{ screen: ScreenPanel, ...PANEL_COMPONENTS }}
            watermarkComponent={Watermark}
            onReady={onReady}
            className="h-full"
          />
        </div>
        <StatusBar />
      </div>
      {menu && <Menu onClose={() => setMenu(false)} />}
      <ErrorBoundary resetKey="ask">
        <AskPanel />
      </ErrorBoundary>
      <GoTo />
    </TerminalCtx.Provider>
  )
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { scope, setScope } = useScope()
  const persons = usePersons().data ?? []
  const tabs: { id: Scope; label: string }[] = [...persons.map((p) => ({ id: p.id as Scope, label: p.name })), { id: 'family', label: 'Family' }]
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-rule-strong bg-black px-3">
      <div className="flex items-baseline gap-2">
        <span className="wide text-[15px] font-bold tracking-tight text-stamp">FAMILY PORTFOLIO</span>
        <span className="hidden text-[11px] text-ink-muted xl:inline">kept on this computer</span>
      </div>
      <div role="tablist" aria-label="Whose investments" className="flex rounded-sm border border-rule">
        {tabs.map((t) => (
          <button
            key={String(t.id)}
            role="tab"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            className={'px-2.5 py-0.5 text-[12.5px] ' + (scope === t.id ? 'bg-stamp font-semibold text-black' : 'text-ink-muted hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={openGoTo}
        aria-label="Command line"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm border border-rule bg-paper px-2.5 text-left text-[13px] text-ink-muted hover:border-stamp"
      >
        <span aria-hidden className="font-mono text-stamp">&gt;</span>
        <span className="truncate">Screen, code (HOLD, FARM, SCR) or company (INFY, INFY FIN)</span>
        <kbd className="ml-auto shrink-0 font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <button type="button" onClick={onMenu} className="rounded-sm border border-rule px-2.5 py-1 text-[12.5px] text-ink hover:border-stamp">
        Menu
      </button>
      <button type="button" onClick={openAsk} className="rounded-sm bg-stamp px-2.5 py-1 text-[12.5px] font-semibold text-black hover:brightness-110">
        Ask your money
      </button>
    </header>
  )
}

/** Indices, currency, oil and gold along the bottom (Yahoo Finance, delayed). */
const TICKER: { symbol: string; label: string }[] = [
  { symbol: '^NSEI', label: 'NIFTY' },
  { symbol: '^BSESN', label: 'SENSEX' },
  { symbol: '^NSEBANK', label: 'BANKNIFTY' },
  { symbol: '^CNXIT', label: 'NIFTY IT' },
  { symbol: 'USDINR=X', label: 'USD/INR' },
  { symbol: 'BZ=F', label: 'BRENT' },
  { symbol: 'GC=F', label: 'GOLD' },
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' }
]

function StatusBar() {
  const quotes = useQuotes(TICKER.map((t) => t.symbol))
  const home = useResearchHome()
  const s = home.data?.status
  const by = new Map((quotes.data ?? []).map((q) => [q.symbol, q]))
  const items = TICKER.filter((t) => by.has(t.symbol))
  const tape = items.map((t) => {
    const q = by.get(t.symbol)!
    return (
      <span key={t.symbol} className="mr-6 whitespace-nowrap">
        <span className="text-ink-muted">{t.label}</span> <span className="num text-ink">{q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>{' '}
        <span className={`num ${toneClass(q.change)}`}>{percent(q.change)}</span>
      </span>
    )
  })
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-rule-strong bg-black px-3 text-[11.5px] text-ink-muted">
      <LiveStatus />
      <div className="ticker relative min-w-0 flex-1 overflow-hidden" aria-label="Markets ticker">
        {items.length > 0 && (
          <div className="ticker-track flex w-max">
            <div className="flex">{tape}</div>
            <div className="flex" aria-hidden>
              {tape}
            </div>
          </div>
        )}
      </div>
      {s && s.enabled && s.state !== 'DONE' && (
        <span className="whitespace-nowrap" title="Company results downloading in the background">
          Results {s.companiesDone.toLocaleString('en-IN')}/{s.companies.toLocaleString('en-IN')}
          {s.history.days < s.history.want ? `, prices ${s.history.days}/${s.history.want} days` : ''}
        </span>
      )}
      <Clock />
    </footer>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="num whitespace-nowrap text-ink" title="Indian Standard Time">
      {now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })} IST
    </span>
  )
}

function Watermark() {
  return (
    <div className="grid h-full place-items-center text-center text-[13.5px] text-ink-muted">
      <div>
        <p className="wide mb-1 text-[16px] text-ink">No tabs open</p>
        <p>
          Press <kbd className="font-mono text-stamp">F10</kbd> for the menu, <kbd className="font-mono text-stamp">Ctrl K</kbd> for the command line, or a function key.
        </p>
      </div>
    </div>
  )
}

const ToolButton = ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type="button" className="rounded-sm px-1.5 py-0.5 text-ink-muted hover:bg-paper hover:text-ink" {...rest}>
    {children}
  </button>
)
