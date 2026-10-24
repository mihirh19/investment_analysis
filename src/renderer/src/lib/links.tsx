import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { useTerminal } from './terminal'

// Linking, as in trading terminals: panels on the same colour follow one symbol. Clicking a stock
// in a linked screener or watchlist moves every panel of that colour to it.

export type LinkGroup = 'A' | 'B' | 'C' | 'D'
export const LINK_GROUPS: { key: LinkGroup; colour: string; label: string }[] = [
  { key: 'A', colour: 'var(--stamp)', label: 'Amber' },
  { key: 'B', colour: 'var(--series-2)', label: 'Blue' },
  { key: 'C', colour: 'var(--series-4)', label: 'Pink' },
  { key: 'D', colour: 'var(--gain)', label: 'Green' }
]

const STORE = 'ws:links'
const DEFAULTS: Record<LinkGroup, string> = { A: 'RELIANCE', B: 'TCS', C: 'HDFCBANK', D: 'INFY' }

interface Links {
  symbols: Record<LinkGroup, string>
  set(group: LinkGroup, symbol: string): void
}
const LinksCtx = createContext<Links | null>(null)

export function LinksProvider({ children }: { children: ReactNode }) {
  const [symbols, setSymbols] = useState<Record<LinkGroup, string>>(() => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<LinkGroup, string>>) }
    } catch {
      return DEFAULTS
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(symbols))
    } catch {
      // Not kept; the groups start from their defaults next time.
    }
  }, [symbols])
  const set = useCallback((group: LinkGroup, symbol: string) => {
    const s = symbol.trim().toUpperCase()
    if (s) setSymbols((cur) => (cur[group] === s ? cur : { ...cur, [group]: s }))
  }, [])
  const value = useMemo(() => ({ symbols, set }), [symbols, set])
  return <LinksCtx.Provider value={value}>{children}</LinksCtx.Provider>
}

export function useLinks(): Links {
  const l = useContext(LinksCtx)
  if (!l) throw new Error('useLinks needs a LinksProvider')
  return l
}

const OpenCtx = createContext<((symbol: string) => void) | null>(null)
/** Inside a workspace panel, opening a stock moves the panel's link group to it. */
export const OpenSymbolProvider = OpenCtx.Provider

/**
 * What clicking a stock does here: in a linked panel, move its link colour; inside a screen tab,
 * open the company in that tab; in a tool panel with no link, open it in a new tab.
 */
export function useOpenSymbol(): (symbol: string) => void {
  const ctx = useContext(OpenCtx)
  const terminal = useTerminal()
  const inRouter = useInRouterContext()
  // Whether a router is around never changes for a mounted component, so the hook order is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navigate = inRouter ? useNavigate() : null
  return (
    ctx ??
    ((s: string) => {
      const route = `/research/${encodeURIComponent(s)}`
      if (navigate) navigate(route)
      else terminal?.openScreen(route, { newTab: true })
    })
  )
}
