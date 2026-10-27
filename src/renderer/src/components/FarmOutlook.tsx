import { useState } from 'react'
import { CROPS, type CropOutlook, type FarmReport } from '@shared/farm'
import { ErrorNote } from './Shell'
import { Button, Field, Input } from './ui'
import { openExternal, useAiStatus, useMarketNote, useSetFarmHolding, useSetFarmTransport } from '../lib/api'
import { money, shortDate } from '../lib/format'
import { ChatMarkdown } from '../lib/markdown'
import { CropExports } from './CropExports'

const inr = (v: number | null | undefined) => money(v, 'INR', 0)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`)
const tone = (v: number | null | undefined) => (!v ? 'text-ink-muted' : v > 0 ? 'text-gain' : 'text-loss')
const signed = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${inr(Math.abs(v))}`)

/** Selling: past seasons, what waiting costs, the mandis today, and Claude's note. Facts for the choice, not advice. */
export function FarmOutlook({ r }: { r: FarmReport }) {
  if (!r.outlook.length) return null
  return (
    <section className="mb-10" aria-labelledby="selling">
      <h2 id="selling" className="wide mb-1 text-[19px] font-semibold">
        Selling: outlook and facts
      </h2>
      <p className="mb-4 max-w-[80ch] text-[14px] text-ink-muted">
        How prices moved from this month in past years, what keeping the produce costs, where it fetches most today, and
        what is in the news. Nobody can know the price ahead: these are the facts for the choice, which is yours.
      </p>
      <HoldingForm r={r} />
      {r.outlook.map((o) => (
        <CropOutlookCard key={o.crop} o={o} r={r} />
      ))}
    </section>
  )
}

function HoldingForm({ r }: { r: FarmReport }) {
  const save = useSetFarmHolding()
  const [f, setF] = useState({
    storage: String(r.holdingCosts.storagePerQtlMonth),
    loss: String(r.holdingCosts.lossPctPerMonth),
    interest: String(r.holdingCosts.interestPct)
  })
  const changed =
    Number(f.storage) !== r.holdingCosts.storagePerQtlMonth || Number(f.loss) !== r.holdingCosts.lossPctPerMonth || Number(f.interest) !== r.holdingCosts.interestPct
  return (
    <form
      className="mb-5 flex flex-wrap items-end gap-3 rounded-md bg-sheet p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate([{ storagePerQtlMonth: Number(f.storage), lossPctPerMonth: Number(f.loss), interestPct: Number(f.interest) }])
      }}
    >
      <span className="w-full text-[14px] font-semibold">What keeping it in the godown costs</span>
      <Field label="Storage (₹ a quintal a month)" hint="0 in your own godown">
        <Input className="w-28" inputMode="decimal" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })} />
      </Field>
      <Field label="Weight lost drying (% a month)" hint="Fresh groundnut loses moisture">
        <Input className="w-28" inputMode="decimal" value={f.loss} onChange={(e) => setF({ ...f, loss: e.target.value })} />
      </Field>
      <Field label="Interest (% a year)" hint="e.g. the KCC rate">
        <Input className="w-24" inputMode="decimal" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} />
      </Field>
      {changed && (
        <Button type="submit" variant="quiet" disabled={save.isPending}>
          Save
        </Button>
      )}
      <ErrorNote error={save.error} />
    </form>
  )
}

function CropOutlookCard({ o, r }: { o: CropOutlook; r: FarmReport }) {
  const [allMandis, setAllMandis] = useState(false)
  const c = CROPS[o.crop]
  const h = o.pattern?.horizons ?? []
  return (
    <article className="mb-6 rounded-lg border border-rule p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-semibold">
          {c.label} <span className="text-[14px] font-normal text-ink-muted">{o.market}</span>
        </h3>
        {o.price && <span className="num text-[15px]">today {inr(o.price)}/qtl</span>}
      </div>

      {o.pattern ? (
        <div className="mt-3">
          <h4 className="mb-1 text-[14px] font-semibold">Past seasons: from {o.pattern.fromMonth}, the price over the next…</h4>
          <table className="num w-full max-w-[560px] text-[14px]">
            <thead>
              <tr className="text-[12px] text-ink-muted">
                <th className="py-1 text-left font-normal" />
                {h.map((x) => (
                  <th key={x.months} className="py-1 text-right font-normal">
                    {x.months} month{x.months > 1 ? 's' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Typical year', 'median'],
                  ['Worst year', 'min'],
                  ['Best year', 'max']
                ] as const
              ).map(([label, k]) => (
                <tr key={k} className="border-t border-rule">
                  <td className="py-1.5 text-left text-ink-muted">{label}</td>
                  {h.map((x) => (
                    <td key={x.months} className={`py-1.5 text-right ${tone(x[k])}`}>
                      {pct(x[k])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-rule">
                <td className="py-1.5 text-left text-ink-muted">Years</td>
                {h.map((x) => (
                  <td key={x.months} className="py-1.5 text-right text-ink-muted">
                    {x.changes.length}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {h[1]?.changes.length ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              Over 3 months: {h[1].changes.map((x) => `${x.year} ${pct(x.pct)}`).join(', ')}. Monthly averages at {o.market}; past years don&rsquo;t say what this one will do.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[14px] text-ink-muted">Past seasons appear once Agmarknet&rsquo;s monthly averages are fetched (with the next price update).</p>
      )}

      {o.hold && (
        <div className="mt-4">
          <h4 className="mb-1 text-[14px] font-semibold">
            Your {o.hold.qtl.toLocaleString('en-IN', { maximumFractionDigits: 2 })} qtl in the godown: {inr(o.hold.sellNow)} if sold at today&rsquo;s price
          </h4>
          <table className="num w-full max-w-[680px] text-[14px]">
            <thead>
              <tr className="text-[12px] text-ink-muted">
                <th className="py-1 text-left font-normal">Waiting</th>
                <th className="py-1 text-right font-normal">Storage and interest</th>
                <th className="py-1 text-right font-normal">Against selling today: worst</th>
                <th className="py-1 text-right font-normal">typical</th>
                <th className="py-1 text-right font-normal">best</th>
              </tr>
            </thead>
            <tbody>
              {o.hold.horizons.map((x) => (
                <tr key={x.months} className="border-t border-rule">
                  <td className="py-1.5 text-left">
                    {x.months} month{x.months > 1 ? 's' : ''}
                  </td>
                  <td className="py-1.5 text-right text-ink-muted">{inr(x.cost)}</td>
                  <td className={`py-1.5 text-right ${tone(x.low)}`}>{signed(x.low)}</td>
                  <td className={`py-1.5 text-right ${tone(x.typical)}`}>{signed(x.typical)}</td>
                  <td className={`py-1.5 text-right ${tone(x.high)}`}>{signed(x.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-ink-muted">
            If prices moved as in past years&rsquo; worst, typical and best, after {r.holdingCosts.lossPctPerMonth}% weight lost a month,
            {r.holdingCosts.storagePerQtlMonth ? ` ₹${r.holdingCosts.storagePerQtlMonth} a quintal a month storage,` : ''} and{' '}
            {r.holdingCosts.interestPct}% interest on the money not yet received.
          </p>
        </div>
      )}

      {o.mandis && <Mandis o={o} all={allMandis} onAll={() => setAllMandis((a) => !a)} />}
      {o.arrivals?.latest != null && (
        <p className="mt-2 text-[13px] text-ink-muted">
          Arrivals at {o.market}: {o.arrivals.latest} t on {shortDate(o.arrivals.latestDate)}
          {o.arrivals.avg30 != null ? `, ${o.arrivals.avg30} t a day on average over the last 30 days` : ''}. Heavy arrivals in harvest weeks
          usually weigh on prices.
        </p>
      )}
      <CropExports crop={o.crop} />
      <Note o={o} />
    </article>
  )
}

function Mandis({ o, all, onAll }: { o: CropOutlook; all: boolean; onAll: () => void }) {
  const save = useSetFarmTransport()
  const rows = o.mandis!.rows
  const here = rows.find((x) => x.here)
  const shown = all ? rows : rows.slice(0, 8)
  if (here && !shown.includes(here)) shown.push(here)
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-[14px] font-semibold">
        Gujarat mandis on {shortDate(o.mandis!.date)} <span className="font-normal text-ink-muted">(weighted average price)</span>
      </h4>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[620px] text-[14px]">
          <thead>
            <tr className="text-[12px] text-ink-muted">
              <th className="py-1 text-left font-normal">Mandi</th>
              <th className="py-1 text-right font-normal">Price</th>
              <th className="py-1 text-right font-normal">Arrivals</th>
              <th className="py-1 text-right font-normal">Transport (₹/qtl)</th>
              <th className="py-1 text-right font-normal">Left after transport</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.name} className={`border-t border-rule ${m.here ? 'font-semibold' : ''}`}>
                <td className="py-1.5 text-left">
                  {m.name} <span className="text-[12px] font-normal text-ink-muted">{m.district}</span>
                </td>
                <td className="py-1.5 text-right">{inr(m.modal)}</td>
                <td className="py-1.5 text-right text-ink-muted">{m.arrivalsT != null ? `${m.arrivalsT} t` : '—'}</td>
                <td className="py-1.5 text-right">
                  <input
                    aria-label={`Transport to ${m.name}, ₹ a quintal`}
                    inputMode="numeric"
                    defaultValue={m.transport ?? ''}
                    className="w-20 rounded border border-rule-strong bg-sheet px-1.5 py-0.5 text-right"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      const n = v === '' ? null : Number(v)
                      if (n !== m.transport && (n === null || Number.isFinite(n))) save.mutate([m.name, n])
                    }}
                  />
                </td>
                <td className="py-1.5 text-right">{m.net !== null ? inr(m.net) : <span className="text-ink-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button className="mt-1 text-[13px] text-stamp hover:underline" onClick={onAll}>
          {all ? 'Show fewer' : `Show all ${rows.length} mandis`}
        </button>
      )}
      <ErrorNote error={save.error} />
    </div>
  )
}

function Note({ o }: { o: CropOutlook }) {
  const ai = useAiStatus().data
  const get = useMarketNote()
  const n = get.data ?? o.note
  const on = !!ai?.marketNotes
  return (
    <div className="mt-4 rounded-md bg-sheet p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="text-[14px] font-semibold">Market note</h4>
        {on && (
          <Button variant="quiet" disabled={get.isPending} onClick={() => get.mutate([o.crop, !!n])}>
            {get.isPending ? 'Searching the news…' : n ? 'Write a fresh one' : 'Get a market note'}
          </Button>
        )}
      </div>
      {n ? (
        <>
          {n.range && (
            <p className="mt-2 text-[15px]">
              Likely range, next 1–3 months: <b className="num">{inr(n.range.low)}–{inr(n.range.high)}</b> a quintal at {n.market}
              {n.confidence && <span className="ml-2 rounded-full bg-stamp-wash px-2 py-0.5 text-[12px] text-stamp">{n.confidence} confidence</span>}
            </p>
          )}
          <div className="mt-2 text-[14px] leading-relaxed">
            <ChatMarkdown text={n.text} openLink={(url) => void openExternal(url)} />
          </div>
          {n.sources.length > 0 && (
            <ul className="mt-2 text-[12px] text-ink-muted">
              {n.sources.map((s) => (
                <li key={s.url}>
                  <button className="text-left text-stamp hover:underline" onClick={() => void openExternal(s.url)}>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-ink-muted">Written by Claude on {shortDate(n.at.slice(0, 10))} from a web search. An outlook, not a promise.</p>
        </>
      ) : on ? (
        <p className="mt-1 text-[13px] text-ink-muted">Claude searches today&rsquo;s news for what is moving the price and writes a short note with a likely range and its sources.</p>
      ) : (
        <p className="mt-1 text-[13px] text-ink-muted">
          Turn on &ldquo;Market notes for the farm&rdquo; in Settings → Claude for a note on what is moving the price, with sources.
        </p>
      )}
      <ErrorNote error={get.error} />
    </div>
  )
}
