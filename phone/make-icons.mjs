// Draws the phone app's Home Screen icon (a passbook page on the app's stamp blue) and writes the
// PNG sizes iOS and Android want. No image library: shapes are sampled 4×4 per pixel and written
// with zlib.   node phone/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BLUE = [43, 78, 162]
const WHITE = [255, 255, 255]
const LINE = [43, 78, 162]
const ACCENT = [235, 104, 52]

/** Rounded rectangle test in 0..1 icon space. */
const inRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** The colour at a point: background, page, ruled lines, and a rising mark. */
function shade(x, y) {
  if (inRound(x, y, 0.24, 0.2, 0.76, 0.8, 0.06)) {
    for (const ly of [0.36, 0.48, 0.6]) if (y > ly - 0.018 && y < ly + 0.018 && x > 0.32 && x < 0.68) return LINE
    // A short rising stroke in the corner of the page.
    const t = (x - 0.5) / 0.18
    if (t >= 0 && t <= 1) {
      const yy = 0.74 - t * 0.12
      if (Math.abs(y - yy) < 0.02) return ACCENT
    }
    return WHITE
  }
  return BLUE
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const c = shade((px + (sx + 0.5) / 4) / size, (py + (sy + 0.5) / 4) / size)
          acc[0] += c[0]
          acc[1] += c[1]
          acc[2] += c[2]
        }
      const o = py * (size * 3 + 1) + 1 + px * 3
      raw[o] = acc[0] / 16
      raw[o + 1] = acc[1] / 16
      raw[o + 2] = acc[2] / 16
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

for (const size of [180, 192, 512]) writeFileSync(new URL(`./public/icon-${size}.png`, import.meta.url), png(size))
console.log('icons written')
