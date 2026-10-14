import { createContext, useContext, useState, type ReactNode } from 'react'

// One period choice shared by the Overview, Analysis and Performance charts, remembered between runs.

import { PERIODS, type Period } from './periods'

export { PERIODS, periodStartDate, periodStartIndex, type Period } from './periods'

const KEY = 'ui:period'
const Ctx = createContext<{ period: Period; setPeriod: (p: Period) => void }>({ period: '3Y', setPeriod: () => {} })

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, set] = useState<Period>(() => {
    const v = localStorage.getItem(KEY) as Period | null
    return v && PERIODS.some((p) => p.key === v) ? v : '3Y'
  })
  const setPeriod = (p: Period) => {
    localStorage.setItem(KEY, p)
    set(p)
  }
  return <Ctx.Provider value={{ period, setPeriod }}>{children}</Ctx.Provider>
}

export const usePeriod = () => useContext(Ctx)

export function PeriodPicker({ className = '' }: { className?: string }) {
  const { period, setPeriod } = usePeriod()
  return (
    <div role="radiogroup" aria-label="Period" className={`flex gap-1 ${className}`}>
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          role="radio"
          aria-checked={period === p.key}
          title={p.title}
          onClick={() => setPeriod(p.key)}
          className={
            'rounded px-2.5 py-0.5 text-[13px] whitespace-nowrap transition-colors ' +
            (period === p.key ? 'bg-stamp-wash font-medium text-stamp' : 'text-ink-muted hover:bg-sheet')
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export const periodTitle = (p: Period) => PERIODS.find((x) => x.key === p)!.title.toLowerCase()
