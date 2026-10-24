import { alpha3From2, EURO_AREA, isCountry } from '@shared/countries'
import type { EventKind, Ship, TradeRow, TrafficDay, WorldEvent, WorldPlace } from '@shared/world'

/** Readers for each World map source. Pure functions over the raw responses, so tests can feed them saved files. */

// ---- CSV (BIS and OECD SDMX) ----

/** Rows of a CSV with quoted fields (quotes may hold commas, newlines and doubled quotes). */
export function csvRecords(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((x) => x !== '')) rows.push(row)
  const [head, ...body] = rows
  if (!head) return []
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

const num = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null || s === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** A figure for one country (alpha-3) and period. */
export interface Figure {
  iso3: string
  period: string
  value: number
}

/** The euro area's figure goes to each member that has none of its own. */
function spreadEuro(rows: Figure[], euro: Figure | undefined): Figure[] {
  if (!euro) return rows
  const have = new Set(rows.map((r) => r.iso3))
  return [...rows, ...EURO_AREA.filter((c) => !have.has(c)).map((iso3) => ({ ...euro, iso3 }))]
}

/** BIS WS_CBPOL (daily, lastNObservations=1): each central bank's policy rate. Discontinued series (old euro members) are dropped. */
export function parseBisPolicy(csv: string, now = new Date()): Figure[] {
  const cutoff = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10)
  let euro: Figure | undefined
  const out: Figure[] = []
  for (const r of csvRecords(csv)) {
    const value = num(r.OBS_VALUE)
    const period = r.TIME_PERIOD
    if (value === null || !period || period < cutoff) continue
    if (r.REF_AREA === 'XM') {
      euro = { iso3: 'XM', period, value }
      continue
    }
    const iso3 = alpha3From2(r.REF_AREA ?? '')
    if (iso3 && isCountry(iso3)) out.push({ iso3, period, value })
  }
  return spreadEuro(out, euro)
}

/**
 * BIS WS_XRU (monthly, lastNObservations=2): local currency per US dollar, as each currency's change
 * against the dollar over the latest month (positive: it bought more dollars).
 */
export function parseBisFx(csv: string): Figure[] {
  const by = new Map<string, { period: string; value: number }[]>()
  for (const r of csvRecords(csv)) {
    const value = num(r.OBS_VALUE)
    if (value === null || value <= 0 || r.COLLECTION !== 'A') continue
    const list = by.get(r.REF_AREA) ?? []
    list.push({ period: r.TIME_PERIOD, value })
    by.set(r.REF_AREA, list)
  }
  let euro: Figure | undefined
  const out: Figure[] = []
  for (const [area, obs] of by) {
    if (obs.length < 2) continue
    obs.sort((a, b) => a.period.localeCompare(b.period))
    const [prev, last] = obs.slice(-2)
    const f = { period: last.period, value: (prev.value / last.value - 1) * 100 }
    if (area === 'XM') euro = { iso3: 'XM', ...f }
    const iso3 = alpha3From2(area)
    if (iso3 && isCountry(iso3)) out.push({ iso3, ...f })
  }
  return spreadEuro(out, euro)
}

/** OECD SDMX CSV (yields or the leading indicator): the latest month for each country. */
export function parseOecdLatest(csv: string): Figure[] {
  const latest = new Map<string, Figure>()
  for (const r of csvRecords(csv)) {
    const iso3 = r.REF_AREA
    const value = num(r.OBS_VALUE)
    if (!iso3 || value === null || !isCountry(iso3)) continue
    const cur = latest.get(iso3)
    if (!cur || r.TIME_PERIOD > cur.period) latest.set(iso3, { iso3, period: r.TIME_PERIOD, value })
  }
  return [...latest.values()]
}

// ---- World Bank ----

type WbRow = { countryiso3code: string; date: string; value: number | null }

/** World Bank API v2 JSON ([meta, rows]): yearly figures for countries only (regions and income groups dropped). */
export function parseWorldBank(json: unknown): { figures: Figure[]; pages: number } {
  if (!Array.isArray(json) || json.length < 2) {
    const msg = Array.isArray(json) ? (json[0] as { message?: { value?: string }[] })?.message?.[0]?.value : null
    throw new Error(msg ? `World Bank: ${msg}` : 'World Bank sent no data')
  }
  const meta = json[0] as { pages?: number }
  const rows = (json[1] ?? []) as WbRow[]
  const figures: Figure[] = []
  for (const r of rows)
    if (r.value !== null && r.countryiso3code && isCountry(r.countryiso3code))
      figures.push({ iso3: r.countryiso3code, period: r.date, value: r.value })
  return { figures, pages: meta.pages ?? 1 }
}

// ---- Yahoo Finance spark ----

export interface IndexMove {
  symbol: string
  price: number
  /** Close before the month began. */
  start: number
  change: number
  date: string
}

/** Yahoo's v7 spark (range=1mo): each index's change over the month. */
export function parseYahooSpark(json: unknown): IndexMove[] {
  const results =
    (json as { spark?: { result?: { symbol: string; response?: { meta?: Record<string, unknown> }[] }[] } }).spark
      ?.result ?? []
  const out: IndexMove[] = []
  for (const r of results) {
    const m = r.response?.[0]?.meta
    const price = Number(m?.regularMarketPrice)
    const start = Number(m?.chartPreviousClose)
    const time = Number(m?.regularMarketTime)
    if (!m || !(price > 0) || !(start > 0)) continue
    out.push({
      symbol: r.symbol,
      price,
      start,
      change: (price / start - 1) * 100,
      date: new Date(time * 1000).toISOString().slice(0, 10)
    })
  }
  return out
}

// ---- IMF PortWatch (ArcGIS feature services) ----

export interface ArcgisPage {
  rows: Record<string, unknown>[]
  more: boolean
}

export function parseArcgis(json: unknown): ArcgisPage {
  const j = json as {
    features?: { attributes: Record<string, unknown> }[]
    exceededTransferLimit?: boolean
    error?: { message?: string }
  }
  if (j.error) throw new Error(`PortWatch: ${j.error.message ?? 'query failed'}`)
  if (!Array.isArray(j.features)) throw new Error('PortWatch sent no features')
  return { rows: j.features.map((f) => f.attributes), more: !!j.exceededTransferLimit }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? num(v) : null

/** PortWatch's chokepoint or port reference lists: names and positions. */
export function parsePlaces(
  rows: Record<string, unknown>[],
  kind: WorldPlace['kind']
): Omit<WorldPlace, 'followed' | 'latestDate' | 'recent' | 'yearAgo' | 'imports7' | 'exports7' | 'weekly'>[] {
  const out: Omit<WorldPlace, 'followed' | 'latestDate' | 'recent' | 'yearAgo' | 'imports7' | 'exports7' | 'weekly'>[] =
    []
  for (const r of rows) {
    const id = str(r.portid)
    const lat = n(r.lat)
    const lon = n(r.lon)
    if (!id || lat === null || lon === null) continue
    out.push({
      id,
      kind,
      name: str(r.portname) ?? id,
      iso3: str(r.ISO3),
      lat,
      lon,
      locode: str(r.LOCODE),
      vessels: n(r.vessel_count_total)
    })
  }
  return out
}

/** Daily chokepoint transits (n_*) or port calls (portcalls_*, import, export). */
export function parseTraffic(rows: Record<string, unknown>[]): (TrafficDay & { id: string })[] {
  const out: (TrafficDay & { id: string })[] = []
  for (const r of rows) {
    const id = str(r.portid)
    const date = str(r.date)?.slice(0, 10)
    const total = n(r.n_total) ?? n(r.portcalls)
    if (!id || !date || total === null) continue
    out.push({
      id,
      date,
      total,
      tanker: n(r.n_tanker) ?? n(r.portcalls_tanker) ?? 0,
      container: n(r.n_container) ?? n(r.portcalls_container) ?? 0,
      dryBulk: n(r.n_dry_bulk) ?? n(r.portcalls_dry_bulk) ?? 0,
      imports: n(r.import),
      exports: n(r.export)
    })
  }
  return out
}

// ---- UN Comtrade (public preview) ----

/** Comtrade's own codes for places without an ISO code; "Other Asia, nes" is Taiwan. */
const COMTRADE_ISO: Record<string, string> = { S19: 'TWN' }

/** The preview API's rows as India's trade with each partner; world totals and unallocated areas are dropped. */
export function parseComtrade(json: unknown): { rows: TradeRow[]; truncated: boolean } {
  const j = json as { count?: number; data?: Record<string, unknown>[]; error?: string }
  if (j.error) throw new Error(`UN Comtrade: ${j.error}`)
  const data = j.data ?? []
  const rows: TradeRow[] = []
  for (const r of data) {
    const raw = str(r.partnerISO)
    const partner = raw ? (COMTRADE_ISO[raw] ?? raw) : null
    const flow = r.flowCode === 'X' || r.flowCode === 'M' ? r.flowCode : null
    const value = n(r.primaryValue)
    if (!partner || !flow || value === null || !isCountry(partner)) continue
    const w = n(r.netWgt)
    rows.push({
      partner,
      partnerName: str(r.partnerDesc) ?? partner,
      flow,
      cmd: String(r.cmdCode),
      period: String(r.period),
      value,
      weight: w && w > 0 ? w : null
    })
  }
  // The preview silently stops at 500 rows.
  return { rows, truncated: data.length >= 500 }
}

// ---- Events: USGS earthquakes and GDACS disasters ----

type GeoFeature = { id?: string | number; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }

export function parseUsgs(json: unknown): WorldEvent[] {
  const out: WorldEvent[] = []
  for (const f of ((json as { features?: GeoFeature[] }).features ?? []) as GeoFeature[]) {
    const [lon, lat] = f.geometry?.coordinates ?? []
    const p = f.properties ?? {}
    const mag = n(p.mag)
    const time = n(p.time)
    if (lon === undefined || lat === undefined || time === null) continue
    out.push({
      id: `usgs:${f.id}`,
      kind: 'EQ',
      title: str(p.title) ?? `M ${mag} earthquake`,
      lat,
      lon,
      time: new Date(time).toISOString(),
      level: null,
      magnitude: mag,
      url: str(p.url),
      source: 'USGS'
    })
  }
  return out
}

const KINDS = new Set(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF'])
const LEVELS = new Set(['Red', 'Orange', 'Green'])

export function parseGdacs(json: unknown): WorldEvent[] {
  const out: WorldEvent[] = []
  for (const f of ((json as { features?: GeoFeature[] }).features ?? []) as GeoFeature[]) {
    const p = f.properties ?? {}
    const kind = String(p.eventtype)
    const [lon, lat] = f.geometry?.coordinates ?? []
    const from = str(p.fromdate)
    const t = from ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(from) ? from : `${from}Z`) : NaN
    if (!KINDS.has(kind) || lon === undefined || lat === undefined || Number.isNaN(t)) continue
    const level = String(p.alertlevel)
    const url = (p.url as { report?: string } | undefined)?.report
    const sev = (p.severitydata as { severity?: number } | undefined)?.severity
    out.push({
      id: `gdacs:${kind}:${p.eventid}`,
      kind: kind as EventKind,
      title: str(p.name) ?? str(p.description) ?? kind,
      lat,
      lon,
      time: new Date(t).toISOString(),
      level: LEVELS.has(level) ? (level as WorldEvent['level']) : null,
      magnitude: kind === 'EQ' && typeof sev === 'number' ? sev : null,
      url: url ?? null,
      source: 'GDACS'
    })
  }
  return out
}

/**
 * One list of events: USGS's earthquakes (with GDACS's alert level where both report the same quake)
 * and GDACS's other disasters.
 */
export function mergeEvents(usgs: WorldEvent[], gdacs: WorldEvent[]): WorldEvent[] {
  const quakes = usgs.map((e) => ({ ...e }))
  const rest: WorldEvent[] = []
  for (const g of gdacs) {
    if (g.kind !== 'EQ') {
      rest.push(g)
      continue
    }
    const same = quakes.find(
      (q) =>
        Math.abs(q.lat - g.lat) < 1 &&
        Math.abs(q.lon - g.lon) < 1 &&
        Math.abs(Date.parse(q.time) - Date.parse(g.time)) < 3 * 3600_000
    )
    if (same) same.level = g.level
    else rest.push(g)
  }
  return [...quakes, ...rest].sort((a, b) => b.time.localeCompare(a.time))
}

// ---- Freight: Shanghai Shipping Exchange ----

/** SSE's current SCFI page: this week's and last week's composite. */
export function parseScfi(json: unknown): { date: string; value: number }[] {
  const d = (
    json as {
      data?: {
        currentDate?: string
        lastDate?: string
        lineDataList?: {
          dataItemTypeName?: string
          currentContent?: number | null
          lastContent?: number | null
          properties?: { lineName_EN?: string }
        }[]
      }
    }
  ).data
  const line = d?.lineDataList?.find(
    (l) => l.properties?.lineName_EN === 'Comprehensive Index' || /_T$/.test(l.dataItemTypeName ?? '')
  )
  if (!d || !line) throw new Error('SSE sent no SCFI composite')
  const out: { date: string; value: number }[] = []
  if (d.lastDate && typeof line.lastContent === 'number') out.push({ date: d.lastDate, value: line.lastContent })
  if (d.currentDate && typeof line.currentContent === 'number')
    out.push({ date: d.currentDate, value: line.currentContent })
  if (out.length === 0) throw new Error('SSE sent no SCFI composite')
  return out
}

// ---- Ships ----

/** Digitraffic's AIS positions (GeoJSON), with names and types from its vessel list when known. */
export function parseDigitraffic(
  locations: unknown,
  vessels: Map<number, { name: string | null; type: number | null }> = new Map()
): Ship[] {
  const out: Ship[] = []
  for (const f of ((locations as { features?: GeoFeature[] }).features ?? []) as GeoFeature[]) {
    const p = f.properties ?? {}
    const [lon, lat] = f.geometry?.coordinates ?? []
    const mmsi = n(p.mmsi) ?? n(f.id)
    if (mmsi === null || lon === undefined || lat === undefined) continue
    const v = vessels.get(mmsi)
    const sog = n(p.sog)
    const cog = n(p.cog)
    out.push({
      mmsi,
      lat,
      lon,
      // AIS uses 102.3 knots and 360° to mean "not available".
      sog: sog === null || sog >= 102.3 ? null : sog,
      cog: cog === null || cog >= 360 ? null : cog,
      name: v?.name ?? null,
      type: v?.type ?? null,
      at: n(p.timestampExternal) ?? Date.now(),
      source: 'digitraffic'
    })
  }
  return out
}

export function parseDigitrafficVessels(json: unknown): Map<number, { name: string | null; type: number | null }> {
  const out = new Map<number, { name: string | null; type: number | null }>()
  for (const v of (Array.isArray(json) ? json : []) as Record<string, unknown>[]) {
    const mmsi = n(v.mmsi)
    if (mmsi === null) continue
    out.set(mmsi, { name: str(v.name), type: n(v.shipType) })
  }
  return out
}

/** One aisstream.io message (PositionReport or ShipStaticData), as a position update or static facts. */
export function parseAisMessage(
  raw: string
): { mmsi: number; ship?: Partial<Ship>; name?: string | null; type?: number | null } | null {
  let m: { MessageType?: string; MetaData?: Record<string, unknown>; Message?: Record<string, Record<string, unknown>> }
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  const meta = m.MetaData ?? {}
  const mmsi = n(meta.MMSI)
  if (mmsi === null) return null
  const name = str(meta.ShipName)
  if (m.MessageType === 'ShipStaticData') {
    const s = m.Message?.ShipStaticData ?? {}
    return { mmsi, name: str(s.Name) ?? name, type: n(s.Type) }
  }
  if (m.MessageType !== 'PositionReport') return null
  const p = m.Message?.PositionReport ?? {}
  const lat = n(meta.latitude) ?? n(p.Latitude)
  const lon = n(meta.longitude) ?? n(p.Longitude)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const sog = n(p.Sog)
  const cog = n(p.Cog)
  const t = Date.parse(
    String(meta.time_utc ?? '')
      .replace(' +0000 UTC', 'Z')
      .replace(/(\.\d{3})\d+/, '$1')
      .replace(' ', 'T')
  )
  return {
    mmsi,
    name,
    ship: {
      lat,
      lon,
      sog: sog === null || sog >= 102.3 ? null : sog,
      cog: cog === null || cog >= 360 ? null : cog,
      at: Number.isNaN(t) ? Date.now() : t
    }
  }
}
