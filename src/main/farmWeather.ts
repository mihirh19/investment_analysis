import { eq } from 'drizzle-orm'
import { weatherWarnings, type FarmPlace, type FarmWeather, type WeatherDay } from '@shared/weather'
import { schema, type Db } from './db'
import { getJson, type FetchFn } from './market/http'
import { WORLD_UA } from './world/sync'

/**
 * Weather for the farm's village from Open-Meteo (free for non-commercial use, no key; data CC BY
 * 4.0). Only the village's coordinates are sent. The forecast is kept for three hours.
 */

const PLACE_KEY = 'farm:place'
const CACHE_KEY = 'farm:weather'
const FRESH_MS = 3 * 3600_000

const get = (db: Db, k: string) => db.select().from(schema.settings).where(eq(schema.settings.key, k)).get()?.value ?? null
const put = (db: Db, key: string, value: string) =>
  db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run()

export const farmPlace = (db: Db): FarmPlace | null => JSON.parse(get(db, PLACE_KEY) ?? 'null')

export function setFarmPlace(db: Db, place: FarmPlace | null): void {
  if (place && !(Math.abs(place.lat) <= 90 && Math.abs(place.lon) <= 180)) throw new Error('That place has no proper coordinates.')
  put(db, PLACE_KEY, JSON.stringify(place))
  put(db, CACHE_KEY, 'null')
}

/** Places in India matching a name (a village, town or taluka). */
export async function findPlaces(query: string, f: FetchFn = fetch): Promise<FarmPlace[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const json = await getJson<{ results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; admin3?: string; country_code?: string }[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json&countryCode=IN`,
    { fetch: f, headers: { 'User-Agent': WORLD_UA } }
  )
  return (json.results ?? [])
    .filter((r) => !r.country_code || r.country_code === 'IN')
    .map((r) => ({ name: r.name, area: [r.admin3 === r.name ? null : r.admin3, r.admin2, r.admin1].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }))
}

/** Open-Meteo's daily forecast into days. */
export function parseForecast(json: unknown): WeatherDay[] {
  const d = (json as { daily?: Record<string, (number | string | null)[]> } | null)?.daily
  if (!d?.time) return []
  const n = (k: string, i: number) => {
    const v = d[k]?.[i]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return (d.time as string[]).map((date, i) => ({
    date,
    tMax: n('temperature_2m_max', i),
    tMin: n('temperature_2m_min', i),
    rain: n('precipitation_sum', i),
    rainChance: n('precipitation_probability_max', i),
    gust: n('wind_gusts_10m_max', i),
    et0: n('et0_fao_evapotranspiration', i)
  }))
}

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** The stored forecast, without asking anyone (for the alerts). */
export function storedWeather(db: Db): FarmWeather {
  const place = farmPlace(db)
  const c = JSON.parse(get(db, CACHE_KEY) ?? 'null') as { days: WeatherDay[]; fetchedAt: string } | null
  const days = c?.days ?? []
  return { place, days, warnings: weatherWarnings(days, istToday()), fetchedAt: c?.fetchedAt ?? null, error: null }
}

/** The forecast, fetched again when older than three hours. */
export async function farmWeather(db: Db, f: FetchFn = fetch, force = false): Promise<FarmWeather> {
  const s = storedWeather(db)
  if (!s.place) return s
  if (!force && s.fetchedAt && Date.now() - Date.parse(s.fetchedAt) < FRESH_MS) return s
  try {
    const json = await getJson<unknown>(
      `https://api.open-meteo.com/v1/forecast?latitude=${s.place.lat.toFixed(4)}&longitude=${s.place.lon.toFixed(4)}` +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,et0_fao_evapotranspiration' +
        '&timezone=Asia%2FKolkata&forecast_days=10',
      { fetch: f, timeoutMs: 20_000, headers: { 'User-Agent': WORLD_UA } }
    )
    const days = parseForecast(json)
    if (days.length === 0) throw new Error('Open-Meteo sent no forecast')
    const fetchedAt = new Date().toISOString()
    put(db, CACHE_KEY, JSON.stringify({ days, fetchedAt }))
    return { ...s, days, warnings: weatherWarnings(days, istToday()), fetchedAt }
  } catch (e) {
    return { ...s, error: e instanceof Error ? e.message : String(e) }
  }
}
