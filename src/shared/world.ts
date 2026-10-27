/**
 * The research desk's World map: country figures, trade with India, shipping chokepoints and ports,
 * ships at sea, disasters and freight rates. Everything here is public data fetched slowly in the
 * background and kept on this computer; ships are fetched only while the map is open.
 */

export type WorldMetricKey =
  | 'growth'
  | 'inflation'
  | 'currentAccount'
  | 'unemployment'
  | 'debt'
  | 'tradeGdp'
  | 'policyRate'
  | 'currency1m'
  | 'index1m'
  | 'yield10y'
  | 'cli'
  | 'population'
  | 'reserves'
  | 'gdpUsd'
  | 'money'

export interface WorldMetric {
  key: WorldMetricKey
  label: string
  /** Shown after the figure: "%" or "" (index points). */
  unit: string
  source: string
  /** A figure per year (World Bank), rather than only the latest reading. */
  yearly: boolean
  /** Colour scale: values at or beyond lo/hi take the end colours; mid is the neutral middle. */
  lo: number
  mid: number
  hi: number
  /** Which end reads as good news; 'neither' colours by size only. */
  good: 'high' | 'low' | 'neither'
  /** Shown in the panel only, not as a map colouring. */
  panelOnly?: boolean
  note: string
}

export const WORLD_METRICS: WorldMetric[] = [
  {
    key: 'growth',
    label: 'GDP growth',
    unit: '%',
    source: 'World Bank',
    yearly: true,
    lo: -4,
    mid: 0,
    hi: 8,
    good: 'high',
    note: 'Real GDP growth in the year.'
  },
  {
    key: 'inflation',
    label: 'Inflation',
    unit: '%',
    source: 'World Bank',
    yearly: true,
    lo: 0,
    mid: 3,
    hi: 12,
    good: 'low',
    note: 'Consumer prices, change over the year.'
  },
  {
    key: 'currentAccount',
    label: 'Current account',
    unit: '% of GDP',
    source: 'World Bank',
    yearly: true,
    lo: -8,
    mid: 0,
    hi: 8,
    good: 'high',
    note: 'Surplus (+) or deficit (−) with the rest of the world.'
  },
  {
    key: 'unemployment',
    label: 'Unemployment',
    unit: '%',
    source: 'World Bank',
    yearly: true,
    lo: 2,
    mid: 6,
    hi: 15,
    good: 'low',
    note: 'Share of the labour force out of work (ILO estimate).'
  },
  {
    key: 'debt',
    label: 'Government debt',
    unit: '% of GDP',
    source: 'World Bank',
    yearly: true,
    lo: 20,
    mid: 60,
    hi: 120,
    good: 'low',
    note: 'Central government debt; many countries do not report it.'
  },
  {
    key: 'tradeGdp',
    label: 'Trade',
    unit: '% of GDP',
    source: 'World Bank',
    yearly: true,
    lo: 20,
    mid: 60,
    hi: 150,
    good: 'neither',
    note: 'Exports plus imports of goods and services.'
  },
  {
    key: 'policyRate',
    label: 'Policy rate',
    unit: '%',
    source: 'BIS',
    yearly: false,
    lo: 0,
    mid: 4,
    hi: 12,
    good: 'neither',
    note: 'Central bank policy rate, latest.'
  },
  {
    key: 'currency1m',
    label: 'Currency, 1 month',
    unit: '%',
    source: 'BIS',
    yearly: false,
    lo: -4,
    mid: 0,
    hi: 4,
    good: 'high',
    note: 'Change against the US dollar over the last month (monthly averages).'
  },
  {
    key: 'index1m',
    label: 'Stock index, 1 month',
    unit: '%',
    source: 'Yahoo Finance',
    yearly: false,
    lo: -8,
    mid: 0,
    hi: 8,
    good: 'high',
    note: 'Main stock index, change over the last month.'
  },
  {
    key: 'yield10y',
    label: '10-year yield',
    unit: '%',
    source: 'OECD',
    yearly: false,
    lo: 0,
    mid: 4,
    hi: 10,
    good: 'neither',
    note: 'Long-term government bond yield, latest month (OECD members and a few others).'
  },
  {
    key: 'cli',
    label: 'Leading indicator',
    unit: '',
    source: 'OECD',
    yearly: false,
    lo: 98.5,
    mid: 100,
    hi: 101.5,
    good: 'high',
    note: 'OECD composite leading indicator; above 100 points to growth above trend.'
  },
  {
    key: 'population',
    label: 'Population',
    unit: '',
    source: 'World Bank',
    yearly: true,
    lo: 0,
    mid: 0,
    hi: 0,
    good: 'neither',
    panelOnly: true,
    note: ''
  },
  {
    key: 'reserves',
    label: 'Foreign reserves',
    unit: '$',
    source: 'World Bank',
    yearly: true,
    lo: 0,
    mid: 0,
    hi: 0,
    good: 'neither',
    panelOnly: true,
    note: 'Including gold.'
  },
  {
    key: 'gdpUsd',
    label: 'GDP',
    unit: '$',
    source: 'World Bank',
    yearly: true,
    lo: 0,
    mid: 0,
    hi: 0,
    good: 'neither',
    panelOnly: true,
    note: 'Current US dollars.'
  },
  {
    key: 'money',
    label: 'Your money',
    unit: '%',
    source: 'your holdings',
    yearly: false,
    lo: 0,
    mid: 0,
    hi: 5,
    good: 'neither',
    note: 'Share of the family’s investments in each country, with funds opened up into what they hold.'
  }
]

export const metricOf = (k: WorldMetricKey): WorldMetric => WORLD_METRICS.find((m) => m.key === k)!

/** World Bank indicator codes for the yearly figures. */
export const WB_INDICATORS: Partial<Record<WorldMetricKey, string>> = {
  growth: 'NY.GDP.MKTP.KD.ZG',
  inflation: 'FP.CPI.TOTL.ZG',
  currentAccount: 'BN.CAB.XOKA.GD.ZS',
  unemployment: 'SL.UEM.TOTL.ZS',
  debt: 'GC.DOD.TOTL.GD.ZS',
  tradeGdp: 'NE.TRD.GNFS.ZS',
  population: 'SP.POP.TOTL',
  reserves: 'FI.RES.TOTL.CD',
  gdpUsd: 'NY.GDP.MKTP.CD'
}

/** Each country's main stock index on Yahoo Finance. */
export const WORLD_INDICES: { symbol: string; iso3: string; name: string }[] = [
  { symbol: '^NSEI', iso3: 'IND', name: 'Nifty 50' },
  { symbol: '^GSPC', iso3: 'USA', name: 'S&P 500' },
  { symbol: '000001.SS', iso3: 'CHN', name: 'SSE Composite' },
  { symbol: '^HSI', iso3: 'HKG', name: 'Hang Seng' },
  { symbol: '^N225', iso3: 'JPN', name: 'Nikkei 225' },
  { symbol: '^KS11', iso3: 'KOR', name: 'KOSPI' },
  { symbol: '^TWII', iso3: 'TWN', name: 'Taiwan Weighted' },
  { symbol: '^STI', iso3: 'SGP', name: 'Straits Times' },
  { symbol: '^KLSE', iso3: 'MYS', name: 'FTSE Bursa KLCI' },
  { symbol: '^JKSE', iso3: 'IDN', name: 'IDX Composite' },
  { symbol: '^SET.BK', iso3: 'THA', name: 'SET' },
  { symbol: 'PSEI.PS', iso3: 'PHL', name: 'PSEi' },
  { symbol: '^VNINDEX.VN', iso3: 'VNM', name: 'VN-Index' },
  { symbol: '^AXJO', iso3: 'AUS', name: 'S&P/ASX 200' },
  { symbol: '^NZ50', iso3: 'NZL', name: 'NZX 50' },
  { symbol: '^FTSE', iso3: 'GBR', name: 'FTSE 100' },
  { symbol: '^GDAXI', iso3: 'DEU', name: 'DAX' },
  { symbol: '^FCHI', iso3: 'FRA', name: 'CAC 40' },
  { symbol: 'FTSEMIB.MI', iso3: 'ITA', name: 'FTSE MIB' },
  { symbol: '^IBEX', iso3: 'ESP', name: 'IBEX 35' },
  { symbol: '^AEX', iso3: 'NLD', name: 'AEX' },
  { symbol: '^SSMI', iso3: 'CHE', name: 'SMI' },
  { symbol: '^OMX', iso3: 'SWE', name: 'OMX Stockholm 30' },
  { symbol: '^BFX', iso3: 'BEL', name: 'BEL 20' },
  { symbol: '^ATX', iso3: 'AUT', name: 'ATX' },
  { symbol: 'XU100.IS', iso3: 'TUR', name: 'BIST 100' },
  { symbol: '^TA125.TA', iso3: 'ISR', name: 'TA-125' },
  { symbol: '^TASI.SR', iso3: 'SAU', name: 'Tadawul All Share' },
  { symbol: '^CASE30', iso3: 'EGY', name: 'EGX 30' },
  { symbol: '^J203.JO', iso3: 'ZAF', name: 'JSE All Share' },
  { symbol: '^GSPTSE', iso3: 'CAN', name: 'S&P/TSX' },
  { symbol: '^MXX', iso3: 'MEX', name: 'IPC Mexico' },
  { symbol: '^BVSP', iso3: 'BRA', name: 'Ibovespa' },
  { symbol: '^MERV', iso3: 'ARG', name: 'Merval' }
]

/** Goods followed in India's trade, by HS code ("TOTAL" is all goods). */
export const TRADE_PRODUCTS: { cmd: string; label: string }[] = [
  { cmd: 'TOTAL', label: 'All goods' },
  { cmd: '2709', label: 'Crude oil' },
  { cmd: '271111', label: 'LNG' },
  { cmd: '7108', label: 'Gold' },
  { cmd: '85', label: 'Electronics and electrical' },
  { cmd: '1511', label: 'Palm oil' },
  { cmd: '1507', label: 'Soybean oil' },
  { cmd: '1512', label: 'Sunflower oil' },
  { cmd: '1202', label: 'Groundnuts' },
  { cmd: '52', label: 'Cotton' }
]

/** India's figures for the arcs on the map: one row per partner, direction, good and year. */
export interface TradeRow {
  /** Partner's ISO 3166 alpha-3 code. */
  partner: string
  partnerName: string
  /** X: India's exports to the partner; M: India's imports from it. */
  flow: 'X' | 'M'
  cmd: string
  /** Year, "2025". */
  period: string
  /** US dollars. */
  value: number
  /** Kilograms, when reported. */
  weight: number | null
}

/** metric → country (alpha-3) → period ("2024", "2026-09" or a date) → value. */
export type WorldFigures = Partial<Record<WorldMetricKey, Record<string, Record<string, number>>>>

export interface TrafficDay {
  date: string
  /** Vessels through a chokepoint, or port calls, that day. */
  total: number
  tanker: number
  container: number
  dryBulk: number
  /** Port cargo in tonnes (ports only). */
  imports: number | null
  exports: number | null
}

/** A shipping chokepoint or a port, with its recent traffic when followed. */
export interface WorldPlace {
  id: string
  kind: 'chokepoint' | 'port'
  name: string
  iso3: string | null
  lat: number
  lon: number
  locode: string | null
  /** Typical yearly vessel count from PortWatch's reference list (sizes the dot). */
  vessels: number | null
  /** Followed day by day (every chokepoint, and India's ports). */
  followed: boolean
  latestDate: string | null
  /** Average a day over the latest 7 days, and the same 7 days a year before. */
  recent: number | null
  yearAgo: number | null
  /** Average daily tonnes over the latest 7 days (ports). */
  imports7: number | null
  exports7: number | null
  /** Weekly averages of the daily total, oldest first, for the panel's chart. */
  weekly: { week: string; total: number }[]
}

export type EventKind = 'EQ' | 'TC' | 'FL' | 'VO' | 'DR' | 'WF'
export const EVENT_KINDS: Record<EventKind, string> = {
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire'
}

export interface WorldEvent {
  id: string
  kind: EventKind
  title: string
  lat: number
  lon: number
  /** ISO time it started or happened. */
  time: string
  /** GDACS alert level. */
  level: 'Red' | 'Orange' | 'Green' | null
  /** Earthquake magnitude. */
  magnitude: number | null
  url: string | null
  source: 'USGS' | 'GDACS'
}

export interface FreightPoint {
  date: string
  value: number
}

export interface WorldSourceStatus {
  key: string
  label: string
  /** Credit line the source asks for. */
  credit: string
  /** Last successful fetch (ISO), and the last error if the latest try failed. */
  updatedAt: string | null
  error: string | null
  everyHours: number
}

/** Where the family's investments sit, by country (funds looked through). */
export interface MoneyByCountry {
  totalInr: number
  /** In overseas funds whose holdings aren't on file. */
  unknownInr: number
  countries: { iso3: string; name: string; valueInr: number; share: number; direct: number; viaFunds: number }[]
}

export interface WorldMap {
  figures: WorldFigures
  places: WorldPlace[]
  trade: TradeRow[]
  events: WorldEvent[]
  /** Shanghai containerised freight index, one reading a week. */
  freight: FreightPoint[]
  /** The family's money by country; its shares are also the "money" figures. */
  money: MoneyByCountry
  sources: WorldSourceStatus[]
  /** The background updates are on (they start the first time the map is opened). */
  enabled: boolean
  refreshing: boolean
}

export interface Ship {
  mmsi: number
  lat: number
  lon: number
  /** Speed over ground, knots. */
  sog: number | null
  /** Course over ground, degrees. */
  cog: number | null
  name: string | null
  /** AIS ship type code (70–79 cargo, 80–89 tanker, 60–69 passenger…). */
  type: number | null
  /** Milliseconds since 1970 of the position. */
  at: number
  source: 'digitraffic' | 'aisstream'
}

export interface ShipsView {
  ships: Ship[]
  feeds: {
    key: 'digitraffic' | 'aisstream'
    label: string
    credit: string
    count: number
    error: string | null
    on: boolean
  }[]
}

export interface AisStatus {
  hasKey: boolean
  keyEnding: string | null
}

export type ShipClass = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'other'
export function shipClass(type: number | null): ShipClass {
  if (type === null) return 'other'
  if (type >= 70 && type <= 79) return 'cargo'
  if (type >= 80 && type <= 89) return 'tanker'
  if (type >= 60 && type <= 69) return 'passenger'
  if (type === 30) return 'fishing'
  return 'other'
}

/** The aisstream.io box the optional live-ships feed asks for: India's seas, the Gulf, the Red Sea and Malacca. */
export const AIS_BOX: [[number, number], [number, number]] = [
  [-12, 30],
  [32, 106]
]

/**
 * A colour position from −1 (the "lo" end) through 0 (mid) to 1 (the "hi" end), or null without a value.
 */
export function scalePosition(m: WorldMetric, v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  if (v >= m.mid) return m.hi === m.mid ? 0 : Math.min(1, (v - m.mid) / (m.hi - m.mid))
  return m.lo === m.mid ? 0 : Math.max(-1, (v - m.mid) / (m.mid - m.lo))
}

/** The value for a year, or the closest earlier year within `back` years; latest-only metrics take their one reading. */
export function figureAt(
  series: Record<string, number> | undefined,
  year: number | null,
  back = 2
): { period: string; value: number } | null {
  if (!series) return null
  const periods = Object.keys(series).sort()
  if (periods.length === 0) return null
  if (year === null) {
    const p = periods[periods.length - 1]
    return { period: p, value: series[p] }
  }
  for (let y = year; y >= year - back; y--)
    if (series[String(y)] !== undefined) return { period: String(y), value: series[String(y)] }
  return null
}

/** Mean of a list, or null when empty. */
export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Recent and year-ago daily averages and weekly totals from a place's daily traffic (oldest first). */
export function summariseTraffic(
  days: TrafficDay[]
): Pick<WorldPlace, 'latestDate' | 'recent' | 'yearAgo' | 'imports7' | 'exports7' | 'weekly'> {
  if (days.length === 0)
    return { latestDate: null, recent: null, yearAgo: null, imports7: null, exports7: null, weekly: [] }
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1].date
  const t = Date.parse(latest)
  const within = (from: number, to: number) =>
    sorted.filter((d) => Date.parse(d.date) > from && Date.parse(d.date) <= to)
  const DAY = 86_400_000
  const last7 = within(t - 7 * DAY, t)
  const ago = within(t - 7 * DAY - 364 * DAY, t - 364 * DAY)
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null)
  // Weeks end on the latest date, so the final bar is always a full week.
  const weeks = new Map<number, number[]>()
  for (const d of sorted) {
    const w = Math.floor((t - Date.parse(d.date)) / (7 * DAY))
    weeks.set(w, [...(weeks.get(w) ?? []), d.total])
  }
  const weekly = [...weeks.entries()]
    .filter(([, v]) => v.length >= 4)
    .sort((a, b) => b[0] - a[0])
    .map(([w, v]) => ({ week: new Date(t - w * 7 * DAY).toISOString().slice(0, 10), total: mean(v)! }))
  return {
    latestDate: latest,
    recent: mean(last7.map((d) => d.total)),
    yearAgo: ago.length >= 4 ? mean(ago.map((d) => d.total)) : null,
    imports7: mean(nums(last7.map((d) => d.imports))),
    exports7: mean(nums(last7.map((d) => d.exports))),
    weekly
  }
}
