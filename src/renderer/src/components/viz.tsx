import { useMemo } from 'react'
import { Chart as ReactChart } from 'react-chartjs-2'
import type { ChartOptions, ScriptableContext } from 'chart.js'
import { useCountUp } from '../lib/motion'
import { TIME_FORMATS } from './charts'
import { ChartBox } from './chart/ChartBox'
import { FONT, alpha, categoryAxis, crosshairPlugin, endLabelsPlugin, resolveColor, token, useChartTheme, valueAxis } from './chart/setup'
import { Legend, TipRow } from './chart/tooltip'

// Donut, stacked area, treemap, diverging bars, stacked columns and sparklines on Chart.js, to the
// same rules as charts.tsx. Every chart sits beside a table carrying the same numbers.

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
  const theme = useChartTheme()
  const shown_ = parts.filter((p) => p.value > 0)
  const total = shown_.reduce((s, p) => s + p.value, 0)
  const shown = useCountUp(total)

  const { data, options } = useMemo(
    () => ({
      data: {
        labels: shown_.map((p) => p.label),
        datasets: [
          {
            data: shown_.map((p) => p.value),
            backgroundColor: shown_.map((p) => resolveColor(p.color)),
            hoverBackgroundColor: shown_.map((p) => resolveColor(p.color)),
            borderColor: token('paper'),
            borderWidth: 2,
            hoverOffset: 6,
            borderRadius: 2
          }
        ]
      },
      options: {
        cutout: '78%',
        layout: { padding: 8 },
        interaction: { mode: 'nearest', intersect: true }
      } as ChartOptions<'doughnut'>
    }),
    [parts, theme]
  )

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ChartBox
        type="doughnut"
        data={data as never}
        options={options}
        label={label}
        height={size}
        width={size}
        focusMode="item"
        tooltip={([p]) => {
          const s = shown_[p.index]
          if (!s) return null
          return <TipRow color={s.color} label={`${s.label}, ${((s.value / total) * 100).toFixed(1)}%`} value={format(s.value)} />
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[12px] text-ink-muted">{centerLabel}</span>
        <span className="wide text-[19px] font-semibold">{format(shown)}</span>
      </div>
    </div>
  )
}

// ---------------- stacked area over time ----------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

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
  const theme = useChartTheme()
  const totals = useMemo(() => dates.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0)), [dates, series])

  const { data, options } = useMemo(
    () => ({
      data: {
        datasets: series.map((s, si) => ({
          label: s.label,
          data: dates.map((d, i) => ({ x: d, y: s.values[i] ?? 0 })),
          borderColor: resolveColor(s.color),
          backgroundColor: alpha(s.color, 0.22),
          fill: si === 0 ? 'origin' : '-1',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: resolveColor(s.color),
          tension: 0
        }))
      },
      options: {
        layout: { padding: { top: 6 } },
        scales: {
          x: {
            type: 'time',
            time: { displayFormats: TIME_FORMATS },
            grid: { display: false },
            border: { color: token('rule-strong') },
            ticks: { color: token('ink-muted'), font: { size: 11 }, maxRotation: 0, autoSkipPadding: 32 }
          },
          y: valueAxis(axisFormat, { stacked: true, beginAtZero: true })
        },
        interaction: { mode: 'index', intersect: false },
        plugins: { crosshair: {} }
      } as ChartOptions<'line'>
    }),
    [dates, series, theme]
  )

  if (dates.length < 2 || series.length === 0)
    return <div className="py-10 text-[14px] text-ink-muted">Not enough history to draw this yet.</div>
  return (
    <div className="w-full">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
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
              <div className="mb-1 font-medium text-ink">{monthLabel(dates[i])}</div>
              {[...series]
                .reverse()
                .map((s) =>
                  s.values[i] > 0 ? <TipRow key={s.key} color={s.color} line label={s.label} value={format(s.values[i])} /> : null
                )}
              {series.length > 1 && (
                <div className="mt-1 border-t border-rule pt-1">
                  <TipRow label="Total" value={format(totals[i])} />
                </div>
              )}
            </div>
          )
        }}
      />
    </div>
  )
}

// ---------------- treemap (size = value, colour = gain or loss) ----------------

/** Gain/loss → diverging fill: grey at 0, full colour at ±`full` (40% unless given). */
export function divergingFill(pct: number | null, full = 0.4): { fill: string; strong: boolean } {
  if (pct === null) return { fill: 'var(--div-mid)', strong: false }
  const t = Math.min(1, Math.abs(pct) / full)
  const mix = Math.round(15 + t * 85)
  return {
    fill: `color-mix(in oklab, ${pct >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${mix}%, var(--div-mid))`,
    strong: mix > 60
  }
}

interface TreeItem {
  key: string
  name: string
  value: number
  gainPct: number | null
}

const pctText = (p: number | null) => (p === null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`)
const itemOf = (raw: unknown) => (raw as { _data?: TreeItem } | undefined)?._data

export function Treemap({
  items,
  format,
  label,
  height = 360,
  onSelect,
  full = 0.4,
  changeLabel = 'return',
  sizeLabel = 'value'
}: {
  items: TreeItem[]
  format: (v: number) => string
  label: string
  height?: number
  /** Called with the item key when a tile is clicked. */
  onSelect?: (key: string) => void
  /** The change that gets full colour (0.4 = 40%; a day's moves want much less). */
  full?: number
  changeLabel?: string
  sizeLabel?: string
}) {
  const theme = useChartTheme()
  const sorted = useMemo(() => items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value), [items])

  const { data, options } = useMemo(() => {
    const white = 'rgba(255, 255, 255, 1)'
    const ink = token('ink')
    return {
      data: {
        datasets: [
          {
            label,
            tree: sorted as unknown as number[],
            key: 'value',
            spacing: 1,
            borderWidth: 0,
            borderRadius: 4,
            backgroundColor: (ctx: ScriptableContext<'treemap'>) => {
              const it = ctx.type === 'data' ? itemOf(ctx.raw) : undefined
              return it ? resolveColor(divergingFill(it.gainPct, full).fill) : 'transparent'
            },
            hoverBackgroundColor: (ctx: ScriptableContext<'treemap'>) => {
              const it = ctx.type === 'data' ? itemOf(ctx.raw) : undefined
              return it ? alpha(divergingFill(it.gainPct, full).fill, 0.85) : 'transparent'
            },
            labels: {
              display: true,
              align: 'left',
              position: 'top',
              overflow: 'hidden',
              font: [{ size: 12, weight: 'bold', family: FONT }, { size: 12, family: FONT }],
              color: (ctx: ScriptableContext<'treemap'>) => {
                const it = ctx.type === 'data' ? itemOf(ctx.raw) : undefined
                return it && divergingFill(it.gainPct, full).strong ? white : ink
              },
              formatter: (ctx: ScriptableContext<'treemap'>) => {
                const it = itemOf(ctx.raw)
                if (!it) return ''
                return it.gainPct === null ? [it.name] : [it.name, pctText(it.gainPct)]
              }
            }
          }
        ]
      },
      options: { interaction: { mode: 'nearest', intersect: true } } as ChartOptions<'treemap'>
    }
  }, [sorted, label, theme, full])

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-3 text-[12px] text-ink-muted">
        <span>Loss</span>
        <span
          aria-hidden
          className="h-2 w-40 rounded-sm"
          style={{ background: 'linear-gradient(90deg, var(--div-neg), var(--div-mid), var(--div-pos))' }}
        />
        <span>Gain</span>
        <span className="ml-2">Size shows {sizeLabel}</span>
      </div>
      <ChartBox
        type="treemap"
        data={data as never}
        options={options}
        label={label}
        height={height}
        focusMode="item"
        onSelect={
          onSelect
            ? (i) => {
                const c = sorted[i]
                if (c) onSelect(c.key)
              }
            : undefined
        }
        tooltip={([p]) => {
          const it = itemOf(p.raw) ?? sorted[p.index]
          if (!it) return null
          return (
            <div>
              <div className="mb-0.5 font-medium text-ink">{it.name}</div>
              <TipRow
                label={it.gainPct === null ? 'no cost on record' : `${changeLabel} ${pctText(it.gainPct)}`}
                value={format(it.value)}
              />
            </div>
          )
        }}
      />
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
  const theme = useChartTheme()
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)))

  const { data, options } = useMemo(() => {
    const pos = token('div-pos')
    const neg = token('div-neg')
    return {
      data: {
        labels: rows.map((r) => (r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label)),
        datasets: [
          {
            label,
            data: rows.map((r) => r.value),
            backgroundColor: rows.map((r) => (r.value >= 0 ? pos : neg)),
            hoverBackgroundColor: rows.map((r) => alpha(r.value >= 0 ? 'var(--div-pos)' : 'var(--div-neg)', 0.8)),
            borderRadius: 4,
            barThickness: 12
          }
        ]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: {
            min: -max * 1.6,
            max: max * 1.6,
            border: { display: false },
            ticks: { display: false },
            grid: {
              drawTicks: false,
              color: (ctx: { tick?: { value: number } }) => (ctx.tick?.value === 0 ? token('rule-strong') : 'transparent')
            }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: token('ink'), font: { size: 14, family: FONT }, crossAlign: 'far', padding: 12 },
            afterFit: (scale: { width: number }) => {
              scale.width = Math.min(240, Math.max(130, scale.width))
            }
          }
        },
        interaction: { mode: 'index', axis: 'y', intersect: false },
        plugins: { endLabels: { text: (i: number) => rows[i]?.sub ?? format(rows[i]?.value ?? 0) } }
      } as ChartOptions<'bar'>
    }
  }, [rows, max, label, theme])

  if (max === 0) return null
  return (
    <ChartBox
      type="bar"
      data={data as never}
      options={options}
      plugins={[endLabelsPlugin]}
      label={label}
      height={rows.length * 26 + 6}
      tooltip={([p]) => {
        const r = rows[p.index]
        if (!r) return null
        return <TipRow color={r.value >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} label={r.label} value={format(r.value)} />
      }}
    />
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
  const theme = useChartTheme()
  const totals = periods.map((p) => p.values.reduce((a, b) => a + b, 0))
  const max = Math.max(0, ...totals)

  const { data, options } = useMemo(() => {
    const top = periods.map((p) => p.values.reduce((o, v, i) => (v > 0 ? i : o), -1))
    const last = periods.length - 1
    return {
      data: {
        labels: periods.map((p) => p.label),
        datasets: series.map((s, si) => ({
          label: s.label,
          data: periods.map((p) => p.values[si] ?? 0),
          backgroundColor: resolveColor(s.color),
          hoverBackgroundColor: alpha(s.color, 0.85),
          borderSkipped: false,
          borderRadius: (ctx: ScriptableContext<'bar'>) =>
            top[ctx.dataIndex] === si ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 0,
          maxBarThickness: 28
        }))
      },
      options: {
        layout: { padding: { top: 20 } },
        scales: {
          x: categoryAxis({ stacked: true }),
          y: valueAxis(axisFormat, { stacked: true, beginAtZero: true })
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          endLabels: {
            text: (i: number) => (i === last && totals[i] > 0 ? axisFormat(totals[i]) : null),
            color: token('ink'),
            bold: true
          }
        }
      } as ChartOptions<'bar'>
    }
  }, [periods, series, theme])

  if (periods.length === 0 || max <= 0) return <div className="py-8 text-[14px] text-ink-muted">Nothing to show yet.</div>
  return (
    <div className="w-full">
      {series.length > 1 && <Legend items={series} />}
      <ChartBox
        type="bar"
        data={data as never}
        options={options}
        plugins={[endLabelsPlugin]}
        label={label}
        height={height}
        tooltip={(points) => {
          const pi = points[0]?.index
          if (pi === undefined) return null
          const p = periods[pi]
          return (
            <div className="flex flex-col gap-0.5">
              <div className="mb-0.5 font-medium text-ink">{p.label}</div>
              {p.values.map((v, si) =>
                v > 0 ? <TipRow key={si} color={series[si].color} label={series[si].label} value={format(v)} /> : null
              )}
              <TipRow label="Total" value={format(totals[pi])} />
            </div>
          )
        }}
      />
    </div>
  )
}

// ---------------- sparkline ----------------

export function Sparkline({ values, width = 84, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const theme = useChartTheme()
  const { data, options } = useMemo(() => {
    const up = values[values.length - 1] >= values[0]
    const color = token(up ? 'gain' : 'loss')
    const last = values.length - 1
    return {
      data: {
        labels: values.map((_, i) => i),
        datasets: [
          {
            data: values,
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: (ctx: ScriptableContext<'line'>) => (ctx.dataIndex === last ? 2.5 : 0),
            pointBackgroundColor: color,
            pointBorderWidth: 0,
            tension: 0
          }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        events: [],
        layout: { padding: 3 },
        scales: { x: { display: false }, y: { display: false } },
        plugins: { tooltip: { enabled: false } }
      } as ChartOptions<'line'>
    }
  }, [values, theme])

  if (values.length < 2) return null
  return (
    <span aria-hidden className="inline-block align-middle" style={{ width, height }}>
      <ReactChart type="line" data={data} options={options} width={width} height={height} />
    </span>
  )
}
