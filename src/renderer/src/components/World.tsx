import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Topology } from 'topojson-specification'
import { geoContains } from 'd3-geo'
import { countryName } from '@shared/countries'
import {
  EVENT_KINDS,
  figureAt,
  metricOf,
  TRADE_PRODUCTS,
  WORLD_INDICES,
  WORLD_METRICS,
  type TradeRow,
  type WorldMap as WorldData,
  type WorldMetricKey,
  type WorldPlace
} from '@shared/world'
import { Panel } from './Monitor'
import { ErrorNote } from './Shell'
import { Sparkline } from './viz'
import WorldMap, { type Arc, type LayerKey, type Pick } from './WorldMap'
import {
  openExternal,
  useRefreshWorld,
  useSetWorldSync,
  useWorldMap,
  useWorldShips,
  useWorldSubscription
} from '../lib/api'
import { shortDate, timeAgo, toneClass } from '../lib/format'
import {
  countryShapes,
  EXPORT_COLOUR,
  fillFor,
  IMPORT_COLOUR,
  INDIA,
  legendGradient,
  metricText,
  signedPct,
  SHIP_COLOURS,
  trafficChange,
  usd,
  count,
  type CountryShape,
  type Rgba
} from '../lib/world'

const LAYERS: { key: LayerKey; label: string; fkey: string }[] = [
  { key: 'countries', label: 'Countries', fkey: 'F1' },
  { key: 'flows', label: 'Trade', fkey: 'F2' },
  { key: 'ports', label: 'Ports', fkey: 'F3' },
  { key: 'ships', label: 'Ships', fkey: 'F4' },
  { key: 'chokepoints', label: 'Chokepoints', fkey: 'F5' },
  { key: 'events', label: 'Disasters', fkey: 'F6' },
  { key: 'lanes', label: 'Lanes', fkey: 'F7' }
]
const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  countries: true,
  flows: true,
  ports: true,
  ships: false,
  chokepoints: true,
  events: true,
  lanes: true
}
const PREFS = 'world:prefs'
type Prefs = { layers: Record<LayerKey, boolean>; metric: WorldMetricKey; product: string; flow: 'X' | 'M' }

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>
    return {
      layers: { ...DEFAULT_LAYERS, ...p.layers },
      metric: WORLD_METRICS.some((m) => m.key === p.metric && !m.panelOnly) ? p.metric! : 'growth',
      product: TRADE_PRODUCTS.some((x) => x.cmd === p.product) ? p.product! : 'TOTAL',
      flow: p.flow === 'X' ? 'X' : 'M'
    }
  } catch {
    return { layers: DEFAULT_LAYERS, metric: 'growth', product: 'TOTAL', flow: 'M' }
  }
}

type Lane = { kind: string; path: [number, number][] }

/** The research desk's World tab: a black map of the world economy, trade, shipping and disasters. */
export default function World() {
  useWorldSubscription()
  const m = useWorldMap()
  const [prefs, setPrefs] = useState(loadPrefs)
  const { layers, metric, product, flow } = prefs
  const set = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      localStorage.setItem(PREFS, JSON.stringify(next))
      return next
    })
  const [selected, setSelected] = useState<Pick | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [closeUp, setCloseUp] = useState(false)
  const ships = useWorldShips(layers.ships)

  // Country shapes: the coarse set at once, the finer one when zoomed in.
  const [coarse, setCoarse] = useState<CountryShape[] | null>(null)
  const [fine, setFine] = useState<CountryShape[] | null>(null)
  const [lanes, setLanes] = useState<Lane[]>([])
  useEffect(() => {
    // Coarse borders draw at once; the finer set follows for close-ups and small countries (Singapore, Hong Kong).
    void import('world-atlas/countries-110m.json')
      .then((t) => setCoarse(countryShapes(t.default as unknown as Topology)))
      .then(() => import('world-atlas/countries-50m.json'))
      .then((t) => setFine(countryShapes(t.default as unknown as Topology)))
    void import('../assets/shipping-lanes.json').then((l) =>
      setLanes((l.default as unknown as { lanes: Lane[] }).lanes)
    )
  }, [])
  const shapes = (closeUp && fine) || coarse || []
  // Centres, outlines and the country list come from the finer set once it is in.
  const byIso = useMemo(() => new Map((fine ?? coarse ?? []).map((s) => [s.iso3, s])), [fine, coarse])

  const d = m.data
  const def = metricOf(metric)
  const series = d?.figures[metric]
  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const s of Object.values(series ?? {}))
      for (const p of Object.keys(s)) if (/^\d{4}$/.test(p)) ys.add(Number(p))
    return [...ys].sort((a, b) => a - b)
  }, [series])
  const lastYear = years.at(-1) ?? null
  // The latest year most countries have reported (the newest year is often thin).
  const usualYear = useMemo(() => {
    const n = new Map<number, number>()
    for (const s of Object.values(series ?? {}))
      for (const p of Object.keys(s)) if (/^\d{4}$/.test(p)) n.set(Number(p), (n.get(Number(p)) ?? 0) + 1)
    const most = Math.max(0, ...n.values())
    return (
      [...n.entries()]
        .filter(([, c]) => c >= most * 0.6)
        .map(([y]) => y)
        .sort((a, b) => a - b)
        .at(-1) ?? lastYear
    )
  }, [series, lastYear])
  const shownYear = def.yearly ? (year !== null && years.includes(year) ? year : usualYear) : null

  // Play: step through the years, then stop at the latest.
  useEffect(() => {
    if (!playing || !def.yearly || years.length < 2) return
    const t = setInterval(() => {
      setYear((y) => {
        const i = years.indexOf(y ?? years[0])
        if (i < 0 || i >= years.length - 1) {
          setPlaying(false)
          return years.at(-1)!
        }
        return years[i + 1]
      })
    }, 700)
    return () => clearInterval(t)
  }, [playing, def.yearly, years])

  const valueOf = (iso3: string) => figureAt(series?.[iso3], shownYear, def.yearly ? 2 : 0)
  const fills = useMemo(() => {
    const out = new Map<string, Rgba>()
    for (const iso3 of Object.keys(series ?? {})) {
      const f = figureAt(series?.[iso3], shownYear, def.yearly ? 2 : 0)
      if (f) out.set(iso3, fillFor(def, f.value))
    }
    return out
  }, [series, shownYear, def])

  // Trade: the latest year on file up to the slider's year.
  const tradeYears = useMemo(() => [...new Set((d?.trade ?? []).map((r) => r.period))].sort(), [d?.trade])
  const tradeYear =
    tradeYears.filter((y) => shownYear === null || Number(y) <= shownYear).at(-1) ?? tradeYears.at(-1) ?? null
  const tradeRows = useMemo(
    () =>
      (d?.trade ?? [])
        .filter((r) => r.period === tradeYear && r.cmd === product && r.flow === flow)
        .sort((a, b) => b.value - a.value),
    [d?.trade, tradeYear, product, flow]
  )
  const arcs: Arc[] = useMemo(
    () =>
      tradeRows.slice(0, 25).flatMap((r) => {
        const s = byIso.get(r.partner)
        if (!s || r.partner === 'IND') return []
        const goods = TRADE_PRODUCTS.find((x) => x.cmd === r.cmd)?.label ?? r.cmd
        return [
          {
            iso3: r.partner,
            name: s.name,
            from: flow === 'X' ? INDIA : s.centre,
            to: flow === 'X' ? s.centre : INDIA,
            value: r.value,
            colour: flow === 'X' ? EXPORT_COLOUR : IMPORT_COLOUR,
            text: `${flow === 'X' ? 'India → ' + s.name : s.name + ' → India'}\n${goods}, ${r.period}: ${usd(r.value)}${r.weight ? `\n${count(r.weight / 1000)} tonnes` : ''}`
          }
        ]
      }),
    [tradeRows, byIso, flow]
  )

  const describe = (iso3: string) => {
    const f = valueOf(iso3)
    return `${countryName(iso3)}\n${def.label}: ${f ? `${metricText(def, f.value)} (${f.period})` : 'no figure'}`
  }

  // F1–F7 (or 1–7 outside a text box) switch layers; Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
      const fi = /^F([1-7])$/.exec(e.key)
      const ni = !typing && !e.ctrlKey && !e.altKey && /^[1-7]$/.test(e.key) ? Number(e.key) : null
      const i = fi ? Number(fi[1]) : ni
      if (i) {
        e.preventDefault()
        const k = LAYERS[i - 1].key
        setPrefs((p) => {
          const next = { ...p, layers: { ...p.layers, [k]: !p.layers[k] } }
          localStorage.setItem(PREFS, JSON.stringify(next))
          return next
        })
      } else if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const countriesWithData = useMemo(
    () => [...byIso.values()].filter((s) => s.iso3 !== 'ATA').sort((a, b) => a.name.localeCompare(b.name)),
    [byIso]
  )
  const credits = [
    layers.countries && `${def.source} (${def.label.toLowerCase()})`,
    layers.flows && 'UN Comtrade',
    (layers.ports || layers.chokepoints) && 'IMF PortWatch',
    layers.ships && 'Source: Fintraffic / digitraffic.fi',
    layers.ships && ships.data?.feeds.some((f) => f.key === 'aisstream' && f.on) && 'aisstream.io',
    layers.events && 'USGS, GDACS',
    layers.lanes && 'Lanes CC BY 4.0 newzealandpaul/Shipping-Lanes',
    'Borders: Natural Earth'
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      <ErrorNote error={m.error} />
      {/* Layer switches and what the map shows. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <div role="group" aria-label="Map layers" className="flex flex-wrap gap-1">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-pressed={layers[l.key]}
              onClick={() => set({ layers: { ...layers, [l.key]: !layers[l.key] } })}
              className={
                'rounded-sm border px-2 py-0.5 ' +
                (layers[l.key]
                  ? 'border-stamp bg-stamp-wash text-stamp'
                  : 'border-rule text-ink-muted hover:border-rule-strong hover:text-ink')
              }
              title={`${l.label} (${l.fkey})`}
            >
              <span className="mr-1 text-[11px] opacity-70">{l.fkey}</span>
              {l.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-ink-muted">
          Colour by
          <select
            aria-label="Colour countries by"
            value={metric}
            onChange={(e) => {
              set({ metric: e.target.value as WorldMetricKey })
              setPlaying(false)
            }}
            className="rounded-sm border border-rule-strong bg-sheet px-1.5 py-0.5 text-ink"
          >
            {WORLD_METRICS.filter((x) => !x.panelOnly).map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-ink-muted">
          Trade
          <select
            aria-label="Trade direction"
            value={flow}
            onChange={(e) => set({ flow: e.target.value === 'X' ? 'X' : 'M' })}
            className="rounded-sm border border-rule-strong bg-sheet px-1.5 py-0.5 text-ink"
          >
            <option value="M">India’s imports</option>
            <option value="X">India’s exports</option>
          </select>
          <select
            aria-label="Goods"
            value={product}
            onChange={(e) => set({ product: e.target.value })}
            className="rounded-sm border border-rule-strong bg-sheet px-1.5 py-0.5 text-ink"
          >
            {TRADE_PRODUCTS.map((x) => (
              <option key={x.cmd} value={x.cmd}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-ink-muted">
          Country
          <select
            aria-label="Find a country"
            value={selected?.kind === 'country' ? selected.iso3 : ''}
            onChange={(e) => setSelected(e.target.value ? { kind: 'country', iso3: e.target.value } : null)}
            className="max-w-[180px] rounded-sm border border-rule-strong bg-sheet px-1.5 py-0.5 text-ink"
          >
            <option value="">Choose…</option>
            {countriesWithData.map((s) => (
              <option key={s.iso3} value={s.iso3}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="relative h-[calc(100vh-300px)] min-h-[460px] overflow-hidden rounded-sm border border-rule bg-black"
        role="region"
        aria-label="World map"
      >
        {coarse ? (
          <WorldMap
            shapes={shapes}
            fills={fills}
            describe={describe}
            arcs={layers.flows ? arcs : []}
            places={d?.places ?? []}
            events={d?.events ?? []}
            ships={ships.data?.ships ?? []}
            lanes={lanes}
            layers={layers}
            selected={selected}
            onPick={setSelected}
            onCloseUp={setCloseUp}
          />
        ) : (
          <p className="p-4 text-[13px] text-ink-muted">Drawing the map…</p>
        )}

        <Legend
          metric={metric}
          year={shownYear}
          flow={flow}
          tradeYear={tradeYear}
          layers={layers}
          productLabel={TRADE_PRODUCTS.find((x) => x.cmd === product)?.label ?? ''}
        />

        {def.yearly && years.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex w-[min(460px,40%)] -translate-x-1/2 items-center gap-2 rounded-sm border border-rule bg-black/85 px-2.5 py-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => {
                if (!playing) setYear(shownYear === lastYear ? years[0] : shownYear)
                setPlaying(!playing)
              }}
              className="w-12 rounded-sm border border-rule-strong px-1 text-stamp hover:bg-stamp-wash"
              aria-label={playing ? 'Pause' : 'Play through the years'}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              aria-label="Year"
              min={years[0]}
              max={lastYear ?? years[0]}
              step={1}
              value={shownYear ?? lastYear ?? 0}
              onChange={(e) => {
                setPlaying(false)
                setYear(Number(e.target.value))
              }}
              className="flex-1 accent-[#ffa630]"
            />
            <span className="num w-10 text-right text-ink">{shownYear}</span>
          </div>
        )}

        <p className="pointer-events-none absolute top-1.5 right-2 max-w-[60%] text-right text-[10.5px] leading-tight text-ink-muted/80">
          {credits.join(' · ')}
        </p>

        {d && selected && (
          <SidePanel
            data={d}
            pick={selected}
            shape={selected.kind === 'country' ? byIso.get(selected.iso3) : undefined}
            metric={metric}
            year={shownYear}
            onClose={() => setSelected(null)}
            onPick={setSelected}
            ships={ships.data?.ships ?? []}
          />
        )}
      </div>

      {layers.ships && ships.data && (
        <p className="text-[12.5px] text-ink-muted" aria-live="polite">
          Ships:{' '}
          {ships.data.feeds
            .filter((f) => f.on)
            .map((f) => `${f.label} ${f.error ? `(${f.error})` : `${f.count.toLocaleString('en-IN')}`}`)
            .join(' · ')}
          {!ships.data.feeds.find((f) => f.key === 'aisstream')?.on &&
            ' · Add your own free aisstream.io key in Settings to see ships around India.'}{' '}
          {Object.entries(SHIP_COLOURS).map(([k, c]) => (
            <span key={k} className="ml-2 inline-flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
              />
              {k}
            </span>
          ))}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Chokepoints" note="vessels a day, latest week">
          <PlaceTable
            places={(d?.places ?? []).filter((p) => p.kind === 'chokepoint' && p.followed)}
            unit="transits"
            onPick={(id) => setSelected({ kind: 'place', id })}
          />
        </Panel>
        <Panel title="India’s ports" note="calls a day, latest week">
          <PlaceTable
            places={(d?.places ?? []).filter((p) => p.kind === 'port' && p.followed)}
            unit="calls"
            onPick={(id) => setSelected({ kind: 'place', id })}
          />
        </Panel>
        <Panel title="Freight and sources">
          <Freight data={d} />
          <Sources data={d} />
        </Panel>
      </div>
      <p className="max-w-[90ch] text-[12.5px] text-ink-muted">
        Public figures, fetched slowly in the background and kept on this computer: IMF PortWatch (weekly, about a week
        behind), UN Comtrade (monthly; trade figures lag a few months), the World Bank, BIS and OECD (weekly or
        monthly), Yahoo Finance indices, USGS and GDACS disasters (every 15 minutes). Ships are fetched only while the
        ships layer is on. None of it is advice.
      </p>
    </div>
  )
}

function Legend({
  metric,
  year,
  flow,
  tradeYear,
  layers,
  productLabel
}: {
  metric: WorldMetricKey
  year: number | null
  flow: 'X' | 'M'
  tradeYear: string | null
  layers: Record<LayerKey, boolean>
  productLabel: string
}) {
  const m = metricOf(metric)
  return (
    <div
      className="absolute bottom-3 left-3 w-[230px] rounded-sm border border-rule bg-black/85 p-2 text-[11.5px] text-ink-muted"
      aria-label="Legend"
    >
      {layers.countries && (
        <>
          <div className="text-ink">
            {m.label}
            {year !== null ? `, ${year}` : ', latest'}
          </div>
          <div className="mt-1 h-2 rounded-sm" style={{ background: legendGradient(m) }} />
          <div className="num mt-0.5 flex justify-between">
            <span>{metricText(m, m.lo)}</span>
            <span>{metricText(m, m.mid)}</span>
            <span>{metricText(m, m.hi)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="inline-block size-2 border border-rule bg-[#141414]" /> no figure
          </div>
        </>
      )}
      {layers.flows && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: flow === 'X' ? '#ffa630' : '#4cc9f0' }} />
          {flow === 'X' ? 'India’s exports' : 'India’s imports'}: {productLabel}
          {tradeYear ? `, ${tradeYear}` : ''}
        </div>
      )}
      {layers.chokepoints && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          Chokepoints vs a year ago:
          <span className="text-loss">−25% or more</span>
          <span className="text-gain">+10%</span>
        </div>
      )}
    </div>
  )
}

const pct = (x: number | null) => (x === null ? '—' : signedPct(x))

function PlaceTable({ places, unit, onPick }: { places: WorldPlace[]; unit: string; onPick: (id: string) => void }) {
  if (places.length === 0)
    return <p className="text-[13px] text-ink-muted">Arrives with the first weekly PortWatch update.</p>
  const rows = [...places].sort((a, b) => (b.recent ?? 0) - (a.recent ?? 0))
  return (
    <div className="max-h-[440px] overflow-y-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-sheet">
          <tr className="text-left text-[11.5px] text-ink-muted">
            <th className="font-normal">Name</th>
            <th className="text-right font-normal">{unit}/day</th>
            <th className="text-right font-normal">vs a year ago</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const ch = trafficChange(p)
            return (
              <tr
                key={p.id}
                tabIndex={0}
                onClick={() => onPick(p.id)}
                onKeyDown={(e) => e.key === 'Enter' && onPick(p.id)}
                className="cursor-pointer border-b border-rule last:border-0 hover:bg-paper focus:bg-paper focus:outline-none"
              >
                <th
                  scope="row"
                  className="max-w-[170px] truncate py-1 pr-2 text-left font-normal text-ink"
                  title={p.name}
                >
                  {p.name}
                </th>
                <td className="num text-right">{p.recent === null ? '—' : p.recent.toFixed(1)}</td>
                <td className={`num text-right ${toneClass(ch)}`}>{pct(ch)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Freight({ data }: { data: WorldData | undefined }) {
  const f = data?.freight ?? []
  const last = f.at(-1)
  const prev = f.at(-2)
  if (!last)
    return (
      <p className="mb-3 text-[13px] text-ink-muted">
        The Shanghai container freight index (SCFI) arrives with the first update.
      </p>
    )
  const ch = prev ? last.value / prev.value - 1 : null
  return (
    <div className="mb-3 border-b border-rule pb-2">
      <div className="text-[12.5px] text-ink-muted">Shanghai container freight index (SCFI)</div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-[15px] text-ink">
          {last.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </span>
        <span className="num text-[12px] text-ink-muted">
          {ch === null ? '' : `${(ch * 100 >= 0 ? '+' : '−') + Math.abs(ch * 100).toFixed(1)}% on the week`}
        </span>
      </div>
      {f.length > 2 && <Sparkline values={f.map((x) => x.value)} width={220} height={34} />}
      <div className="text-[11.5px] text-ink-muted">Week to {shortDate(last.date)}; kept one reading a week</div>
    </div>
  )
}

function Sources({ data }: { data: WorldData | undefined }) {
  const toggle = useSetWorldSync()
  const refresh = useRefreshWorld()
  if (!data) return null
  return (
    <div className="text-[12.5px]">
      <ul className="flex flex-col gap-0.5" aria-label="World map sources">
        {data.sources.map((s) => (
          <li key={s.key} className="flex justify-between gap-2">
            <span className="truncate text-ink-muted" title={s.credit}>
              {s.label}
            </span>
            <span className={s.error ? 'text-loss' : 'text-ink-muted'} title={s.error ?? undefined}>
              {s.error ? 'failed, retrying' : s.updatedAt ? timeAgo(s.updatedAt) : 'not yet'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-sm border border-rule-strong px-2 py-0.5 text-ink hover:bg-paper disabled:opacity-50"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!data.enabled)}
        >
          {data.enabled ? 'Pause updates' : 'Resume updates'}
        </button>
        <button
          type="button"
          className="rounded-sm border border-rule-strong px-2 py-0.5 text-stamp hover:bg-stamp-wash disabled:opacity-50"
          disabled={refresh.isPending || data.refreshing}
          onClick={() => refresh.mutate()}
        >
          {data.refreshing ? 'Updating…' : 'Update now'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-0.5 text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className="num text-right text-ink">{children}</span>
    </div>
  )
}

function SidePanel({
  data,
  pick,
  shape,
  metric,
  year,
  ships,
  onClose,
  onPick
}: {
  data: WorldData
  pick: Pick
  shape: CountryShape | undefined
  metric: WorldMetricKey
  year: number | null
  ships: {
    mmsi: number
    name: string | null
    sog: number | null
    cog: number | null
    type: number | null
    at: number
    lat: number
    lon: number
  }[]
  onClose: () => void
  onPick: (p: Pick) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [pick])
  let title = ''
  let body: ReactNode = null
  if (pick.kind === 'country') {
    title = countryName(pick.iso3)
    body = <CountryFacts data={data} iso3={pick.iso3} shape={shape} metric={metric} year={year} onPick={onPick} />
  } else if (pick.kind === 'place') {
    const p = data.places.find((x) => x.id === pick.id)
    title = p?.name ?? pick.id
    body = p ? <PlaceFacts p={p} /> : null
  } else if (pick.kind === 'event') {
    const e = data.events.find((x) => x.id === pick.id)
    title = e?.title ?? 'Event'
    body = e && (
      <>
        <Row label="Kind">{EVENT_KINDS[e.kind]}</Row>
        {e.magnitude !== null && <Row label={e.kind === 'EQ' ? 'Magnitude' : 'Severity'}>{e.magnitude.toFixed(1)}</Row>}
        {e.level && <Row label="GDACS alert">{e.level}</Row>}
        <Row label="When">{e.time.slice(0, 16).replace('T', ' ')} UTC</Row>
        <Row label="Where">
          {e.lat.toFixed(2)}, {e.lon.toFixed(2)}
        </Row>
        <Row label="Source">{e.source}</Row>
        {e.url && /^https:\/\//.test(e.url) && (
          <button
            type="button"
            className="mt-2 text-[12.5px] text-stamp hover:underline"
            onClick={() => void openExternal(e.url!)}
          >
            Open the {e.source} report
          </button>
        )}
      </>
    )
  } else {
    const s = ships.find((x) => x.mmsi === pick.mmsi)
    title = s?.name ?? `MMSI ${pick.mmsi}`
    body = s && (
      <>
        <Row label="MMSI">{s.mmsi}</Row>
        <Row label="Speed">{s.sog === null ? '—' : `${s.sog.toFixed(1)} knots`}</Row>
        <Row label="Course">{s.cog === null ? '—' : `${Math.round(s.cog)}°`}</Row>
        <Row label="AIS type">{s.type ?? '—'}</Row>
        <Row label="Position at">{new Date(s.at).toISOString().slice(11, 16)} UTC</Row>
      </>
    )
  }
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      className="anim-page absolute top-0 right-0 bottom-0 z-20 w-[340px] overflow-y-auto border-l border-rule bg-[#0a0a0a] p-3 focus:outline-none"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-stamp">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-1.5 text-ink-muted hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {body}
    </div>
  )
}

function PlaceFacts({ p }: { p: WorldPlace }) {
  const ch = trafficChange(p)
  const label = p.kind === 'chokepoint' ? 'Transits a day' : 'Calls a day'
  return (
    <>
      <Row label="Kind">
        {p.kind === 'chokepoint' ? 'Chokepoint' : `Port${p.iso3 ? `, ${countryName(p.iso3)}` : ''}`}
      </Row>
      {p.locode && <Row label="UN/LOCODE">{p.locode}</Row>}
      {p.followed ? (
        <>
          <Row label={`${label}, latest week`}>{p.recent?.toFixed(1) ?? '—'}</Row>
          <Row label="Same week a year ago">{p.yearAgo?.toFixed(1) ?? '—'}</Row>
          <Row label="Change">
            <span className={toneClass(ch)}>{pct(ch)}</span>
          </Row>
          {p.imports7 !== null && <Row label="Imports a day">{count(p.imports7)} t</Row>}
          {p.exports7 !== null && <Row label="Exports a day">{count(p.exports7)} t</Row>}
          <Row label="Latest day">{p.latestDate ? shortDate(p.latestDate) : '—'}</Row>
          {p.weekly.length > 2 && (
            <div className="mt-2">
              <div className="text-[11.5px] text-ink-muted">Weekly average, last {p.weekly.length} weeks</div>
              <Sparkline values={p.weekly.map((w) => w.total)} width={300} height={60} />
            </div>
          )}
        </>
      ) : (
        <Row label="Vessel calls a year">{p.vessels ? Math.round(p.vessels).toLocaleString('en-IN') : '—'}</Row>
      )}
      <p className="mt-2 text-[11.5px] text-ink-muted">
        IMF PortWatch, from satellite AIS. Updated weekly, about a week behind.
      </p>
    </>
  )
}

function CountryFacts({
  data,
  iso3,
  shape,
  metric,
  year,
  onPick
}: {
  data: WorldData
  iso3: string
  shape: CountryShape | undefined
  metric: WorldMetricKey
  year: number | null
  onPick: (p: Pick) => void
}) {
  const sel = metricOf(metric)
  const selSeries = data.figures[metric]?.[iso3]
  const yearly = selSeries
    ? Object.entries(selSeries)
        .filter(([p]) => /^\d{4}$/.test(p))
        .sort(([a], [b]) => a.localeCompare(b))
    : []
  const index = WORLD_INDICES.find((i) => i.iso3 === iso3)
  const trade = data.trade.filter((r) => r.partner === iso3)
  const tradeYear = [...new Set(trade.map((r) => r.period))].sort().at(-1)
  const of = (flow: 'X' | 'M', cmd = 'TOTAL') =>
    trade.find((r) => r.period === tradeYear && r.flow === flow && r.cmd === cmd)
  const goods = trade
    .filter((r) => r.period === tradeYear && r.cmd !== 'TOTAL')
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const events = shape ? data.events.filter((e) => geoContains(shape.feature, [e.lon, e.lat])) : []
  return (
    <>
      <div className="mb-2">
        <div className="text-[11.5px] text-ink-muted">
          {sel.label}
          {sel.yearly && year ? `, ${year}` : ''}
        </div>
        <div className="num text-[20px] text-ink">
          {metricText(sel, figureAt(selSeries, sel.yearly ? year : null, sel.yearly ? 2 : 0)?.value)}
        </div>
        {yearly.length > 2 && <Sparkline values={yearly.map(([, v]) => v)} width={300} height={50} />}
        {yearly.length > 2 && (
          <div className="text-[11px] text-ink-muted">
            {yearly[0][0]}–{yearly.at(-1)![0]}
          </div>
        )}
      </div>
      <h3 className="mt-2 text-[12.5px] font-semibold text-stamp">Figures</h3>
      {WORLD_METRICS.map((mm) => {
        const f = figureAt(data.figures[mm.key]?.[iso3], null)
        if (!f) return null
        return (
          <Row key={mm.key} label={mm.label}>
            {metricText(mm, f.value)}{' '}
            <span className="text-[11px] text-ink-muted">{f.period.length > 7 ? shortDate(f.period) : f.period}</span>
          </Row>
        )
      })}
      {index && (
        <p className="mt-1 text-[11.5px] text-ink-muted">
          Stock index: {index.name} ({index.symbol})
        </p>
      )}
      {iso3 !== 'IND' && (
        <>
          <h3 className="mt-3 text-[12.5px] font-semibold text-stamp">
            Trade with India{tradeYear ? `, ${tradeYear}` : ''}
          </h3>
          {trade.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">No trade figures on file yet.</p>
          ) : (
            <>
              <Row label="India’s exports to it">{usd(of('X')?.value)}</Row>
              <Row label="India’s imports from it">{usd(of('M')?.value)}</Row>
              <Row label="Balance for India">{of('X') && of('M') ? usd(of('X')!.value - of('M')!.value) : '—'}</Row>
              {goods.length > 0 && <TradeGoods rows={goods} />}
            </>
          )}
        </>
      )}
      {events.length > 0 && (
        <>
          <h3 className="mt-3 text-[12.5px] font-semibold text-stamp">Recent disasters</h3>
          <ul className="text-[12.5px]">
            {events.slice(0, 6).map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="text-left text-ink hover:text-stamp"
                  onClick={() => onPick({ kind: 'event', id: e.id })}
                >
                  {e.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function TradeGoods({ rows }: { rows: TradeRow[] }) {
  return (
    <div className="mt-1">
      <div className="text-[11.5px] text-ink-muted">Followed goods</div>
      {rows.map((r) => (
        <Row
          key={`${r.flow}${r.cmd}`}
          label={`${TRADE_PRODUCTS.find((p) => p.cmd === r.cmd)?.label ?? r.cmd} (${r.flow === 'X' ? 'export' : 'import'})`}
        >
          {usd(r.value)}
        </Row>
      ))}
    </div>
  )
}
