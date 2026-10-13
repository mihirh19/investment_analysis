import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { stagger } from '../lib/motion'
import { niceTicks } from '../lib/ticks'

// Small hand-built charts following the app's data-viz rules: thin marks, 4px rounded data-ends,
// 2px surface gaps between touching fills, hairline solid grid, hover + focus tooltips.
// Every chart here sits next to a table that carries the same numbers.

// ---------------- tooltip ----------------

interface Tip {
  x: number
  y: number
  content: ReactNode
}

export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) =>
    setTip({ x: e.clientX, y: e.clientY, content })
  const showAt = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, content })
  }
  const hide = () => setTip(null)
  const node = tip ? (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[13px] shadow-lg"
      style={{
        left: Math.min(tip.x + 14, window.innerWidth - 240),
        top: Math.max(8, tip.y - 12),
        transform: 'translateY(-100%)'
      }}
    >
      {tip.content}
    </div>
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

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

// ---------------- 100% stacked bar (part-to-whole) ----------------

export interface Segment {
  key: string
  label: string
  value: number
  color: string
}

export function StackBar({
  segments,
  format,
  label
}: {
  segments: Segment[]
  format: (v: number) => string
  label: string
}) {
  const tip = useTooltip()
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (total <= 0) return null
  const parts = segments.filter((s) => s.value > 0)
  return (
    <div role="group" aria-label={label} className="anim-grow-x flex h-3.5 w-full gap-[2px]">
      {parts.map((s, i) => {
        const share = s.value / total
        const content = (
          <TipRow color={s.color} label={`${s.label}, ${(share * 100).toFixed(1)}%`} value={format(s.value)} />
        )
        return (
          <div
            key={s.key}
            tabIndex={0}
            aria-label={`${s.label}: ${format(s.value)}, ${(share * 100).toFixed(1)}%`}
            className={
              'min-w-[2px] cursor-default outline-offset-2 transition-[filter] hover:brightness-110 focus-visible:brightness-110 ' +
              (i === 0 ? 'rounded-l-[4px] ' : '') +
              (i === parts.length - 1 ? 'rounded-r-[4px]' : '')
            }
            style={{ flexGrow: share, flexBasis: 0, background: s.color }}
            onPointerMove={(e) => tip.show(e, content)}
            onPointerLeave={tip.hide}
            onFocus={(e) => tip.showAt(e.currentTarget, content)}
            onBlur={tip.hide}
          />
        )
      })}
      {tip.node}
    </div>
  )
}

// ---------------- horizontal bars (ranked categories, optionally two stacked parts) ----------------

export interface BarRow {
  key: string
  label: string
  sublabel?: string
  values: number[]
}

export function HBars({
  rows,
  series,
  format,
  label,
  onSelect,
  selected
}: {
  rows: BarRow[]
  series: { label: string; color: string }[]
  format: (v: number) => string
  label: string
  /** Makes each row a button that opens its detail. */
  onSelect?: (key: string) => void
  selected?: string | null
}) {
  const tip = useTooltip()
  const max = Math.max(...rows.map((r) => r.values.reduce((a, b) => a + b, 0)), 0)
  if (max <= 0) return null
  return (
    <figure aria-label={label} className="m-0">
      {series.length > 1 && <Legend items={series} />}
      <div className="flex flex-col">
        {rows.map((r, ri) => {
          const total = r.values.reduce((a, b) => a + b, 0)
          const content = (
            <div className="flex flex-col gap-0.5">
              <div className="mb-0.5 font-medium text-ink">{r.label}</div>
              {series.length > 1 &&
                series.map(
                  (s, i) =>
                    r.values[i] > 0 && (
                      <TipRow key={s.label} color={s.color} label={s.label} value={format(r.values[i])} />
                    )
                )}
              <TipRow label={series.length > 1 ? 'Total' : series[0].label} value={format(total)} />
            </div>
          )
          const parts = r.values.map((v, i) => ({ v, color: series[i].color })).filter((p) => p.v > 0)
          return (
            <div
              key={r.key}
              tabIndex={0}
              role={onSelect ? 'button' : undefined}
              aria-pressed={onSelect ? selected === r.key : undefined}
              aria-label={`${r.label}: ${format(total)}`}
              className={
                'grid grid-cols-[minmax(140px,240px)_1fr] items-center gap-4 rounded-sm py-[5px] outline-offset-1 hover:bg-sheet/70 ' +
                (onSelect ? 'cursor-pointer ' : '') +
                (selected === r.key ? 'bg-stamp-wash shadow-[inset_3px_0_0_var(--stamp)]' : '')
              }
              onPointerMove={(e) => tip.show(e, content)}
              onPointerLeave={tip.hide}
              onFocus={(e) => tip.showAt(e.currentTarget, content)}
              onBlur={tip.hide}
              onClick={onSelect ? () => onSelect(r.key) : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(r.key)
                      }
                    }
                  : undefined
              }
            >
              <div className={'min-w-0 truncate text-[14px] ' + (onSelect ? 'pl-2' : '')} title={r.label}>
                {r.label}
                {r.sublabel && <span className="ml-2 text-[12px] text-ink-muted">{r.sublabel}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="anim-grow-x flex h-3 gap-[2px]"
                  style={{ width: `calc((100% - 96px) * ${total / max})`, ...stagger(ri) }}
                >
                  {parts.map((p, i) => (
                    <div
                      key={i}
                      className={'min-w-[2px] ' + (i === parts.length - 1 ? 'rounded-r-[4px]' : '')}
                      style={{ flexGrow: p.v, flexBasis: 0, background: p.color }}
                    />
                  ))}
                </div>
                <span className="num text-[13px] text-ink-muted">{format(total)}</span>
              </div>
            </div>
          )
        })}
      </div>
      {tip.node}
    </figure>
  )
}

// ---------------- columns (one series over periods) ----------------

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function Columns({
  points,
  format,
  axisFormat,
  label,
  seriesLabel,
  height = 200
}: {
  points: { key: string; label: string; value: number }[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  seriesLabel: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTooltip()
  const max = Math.max(0, ...points.map((p) => p.value))
  if (points.length === 0 || max <= 0) return <div ref={ref} />
  const ticks = niceTicks(0, max, 4)
  const top = ticks[ticks.length - 1]
  const padL = 56
  const padB = 24
  const padT = 18
  const plotW = width - padL
  const plotH = height - padB - padT
  const band = plotW / points.length
  const barW = Math.min(24, band * 0.6)
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const labelled = new Set([points.reduce((a, b) => (b.value > a.value ? b : a)).key, points[points.length - 1].key])

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth={1} />
            <text
              x={padL - 8}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="num fill-[var(--ink-muted)] text-[11px]"
            >
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = padL + band * i + band / 2
          const h = Math.max(0, y(0) - y(p.value))
          const x0 = cx - barW / 2
          const r = Math.min(4, h, barW / 2)
          const yTop = y(p.value)
          const content = (
            <TipRow color="var(--series-1)" label={`${seriesLabel}, ${p.label}`} value={format(p.value)} />
          )
          return (
            <g key={p.key}>
              {h > 0 && (
                <path
                  d={`M${x0},${y(0)} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${y(0)} Z`}
                  fill="var(--series-1)"
                  className="anim-grow-y"
                  style={stagger(i, 50)}
                />
              )}
              {labelled.has(p.key) && h > 0 && (
                <text x={cx} y={yTop - 6} textAnchor="middle" className="num fill-[var(--ink)] text-[11px] font-medium">
                  {axisFormat(p.value)}
                </text>
              )}
              <text x={cx} y={height - 6} textAnchor="middle" className="fill-[var(--ink-muted)] text-[11px]">
                {p.label}
              </text>
              {/* Hit target: the whole band, not just the painted bar. */}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${p.label}: ${format(p.value)}`}
                className="outline-none focus-visible:fill-[var(--stamp-wash)] hover:fill-[var(--stamp-wash)]"
                style={{ fillOpacity: 0.5 }}
                onPointerMove={(e) => tip.show(e, content)}
                onPointerLeave={tip.hide}
                onFocus={(e) => tip.showAt(e.currentTarget, content)}
                onBlur={tip.hide}
              />
            </g>
          )
        })}
        <line x1={padL} x2={width} y1={y(0)} y2={y(0)} stroke="var(--rule-strong)" strokeWidth={1} />
      </svg>
      {tip.node}
    </div>
  )
}

// ---------------- price line with crosshair ----------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

export function PriceLine({
  points,
  format,
  axisFormat,
  label,
  reference,
  height = 240
}: {
  points: { date: string; close: number }[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  /** A horizontal reference, e.g. the average purchase price. */
  reference?: { value: number; label: string } | null
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 60
  const padR = 64
  const padT = 12
  const padB = 24
  const geo = useMemo(() => {
    if (points.length < 2) return null
    const values = points.map((p) => p.close).concat(reference ? [reference.value] : [])
    const ticks = niceTicks(Math.min(...values), Math.max(...values), 4)
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const plotW = width - padL - padR
    const plotH = height - padT - padB
    const x = (i: number) => padL + (i / (points.length - 1)) * plotW
    const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join(' ')
    const area = `${d} L${x(points.length - 1)},${padT + plotH} L${padL},${padT + plotH} Z`
    // One x label per month boundary, thinned to fit.
    const monthStarts = points
      .map((p, i) => ({ i, m: p.date.slice(0, 7) }))
      .filter((p, k, a) => k === 0 || p.m !== a[k - 1].m)
    const every = Math.ceil(monthStarts.length / Math.max(2, Math.floor(plotW / 70)))
    const xTicks = monthStarts.filter((_, k) => k % every === 0)
    return { ticks, x, y, d, area, xTicks, plotH }
  }, [points, width, height, reference])

  if (!geo)
    return (
      <div ref={ref} className="py-10 text-[14px] text-ink-muted">
        Not enough price history to draw a chart.
      </div>
    )
  const last = points[points.length - 1]
  const h = hover !== null ? points[hover] : null

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1)))))
  }

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--rule)" strokeWidth={1} />
            <text
              x={padL - 8}
              y={geo.y(t)}
              dy="0.32em"
              textAnchor="end"
              className="num fill-[var(--ink-muted)] text-[11px]"
            >
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((t) => (
          <text
            key={t.i}
            x={geo.x(t.i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-[var(--ink-muted)] text-[11px]"
          >
            {MONTHS[Number(points[t.i].date.slice(5, 7)) - 1]}
            {points[t.i].date.slice(5, 7) === '01' || t.i === geo.xTicks[0].i ? ` ${points[t.i].date.slice(2, 4)}` : ''}
          </text>
        ))}
        {reference && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={geo.y(reference.value)}
              y2={geo.y(reference.value)}
              stroke="var(--ink-muted)"
              strokeWidth={1}
            />
            <text
              x={width - padR + 6}
              y={geo.y(reference.value)}
              dy="0.32em"
              className="fill-[var(--ink-muted)] text-[11px]"
            >
              {reference.label}
            </text>
          </g>
        )}
        <path d={geo.area} fill="var(--series-1)" fillOpacity={0.1} className="anim-fade" />
        <path
          d={geo.d}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="anim-draw"
        />
        <circle
          cx={geo.x(points.length - 1)}
          cy={geo.y(last.close)}
          r={4}
          fill="var(--series-1)"
          stroke="var(--paper)"
          strokeWidth={2}
        />
        <text
          x={geo.x(points.length - 1) + 8}
          y={geo.y(last.close)}
          dy="0.32em"
          className="num fill-[var(--ink)] text-[12px] font-medium"
        >
          {axisFormat(last.close)}
        </text>
        {h && hover !== null && (
          <g pointerEvents="none">
            <line
              x1={geo.x(hover)}
              x2={geo.x(hover)}
              y1={padT}
              y2={padT + geo.plotH}
              stroke="var(--ink-muted)"
              strokeWidth={1}
            />
            <circle
              cx={geo.x(hover)}
              cy={geo.y(h.close)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--paper)"
              strokeWidth={2}
            />
          </g>
        )}
        <rect
          x={padL}
          y={padT}
          width={width - padL - padR}
          height={geo.plotH}
          fill="transparent"
          tabIndex={0}
          aria-label={`${label}. Use left and right arrow keys to read values.`}
          className="outline-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? points.length) - 1))
            if (e.key === 'ArrowRight') setHover((v) => Math.min(points.length - 1, (v ?? -1) + 1))
          }}
          onBlur={() => setHover(null)}
        />
      </svg>
      {h && hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[13px] shadow-lg"
          style={{ left: Math.min(geo.x(hover) + 12, width - 170) }}
        >
          <TipRow color="var(--series-1)" line label={dayLabel(h.date)} value={format(h.close)} />
        </div>
      )}
    </div>
  )
}
