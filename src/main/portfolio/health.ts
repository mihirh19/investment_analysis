import { BUCKET_LABELS, type HealthCheck, type HealthReport, type MarketStatus } from '@shared/types'
import type { Db } from '../db'
import { computeFunds } from './fundInsights'
import { listHoldings } from './holdings'
import { computeRebalance } from './rebalance'
import { computeTax } from './tax'

// The Overview's checklist: things that make the numbers less complete or cost money, each with a
// link to where it gets fixed. Every check is listed, passing or not, so the list reads as a check-up.

const MARKET = new Set(['EQUITY_IN', 'ETF', 'MF', 'EQUITY_US', 'REIT', 'BOND'])
const STALE_DAYS = 7
const rupees = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function computeHealth(db: Db, personId: number | undefined, market: MarketStatus | null, today = new Date().toISOString().slice(0, 10)): HealthReport {
  const rows = listHoldings(db, personId)
  const checks: HealthCheck[] = []
  const add = (c: HealthCheck) => checks.push(c)
  const daysOld = (d: string | null) => (d ? (Date.parse(today) - Date.parse(d.slice(0, 10))) / 86400000 : Infinity)

  // ---------- buy prices ----------
  const noCost = rows.filter((r) => MARKET.has(r.assetClass) && r.investedInr === null)
  const noCostValue = noCost.reduce((s, r) => s + (r.marketValueInr ?? 0), 0)
  add({
    key: 'buy-price',
    status: noCost.length ? 'WARN' : 'OK',
    title: noCost.length ? `${plural(noCost.length, 'holding has', 'holdings have')} no buy price` : 'Every holding has a buy price',
    detail: noCost.length
      ? `${rupees(noCostValue)} is left out of gains and returns. Import your broker's holdings file, or type the price on the holding.`
      : null,
    link: noCost.length ? '/import?kind=BROKER_HOLDINGS' : null,
    linkLabel: 'Import broker holdings'
  })

  // ---------- trades that don't match statements ----------
  const mismatch = rows.filter((r) => r.tradesQuantity !== null)
  add({
    key: 'trades',
    status: mismatch.length ? 'WARN' : 'OK',
    title: mismatch.length
      ? `${plural(mismatch.length, 'holding has', 'holdings have')} trades that don't add up to the statement`
      : 'Trades agree with your statements',
    detail: mismatch.length ? `${mismatch.map((r) => r.instrumentName).slice(0, 3).join(', ')}${mismatch.length > 3 ? '…' : ''}: import the older tradebooks.` : null,
    link: mismatch.length ? '/holdings' : null,
    linkLabel: 'See holdings'
  })

  // ---------- prices ----------
  const stale = rows.filter(
    (r) => MARKET.has(r.assetClass) && r.assetClass !== 'BOND' && (r.priceSource === 'STATEMENT' || daysOld(r.priceDate) > STALE_DAYS)
  )
  const down = market?.sources.filter((s) => s.lastError) ?? []
  add({
    key: 'prices',
    status: down.length || stale.length ? 'WARN' : 'OK',
    title: down.length
      ? `${plural(down.length, 'price source is', 'price sources are')} not responding`
      : stale.length
        ? `${plural(stale.length, 'holding has', 'holdings have')} an old price`
        : 'Prices are up to date',
    detail: down.length
      ? down.map((s) => s.label).join(', ')
      : stale.length
        ? `${stale.map((r) => r.instrumentName).slice(0, 3).join(', ')}${stale.length > 3 ? '…' : ''} still at a statement or week-old price.`
        : null,
    link: down.length || stale.length ? '/settings' : null,
    linkLabel: 'See price sources'
  })

  // ---------- funds ----------
  const funds = computeFunds(db, personId)
  if (funds.funds.length) {
    const missing = funds.funds.filter((f) => !f.holdingsAsOf && f.categoryGroup !== 'Debt' && f.plan !== 'ETF')
    add({
      key: 'disclosures',
      status: missing.length ? 'INFO' : 'OK',
      title: missing.length
        ? `${plural(missing.length, 'fund has', 'funds have')} no portfolio yet`
        : 'Every fund is opened up into its companies',
      detail: missing.length ? `${missing.map((f) => f.shortName).join(', ')}: sectors and overlap leave ${missing.length === 1 ? 'it' : 'them'} out.` : null,
      link: missing.length ? '/settings' : null,
      linkLabel: 'Fund house status'
    })
    const regular = funds.funds.filter((f) => f.plan === 'REGULAR')
    const extra = regular.reduce((s, f) => s + Math.max(0, f.directPlan?.extraCostInr ?? 0), 0)
    add({
      key: 'regular',
      status: regular.length ? 'WARN' : 'OK',
      title: regular.length ? `${plural(regular.length, 'fund is', 'funds are')} in a Regular plan` : 'No Regular-plan funds',
      detail: regular.length
        ? extra > 0
          ? `About ${rupees(extra)} a year more than the Direct plan of the same funds.`
          : 'Regular plans pay a distributor out of your returns every year.'
        : null,
      link: regular.length ? '/funds' : null,
      linkLabel: 'See funds'
    })
    const high = funds.overlap.pairs.find((p) => p.a !== 0 && p.overlap >= 0.5)
    if (high) {
      const label = (id: number) => funds.overlap.portfolios.find((x) => x.id === id)?.label ?? ''
      add({
        key: 'overlap',
        status: 'INFO',
        title: `${label(high.a)} and ${label(high.b)} overlap by ${Math.round(high.overlap * 100)}%`,
        detail: 'The second fund adds little variety.',
        link: '/funds',
        linkLabel: 'See overlap'
      })
    }
  }

  // ---------- target mix ----------
  const rb = computeRebalance(db, personId, { newMoneyInr: 0, allowSells: false })
  if (rb.baseInr > 0) {
    const off = rb.buckets.filter((b) => b.status === 'OVER' || b.status === 'UNDER')
    add({
      key: 'targets',
      status: !rb.targets ? 'INFO' : off.length ? 'WARN' : 'OK',
      title: !rb.targets
        ? 'No target mix set'
        : off.length
          ? `${plural(off.length, 'bucket is', 'buckets are')} off target`
          : 'Your mix is within its targets',
      detail: !rb.targets
        ? 'Set how much you want in equity, debt, gold and cash to see what to buy next.'
        : off.length
          ? off.map((b) => `${BUCKET_LABELS[b.bucket]} ${Math.round(b.share * 100)}% vs ${Math.round((b.target ?? 0) * 100)}%`).join(', ')
          : null,
      link: !rb.targets || off.length ? '/rebalance' : null,
      linkLabel: rb.targets ? 'Rebalance' : 'Set a target'
    })
  }

  // ---------- tax ----------
  const tax = computeTax(db, personId)
  const harvest = tax.harvest.reduce((s, h) => s + h.gainInr, 0)
  const soon = tax.soonLongTerm.length
  if (harvest > 1000 || soon) {
    add({
      key: 'tax',
      status: 'INFO',
      title: harvest > 1000 ? `${rupees(harvest)} of gains can be booked tax-free this year` : `${plural(soon, 'lot turns', 'lots turn')} long-term within 60 days`,
      detail:
        harvest > 1000
          ? `Selling and buying back before 31 March uses this year's ₹1.25 lakh long-term exemption.`
          : 'Waiting until then lowers the tax on selling them.',
      link: '/tax',
      linkLabel: 'See tax ideas'
    })
  }

  const order = { WARN: 0, INFO: 1, OK: 2 }
  checks.sort((a, b) => order[a.status] - order[b.status])
  return { checks, issues: checks.filter((c) => c.status === 'WARN').length }
}
