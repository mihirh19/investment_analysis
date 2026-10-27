import { eq } from 'drizzle-orm'
import { CROP_HS, type CropExports, type CropKey } from '@shared/farm'
import { schema, type Db } from './db'
import { getJson, type FetchFn } from './market/http'
import { WORLD_UA } from './world/sync'

/**
 * How much of a crop India exports, and to whom, from UN Comtrade's free preview API: the last two
 * full years by buyer country, and the latest month on record against the same month a year
 * earlier. About six calls a crop, six seconds apart, kept for a week.
 */

const KEEP_MS = 7 * 86400_000
const key = (crop: CropKey) => `farm:exports:${crop}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Row {
  partner: string
  name: string
  kg: number
  usd: number
}

export function parseComtradeRows(json: unknown): Row[] {
  const j = json as { error?: string; data?: Record<string, unknown>[] } | null
  if (j?.error) throw new Error(`UN Comtrade: ${j.error}`)
  return (j?.data ?? []).map((r) => ({
    partner: String(r.partnerISO ?? r.partnerCode ?? ''),
    name: String(r.partnerDesc ?? r.partnerISO ?? ''),
    kg: Number(r.netWgt) || 0,
    usd: Number(r.primaryValue) || 0
  }))
}

export function cachedExports(db: Db, crop: CropKey): CropExports | null {
  const v = db.select().from(schema.settings).where(eq(schema.settings.key, key(crop))).get()?.value
  return v ? (JSON.parse(v) as CropExports) : null
}

export async function cropExports(db: Db, crop: CropKey, f: FetchFn = fetch, now = new Date(), gapMs = 6000): Promise<CropExports | null> {
  const hs = CROP_HS[crop]
  if (!hs) return null
  const cached = cachedExports(db, crop)
  if (cached && now.getTime() - Date.parse(cached.fetchedAt) < KEEP_MS) return cached
  let first = true
  const call = async (freq: 'A' | 'M', period: string, world: boolean) => {
    if (!first) await sleep(gapMs)
    first = false
    const q = new URLSearchParams({ reporterCode: '699', period, cmdCode: hs.code, flowCode: 'X', partner2Code: '0', customsCode: 'C00', motCode: '0', includeDesc: 'true' })
    if (world) q.set('partnerCode', '0')
    return parseComtradeRows(await getJson<unknown>(`https://comtradeapi.un.org/public/v1/preview/C/${freq}/HS?${q}`, { fetch: f, timeoutMs: 30_000, headers: { 'User-Agent': WORLD_UA } }))
  }
  const year = now.getUTCFullYear()
  // The world total: W00 when descriptions come back, partner code 0 otherwise.
  const isWorld = (r: Row) => r.partner === 'W00' || r.partner === '0'
  const world = (rows: Row[]) => rows.find(isWorld) ?? null
  // The latest full year reported: last year, or the one before early in the year.
  let y = year - 1
  let last = await call('A', String(y), false)
  if (!world(last)) {
    y = year - 2
    last = await call('A', String(y), false)
  }
  const before = await call('A', String(y - 1), false)
  const prevBy = new Map(before.filter((r) => !isWorld(r)).map((r) => [r.partner, r]))
  const total = world(last)
  const partners = last
    .filter((r) => !isWorld(r) && r.kg > 0)
    .sort((a, b) => b.kg - a.kg)
    .slice(0, 8)
    .map((r) => ({ iso: r.partner, name: r.name, tonnes: r.kg / 1000, usd: r.usd, share: total?.kg ? r.kg / total.kg : null, prevTonnes: prevBy.has(r.partner) ? prevBy.get(r.partner)!.kg / 1000 : null }))

  // The latest month on record (they run three to five months behind), and a year before it.
  let latest: CropExports['latestMonth'] = null
  for (let back = 2; back <= 6 && !latest; back++) {
    const d = new Date(Date.UTC(year, now.getUTCMonth() - back, 1))
    const p = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const m = world(await call('M', p, true))
    if (!m) continue
    const a = world(await call('M', `${d.getUTCFullYear() - 1}${String(d.getUTCMonth() + 1).padStart(2, '0')}`, true))
    latest = { month: `${p.slice(0, 4)}-${p.slice(4)}`, tonnes: m.kg / 1000, usd: m.usd, yearAgoTonnes: a ? a.kg / 1000 : null }
  }

  const out: CropExports = {
    crop,
    hs: hs.code,
    what: hs.what,
    year: total ? y : null,
    tonnes: total ? total.kg / 1000 : null,
    usd: total?.usd ?? null,
    prevTonnes: world(before) ? world(before)!.kg / 1000 : null,
    partners,
    latestMonth: latest,
    fetchedAt: now.toISOString()
  }
  const value = JSON.stringify(out)
  db.insert(schema.settings).values({ key: key(crop), value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()
  return out
}
