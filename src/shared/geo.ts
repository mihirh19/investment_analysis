import type { Geometry } from 'geojson'

/**
 * Outlines crossing the 180° line (Fiji, Russia's Chukotka) jump from +180 to −180 between two points,
 * which a flat map draws as a band right across the world. Each ring is made continuous instead, so
 * it carries on just past the edge.
 */
export function unwrapDateLine(g: Geometry): Geometry {
  const ring = (r: number[][]) => {
    let prev: number | null = null
    return r.map((p) => {
      let x = p[0]
      if (prev !== null) {
        while (x - prev > 180) x -= 360
        while (x - prev < -180) x += 360
      }
      prev = x
      return x === p[0] ? p : [x, ...p.slice(1)]
    })
  }
  if (g.type === 'Polygon') return { ...g, coordinates: g.coordinates.map(ring) }
  if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((poly) => poly.map(ring)) }
  return g
}
