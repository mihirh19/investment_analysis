import { useState } from 'react'
import { compactMoney, money } from '../lib/format'

export interface DrillRow {
  key: string
  name: string
  /** A second line: sector, issuer and rating, and the like. */
  sub?: string | null
  directInr: number
  viaFundsInr: number
  valueInr: number
}

const FIRST = 15

/**
 * What sits inside one bar or band: each holding in rupees and as a share of the group and of
 * the whole (equity or debt). Opens under the chart that was clicked.
 */
export function Drill({
  id,
  title,
  detail,
  rows,
  groupLabel,
  overallTotal,
  overallLabel,
  empty,
  onClose
}: {
  id: string
  title: string
  detail?: string
  rows: DrillRow[]
  /** "of sector", "of large cap", … */
  groupLabel: string
  overallTotal: number
  /** "of equity", "of debt" */
  overallLabel: string
  empty?: string
  onClose: () => void
}) {
  const [all, setAll] = useState(false)
  const total = rows.reduce((s, r) => s + r.valueInr, 0)
  const shown = all ? rows : rows.slice(0, FIRST)
  const pct = (v: number, of: number) => (of > 0 ? `${((v / of) * 100).toFixed(1)}%` : '—')
  const anyDirect = rows.some((r) => r.directInr > 0)
  const anyVia = rows.some((r) => r.viaFundsInr > 0)

  return (
    <section id={id} aria-label={title} className="anim-fade mt-4 rounded-md border border-rule bg-sheet px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h3 className="wide text-[16px] font-semibold">{title}</h3>
          <p className="text-[13px] text-ink-muted">
            {rows.length > 0
              ? `${rows.length} ${rows.length === 1 ? 'holding' : 'holdings'}, ${money(total)} in all${detail ? `. ${detail}` : ''}`
              : detail}
          </p>
        </div>
        <button className="shrink-0 text-[14px] text-stamp hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-[14px] text-ink-muted">{empty ?? 'Nothing here yet.'}</p>
      ) : (
        <>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[12px] text-ink-muted">
                <th className="py-1.5 font-medium">Holding</th>
                {anyDirect && <th className="num py-1.5 font-medium">Directly</th>}
                {anyVia && <th className="num py-1.5 font-medium">Via funds</th>}
                <th className="num py-1.5 font-medium">Total</th>
                <th className="num py-1.5 font-medium">{groupLabel}</th>
                <th className="num py-1.5 font-medium">{overallLabel}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-b border-rule align-top">
                  <td className="py-1.5 pr-3">
                    <div className="leading-snug">{r.name}</div>
                    {r.sub && <div className="condensed text-[12px] text-ink-muted">{r.sub}</div>}
                  </td>
                  {anyDirect && <td className="num py-1.5">{r.directInr ? compactMoney(r.directInr) : ''}</td>}
                  {anyVia && <td className="num py-1.5">{r.viaFundsInr ? compactMoney(r.viaFundsInr) : ''}</td>}
                  <td className="num py-1.5 font-medium">{compactMoney(r.valueInr)}</td>
                  <td className="num py-1.5">{pct(r.valueInr, total)}</td>
                  <td className="num py-1.5">{pct(r.valueInr, overallTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > FIRST && (
            <button className="mt-2 text-[14px] text-stamp hover:underline" onClick={() => setAll(!all)}>
              {all ? `Show the top ${FIRST}` : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
