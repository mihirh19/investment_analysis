import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import { geoArea, geoCentroid } from 'd3-geo'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { alpha3FromNumeric, countryName, EXTRA_PLACES } from '@shared/countries'
import { unwrapDateLine } from '@shared/geo'
import {
  scalePosition,
  shipClass,
  type ShipClass,
  type WorldEvent,
  type WorldMetric,
  type WorldPlace
} from '@shared/world'

export type Rgba = [number, number, number, number]

export interface CountryShape {
  iso3: string
  name: string
  feature: Feature<Geometry, { iso3: string; name: string }>
  /** Middle of the country's largest piece (France's, not its overseas average), for arcs and labels. */
  centre: [number, number]
}

/** world-atlas shapes keyed by alpha-3, with the five unnumbered places given the app's own codes. */
export function countryShapes(topo: Topology): CountryShape[] {
  const fc = feature(topo, topo.objects.countries as GeometryCollection<{ name: string }>) as FeatureCollection<
    Geometry,
    { name: string }
  >
  const out: CountryShape[] = []
  for (const f of fc.features) {
    const iso3 =
      f.id !== undefined && f.id !== null && f.id !== ''
        ? alpha3FromNumeric(String(f.id))
        : (EXTRA_PLACES[f.properties.name]?.code ?? null)
    // Antarctica's outline runs round the pole along the map's bottom edge; on a flat map it only gets in the way.
    if (!iso3 || iso3 === 'ATA') continue
    const name = countryName(iso3)
    out.push({
      iso3,
      name,
      feature: { ...f, geometry: unwrapDateLine(f.geometry), properties: { iso3, name } },
      centre: largestCentre(f.geometry)
    })
  }
  return out
}

function largestCentre(g: Geometry): [number, number] {
  if (g.type === 'MultiPolygon') {
    let best: Polygon | null = null
    let area = -1
    for (const coords of (g as MultiPolygon).coordinates) {
      const p: Polygon = { type: 'Polygon', coordinates: coords }
      const a = geoArea(p)
      if (a > area) {
        area = a
        best = p
      }
    }
    if (best) return geoCentroid(best) as [number, number]
  }
  return geoCentroid(g) as [number, number]
}

/** Where India's arcs start: the middle of the country. */
export const INDIA: [number, number] = [78.9, 22.4]

// Terminal palette: black ground, amber, with green and red for good and bad news.
const NEUTRAL: [number, number, number] = [44, 44, 44]
const GOOD: [number, number, number] = [46, 204, 113]
const BAD: [number, number, number] = [232, 72, 77]
const AMBER: [number, number, number] = [255, 166, 48]
const CYAN: [number, number, number] = [76, 201, 240]
export const NO_DATA: Rgba = [20, 20, 20, 255]

const mix = (a: [number, number, number], b: [number, number, number], t: number): Rgba => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  255
]

/** The two end colours of a metric's scale: low end first. */
export function endColours(m: WorldMetric): [[number, number, number], [number, number, number]] {
  if (m.good === 'high') return [BAD, GOOD]
  if (m.good === 'low') return [GOOD, BAD]
  return [CYAN, AMBER]
}

export function fillFor(m: WorldMetric, v: number | null | undefined): Rgba {
  const p = scalePosition(m, v)
  if (p === null) return NO_DATA
  const [lo, hi] = endColours(m)
  return mix(NEUTRAL, p < 0 ? lo : hi, Math.pow(Math.abs(p), 0.8))
}

/** CSS gradient for the legend, low end on the left. */
export function legendGradient(m: WorldMetric): string {
  const [lo, hi] = endColours(m)
  const c = (x: number[]) => `rgb(${x[0]},${x[1]},${x[2]})`
  return `linear-gradient(to right, ${c(lo)}, ${c(NEUTRAL)}, ${c(hi)})`
}

export const SHIP_COLOURS: Record<ShipClass, Rgba> = {
  cargo: [76, 201, 240, 230],
  tanker: [232, 72, 77, 230],
  passenger: [190, 140, 255, 230],
  fishing: [46, 204, 113, 230],
  other: [170, 170, 170, 200]
}
export const shipColour = (type: number | null): Rgba => SHIP_COLOURS[shipClass(type)]

export const EXPORT_COLOUR: Rgba = [255, 166, 48, 210]
export const IMPORT_COLOUR: Rgba = [76, 201, 240, 210]

/** Change in traffic against the same week a year before (null without both). */
export const trafficChange = (p: WorldPlace): number | null =>
  p.recent !== null && p.yearAgo ? p.recent / p.yearAgo - 1 : null

export function chokepointColour(p: WorldPlace): Rgba {
  const ch = trafficChange(p)
  if (ch === null) return [255, 166, 48, 230]
  if (ch <= -0.25) return [232, 72, 77, 235]
  if (ch >= 0.1) return [46, 204, 113, 235]
  return [255, 166, 48, 230]
}

export function eventColour(e: WorldEvent): Rgba {
  const level =
    e.level ?? (e.magnitude !== null ? (e.magnitude >= 6.5 ? 'Red' : e.magnitude >= 5.5 ? 'Orange' : 'Green') : 'Green')
  return level === 'Red' ? [255, 59, 48, 255] : level === 'Orange' ? [255, 149, 0, 255] : [230, 220, 90, 220]
}

/** US dollars, compactly: $1.2 tn, $45.3 bn, $120 m. */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)} tn`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)} bn`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)} m`
  return `$${Math.round(v).toLocaleString('en-IN')}`
}

export function count(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)} bn`
  if (Math.abs(v) >= 1e7) return `${(v / 1e6).toFixed(0)} m`
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits })
}

/** A metric's value with its unit. */
export function metricText(m: WorldMetric, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (m.unit === '$') return usd(v)
  if (m.key === 'population') return count(v)
  const sign = m.key === 'currency1m' || m.key === 'index1m' ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : ''
  const body = Math.abs(v).toFixed(m.key === 'cli' ? 1 : m.key === 'policyRate' || m.key === 'yield10y' ? 2 : 1)
  return `${sign}${body}${m.unit === '%' ? '%' : m.unit ? ` ${m.unit.replace('% of GDP', '% GDP')}` : ''}`.replace(
    ' % GDP',
    '% GDP'
  )
}

export const signedPct = (x: number | null): string =>
  x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(0)}%`
