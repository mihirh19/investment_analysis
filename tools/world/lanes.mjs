// Builds src/renderer/src/assets/shipping-lanes.json, the World map's background shipping lanes.
// Source: newzealandpaul/Shipping-Lanes (CC BY 4.0), from CIA World Factbook-style lane traces.
// Run: node tools/world/lanes.mjs <path to Shipping_Lanes_v1.geojson>
// The file is downloaded once by hand (https://github.com/newzealandpaul/Shipping-Lanes, data/Shipping_Lanes_v1.geojson).
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2]
if (!src) throw new Error('Give the path to Shipping_Lanes_v1.geojson')
const geo = JSON.parse(readFileSync(src, 'utf8'))
const round = (v) => Math.round(v * 100) / 100
const out = { credit: 'Shipping lanes: newzealandpaul/Shipping-Lanes, CC BY 4.0', lanes: [] }
for (const f of geo.features) {
  const kind = String(f.properties.Type ?? 'Minor').toLowerCase()
  const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]
  for (const line of lines) {
    // A lane crossing the date line is split there, so it isn't drawn straight across the map.
    let path = []
    for (const [lon, lat] of line) {
      const p = [round(lon), round(lat)]
      const last = path[path.length - 1]
      if (last && Math.abs(p[0] - last[0]) > 180) {
        if (path.length > 1) out.lanes.push({ kind, path })
        path = []
      }
      if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p)
    }
    if (path.length > 1) out.lanes.push({ kind, path })
  }
}
writeFileSync('src/renderer/src/assets/shipping-lanes.json', JSON.stringify(out))
console.log(`${out.lanes.length} lanes, ${out.lanes.reduce((n, l) => n + l.path.length, 0)} points`)
