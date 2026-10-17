import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CapBand, DebtItem, ExposureReport } from '@shared/types'
import { HBars, StackBar } from '../components/charts'
import { Drill, type DrillRow } from '../components/Drill'
import { SectorInsightsSection } from '../components/SectorInsights'
import { ErrorNote, PageHeader } from '../components/Shell'
import { openExternal, useExposure, useSyncDisclosures } from '../lib/api'
import { compactMoney, money, shortDate } from '../lib/format'
import {
  CAP_COLORS,
  CAP_LABELS,
  CAP_ORDER,
  DEBT_TYPE_LABELS,
  MIX_COLORS,
  MIX_LABELS,
  MIX_ORDER,
  RATING_LABELS,
  RATING_ORDER
} from '../lib/labels'
import { scopePersonId, useScope } from '../lib/scope'

const NOT_BROKEN_DOWN = 'Not broken down'
const DIRECT = { label: 'Held directly', color: 'var(--series-1)' }
const VIA_FUNDS = { label: 'Through funds', color: 'var(--series-3)' }
const DEBT_SERIES = [{ label: 'Debt', color: 'var(--series-5)' }]
const AMFI_CAP_PAGE = 'https://www.amfiindia.com/otherdata/categorisation-of-stocks'
// Fixed per region (US matches the US-stocks colour elsewhere), never by rank.
const regionColor = (r: string) =>
  r === 'India' ? 'var(--series-1)' : r === 'US' ? 'var(--series-4)' : 'var(--series-other)'

const SOURCE_LABELS: Record<string, string> = {
  AMC_AUTO: 'downloaded from the fund house',
  AMC: 'from your imported file',
  YAHOO: 'from Yahoo Finance'
}

type Company = ExposureReport['companies'][number]
const companyRow = (c: Company, sub: string | null): DrillRow => ({
  key: c.isin ?? c.name,
  name: c.name,
  sub,
  directInr: c.directInr,
  viaFundsInr: c.viaFundsInr,
  valueInr: c.valueInr
})
const debtRow = (d: DebtItem): DrillRow => ({
  key: (d.isin ?? '') + d.name,
  name: d.name,
  sub: [d.issuer !== d.name ? d.issuer : null, d.ratingRaw ?? RATING_LABELS[d.rating].label].filter(Boolean).join(', '),
  directInr: d.directInr,
  viaFundsInr: d.viaFundsInr,
  valueInr: d.valueInr
})

type DebtPick = { by: 'type' | 'rating' | 'issuer'; key: string } | null

/**
 * A sector's companies, plus what funds report only as a sector total (US ETFs give Yahoo
 * Finance sector weights, not each company), so the rows add up to the bar.
 */
function sectorRows(e: ExposureReport, sector: string): DrillRow[] {
  const rows = e.companies.filter((c) => c.sector === sector).map((c) => companyRow(c, CAP_LABELS[c.cap].label))
  const bar = e.sectors.find((s) => s.sector === sector)
  const rest = (bar?.valueInr ?? 0) - rows.reduce((s, r) => s + r.valueInr, 0)
  if (bar && rest > bar.valueInr * 0.005)
    rows.push({
      key: 'sector-only',
      name: 'Inside funds that give only sector totals',
      sub: 'Mostly US ETFs, whose sector weights come from Yahoo Finance',
      directInr: 0,
      viaFundsInr: rest,
      valueInr: rest
    })
  return rows
}

export function Exposure() {
  const { scope } = useScope()
  const q = useExposure(scopePersonId(scope))
  const sync = useSyncDisclosures()
  const [sector, setSector] = useState<string | null>(null)
  const [cap, setCap] = useState<CapBand | null>(null)
  const [debtPick, setDebtPick] = useState<DebtPick>(null)
  const e = q.data

  if (!e || e.totalInr <= 0) {
    return (
      <>
        <PageHeader title="Sectors & exposure" />
        <ErrorNote error={q.error} />
        {!q.isLoading && <p className="py-8 text-ink-muted">No holdings yet. Import a statement to begin.</p>}
      </>
    )
  }

  const equityTotal = e.sectors.reduce((s, x) => s + x.valueInr, 0)
  const known = e.sectors.filter((s) => s.sector !== NOT_BROKEN_DOWN)
  const unknown = e.sectors.find((s) => s.sector === NOT_BROKEN_DOWN)
  const missing = e.funds.filter((f) => !f.holdingsAsOf)
  const pct = (v: number, of: number) => (of > 0 ? `${((v / of) * 100).toFixed(1)}%` : '—')
  const toggle = <T,>(cur: T | null, next: T, set: (v: T | null) => void) => set(cur === next ? null : next)

  return (
    <>
      <PageHeader title="Sectors & exposure" />
      <ErrorNote error={q.error} />
      <p className="mb-8 max-w-[72ch] text-ink-muted">
        Everything you own, with mutual funds and ETFs opened up into the companies and bonds they hold. A share of HDFC
        Bank held directly and the same bank inside three funds are added together here. Click a sector, a market-cap
        band or a debt group to see what is in it.
      </p>

      <section aria-labelledby="mix">
        <h2 id="mix" className="wide mb-3 text-[19px] font-semibold">
          Equity, debt and cash
        </h2>
        <StackBar
          label="Asset mix"
          format={(v) => money(v)}
          segments={MIX_ORDER.map((t) => ({
            key: t,
            label: MIX_LABELS[t],
            value: e.assetMix.find((m) => m.type === t)?.valueInr ?? 0,
            color: MIX_COLORS[t]
          }))}
        />
        <table className="mt-3 w-full max-w-[640px] text-[15px]">
          <tbody>
            {MIX_ORDER.map((t) => {
              const v = e.assetMix.find((m) => m.type === t)?.valueInr ?? 0
              if (!v) return null
              return (
                <tr key={t} className="border-b border-rule">
                  <td className="py-2">
                    <span
                      className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                      style={{ background: MIX_COLORS[t] }}
                    />
                    {MIX_LABELS[t]}
                  </td>
                  <td className="num py-2">{money(v)}</td>
                  <td className="num py-2">{pct(v, e.totalInr)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="sectors" className="mt-12">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 id="sectors" className="wide text-[19px] font-semibold">
            Equity by sector
          </h2>
          <span className="text-[14px] text-ink-muted">{money(equityTotal)} in equity</span>
        </div>
        <p className="mb-4 text-[14px] text-ink-muted">
          Share of your equity in each sector, after looking inside funds. Click a sector for its companies.
        </p>
        <HBars
          label="Equity by sector"
          series={[DIRECT, VIA_FUNDS]}
          format={(v) => `${compactMoney(v)}  ${pct(v, equityTotal)}`}
          rows={known.map((s) => ({ key: s.sector, label: s.sector, values: [s.directInr, s.viaFundsInr] }))}
          selected={sector}
          onSelect={(k) => toggle(sector, k, setSector)}
        />
        {sector && (
          <Drill
            id="sector-detail"
            title={sector}
            detail={`${pct(e.sectors.find((s) => s.sector === sector)?.valueInr ?? 0, equityTotal)} of your equity`}
            rows={sectorRows(e, sector)}
            groupLabel="Of sector"
            overallTotal={equityTotal}
            overallLabel="Of equity"
            empty="No individual companies: this sector comes from funds whose holdings weren't itemised."
            onClose={() => setSector(null)}
          />
        )}
        {unknown && (
          <p className="mt-4 rounded-md bg-warn-wash px-3 py-2 text-[14px] text-warn">
            {money(unknown.valueInr)} ({pct(unknown.valueInr, equityTotal)} of equity) sits in funds or NPS whose
            holdings aren&rsquo;t known yet, so it isn&rsquo;t in the sectors above.{' '}
            {missing.length > 0 && (
              <Link to="/import?kind=FUND_PORTFOLIO" className="underline">
                Import the fund houses&rsquo; monthly portfolio files
              </Link>
            )}
          </p>
        )}
      </section>

      <SectorInsightsSection personId={scopePersonId(scope)} />

      <MarketCap e={e} equityTotal={equityTotal} cap={cap} onCap={(c) => toggle(cap, c, setCap)} pct={pct} />

      <Debt e={e} pick={debtPick} onPick={setDebtPick} pct={pct} />

      <div className="mt-12 grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="companies">
          <h2 id="companies" className="wide mb-3 text-[19px] font-semibold">
            Biggest companies you own
          </h2>
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Company</th>
                <th className="num py-1.5 font-medium">Directly</th>
                <th className="num py-1.5 font-medium">Via funds</th>
                <th className="num py-1.5 font-medium">Total</th>
                <th className="num py-1.5 font-medium">Of equity</th>
              </tr>
            </thead>
            <tbody>
              {e.companies.slice(0, 25).map((c) => (
                <tr key={c.isin ?? c.name} className="border-b border-rule align-top">
                  <td className="py-1.5 pr-3">
                    <div className="leading-snug">{c.name}</div>
                    <div className="condensed text-[12px] text-ink-muted">
                      {[c.sector, CAP_LABELS[c.cap].label].filter(Boolean).join(', ')}
                    </div>
                  </td>
                  <td className="num py-1.5">{c.directInr ? compactMoney(c.directInr) : ''}</td>
                  <td className="num py-1.5">{c.viaFundsInr ? compactMoney(c.viaFundsInr) : ''}</td>
                  <td className="num py-1.5 font-medium">{compactMoney(c.valueInr)}</td>
                  <td className="num py-1.5">{pct(c.valueInr, equityTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="flex flex-col gap-12">
          <section aria-labelledby="geo">
            <h2 id="geo" className="wide mb-3 text-[19px] font-semibold">
              Where in the world
            </h2>
            <StackBar
              label="By country"
              format={(v) => money(v)}
              segments={e.geography.map((g) => ({
                key: g.region,
                label: g.region,
                value: g.valueInr,
                color: regionColor(g.region)
              }))}
            />
            <table className="mt-3 w-full text-[15px]">
              <tbody>
                {e.geography.map((g) => (
                  <tr key={g.region} className="border-b border-rule">
                    <td className="py-1.5">
                      <span
                        className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                        style={{ background: regionColor(g.region) }}
                      />
                      {g.region}
                    </td>
                    <td className="num py-1.5">{compactMoney(g.valueInr)}</td>
                    <td className="num py-1.5">{pct(g.valueInr, e.totalInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="funds">
            <h2 id="funds" className="wide mb-3 text-[19px] font-semibold">
              Funds opened up
            </h2>
            <ul className="border-t border-rule text-[14px]">
              {e.funds.map((f) => (
                <li
                  key={f.instrumentId}
                  className="flex items-baseline justify-between gap-3 border-b border-rule py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate" title={f.name}>
                      {f.name}
                    </span>
                    <span className={'text-[12px] ' + (f.holdingsAsOf ? 'text-ink-muted' : 'text-warn')}>
                      {f.holdingsAsOf
                        ? `Holdings as of ${shortDate(f.holdingsAsOf)}, ${SOURCE_LABELS[f.source ?? ''] ?? f.source}`
                        : 'Holdings not found yet'}
                    </span>
                  </span>
                  <span className="num shrink-0">{compactMoney(f.valueInr)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] text-ink-muted">
              Fund houses publish every scheme&rsquo;s holdings each month. The app downloads them automatically
              {sync.isPending ? '…' : '.'}{' '}
              <button
                className="text-stamp underline disabled:opacity-50"
                disabled={sync.isPending}
                onClick={() => sync.mutate([false])}
              >
                {sync.isPending ? 'Checking fund houses' : 'Check fund houses now'}
              </button>
              {missing.length > 0 && (
                <>
                  {' '}
                  If a fund house can&rsquo;t be read automatically, see{' '}
                  <Link to="/settings" className="text-stamp underline">
                    Settings
                  </Link>{' '}
                  or{' '}
                  <Link to="/import?kind=FUND_PORTFOLIO" className="text-stamp underline">
                    import its file
                  </Link>
                  .
                </>
              )}
            </p>
            <ErrorNote error={sync.error} />
          </section>
        </div>
      </div>
    </>
  )
}

// ---------------- large, mid and small cap ----------------

function MarketCap({
  e,
  equityTotal,
  cap,
  onCap,
  pct
}: {
  e: ExposureReport
  equityTotal: number
  cap: CapBand | null
  onCap: (c: CapBand) => void
  pct: (v: number, of: number) => string
}) {
  const bands = CAP_ORDER.map((c) => e.marketCap.find((m) => m.cap === c)).filter(
    (b): b is ExposureReport['marketCap'][number] => !!b && b.valueInr > 0
  )
  if (bands.length === 0) return null
  const listed = bands.filter((b) => b.cap === 'LARGE' || b.cap === 'MID' || b.cap === 'SMALL')
  return (
    <section aria-labelledby="caps" className="mt-12">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="caps" className="wide text-[19px] font-semibold">
          Large, mid and small cap
        </h2>
        {listed.length > 0 && (
          <span className="text-[14px] text-ink-muted">
            {listed.map((b) => `${CAP_LABELS[b.cap].label} ${pct(b.valueInr, equityTotal)}`).join(', ')}
          </span>
        )}
      </div>
      <p className="mb-4 text-[14px] text-ink-muted">
        SEBI&rsquo;s size bands, from{' '}
        <button className="text-stamp underline" onClick={() => void openExternal(AMFI_CAP_PAGE)}>
          AMFI&rsquo;s list
        </button>{' '}
        {e.capListPeriod
          ? `for the six months to ${shortDate(e.capListPeriod)}`
          : '(it loads with the next daily refresh; until then Indian shares show as unranked)'}
        . Click a band for its companies.
      </p>
      <StackBar
        label="Equity by market cap"
        format={(v) => money(v)}
        segments={bands.map((b) => ({
          key: b.cap,
          label: CAP_LABELS[b.cap].label,
          value: b.valueInr,
          color: CAP_COLORS[b.cap]
        }))}
      />
      <table className="mt-3 w-full text-[15px]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
            <th className="py-1.5 font-medium">Band</th>
            <th className="num py-1.5 font-medium">Directly</th>
            <th className="num py-1.5 font-medium">Via funds</th>
            <th className="num py-1.5 font-medium">Total</th>
            <th className="num py-1.5 font-medium">Of equity</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr
              key={b.cap}
              tabIndex={0}
              role="button"
              aria-pressed={cap === b.cap}
              onClick={() => onCap(b.cap)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  onCap(b.cap)
                }
              }}
              className={
                'cursor-pointer border-b border-rule hover:bg-sheet/70 ' +
                (cap === b.cap ? 'bg-stamp-wash shadow-[inset_3px_0_0_var(--stamp)]' : '')
              }
            >
              <td className="py-2 pl-2">
                <span
                  className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                  style={{ background: CAP_COLORS[b.cap] }}
                />
                {CAP_LABELS[b.cap].label}
                <span className="ml-2 text-[12px] text-ink-muted">{CAP_LABELS[b.cap].detail}</span>
              </td>
              <td className="num py-2">{b.directInr ? compactMoney(b.directInr) : ''}</td>
              <td className="num py-2">{b.viaFundsInr ? compactMoney(b.viaFundsInr) : ''}</td>
              <td className="num py-2 font-medium">{compactMoney(b.valueInr)}</td>
              <td className="num py-2">{pct(b.valueInr, equityTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cap && (
        <Drill
          id="cap-detail"
          title={CAP_LABELS[cap].label}
          detail={`${pct(bands.find((b) => b.cap === cap)?.valueInr ?? 0, equityTotal)} of your equity`}
          rows={e.companies.filter((c) => c.cap === cap).map((c) => companyRow(c, c.sector))}
          groupLabel="Of band"
          overallTotal={equityTotal}
          overallLabel="Of equity"
          empty="No individual companies: this is fund or NPS equity whose holdings aren't known yet."
          onClose={() => onCap(cap)}
        />
      )}
    </section>
  )
}

// ---------------- debt ----------------

function Debt({
  e,
  pick,
  onPick,
  pct
}: {
  e: ExposureReport
  pick: DebtPick
  onPick: (p: DebtPick) => void
  pct: (v: number, of: number) => string
}) {
  const d = e.debt
  if (d.totalInr <= 0) return null
  const choose = (by: 'type' | 'rating' | 'issuer', key: string) =>
    onPick(pick && pick.by === by && pick.key === key ? null : { by, key })

  const issuers = new Map<string, number>()
  for (const i of d.items) issuers.set(i.issuer, (issuers.get(i.issuer) ?? 0) + i.valueInr)
  const issuerList = [...issuers].sort((a, b) => b[1] - a[1])
  const share = (ratings: string[]) =>
    d.ratings.filter((r) => ratings.includes(r.rating)).reduce((s, r) => s + r.valueInr, 0)
  const safest = share(['SOVEREIGN', 'AAA'])
  const lower = share(['AA', 'A_BELOW'])
  // The biggest single company or bank you are lending to (the government and EPFO aside).
  const lenders = new Map<string, number>()
  for (const i of d.items)
    if (i.rating !== 'SOVEREIGN' && i.type !== 'NOT_BROKEN_DOWN')
      lenders.set(i.issuer, (lenders.get(i.issuer) ?? 0) + i.valueInr)
  const [topIssuer, topValue] = [...lenders].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
  const ratings = RATING_ORDER.map((r) => d.ratings.find((x) => x.rating === r)).filter(
    (x): x is NonNullable<typeof x> => !!x && x.valueInr > 0
  )

  const picked = pick
    ? d.items.filter((i) => (pick.by === 'type' ? i.type : pick.by === 'rating' ? i.rating : i.issuer) === pick.key)
    : []
  const pickTitle = !pick
    ? ''
    : pick.by === 'type'
      ? DEBT_TYPE_LABELS[pick.key as keyof typeof DEBT_TYPE_LABELS]
      : pick.by === 'rating'
        ? RATING_LABELS[pick.key as keyof typeof RATING_LABELS].label
        : pick.key

  return (
    <section aria-labelledby="debt" className="mt-12">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="debt" className="wide text-[19px] font-semibold">
          Debt
        </h2>
        <span className="text-[14px] text-ink-muted">
          {money(d.totalInr)} in debt, {pct(d.totalInr, e.totalInr)} of everything
        </span>
      </div>
      <p className="mb-4 max-w-[80ch] text-[14px] text-ink-muted">
        Bonds, deposits, EPF and PPF you hold directly, and the bonds and money-market paper inside your funds. Click a
        group or an issuer to see each paper.
      </p>

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-[13px] text-ink-muted">Sovereign or AAA</dt>
          <dd className="num text-left text-[22px] font-semibold">{pct(safest, d.totalInr)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-muted">Rated AA or lower</dt>
          <dd className={'num text-left text-[22px] font-semibold ' + (lower / d.totalInr > 0.2 ? 'text-warn' : '')}>
            {pct(lower, d.totalInr)}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-muted">Issuers</dt>
          <dd className="num text-left text-[22px] font-semibold">{issuerList.length}</dd>
        </div>
        {topIssuer && (
          <div className="min-w-0">
            <dt className="text-[13px] text-ink-muted">Largest company or bank</dt>
            <dd className="truncate text-[15px] font-semibold" title={topIssuer}>
              {topIssuer} <span className="num font-normal text-ink-muted">{pct(topValue, d.totalInr)}</span>
            </dd>
          </div>
        )}
      </dl>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[15px] font-semibold">By type</h3>
          <HBars
            label="Debt by type"
            series={DEBT_SERIES}
            format={(v) => `${compactMoney(v)}  ${pct(v, d.totalInr)}`}
            rows={d.types.map((t) => ({ key: t.type, label: DEBT_TYPE_LABELS[t.type], values: [t.valueInr] }))}
            selected={pick?.by === 'type' ? pick.key : null}
            onSelect={(k) => choose('type', k)}
          />
        </div>
        <div>
          <h3 className="mb-2 text-[15px] font-semibold">By credit rating</h3>
          <HBars
            label="Debt by credit rating"
            series={DEBT_SERIES}
            format={(v) => `${compactMoney(v)}  ${pct(v, d.totalInr)}`}
            rows={ratings.map((r) => ({
              key: r.rating,
              label: RATING_LABELS[r.rating].label,
              values: [r.valueInr]
            }))}
            selected={pick?.by === 'rating' ? pick.key : null}
            onSelect={(k) => choose('rating', k)}
          />
        </div>
      </div>

      <h3 className="mt-8 mb-2 text-[15px] font-semibold">Who owes you the most</h3>
      <HBars
        label="Debt by issuer"
        series={DEBT_SERIES}
        format={(v) => `${compactMoney(v)}  ${pct(v, d.totalInr)}`}
        rows={issuerList.slice(0, 12).map(([name, v]) => ({ key: name, label: name, values: [v] }))}
        selected={pick?.by === 'issuer' ? pick.key : null}
        onSelect={(k) => choose('issuer', k)}
      />

      {pick && (
        <Drill
          id="debt-detail"
          title={pickTitle}
          detail={`${pct(
            picked.reduce((s, i) => s + i.valueInr, 0),
            d.totalInr
          )} of your debt`}
          rows={picked.map(debtRow)}
          groupLabel="Of group"
          overallTotal={d.totalInr}
          overallLabel="Of debt"
          onClose={() => onPick(null)}
        />
      )}
    </section>
  )
}
