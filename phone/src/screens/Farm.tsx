import { useState, type FormEvent } from 'react'
import {
  CROPS,
  FARM_COST_KINDS,
  QTY_UNITS,
  SEASON_LABELS,
  toQuintals,
  type CropPrice,
  type FarmCostKind,
  type FarmEntryType,
  type FarmSeasonView,
  type QtyUnit
} from '@shared/farm'
import { useData } from '../lib/data'
import { Card, day, field, inr, Label, lakhCrore, Primary, Seg, Sheet, today } from '../ui'

const qty = (q: number) => `${q.toLocaleString('en-IN', { maximumFractionDigits: 2 })} qtl`
const inMan = (q: number) => `${(q * 5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} man`
const perMan = (p: number | null) => (p ? `${inr(p / 5)}/man` : '')
const pct = (a: number | null, b: number | null) => (a && b ? `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(1)}%` : '—')
const toneOf = (a: number | null, b: number | null) => (!a || !b ? 'text-ink-muted' : a >= b ? 'text-gain' : 'text-loss')

const SHEET_TITLES: Record<FarmEntryType, string> = { COST: 'Add a cost', HARVEST: 'Record the harvest', SALE: 'Record a sale', LOSS: 'Used at home or spoilt' }

/** Cost, harvest or sale from the phone; the computer applies it on its next sync. */
function EntrySheet({ s, type, onClose }: { s: FarmSeasonView; type: FarmEntryType; onClose: () => void }) {
  const { record } = useData()
  const [f, setF] = useState({
    date: today(),
    kind: 'SEED' as FarmCostKind,
    amount: '',
    q: '',
    unit: 'MAN' as QtyUnit,
    rate: '',
    rateUnit: 'MAN' as 'MAN' | 'QTL',
    charges: '',
    mandi: s.market ?? '',
    note: ''
  })
  const quintals = Number(f.q) > 0 ? toQuintals(Number(f.q), f.unit) : null
  const ratePerQtl = Number(f.rate) > 0 ? Number(f.rate) * (f.rateUnit === 'MAN' ? 5 : 1) : null
  const ok =
    type === 'COST' ? Number(f.amount) > 0 : !!quintals && (type !== 'SALE' || !!ratePerQtl || Number(f.amount) > 0) && (type === 'HARVEST' || quintals <= s.inStockQtl + 1e-6)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await record({
      type: 'FARM_ENTRY',
      entryType: type,
      seasonId: s.id,
      date: f.date,
      costKind: type === 'COST' ? f.kind : null,
      quantityQtl: type === 'COST' ? null : quintals,
      rate: type === 'SALE' ? ratePerQtl : null,
      amount: type === 'COST' || type === 'SALE' ? Number(f.amount) || 0 : 0,
      charges: type === 'SALE' && Number(f.charges) > 0 ? Number(f.charges) : null,
      mandi: type === 'SALE' ? f.mandi.trim() || null : null,
      note: f.note.trim() || null
    })
    onClose()
  }
  return (
    <Sheet title={`${SHEET_TITLES[type]}: ${CROPS[s.crop].label}`} onClose={onClose}>
      <form onSubmit={submit}>
        {type === 'COST' ? (
          <>
            <Label text="What for">
              <select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FarmCostKind })}>
                {(Object.keys(FARM_COST_KINDS) as FarmCostKind[]).map((k) => (
                  <option key={k} value={k}>
                    {FARM_COST_KINDS[k]}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Amount (₹)">
              <input type="number" inputMode="decimal" min="1" required className={field} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Label>
          </>
        ) : (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Label text={type === 'HARVEST' ? 'How much was harvested' : `How much (${qty(s.inStockQtl)} in stock)`}>
              <input type="number" inputMode="decimal" min="0" step="any" required className={field} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
            </Label>
            <Label text="Unit">
              <select className={field} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as QtyUnit })}>
                {(Object.keys(QTY_UNITS) as QtyUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {u === 'QTL' ? 'quintal' : u === 'MAN' ? 'man (20 kg)' : 'kg'}
                  </option>
                ))}
              </select>
            </Label>
          </div>
        )}
        {type === 'SALE' && (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Label text="Rate">
                <input type="number" inputMode="decimal" min="0" step="any" className={field} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
              </Label>
              <Label text="Per">
                <select className={field} value={f.rateUnit} onChange={(e) => setF({ ...f, rateUnit: e.target.value as 'MAN' | 'QTL' })}>
                  <option value="MAN">man</option>
                  <option value="QTL">quintal</option>
                </select>
              </Label>
            </div>
            {ratePerQtl && quintals && <p className="-mt-1 mb-3 text-[13px] text-ink-muted">{inr(ratePerQtl * quintals)} in all</p>}
            <div className="grid grid-cols-2 gap-2">
              <Label text="Mandi charges (₹)">
                <input type="number" inputMode="decimal" min="0" className={field} value={f.charges} onChange={(e) => setF({ ...f, charges: e.target.value })} />
              </Label>
              <Label text="Sold at">
                <input className={field} value={f.mandi} onChange={(e) => setF({ ...f, mandi: e.target.value })} />
              </Label>
            </div>
          </>
        )}
        <Label text="On">
          <input type="date" required max={today()} className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Label>
        {type !== 'HARVEST' && type !== 'COST' && quintals && quintals > s.inStockQtl + 1e-6 && (
          <p className="mb-3 text-[14px] text-loss">Only {qty(s.inStockQtl)} of this season is in stock.</p>
        )}
        <div className="pb-3">
          <Primary type="submit" disabled={!ok}>
            Save
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

function PriceRow({ p }: { p: CropPrice }) {
  const now = p.latest?.modal ?? null
  return (
    <li className="border-b border-rule py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium">
          {CROPS[p.crop].label} <span className="text-[13px] font-normal text-ink-muted">{p.market}</span>
        </span>
        <span className="num text-[17px] font-semibold">{now ? inr(now) : '—'}</span>
      </div>
      {p.latest && (
        <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-[12px] text-ink-muted">
          <span>
            {perMan(now)}, {day(p.latest.date)}
          </span>
          <span>
            30 days <span className={toneOf(now, p.avg30)}>{pct(now, p.avg30)}</span>
            {p.yearAgo ? (
              <>
                {' '}
                · year ago <span className={toneOf(now, p.yearAgo)}>{pct(now, p.yearAgo)}</span>
              </>
            ) : null}
            {p.msp ? (
              <>
                {' '}
                · MSP <span className={toneOf(now, p.msp)}>{pct(now, p.msp)}</span>
              </>
            ) : null}
          </span>
        </div>
      )}
      {p.varieties.length > 1 && (
        <div className="mt-0.5 text-[12px] text-ink-muted">
          {p.varieties.map((v) => `${v.name} ${inr(v.modal)}`).join(' · ')}
        </div>
      )}
      {p.target && (
        <div className={`mt-0.5 text-[12px] ${p.targetReached ? 'font-semibold text-gain' : 'text-ink-muted'}`}>
          Target {inr(p.target)}: {p.targetReached ? 'reached' : now ? `${inr(p.target - now)} to go` : 'no price yet'}
        </div>
      )}
    </li>
  )
}

/** The farm on the phone: the godown, the field, today's mandi prices and each season. */
export function Farm() {
  const { snapshot, pending } = useData()
  const [scope, setScope] = useState<'all' | string>('all')
  const [sheet, setSheet] = useState<{ s: FarmSeasonView; type: FarmEntryType } | null>(null)
  const farm = snapshot?.farm
  if (!farm) return null
  const people = [...new Set(farm.seasons.map((s) => s.personName))]
  const mine = <T extends { personName: string }>(xs: T[]) => (scope === 'all' ? xs : xs.filter((x) => x.personName === scope))
  const stock = mine(farm.stock)
  const growing = mine(farm.growing)
  const seasons = mine(farm.seasons).filter((s) => s.status !== 'CLOSED')
  const waiting = pending.filter((e) => e.type === 'FARM_ENTRY').length

  return (
    <>
      {people.length > 1 && (
        <div className="mb-3">
          <Seg label="Whose farm" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, ...people.map((p) => ({ value: p, label: p }))]} />
        </div>
      )}
      <Card>
        <div className="text-[14px] text-ink-muted">In the godown, at today&rsquo;s price</div>
        <div className="wide num text-left text-[34px] leading-tight font-semibold">{lakhCrore(stock.reduce((s, x) => s + x.value, 0))}</div>
        <div className="text-[13px] text-ink-muted">
          Counted in net worth{farm.pricesAsOf ? `; prices of ${day(farm.pricesAsOf)}` : ''}
        </div>
        {growing.length > 0 && (
          <div className="mt-2 text-[14px]">
            In the field: <b className="num">{lakhCrore(growing.reduce((s, g) => s + (g.expectedValue ?? 0), 0))}</b>{' '}
            <span className="text-ink-muted">expected ({growing.map((g) => CROPS[g.crop].label).join(', ')}), not counted yet</span>
          </div>
        )}
        {waiting > 0 && <div className="mt-2 text-[13px] text-warn">{waiting} entr{waiting === 1 ? 'y' : 'ies'} waiting for the computer to sync.</div>}
      </Card>

      {stock.length > 0 && (
        <Card title="In the godown">
          <ul>
            {stock.map((x) => (
              <li key={`${x.personId}-${x.crop}-${x.variety ?? ''}`} className="flex justify-between gap-3 border-b border-rule py-2 last:border-0">
                <div className="min-w-0">
                  <div className="text-[15px]">
                    {CROPS[x.crop].label}
                    {x.variety ? ` ${x.variety}` : ''} <span className="text-[13px] text-ink-muted">{CROPS[x.crop].gu}</span>
                  </div>
                  <div className="text-[12px] text-ink-muted">
                    {qty(x.quantityQtl)} ({inMan(x.quantityQtl)}){people.length > 1 ? `, ${x.personName}` : ''}
                  </div>
                </div>
                <div className="num shrink-0 text-right">
                  <div className="text-[15px] font-semibold">{x.price ? inr(x.value) : '—'}</div>
                  {x.cost !== null && x.price ? <div className={`text-[12px] ${x.value >= x.cost ? 'text-gain' : 'text-loss'}`}>gain {inr(x.value - x.cost)}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {farm.prices.length > 0 && (
        <Card title="Mandi prices" aside="₹ a quintal">
          <ul>
            {farm.prices.map((p) => (
              <PriceRow key={p.crop} p={p} />
            ))}
          </ul>
          {farm.priceError && <p className="mt-2 text-[12px] text-warn">{farm.priceError}</p>}
        </Card>
      )}

      {(farm.outlook ?? []).some((o) => o.pattern || o.note) && (
        <Card title="Selling: past seasons and news">
          <ul>
            {(farm.outlook ?? [])
              .filter((o) => o.pattern || o.note)
              .map((o) => {
                const fmt = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`)
                const h = (k: number) => o.pattern?.horizons.find((x) => x.months === k)
                return (
                  <li key={o.crop} className="border-b border-rule py-2 last:border-0">
                    <div className="text-[15px] font-medium">{CROPS[o.crop].label}</div>
                    {o.pattern &&
                      [3, 6].map((k) =>
                        h(k)?.changes.length ? (
                          <div key={k} className="text-[13px] text-ink-muted">
                            From {o.pattern!.fromMonth}, {k} months on: typically {fmt(h(k)!.median)} ({fmt(h(k)!.min)} to {fmt(h(k)!.max)}, {h(k)!.changes.length} years)
                          </div>
                        ) : null
                      )}
                    {o.note?.range && (
                      <div className="mt-1 text-[13px]">
                        Claude&rsquo;s range, next 1–3 months: <b className="num">{inr(o.note.range.low)}–{inr(o.note.range.high)}</b>
                        {o.note.confidence ? ` (${o.note.confidence} confidence)` : ''}
                      </div>
                    )}
                    {o.note && (
                      <details className="mt-1 text-[13px]">
                        <summary className="text-stamp">Market note, {day(o.note.at.slice(0, 10))}</summary>
                        <div className="mt-1 whitespace-pre-wrap text-ink-muted">{o.note.text.replaceAll('**', '')}</div>
                      </details>
                    )}
                  </li>
                )
              })}
          </ul>
          <p className="mt-2 text-[12px] text-ink-muted">Past years and the news, not a promise of what comes next; the choice is yours.</p>
        </Card>
      )}

      {seasons.map((s) => (
        <Card key={s.id} title={`${CROPS[s.crop].label}${s.variety ? ` ${s.variety}` : ''}, ${SEASON_LABELS[s.season]}${s.season === 'STOCK' ? '' : ` ${s.year}`}`} aside={people.length > 1 ? s.personName : undefined}>
          <dl className="grid grid-cols-2 gap-y-1 text-[14px]">
            {s.areaAcres ? (
              <>
                <dt className="text-ink-muted">Area</dt>
                <dd className="text-right">{s.areaAcres} acres</dd>
              </>
            ) : null}
            {s.status === 'GROWING' && s.expectedQtl ? (
              <>
                <dt className="text-ink-muted">Expected</dt>
                <dd className="text-right">
                  {qty(s.expectedQtl)}
                  {s.expectedValue ? `, ${lakhCrore(s.expectedValue)}` : ''}
                </dd>
              </>
            ) : null}
            {s.inStockQtl ? (
              <>
                <dt className="text-ink-muted">In stock</dt>
                <dd className="text-right">
                  {qty(s.inStockQtl)}, {lakhCrore(s.stockValue)}
                </dd>
              </>
            ) : null}
            {s.salesNet ? (
              <>
                <dt className="text-ink-muted">Sold for</dt>
                <dd className="text-right">{inr(s.salesNet)}</dd>
              </>
            ) : null}
            {s.costs ? (
              <>
                <dt className="text-ink-muted">Costs</dt>
                <dd className="text-right">{inr(s.costs)}</dd>
              </>
            ) : null}
            {s.season !== 'STOCK' && (s.costs > 0 || s.salesNet > 0) ? (
              <>
                <dt className="text-ink-muted">{s.status === 'GROWING' ? 'Expected profit' : 'Profit so far'}</dt>
                <dd className={`text-right font-semibold ${s.profit >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {inr(s.profit)}
                  {s.profitPerAcre !== null ? <span className="font-normal text-ink-muted"> ({inr(s.profitPerAcre)}/acre)</span> : null}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {s.season !== 'STOCK' && (
              <button className="min-h-11 rounded-xl border border-rule-strong text-[14px]" onClick={() => setSheet({ s, type: 'COST' })}>
                Add a cost
              </button>
            )}
            {s.season !== 'STOCK' && (
              <button className="min-h-11 rounded-xl border border-rule-strong text-[14px]" onClick={() => setSheet({ s, type: 'HARVEST' })}>
                Harvest
              </button>
            )}
            {s.inStockQtl > 0 && (
              <button className="min-h-11 rounded-xl bg-stamp text-[14px] font-semibold text-white dark:text-[#10162a]" onClick={() => setSheet({ s, type: 'SALE' })}>
                Record a sale
              </button>
            )}
          </div>
        </Card>
      ))}
      <p className="px-1 pb-2 text-[12px] text-ink-muted">New seasons and stock are added on the computer (Farm page).</p>
      {sheet && <EntrySheet s={sheet.s} type={sheet.type} onClose={() => setSheet(null)} />}
    </>
  )
}
