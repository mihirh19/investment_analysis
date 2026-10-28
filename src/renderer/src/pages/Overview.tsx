import { Link } from 'react-router-dom'
import { GROUP_OF, type ChartGroup } from '@shared/assets'
import { PLATFORM_LABELS, type Platform } from '@shared/types'
import { StackBar } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { AreaStack, Donut } from '../components/viz'
import { useAnalysis, useExposure, useFx, useHealth, useHoldings, usePersons } from '../lib/api'
import { PeriodPicker, periodStartIndex, periodTitle, usePeriod } from '../lib/period'
import { PageSkeleton } from '../components/Skeleton'
import { ReportButton } from '../components/ReportButton'
import { useLiveHoldings } from '../lib/live'
import { Sparkline } from '../components/viz'
import type { HealthReport } from '@shared/types'
import { compactMoney, lakhCrore, money, percent, shortDate, signedMoney, timeAgo, toneClass } from '../lib/format'
import { GROUP_COLORS, GROUP_LABELS, MIX_COLORS, MIX_LABELS, MIX_ORDER } from '../lib/labels'
import { stagger, useCountUp } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'
import { groupBy, totals } from '../lib/summary'

const GROUP_ORDER: ChartGroup[] = ['STOCKS', 'FUNDS', 'US', 'GOLD', 'DEBT', 'RETIREMENT', 'PROPERTY', 'CRYPTO', 'OTHER']

export function Overview() {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const holdingsQuery = useHoldings(scopePersonId(scope))
  // Net worth and the day's change follow live prices while NSE is open.
  const holdings = { ...holdingsQuery, data: useLiveHoldings(holdingsQuery.data) }
  const exposure = useExposure(scopePersonId(scope))
  const analysis = useAnalysis(scopePersonId(scope))
  const fx = useFx().data
  const health = useHealth(scopePersonId(scope))
  const { period } = usePeriod()
  const rows = holdings.data ?? []
  const whose = scope === 'family' ? 'the family' : (persons.find((p) => p.id === scope)?.name ?? '')
  const t = totals(rows)
  const shownValue = useCountUp(t.value)
  const shownDay = useCountUp(t.dayChange, 700)

  if (holdings.isLoading)
    return (
      <>
        <PageHeader title="Overview" />
        <PageSkeleton label="Loading your holdings" />
      </>
    )

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorNote error={holdings.error} />
        <div className="max-w-[60ch] py-10">
          <p className="wide text-[22px] font-semibold">Nothing recorded for {whose} yet.</p>
          <p className="mt-2 text-ink-muted">
            Start with the monthly CAS statement from NSDL or CDSL. One PDF covers every demat account and mutual fund
            under a PAN. Deposits, PPF, gold, property and crypto go under Other assets.
          </p>
          <div className="mt-5 flex gap-3">
            <Link to="/import" className="rounded-md bg-stamp px-4 py-2 font-medium text-white dark:text-[#10162a]">
              Import a statement
            </Link>
            <Link to="/other-assets" className="rounded-md border border-rule-strong px-4 py-2 font-medium">
              Add other assets
            </Link>
          </div>
        </div>
      </>
    )
  }

  const byGroup = [...groupBy(rows, (r) => GROUP_OF[r.assetClass])]
    .map(([g, rs]) => ({ group: g as ChartGroup, rows: rs, t: totals(rs) }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  const byPlatform = [...groupBy(rows, (r) => r.platform)]
    .map(([p, rs]) => ({ platform: p as Platform, rows: rs, t: totals(rs) }))
    .sort((a, b) => b.t.value - a.t.value)
  const byPerson = [...groupBy(rows, (r) => r.personName)]
    .map(([name, rs]) => ({ name, t: totals(rs) }))
    .sort((a, b) => b.t.value - a.t.value)
  const share = (v: number) => (t.value > 0 ? v / t.value : 0)
  const statementPriced = rows.filter((r) => r.priceSource === 'STATEMENT')
  const hasUsd = rows.some((r) => r.currency === 'USD')
  const mix = MIX_ORDER.map((type) => ({
    type,
    value: exposure.data?.assetMix.find((m) => m.type === type)?.valueInr ?? 0
  }))
  // Donut: at most six slices — the five largest groups and the rest in neutral grey.
  const sortedGroups = [...byGroup].sort((a, b) => b.t.value - a.t.value)
  const donut = [
    ...sortedGroups
      .slice(0, 5)
      .map((g) => ({ key: g.group, label: GROUP_LABELS[g.group], value: g.t.value, color: GROUP_COLORS[g.group] })),
    ...(sortedGroups.length > 5
      ? [
          {
            key: 'REST',
            label: 'Everything else',
            value: sortedGroups.slice(5).reduce((s, g) => s + g.t.value, 0),
            color: 'var(--series-other)'
          }
        ]
      : [])
  ]
  const hist = analysis.data?.history
  // Net worth: what is owned less what was owed on loans at each month end.
  const owedByMonth = analysis.data?.owed.byMonth ?? []
  const owedNow = analysis.data?.owed.totalInr ?? 0
  const allTrend =
    hist && hist.months.length > 2
      ? hist.months.map((_, i) => hist.series.reduce((s, x) => s + x.values[i], 0) - (owedByMonth[i] ?? 0))
      : null
  const from = hist ? periodStartIndex(hist.months, period) : 0
  const trend = allTrend ? allTrend.slice(from) : null
  const trendDates = hist ? hist.months.slice(from) : []
  // Change over the period, today's live value against the value at its start.
  const startValue = trend && trend.length > 1 ? trend[0] : null
  const netNow = t.value - owedNow
  const change = startValue !== null ? netNow - startValue : null
  const upcoming = (analysis.data?.upcoming ?? []).filter((u) => u.amount > 0).slice(0, 5)

  return (
    <>
      <PageHeader title="Overview">
        <ReportButton personId={scopePersonId(scope)} />
        <PeriodPicker />
      </PageHeader>
      <ErrorNote error={holdings.error} />

      <div className="grid grid-cols-1 gap-10 @7xl:grid-cols-[minmax(0,620px)_1fr]">
        {/* The balance, written up like the closing lines of a passbook page. */}
        <section aria-label="Balance">
          <dl className="text-[16px]">
            <div className="flex items-baseline justify-between border-b border-rule py-2">
              <dt className="text-ink-muted">Invested</dt>
              <dd className="num">{money(t.invested)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-b border-rule py-2">
              <dt className="text-ink-muted">Gain so far</dt>
              <dd className={`num ${toneClass(t.gain)}`}>
                {signedMoney(t.gain)} <span className="ml-2 text-[14px]">{percent(t.gainPct)}</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-b border-rule-strong py-2">
              <dt className="text-ink-muted">Day change</dt>
              <dd className={`num ${toneClass(t.dayChange)}`}>
                {signedMoney(shownDay)}{' '}
                <span className="ml-2 text-[14px]">{percent(t.dayBase > 0 ? t.dayChange / t.dayBase : null)}</span>
              </dd>
            </div>
            {owedNow > 0 ? (
              <>
                <div className="flex items-baseline justify-between border-b border-rule py-2">
                  <dt className="text-ink-muted">Current value of what you own</dt>
                  <dd className="num">{money(shownValue)}</dd>
                </div>
                <div className="flex items-baseline justify-between border-b border-rule-strong py-2">
                  <dt className="text-ink-muted">
                    Owed on loans{' '}
                    <Link to="/loans" className="text-[14px] text-stamp hover:underline">
                      Loans
                    </Link>
                  </dt>
                  <dd className="num text-loss">−{money(owedNow)}</dd>
                </div>
                <div className="flex items-baseline justify-between pt-3">
                  <dt className="text-[14.5px] font-medium">Net worth, {whose}</dt>
                  <dd className="num border-b-2 border-double border-stamp/60 pb-0.5 text-[26px] leading-none font-semibold tracking-tight text-stamp @5xl:text-[32px]">
                    {money(shownValue - owedNow)}
                  </dd>
                </div>
              </>
            ) : (
              <div className="flex items-baseline justify-between pt-3">
                <dt className="text-[14.5px] font-medium">Current value, {whose}</dt>
                <dd className="num border-b-2 border-double border-stamp/60 pb-0.5 text-[26px] leading-none font-semibold tracking-tight text-stamp @5xl:text-[32px]">
                  {money(shownValue)}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-[14px] text-ink-muted">
            {lakhCrore(t.value)}.{' '}
            {statementPriced.length === 0
              ? 'Every market holding is at its latest live price or NAV.'
              : `${statementPriced.length} ${statementPriced.length === 1 ? 'holding is' : 'holdings are'} still at statement prices until the next refresh.`}
            {hasUsd && fx?.usdInr && (
              <>
                {' '}
                US holdings are converted at ₹{fx.usdInr.toFixed(2)} per dollar ({timeAgo(fx.asOf)}).
              </>
            )}
            {t.valueWithoutCost > 0 && (
              <> {money(t.valueWithoutCost)} has no purchase cost on record, so it is left out of the gain.</>
            )}
          </p>
          {change !== null && trend && (
            <div className="mt-4 flex items-center gap-3 border-t border-rule pt-3 text-[15px]">
              <Sparkline values={[...trend.slice(0, -1), netNow]} width={110} height={30} />
              <span>
                <span className="text-ink-muted">Over {periodTitle(period).replace(/^last /, 'the last ')}: </span>
                <span className={`num font-semibold ${toneClass(change)}`}>{signedMoney(change)}</span>
                <span className={`num ml-1.5 text-[14px] ${toneClass(change)}`}>
                  {percent(startValue! > 0 ? change / startValue! : null)}
                </span>
                <span className="ml-1.5 text-[13px] text-ink-muted">including money added</span>
              </span>
            </div>
          )}
        </section>

        {trend && (
          <section aria-labelledby="trend" className="min-w-0">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 id="trend" className="wide text-[17px] font-semibold">
                Net worth over time
              </h2>
              <Link to="/analysis" className="text-[14px] text-stamp hover:underline">
                Full analysis
              </Link>
            </div>
            <AreaStack
              key={period}
              dates={trendDates}
              series={[{ key: 'total', label: 'Net worth', color: 'var(--series-1)', values: trend }]}
              label="Net worth over time"
              format={(v) => money(v)}
              axisFormat={(v) => compactMoney(v)}
              height={200}
            />
            {analysis.data?.xirr.overall != null && (
              <p className="mt-1 text-[13px] text-ink-muted">
                Return per year (XIRR):{' '}
                <span className={`num font-semibold ${toneClass(analysis.data.xirr.overall)}`}>
                  {(analysis.data.xirr.overall * 100).toFixed(1)}%
                </span>
              </p>
            )}
          </section>
        )}
      </div>

      {health.data && <Checklist report={health.data} />}

      <section aria-labelledby="alloc" className="mt-12">
        <h2 id="alloc" className="wide mb-4 text-[19px] font-semibold">
          What it&rsquo;s in
        </h2>
        <div className="grid grid-cols-1 items-center gap-10 @5xl:grid-cols-[auto_1fr]">
          <Donut
            parts={donut}
            centerLabel={`${rows.length} holdings`}
            format={(v) => compactMoney(v)}
            label="Allocation by group"
          />
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Type</th>
                <th className="num py-1.5 font-medium">Holdings</th>
                <th className="num py-1.5 font-medium">Value</th>
                <th className="num py-1.5 font-medium">Share</th>
                <th className="num py-1.5 font-medium">Day change</th>
                <th className="num py-1.5 font-medium">Gain</th>
              </tr>
            </thead>
            <tbody>
              {byGroup.map(({ group, rows: rs, t: s }, i) => (
                <tr key={group} className="anim-page border-b border-rule" style={stagger(i, 40)}>
                  <td className="py-2">
                    <span
                      className="mr-2 inline-block size-2.5 rounded-[2px] align-middle"
                      style={{ background: GROUP_COLORS[group] }}
                    />
                    {GROUP_LABELS[group]}
                  </td>
                  <td className="num py-2">{rs.length}</td>
                  <td className="num py-2">{money(s.value)}</td>
                  <td className="num py-2">{(share(s.value) * 100).toFixed(1)}%</td>
                  <td className={`num py-2 ${toneClass(s.dayChange)}`}>
                    {s.dayBase > 0 ? signedMoney(s.dayChange) : '—'}
                  </td>
                  <td className={`num py-2 ${toneClass(s.gain)}`}>{percent(s.gainPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {exposure.data && exposure.data.totalInr > 0 && (
        <section aria-labelledby="mix" className="mt-12">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="mix" className="wide text-[19px] font-semibold">
              Equity, debt, gold and the rest
            </h2>
            <Link to="/exposure" className="text-[14px] text-stamp hover:underline">
              Sectors and companies
            </Link>
          </div>
          <StackBar
            label="Asset mix after looking inside funds"
            format={(v) => money(v)}
            segments={mix.map((m) => ({
              key: m.type,
              label: MIX_LABELS[m.type],
              value: m.value,
              color: MIX_COLORS[m.type]
            }))}
          />
          <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[15px]">
            {mix
              .filter((m) => m.value > 0)
              .map((m) => (
                <li key={m.type} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-[2px]"
                    style={{ background: MIX_COLORS[m.type] }}
                  />
                  {MIX_LABELS[m.type]}
                  <span className="num font-medium">{((m.value / exposure.data!.totalInr) * 100).toFixed(1)}%</span>
                  <span className="num text-[13px] text-ink-muted">{compactMoney(m.value)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="mt-12 grid grid-cols-1 gap-12 @7xl:grid-cols-3">
        <section aria-labelledby="where">
          <h2 id="where" className="wide mb-3 text-[19px] font-semibold">
            Where it&rsquo;s held
          </h2>
          <table className="w-full text-[15px]">
            <tbody>
              {byPlatform.map(({ platform, rows: rs, t: s }) => (
                <tr key={platform} className="border-b border-rule">
                  <td className="py-2">
                    {PLATFORM_LABELS[platform]}
                    <span className="ml-2 text-[13px] text-ink-muted">{new Set(rs.map((r) => r.accountId)).size}</span>
                  </td>
                  <td className="num py-2">{compactMoney(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {scope === 'family' && byPerson.length > 1 && (
          <section aria-labelledby="who">
            <h2 id="who" className="wide mb-3 text-[19px] font-semibold">
              By person
            </h2>
            <table className="w-full text-[15px]">
              <tbody>
                {byPerson.map(({ name, t: s }) => (
                  <tr key={name} className="border-b border-rule">
                    <td className="py-2">{name}</td>
                    <td className="num py-2">{compactMoney(s.value)}</td>
                    <td className={`num py-2 ${toneClass(s.gain)}`}>{percent(s.gainPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {upcoming.length > 0 && (
          <section aria-labelledby="soon">
            <h2 id="soon" className="wide mb-3 text-[19px] font-semibold">
              Coming up
            </h2>
            <ul className="text-[14px]">
              {upcoming.map((u, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-rule py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{u.holding}</span>
                    <span className="text-[12px] text-ink-muted">
                      {u.label}, {shortDate(u.date)}
                    </span>
                  </span>
                  <span className="num shrink-0">{signedMoney(u.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

const MARK: Record<'OK' | 'WARN' | 'INFO', { icon: string; cls: string; label: string }> = {
  WARN: { icon: '!', cls: 'bg-warn text-paper', label: 'Needs attention' },
  INFO: { icon: 'i', cls: 'bg-stamp text-paper', label: 'Worth a look' },
  OK: { icon: '✓', cls: 'bg-gain/15 text-gain', label: 'All good' }
}

/** The data health check-up: what makes the numbers incomplete or costs money, with a link to fix it. */
function Checklist({ report }: { report: HealthReport }) {
  const passed = report.checks.filter((c) => c.status === 'OK')
  const open = report.checks.filter((c) => c.status !== 'OK')
  return (
    <section aria-labelledby="health" className="mt-12">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="health" className="wide text-[19px] font-semibold">
          Check-up
        </h2>
        <span className="text-[14px] text-ink-muted">
          {report.issues ? `${report.issues} to fix` : 'Nothing to fix'} · {passed.length} of {report.checks.length}{' '}
          fine
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-10 @5xl:grid-cols-2">
        {open.map((c, i) => (
          <li key={c.key} className="anim-page flex gap-3 border-b border-rule py-2.5" style={stagger(i, 40)}>
            <span
              aria-label={MARK[c.status].label}
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${MARK[c.status].cls}`}
            >
              {MARK[c.status].icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{c.title}</div>
              {c.detail && <div className="text-[13px] text-ink-muted">{c.detail}</div>}
            </div>
            {c.link && (
              <Link
                to={c.link}
                className="shrink-0 self-center text-[14px] whitespace-nowrap text-stamp hover:underline"
              >
                {c.linkLabel}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {passed.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-muted">
          {passed.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5">
              <span aria-hidden className="text-gain">
                ✓
              </span>
              {c.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
