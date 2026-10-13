import { useMemo, useState } from 'react'
import { niceTicks } from '../lib/ticks'
import { prefersReducedMotion, stagger, useCountUp } from '../lib/motion'
import { Legend, TipRow, useTooltip, useWidth } from './charts'

// More chart forms, built to the same rules as charts.tsx: thin marks, 2px surface gaps, hairline
// solid grid, a legend for 2+ series, hover + focus tooltips, and an entrance animation that the
// reduced-motion setting turns off. Every chart sits beside a table carrying the same numbers.

export interface Part {
  key: string
  label: string
  value: number
  color: string
}

// ---------------- donut (part-to-whole, at most six slices) ----------------

export function Donut({
  parts,
  format,
  centerLabel,
  label,
  size = 220
}: {
  parts: Part[]
  format: (v: number) => string
  centerLabel: string
  label: string
  size?: number
}) {
  const tip = useTooltip()
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0)
  const shown = useCountUp(total)
  const [active, setActive] = useState<string | null>(null)
  const r = size / 2 - 14
  const c = 2 * Math.PI * r
  const gap = 2 / c // a 2px surface gap between slices, in pathLength units
  const animate = !prefersReducedMotion()
  let offset = 0

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label} className="-rotate-90">
        {parts
          .filter((p) => p.value > 0)
          .map((p, i) => {
            const frac = p.value / total
            const dash = Math.max(0, frac - gap)
            const start = offset
            offset += frac
            const content = (
              <TipRow color={p.color} label={`${p.label}, ${(frac * 100).toFixed(1)}%`} value={format(p.value)} />
            )
            return (
              <circle
                key={p.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={active === p.key ? 26 : 22}
                pathLength={1}
                strokeDasharray={`${dash} ${1 - dash}`}
                strokeDashoffset={-start}
                tabIndex={0}
                aria-label={`${p.label}: ${format(p.value)}, ${(frac * 100).toFixed(1)}%`}
                className="cursor-default outline-none transition-[stroke-width] duration-200"
                onPointerMove={(e) => {
                  setActive(p.key)
                  tip.show(e, content)
                }}
                onPointerLeave={() => {
                  setActive(null)
                  tip.hide()
                }}
                onFocus={(e) => {
                  setActive(p.key)
                  tip.showAt(e.currentTarget, content)
                }}
                onBlur={() => {
                  setActive(null)
                  tip.hide()
                }}
              >
                {animate && (
                  <animate
                    attributeName="stroke-dasharray"
                    from={`0 1`}
                    to={`${dash} ${1 - dash}`}
                    dur="0.9s"
                    begin={`${i * 0.08}s`}
                    fill="freeze"
                    calcMode="spline"
                    keySplines="0.22 1 0.36 1"
                    keyTimes="0;1"
                  />
                )}
              </circle>
            )
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[12px] text-ink-muted">{centerLabel}</span>
        <span className="wide text-[19px] font-semibold">{format(shown)}</span>
      </div>
      {tip.node}
    </div>
  )
}

// ---------------- stacked area over time ----------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

export function AreaStack({
  dates,
  series,
  format,
  axisFormat,
  label,
  height = 300
}: {
  dates: string[]
  series: { key: string; label: string; color: string; values: number[] }[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 64
  const padR = 16
  const padT = 10
  const padB = 26
  const geo = useMemo(() => {
    if (dates.length < 2 || series.length === 0) return null
    const totals = dates.map((_, i) => series.reduce((s, x) => s + x.values[i], 0))
    const ticks = niceTicks(0, Math.max(...totals), 4)
    const top = ticks[ticks.length - 1] || 1
    const plotW = width - padL - padR
    const plotH = height - padT - padB
    const x = (i: number) => padL + (i / (dates.length - 1)) * plotW
    const y = (v: number) => padT + plotH - (v / top) * plotH
    // Cumulative bands, bottom series first.
    const base = dates.map(() => 0)
    const bands = series.map((s) => {
      const lower = [...base]
      s.values.forEach((v, i) => (base[i] += v))
      const upper = [...base]
      const d =
        upper.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
        ' ' +
        lower
          .map((v, i) => [i, v] as const)
          .reverse()
          .map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
          .join(' ') +
        ' Z'
      const line = upper.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      return { ...s, d, line }
    })
    const years = dates
      .map((d, i) => ({ d, i }))
      .filter((p, k, a) => k === 0 || p.d.slice(0, 4) !== a[k - 1].d.slice(0, 4))
    const every = Math.ceil(years.length / Math.max(2, Math.floor(plotW / 80)))
    // Drop a year label that would sit too close to the previous one (e.g. a range starting in December).
    const xTicks = years
      .filter((_, k) => k % every === 0)
      .filter((t, k, arr) => k === 0 || x(t.i) - x(arr[k - 1].i) >= 56)
    if (xTicks.length > 1 && x(xTicks[1].i) - x(xTicks[0].i) < 56) xTicks.shift()
    return { totals, ticks, x, y, bands, plotH, xTicks }
  }, [dates, series, width, height])

  if (!geo)
    return (
      <div ref={ref} className="py-10 text-[14px] text-ink-muted">
        Not enough history to draw this yet.
      </div>
    )
  const h = hover

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(dates.length - 1, Math.round(((e.clientX - r.left) / r.width) * (dates.length - 1)))))
  }
  const clipId = `area-clip-${label.replace(/\W/g, '')}`

  return (
    <div ref={ref} className="relative w-full">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={0} width={width - padL - padR} height={height} className="anim-grow-x" />
          </clipPath>
        </defs>
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
            {dates[t.i].slice(0, 4)}
          </text>
        ))}
        <g clipPath={`url(#${clipId})`}>
          {geo.bands.map((b) => (
            <g key={b.key}>
              <path d={b.d} fill={b.color} fillOpacity={0.22} />
              <path d={b.line} fill="none" stroke={b.color} strokeWidth={2} strokeLinejoin="round" />
            </g>
          ))}
        </g>
        {h !== null && (
          <line
            x1={geo.x(h)}
            x2={geo.x(h)}
            y1={padT}
            y2={padT + geo.plotH}
            stroke="var(--ink-muted)"
            strokeWidth={1}
            pointerEvents="none"
          />
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
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? dates.length) - 1))
            if (e.key === 'ArrowRight') setHover((v) => Math.min(dates.length - 1, (v ?? -1) + 1))
          }}
          onBlur={() => setHover(null)}
        />
      </svg>
      {h !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-8 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[13px] shadow-lg"
          style={{ left: Math.min(geo.x(h) + 12, width - 230) }}
        >
          <div className="mb-1 font-medium text-ink">{monthLabel(dates[h])}</div>
          {[...series]
            .reverse()
            .map((s) =>
              s.values[h] > 0 ? (
                <TipRow key={s.key} color={s.color} line label={s.label} value={format(s.values[h])} />
              ) : null
            )}
          <div className="mt-1 border-t border-rule pt-1">
            <TipRow label="Total" value={format(geo.totals[h])} />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- treemap (size = value, colour = gain or loss) ----------------

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Squarified treemap layout (Bruls et al.): rows of tiles kept as close to square as possible. */
export function squarify<T extends { value: number }>(items: T[], box: Rect): (T & Rect)[] {
  const out: (T & Rect)[] = []
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0) return out
  const scale = (box.w * box.h) / total
  const queue = items.filter((i) => i.value > 0).map((i) => ({ item: i, area: i.value * scale }))
  let { x, y, w, h } = box

  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((a, r) => a + r.area, 0)
    const max = Math.max(...row.map((r) => r.area))
    const min = Math.min(...row.map((r) => r.area))
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }

  while (queue.length) {
    const side = Math.min(w, h)
    const row = [queue.shift()!]
    while (queue.length && worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift()!)
    const rowArea = row.reduce((a, r) => a + r.area, 0)
    if (w >= h) {
      const rw = rowArea / h
      let yy = y
      for (const r of row) {
        const rh = r.area / rw
        out.push({ ...r.item, x, y: yy, w: rw, h: rh })
        yy += rh
      }
      x += rw
      w -= rw
    } else {
      const rh = rowArea / w
      let xx = x
      for (const r of row) {
        const rw = r.area / rh
        out.push({ ...r.item, x: xx, y, w: rw, h: rh })
        xx += rw
      }
      y += rh
      h -= rh
    }
  }
  return out
}

/** Gain/loss → diverging fill: grey at 0, full blue at +40%, full red at −40%. */
export function divergingFill(pct: number | null): { fill: string; strong: boolean } {
  if (pct === null) return { fill: 'var(--div-mid)', strong: false }
  const t = Math.min(1, Math.abs(pct) / 0.4)
  const mix = Math.round(15 + t * 85)
  return {
    fill: `color-mix(in oklab, ${pct >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${mix}%, var(--div-mid))`,
    strong: mix > 60
  }
}

export function Treemap({
  items,
  format,
  label,
  height = 360
}: {
  items: { key: string; name: string; value: number; gainPct: number | null }[]
  format: (v: number) => string
  label: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTooltip()
  const cells = useMemo(() => squarify(items, { x: 0, y: 0, w: width, h: height }), [items, width, height])
  return (
    <div ref={ref} className="w-full">
      <div className="mb-2 flex items-center gap-3 text-[12px] text-ink-muted">
        <span>Loss</span>
        <span
          aria-hidden
          className="h-2 w-40 rounded-sm"
          style={{ background: 'linear-gradient(90deg, var(--div-neg), var(--div-mid), var(--div-pos))' }}
        />
        <span>Gain</span>
        <span className="ml-2">Size shows value</span>
      </div>
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {cells.map((c, i) => {
          const { fill, strong } = divergingFill(c.gainPct)
          const pct = c.gainPct === null ? '' : `${c.gainPct >= 0 ? '+' : '−'}${Math.abs(c.gainPct * 100).toFixed(1)}%`
          const content = (
            <div>
              <div className="mb-0.5 font-medium text-ink">{c.name}</div>
              <TipRow label={c.gainPct === null ? 'no cost on record' : `return ${pct}`} value={format(c.value)} />
            </div>
          )
          const fits = c.w > 70 && c.h > 34
          return (
            <g
              key={c.key}
              tabIndex={0}
              aria-label={`${c.name}: ${format(c.value)} ${pct}`}
              className="anim-pop cursor-default outline-none"
              style={{ ...stagger(i, 18, 500), transformOrigin: `${c.x + c.w / 2}px ${c.y + c.h / 2}px` }}
              onPointerMove={(e) => tip.show(e, content)}
              onPointerLeave={tip.hide}
              onFocus={(e) => tip.showAt(e.currentTarget, content)}
              onBlur={tip.hide}
            >
              {/* 1px inset each side = the 2px surface gap between tiles */}
              <rect
                x={c.x + 1}
                y={c.y + 1}
                width={Math.max(0, c.w - 2)}
                height={Math.max(0, c.h - 2)}
                rx={4}
                fill={fill}
                className="transition-[filter] hover:brightness-110"
              />
              {fits && (
                <foreignObject x={c.x + 6} y={c.y + 4} width={c.w - 12} height={c.h - 8} pointerEvents="none">
                  <div
                    className={'condensed truncate text-[12px] leading-tight ' + (strong ? 'text-white' : 'text-ink')}
                  >
                    <div className="truncate font-medium">{c.name}</div>
                    {c.h > 48 && <div className="num text-left opacity-90">{pct}</div>}
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
      </svg>
      {tip.node}
    </div>
  )
}

// ---------------- diverging bars (gains right, losses left) ----------------

export function DivergingBars({
  rows,
  format,
  label
}: {
  rows: { key: string; label: string; value: number; sub?: string }[]
  format: (v: number) => string
  label: string
}) {
  const tip = useTooltip()
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0)
  if (max === 0) return null
  return (
    <figure aria-label={label} className="m-0 flex flex-col">
      {rows.map((r, i) => {
        const w = `${(Math.abs(r.value) / max) * 100}%`
        const pos = r.value >= 0
        const content = (
          <TipRow color={pos ? 'var(--div-pos)' : 'var(--div-neg)'} label={r.label} value={format(r.value)} />
        )
        return (
          <div
            key={r.key}
            tabIndex={0}
            aria-label={`${r.label}: ${format(r.value)}`}
            className="grid grid-cols-[minmax(120px,220px)_1fr_1fr] items-center gap-3 rounded-sm py-[5px] outline-offset-1 hover:bg-sheet/70"
            onPointerMove={(e) => tip.show(e, content)}
            onPointerLeave={tip.hide}
            onFocus={(e) => tip.showAt(e.currentTarget, content)}
            onBlur={tip.hide}
          >
            <div className="min-w-0 truncate text-[14px]" title={r.label}>
              {r.label}
            </div>
            <div className="flex items-center justify-end gap-2 border-r border-rule-strong pr-0">
              {!pos && (
                <>
                  <span className="num text-[12px] text-ink-muted">{r.sub ?? format(r.value)}</span>
                  <div
                    className="anim-grow-x h-3 rounded-l-[4px]"
                    style={{ width: w, background: 'var(--div-neg)', transformOrigin: 'right', ...stagger(i) }}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {pos && (
                <>
                  <div
                    className="anim-grow-x h-3 rounded-r-[4px]"
                    style={{ width: w, background: 'var(--div-pos)', ...stagger(i) }}
                  />
                  <span className="num text-[12px] text-ink-muted">{r.sub ?? format(r.value)}</span>
                </>
              )}
            </div>
          </div>
        )
      })}
      {tip.node}
    </figure>
  )
}

// ---------------- stacked columns (income by year) ----------------

export function StackedColumns({
  periods,
  series,
  format,
  axisFormat,
  label,
  height = 240
}: {
  periods: { key: string; label: string; values: number[] }[]
  series: { label: string; color: string }[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const tip = useTooltip()
  const totals = periods.map((p) => p.values.reduce((a, b) => a + b, 0))
  const max = Math.max(0, ...totals)
  if (periods.length === 0 || max <= 0)
    return (
      <div ref={ref} className="py-8 text-[14px] text-ink-muted">
        Nothing to show yet.
      </div>
    )
  const ticks = niceTicks(0, max, 4)
  const top = ticks[ticks.length - 1]
  const padL = 56
  const padB = 24
  const padT = 18
  const plotW = width - padL
  const plotH = height - padB - padT
  const band = plotW / periods.length
  const barW = Math.min(28, band * 0.6)
  const y = (v: number) => padT + plotH - (v / top) * plotH

  return (
    <div ref={ref} className="w-full">
      {series.length > 1 && <Legend items={series} />}
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
        {periods.map((p, pi) => {
          const cx = padL + band * pi + band / 2
          const x0 = cx - barW / 2
          let acc = 0
          const visible = p.values.map((v, si) => ({ v, si })).filter((s) => s.v > 0)
          const content = (
            <div className="flex flex-col gap-0.5">
              <div className="mb-0.5 font-medium text-ink">{p.label}</div>
              {visible.map((s) => (
                <TipRow key={s.si} color={series[s.si].color} label={series[s.si].label} value={format(s.v)} />
              ))}
              <TipRow label="Total" value={format(totals[pi])} />
            </div>
          )
          return (
            <g key={p.key}>
              <g className="anim-grow-y" style={stagger(pi, 60)}>
                {visible.map((s, k) => {
                  const y1 = y(acc)
                  acc += s.v
                  const y2 = y(acc)
                  const isTop = k === visible.length - 1
                  // A 2px surface gap above each lower segment; rounded data-end only on the top one.
                  const segTop = isTop ? y2 : Math.min(y1, y2 + 2)
                  const r = isTop ? Math.min(4, y1 - segTop, barW / 2) : 0
                  return (
                    <path
                      key={s.si}
                      d={`M${x0},${y1} V${segTop + r} Q${x0},${segTop} ${x0 + r},${segTop} H${x0 + barW - r} Q${x0 + barW},${segTop} ${x0 + barW},${segTop + r} V${y1} Z`}
                      fill={series[s.si].color}
                    />
                  )
                })}
              </g>
              {pi === periods.length - 1 && (
                <text
                  x={cx}
                  y={y(totals[pi]) - 6}
                  textAnchor="middle"
                  className="num fill-[var(--ink)] text-[11px] font-medium"
                >
                  {axisFormat(totals[pi])}
                </text>
              )}
              <text x={cx} y={height - 6} textAnchor="middle" className="fill-[var(--ink-muted)] text-[11px]">
                {p.label}
              </text>
              <rect
                x={padL + band * pi}
                y={padT}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${p.label}: ${format(totals[pi])}`}
                className="outline-none hover:fill-[var(--stamp-wash)] focus-visible:fill-[var(--stamp-wash)]"
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

// ---------------- sparkline ----------------

export function Sparkline({ values, width = 84, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map(
    (v, i) =>
      `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`
  )
  const up = values[values.length - 1] >= values[0]
  const last = pts[pts.length - 1].split(',').map(Number)
  return (
    <svg width={width} height={height} aria-hidden className="inline-block align-middle">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={up ? 'var(--gain)' : 'var(--loss)'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="anim-draw"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={up ? 'var(--gain)' : 'var(--loss)'} />
    </svg>
  )
}
