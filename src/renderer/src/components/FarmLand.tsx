import { LAND_UNITS } from '@shared/assets'
import { useProperties } from '../lib/api'
import { money, percent } from '../lib/format'
import { useTerminal } from '../lib/terminal'

/** The family's farmland (land kept under Property): area, value, and what farming earned on it this year. */
export function FarmLand({ personId, fy }: { personId?: number; fy: { fy: string; sales: number; costs: number; support: number } }) {
  const q = useProperties(personId)
  const terminal = useTerminal()
  const land = (q.data ?? []).filter((p) => p.meta.propertyType === 'LAND' && p.meta.subtype !== 'PLOT')
  if (land.length === 0)
    return (
      <p className="mb-8 max-w-[80ch] text-[14px] text-ink-muted">
        Add the farmland itself under{' '}
        <button type="button" className="text-stamp hover:underline" onClick={() => terminal?.openScreen('/property')}>
          Property
        </button>{' '}
        (kind: Farm or land) with its 7/12 details, to count it in net worth and see what farming earns on it.
      </p>
    )
  const acres = land.reduce((s, p) => s + (p.meta.land?.areaAcres ?? 0), 0)
  const value = land.reduce((s, p) => s + (p.value ?? 0), 0)
  const net = fy.sales - fy.costs + fy.support
  return (
    <section className="mb-10">
      <h2 className="wide mb-3 text-[19px] font-semibold">Your farmland</h2>
      <table className="w-full max-w-[860px] text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
            <th className="py-1 text-left font-medium">Land</th>
            <th className="px-2 text-left font-medium">Village</th>
            <th className="px-2 text-right font-medium">Area</th>
            <th className="px-2 text-right font-medium">Value</th>
            <th className="px-2 text-right font-medium">A acre</th>
          </tr>
        </thead>
        <tbody>
          {land.map((p) => {
            const a = p.meta.land?.areaAcres ?? null
            return (
              <tr key={p.accountId} className="border-b border-rule">
                <td className="py-1">
                  {p.meta.name}
                  {p.meta.land?.surveyNo && <span className="ml-2 text-[12px] text-ink-muted">survey {p.meta.land.surveyNo}</span>}
                </td>
                <td className="px-2 text-ink-muted">{p.meta.land?.village ?? ''}</td>
                <td className="num px-2">{a ? `${a.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ac` : '—'}</td>
                <td className="num px-2">{money(p.value)}</td>
                <td className="num px-2">{a && p.value ? money(p.value / a) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 max-w-[80ch] text-[14px]">
        {acres > 0 && (
          <>
            {acres.toLocaleString('en-IN', { maximumFractionDigits: 2 })} acres ({(acres / LAND_UNITS.hectare).toLocaleString('en-IN', { maximumFractionDigits: 2 })}{' '}
            hectares), worth {money(value)}.{' '}
          </>
        )}
        {value > 0 && (fy.sales > 0 || fy.costs > 0) && (
          <>
            So far in {fy.fy}, farming brought in {money(net)} after costs, support included
            {acres > 0 ? `, ${money(net / acres)} an acre` : ''}: <strong className="num">{percent(net / value)}</strong> of the land&rsquo;s value.
          </>
        )}
      </p>
    </section>
  )
}
