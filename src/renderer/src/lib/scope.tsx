import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Whose money the screens show: one person, or the whole family. */
export type Scope = number | 'family'

const ScopeContext = createContext<{ scope: Scope; setScope: (s: Scope) => void }>({
  scope: 'family',
  setScope: () => {}
})

const KEY = 'scope'

function readStored(): Scope {
  try {
    const v = localStorage.getItem(KEY)
    if (v && v !== 'family' && Number.isFinite(Number(v))) return Number(v)
  } catch {
    /* storage unavailable */
  }
  return 'family'
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>(readStored)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(scope))
    } catch {
      /* storage unavailable */
    }
  }, [scope])
  return <ScopeContext.Provider value={{ scope, setScope }}>{children}</ScopeContext.Provider>
}

export const useScope = () => useContext(ScopeContext)
export const scopePersonId = (s: Scope) => (s === 'family' ? undefined : s)
