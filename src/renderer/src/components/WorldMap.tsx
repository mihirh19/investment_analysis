import { useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { MapView, type MapViewState, type PickingInfo } from '@deck.gl/core'
import { ArcLayer, GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { EVENT_KINDS, type Ship, type WorldEvent, type WorldPlace } from '@shared/world'
import { chokepointColour, eventColour, NO_DATA, shipColour, type CountryShape, type Rgba } from '../lib/world'

export type LayerKey = 'countries' | 'flows' | 'ports' | 'ships' | 'chokepoints' | 'events' | 'lanes'

export interface Arc {
  iso3: string
  name: string
  from: [number, number]
  to: [number, number]
  value: number
  colour: Rgba
  /** Shown in the tooltip. */
  text: string
}

export type Pick =
  | { kind: 'country'; iso3: string }
  | { kind: 'place'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'ship'; mmsi: number }

interface Lane {
  kind: string
  path: [number, number][]
}

export interface WorldMapProps {
  shapes: CountryShape[]
  fills: Map<string, Rgba>
  /** Tooltip lines for each country under the current colouring. */
  describe: (iso3: string) => string
  arcs: Arc[]
  places: WorldPlace[]
  events: WorldEvent[]
  ships: Ship[]
  lanes: Lane[]
  layers: Record<LayerKey, boolean>
  selected: Pick | null
  onPick: (p: Pick | null) => void
  /** Told only when the zoom crosses into or out of close-up (finer borders). */
  onCloseUp: (closeUp: boolean) => void
}

const INITIAL: MapViewState = { longitude: 66, latitude: 18, zoom: 1.6, minZoom: 0.6, maxZoom: 9, pitch: 0, bearing: 0 }
const VIEW = new MapView({ repeat: true })
const LANE_ALPHA: Record<string, number> = { major: 120, middle: 75, minor: 45 }

const tipStyle = {
  background: '#0c0c0c',
  color: '#ffa630',
  border: '1px solid #3a3a3a',
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: '12px',
  padding: '6px 8px',
  whiteSpace: 'pre',
  maxWidth: '360px'
}

function placeText(p: WorldPlace): string {
  const lines = [p.name, p.kind === 'chokepoint' ? 'Chokepoint' : `Port${p.iso3 ? `, ${p.iso3}` : ''}`]
  if (p.recent !== null)
    lines.push(`${p.kind === 'chokepoint' ? 'Transits' : 'Calls'} a day, latest week: ${p.recent.toFixed(1)}`)
  if (p.recent !== null && p.yearAgo)
    lines.push(
      `A year before: ${p.yearAgo.toFixed(1)} (${p.recent >= p.yearAgo ? '+' : '−'}${Math.abs((p.recent / p.yearAgo - 1) * 100).toFixed(0)}%)`
    )
  if (!p.followed && p.vessels) lines.push(`About ${Math.round(p.vessels).toLocaleString('en-IN')} vessel calls a year`)
  if (p.latestDate) lines.push(`To ${p.latestDate}`)
  return lines.join('\n')
}

/** The black world map: coloured countries, India's trade arcs, ports, chokepoints, ships, disasters and lanes. */
export default function WorldMap(p: WorldMapProps) {
  // Names appear when zoomed in; the page hears only about crossing into close-up, not every frame.
  const [labels, setLabels] = useState(false)
  const closeUp = useRef(false)
  const features = useMemo(() => p.shapes.map((s) => s.feature), [p.shapes])
  const selIso = p.selected?.kind === 'country' ? p.selected.iso3 : null
  const selPlace = p.selected?.kind === 'place' ? p.selected.id : null

  const chokepoints = useMemo(() => p.places.filter((x) => x.kind === 'chokepoint'), [p.places])
  const indiaPorts = useMemo(() => p.places.filter((x) => x.kind === 'port' && x.followed), [p.places])
  const otherPorts = useMemo(() => p.places.filter((x) => x.kind === 'port' && !x.followed), [p.places])
  const maxArc = Math.max(1, ...p.arcs.map((a) => a.value))

  const layers = [
    p.layers.countries &&
      new GeoJsonLayer({
        id: 'countries',
        data: features,
        filled: true,
        stroked: true,
        pickable: true,
        getFillColor: (f) => p.fills.get((f.properties as { iso3: string }).iso3) ?? NO_DATA,
        getLineColor: (f) =>
          (f.properties as { iso3: string }).iso3 === selIso ? [255, 166, 48, 255] : [70, 70, 70, 255],
        getLineWidth: (f) => ((f.properties as { iso3: string }).iso3 === selIso ? 2 : 0.6),
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 0.5,
        updateTriggers: { getFillColor: [p.fills], getLineColor: [selIso], getLineWidth: [selIso] },
        onClick: (i: PickingInfo) =>
          p.onPick({ kind: 'country', iso3: (i.object as { properties: { iso3: string } }).properties.iso3 })
      }),
    p.layers.lanes &&
      p.lanes.length > 0 &&
      new PathLayer<Lane>({
        id: 'lanes',
        data: p.lanes,
        getPath: (l) => l.path,
        getColor: (l) => [120, 120, 120, LANE_ALPHA[l.kind] ?? 50],
        getWidth: (l) => (l.kind === 'major' ? 1.4 : 0.8),
        widthUnits: 'pixels',
        wrapLongitude: true
      }),
    p.layers.flows &&
      new ArcLayer<Arc>({
        id: 'flows',
        data: p.arcs,
        greatCircle: true,
        pickable: true,
        getSourcePosition: (a) => a.from,
        getTargetPosition: (a) => a.to,
        getSourceColor: (a) => a.colour,
        getTargetColor: (a) => [a.colour[0], a.colour[1], a.colour[2], 255],
        getWidth: (a) => 1 + 7 * Math.sqrt(a.value / maxArc),
        widthUnits: 'pixels',
        updateTriggers: { getWidth: [maxArc] },
        onClick: (i: PickingInfo) => p.onPick({ kind: 'country', iso3: (i.object as Arc).iso3 })
      }),
    p.layers.ports &&
      new ScatterplotLayer<WorldPlace>({
        id: 'ports-world',
        data: otherPorts,
        pickable: true,
        getPosition: (x) => [x.lon, x.lat],
        getRadius: (x) => Math.sqrt(x.vessels ?? 100) * 0.12,
        radiusUnits: 'pixels',
        radiusMinPixels: 1,
        radiusMaxPixels: 6,
        getFillColor: [150, 150, 150, 110],
        onClick: (i: PickingInfo) => p.onPick({ kind: 'place', id: (i.object as WorldPlace).id })
      }),
    p.layers.ports &&
      new ScatterplotLayer<WorldPlace>({
        id: 'ports-india',
        data: indiaPorts,
        pickable: true,
        stroked: true,
        getPosition: (x) => [x.lon, x.lat],
        getRadius: (x) => 2 + Math.sqrt(x.recent ?? 1) * 1.4,
        radiusUnits: 'pixels',
        getFillColor: (x) => (x.id === selPlace ? [255, 255, 255, 255] : [255, 166, 48, 220]),
        getLineColor: [0, 0, 0, 255],
        lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: [selPlace] },
        onClick: (i: PickingInfo) => p.onPick({ kind: 'place', id: (i.object as WorldPlace).id })
      }),
    p.layers.chokepoints &&
      new ScatterplotLayer<WorldPlace>({
        id: 'chokepoints',
        data: chokepoints,
        pickable: true,
        stroked: true,
        filled: true,
        getPosition: (x) => [x.lon, x.lat],
        getRadius: (x) => 4 + Math.sqrt(x.recent ?? 4) * 1.3,
        radiusUnits: 'pixels',
        getFillColor: (x) => {
          const c = chokepointColour(x)
          return [c[0], c[1], c[2], 90]
        },
        getLineColor: (x) => (x.id === selPlace ? [255, 255, 255, 255] : chokepointColour(x)),
        lineWidthMinPixels: 1.5,
        updateTriggers: { getLineColor: [selPlace] },
        onClick: (i: PickingInfo) => p.onPick({ kind: 'place', id: (i.object as WorldPlace).id })
      }),
    p.layers.chokepoints &&
      labels &&
      new TextLayer<WorldPlace>({
        id: 'chokepoint-names',
        data: chokepoints,
        getPosition: (x) => [x.lon, x.lat],
        getText: (x) => x.name,
        getSize: 11,
        getColor: [255, 166, 48, 220],
        getPixelOffset: [0, 14],
        fontFamily: 'Consolas, monospace',
        characterSet: 'auto'
      }),
    p.layers.events &&
      new ScatterplotLayer<WorldEvent>({
        id: 'events',
        data: p.events,
        pickable: true,
        stroked: true,
        filled: false,
        getPosition: (e) => [e.lon, e.lat],
        getRadius: (e) =>
          e.magnitude !== null && e.kind === 'EQ' ? Math.max(3, (e.magnitude - 3.5) * 4) : e.level === 'Red' ? 12 : 8,
        radiusUnits: 'pixels',
        getLineColor: (e) => eventColour(e),
        lineWidthMinPixels: 1.5,
        onClick: (i: PickingInfo) => p.onPick({ kind: 'event', id: (i.object as WorldEvent).id })
      }),
    p.layers.ships &&
      new ScatterplotLayer<Ship>({
        id: 'ships',
        data: p.ships,
        pickable: true,
        getPosition: (s) => [s.lon, s.lat],
        getRadius: 2,
        radiusUnits: 'pixels',
        radiusMinPixels: 1.5,
        getFillColor: (s) => shipColour(s.type),
        onClick: (i: PickingInfo) => p.onPick({ kind: 'ship', mmsi: (i.object as Ship).mmsi })
      })
  ].filter(Boolean)

  return (
    <DeckGL
      views={VIEW}
      initialViewState={INITIAL}
      controller={{ dragRotate: false, touchRotate: false, keyboard: true }}
      layers={layers}
      onViewStateChange={({ viewState }) => {
        const z = (viewState as MapViewState).zoom
        if (z > 2.2 !== labels) setLabels(z > 2.2)
        if (z > 2.8 !== closeUp.current) {
          closeUp.current = z > 2.8
          p.onCloseUp(closeUp.current)
        }
      }}
      onClick={(i) => {
        if (!i.picked) p.onPick(null)
      }}
      getCursor={({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      getTooltip={({ object, layer }: PickingInfo) => {
        if (!object || !layer) return null
        let text = ''
        if (layer.id === 'countries') text = p.describe((object as { properties: { iso3: string } }).properties.iso3)
        else if (layer.id === 'flows') text = (object as Arc).text
        else if (layer.id.startsWith('ports') || layer.id === 'chokepoints') text = placeText(object as WorldPlace)
        else if (layer.id === 'events') {
          const e = object as WorldEvent
          text = [
            e.title,
            `${EVENT_KINDS[e.kind]}${e.level ? `, ${e.level} alert` : ''}`,
            e.time.slice(0, 16).replace('T', ' ') + ' UTC'
          ].join('\n')
        } else if (layer.id === 'ships') {
          const s = object as Ship
          text = [
            s.name ?? `MMSI ${s.mmsi}`,
            s.sog !== null ? `${s.sog.toFixed(1)} knots` : '',
            new Date(s.at).toISOString().slice(11, 16) + ' UTC'
          ]
            .filter(Boolean)
            .join('\n')
        }
        // Plain text only: names come from outside sources.
        return text ? { text, style: tipStyle } : null
      }}
    />
  )
}
