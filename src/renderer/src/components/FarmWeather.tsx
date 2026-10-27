import { useState } from 'react'
import type { FarmPlace } from '@shared/weather'
import { Button } from './ui'
import { ErrorNote } from './Shell'
import { findFarmPlaces, useFarmWeather, useRefreshFarmWeather, useSetFarmPlace } from '../lib/api'
import { timeAgo } from '../lib/format'

const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })

/** The next ten days at the village, and warnings worth knowing before field work or a mandi trip. */
export function FarmWeatherSection() {
  const q = useFarmWeather()
  const refresh = useRefreshFarmWeather()
  const setPlace = useSetFarmPlace()
  const [choosing, setChoosing] = useState(false)
  const w = q.data

  if (!w) return null
  if (!w.place || choosing)
    return (
      <section className="mb-10">
        <h2 className="wide mb-2 text-[19px] font-semibold">Weather at the farm</h2>
        <PlacePicker
          onPick={(p) => setPlace.mutate([p], { onSuccess: () => setChoosing(false) })}
          onCancel={w.place ? () => setChoosing(false) : undefined}
          busy={setPlace.isPending}
        />
        <ErrorNote error={setPlace.error} />
      </section>
    )

  return (
    <section className="mb-10">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="wide text-[19px] font-semibold">Weather at {w.place.name}</h2>
        <span className="text-[13px] text-ink-muted">{w.place.area}</span>
        <button type="button" className="text-[13px] text-stamp hover:underline" onClick={() => setChoosing(true)}>
          Change
        </button>
        <button type="button" className="text-[13px] text-stamp hover:underline disabled:opacity-50" disabled={refresh.isPending} onClick={() => refresh.mutate([])}>
          {refresh.isPending ? 'Updating…' : 'Update'}
        </button>
      </div>
      {w.error && <p className="mb-2 text-[13px] text-warn">Couldn’t update the forecast: {w.error}</p>}
      {w.warnings.length > 0 && (
        <ul className="mb-3 space-y-1">
          {w.warnings.map((x) => (
            <li key={`${x.date}|${x.kind}`} className="rounded-sm border border-warn/50 bg-warn-wash px-3 py-1.5 text-[14px]">
              <strong>{x.title}.</strong> {x.detail}
            </li>
          ))}
        </ul>
      )}
      {w.days.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-[13px]">
            <thead>
              <tr className="text-[12px] text-ink-muted">
                <th className="pr-3 text-left font-medium" />
                {w.days.map((d) => (
                  <th key={d.date} className="px-2 text-right font-medium">
                    {day(d.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="High / low °C" cells={w.days.map((d) => (d.tMax === null ? '—' : `${Math.round(d.tMax)} / ${Math.round(d.tMin ?? 0)}`))} />
              <Row label="Rain, mm" cells={w.days.map((d) => (d.rain === null ? '—' : d.rain < 0.5 ? '0' : d.rain.toFixed(d.rain < 10 ? 1 : 0)))} />
              <Row label="Chance of rain" cells={w.days.map((d) => (d.rainChance === null ? '—' : `${d.rainChance}%`))} />
              <Row label="Gusts, km/h" cells={w.days.map((d) => (d.gust === null ? '—' : String(Math.round(d.gust))))} />
              <Row label="Crop water use, mm" cells={w.days.map((d) => (d.et0 === null ? '—' : d.et0.toFixed(1)))} />
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-[12px] text-ink-muted">
        Forecast: Open-Meteo.com (CC BY 4.0){w.fetchedAt ? `, ${timeAgo(w.fetchedAt)}` : ''}. Crop water use is the reference evapotranspiration.
      </p>
    </section>
  )
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr className="border-t border-rule">
      <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-muted">
        {label}
      </th>
      {cells.map((c, i) => (
        <td key={i} className="num px-2">
          {c}
        </td>
      ))}
    </tr>
  )
}

function PlacePicker({ onPick, onCancel, busy }: { onPick: (p: FarmPlace) => void; onCancel?: () => void; busy: boolean }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FarmPlace[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      setHits(await findFarmPlaces(query))
    } catch (err) {
      setError(err)
    }
  }
  return (
    <div className="max-w-[70ch]">
      <p className="mb-2 text-[14px] text-ink-muted">
        Name the village or nearest town to get a 10-day forecast and warnings for rain, heat, frost and wind. Only its map position is sent to Open-Meteo.
      </p>
      <form onSubmit={search} className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Village or town" aria-label="Village or town" className="w-64 rounded-sm border border-rule bg-sheet px-2 py-1 text-[14px]" />
        <Button type="submit" variant="quiet" disabled={query.trim().length < 2}>
          Search
        </Button>
        {onCancel && (
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </form>
      <ErrorNote error={error} />
      {hits && hits.length === 0 && <p className="mt-2 text-[13px] text-ink-muted">No place in India by that name. Try the taluka or a nearby town.</p>}
      {hits && hits.length > 0 && (
        <ul className="mt-2 text-[14px]">
          {hits.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" disabled={busy} className="py-0.5 text-left hover:text-stamp hover:underline" onClick={() => onPick(p)}>
                {p.name} <span className="text-ink-muted">{p.area}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
