import { useEffect, useMemo, useRef, useState } from 'react'
import { useCompanySearch } from '../lib/api'
import { ALL_PAGES } from '../lib/nav'
import { useTerminal } from '../lib/terminal'
import { PANELS } from './workspace/panels'
import { parseCommand } from '../pages/Research'

const OPEN_EVENT = 'fp:open-goto'
/** Opens the command line from anywhere (the top bar, Ctrl+K). */
export const openGoTo = () => window.dispatchEvent(new Event(OPEN_EVENT))

interface Item {
  key: string
  label: string
  hint: string
  code?: string
  run: (newTab: boolean) => void
}

/**
 * The command line: a screen by name or code (HOLD, FARM, SCR…), a tool panel (Chart, Watchlist…),
 * or a company ("INFY", "INFY FIN"). Enter opens it in the tab you are on; Ctrl+Enter in a new tab.
 */
export function GoTo() {
  const terminal = useTerminal()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { query: company, view } = parseCommand(query)
  const companies = useCompanySearch(open ? company : '')

  useEffect(() => {
    const show = () => {
      setQuery('')
      setActive(0)
      setOpen(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      }
    }
    window.addEventListener(OPEN_EVENT, show)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, show)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const screens: Item[] = ALL_PAGES.map((p) => ({
      key: p.to,
      label: p.label,
      hint: p.section,
      code: p.code,
      run: (newTab: boolean) => terminal?.openScreen(p.to, { newTab })
    }))
    const tools: Item[] = Object.entries(PANELS).map(([k, v]) => ({
      key: `panel:${k}`,
      label: `${v.title} panel`,
      hint: v.about,
      run: () => terminal?.openPanel(k)
    }))
    const match = (it: Item) => !q || it.code?.toLowerCase() === q || `${it.label} ${it.hint} ${it.code ?? ''}`.toLowerCase().includes(q)
    // A code typed exactly comes first.
    const found = [...screens, ...tools].filter(match).sort((a, b) => Number(b.code?.toLowerCase() === q) - Number(a.code?.toLowerCase() === q))
    const firms: Item[] =
      company.length >= 2
        ? (companies.data ?? []).slice(0, 8).map((c) => ({
            key: `c:${c.symbol}`,
            label: c.name,
            hint: c.held ? `${c.symbol} · you hold it` : c.symbol,
            run: (newTab: boolean) =>
              terminal?.openScreen(`/research/${encodeURIComponent(c.symbol)}${view && view !== 'overview' ? `?view=${view}` : ''}`, { newTab })
          }))
        : []
    return [...found.slice(0, q ? 8 : found.length), ...firms]
  }, [query, companies.data, company, view, terminal])

  if (!open) return null
  const go = (it: Item | undefined, newTab: boolean) => {
    if (!it) return
    setOpen(false)
    it.run(newTab)
  }
  const current = Math.min(active, items.length - 1)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command line"
        className="w-[min(640px,92vw)] overflow-hidden rounded-sm border border-stamp bg-sheet shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-rule px-3">
          <span aria-hidden className="font-mono text-[15px] text-stamp">&gt;</span>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="goto-list"
            aria-activedescendant={items[current] ? `goto-${current}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') go(items[current], e.ctrlKey || e.metaKey)
            }}
            placeholder="Screen, code (HOLD, FARM, SCR) or company (INFY, INFY FIN)"
            className="w-full bg-transparent py-2.5 text-[15px] outline-none placeholder:text-ink-muted"
          />
        </div>
        <ul id="goto-list" role="listbox" aria-label="Matches" className="max-h-[55vh] overflow-y-auto py-1">
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`goto-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => go(it, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => e.button === 1 && go(it, true)}
              className={'flex cursor-pointer items-baseline gap-3 px-3 py-1 text-[14px] ' + (i === current ? 'bg-stamp-wash text-stamp' : 'text-ink')}
            >
              <span className="w-12 shrink-0 font-mono text-[11.5px] font-semibold text-stamp">{it.code ?? ''}</span>
              <span className="truncate">{it.label}</span>
              <span className="ml-auto shrink-0 text-[12px] text-ink-muted">{it.hint}</span>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-3 text-[13.5px] text-ink-muted">{companies.isFetching ? 'Looking…' : 'Nothing by that name. Try a code such as HOLD, or a stock symbol such as INFY.'}</li>
          )}
        </ul>
        <div className="border-t border-rule px-3 py-1 text-[11.5px] text-ink-muted">Enter opens here · Ctrl+Enter in a new tab · Esc closes</div>
      </div>
    </div>
  )
}
