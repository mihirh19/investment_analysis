import { Fragment, useState } from 'react'
import { ErrorNote, PageHeader } from '../components/Shell'
import { useXray } from '../lib/api'
import { lakhCrore, money } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

/** Every company the family owns, directly and inside its funds: where it comes from, and how concentrated. */
export function Xray() {
  const { scope } = useScope()
  const q = useXray(scopePersonId(scope))
  const [open, setOpen] = useState<string | null>(null)
  const x = q.data
  return (
    <>
      <PageHeader title="Portfolio X-ray" />
      <ErrorNote error={q.error} />
      <p className="mb-4 max-w-[80ch] text-[13.5px] text-ink-muted">
        Your shares and every fund opened up into the companies it holds (from the funds’ monthly portfolio disclosures), added together. A stock
        you hold directly and through three funds counts once, at its full size.
      </p>
      {x && x.companies.length === 0 && <p className="text-ink-muted">No Indian equity to look into yet.</p>}
      {x && x.companies.length > 0 && (
        <>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
            <Tile label="Equity looked through" value={lakhCrore(x.equityInr)} note={x.unknownInr > 0 ? `${lakhCrore(x.unknownInr)} more in funds with no holdings on file` : undefined} />
            <Tile label="Behaves like" value={`${Math.round(x.concentration.effectiveStocks)} stocks`} note={`of ${x.companies.length} companies held, if all were equal-sized`} />
            <Tile label="Top 10 companies" value={pct(x.concentration.top10)} note={`top 5 ${pct(x.concentration.top5)}, top 20 ${pct(x.concentration.top20)}`} />
            <Tile label="Largest single company" value={pct(x.companies[0].share)} note={x.companies[0].name} />
          </div>

          <section className="mb-8">
            <h2 className="mb-2 text-[15px] font-semibold text-stamp">If one of your biggest companies fell 20%</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 text-[13.5px]">
              {x.companies.slice(0, 6).map((c) => (
                <li key={c.isin} className="rounded-sm border border-rule bg-sheet px-3 py-2">
                  <div className="truncate font-medium" title={c.name}>
                    {c.name}
                  </div>
                  <div className="num text-left text-loss">−{money(c.valueInr * 0.2, 'INR', 0)}</div>
                  <div className="text-[12px] text-ink-muted">{pct(c.share * 0.2, 2)} of your equity</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-2 text-[15px] font-semibold text-stamp">Every company you own</h2>
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-[12px] text-ink-muted">
                  <th className="py-1 text-left font-medium">Company</th>
                  <th className="px-2 text-left font-medium">Sector</th>
                  <th className="px-2 text-right font-medium">Value</th>
                  <th className="px-2 text-right font-medium">Share</th>
                  <th className="px-2 text-right font-medium">Direct</th>
                  <th className="px-2 text-right font-medium">Through funds</th>
                </tr>
              </thead>
              <tbody>
                {x.companies.slice(0, 60).map((c) => {
                  const via = c.valueInr - c.directInr
                  const isOpen = open === c.isin
                  return (
                    <Fragment key={c.isin}>
                      <tr className="cursor-pointer border-b border-rule hover:bg-sheet" onClick={() => setOpen(isOpen ? null : c.isin)} aria-expanded={isOpen}>
                        <td className="py-1">
                          <span aria-hidden className="mr-1 inline-block w-3 text-ink-muted">
                            {c.via.length ? (isOpen ? '▾' : '▸') : ''}
                          </span>
                          {c.name}
                        </td>
                        <td className="px-2 text-ink-muted">{c.sector ?? ''}</td>
                        <td className="num px-2">{money(c.valueInr, 'INR', 0)}</td>
                        <td className="num px-2">
                          <span className="mr-2 inline-block h-1.5 rounded-sm bg-stamp align-middle" style={{ width: `${Math.min(60, c.share * 600)}px` }} aria-hidden />
                          {pct(c.share)}
                        </td>
                        <td className="num px-2">{c.directInr ? money(c.directInr, 'INR', 0) : '—'}</td>
                        <td className="num px-2">{via > 1 ? `${money(via, 'INR', 0)} (${c.via.length})` : '—'}</td>
                      </tr>
                      {isOpen &&
                        c.via.map((v) => (
                          <tr key={v.instrumentId} className="border-b border-rule text-[12.5px] text-ink-muted">
                            <td className="py-0.5 pl-6" colSpan={2}>
                              via {v.fund}
                            </td>
                            <td className="num px-2">{money(v.valueInr, 'INR', 0)}</td>
                            <td className="num px-2">{pct(v.valueInr / x.equityInr, 2)}</td>
                            <td colSpan={2} />
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {x.companies.length > 60 && <p className="mt-1 text-[12px] text-ink-muted">and {x.companies.length - 60} smaller ones.</p>}
          </section>

          {x.repeated.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-1 text-[15px] font-semibold text-stamp">Owned three or more ways</h2>
              <p className="mb-2 text-[13px] text-ink-muted">The same company through your shares and several funds: more of it than any one holding suggests.</p>
              <ul className="flex flex-wrap gap-2 text-[13px]">
                {x.repeated.slice(0, 20).map((r) => (
                  <li key={r.isin} className="rounded-sm border border-rule px-2 py-1">
                    {r.name} <span className="text-ink-muted">· {r.ways} ways · {lakhCrore(r.valueInr)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {x.overlap.funds.length > 1 && (
            <section className="mb-8">
              <h2 className="mb-1 text-[15px] font-semibold text-stamp">How much your funds repeat each other</h2>
              <p className="mb-2 text-[13px] text-ink-muted">
                The share of each pair’s equity in the same companies (the smaller weight of each common stock, added up). Above 50%, two funds own
                much the same thing.
              </p>
              <div className="overflow-x-auto">
                <table className="text-[12px]">
                  <thead>
                    <tr>
                      <th />
                      {x.overlap.funds.map((f, i) => (
                        <th key={f.instrumentId} className="px-1 pb-1 font-medium text-ink-muted" title={f.name}>
                          {i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {x.overlap.funds.map((f, i) => (
                      <tr key={f.instrumentId}>
                        <th scope="row" className="max-w-[280px] truncate pr-2 text-left font-normal" title={f.name}>
                          {i + 1}. {f.name}
                        </th>
                        {x.overlap.common[i].map((v, j) => (
                          <td
                            key={j}
                            className="num h-7 w-12 text-center"
                            title={i === j ? f.name : `${f.name} and ${x.overlap.funds[j].name}: ${pct(v)} in common`}
                            style={i === j ? { color: 'var(--ink-muted)' } : { background: `color-mix(in srgb, var(--stamp) ${Math.round(v * 90)}%, var(--sheet))`, color: v > 0.45 ? '#000' : undefined }}
                          >
                            {i === j ? '—' : pct(v, 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-sm border border-rule bg-sheet px-3 py-2">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div className="num text-left text-[20px] font-semibold">{value}</div>
      {note && <div className="text-[11.5px] text-ink-muted">{note}</div>}
    </div>
  )
}
