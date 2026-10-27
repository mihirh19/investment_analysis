// The farm's weather: a 10-day forecast for the village from Open-Meteo, and plain warnings drawn
// from it (heavy rain, rain on the way, heat, frost risk, strong wind).

export interface FarmPlace {
  name: string
  /** District and state, as the geocoder gives them. */
  area: string
  lat: number
  lon: number
}

export interface WeatherDay {
  date: string
  tMax: number | null
  tMin: number | null
  /** mm. */
  rain: number | null
  /** Highest hourly chance of rain, %. */
  rainChance: number | null
  /** Strongest gust, km/h. */
  gust: number | null
  /** Reference evapotranspiration, mm: how much water a crop loses that day. */
  et0: number | null
}

export type WeatherWarnKind = 'heavyRain' | 'rain' | 'heat' | 'cold' | 'wind'

export interface WeatherWarning {
  kind: WeatherWarnKind
  date: string
  title: string
  detail: string
}

export interface FarmWeather {
  place: FarmPlace | null
  days: WeatherDay[]
  warnings: WeatherWarning[]
  fetchedAt: string | null
  error: string | null
}

const dayName = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Warnings for the next week, using IMD's own thresholds where it has them: heavy rain is 64.5 mm in a
 * day; a heat wave in the plains starts at 40°C with 45°C severe (taken here as 42°C); ground frost risk
 * near 4°C. Rain on the way: 10 mm or more with at least a 60% chance in the next three days.
 */
export function weatherWarnings(days: WeatherDay[], today: string): WeatherWarning[] {
  const out: WeatherWarning[] = []
  const ahead = days.filter((d) => d.date >= today).slice(0, 7)
  for (const [i, d] of ahead.entries()) {
    const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : dayName(d.date)
    if ((d.rain ?? 0) >= 64.5) out.push({ kind: 'heavyRain', date: d.date, title: `Heavy rain ${when}`, detail: `About ${Math.round(d.rain!)} mm forecast. Fields can waterlog; harvested produce in the open will get wet.` })
    else if (i < 3 && (d.rain ?? 0) >= 10 && (d.rainChance ?? 0) >= 60)
      out.push({ kind: 'rain', date: d.date, title: `Rain ${when}`, detail: `About ${Math.round(d.rain!)} mm, ${d.rainChance}% chance. Worth knowing before spraying, harvesting or taking a load to the mandi.` })
    if ((d.tMax ?? 0) >= 42) out.push({ kind: 'heat', date: d.date, title: `Very hot ${when}`, detail: `Up to ${Math.round(d.tMax!)}°C. Crops and animals need more water.` })
    if (d.tMin !== null && d.tMin <= 4) out.push({ kind: 'cold', date: d.date, title: `Frost risk ${when}`, detail: `Down to ${Math.round(d.tMin)}°C at night.` })
    if ((d.gust ?? 0) >= 50) out.push({ kind: 'wind', date: d.date, title: `Strong wind ${when}`, detail: `Gusts up to ${Math.round(d.gust!)} km/h. Tall crops can lodge.` })
  }
  return out
}
