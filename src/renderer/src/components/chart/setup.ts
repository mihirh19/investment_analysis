import { useSyncExternalStore } from 'react'
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
  type Plugin,
  type ChartType
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap'
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix'
import annotationPlugin from 'chartjs-plugin-annotation'
import { prefersReducedMotion } from '../../lib/motion'

// One place that wires Chart.js into the app: registration, colours taken from the CSS theme tokens,
// the app font, reduced-motion handling, and two small drawing plugins (crosshair, end-of-bar labels).

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
  TreemapController,
  TreemapElement,
  MatrixController,
  MatrixElement,
  annotationPlugin
)

export const FONT = "'Anek Latin Variable', 'Segoe UI', system-ui, sans-serif"

// ---------------- colours ----------------
// Pages pass colours as CSS (`var(--series-1)`, `color-mix(...)`), which a canvas cannot read.
// Resolve them through the DOM, then paint one pixel to get a plain rgba() string.

const cache = new Map<string, string>()
let probe: HTMLSpanElement | null = null
let pixel: CanvasRenderingContext2D | null = null

export function resolveColor(input: string): string {
  if (!input || typeof document === 'undefined') return input
  const hit = cache.get(input)
  if (hit) return hit
  if (!probe) {
    probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.appendChild(probe)
  }
  probe.style.color = ''
  probe.style.color = input
  const computed = getComputedStyle(probe).color
  let out = computed
  pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (pixel) {
    pixel.clearRect(0, 0, 1, 1)
    pixel.fillStyle = '#000'
    pixel.fillStyle = computed
    pixel.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data
    out = `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`
  }
  cache.set(input, out)
  return out
}

/** The same colour with a different opacity. */
export function alpha(input: string, a: number): string {
  const m = resolveColor(input).match(/rgba?\(([^)]+)\)/)
  if (!m) return input
  const [r, g, b] = m[1].split(',').map((s) => s.trim())
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export const token = (name: string) => resolveColor(`var(--${name})`)

// ---------------- theme store ----------------
// Bumps a version whenever the light/dark scheme, the <html> theme attribute or the web font changes,
// so charts re-resolve their colours.

let version = 0
const listeners = new Set<() => void>()

function applyDefaults() {
  Chart.defaults.font.family = FONT
  Chart.defaults.font.size = 12
  Chart.defaults.color = token('ink-muted')
  Chart.defaults.borderColor = token('rule')
  Chart.defaults.maintainAspectRatio = false
  Chart.defaults.responsive = true
  // Only the tooltip plugin is registered (legends are HTML), so guard plugin defaults that may be absent.
  if (Chart.defaults.plugins.tooltip) Chart.defaults.plugins.tooltip.enabled = false
  if (Chart.defaults.plugins.legend) Chart.defaults.plugins.legend.display = false
  // Mutate, never replace: Chart.js lists the keys of this object (type, fn, …) to know which animation
  // settings to read, so a replacement object breaks colour interpolation. Duration 0 = no animation.
  const anim = Chart.defaults.animation
  if (anim) {
    anim.duration = prefersReducedMotion() ? 0 : 700
    anim.easing = 'easeOutQuart'
  }
}

function bump() {
  cache.clear()
  version++
  applyDefaults()
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  applyDefaults()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', bump)
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener('change', bump)
  new MutationObserver(bump).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class']
  })
  document.fonts?.ready.then(bump)
}

/** Re-renders the caller when chart colours need resolving again. Use the value as a memo dependency. */
export function useChartTheme(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version
  )
}

// ---------------- shared scale styling ----------------

export function valueAxis(format: (v: number) => string, extra: Record<string, unknown> = {}) {
  return {
    grid: { color: token('rule'), drawTicks: false },
    border: { display: false },
    ticks: { color: token('ink-muted'), font: { size: 11 }, padding: 8, maxTicksLimit: 5, callback: (v: number | string) => format(Number(v)) },
    ...extra
  }
}

export function categoryAxis(extra: Record<string, unknown> = {}) {
  return {
    grid: { display: false },
    border: { color: token('rule-strong') },
    ticks: { color: token('ink-muted'), font: { size: 11 }, autoSkip: true, maxRotation: 0 },
    ...extra
  }
}

// ---------------- plugins ----------------

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    crosshair?: { color?: string } | false
    endLabels?: {
      /** Text for the bar or point at this index, or null for none. */
      text: (index: number) => string | null
      color?: string
      bold?: boolean
    } | false
  }
}

/** Vertical line through the hovered or focused index. */
export const crosshairPlugin: Plugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart, _args, raw) {
    const opts = raw as { color?: string } | false
    if (!opts) return
    const active = chart.tooltip?.getActiveElements() ?? []
    if (!active.length) return
    const x = active[0].element.x
    const { top, bottom } = chart.chartArea
    const ctx = chart.ctx
    ctx.save()
    ctx.strokeStyle = opts.color ?? token('ink-muted')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.restore()
  }
}

/** Writes a value at the outer end of a bar (or above a point), across stacked datasets. */
export const endLabelsPlugin: Plugin = {
  id: 'endLabels',
  afterDatasetsDraw(chart, _args, raw) {
    const opts = raw as { text?: (i: number) => string | null; color?: string; bold?: boolean } | false
    if (!opts || typeof opts.text !== 'function') return
    const horizontal = chart.options.indexAxis === 'y'
    const metas = chart.getSortedVisibleDatasetMetas()
    const count = Math.max(0, ...metas.map((m) => m.data.length))
    const ctx = chart.ctx
    ctx.save()
    ctx.fillStyle = opts.color ?? token('ink-muted')
    ctx.font = `${opts.bold ? 600 : 400} 12px ${FONT}`
    ctx.textBaseline = 'middle'
    for (let i = 0; i < count; i++) {
      const text = opts.text(i)
      if (!text) continue
      const els = metas
        .map((m) => ({
          el: m.data[i] as unknown as { x: number; y: number },
          v: Number((chart.data.datasets[m.index]?.data as unknown[] | undefined)?.[i] ?? 0)
        }))
        .filter((e) => e.el && Number.isFinite(e.el.x) && e.v !== 0)
      if (!els.length) continue
      if (horizontal) {
        const neg = els.every((e) => e.v < 0)
        const x = neg ? Math.min(...els.map((e) => e.el.x)) : Math.max(...els.map((e) => e.el.x))
        ctx.textAlign = neg ? 'right' : 'left'
        ctx.fillText(text, x + (neg ? -6 : 6), els[0].el.y)
      } else {
        const y = Math.min(...els.map((e) => e.el.y))
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(text, els[0].el.x, y - 4)
      }
    }
    ctx.restore()
  }
}
