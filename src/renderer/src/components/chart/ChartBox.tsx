import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Chart as ReactChart } from 'react-chartjs-2'
import type { Chart, ChartData, ChartOptions, ChartType, Plugin, TooltipModel } from 'chart.js'
import { useTooltip } from './tooltip'
import './setup'

// Frame around every Chart.js chart: sizing, the shared HTML tooltip, click-to-select, and keyboard
// reading (arrow keys move through the values, Enter selects, Escape clears).

export interface Point {
  datasetIndex: number
  index: number
  /** The parsed data item Chart.js holds for this point (e.g. a treemap tile with its source row). */
  raw: unknown
}

export interface ChartBoxProps<T extends ChartType> {
  type: T
  data: ChartData<T>
  options: ChartOptions<T>
  label: string
  height: number
  /** Fixed width; omit to fill the container. */
  width?: number
  /** Tooltip content for the hovered or focused values; return null for no tooltip. */
  tooltip?: (points: Point[]) => ReactNode
  /** Called with the data index when a bar/slice is clicked or Enter is pressed on it. */
  onSelect?: (index: number) => void
  /** Extra drawing plugins (shared ones such as the crosshair work with any chart type). */
  plugins?: Plugin[]
  /** 'index': focus every dataset at one index (bars, lines). 'item': one item of the first dataset (donut, treemap). */
  focusMode?: 'index' | 'item'
  className?: string
}

export function ChartBox<T extends ChartType>({
  type,
  data,
  options,
  label,
  height,
  width,
  tooltip,
  onSelect,
  plugins,
  focusMode = 'index',
  className
}: ChartBoxProps<T>) {
  const tip = useTooltip()
  const chartRef = useRef<Chart<T> | null>(null)
  const tooltipRef = useRef(tooltip)
  tooltipRef.current = tooltip
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const lastKey = useRef('')
  const focusIdx = useRef(-1)
  const { show, hide } = tip

  const external = useCallback(
    ({ chart, tooltip: t }: { chart: Chart; tooltip: TooltipModel<ChartType> }) => {
      if (t.opacity === 0 || !t.dataPoints?.length) {
        if (lastKey.current) {
          lastKey.current = ''
          hide()
        }
        return
      }
      const points = t.dataPoints.map((p) => ({ datasetIndex: p.datasetIndex, index: p.dataIndex, raw: p.raw }))
      const key = points.map((p) => `${p.datasetIndex}:${p.index}`).join('|')
      if (key === lastKey.current) return
      lastKey.current = key
      const content = tooltipRef.current?.(points)
      if (!content) return hide()
      const r = chart.canvas.getBoundingClientRect()
      show({ clientX: r.left + t.caretX, clientY: r.top + t.caretY }, content)
    },
    [show, hide]
  )

  const merged = useMemo(() => {
    const o = options as ChartOptions<ChartType>
    return {
      ...o,
      plugins: { ...o.plugins, tooltip: { ...o.plugins?.tooltip, enabled: false, external } },
      onClick: (_e: unknown, els: { index: number }[]) => {
        if (els[0] && selectRef.current) selectRef.current(els[0].index)
      },
      onHover: (e: { native: Event | null }, els: unknown[]) => {
        const el = e.native?.target as HTMLElement | undefined
        if (el) el.style.cursor = selectRef.current && els.length ? 'pointer' : 'default'
      }
    } as ChartOptions<T>
  }, [options, external])

  const count = () => {
    const c = chartRef.current
    if (!c) return 0
    return Math.max(0, ...c.getSortedVisibleDatasetMetas().map((m) => m.data.length))
  }

  const activate = (i: number) => {
    const c = chartRef.current
    if (!c) return
    const metas = c.getSortedVisibleDatasetMetas()
    const els = (focusMode === 'item' ? metas.slice(0, 1) : metas)
      .filter((m) => m.data[i])
      .map((m) => ({ datasetIndex: m.index, index: i }))
    if (!els.length) return
    const anchor = metas.find((m) => m.data[i])!.data[i] as unknown as { x: number; y: number }
    focusIdx.current = i
    c.setActiveElements(els)
    c.tooltip?.setActiveElements(els, { x: anchor.x, y: anchor.y })
    c.update('none')
  }

  const clear = () => {
    const c = chartRef.current
    focusIdx.current = -1
    if (!c) return
    c.setActiveElements([])
    c.tooltip?.setActiveElements([], { x: 0, y: 0 })
    c.update('none')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = count()
    if (!n) return
    const i = focusIdx.current
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      activate(i < 0 ? 0 : Math.min(n - 1, i + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      activate(i < 0 ? n - 1 : Math.max(0, i - 1))
    } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0 && selectRef.current) {
      e.preventDefault()
      selectRef.current(i)
    } else if (e.key === 'Escape') clear()
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`${label}. Use the arrow keys to read values${onSelect ? ', Enter to open one' : ''}.`}
      className={'relative outline-offset-2 ' + (className ?? '')}
      style={{ height, width: width ?? '100%' }}
      onKeyDown={onKeyDown}
      onBlur={clear}
    >
      <ReactChart
        ref={chartRef as never}
        type={type}
        data={data}
        options={merged}
        plugins={plugins as Plugin<T>[] | undefined}
        aria-hidden
        data-chart={label}
      />
      {tip.node}
    </div>
  )
}
