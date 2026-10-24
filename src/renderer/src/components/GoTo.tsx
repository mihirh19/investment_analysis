import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompanySearch } from '../lib/api'
import { SECTIONS } from '../lib/nav'

const OPEN_EVENT = 'fp:open-goto'
/** Opens the "Go to" box from anywhere (the sidebar button, Ctrl+K). */
export const openGoTo = () => window.dispatchEvent(new Event(OPEN_EVENT))

interface Item {
  key: string
  label: string
  hint: string
  to: string
}

const PAGES: Item[] = SECTIONS.flatMap((s) =>
  s.pages.map((p) => ({ key: p.to, label: p.label, hint: s.pages.length > 1 ? s.label : 'Page', to: p.to }))
)

/** Ctrl+K: type a page or a company and press Enter. */
export function GoTo() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const companies = useCompanySearch(open ? query : '')

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
    const pages = q ? PAGES.filter((p) => `${p.label} ${p.hint}`.toLowerCase().includes(q)) : PAGES
    const firms: Item[] =
      q.length >= 2
        ? (companies.data ?? []).slice(0, 8).map((c) => ({
            key: `c:${c.symbol}`,
            label: c.name,
            hint: c.held ? `${c.symbol} · you hold it` : c.symbol,
            to: `/research/${encodeURIComponent(c.symbol)}`
          }))
        : []
    return [...pages.slice(0, q ? 6 : PAGES.length), ...firms]
  }, [query, companies.data])

  if (!open) return null
  const go = (it: Item | undefined) => {
    if (!it) return
    setOpen(false)
    navigate(it.to)
  }
  const current = Math.min(active, items.length - 1)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go to a page or company"
        className="w-[min(560px,92vw)] overflow-hidden rounded-lg border border-rule-strong bg-sheet shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
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
            } else if (e.key === 'Enter') go(items[current])
          }}
          placeholder="Go to a page, or type a company (TCS, Infosys…)"
          className="w-full border-b border-rule bg-transparent px-4 py-3 text-[16px] outline-none placeholder:text-ink-muted"
        />
        <ul id="goto-list" role="listbox" aria-label="Matches" className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`goto-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it)}
              className={
                'flex cursor-pointer items-baseline justify-between gap-4 px-4 py-1.5 text-[14.5px] ' +
                (i === current ? 'bg-stamp-wash text-stamp' : 'text-ink')
              }
            >
              <span className="truncate">{it.label}</span>
              <span className="shrink-0 text-[12.5px] text-ink-muted">{it.hint}</span>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-4 py-3 text-[14px] text-ink-muted">
              {companies.isFetching ? 'Looking…' : 'Nothing by that name. Try a stock symbol such as INFY.'}
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
