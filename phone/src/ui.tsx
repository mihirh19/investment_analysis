import { useEffect, useId, type ReactNode } from 'react'
import { lakhCrore, money } from '../../src/renderer/src/lib/format'

export { lakhCrore, money }
export const inr = (v: number | null | undefined) => money(v, 'INR', 0)
export const today = () => new Date().toISOString().slice(0, 10)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const day = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`
}
export const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}`
export const tone = (v: number | null | undefined) => (!v ? 'text-ink-muted' : v > 0 ? 'text-gain' : 'text-loss')
export const signed = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${inr(Math.abs(v))}`

export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-3 rounded-2xl bg-sheet px-4 py-3.5 shadow-[0_1px_0_var(--rule)]">
      {title && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {aside && <div className="text-[13px] text-ink-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** One choice among a few, as a pill row (whose money; which tab of a section). */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 overflow-x-auto rounded-full bg-rule/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            'min-h-9 flex-1 whitespace-nowrap rounded-full px-3 text-[14px] ' +
            (value === o.value ? 'bg-sheet font-semibold text-ink shadow-sm' : 'text-ink-muted')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A bottom sheet for entering something; closes on the backdrop or Escape. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="safe-bottom max-h-[88vh] overflow-y-auto rounded-t-3xl bg-paper px-4 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-rule-strong" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 id={id} className="text-[18px] font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="min-h-10 px-2 text-[15px] text-stamp">
            Cancel
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="mb-3 flex flex-col gap-1">
      <span className="text-[14px] text-ink-muted">{text}</span>
      {children}
    </label>
  )
}

export const field = 'min-h-11 w-full rounded-xl border border-rule-strong bg-sheet px-3 text-ink'

export function Primary({ children, disabled, onClick, type = 'button' }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="min-h-12 w-full rounded-xl bg-stamp px-4 text-[16px] font-semibold text-white disabled:opacity-50 dark:text-[#10162a]"
    >
      {children}
    </button>
  )
}

/** Net worth over time: a quiet area with the latest point marked. */
export function Trend({ values, height = 72 }: { values: number[]; height?: number }) {
  const pts = values.filter((v) => Number.isFinite(v))
  if (pts.length < 2) return null
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const w = 320
  const y = (v: number) => height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8)
  const x = (i: number) => (i / (pts.length - 1)) * w
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" role="img" aria-label="Net worth over time">
      <path d={`${line}L${w},${height}L0,${height}Z`} fill="var(--series-1)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3.5" fill="var(--series-1)" stroke="var(--sheet)" strokeWidth="2" />
    </svg>
  )
}
