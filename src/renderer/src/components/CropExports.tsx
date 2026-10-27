import { useState } from 'react'
import { CROP_HS, CROPS, type CropKey } from '@shared/farm'
import { ErrorNote } from './Shell'
import { useCropExports } from '../lib/api'
import { timeAgo } from '../lib/format'

const t = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('en-IN')} t`)
const change = (now: number | null, then: number | null) => {
  if (now === null || !then) return null
  const c = now / then - 1
  return <span className={c >= 0 ? 'text-gain' : 'text-loss'}>{`${c >= 0 ? '+' : '−'}${Math.abs(c * 100).toFixed(0)}%`}</span>
}
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** How much of the crop India sells abroad and to whom: demand from abroad is one of the things that moves the mandi price. */
export function CropExports({ crop }: { crop: CropKey }) {
  const hs = CROP_HS[crop]
  const [on, setOn] = useState(false)
  const q = useCropExports(crop, on)
  if (!hs) return null
  const x = q.data
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-[14px] font-medium">Demand from abroad</h4>
      {!on ? (
        <button type="button" className="text-[13px] text-stamp hover:underline" onClick={() => setOn(true)}>
          Show India&rsquo;s {CROPS[crop].label.toLowerCase()} exports (UN Comtrade, about half a minute)
        </button>
      ) : q.isLoading ? (
        <p className="text-[13px] text-ink-muted">Asking UN Comtrade, a few calls a few seconds apart…</p>
      ) : (
        <>
          <ErrorNote error={q.error} />
          {x && (
            <div className="text-[13.5px]">
              <p className="mb-1">
                {x.year !== null ? (
                  <>
                    In {x.year} India exported {t(x.tonnes)} of {x.what} {change(x.tonnes, x.prevTonnes) && <>({change(x.tonnes, x.prevTonnes)} on {x.year - 1})</>}.{' '}
                  </>
                ) : (
                  'No yearly figures yet. '
                )}
                {x.latestMonth && (
                  <>
                    {monthLabel(x.latestMonth.month)}: {t(x.latestMonth.tonnes)}
                    {x.latestMonth.yearAgoTonnes !== null && <> against {t(x.latestMonth.yearAgoTonnes)} a year before ({change(x.latestMonth.tonnes, x.latestMonth.yearAgoTonnes)})</>}.
                  </>
                )}
              </p>
              {x.partners.length > 0 && (
                <table className="text-[13px]">
                  <thead>
                    <tr className="text-[12px] text-ink-muted">
                      <th className="pr-4 text-left font-medium">Biggest buyers, {x.year}</th>
                      <th className="px-2 text-right font-medium">Tonnes</th>
                      <th className="px-2 text-right font-medium">Share</th>
                      <th className="px-2 text-right font-medium">On a year before</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.partners.map((p) => (
                      <tr key={p.iso} className="border-t border-rule">
                        <td className="py-0.5 pr-4">{p.name}</td>
                        <td className="num px-2">{Math.round(p.tonnes).toLocaleString('en-IN')}</td>
                        <td className="num px-2">{p.share === null ? '—' : `${(p.share * 100).toFixed(0)}%`}</td>
                        <td className="num px-2">{change(p.tonnes, p.prevTonnes) ?? <span className="text-ink-muted">new</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-1 text-[12px] text-ink-muted">
                Source: UN Comtrade (HS {x.hs}), {timeAgo(x.fetchedAt)}. Customs figures arrive months late, so this shows the trend, not this week&rsquo;s demand.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
