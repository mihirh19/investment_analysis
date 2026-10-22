import { useState } from 'react'
import { useData } from '../lib/data'
import { Seg } from '../ui'
import { Farm } from './Farm'
import { Properties } from './Properties'
import { Vehicles } from './Vehicles'

type Part = 'property' | 'vehicles' | 'farm'

/** Property, vehicles and the farm together, so the tab bar stays at six. */
export function Assets() {
  const { snapshot } = useData()
  const [part, setPart] = useState<Part>(() => (sessionStorage.getItem('fp.assets') as Part) || 'property')
  if (!snapshot) return null
  const parts = (
    [
      ['property', 'Property & rent', snapshot.properties.length],
      ['vehicles', 'Vehicles', snapshot.vehicles.length],
      ['farm', 'Farm', snapshot.farm ? snapshot.farm.seasons.length + snapshot.farm.prices.length : 0]
    ] as const
  ).filter(([, , n]) => n > 0)
  const shown = parts.find(([k]) => k === part)?.[0] ?? parts[0]?.[0]
  return (
    <>
      {parts.length > 1 && (
        <div className="mb-3">
          <Seg
            label="Which assets"
            value={shown!}
            onChange={(p: Part) => (sessionStorage.setItem('fp.assets', p), setPart(p))}
            options={parts.map(([value, label]) => ({ value, label }))}
          />
        </div>
      )}
      {shown === 'property' && <Properties />}
      {shown === 'vehicles' && <Vehicles />}
      {shown === 'farm' && <Farm />}
    </>
  )
}
