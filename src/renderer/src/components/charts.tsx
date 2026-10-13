import { useMemo } from 'react'
import type { ChartOptions, ScriptableContext } from 'chart.js'
import { ChartBox } from './chart/ChartBox'
import { FONT, alpha, categoryAxis, crosshairPlugin, endLabelsPlugin, resolveColor, token, useChartTheme, valueAxis } from './chart/setup'
import { Legend, TipRow } from './chart/tooltip'

// Bar, column and line charts on Chart.js, following the app's data-viz rules: thin marks, 4px
// rounded data-ends, hairline grid, hover + keyboard tooltips. Every chart sits next to a table
// carrying the same numbers.

export { Legend, TipRow, useTooltip } from './chart/tooltip'

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
  const theme = useChartTheme()
  const parts = segments.filter((s) => s.value > 0)
  const total = parts.reduce((s, x) => s + x.value, 0)

  const { data, options } = useMemo(() => {
    let acc = 0
    const ranges = parts.map((p) => {
      const r: [number, number] = [acc, acc + p.value]
      acc += p.value
      return r
    })
    const last = parts.length - 1
    return {
      data: {
        labels: ['all'],
        datasets: [
          {
            data: ranges.map((r) => ({ x: r, y: 'all' })),
            backgroundColor: parts.map((p) => resolveColor(p.color)),
            hoverBackgroundColor: parts.map((p) => alpha(p.color, 0.85)),
            borderSkipped: false,
            borderRadius: (ctx: ScriptableContext<'bar'>) => {
              const i = ctx.dataIndex
              return {
                topLeft: i === 0 ? 4 : 0,
                bottomLeft: i === 0 ? 4 : 0,
                topRight: i === last ? 4 : 0,
                bottomRight: i === last ? 4 : 0
              }
            },
            barPercentage: 1,
            categoryPercentage: 1
          }
        ]
      },
      options: {
        indexAxis: 'y',
        layout: { padding: 0 },
        scales: {
          x: { display: false, min: 0, max: total, stacked: false },
          y: { display: false }
        },
        interaction: { mode: 'nearest', intersect: true }
      } as ChartOptions<'bar'>
    }
  }, [segments, theme])

  if (total <= 0) return null
  return (
    <ChartBox
      type="bar"
      data={data as never}
      options={options}
      label={label}
      height={14}
      focusMode="item"
      tooltip={([p]) => {
        const s = parts[p.index]
        if (!s) return null
        return <TipRow color={s.color} label={`${s.label}, ${((s.value / total) * 100).toFixed(1)}%`} value={format(s.value)} />
      }}
    />
  )
}

// ---------------- horizontal bars (ranked categories, optionally stacked parts) ----------------

export interface BarRow {
  key: string
  label: string
  sublabel?: string
  values: number[]
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

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
  /** Makes each row selectable to open its detail. */
  onSelect?: (key: string) => void
  selected?: string | null
}) {
  const theme = useChartTheme()
  const totals = rows.map((r) => r.values.reduce((a, b) => a + b, 0))
  const max = Math.max(0, ...totals)

  const { data, options } = useMemo(() => {
    const selIdx = selected ? rows.findIndex((r) => r.key === selected) : -1
    // The outermost non-zero part of each row gets the rounded end.
    const outer = rows.map((r) => r.values.reduce((o, v, i) => (v > 0 ? i : o), -1))
    const longest = Math.max(0, ...totals.map((t) => format(t).length))
    return {
      data: {
        labels: rows.map((r) => (r.sublabel ? `${clip(r.label, 24)}  ${r.sublabel}` : clip(r.label, 34))),
        datasets: series.map((s, si) => ({
          label: s.label,
          data: rows.map((r) => r.values[si] ?? 0),
          backgroundColor: rows.map((_, ri) => (selIdx >= 0 && ri !== selIdx ? alpha(s.color, 0.35) : resolveColor(s.color))),
          hoverBackgroundColor: alpha(s.color, 0.85),
          borderSkipped: false,
          borderRadius: (ctx: ScriptableContext<'bar'>) =>
            outer[ctx.dataIndex] === si ? { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 } : 0,
          barThickness: 12
        }))
      },
      options: {
        indexAxis: 'y',
        layout: { padding: { right: longest * 6.5 + 14 } },
        scales: {
          x: { display: false, stacked: true, min: 0, max },
          y: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: token('ink'),
              font: { size: 14, family: FONT },
              crossAlign: 'far',
              padding: 12
            },
            afterFit: (scale: { width: number }) => {
              scale.width = Math.min(260, Math.max(150, scale.width))
            }
          }
        },
        interaction: { mode: 'index', axis: 'y', intersect: false },
        plugins: { endLabels: { text: (i: number) => format(totals[i]) } }
      } as ChartOptions<'bar'>
    }
  }, [rows, series, selected, theme, max])

  if (max <= 0) return null
  return (
    <figure aria-label={label} className="m-0">
      {series.length > 1 && <Legend items={series} />}
      <ChartBox
        type="bar"
        data={data as never}
        options={options}
        plugins={[endLabelsPlugin]}
        label={label}
        height={rows.length * 28 + 6}
        onSelect={onSelect ? (i) => rows[i] && onSelect(rows[i].key) : undefined}
        tooltip={([p]) => {
          const r = rows[p.index]
          if (!r) return null
          return (
            <div className="flex flex-col gap-0.5">
              <div className="mb-0.5 font-medium text-ink">{r.label}</div>
              {series.length > 1 &&
                series.map(
                  (s, i) =>
                    r.values[i] > 0 && <TipRow key={s.label} color={s.color} label={s.label} value={format(r.values[i])} />
                )}
              <TipRow label={series.length > 1 ? 'Total' : series[0].label} value={format(totals[p.index])} />
            </div>
          )
        }}
      />
      {onSelect && (
        <ul className="sr-only">
          {rows.map((r, i) => (
            <li key={r.key}>
              <button type="button" aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}>
                {r.label}: {format(totals[i])}
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

// ---------------- columns (one series over periods) ----------------

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
  const theme = useChartTheme()
  const max = Math.max(0, ...points.map((p) => p.value))

  const { data, options } = useMemo(() => {
    const peak = points.length ? points.reduce((a, b, i) => (b.value > points[a].value ? i : a), 0) : -1
    const labelled = new Set([peak, points.length - 1])
    return {
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
            label: seriesLabel,
            data: points.map((p) => p.value),
            backgroundColor: token('series-1'),
            hoverBackgroundColor: alpha('var(--series-1)', 0.8),
            borderRadius: 4,
            maxBarThickness: 24
          }
        ]
      },
      options: {
        layout: { padding: { top: 20 } },
        scales: { x: categoryAxis(), y: valueAxis(axisFormat, { beginAtZero: true }) },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          endLabels: {
            text: (i: number) => (labelled.has(i) && points[i]?.value > 0 ? axisFormat(points[i].value) : null),
            color: token('ink'),
            bold: true
          }
        }
      } as ChartOptions<'bar'>
    }
  }, [points, seriesLabel, theme])

  if (points.length === 0 || max <= 0) return null
  return (
    <ChartBox
      type="bar"
      data={data as never}
      options={options}
      plugins={[endLabelsPlugin]}
      label={label}
      height={height}
      tooltip={([p]) => {
        const pt = points[p.index]
        return pt ? <TipRow color="var(--series-1)" label={`${seriesLabel}, ${pt.label}`} value={format(pt.value)} /> : null
      }}
    />
  )
}

// ---------------- price line with crosshair ----------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayLabel = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

export const TIME_FORMATS = {
  day: 'd MMM',
  week: 'd MMM',
  month: 'MMM yy',
  quarter: 'MMM yy',
  year: 'yyyy'
}

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
  const theme = useChartTheme()

  const { data, options } = useMemo(() => {
    const values = points.map((p) => p.close).concat(reference ? [reference.value] : [])
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = (hi - lo || hi || 1) * 0.06
    const last = points.length - 1
    const line = token('series-1')
    return {
      data: {
        datasets: [
          {
            label,
            data: points.map((p) => ({ x: p.date, y: p.close })),
            borderColor: line,
            backgroundColor: alpha('var(--series-1)', 0.1),
            fill: 'origin',
            borderWidth: 2,
            tension: 0,
            pointRadius: (ctx: ScriptableContext<'line'>) => (ctx.dataIndex === last ? 4 : 0),
            pointHoverRadius: 4,
            pointBackgroundColor: line,
            pointBorderColor: token('paper'),
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        layout: { padding: { top: 18, right: 28 } },
        scales: {
          x: {
            type: 'time',
            time: { displayFormats: TIME_FORMATS },
            grid: { display: false },
            border: { color: token('rule-strong') },
            ticks: { color: token('ink-muted'), font: { size: 11 }, maxRotation: 0, autoSkipPadding: 24 }
          },
          y: valueAxis(axisFormat, { min: lo - pad, max: hi + pad })
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          crosshair: {},
          endLabels: { text: (i: number) => (i === last ? axisFormat(points[i].close) : null), color: token('ink'), bold: true },
          annotation: {
            annotations: reference
              ? {
                  ref: {
                    type: 'line',
                    yMin: reference.value,
                    yMax: reference.value,
                    borderColor: token('ink-muted'),
                    borderWidth: 1,
                    borderDash: [4, 4],
                    label: {
                      display: true,
                      content: reference.label,
                      position: 'start',
                      backgroundColor: 'transparent',
                      color: token('ink-muted'),
                      font: { size: 11, family: FONT },
                      yAdjust: -9
                    }
                  }
                }
              : {}
          }
        }
      } as ChartOptions<'line'>
    }
  }, [points, reference?.value, reference?.label, theme])

  if (points.length < 2)
    return <div className="py-10 text-[14px] text-ink-muted">Not enough price history to draw a chart.</div>
  return (
    <ChartBox
      type="line"
      data={data as never}
      options={options}
      plugins={[crosshairPlugin, endLabelsPlugin]}
      label={label}
      height={height}
      tooltip={([p]) => {
        const pt = points[p.index]
        return pt ? <TipRow color="var(--series-1)" line label={dayLabel(pt.date)} value={format(pt.close)} /> : null
      }}
    />
  )
}
