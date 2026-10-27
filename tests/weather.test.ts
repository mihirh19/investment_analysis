import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { checkAuto } from '../src/main/alerts'
import { farmWeather, findPlaces, parseForecast, setFarmPlace, storedWeather } from '../src/main/farmWeather'
import { weatherWarnings, type WeatherDay } from '../src/shared/weather'

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'weather', f), 'utf8')
const day = (date: string, o: Partial<WeatherDay>): WeatherDay => ({ date, tMax: 32, tMin: 20, rain: 0, rainChance: 0, gust: 20, et0: 4, ...o })

describe('farm weather', () => {
  it('reads Open-Meteo’s places and forecast', async () => {
    const places = await findPlaces('Gondal', (async () => new Response(fx('open-meteo-geocode.json'))) as unknown as typeof fetch)
    expect(places[0]).toEqual({ name: 'Gondal', area: 'Rajkot, Gujarat', lat: 21.96074, lon: 70.80255 })
    const days = parseForecast(JSON.parse(fx('open-meteo-forecast.json')))
    expect(days).toHaveLength(10)
    expect(Object.keys(days[0])).toEqual(['date', 'tMax', 'tMin', 'rain', 'rainChance', 'gust', 'et0'])
    expect(days[3].rain).toBe(0.7)
  })

  it('warns of heavy rain, rain on the way, heat, frost and wind', () => {
    const w = weatherWarnings(
      [
        day('2026-10-26', { rain: 15, rainChance: 70 }),
        day('2026-10-27', { rain: 80, rainChance: 90, gust: 60 }),
        day('2026-10-28', { tMax: 43 }),
        day('2026-10-29', { rain: 15, rainChance: 70 }), // too far off to say "rain on the way"
        day('2026-10-30', { tMin: 3 })
      ],
      '2026-10-26'
    )
    expect(w.map((x) => [x.date, x.kind])).toEqual([
      ['2026-10-26', 'rain'],
      ['2026-10-27', 'heavyRain'],
      ['2026-10-27', 'wind'],
      ['2026-10-28', 'heat'],
      ['2026-10-30', 'cold']
    ])
    expect(w[0].title).toBe('Rain today')
    expect(w[1].title).toBe('Heavy rain tomorrow')
  })

  it('keeps the forecast three hours and alerts on today and tomorrow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-wx-'))
    const o = openDatabase(join(dir, 't.db'), '0'.repeat(64), resolve('drizzle'))
    try {
      expect((await farmWeather(o.db)).place).toBeNull()
      setFarmPlace(o.db, { name: 'Gondal', area: 'Rajkot, Gujarat', lat: 21.96, lon: 70.8 })
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
      const plus = (n: number) => new Date(Date.parse(today) + n * 86400_000).toISOString().slice(0, 10)
      const json = { daily: { time: [today, plus(1), plus(2)], temperature_2m_max: [30, 30, 30], temperature_2m_min: [20, 20, 20], precipitation_sum: [0, 90, 90], precipitation_probability_max: [0, 95, 95], wind_gusts_10m_max: [10, 10, 10], et0_fao_evapotranspiration: [4, 4, 4] } }
      let calls = 0
      const f = (async () => (calls++, new Response(JSON.stringify(json)))) as unknown as typeof fetch
      const w = await farmWeather(o.db, f)
      expect(w.warnings.map((x) => x.date)).toEqual([plus(1), plus(2)])
      await farmWeather(o.db, f)
      expect(calls).toBe(1)
      expect(storedWeather(o.db).days).toHaveLength(3)
      // Only tomorrow's heavy rain is close enough to alert, and only once.
      expect(checkAuto(o.db).map((e) => e.key)).toEqual([`weather:${plus(1)}:heavyRain`])
      expect(checkAuto(o.db)).toEqual([])
      expect(() => setFarmPlace(o.db, { name: 'x', area: '', lat: 200, lon: 0 })).toThrow()
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
