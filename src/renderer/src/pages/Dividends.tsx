import { useMemo } from 'react'
import { Columns } from '../components/charts'
import { DataTable } from '../components/DataTable'
import { ErrorNote, PageHeader } from '../components/Shell'
import { useDividends } from '../lib/api'
import { compactMoney, financialYear, money, percent, shortDate, units } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function Dividends() {
  const { scope } = useScope()
  const q = useDividends(scopePersonId(scope))
  const payments = q.data?.payments ?? []
  const outlook = q.data?.outlook ?? []
  const today = new Date().toISOString().slice(0, 10)

  const byFy = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) m.set(financialYear(p.exDate), (m.get(financialYear(p.exDate)) ?? 0) + p.netInr)
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
  }, [payments])

  const last12 = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
    return months.map((ym) => ({
      key: ym,
      label: MONTHS[Number(ym.slice(5)) - 1],
      value: payments.filter((p) => p.exDate.startsWith(ym)).reduce((s, p) => s + p.netInr, 0)
    }))
  }, [payments])

  const thisFy = financialYear(today)
  const sumFy = (fy: string) => byFy.find(([k]) => k === fy)?.[1] ?? 0
  const prevFy = `FY${String(Number(thisFy.slice(2)) - 1).padStart(2, '0')}`
  const nextYear = outlook.reduce((s, o) => s + o.nextYearInr, 0)
  const withheld = payments.reduce((s, p) => s + (p.currency === 'USD' ? p.withholding : 0), 0)
  const estimated = payments.some((p) => p.basis === 'ESTIMATED')

  return (
    <>
      <PageHeader title="Dividends" />
      <ErrorNote error={q.error} />

      {!q.isLoading && payments.length === 0 && outlook.length === 0 && (
        <p className="max-w-[72ch] py-8 text-ink-muted">
          No dividends yet. They appear once prices have refreshed: published dividends for your stocks and ETFs are
          matched to the units you held on each ex-date, and mutual fund payouts come from your CAMS/KFintech statement.
        </p>
      )}

      {(payments.length > 0 || outlook.length > 0) && (
        <>
          <dl className="grid max-w-[880px] grid-cols-2 gap-x-10 gap-y-4 @2xl:grid-cols-4">
            {[
              [`This year (${thisFy})`, money(sumFy(thisFy))],
              [`Last year (${prevFy})`, money(sumFy(prevFy))],
              ['Next 12 months, if repeated', money(nextYear)],
              ['All time', money(payments.reduce((s, p) => s + p.netInr, 0))]
            ].map(([k, v]) => (
              <div key={k} className="border-t border-rule-strong pt-2">
                <dt className="text-[13px] text-ink-muted">{k}</dt>
                <dd className="wide text-[24px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 max-w-[80ch] text-[13px] text-ink-muted">
            Amounts are after US withholding tax and in rupees.
            {estimated &&
              ' Stock and ETF dividends are worked out from the units you held the day before each ex-date.'}
            {withheld > 0 &&
              ` ${money(withheld, 'USD')} was withheld in the US; it can be claimed as a foreign tax credit (Form 67).`}
          </p>

          <div className="mt-10 grid grid-cols-1 gap-12 @7xl:grid-cols-2">
            <section aria-labelledby="fy">
              <h2 id="fy" className="wide mb-3 text-[19px] font-semibold">
                By financial year
              </h2>
              <Columns
                label="Dividend income by financial year"
                seriesLabel="Dividends"
                points={byFy.map(([fy, v]) => ({ key: fy, label: fy, value: v }))}
                format={(v) => money(v)}
                axisFormat={(v) => compactMoney(v)}
              />
            </section>
            <section aria-labelledby="months">
              <h2 id="months" className="wide mb-3 text-[19px] font-semibold">
                Last 12 months
              </h2>
              <Columns
                label="Dividend income by month, last 12 months"
                seriesLabel="Dividends"
                points={last12}
                format={(v) => money(v)}
                axisFormat={(v) => compactMoney(v)}
              />
            </section>
          </div>

          {outlook.length > 0 && (
            <section aria-labelledby="outlook" className="mt-12">
              <h2 id="outlook" className="wide mb-1 text-[19px] font-semibold">
                Who pays you
              </h2>
              <p className="mb-3 text-[14px] text-ink-muted">
                Last 12 months&rsquo; dividends per share, on the units you hold today.
              </p>
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                    <th className="py-1.5 font-medium">Holding</th>
                    <th className="num py-1.5 font-medium">Per share, 12 months</th>
                    <th className="num py-1.5 font-medium">Units</th>
                    <th className="num py-1.5 font-medium">Yield</th>
                    <th className="num py-1.5 font-medium">Next 12 months</th>
                  </tr>
                </thead>
                <tbody>
                  {outlook.map((o) => (
                    <tr key={o.instrumentId} className="border-b border-rule">
                      <td className="py-1.5">
                        {o.instrumentName}
                        <span className="ml-2 text-[13px] text-ink-muted">{o.symbol}</span>
                      </td>
                      <td className="num py-1.5">{money(o.trailingPerShare, o.currency, 2)}</td>
                      <td className="num py-1.5">{units(o.quantity)}</td>
                      <td className="num py-1.5">{percent(o.yieldOnPrice).replace('+', '')}</td>
                      <td className="num py-1.5 font-medium">{money(o.nextYearInr, 'INR', 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {payments.length > 0 && (
            <section aria-labelledby="list" className="mt-12">
              <h2 id="list" className="wide mb-3 text-[19px] font-semibold">
                Every payment
              </h2>
              <DataTable
                id="dividends"
                rows={payments}
                rowKey={(p, i) => `${p.instrumentId}:${p.exDate}:${p.accountName}:${i}`}
                initialSort={{ key: 'date', desc: true }}
                filterPlaceholder="Filter by holding, account or person"
                csvName="dividends"
                groups={[
                  { key: 'fy', label: 'Financial year', value: (p) => financialYear(p.exDate) },
                  { key: 'holding', label: 'Holding', value: (p) => p.instrumentName },
                  { key: 'person', label: 'Person', value: (p) => p.personName },
                  { key: 'account', label: 'Account', value: (p) => p.accountName }
                ]}
                columns={[
                  { key: 'date', header: 'Ex-date', value: (p) => p.exDate, render: (p) => shortDate(p.exDate), className: 'whitespace-nowrap' },
                  {
                    key: 'holding',
                    header: 'Holding',
                    always: true,
                    value: (p) => p.instrumentName,
                    render: (p) => (
                      <>
                        <div className="leading-snug">{p.instrumentName}</div>
                        <div className="condensed text-[12px] text-ink-muted">
                          <span className="mr-3">{p.accountName}</span>
                          {scope === 'family' && p.personName}
                        </div>
                      </>
                    )
                  },
                  { key: 'person', header: 'Person', hidden: true, value: (p) => p.personName },
                  { key: 'account', header: 'Account', hidden: true, value: (p) => p.accountName },
                  {
                    key: 'calc',
                    header: 'Units × per share',
                    align: 'right',
                    value: (p) => (p.perShare !== null && p.quantity !== null ? p.quantity * p.perShare : null),
                    render: (p) => (
                      <span className="text-ink-muted">
                        {p.perShare !== null && p.quantity !== null
                          ? `${units(p.quantity)} × ${money(p.perShare, p.currency, 2)}`
                          : 'From statement'}
                      </span>
                    )
                  },
                  {
                    key: 'withheld',
                    header: 'Withheld',
                    align: 'right',
                    value: (p) => p.withholding || null,
                    render: (p) => <span className="text-ink-muted">{p.withholding ? money(p.withholding, p.currency) : ''}</span>
                  },
                  {
                    key: 'net',
                    header: 'Received (₹)',
                    align: 'right',
                    sum: true,
                    value: (p) => Math.round(p.netInr * 100) / 100,
                    render: (p) => <span className="font-medium">{money(p.netInr, 'INR', 0)}</span>
                  }
                ]}
              />
            </section>
          )}
        </>
      )}
    </>
  )
}
