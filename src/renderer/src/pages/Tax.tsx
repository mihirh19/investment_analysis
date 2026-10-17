import { useMemo, useState } from 'react'
import type { OpenLot, RealizedGain, TaxKind, TaxReport } from '@shared/types'
import { StackBar } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { StackedColumns } from '../components/viz'
import { DataTable, downloadCsv } from '../components/DataTable'
import { useTax } from '../lib/api'
import {
  compactMoney,
  money as money2,
  shortDate,
  signedMoney as signed2,
  toneClass,
  units as fmtUnits
} from '../lib/format'
import { stagger } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'

const KIND_LABELS: Record<TaxKind, string> = {
  '111A': 'Short-term, listed equity',
  '112A': 'Long-term, listed equity',
  SLAB: 'At your slab rate',
  LT_OTHER: 'Long-term, other'
}

// Whole rupees throughout: tax figures don't need paise.
const money = (v: number | null | undefined) => money2(v, 'INR', 0)
const signedMoney = (v: number | null | undefined) =>
  v !== null && v !== undefined && Math.abs(v) < 0.5
    ? money(0)
    : signed2(v === null || v === undefined ? v : Math.round(v))

const rate = (r: number | null) => (r === null ? 'slab' : `${+(r * 100).toFixed(1)}%`)

function Section({
  id,
  title,
  note,
  children
}: {
  id: string
  title: string
  note?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note ? <p className="mt-0.5 mb-4 max-w-[80ch] text-[14px] text-ink-muted">{note}</p> : <div className="mb-4" />}
      {children}
    </section>
  )
}

const Th = ({ children, num = false }: { children?: React.ReactNode; num?: boolean }) => (
  <th className={(num ? 'num ' : '') + 'py-1.5 font-medium'}>{children}</th>
)

// ---------------- CSV ----------------

const download = downloadCsv

/** Columns of Schedule 112A in the ITR forms (one row per sale lot). */
function export112A(fy: string, person: string, sales: RealizedGain[]) {
  const rows = sales.filter((s) => s.kind === '112A')
  download(`Schedule-112A-${fy}-${person}.csv`, [
    [
      'Share/Unit acquired (1a. On or before 31 Jan 2018, 1b. After 31 Jan 2018)',
      'ISIN Code',
      'Name of the Share/Unit',
      'No. of Shares/Units',
      'Sale-price per Share/Unit',
      'Full Value of Consideration',
      'Cost of acquisition without indexation',
      'Cost of acquisition',
      'If the long term capital asset was acquired before 01.02.2018, Fair Market Value per share/unit as on 31.01.2018',
      'Total Fair Market Value of capital asset as per section 55(2)(ac)',
      'Expenditure wholly and exclusively in connection with transfer',
      'Total deductions',
      'Balance',
      'Date of purchase',
      'Date of sale'
    ],
    ...rows.map((s) => [
      s.buyDate <= '2018-01-31' ? '1a' : '1b',
      s.isin,
      s.name,
      s.units,
      s.proceedsInr / s.units,
      s.proceedsInr,
      s.costInr,
      s.actualCostInr,
      s.fmv2018,
      s.fmv2018 !== null ? s.fmv2018 * s.units : null,
      0,
      s.costInr,
      s.gainInr,
      s.buyDate,
      s.sellDate
    ])
  ])
}

// ---------------- page ----------------

export function Tax() {
  const { scope } = useScope()
  const q = useTax(scopePersonId(scope))
  const t = q.data

  if (!t) {
    return (
      <>
        <PageHeader title="Tax" />
        <ErrorNote error={q.error} />
        {q.isLoading && <PageSkeleton />}
      </>
    )
  }
  const hasData = t.realized.length > 0 || t.lots.length > 0
  return (
    // Every table cell after the first gets the same gap from its neighbour.
    <div className="[&_td+td]:pl-4 [&_th+th]:pl-4">
      <PageHeader title="Tax" />
      <ErrorNote error={q.error} />
      <p className="max-w-[86ch] text-[14px] text-ink-muted">
        Capital gains worked out from your trade history, sale by sale, oldest units first (as the tax rules require).
        These are estimates to plan with, not a tax return: rates are before the 4% cess and any surcharge, gains at
        your slab rate are shown but not taxed here, and older losses carried forward aren't included.
      </p>
      {!hasData ? (
        <p className="py-8 text-ink-muted">
          No trades yet. Import a Zerodha tradebook, Groww orders or a CAS with mutual fund transactions to see your
          gains by holding period.
        </p>
      ) : (
        <TaxBody t={t} family={scope === 'family'} />
      )}
      {t.warnings.length > 0 && (
        <ul className="mt-10 space-y-1.5 rounded-md border border-rule bg-warn-wash px-4 py-3 text-[13px] text-warn">
          {t.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {t.estimateOnly.length > 0 && (
        <Section
          id="estimate-only"
          title="Not included: no purchase history"
          note="A CAS gives units and value, and a holdings file gives the buy price, but neither says when each unit was bought, which decides short or long term. The file that adds the dates is shown for each holding. Or open a holding and enter when it was first bought."
        >
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <Th>Holding</Th>
                {scope === 'family' && <Th>Person</Th>}
                <Th num>Value</Th>
                <Th num>Gain, if the buy price is known</Th>
                <Th>What to import</Th>
              </tr>
            </thead>
            <tbody>
              {t.estimateOnly.slice(0, 60).map((e, i) => (
                <tr key={i} className="border-b border-rule">
                  <td className="py-1.5">{e.name}</td>
                  {scope === 'family' && <td className="py-1.5 text-ink-muted">{e.personName}</td>}
                  <td className="num py-1.5">{money(e.valueInr)}</td>
                  <td className={`num py-1.5 ${toneClass(e.gainInr)}`}>{signedMoney(e.gainInr)}</td>
                  <td className="max-w-[44ch] py-1.5 pl-6 text-[13px] text-ink-muted">{e.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

function TaxBody({ t, family }: { t: TaxReport; family: boolean }) {
  const fys = useMemo(() => [...new Set(t.years.map((y) => y.fy))].sort().reverse(), [t])
  const [fy, setFy] = useState<string>(fys.includes(t.currentFy) ? t.currentFy : (fys[0] ?? t.currentFy))
  const thisYear = t.years.filter((y) => y.current)
  const sum = (k: 'shortTermGain' | 'longTermGain' | 'fixedRateTax' | 'slabGain') =>
    thisYear.reduce((s, y) => s + y[k], 0)
  const left = t.exemptionLeft.reduce((s, e) => s + e.left, 0)
  const limit = t.exemptionLeft.reduce((s, e) => s + e.limit, 0)

  const chartYears = useMemo(() => {
    const by = new Map<string, { st: number; lt: number }>()
    for (const y of t.years) {
      const r = by.get(y.fy) ?? { st: 0, lt: 0 }
      r.st += Math.max(0, y.shortTermGain)
      r.lt += Math.max(0, y.longTermGain)
      by.set(y.fy, r)
    }
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).slice(-8)
  }, [t])

  const sales = t.realized.filter((s) => s.fy === fy)
  const lossesByHolding = useMemo(() => groupLots(t.losses), [t])

  return (
    <>
      <section aria-label={`This financial year, ${t.currentFy}`} className="mt-8">
        <h2 className="mb-3 text-[15px] font-semibold text-ink-muted">
          This financial year ({t.currentFy}), sales so far
        </h2>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
          {(
            [
              [
                'Short-term gains',
                signedMoney(sum('shortTermGain')),
                `${money(sum('slabGain'))} of it at your slab rate`
              ],
              ['Long-term gains', signedMoney(sum('longTermGain')), 'after setting off losses'],
              [
                'Tax-free long-term left',
                money(left),
                family && t.exemptionLeft.length > 1
                  ? `of ${money(limit)}: ₹1.25 lakh for each person`
                  : `of ${money(limit)} on listed shares & equity funds`
              ],
              ['Estimated tax (fixed rates)', money(sum('fixedRateTax')), 'before 4% cess; slab gains not included']
            ] as const
          ).map(([k, v, sub], i) => (
            <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 60)}>
              <dt className="text-[13px] text-ink-muted">{k}</dt>
              <dd className="wide text-[20px] font-semibold">{v}</dd>
              <dd className="text-[12px] text-ink-muted">{sub}</dd>
            </div>
          ))}
        </dl>
        {t.exemptionLeft.length > 0 && (
          <div className="mt-6 grid max-w-[720px] gap-3">
            {t.exemptionLeft.map((e) => (
              <div key={e.personId}>
                <div className="mb-1 flex justify-between text-[13px]">
                  <span>{family ? `${e.personName}: ` : ''}₹1.25 lakh yearly exemption on long-term equity gains</span>
                  <span className="num text-ink-muted">
                    {money(e.limit - e.left)} used · {money(e.left)} left
                  </span>
                </div>
                <StackBar
                  label={`${e.personName} exemption used`}
                  format={(v) => money(v)}
                  segments={[
                    { key: 'used', label: 'Used', value: e.limit - e.left, color: 'var(--series-4)' },
                    { key: 'left', label: 'Left', value: e.left, color: 'var(--rule-strong)' }
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <Section
        id="ideas"
        title="Ideas before 31 March"
        note="Suggestions from your open lots. Selling resets the buy price and date of whatever you buy back; check exit loads and charges first."
      >
        <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[15px] font-semibold">Book tax-free gains</h3>
            <p className="mb-2 text-[13px] text-ink-muted">
              Selling these (oldest units first) and buying back the same day uses this year's unused exemption, so the
              gain never gets taxed.
            </p>
            {t.harvest.length ? (
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                    <Th>Sell</Th>
                    <Th num>Units</Th>
                    <Th num>About</Th>
                    <Th num>Tax-free gain</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.harvest.map((h, i) => (
                    <tr key={i} className="border-b border-rule">
                      <td className="py-1.5">
                        {h.name}
                        <div className="text-[12px] text-ink-muted">
                          {family ? `${h.personName} · ` : ''}
                          {h.accountName}
                        </div>
                      </td>
                      <td className="num py-1.5">{fmtUnits(Math.floor(h.units * 1000) / 1000)}</td>
                      <td className="num py-1.5">{money(h.valueInr)}</td>
                      <td className="num py-1.5 text-gain">{signedMoney(h.gainInr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[14px] text-ink-muted">
                {left < 1 ? "This year's exemption is already used." : 'No long-term equity lots in profit.'}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-[15px] font-semibold">Wait a little: turning long-term soon</h3>
            <p className="mb-2 text-[13px] text-ink-muted">
              Lots in profit that become long-term within 60 days. Selling after that date is taxed at the lower
              long-term rate.
            </p>
            {t.soonLongTerm.length ? (
              <LotTable lots={t.soonLongTerm.slice(0, 12)} family={family} showLongFrom />
            ) : (
              <p className="text-[14px] text-ink-muted">Nothing in profit turns long-term in the next 60 days.</p>
            )}
          </div>

          <div className="xl:col-span-2">
            <h3 className="mb-1 text-[15px] font-semibold">Losses you could book</h3>
            <p className="mb-2 text-[13px] text-ink-muted">
              Selling these books a loss: a short-term loss can be set off against any capital gain, a long-term loss
              against long-term gains; what's left carries forward for eight years if you file on time.
            </p>
            {lossesByHolding.length ? (
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                    <Th>Holding</Th>
                    <Th num>Units at a loss</Th>
                    <Th num>Short-term loss</Th>
                    <Th num>Long-term loss</Th>
                  </tr>
                </thead>
                <tbody>
                  {lossesByHolding.slice(0, 12).map((h) => (
                    <tr key={h.key} className="border-b border-rule">
                      <td className="py-1.5">
                        {h.name}
                        {family && <span className="ml-2 text-[12px] text-ink-muted">{h.personName}</span>}
                      </td>
                      <td className="num py-1.5">{fmtUnits(h.units)}</td>
                      <td className={`num py-1.5 ${h.st ? 'text-loss' : 'text-ink-muted'}`}>
                        {h.st ? signedMoney(h.st) : '—'}
                      </td>
                      <td className={`num py-1.5 ${h.lt ? 'text-loss' : 'text-ink-muted'}`}>
                        {h.lt ? signedMoney(h.lt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[14px] text-ink-muted">No open lots at a loss.</p>
            )}
          </div>
        </div>
      </Section>

      <Section
        id="by-year"
        title="Gains by financial year"
        note="Realized gains after setting off that year's losses, before the exemption."
      >
        {chartYears.length > 0 && (
          <StackedColumns
            label="Realized gains by financial year"
            periods={chartYears.map(([fy, v]) => ({ key: fy, label: fy, values: [v.st, v.lt] }))}
            series={[
              { label: 'Short-term', color: 'var(--series-2)' },
              { label: 'Long-term', color: 'var(--series-1)' }
            ]}
            format={(v) => money(v)}
            axisFormat={(v) => compactMoney(v)}
            height={200}
          />
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <Th>Year</Th>
                {family && <Th>Person</Th>}
                <Th num>Short-term</Th>
                <Th num>Long-term</Th>
                <Th num>Exempt</Th>
                <Th num>At slab</Th>
                <Th num>Tax, fixed rates</Th>
                <Th num>Loss to carry forward</Th>
              </tr>
            </thead>
            <tbody>
              {t.years.map((y) => (
                <tr key={`${y.fy}-${y.personId}`} className="border-b border-rule">
                  <td className="py-1.5">
                    {y.fy}
                    {y.current && <span className="ml-1.5 text-[12px] text-ink-muted">so far</span>}
                  </td>
                  {family && <td className="py-1.5 text-ink-muted">{y.personName}</td>}
                  <td className={`num py-1.5 ${toneClass(y.shortTermGain)}`}>{signedMoney(y.shortTermGain)}</td>
                  <td className={`num py-1.5 ${toneClass(y.longTermGain)}`}>{signedMoney(y.longTermGain)}</td>
                  <td className="num py-1.5">{money(y.exemptionUsed)}</td>
                  <td className="num py-1.5">{money(y.slabGain)}</td>
                  <td className="num py-1.5 font-semibold">{money(y.fixedRateTax)}</td>
                  <td className="num py-1.5 text-ink-muted">
                    {y.carryForward.shortTerm + y.carryForward.longTerm > 0
                      ? money(y.carryForward.shortTerm + y.carryForward.longTerm)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="unrealized"
        title="If you sold everything today"
        note="Gains on the units you still hold, split by how long each lot has been held."
      >
        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
          {(
            [
              ['Short-term gains', t.unrealized.shortTermGain],
              ['Short-term losses', t.unrealized.shortTermLoss],
              ['Long-term gains', t.unrealized.longTermGain],
              ['Long-term losses', t.unrealized.longTermLoss]
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="border-t border-rule-strong pt-2">
              <dt className="text-[13px] text-ink-muted">{k}</dt>
              <dd className={`wide text-[20px] font-semibold ${toneClass(v)}`}>{signedMoney(v)}</dd>
            </div>
          ))}
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer text-[14px] text-stamp">Every open lot ({t.lots.length})</summary>
          <div className="mt-2 max-h-[420px] overflow-y-auto">
            <LotTable lots={t.lots} family={family} showLongFrom />
          </div>
        </details>
      </Section>

      <Section
        id="sales"
        title="Sales"
        note="Each sale, matched to the purchases it used up. Units bought before 1 Feb 2018 use the 31 Jan 2018 price where that is higher (grandfathering)."
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            Financial year
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="rounded border border-rule-strong bg-sheet px-2 py-1 text-[14px]"
            >
              {fys.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          {[...new Set(sales.filter((s) => s.kind === '112A').map((s) => s.personName))].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                export112A(
                  fy,
                  p,
                  sales.filter((s) => s.personName === p)
                )
              }
              className="rounded border border-rule-strong px-3 py-1 text-[14px] hover:bg-sheet"
            >
              Schedule 112A{family ? ` for ${p}` : ''} (CSV)
            </button>
          ))}
        </div>
        <DataTable
          id="tax-sales"
          key={fy}
          rows={sales}
          rowKey={(s, i) => `${s.instrumentId}:${s.buyDate}:${s.sellDate}:${i}`}
          initialSort={{ key: 'sold', desc: true }}
          filterPlaceholder="Filter by holding or person"
          csvName={`capital-gains-${fy}`}
          maxHeight={520}
          empty={`No sales in ${fy}.`}
          groups={[
            { key: 'holding', label: 'Holding', value: (s) => s.name },
            { key: 'person', label: 'Person', value: (s) => s.personName },
            { key: 'kind', label: 'Taxed as', value: (s) => KIND_LABELS[s.kind] },
            { key: 'term', label: 'Short or long term', value: (s) => (s.term === 'LT' ? 'Long-term' : 'Short-term') }
          ]}
          columns={[
            { key: 'holding', header: 'Holding', always: true, value: (s) => s.name },
            { key: 'isin', header: 'ISIN', hidden: true, value: (s) => s.isin },
            {
              key: 'person',
              header: 'Person',
              hidden: !family,
              value: (s) => s.personName,
              className: 'text-ink-muted'
            },
            { key: 'account', header: 'Account', hidden: true, value: (s) => s.accountName },
            {
              key: 'bought',
              header: 'Bought',
              value: (s) => s.buyDate,
              render: (s) => shortDate(s.buyDate),
              className: 'whitespace-nowrap'
            },
            {
              key: 'sold',
              header: 'Sold',
              value: (s) => s.sellDate,
              render: (s) => shortDate(s.sellDate),
              className: 'whitespace-nowrap'
            },
            { key: 'units', header: 'Units', align: 'right', value: (s) => s.units, render: (s) => fmtUnits(s.units) },
            {
              key: 'cost',
              header: 'Cost',
              align: 'right',
              sum: true,
              value: (s) => Math.round(s.costInr),
              render: (s) => (
                <>
                  {money(s.costInr)}
                  {s.grandfathered && (
                    <span className="ml-1 text-[11px] text-ink-muted" title={`Actual cost ${money(s.actualCostInr)}`}>
                      GF
                    </span>
                  )}
                </>
              )
            },
            {
              key: 'actual',
              header: 'Actual cost',
              hidden: true,
              align: 'right',
              value: (s) => Math.round(s.actualCostInr),
              render: (s) => money(s.actualCostInr)
            },
            {
              key: 'proceeds',
              header: 'Sale value',
              align: 'right',
              sum: true,
              value: (s) => Math.round(s.proceedsInr),
              render: (s) => money(s.proceedsInr)
            },
            {
              key: 'gain',
              header: 'Gain',
              align: 'right',
              sum: true,
              value: (s) => Math.round(s.gainInr),
              render: (s) => <span className={toneClass(s.gainInr)}>{signedMoney(s.gainInr)}</span>
            },
            {
              key: 'kind',
              header: 'Taxed as',
              value: (s) => `${KIND_LABELS[s.kind]}, ${rate(s.rate)}`,
              className: 'text-[13px] text-ink-muted'
            }
          ]}
        />
      </Section>
    </>
  )
}

function LotTable({
  lots,
  family,
  showLongFrom = false
}: {
  lots: OpenLot[]
  family: boolean
  showLongFrom?: boolean
}) {
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
          <Th>Holding</Th>
          {family && <Th>Person</Th>}
          <Th>Bought</Th>
          <Th num>Units</Th>
          <Th num>Gain</Th>
          <Th>{showLongFrom ? 'Long-term from' : 'Term'}</Th>
        </tr>
      </thead>
      <tbody>
        {lots.map((l, i) => (
          <tr key={i} className="border-b border-rule">
            <td className="py-1.5">{l.name}</td>
            {family && <td className="py-1.5 text-ink-muted">{l.personName}</td>}
            <td className="py-1.5 whitespace-nowrap">
              {l.estimatedFrom === 'OVER_A_YEAR'
                ? 'Over a year ago'
                : l.estimatedFrom === 'WITHIN_A_YEAR'
                  ? 'In the last year'
                  : l.estimatedFrom === 'HELD_SINCE'
                    ? `Since ${shortDate(l.buyDate)}`
                    : shortDate(l.buyDate)}
            </td>
            <td className="num py-1.5">{fmtUnits(l.units)}</td>
            <td className={`num py-1.5 ${toneClass(l.gainInr)}`}>{signedMoney(l.gainInr)}</td>
            <td className="py-1.5 text-[13px] text-ink-muted">
              {l.term === 'LT' ? 'Long-term now' : l.longTermFrom ? shortDate(l.longTermFrom) : 'Never (slab rate)'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function groupLots(lots: OpenLot[]) {
  const m = new Map<string, { key: string; name: string; personName: string; units: number; st: number; lt: number }>()
  for (const l of lots) {
    const key = `${l.accountId}:${l.instrumentId}`
    const g = m.get(key) ?? { key, name: l.name, personName: l.personName, units: 0, st: 0, lt: 0 }
    g.units += l.units
    if (l.term === 'ST') g.st += l.gainInr
    else g.lt += l.gainInr
    m.set(key, g)
  }
  return [...m.values()].sort((a, b) => a.st + a.lt - (b.st + b.lt))
}
