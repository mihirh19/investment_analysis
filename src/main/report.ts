import type { AssetClass } from '@shared/types'
import { schema, type Db } from './db'
import { alertsReport } from './alerts'
import { farmReport } from './farm'
import { loansReport } from './loans'
import { computePerformance } from './portfolio/performance'
import { listHoldings } from './portfolio/holdings'
import { computeXray } from './portfolio/xray'
import { calendarReport } from './research/store'

/**
 * The monthly family report: one printable page set (A4) with net worth, the month's change, the
 * biggest holdings, concentration, loans, the farm, what's coming up and the month's alerts. Built
 * as plain HTML here and printed to PDF by the window layer; nothing leaves the computer.
 */

const LABEL: Record<AssetClass, string> = {
  EQUITY_IN: 'Indian stocks',
  ETF: 'ETFs',
  MF: 'Mutual funds',
  EQUITY_US: 'US stocks',
  GOLD: 'Gold & silver',
  FD: 'Deposits',
  BOND: 'Bonds',
  EPF: 'EPF',
  PPF: 'PPF & SSY',
  NPS: 'NPS',
  REAL_ESTATE: 'Property',
  REIT: 'REITs & InvITs',
  CRYPTO: 'Crypto',
  INSURANCE: 'Insurance',
  CASH: 'Cash & savings',
  AGRI: 'Farm produce',
  OTHER: 'Other'
}

export interface ReportData {
  title: string
  month: string
  generated: string
  total: number
  invested: number
  owed: number
  monthlyEmi: number
  byClass: { label: string; value: number; share: number }[]
  byPerson: { name: string; value: number }[]
  monthChange: { from: string; value: number; returnPct: number | null } | null
  top: { name: string; value: number; gain: number | null }[]
  concentration: { top5: number; effectiveStocks: number; largest: string | null } | null
  farm: { fy: string; sales: number; costs: number; support: number; stock: number } | null
  coming: { date: string; what: string }[]
  alerts: { at: string; title: string }[]
}

export function gatherReport(db: Db, personId?: number, today = new Date()): ReportData {
  const iso = today.toISOString().slice(0, 10)
  const rows = listHoldings(db, personId)
  const total = rows.reduce((s, r) => s + (r.marketValueInr ?? 0), 0)
  const invested = rows.reduce((s, r) => s + (r.investedInr ?? 0), 0)
  const classes = new Map<AssetClass, number>()
  const people = new Map<string, number>()
  for (const r of rows) {
    const v = r.marketValueInr ?? 0
    if (v <= 0) continue
    classes.set(r.assetClass, (classes.get(r.assetClass) ?? 0) + v)
    people.set(r.personName, (people.get(r.personName) ?? 0) + v)
  }
  // One line per instrument, across people and accounts.
  const byInst = new Map<number, { name: string; value: number; invested: number; known: boolean }>()
  for (const r of rows) {
    const v = r.marketValueInr ?? 0
    if (v <= 0) continue
    const x = byInst.get(r.instrumentId) ?? { name: r.instrumentName, value: 0, invested: 0, known: true }
    x.value += v
    x.invested += r.investedInr ?? 0
    x.known &&= r.investedInr !== null
    byInst.set(r.instrumentId, x)
  }
  const loans = loansReport(db, personId)
  let monthChange: ReportData['monthChange'] = null
  try {
    const p = computePerformance(db, personId)
    const n = p.values.length
    if (n >= 2) monthChange = { from: p.dates[n - 2], value: p.values[n - 1] - p.values[n - 2], returnPct: p.monthly.at(-1) ?? null }
  } catch {
    monthChange = null
  }
  const x = computeXray(db, personId)
  const f = farmReport(db, personId)
  const cal = calendarReport(db, iso)
  const soon = new Date(today.getTime() + 31 * 86400_000).toISOString().slice(0, 10)
  const coming = [
    ...cal.results.filter((r) => r.held && r.date >= iso && r.date <= soon).map((r) => ({ date: r.date, what: `${r.company}: ${r.purpose}` })),
    ...cal.actions.filter((a) => a.held && a.exDate >= iso && a.exDate <= soon).map((a) => ({ date: a.exDate, what: `${a.company} goes ex: ${a.subject}${a.expectedInr ? ` (about ₹${Math.round(a.expectedInr).toLocaleString('en-IN')})` : ''}` }))
  ].sort((a, b) => a.date.localeCompare(b.date))
  const monthAgo = new Date(today.getTime() - 31 * 86400_000).toISOString()
  const who = personId ? db.select().from(schema.persons).all().find((p) => p.id === personId)?.name : null
  return {
    title: who ? `${who}'s money` : 'The family’s money',
    month: today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    generated: today.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    total,
    invested,
    owed: loans.owedInr,
    monthlyEmi: loans.monthlyEmi,
    byClass: [...classes].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ label: LABEL[c], value: v, share: total ? v / total : 0 })),
    byPerson: [...people].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    monthChange,
    top: [...byInst.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((h) => ({ name: h.name, value: h.value, gain: h.known && h.invested > 0 ? h.value - h.invested : null })),
    concentration: x.companies.length ? { top5: x.concentration.top5, effectiveStocks: x.concentration.effectiveStocks, largest: x.companies[0].name } : null,
    farm: f.seasons.length || f.stock.length ? { fy: f.thisFy.fy, sales: f.thisFy.sales, costs: f.thisFy.costs, support: f.thisFy.support, stock: f.stockValue } : null,
    coming: coming.slice(0, 15),
    alerts: alertsReport(db)
      .events.filter((e) => e.at >= monthAgo)
      .slice(0, 15)
      .map((e) => ({ at: e.at.slice(0, 10), title: e.title }))
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${inr(Math.abs(v))}`
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

export function reportHtml(r: ReportData): string {
  const table = (head: string[], body: string[][], right: number[] = []) =>
    `<table><thead><tr>${head.map((h, i) => `<th${right.includes(i) ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
      .map((row) => `<tr>${row.map((c, i) => `<td${right.includes(i) ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`
  const net = r.total - r.owed
  const parts: string[] = []
  parts.push(`<header><h1>${esc(r.title)}</h1><p>${esc(r.month)} · made ${esc(r.generated)}</p></header>`)
  parts.push(
    `<section class="tiles"><div><span>Investments and assets</span><b>${inr(r.total)}</b></div><div><span>Loans owed</span><b>${inr(r.owed)}</b></div><div><span>Net worth</span><b>${inr(net)}</b></div>${
      r.monthChange ? `<div><span>Change since ${esc(r.monthChange.from)}</span><b>${signed(r.monthChange.value)}</b>${r.monthChange.returnPct !== null ? `<em>${pct(r.monthChange.returnPct)} return</em>` : ''}</div>` : ''
    }</section>`
  )
  parts.push(`<h2>Where the money is</h2>${table(['Kind', 'Value', 'Share'], r.byClass.map((c) => [esc(c.label), inr(c.value), pct(c.share)]), [1, 2])}`)
  if (r.byPerson.length > 1) parts.push(`<h2>By person</h2>${table(['Person', 'Value'], r.byPerson.map((p) => [esc(p.name), inr(p.value)]), [1])}`)
  parts.push(`<h2>Biggest holdings</h2>${table(['Holding', 'Value', 'Gain'], r.top.map((h) => [esc(h.name), inr(h.value), h.gain === null ? '—' : signed(h.gain)]), [1, 2])}`)
  if (r.concentration)
    parts.push(
      `<p>All the shares, direct and inside funds, behave like about <b>${Math.round(r.concentration.effectiveStocks)}</b> equal-sized stocks; the five biggest companies are ${pct(r.concentration.top5)} of them${r.concentration.largest ? `, the largest ${esc(r.concentration.largest)}` : ''}.</p>`
    )
  if (r.owed > 0) parts.push(`<h2>Loans</h2><p>${inr(r.owed)} still owed; ${inr(r.monthlyEmi)} a month in EMIs.</p>`)
  if (r.farm)
    parts.push(
      `<h2>Farm</h2><p>${esc(r.farm.fy)} so far: ${inr(r.farm.sales)} from sales after mandi charges, ${inr(r.farm.costs)} spent${r.farm.support ? `, ${inr(r.farm.support)} from government schemes` : ''}. In the godown: ${inr(r.farm.stock)} at today’s mandi prices.</p>`
    )
  if (r.coming.length) parts.push(`<h2>Coming up in the next month</h2>${table(['Date', 'What'], r.coming.map((c) => [esc(c.date), esc(c.what)]))}`)
  if (r.alerts.length) parts.push(`<h2>Alerts this month</h2>${table(['Date', 'Alert'], r.alerts.map((a) => [esc(a.at), esc(a.title)]))}`)
  parts.push(`<footer>Family Portfolio, kept on this computer. Figures as of the last price update; information only, not investment advice.</footer>`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.title)}, ${esc(r.month)}</title><style>
@page { size: A4; margin: 16mm 14mm; }
body { font: 10.5pt/1.45 "Segoe UI", system-ui, sans-serif; color: #1b1b1b; }
header { border-bottom: 2px solid #b8620b; margin-bottom: 10px; }
h1 { font-size: 20pt; margin: 0; } header p { margin: 2px 0 8px; color: #666; }
h2 { font-size: 12.5pt; margin: 18px 0 6px; color: #8a4a08; break-after: avoid; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
.tiles div { border: 1px solid #ddd; padding: 6px 8px; } .tiles span { display: block; font-size: 8.5pt; color: #666; }
.tiles b { font-size: 13pt; } .tiles em { display: block; font-style: normal; font-size: 8.5pt; color: #666; }
table { width: 100%; border-collapse: collapse; break-inside: auto; } tr { break-inside: avoid; }
th { text-align: left; font-size: 8.5pt; color: #666; font-weight: 600; border-bottom: 1px solid #999; padding: 3px 4px; }
td { border-bottom: 1px solid #e5e5e5; padding: 3px 4px; } .r { text-align: right; font-variant-numeric: tabular-nums; }
footer { margin-top: 24px; font-size: 8pt; color: #777; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>${parts.join('\n')}</body></html>`
}
