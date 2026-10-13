import { useMemo } from 'react'
import type { Chart, ChartOptions, Plugin, ScriptableContext } from 'chart.js'
import { TIME_FORMATS, dayLabel } from '../charts'
import { ChartBox } from './ChartBox'
import { FONT, alpha, categoryAxis, crosshairPlugin, resolveColor, token, useChartTheme, valueAxis } from './setup'
import { Legend, TipRow } from './tooltip'

// Chart forms used by Performance, Tax, Overlap and Rebalance: line comparison, drawdown, heatmap,
// waterfall and bullet. Same rules as the rest: thin marks, hairline grid, shared tooltip.

const timeAxis = () => ({
  type: 'time' as const,
  time: { displayFormats: TIME_FORMATS },
  grid: { display: false },
  border: { color: token('rule-strong') },
  ticks: { color: token('ink-muted'), font: { size: 11 }, maxRotation: 0, autoSkipPadding: 28 }
})

// ---------------- line comparison (portfolio vs benchmarks) ----------------

export interface LineSeries {
  key: string
  label: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

export function LineCompare({
  dates,
  series,
  format,
  axisFormat,
  label,
  height = 280,
  zeroLine = false
}: {
  dates: string[]
  series: LineSeries[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  height?: number
  /** Draw a stronger line at 0 (for returns that go negative). */
  zeroLine?: boolean
}) {
  const theme = useChartTheme()
  const { data, options } = useMemo(
    () => ({
      data: {
        datasets: series.map((s) => ({
          label: s.label,
          data: dates.map((d, i) => ({ x: d, y: s.values[i] })),
          borderColor: resolveColor(s.color),
          backgroundColor: resolveColor(s.color),
          borderWidth: s.dashed ? 1.5 : 2,
          borderDash: s.dashed ? [5, 4] : [],
          pointRadius: 0,
          pointHoverRadius: 3,
          spanGaps: true,
          tension: 0
        }))
      },
      options: {
        layout: { padding: { top: 6 } },
        scales: {
          x: timeAxis(),
          y: valueAxis(axisFormat, {
            grid: {
              drawTicks: false,
              color: (ctx: { tick?: { value: number } }) =>
                zeroLine && ctx.tick?.value === 0 ? token('rule-strong') : token('rule')
            }
          })
        },
        interaction: { mode: 'index', intersect: false },
        plugins: { crosshair: {} }
      } as ChartOptions<'line'>
    }),
    [dates, series, zeroLine, theme, axisFormat]
  )

  if (dates.length < 2 || series.length === 0)
    return <div className="py-10 text-[14px] text-ink-muted">Not enough history to draw this yet.</div>
  return (
    <div className="w-full">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />}
      <ChartBox
        type="line"
        data={data as never}
        options={options}
        plugins={[crosshairPlugin]}
        label={label}
        height={height}
        tooltip={(points) => {
          const i = points[0]?.index
          if (i === undefined) return null
          return (
            <div>
              <div className="mb-1 font-medium text-ink">{dayLabel(dates[i])}</div>
              {series.map((s) => {
                const v = s.values[i]
                return v == null ? null : <TipRow key={s.key} color={s.color} line label={s.label} value={format(v)} />
              })}
            </div>
          )
        }}
      />
    </div>
  )
}

// ---------------- drawdown (fall from the running peak, as a fraction ≤ 0) ----------------

export function Drawdown({
  points,
  label,
  height = 180,
  format = (v) => `${(v * 100).toFixed(1)}%`
}: {
  points: { date: string; value: number }[]
  label: string
  height?: number
  format?: (v: number) => string
}) {
  const theme = useChartTheme()
  const { data, options } = useMemo(() => {
    const low = Math.min(0, ...points.map((p) => p.value))
    return {
      data: {
        datasets: [
          {
            label,
            data: points.map((p) => ({ x: p.date, y: p.value })),
            borderColor: token('loss'),
            backgroundColor: alpha('var(--loss)', 0.18),
            fill: 'origin',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0
          }
        ]
      },
      options: {
        scales: {
          x: timeAxis(),
          // Whole percents for deep falls; one decimal when the deepest fall is under 5%.
          y: valueAxis((v) => `${(v * 100).toFixed(low > -0.05 ? 1 : 0)}%`, { max: 0, min: low < 0 ? low * 1.1 : -0.01 })
        },
        interaction: { mode: 'index', intersect: false },
        plugins: { crosshair: {} }
      } as ChartOptions<'line'>
    }
  }, [points, label, theme])

  if (points.length < 2) return <div className="py-8 text-[14px] text-ink-muted">Not enough history to draw this yet.</div>
  return (
    <ChartBox
      type="line"
      data={data as never}
      options={options}
      plugins={[crosshairPlugin]}
      label={label}
      height={height}
      tooltip={([p]) => {
        const pt = points[p.index]
        return pt ? <TipRow color="var(--loss)" line label={`below peak, ${dayLabel(pt.date)}`} value={format(pt.value)} /> : null
      }}
    />
  )
}

// ---------------- heatmap (e.g. fund overlap) ----------------

interface Cell {
  x: string
  y: string
  v: number
}

/** Writes each cell's value in its centre when the cell is big enough. */
const cellLabels = (text: (v: number) => string, strongAt: number): Plugin<'matrix'> => ({
  id: 'cellLabels',
  afterDatasetsDraw(chart: Chart<'matrix'>) {
    const meta = chart.getDatasetMeta(0)
    const ctx = chart.ctx
    ctx.save()
    ctx.font = `500 ${meta.data.length > 30 ? 10 : 11}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    meta.data.forEach((el, i) => {
      const { x, y, width, height } = el.getProps(['x', 'y', 'width', 'height'], true) as {
        x: number
        y: number
        width: number
        height: number
      }
      if (width < 24 || height < 16) return
      const cell = chart.data.datasets[0].data[i] as unknown as Cell
      ctx.fillStyle = Math.abs(cell.v) >= strongAt ? '#fff' : token('ink')
      ctx.fillText(text(cell.v), x + width / 2, y + height / 2)
    })
    ctx.restore()
  }
})

export function Heatmap({
  rows,
  cols,
  values,
  format,
  label,
  max,
  color = 'var(--series-1)',
  onSelect,
  height,
  colNames,
  rowNames,
  diverging = false,
  valueLabel = 'overlap'
}: {
  /** Colour negative values red and positive blue (e.g. correlations from −1 to 1). */
  diverging?: boolean
  /** Word after the value in the tooltip. */
  valueLabel?: string
  rows: string[]
  /** Column labels shown on the axis; must be unique. */
  cols: string[]
  /** Full column and row names for the tooltip when the axis labels are shortened. */
  colNames?: string[]
  rowNames?: string[]
  /** values[row][col]; null leaves the cell blank (e.g. the diagonal). */
  values: (number | null)[][]
  format: (v: number) => string
  label: string
  /** Value that gets the full colour; defaults to the largest value. */
  max?: number
  color?: string
  onSelect?: (row: number, col: number) => void
  height?: number
}) {
  const theme = useChartTheme()
  const cells = useMemo(() => {
    const out: (Cell & { r: number; c: number })[] = []
    values.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v != null) out.push({ x: cols[c], y: rows[r], v, r, c })
      })
    )
    return out
  }, [rows, cols, values])
  const top = max ?? Math.max(0, ...cells.map((c) => (diverging ? Math.abs(c.v) : c.v)))

  const { data, options, plugins } = useMemo(() => {
    const fill = (v: number) => {
      const t = top > 0 ? Math.min(1, Math.abs(v) / top) : 0
      const hue = diverging ? (v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)') : color
      return resolveColor(`color-mix(in oklab, ${hue} ${Math.round(8 + t * 92)}%, var(--div-mid))`)
    }
    return {
      data: {
        datasets: [
          {
            label,
            data: cells,
            backgroundColor: (ctx: ScriptableContext<'matrix'>) =>
              ctx.type === 'data' ? fill((ctx.raw as Cell).v) : 'transparent',
            borderWidth: 0,
            width: ({ chart }: { chart: Chart }) => (chart.chartArea?.width ?? 0) / Math.max(1, cols.length) - 2,
            height: ({ chart }: { chart: Chart }) => (chart.chartArea?.height ?? 0) / Math.max(1, rows.length) - 2,
            anchorX: 'center',
            anchorY: 'center'
          }
        ]
      },
      options: {
        scales: {
          x: {
            type: 'category',
            labels: cols,
            offset: true,
            position: 'top',
            grid: { display: false },
            border: { display: false },
            ticks: { color: token('ink-muted'), font: { size: 11 }, maxRotation: 45, autoSkip: false }
          },
          y: {
            type: 'category',
            labels: rows,
            offset: true,
            // The matrix plugin reverses y by default; turn that off so the first row is at the top and
            // the diagonal runs top-left to bottom-right.
            reverse: false,
            grid: { display: false },
            border: { display: false },
            ticks: { color: token('ink'), font: { size: 12 }, autoSkip: false }
          }
        },
        interaction: { mode: 'nearest', intersect: true }
      } as unknown as ChartOptions<'matrix'>,
      plugins: [cellLabels(format, top * 0.6)]
    }
  }, [cells, rows, cols, top, color, label, theme, diverging])

  if (!cells.length) return <div className="py-8 text-[14px] text-ink-muted">Nothing to compare yet.</div>
  return (
    <ChartBox
      type="matrix"
      data={data as never}
      options={options}
      plugins={plugins as never}
      label={label}
      height={height ?? Math.max(160, rows.length * 34 + 90)}
      focusMode="item"
      onSelect={onSelect ? (i) => cells[i] && onSelect(cells[i].r, cells[i].c) : undefined}
      tooltip={([p]) => {
        const c = cells[p.index]
        if (!c) return null
        return (
          <div>
            <div className="mb-0.5 font-medium text-ink">
              {rowNames?.[c.r] ?? c.y} × {colNames?.[c.c] ?? c.x}
            </div>
            <TipRow
              color={diverging ? (c.v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)') : color}
              label={valueLabel}
              value={format(c.v)}
            />
          </div>
        )
      }}
    />
  )
}

// ---------------- waterfall (where the change came from) ----------------

function zoomFloor(ranges: [number, number][]): { min?: number } {
  const lo = Math.min(...ranges.map(([a, b]) => Math.min(a, b)).filter((v) => v > 0))
  const floats = ranges.filter(([a]) => a !== 0)
  if (!floats.length || !Number.isFinite(lo)) return {}
  const low = Math.min(...floats.map(([a, b]) => Math.min(a, b)))
  const high = Math.max(...ranges.map(([a, b]) => Math.max(a, b)))
  // Zoom only when every floating bar sits in the top 40% of the scale.
  if (low <= 0 || low / high < 0.6) return {}
  return { min: low - (high - low) * 0.6 }
}

export interface WaterfallStep {
  key: string
  label: string
  value: number
  /** 'total' bars start from zero (opening/closing); 'delta' bars float from the running sum. */
  kind: 'total' | 'delta'
}

export function Waterfall({
  steps,
  format,
  axisFormat,
  label,
  height = 240
}: {
  steps: WaterfallStep[]
  format: (v: number) => string
  axisFormat: (v: number) => string
  label: string
  height?: number
}) {
  const theme = useChartTheme()
  const { data, options } = useMemo(() => {
    let run = 0
    const ranges = steps.map((s) => {
      if (s.kind === 'total') {
        run = s.value
        return [0, s.value] as [number, number]
      }
      const r: [number, number] = [run, run + s.value]
      run += s.value
      return r
    })
    const colors = steps.map((s) =>
      s.kind === 'total' ? token('series-other') : s.value >= 0 ? token('gain') : token('loss')
    )
    return {
      data: {
        labels: steps.map((s) => s.label),
        datasets: [
          {
            label,
            data: ranges,
            backgroundColor: colors,
            hoverBackgroundColor: colors.map((c) => alpha(c, 0.8)),
            borderSkipped: false,
            borderRadius: 3,
            maxBarThickness: 40
          }
        ]
      },
      options: {
        scales: {
          x: categoryAxis(),
          // When the changes are small next to the totals, start the axis near the lowest level so the
          // floating bars are visible (the totals are then shown cut off, which the tooltip makes clear).
          y: valueAxis(axisFormat, zoomFloor(ranges))
        },
        interaction: { mode: 'index', intersect: false }
      } as ChartOptions<'bar'>
    }
  }, [steps, label, theme])

  if (!steps.length) return null
  return (
    <ChartBox
      type="bar"
      data={data as never}
      options={options}
      label={label}
      height={height}
      tooltip={([p]) => {
        const s = steps[p.index]
        if (!s) return null
        const c = s.kind === 'total' ? 'var(--series-other)' : s.value >= 0 ? 'var(--gain)' : 'var(--loss)'
        return <TipRow color={c} label={s.label} value={format(s.value)} />
      }}
    />
  )
}

// ---------------- bullet (actual vs target with an allowed band) ----------------

export interface BulletRow {
  key: string
  label: string
  actual: number
  target: number
  /** Allowed band around the target; omit for none. */
  low?: number
  high?: number
}

export function Bullet({
  rows,
  format = (v) => `${(v * 100).toFixed(1)}%`,
  label,
  color = 'var(--series-1)'
}: {
  rows: BulletRow[]
  format?: (v: number) => string
  label: string
  color?: string
}) {
  const theme = useChartTheme()
  const { data, options } = useMemo(() => {
    // Round the axis up to a whole 10% so the last tick reads cleanly.
    const top = Math.min(1, Math.ceil(Math.max(0, ...rows.flatMap((r) => [r.actual, r.target, r.high ?? 0])) * 1.05 * 10) / 10) || 1
    const tick = top / 200
    const off = (r: BulletRow) => r.low !== undefined && r.high !== undefined && (r.actual < r.low || r.actual > r.high)
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            label: 'Allowed range',
            data: rows.map((r) => (r.low !== undefined && r.high !== undefined ? [r.low, r.high] : null)),
            backgroundColor: alpha('var(--ink-muted)', 0.16),
            barThickness: 20,
            grouped: false,
            borderSkipped: false,
            borderRadius: 3
          },
          {
            label: 'Actual',
            data: rows.map((r) => r.actual),
            backgroundColor: rows.map((r) => (off(r) ? token('warn') : resolveColor(color))),
            barThickness: 8,
            grouped: false,
            borderRadius: 3
          },
          {
            label: 'Target',
            data: rows.map((r) => [r.target - tick, r.target + tick]),
            backgroundColor: token('ink'),
            barThickness: 24,
            grouped: false,
            borderSkipped: false
          }
        ]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: valueAxis((v) => format(v), { min: 0, max: top }),
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: token('ink'), font: { size: 14, family: FONT }, crossAlign: 'far', padding: 12 }
          }
        },
        interaction: { mode: 'index', axis: 'y', intersect: false }
      } as ChartOptions<'bar'>
    }
  }, [rows, color, theme])

  if (!rows.length) return null
  return (
    <div className="w-full">
      <Legend
        items={[
          { label: 'Actual', color },
          { label: 'Target', color: 'var(--ink)' },
          { label: 'Allowed range', color: 'color-mix(in oklab, var(--ink-muted) 30%, transparent)' }
        ]}
      />
      <ChartBox
        type="bar"
        data={data as never}
        options={options}
        label={label}
        height={rows.length * 40 + 30}
        tooltip={([p]) => {
          const r = rows[p.index]
          if (!r) return null
          const diff = r.actual - r.target
          return (
            <div className="flex flex-col gap-0.5">
              <div className="mb-0.5 font-medium text-ink">{r.label}</div>
              <TipRow color={color} label="actual" value={format(r.actual)} />
              <TipRow color="var(--ink)" label="target" value={format(r.target)} />
              {r.low !== undefined && r.high !== undefined && (
                <TipRow label="allowed" value={`${format(r.low)} – ${format(r.high)}`} />
              )}
              <TipRow label="off target" value={`${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))}`} />
            </div>
          )
        }}
      />
    </div>
  )
}
