import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The app's own HTML tooltip, shared by every chart so hover, keyboard focus and the canvas charts
// all show the same card.

interface Tip {
  x: number
  y: number
  content: ReactNode
}

export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const show = useCallback(
    (e: { clientX: number; clientY: number }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }),
    []
  )
  const showAt = useCallback((el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, content })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  // Portalled to <body>: the page's entrance animation leaves a transform on an ancestor, which would
  // otherwise make `position: fixed` relative to the page instead of the window.
  const node = tip ? createPortal(
    <div
      role="tooltip"
      aria-live="polite"
      className="pointer-events-none fixed z-50 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[13px] shadow-lg"
      style={{
        left: Math.min(tip.x + 14, window.innerWidth - 240),
        top: Math.max(8, tip.y - 12),
        transform: tip.y < 90 ? 'translateY(24px)' : 'translateY(-100%)'
      }}
    >
      {tip.content}
    </div>,
    document.body
  ) : null
  return { show, showAt, hide, node }
}

export function TipRow({
  color,
  label,
  value,
  line = false
}: {
  color?: string
  label: string
  value: string
  line?: boolean
}) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {color && (
        <span
          aria-hidden
          className={line ? 'inline-block h-[2px] w-3 rounded' : 'inline-block size-2.5 rounded-[2px]'}
          style={{ background: color }}
        />
      )}
      <span className="num font-semibold text-ink">{value}</span>
      <span className="text-ink-muted">{label}</span>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={i.dashed ? 'inline-block h-0 w-3.5 border-t-2 border-dashed' : 'inline-block size-2.5 rounded-[2px]'}
            style={i.dashed ? { borderColor: i.color } : { background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  )
}
