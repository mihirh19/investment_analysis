import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type Time
} from 'lightweight-charts'
import type { ChartInterval } from '@shared/research'
import { aggregate, bollinger, emaSeries, macdSeries, rsiSeries, smaSeries, vwapSeries, type Candle, type Point } from '@shared/chartmath'
import { alpha, token, useChartTheme } from './chart/setup'
import { useChartBars } from '../lib/api'
import { percent, toneClass } from '../lib/format'

// A trading-style price chart (TradingView's Lightweight Charts): candles, volume, overlays,
// RSI and MACD panes, and other symbols compared in %.

export type ChartView = '1m' | '5m' | '15m' | '1h' | 'D' | 'W' | 'M'
const VIEWS: { key: ChartView; label: string; fetch: ChartInterval; show: number }[] = [
  { key: '1m', label: '1m', fetch: '1m', show: 375 },
  { key: '5m', label: '5m', fetch: '5m', show: 300 },
  { key: '15m', label: '15m', fetch: '15m', show: 250 },
  { key: '1h', label: '1H', fetch: '1h', show: 250 },
  { key: 'D', label: 'D', fetch: '1d', show: 250 },
  { key: 'W', label: 'W', fetch: '1d', show: 156 },
  { key: 'M', label: 'M', fetch: '1d', show: 120 }
]

type Overlay = 'sma20' | 'sma50' | 'sma200' | 'ema20' | 'bb' | 'vwap'
type Pane = 'rsi' | 'macd'
const OVERLAYS: { key: Overlay; label: string; colour: string }[] = [
  { key: 'sma20', label: 'SMA 20', colour: 'series-2' },
  { key: 'sma50', label: 'SMA 50', colour: 'series-3' },
  { key: 'sma200', label: 'SMA 200', colour: 'series-5' },
  { key: 'ema20', label: 'EMA 20', colour: 'series-4' },
  { key: 'bb', label: 'Bollinger', colour: 'series-8' },
  { key: 'vwap', label: 'VWAP', colour: 'series-7' }
]
const COMPARE_COLOURS = ['series-2', 'series-3', 'series-5']

export interface ChartSettings {
  view: ChartView
  candles: boolean
  overlays: Overlay[]
  panes: Pane[]
  compare: string[]
}
export const DEFAULT_CHART: ChartSettings = { view: 'D', candles: true, overlays: ['sma50', 'sma200'], panes: ['rsi'], compare: [] }

/** Chart settings kept between visits (in this window's local storage). */
export function useStoredChart(key: string, initial: ChartSettings = DEFAULT_CHART): [ChartSettings, (s: ChartSettings) => void] {
  const [settings, setSettings] = useState<ChartSettings>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ChartSettings> | null
      return v ? { ...initial, ...v } : initial
    } catch {
      return initial
    }
  })
  const set = (s: ChartSettings) => {
    setSettings(s)
    try {
      localStorage.setItem(key, JSON.stringify(s))
    } catch {
      // Not kept; the chart still works.
    }
  }
  return [settings, set]
}

const t = (v: string | number) => v as Time

export function StockChart({
  symbol,
  height = 460,
  settings,
  onSettings,
  compact = false
}: {
  symbol: string
  height?: number
  settings: ChartSettings
  onSettings: (s: ChartSettings) => void
  /** A small chart (a workspace panel): fewer controls. */
  compact?: boolean
}) {
  const view = VIEWS.find((v) => v.key === settings.view) ?? VIEWS[4]
  const main = useChartBars(symbol, view.fetch)
  const compares = useQueries({
    queries: settings.compare.map((s) => ({
      queryKey: ['history', 'bars', s, view.fetch],
      queryFn: async () => {
        const r = await window.api.getChartBars(s, view.fetch)
        if (!r.ok) throw new Error(r.error)
        return r.data
      },
      staleTime: 30 * 60_000,
      retry: 1
    }))
  })
  const theme = useChartTheme()
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // The price series, so a live tick moves its last bar without rebuilding the chart.
  const mainRef = useRef<{ update(bar: unknown): void; candles: boolean } | null>(null)
  const [hover, setHover] = useState<Candle | null>(null)

  const bars = useMemo(() => {
    const b = main.data?.bars ?? []
    return settings.view === 'W' ? aggregate(b, 'W') : settings.view === 'M' ? aggregate(b, 'M') : b
  }, [main.data, settings.view])
  const compareBars = compares.map((q) => {
    const b = q.data?.bars ?? []
    return settings.view === 'W' ? aggregate(b, 'W') : settings.view === 'M' ? aggregate(b, 'M') : b
  })
  const compareKey = compares.map((q) => q.dataUpdatedAt).join(',')
  // What the chart is drawn from, apart from the last bar's price (which live ticks move).
  const shape = `${symbol}|${settings.view}|${bars.length}|${String(bars[0]?.time)}|${String(bars.at(-1)?.time)}`

  useEffect(() => {
    const el = box.current
    if (!el || bars.length === 0) return
    const intraday = typeof bars[0].time === 'number'
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token('paper') },
        textColor: token('ink-muted'),
        fontSize: 11,
        panes: { separatorColor: token('rule-strong'), separatorHoverColor: token('rule-strong') },
        attributionLogo: true
      },
      grid: { vertLines: { color: alpha('var(--rule)', 0.6) }, horzLines: { color: alpha('var(--rule)', 0.6) } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: token('rule-strong') },
      timeScale: { borderColor: token('rule-strong'), timeVisible: intraday, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: (p: number) => p.toLocaleString('en-IN', { maximumFractionDigits: 2 }) }
    })
    chartRef.current = chart
    const comparing = settings.compare.length > 0
    const up = token('gain')
    const down = token('loss')
    if (comparing || !settings.candles) {
      const s = chart.addSeries(LineSeries, { color: token('series-1'), lineWidth: 2, priceLineVisible: !comparing })
      s.setData(bars.map((b) => ({ time: t(b.time), value: b.close })))
      mainRef.current = comparing ? null : { update: (b) => s.update(b as never), candles: false }
    } else {
      const s = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down })
      s.setData(bars.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close })))
      mainRef.current = { update: (b) => s.update(b as never), candles: true }
    }
    if (comparing) {
      chart.priceScale('right').applyOptions({ mode: PriceScaleMode.Percentage })
      compareBars.forEach((cb, i) => {
        if (cb.length === 0) return
        chart
          .addSeries(LineSeries, { color: token(COMPARE_COLOURS[i]), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: settings.compare[i] })
          .setData(cb.map((b) => ({ time: t(b.time), value: b.close })))
      })
    } else if (bars.some((b) => b.volume)) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      vol.setData(bars.map((b) => ({ time: t(b.time), value: b.volume ?? 0, color: alpha(b.close >= b.open ? 'var(--gain)' : 'var(--loss)', 0.35) })))
    }
    const line = (data: Point[], colour: string, opts: { pane?: number; dashed?: boolean; width?: 1 | 2 } = {}) => {
      const s = chart.addSeries(
        LineSeries,
        {
          color: token(colour),
          lineWidth: opts.width ?? 1,
          lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        },
        opts.pane ?? 0
      )
      s.setData(data.map((p) => ({ time: t(p.time), value: p.value })))
      return s
    }
    if (!comparing) {
      for (const o of settings.overlays) {
        const colour = OVERLAYS.find((x) => x.key === o)!.colour
        if (o === 'sma20') line(smaSeries(bars, 20), colour)
        if (o === 'sma50') line(smaSeries(bars, 50), colour)
        if (o === 'sma200') line(smaSeries(bars, 200), colour)
        if (o === 'ema20') line(emaSeries(bars, 20), colour)
        if (o === 'vwap' && intraday) line(vwapSeries(bars), colour, { width: 2 })
        if (o === 'bb') {
          const b = bollinger(bars)
          line(b.upper, colour, { dashed: true })
          line(b.middle, colour)
          line(b.lower, colour, { dashed: true })
        }
      }
    }
    let pane = 1
    for (const p of settings.panes) {
      if (p === 'rsi') {
        const s = line(rsiSeries(bars), 'series-1', { pane, width: 2 })
        s.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: '' })
        s.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: '' })
      }
      if (p === 'macd') {
        const m = macdSeries(bars)
        chart
          .addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
          .setData(m.histogram.map((h) => ({ time: t(h.time), value: h.value, color: alpha(h.value >= 0 ? 'var(--gain)' : 'var(--loss)', 0.6) })))
        line(m.macd, 'series-2', { pane, width: 2 })
        line(m.signal, 'series-4', { pane })
      }
      pane++
    }
    const panes = chart.panes()
    panes[0]?.setStretchFactor(3)
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1)
    const n = bars.length
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - view.show), to: n + 3 })
    const byTime = new Map(bars.map((b) => [String(b.time), b]))
    chart.subscribeCrosshairMove((param) => {
      setHover(param.time === undefined ? null : (byTime.get(String(param.time)) ?? null))
    })
    return () => {
      chartRef.current = null
      mainRef.current = null
      chart.remove()
    }
    // compareBars is derived from compareKey; the last bar's live moves are handled below, so only a
    // new bar (or a different series) rebuilds the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, compareKey, settings.candles, settings.overlays.join(), settings.panes.join(), settings.compare.join(), theme, view.show])

  // A live tick: move the last bar in place (indicators catch up at the next rebuild).
  const lastBar = bars[bars.length - 1]
  useEffect(() => {
    const m = mainRef.current
    if (!m || !lastBar) return
    m.update(m.candles ? { time: t(lastBar.time), open: lastBar.open, high: lastBar.high, low: lastBar.low, close: lastBar.close } : { time: t(lastBar.time), value: lastBar.close })
  }, [lastBar?.close, lastBar?.high, lastBar?.low])

  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  const shown = hover ?? last
  const shownPrev = shown ? bars[bars.indexOf(shown) - 1] : undefined
  const change = shown && shownPrev ? shown.close / shownPrev.close - 1 : null
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className={compact ? 'flex h-full min-h-0 flex-col' : 'flex flex-col'}>
      <div className={(compact ? 'no-scrollbar flex-nowrap overflow-x-auto' : 'flex-wrap') + ' flex shrink-0 items-center gap-x-2 gap-y-1.5 pb-1.5 text-[12px] whitespace-nowrap'}>
        <div role="radiogroup" aria-label="Interval" className="flex gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="radio"
              aria-checked={settings.view === v.key}
              onClick={() => onSettings({ ...settings, view: v.key })}
              className={'rounded px-1.5 py-0.5 ' + (settings.view === v.key ? 'bg-stamp-wash font-semibold text-stamp' : 'text-ink-muted hover:text-ink')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={settings.candles}
          onClick={() => onSettings({ ...settings, candles: !settings.candles })}
          className="rounded border border-rule px-1.5 py-0.5 text-ink-muted hover:text-ink"
        >
          {settings.candles ? 'Candles' : 'Line'}
        </button>
        {!compact &&
          OVERLAYS.filter((o) => o.key !== 'vwap' || typeof bars[0]?.time === 'number').map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={settings.overlays.includes(o.key)}
              onClick={() => onSettings({ ...settings, overlays: toggle(settings.overlays, o.key) })}
              className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (settings.overlays.includes(o.key) ? 'text-ink' : 'text-ink-muted/70 hover:text-ink')}
            >
              <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: `var(--${o.colour})`, opacity: settings.overlays.includes(o.key) ? 1 : 0.35 }} />
              {o.label}
            </button>
          ))}
        {(['rsi', 'macd'] as Pane[]).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={settings.panes.includes(p)}
            onClick={() => onSettings({ ...settings, panes: toggle(settings.panes, p) })}
            className={'rounded px-1.5 py-0.5 ' + (settings.panes.includes(p) ? 'bg-sheet text-ink' : 'text-ink-muted/70 hover:text-ink')}
          >
            {p.toUpperCase()}
          </button>
        ))}
        {!compact && <Compare list={settings.compare} onChange={(compare) => onSettings({ ...settings, compare })} />}
      </div>
      <div className={compact ? 'relative min-h-0 flex-1' : 'relative'} style={compact ? undefined : { height }}>
        <div ref={box} className="absolute inset-0" aria-label={`${symbol} price chart`} role="img" />
        {shown && (
          <div className="pointer-events-none absolute top-1 left-2 z-10 flex flex-wrap gap-x-3 text-[12px] text-ink-muted">
            <span className="font-semibold text-stamp">{symbol}</span>
            {settings.compare.length === 0 ? (
              <>
                <span className="num">O {shown.open.toFixed(2)}</span>
                <span className="num">H {shown.high.toFixed(2)}</span>
                <span className="num">L {shown.low.toFixed(2)}</span>
                <span className="num">C {shown.close.toFixed(2)}</span>
                <span className={`num ${toneClass(change)}`}>{percent(change)}</span>
              </>
            ) : (
              settings.compare.map((s, i) => (
                <span key={s} style={{ color: `var(--${COMPARE_COLOURS[i]})` }}>
                  {s}
                  {compares[i]?.error ? ' (not found)' : ''}
                </span>
              ))
            )}
            {main.data?.delayed && <span className="text-warn">delayed</span>}
          </div>
        )}
        {main.isLoading && <p className="absolute inset-0 grid place-items-center text-[13px] text-ink-muted">Loading {symbol}…</p>}
        {main.error && (
          <p role="alert" className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-loss">
            {main.error instanceof Error ? main.error.message : String(main.error)}
          </p>
        )}
      </div>
      {!compact && last && prev && (
        <p className="pt-1 text-[11.5px] text-ink-muted">
          Prices from Yahoo Finance{main.data?.delayed ? ', delayed' : ''}. Charts by TradingView Lightweight Charts.
        </p>
      )}
    </div>
  )
}

function Compare({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const [text, setText] = useState('')
  return (
    <span className="flex items-center gap-1.5">
      {list.map((s, i) => (
        <span key={s} className="flex items-center gap-1 rounded border border-rule px-1.5 py-0.5" style={{ color: `var(--${COMPARE_COLOURS[i]})` }}>
          {s}
          <button type="button" aria-label={`Stop comparing ${s}`} onClick={() => onChange(list.filter((x) => x !== s))} className="text-ink-muted hover:text-loss">
            ×
          </button>
        </span>
      ))}
      {list.length < 3 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const s = text.trim().toUpperCase()
            if (s && !list.includes(s)) onChange([...list, s])
            setText('')
          }}
        >
          <input
            aria-label="Compare with another symbol"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="+ Compare (^NSEI, INFY)"
            className="w-36 rounded border border-rule bg-transparent px-1.5 py-0.5 text-[12px] placeholder:text-ink-muted/70 focus:border-stamp focus:outline-none"
          />
        </form>
      )}
    </span>
  )
}
