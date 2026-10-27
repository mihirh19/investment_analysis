import { useMemo, useState } from 'react'
import { NO_SHOCK, PRESETS, runScenario, type Shocks } from '@shared/scenario'
import { ErrorNote, PageHeader } from '../components/Shell'
import { useScenarioHoldings } from '../lib/api'
import { money, signedMoney, toneClass } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const SLIDERS: { key: keyof Shocks; label: string; min: number; max: number; step: number; unit: 'pct' | 'pts' }[] = [
  { key: 'inEquity', label: 'Indian shares', min: -60, max: 40, step: 1, unit: 'pct' },
  { key: 'usEquity', label: 'US and other foreign shares', min: -60, max: 40, step: 1, unit: 'pct' },
  { key: 'usdInr', label: 'Dollar in rupees (up = weaker rupee)', min: -15, max: 30, step: 1, unit: 'pct' },
  { key: 'gold', label: 'Gold and silver', min: -30, max: 40, step: 1, unit: 'pct' },
  { key: 'rates', label: 'Interest rates', min: -3, max: 3, step: 0.25, unit: 'pts' },
  { key: 'crop', label: 'Crop prices (godown stock)', min: -40, max: 40, step: 1, unit: 'pct' },
  { key: 'property', label: 'Property', min: -30, max: 30, step: 1, unit: 'pct' },
  { key: 'crypto', label: 'Crypto', min: -80, max: 100, step: 5, unit: 'pct' }
]

/** What happens to the family's money if markets move: a rough stress test, not a forecast. */
export function Scenarios() {
  const { scope } = useScope()
  const q = useScenarioHoldings(scopePersonId(scope))
  const [s, setS] = useState<Shocks>(PRESETS[0].shocks)
  const [preset, setPreset] = useState<string | null>(PRESETS[0].key)
  const r = useMemo(() => (q.data ? runScenario(q.data, s) : null), [q.data, s])
  const set = (k: keyof Shocks, v: number, unit: 'pct' | 'pts') => {
    setPreset(null)
    setS((x) => ({ ...x, [k]: unit === 'pct' ? v / 100 : v }))
  }

  return (
    <>
      <PageHeader title="What if" />
      <ErrorNote error={q.error} />
      <p className="mb-4 max-w-[80ch] text-[13.5px] text-ink-muted">
        Move the markets and see what it does to the family&rsquo;s investments. Funds count by what they hold. Deposits, PPF, EPF and loans don&rsquo;t move here. A rough stress
        test to see where the risk sits, not a forecast.
      </p>
      <div role="radiogroup" aria-label="Start from" className="mb-4 flex flex-wrap gap-1 text-[13px]">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={preset === p.key}
            title={p.note}
            onClick={() => (setS(p.shocks), setPreset(p.key))}
            className={`rounded-sm px-2.5 py-1 ${preset === p.key ? 'bg-stamp font-semibold text-black' : 'text-ink-muted hover:bg-sheet hover:text-ink'}`}
          >
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => (setS(NO_SHOCK), setPreset(null))} className="rounded-sm px-2.5 py-1 text-ink-muted hover:bg-sheet hover:text-ink">
          Clear
        </button>
      </div>
      {preset && <p className="mb-4 text-[13px] text-ink-muted">{PRESETS.find((p) => p.key === preset)?.note}</p>}

      <div className="grid gap-8 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          {SLIDERS.map((x) => {
            const v = x.unit === 'pct' ? Math.round(s[x.key] * 100) : s[x.key]
            return (
              <label key={x.key} className="block text-[13.5px]">
                <span className="flex justify-between">
                  <span>{x.label}</span>
                  <span className={`num ${toneClass(x.key === 'rates' || x.key === 'usdInr' ? 0 : v)}`}>
                    {v > 0 ? '+' : v < 0 ? '−' : ''}
                    {Math.abs(v)}
                    {x.unit === 'pct' ? '%' : ' pts'}
                  </span>
                </span>
                <input type="range" min={x.min} max={x.max} step={x.step} value={v} onChange={(e) => set(x.key, Number(e.target.value), x.unit)} className="w-full accent-[var(--stamp)]" />
              </label>
            )
          })}
        </div>

        {r && (
          <div>
            <div className="mb-4 rounded-sm border border-rule bg-sheet px-4 py-3">
              <div className="text-[12.5px] text-ink-muted">The investments would move by</div>
              <div className={`num text-left text-[28px] font-semibold ${toneClass(r.change)}`}>{signedMoney(r.change)}</div>
              <div className="text-[13px] text-ink-muted">
                {r.before ? `${r.change >= 0 ? '+' : '−'}${Math.abs((r.change / r.before) * 100).toFixed(1)}%` : ''}: from {money(r.before, 'INR', 0)} to {money(r.after, 'INR', 0)}
              </div>
            </div>
            <h2 className="mb-1 text-[15px] font-semibold text-stamp">What moves it</h2>
            <table className="mb-6 w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                  <th className="py-1 text-left font-medium">Driver</th>
                  <th className="px-2 text-right font-medium">Money exposed</th>
                  <th className="px-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {r.byDriver.map((d) => (
                  <tr key={d.key} className="border-b border-rule">
                    <td className="py-1">{d.label}</td>
                    <td className="num px-2">{money(d.exposed, 'INR', 0)}</td>
                    <td className={`num px-2 ${toneClass(d.change)}`}>{Math.abs(d.change) < 1 ? '—' : signedMoney(d.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.holdings.length > 0 && (
              <>
                <h2 className="mb-1 text-[15px] font-semibold text-stamp">Holdings that move most</h2>
                <table className="w-full text-[13.5px]">
                  <tbody>
                    {r.holdings.map((h) => (
                      <tr key={h.name} className="border-b border-rule">
                        <td className="py-1">{h.name}</td>
                        <td className="num px-2 text-ink-muted">{money(h.before, 'INR', 0)}</td>
                        <td className={`num px-2 ${toneClass(h.change)}`}>{signedMoney(h.change)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
