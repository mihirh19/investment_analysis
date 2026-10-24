import { useState, type FormEvent } from 'react'
import {
  CROP_KEYS,
  CROPS,
  findVariety,
  PRICE_CLASSES,
  VARIETIES,
  FARM_COST_KINDS,
  QTY_UNITS,
  SEASON_LABELS,
  toQuintals,
  type CropKey,
  type CropPrice,
  type FarmCostKind,
  type FarmEntryType,
  type FarmSeasonKind,
  type FarmSeasonView,
  type FarmStatus,
  type FarmStock,
  type QtyUnit
} from '@shared/farm'
import { PriceLine } from '../components/charts'
import { Combobox } from '../components/Combobox'
import { FarmOutlook } from '../components/FarmOutlook'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import {
  useCropVarieties,
  useDeleteFarmEntry,
  useDeleteFarmSeason,
  useFarm,
  usePersons,
  useRefreshFarmPrices,
  useSaveFarmEntry,
  useSaveFarmSeason,
  useSetFarmMarket,
  useSetFarmPriceTarget
} from '../lib/api'
import { money, shortDate } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const inr = (v: number | null | undefined) => money(v, 'INR', 0)
const today = () => new Date().toISOString().slice(0, 10)
const num = (s: string) => (s.trim() === '' ? null : Number(s))
/** "60 qtl" with the same in man (20 kg), which is how Saurashtra talks about groundnut. */
const qty = (qtl: number) => `${qtl.toLocaleString('en-IN', { maximumFractionDigits: 2 })} qtl`
const inMan = (qtl: number) => `${(qtl * 5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} man`
const perMan = (perQtl: number | null) => (perQtl ? `${inr(perQtl / 5)}/man` : '')
const pct = (a: number | null, b: number | null) => (a && b ? `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(1)}%` : '—')
const tone = (a: number | null, b: number | null) => (!a || !b ? 'text-ink-muted' : a >= b ? 'text-gain' : 'text-loss')

const STATUS_LABELS: Record<FarmStatus, string> = { GROWING: 'In the field', HARVESTED: 'In the godown', CLOSED: 'All sold' }
const ENTRY_LABELS: Record<FarmEntryType, string> = { COST: 'Cost', HARVEST: 'Harvest', SALE: 'Sale', LOSS: 'Loss / used at home' }

export function Farm() {
  const { scope } = useScope()
  const q = useFarm(scopePersonId(scope))
  const refresh = useRefreshFarmPrices()
  const [adding, setAdding] = useState<'season' | 'stock' | null>(null)
  const r = q.data
  const active = (r?.seasons ?? []).filter((s) => s.status !== 'CLOSED')
  const closed = (r?.seasons ?? []).filter((s) => s.status === 'CLOSED')

  return (
    <>
      <PageHeader title="Farm">
        <Button variant="quiet" disabled={refresh.isPending} onClick={() => refresh.mutate([])}>
          {refresh.isPending ? 'Fetching prices…' : 'Update mandi prices'}
        </Button>
        {adding === null && (
          <>
            <Button variant="quiet" onClick={() => setAdding('stock')}>
              Add stock in the godown
            </Button>
            <Button onClick={() => setAdding('season')}>Add a crop season</Button>
          </>
        )}
      </PageHeader>
      <ErrorNote error={q.error ?? refresh.error} />

      {r && (
        <>
          <Summary r={r} />
          {r.priceError && <p className="mb-4 max-w-[80ch] text-[14px] text-warn">Prices: {r.priceError}</p>}
          {adding && <SeasonForm stockOnly={adding === 'stock'} onDone={() => setAdding(null)} />}

          {r.seasons.length === 0 && !adding && (
            <div className="max-w-[72ch] py-4 text-ink-muted">
              <p>
                Record each crop season: what was sown and where, what it cost (seed, fertiliser, labour, diesel…), what
                was harvested and what was sold at the mandi. What is still in the godown is valued at today&rsquo;s
                mandi price and counted in net worth; a crop still in the field is shown at its expected yield but not
                counted until it is harvested.
              </p>
              <p className="mt-2">Already have produce in the godown from earlier? Add it as stock.</p>
            </div>
          )}

          {r.stock.length > 0 && <Stock stock={r.stock} />}
          {r.prices.length > 0 && <Prices prices={r.prices} defaultMarket={r.defaultMarket} />}
          <FarmOutlook r={r} />

          {active.length > 0 && (
            <section className="mb-10">
              <h2 className="wide mb-3 text-[19px] font-semibold">Seasons</h2>
              {active.map((s) => (
                <Season key={s.id} s={s} showPerson={scope === 'family'} />
              ))}
            </section>
          )}
          {closed.length > 0 && (
            <section className="mb-10">
              <h2 className="wide mb-3 text-[19px] font-semibold">Earlier seasons</h2>
              <ClosedTable seasons={closed} showPerson={scope === 'family'} />
              {closed.map((s) => (
                <details key={s.id} className="mb-2">
                  <summary className="cursor-pointer text-[14px] text-stamp">
                    {CROPS[s.crop].label}, {SEASON_LABELS[s.season]} {s.year}: entries
                  </summary>
                  <Season s={s} showPerson={scope === 'family'} />
                </details>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}

// ---------------- the top line ----------------

function Summary({ r }: { r: NonNullable<ReturnType<typeof useFarm>['data']> }) {
  const growing = r.growing.reduce((s, g) => s + (g.expectedValue ?? 0), 0)
  return (
    <div className="mb-8 grid gap-6 @2xl:grid-cols-3">
      <div>
        <div className="text-[13px] text-ink-muted">In the godown, at today&rsquo;s price</div>
        <div className="wide num text-[28px] font-semibold">{inr(r.stockValue)}</div>
        <div className="text-[13px] text-ink-muted">Counted in net worth{r.pricesAsOf ? `; prices of ${shortDate(r.pricesAsOf)}` : ''}</div>
      </div>
      <div>
        <div className="text-[13px] text-ink-muted">Still in the field (expected)</div>
        <div className="wide num text-[28px] font-semibold text-ink-muted">{growing ? inr(growing) : '—'}</div>
        <div className="text-[13px] text-ink-muted">
          {r.growing.length
            ? `${r.growing.map((g) => CROPS[g.crop].label).join(', ')}; not counted until harvested`
            : 'Nothing growing recorded'}
        </div>
      </div>
      <div>
        <div className="text-[13px] text-ink-muted">This year ({r.thisFy.fy})</div>
        <div className="wide num text-[28px] font-semibold">{inr(r.thisFy.sales)}</div>
        <div className="text-[13px] text-ink-muted">
          sold, after mandi charges; {inr(r.thisFy.costs)} spent. Farm income is exempt from income tax.
        </div>
      </div>
    </div>
  )
}

// ---------------- the godown ----------------

function Stock({ stock }: { stock: FarmStock[] }) {
  return (
    <section className="mb-10">
      <h2 className="wide mb-3 text-[19px] font-semibold">In the godown</h2>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[720px] text-[15px]">
          <thead>
            <tr className="border-b border-rule-strong text-[13px] text-ink-muted">
              <th className="py-2 text-left font-medium">Crop</th>
              <th className="py-2 text-left font-medium">Whose</th>
              <th className="py-2 text-right font-medium">Quantity</th>
              <th className="py-2 text-right font-medium">Today&rsquo;s price</th>
              <th className="py-2 text-right font-medium">Value</th>
              <th className="py-2 text-right font-medium">Cost to grow</th>
              <th className="py-2 text-right font-medium">Gain</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => (
              <tr key={`${s.personId}-${s.crop}-${s.variety ?? ''}`} className="border-b border-rule">
                <td className="py-2 text-left">
                  {CROPS[s.crop].label} <span className="text-[13px] text-ink-muted">{CROPS[s.crop].gu}</span>
                  {s.variety && <div className="text-[13px]">{s.variety}</div>}
                </td>
                <td className="py-2 text-left">{s.personName}</td>
                <td className="py-2 text-right">
                  {qty(s.quantityQtl)}
                  <div className="text-[12px] text-ink-muted">{inMan(s.quantityQtl)}</div>
                </td>
                <td className="py-2 text-right">
                  {s.price ? `${inr(s.price)}/qtl` : 'no price yet'}
                  <div className="text-[12px] text-ink-muted">
                    {perMan(s.price)} {s.market}
                    {s.priceDate ? `, ${shortDate(s.priceDate)}` : ''}
                    {s.pricedAs.kind === 'CLASS' && s.pricedAs.name ? `; ${PRICE_CLASSES[s.crop]?.find((c) => c.key === s.pricedAs.name)?.label ?? s.pricedAs.name} price` : ''}
                    {s.variety && s.pricedAs.kind === 'CROP' ? `; ${s.variety} not quoted, middle of all varieties` : ''}
                  </div>
                </td>
                <td className="py-2 text-right font-semibold">{s.price ? inr(s.value) : '—'}</td>
                <td className="py-2 text-right">{s.cost !== null ? inr(s.cost) : <span className="text-ink-muted">not recorded</span>}</td>
                <td className={`py-2 text-right ${s.cost !== null && s.price ? (s.value >= s.cost ? 'text-gain' : 'text-loss') : 'text-ink-muted'}`}>
                  {s.cost !== null && s.price ? inr(s.value - s.cost) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------- prices ----------------

function Prices({ prices, defaultMarket }: { prices: CropPrice[]; defaultMarket: string }) {
  const setMarket = useSetFarmMarket()
  const [market, setMarketText] = useState(defaultMarket)
  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="wide text-[19px] font-semibold">Mandi prices</h2>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setMarket.mutate([market])
          }}
        >
          <Field label="Mandi (APMC)">
            <Input className="w-40" value={market} onChange={(e) => setMarketText(e.target.value)} />
          </Field>
          {market.trim() !== defaultMarket && (
            <Button type="submit" variant="quiet" disabled={setMarket.isPending}>
              Use this mandi
            </Button>
          )}
        </form>
      </div>
      <ErrorNote error={setMarket.error} />
      <div className="grid gap-6 @5xl:grid-cols-2">
        {prices.map((p) => (
          <PriceCard key={p.crop} p={p} />
        ))}
      </div>
    </section>
  )
}

function PriceCard({ p }: { p: CropPrice }) {
  const setTarget = useSetFarmPriceTarget()
  const [target, setTargetText] = useState(p.target ? String(p.target) : '')
  const now = p.latest?.modal ?? null
  const rows: [string, number | null][] = [
    ['30-day average', p.avg30],
    ['90-day average', p.avg90],
    ['A year ago', p.yearAgo],
    ...(p.msp ? ([[`MSP (${p.mspSeason})`, p.msp]] as [string, number | null][]) : [])
  ]
  return (
    <div className="rounded-lg border border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-semibold">
          {CROPS[p.crop].label} <span className="text-[13px] font-normal text-ink-muted">{p.market}</span>
        </h3>
        {p.latest && <span className="text-[13px] text-ink-muted">{shortDate(p.latest.date)}</span>}
      </div>
      {p.latest ? (
        <>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="wide num text-[26px] font-semibold">{inr(p.latest.modal)}</span>
            <span className="text-[14px] text-ink-muted">a quintal, {perMan(p.latest.modal)}</span>
          </div>
          {p.varieties.length === 0 && p.latest.min !== null && p.latest.max !== null && p.latest.max > p.latest.min && (
            <div className="text-[13px] text-ink-muted">
              Varieties that day {inr(p.latest.min)}–{inr(p.latest.max)}
            </div>
          )}
          {p.varieties.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {p.varieties.map((v) => (
                <li key={`${v.source}-${v.name}`}>
                  <span className="text-ink-muted">{v.name}</span> <span className="num">{inr(v.modal)}</span>
                  {v.min !== null && v.max !== null && v.max > v.min && (
                    <span className="text-ink-muted">
                      {' '}
                      ({inr(v.min)}–{inr(v.max)})
                    </span>
                  )}
                  {v.source === 'APMC' && <span className="text-ink-muted"> yard</span>}
                  {v.date !== p.latest!.date && <span className="text-ink-muted">, {shortDate(v.date)}</span>}
                </li>
              ))}
            </ul>
          )}
          <table className="num mt-3 w-full text-[14px]">
            <tbody>
              {rows.map(([label, v]) => (
                <tr key={label} className="border-t border-rule">
                  <td className="py-1.5 text-left text-ink-muted">{label}</td>
                  <td className="py-1.5 text-right">{inr(v)}</td>
                  <td className={`w-20 py-1.5 text-right ${tone(now, v)}`}>{v ? `today ${pct(now, v)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.history.length > 5 && (
            <div className="mt-3">
              <PriceLine
                points={p.history.map((h) => ({ date: h.date, close: h.modal }))}
                format={(v) => inr(v)}
                axisFormat={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`}
                label={`${CROPS[p.crop].label} modal price at ${p.market}, ₹ a quintal`}
                reference={p.msp ? { value: p.msp, label: 'MSP' } : null}
                height={160}
              />
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-[14px] text-ink-muted">No price reported at {p.market} lately. Try a bigger mandi nearby.</p>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setTarget.mutate([p.crop, num(target)])
        }}
      >
        <Field label="Tell me when it reaches (₹/qtl)">
          <Input className="w-32" inputMode="numeric" value={target} onChange={(e) => setTargetText(e.target.value)} />
        </Field>
        {(num(target) ?? null) !== p.target && (
          <Button type="submit" variant="quiet" disabled={setTarget.isPending}>
            {num(target) ? 'Save target' : 'Clear target'}
          </Button>
        )}
        {p.target && (
          <span className={`pb-2 text-[13px] ${p.targetReached ? 'font-semibold text-gain' : 'text-ink-muted'}`}>
            {p.targetReached ? 'Reached' : now ? `${inr(p.target - now)} to go` : ''}
          </span>
        )}
      </form>
    </div>
  )
}

// ---------------- seasons ----------------

function ClosedTable({ seasons, showPerson }: { seasons: FarmSeasonView[]; showPerson: boolean }) {
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="num w-full min-w-[720px] text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong text-[13px] text-ink-muted">
            <th className="py-2 text-left font-medium">Crop and season</th>
            {showPerson && <th className="py-2 text-left font-medium">Whose</th>}
            <th className="py-2 text-right font-medium">Acres</th>
            <th className="py-2 text-right font-medium">Harvest</th>
            <th className="py-2 text-right font-medium">Sold for</th>
            <th className="py-2 text-right font-medium">Costs</th>
            <th className="py-2 text-right font-medium">Profit</th>
            <th className="py-2 text-right font-medium">Per acre</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.id} className="border-b border-rule">
              <td className="py-1.5 text-left">
                {CROPS[s.crop].label}, {SEASON_LABELS[s.season]} {s.year}
              </td>
              {showPerson && <td className="py-1.5 text-left">{s.personName}</td>}
              <td className="py-1.5 text-right">{s.areaAcres ?? '—'}</td>
              <td className="py-1.5 text-right">{qty(s.harvestedQtl)}</td>
              <td className="py-1.5 text-right">{inr(s.salesNet)}</td>
              <td className="py-1.5 text-right">{inr(s.costs)}</td>
              <td className={`py-1.5 text-right ${s.profit >= 0 ? 'text-gain' : 'text-loss'}`}>{inr(s.profit)}</td>
              <td className="py-1.5 text-right">{s.profitPerAcre !== null ? inr(s.profitPerAcre) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Season({ s, showPerson }: { s: FarmSeasonView; showPerson: boolean }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState<FarmEntryType | null>(null)
  const del = useDeleteFarmSeason()
  const delEntry = useDeleteFarmEntry()
  const stockOnly = s.season === 'STOCK'
  const facts: [string, string][] = [
    ...(s.areaAcres ? ([['Area', `${s.areaAcres} acres${s.field ? `, ${s.field}` : ''}`]] as [string, string][]) : []),
    ...(s.status === 'GROWING' && s.expectedQtl
      ? ([['Expected', `${qty(s.expectedQtl)} (${inMan(s.expectedQtl)})${s.expectedValue ? `, about ${inr(s.expectedValue)}` : ''}`]] as [string, string][])
      : []),
    ...(s.harvestedQtl ? ([['Harvested', `${qty(s.harvestedQtl)} (${inMan(s.harvestedQtl)})`]] as [string, string][]) : []),
    ...(s.soldQtl ? ([['Sold', `${qty(s.soldQtl)} for ${inr(s.salesNet)} after charges`]] as [string, string][]) : []),
    ...(s.inStockQtl ? ([['In the godown', `${qty(s.inStockQtl)}${s.price ? `, worth ${inr(s.stockValue)} today` : ', no price yet'}`]] as [string, string][]) : []),
    ...(s.costs ? ([['Costs', `${inr(s.costs)}${s.costPerQtl ? `, ${inr(s.costPerQtl)} a quintal` : ''}`]] as [string, string][]) : [])
  ]
  return (
    <article className="mb-6 rounded-lg border border-rule p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-semibold">
          {CROPS[s.crop].label}
          {s.variety ? ` ${s.variety}` : ''} <span className="text-[14px] font-normal text-ink-muted">{CROPS[s.crop].gu}</span>
          <span className="ml-2 text-[14px] font-normal text-ink-muted">
            {SEASON_LABELS[s.season]}
            {stockOnly ? '' : ` ${s.year}`}
            {showPerson ? `, ${s.personName}` : ''}
          </span>
        </h3>
        <span className="rounded-full bg-stamp-wash px-2.5 py-0.5 text-[13px] text-stamp">{STATUS_LABELS[s.status]}</span>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[14px] @2xl:grid-cols-2">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 text-ink-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {!stockOnly && (s.costs > 0 || s.salesNet > 0) && (
        <p className="mt-2 text-[14px]">
          {s.status === 'CLOSED'
            ? 'Profit'
            : s.status === 'GROWING'
              ? `Expected profit (if it yields ${s.expectedQtl ? qty(s.expectedQtl) : 'as expected'} at today’s price)`
              : 'Profit so far (counting what is left at today’s price)'}
          :{' '}
          <b className={s.profit >= 0 ? 'text-gain' : 'text-loss'}>{inr(s.profit)}</b>
          {s.profitPerAcre !== null && <span className="text-ink-muted">, {inr(s.profitPerAcre)} an acre</span>}
        </p>
      )}
      {Object.keys(s.costsByKind).length > 1 && (
        <p className="mt-1 text-[13px] text-ink-muted">
          {(Object.entries(s.costsByKind) as [FarmCostKind, number][])
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${FARM_COST_KINDS[k]} ${inr(v)}`)
            .join(' · ')}
        </p>
      )}

      {s.entries.length > 0 && (
        <table className="num mt-3 w-full text-[14px]">
          <tbody>
            {[...s.entries].reverse().map((e) => (
              <tr key={e.id} className="border-t border-rule">
                <td className="w-24 py-1.5 text-left text-ink-muted">{shortDate(e.date)}</td>
                <td className="py-1.5 text-left">
                  {e.type === 'COST' ? FARM_COST_KINDS[e.costKind ?? 'OTHER'] : ENTRY_LABELS[e.type]}
                  {e.mandi ? <span className="text-ink-muted">, {e.mandi}</span> : null}
                  {e.note ? <span className="text-ink-muted">, {e.note}</span> : null}
                </td>
                <td className="py-1.5 text-right">
                  {e.quantityQtl ? `${qty(e.quantityQtl)}${e.rate ? ` at ${inr(e.rate)}` : ''}` : ''}
                </td>
                <td className={`py-1.5 text-right ${e.type === 'SALE' ? 'text-gain' : ''}`}>
                  {e.type === 'COST' ? `−${inr(e.amount)}` : e.type === 'SALE' ? inr(e.amount - (e.charges ?? 0)) : ''}
                </td>
                <td className="w-16 py-1.5 text-right">
                  <button
                    className="text-[13px] text-ink-muted hover:text-loss"
                    onClick={() => confirm('Remove this entry?') && delEntry.mutate([e.id])}
                    aria-label={`Remove the ${ENTRY_LABELS[e.type].toLowerCase()} of ${shortDate(e.date)}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && <EntryForm s={s} type={adding} onDone={() => setAdding(null)} />}
      {editing && <SeasonForm season={s} onDone={() => setEditing(false)} />}
      {!adding && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!stockOnly && (
            <Button variant="quiet" onClick={() => setAdding('COST')}>
              Add a cost
            </Button>
          )}
          {!stockOnly && s.status !== 'CLOSED' && (
            <Button variant="quiet" onClick={() => setAdding('HARVEST')}>
              Record the harvest
            </Button>
          )}
          {s.inStockQtl > 0 && (
            <Button variant="quiet" onClick={() => setAdding('SALE')}>
              Record a sale
            </Button>
          )}
          {s.inStockQtl > 0 && (
            <Button variant="quiet" onClick={() => setAdding('LOSS')}>
              Used at home or spoilt
            </Button>
          )}
          <Button variant="quiet" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => confirm('Delete this season and all its entries?') && del.mutate([s.id])}>
            Delete
          </Button>
        </div>
      )}
      <ErrorNote error={del.error ?? delEntry.error} />
    </article>
  )
}

/**
 * The variety, searchable: what the mandi reported lately (with its price), the varieties common in
 * Gujarat (found by local names too: "37" is TG-37A, "gini" is jini), then Agmarknet's full list.
 * Beside it, the class it sells as (jini or jadi), used for the price when the variety isn't quoted.
 */
function VarietyField({
  crop,
  market,
  value,
  onChange,
  priceClass,
  onPriceClass
}: {
  crop: CropKey
  market: string
  value: string
  onChange: (v: string) => void
  priceClass: string
  onPriceClass: (v: string) => void
}) {
  const q = useCropVarieties(crop, market || null)
  const reported = q.data?.reported ?? []
  const classes = q.data?.classes ?? []
  const known = findVariety(crop, value)
  const autoClass = known?.cls ?? null
  const cls = priceClass || autoClass
  const clsInfo = classes.find((c) => c.key === cls) ?? PRICE_CLASSES[crop]?.find((c) => c.key === cls)
  const clsPrice = classes.find((c) => c.key === cls)
  const own = reported.find((v) => [value, known?.name, ...(known?.aka ?? [])].some((n) => n && n.toLowerCase() === v.name.toLowerCase()))
  const label = (k: string) => PRICE_CLASSES[crop]?.find((c) => c.key === k)?.label ?? k
  const groups = [
    { label: `Reported at ${market || 'the mandi'} lately`, options: reported.map((v) => ({ value: v.name, detail: `${inr(v.modal)}/qtl, ${shortDate(v.date)}` })) },
    {
      label: 'Common in Gujarat',
      options: (VARIETIES[crop] ?? []).map((v) => ({ value: v.name, aka: v.aka, detail: [v.note, v.cls ? `sells as ${label(v.cls)}` : ''].filter(Boolean).join('; ') }))
    },
    { label: 'Agmarknet’s list', options: (q.data?.all ?? []).map((v) => ({ value: v })) }
  ]
  return (
    <>
      <Field
        label="Variety"
        hint={
          own
            ? `${own.name}: ${inr(own.modal)}/qtl at the mandi, ${shortDate(own.date)}`
            : known
              ? `${known.name}${known.note ? `, ${known.note.toLowerCase()}` : ''}`
              : 'Optional: type to search, e.g. G20, 37, Lokwan'
        }
      >
        <Combobox label="Variety" value={value} onChange={onChange} groups={groups} placeholder="Search, e.g. G20 or 37" className="w-52" />
      </Field>
      {(PRICE_CLASSES[crop]?.length ?? 0) > 0 && (
        <Field
          label="Sells as"
          hint={
            clsPrice?.modal
              ? `${clsInfo?.gu ?? ''} ${inr(clsPrice.modal)}/qtl at Rajkot APMC${clsPrice.min && clsPrice.max ? ` (${inr(clsPrice.min)}–${inr(clsPrice.max)})` : ''}`
              : clsInfo
                ? clsInfo.note
                : 'The yard class, for its price'
          }
        >
          <Select value={priceClass} onChange={(e) => onPriceClass(e.target.value)}>
            <option value="">{autoClass ? `${label(autoClass)} (from the variety)` : 'Not known'}</option>
            {PRICE_CLASSES[crop]!.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.gu})
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  )
}

function QtyInput({ value, unit, onValue, onUnit, label }: { value: string; unit: QtyUnit; onValue: (v: string) => void; onUnit: (u: QtyUnit) => void; label: string }) {
  return (
    <Field label={label} hint={num(value) ? `= ${qty(toQuintals(num(value)!, unit))}` : undefined}>
      <span className="flex gap-1">
        <Input className="w-28" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} />
        <Select value={unit} onChange={(e) => onUnit(e.target.value as QtyUnit)} aria-label="Unit">
          {(Object.keys(QTY_UNITS) as QtyUnit[]).map((u) => (
            <option key={u} value={u}>
              {QTY_UNITS[u].label}
            </option>
          ))}
        </Select>
      </span>
    </Field>
  )
}

function EntryForm({ s, type, onDone }: { s: FarmSeasonView; type: FarmEntryType; onDone: () => void }) {
  const save = useSaveFarmEntry()
  const [date, setDate] = useState(today())
  const [kind, setKind] = useState<FarmCostKind>('SEED')
  const [amount, setAmount] = useState('')
  const [q, setQ] = useState('')
  const [unit, setUnit] = useState<QtyUnit>('MAN')
  const [rate, setRate] = useState('')
  const [rateUnit, setRateUnit] = useState<'QTL' | 'MAN'>('MAN')
  const [charges, setCharges] = useState('')
  const [mandi, setMandi] = useState(s.market ?? '')
  const [note, setNote] = useState('')
  const quintals = num(q) !== null ? toQuintals(num(q)!, unit) : null
  // Rates are often quoted per man (20 kg); store them per quintal.
  const ratePerQtl = num(rate) !== null ? (rateUnit === 'MAN' ? num(rate)! * 5 : num(rate)!) : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(
      [
        {
          seasonId: s.id,
          date,
          type,
          costKind: type === 'COST' ? kind : null,
          quantityQtl: type === 'COST' ? null : quintals,
          rate: type === 'SALE' ? ratePerQtl : null,
          amount: type === 'COST' || type === 'SALE' ? (num(amount) ?? 0) : 0,
          charges: type === 'SALE' ? num(charges) : null,
          mandi: type === 'SALE' ? mandi : null,
          note: note || null
        }
      ],
      { onSuccess: onDone }
    )
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-md bg-sheet p-3">
      <h4 className="mb-2 text-[15px] font-semibold">{type === 'COST' ? 'Add a cost' : ENTRY_LABELS[type]}</h4>
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {type === 'COST' && (
          <>
            <Field label="For">
              <Select value={kind} onChange={(e) => setKind(e.target.value as FarmCostKind)}>
                {(Object.keys(FARM_COST_KINDS) as FarmCostKind[]).map((k) => (
                  <option key={k} value={k}>
                    {FARM_COST_KINDS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (₹)">
              <Input className="w-32" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
          </>
        )}
        {type !== 'COST' && <QtyInput label="How much" value={q} unit={unit} onValue={setQ} onUnit={setUnit} />}
        {type === 'SALE' && (
          <>
            <Field
              label="Rate"
              hint={ratePerQtl && quintals ? `${inr(ratePerQtl)}/qtl; ${inr(ratePerQtl * quintals)} in all` : 'or fill the total below'}
            >
              <span className="flex gap-1">
                <Input className="w-28" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                <Select value={rateUnit} onChange={(e) => setRateUnit(e.target.value as 'QTL' | 'MAN')} aria-label="Rate per">
                  <option value="MAN">₹ a man (20 kg)</option>
                  <option value="QTL">₹ a quintal</option>
                </Select>
              </span>
            </Field>
            <Field label="Total received (₹)" hint="If different from rate × quantity">
              <Input className="w-32" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Mandi charges (₹)" hint="Commission, hamali, transport">
              <Input className="w-28" inputMode="numeric" value={charges} onChange={(e) => setCharges(e.target.value)} />
            </Field>
            <Field label="Sold at">
              <Input className="w-36" value={mandi} onChange={(e) => setMandi(e.target.value)} placeholder="Rajkot APMC" />
            </Field>
          </>
        )}
        <Field label="Note">
          <Input className="w-48" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={save.error} />
    </form>
  )
}

function SeasonForm({ season, stockOnly, onDone }: { season?: FarmSeasonView; stockOnly?: boolean; onDone: () => void }) {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const save = useSaveFarmSeason()
  const saveEntry = useSaveFarmEntry()
  const now = new Date()
  // Kharif is sown in the monsoon and harvested by November; rabi is harvested in March–April.
  const guessSeason: FarmSeasonKind = now.getMonth() >= 5 && now.getMonth() <= 9 ? 'KHARIF' : 'RABI'
  const [personId, setPersonId] = useState(season?.personId ?? scopePersonId(scope) ?? persons.find((p) => /dad|papa|father/i.test(p.name))?.id ?? persons[0]?.id ?? 1)
  const [crop, setCrop] = useState<CropKey>(season?.crop ?? 'GROUNDNUT')
  const [variety, setVariety] = useState(season?.variety ?? '')
  const [priceClass, setPriceClass] = useState(season?.priceClass ?? '')
  const [kind, setKind] = useState<FarmSeasonKind>(season?.season ?? (stockOnly ? 'STOCK' : guessSeason))
  const [year, setYear] = useState(String(season?.year ?? (guessSeason === 'RABI' && now.getMonth() > 9 ? now.getFullYear() + 1 : now.getFullYear())))
  const [field, setField] = useState(season?.field ?? '')
  const [acres, setAcres] = useState(season?.areaAcres ? String(season.areaAcres) : '')
  const [sownOn, setSownOn] = useState(season?.sownOn ?? '')
  const [expected, setExpected] = useState(season?.expectedQtl ? String(season.expectedQtl) : '')
  const [expUnit, setExpUnit] = useState<QtyUnit>(season?.expectedQtl ? 'QTL' : 'MAN')
  const [status, setStatus] = useState<FarmStatus>(season?.status ?? (stockOnly ? 'HARVESTED' : 'GROWING'))
  const [market, setMarket] = useState(season?.market ?? '')
  const [stockQty, setStockQty] = useState('')
  const [stockUnit, setStockUnit] = useState<QtyUnit>('MAN')
  const [costPerUnit, setCostPerUnit] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const input = {
      id: season?.id,
      personId: Number(personId),
      crop,
      variety: variety.trim() || null,
      priceClass: priceClass || null,
      season: kind,
      year: Number(year),
      field: field || null,
      areaAcres: num(acres),
      sownOn: sownOn || null,
      expectedQtl: num(expected) !== null ? toQuintals(num(expected)!, expUnit) : null,
      status,
      market: market || null
    }
    save.mutate([input], {
      onSuccess: (id) => {
        if (!stockOnly) return onDone()
        // Stock from earlier: the season holds one harvest of what is there, and its cost if known.
        const q = num(stockQty)
        if (!q) return onDone()
        const quintals = toQuintals(q, stockUnit)
        const cost = num(costPerUnit)
        saveEntry.mutate([{ seasonId: id, date: today(), type: 'HARVEST', costKind: null, quantityQtl: quintals, rate: null, amount: 0, charges: null, mandi: null, note: 'Stock already in the godown' }], {
          onSuccess: () =>
            cost
              ? saveEntry.mutate(
                  [{ seasonId: id, date: today(), type: 'COST', costKind: 'OTHER', quantityQtl: null, rate: null, amount: Math.round(cost * q), charges: null, mandi: null, note: 'Growing cost of the stock' }],
                  { onSuccess: onDone }
                )
              : onDone()
        })
      }
    })
  }

  return (
    <form onSubmit={submit} className="mb-8 rounded-lg border border-rule-strong p-4">
      <h2 className="mb-3 text-[17px] font-semibold">{season ? 'Edit the season' : stockOnly ? 'Stock already in the godown' : 'A crop season'}</h2>
      <div className="flex flex-wrap items-start gap-4">
        {persons.length > 1 && (
          <Field label="Whose">
            <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Crop">
          <Select value={crop} onChange={(e) => setCrop(e.target.value as CropKey)}>
            {CROP_KEYS.map((k) => (
              <option key={k} value={k}>
                {CROPS[k].label} ({CROPS[k].gu})
              </option>
            ))}
          </Select>
        </Field>
        <VarietyField crop={crop} market={market} value={variety} onChange={setVariety} priceClass={priceClass} onPriceClass={setPriceClass} />
        {!stockOnly && (
          <>
            <Field label="Season">
              <Select value={kind} onChange={(e) => setKind(e.target.value as FarmSeasonKind)}>
                {(['KHARIF', 'RABI', 'SUMMER'] as FarmSeasonKind[]).map((k) => (
                  <option key={k} value={k}>
                    {SEASON_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Harvest year">
              <Input className="w-24" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
            <Field label="Field">
              <Input className="w-40" value={field} onChange={(e) => setField(e.target.value)} placeholder="e.g. the well field" />
            </Field>
            <Field label="Acres">
              <Input className="w-24" inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} />
            </Field>
            <Field label="Sown on">
              <Input type="date" value={sownOn} onChange={(e) => setSownOn(e.target.value)} />
            </Field>
            <QtyInput label="Expected yield" value={expected} unit={expUnit} onValue={setExpected} onUnit={setExpUnit} />
            <Field label="Now">
              <Select value={status} onChange={(e) => setStatus(e.target.value as FarmStatus)}>
                {(Object.keys(STATUS_LABELS) as FarmStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {stockOnly && (
          <>
            <QtyInput label="How much is there" value={stockQty} unit={stockUnit} onValue={setStockQty} onUnit={setStockUnit} />
            <Field label="Harvested in (year)">
              <Input className="w-24" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
            <Field label={`What it cost to grow, ₹ a ${stockUnit === 'MAN' ? 'man' : stockUnit === 'KG' ? 'kg' : 'quintal'}`} hint="Optional: shows the gain">
              <Input className="w-28" inputMode="decimal" value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Price from mandi" hint="Empty: the farm's mandi">
          <Input className="w-36" value={market} onChange={(e) => setMarket(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={save.isPending || saveEntry.isPending}>
          Save
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={save.error ?? saveEntry.error} />
    </form>
  )
}
