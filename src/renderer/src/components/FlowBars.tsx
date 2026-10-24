import { useEffect, useRef } from 'react'
import { ColorType, createChart, HistogramSeries, LineSeries, type Time } from 'lightweight-charts'
import { alpha, token, useChartTheme } from './chart/setup'

/**
 * Bars over time, green above zero and red below (net buying and selling), with an optional line on
 * its own scale (a running total, or a share). Dates as "YYYY-MM-DD"; months as "YYYY-MM".
 */
export function FlowBars({
  bars,
  line,
  lineLabel,
  height = 220,
  label,
  unit = '₹ Cr'
}: {
  bars: { time: string; value: number }[]
  line?: { time: string; value: number }[]
  lineLabel?: string
  height?: number
  label: string
  unit?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const theme = useChartTheme()
  useEffect(() => {
    const el = box.current
    if (!el || bars.length === 0) return
    const day = (t: string) => (t.length === 7 ? `${t}-01` : t) as Time
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: token('paper') }, textColor: token('ink-muted'), fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha('var(--rule)', 0.6) } },
      rightPriceScale: { borderColor: token('rule-strong') },
      leftPriceScale: { visible: !!line, borderColor: token('rule-strong') },
      timeScale: { borderColor: token('rule-strong') },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(p) < 10 ? 2 : 0 }) }
    })
    const sorted = [...bars].sort((a, b) => a.time.localeCompare(b.time))
    chart
      .addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, title: unit })
      .setData(sorted.map((b) => ({ time: day(b.time), value: b.value, color: alpha(b.value >= 0 ? 'var(--gain)' : 'var(--loss)', 0.8) })))
    if (line && line.length) {
      chart
        .addSeries(LineSeries, { priceScaleId: 'left', color: token('series-1'), lineWidth: 2, priceLineVisible: false, title: lineLabel })
        .setData([...line].sort((a, b) => a.time.localeCompare(b.time)).map((p) => ({ time: day(p.time), value: p.value })))
    }
    chart.timeScale().fitContent()
    return () => {
      chart.remove()
    }
  }, [bars, line, lineLabel, theme, unit])
  if (bars.length === 0) return null
  return <div ref={box} role="img" aria-label={label} style={{ height }} className="w-full" />
}
