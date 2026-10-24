import { useEffect, useMemo, useState } from 'react'
import { BUCKET_LABELS, BUCKETS, type Bucket, type RebalanceReport, type Targets } from '@shared/types'
import { StackBar } from '../components/charts'
import { Bullet } from '../components/chart/extra'
import { ErrorNote, PageHeader } from '../components/Shell'
import { PageSkeleton } from '../components/Skeleton'
import { Button } from '../components/ui'
import { useRebalance, useSetTargets } from '../lib/api'
import { compactMoney, money, units as fmtUnits } from '../lib/format'
import { stagger } from '../lib/motion'
import { scopePersonId, useScope } from '../lib/scope'

const pct = (v: number | null | undefined, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`
const points = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pts`
const rupees = (v: number | null | undefined) => money(v, 'INR', 0)

const BUCKET_NOTES: Record<Bucket, string> = {
  EQUITY_IN: 'Indian shares, equity funds and the equity part of hybrid funds',
  EQUITY_INTL: 'US shares and international funds',
  DEBT: 'Debt funds, bonds, deposits, EPF, PPF',
  GOLD: 'Gold ETFs and funds, SGBs, physical gold and silver',
  CASH: 'Cash and the cash part of funds'
}

const STATUS: Record<RebalanceReport['buckets'][number]['status'], { label: string; cls: string }> = {
  OK: { label: 'On target', cls: 'text-gain' },
  OVER: { label: 'Above', cls: 'text-warn font-semibold' },
  UNDER: { label: 'Below', cls: 'text-warn font-semibold' },
  NO_TARGET: { label: '—', cls: 'text-ink-muted' }
}

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14">
      <h2 id={id} className="wide text-[19px] font-semibold">
        {title}
      </h2>
      {note ? <div className="mt-0.5 mb-4 max-w-[86ch] text-[14px] text-ink-muted">{note}</div> : <div className="mb-4" />}
      {children}
    </section>
  )
}

/** Keeps a value steady while the user is still typing. */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function Rebalance() {
  const { scope } = useScope()
  const personId = scopePersonId(scope)
  const [newMoneyText, setNewMoneyText] = useState('')
  const [allowSells, setAllowSells] = useState(false)
  const newMoneyInr = useDebounced(Number(newMoneyText.replace(/[,₹\s]/g, '')) || 0)
  const q = useRebalance(personId, { newMoneyInr, allowSells })
  const r = q.data

  if (!r) {
    return (
      <>
        <PageHeader title="Rebalance" />
        <ErrorNote error={q.error} />
        {q.isLoading && <PageSkeleton />}
      </>
    )
  }
  if (r.baseInr <= 0) {
    return (
      <>
        <PageHeader title="Rebalance" />
        <p className="py-8 text-ink-muted">Add holdings to set a target mix.</p>
      </>
    )
  }
  const scopeLabel = scope === 'family' ? 'the family' : 'this person'
  return (
    <div className="[&_td+td]:pl-4 [&_th+th]:pl-4">
      <PageHeader title="Rebalance" />
      <ErrorNote error={q.error} />
      <Headline r={r} />
      <MixSection r={r} />
      <TargetsEditor r={r} personId={personId ?? null} scopeLabel={scopeLabel} />
      {r.targets && (
        <PlanSection
          r={r}
          newMoneyText={newMoneyText}
          setNewMoneyText={setNewMoneyText}
          allowSells={allowSells}
          setAllowSells={setAllowSells}
          family={scope === 'family'}
          loading={q.isFetching}
        />
      )}
    </div>
  )
}

function Headline({ r }: { r: RebalanceReport }) {
  const off = r.buckets.filter((b) => b.status === 'OVER' || b.status === 'UNDER')
  const worst = r.targets
    ? [...r.buckets].sort((a, b) => Math.abs(b.share - (b.target ?? 0)) - Math.abs(a.share - (a.target ?? 0)))[0]
    : null
  const cards: [string, string, string][] = [
    ['Money in the targets', compactMoney(r.baseInr), 'after looking inside funds'],
    [
      'Off target',
      r.targets ? (off.length ? `${off.length} of 5` : 'None') : '—',
      r.targets ? `outside ±${pct(r.targets.band)} points` : 'no target set'
    ],
    [
      'Biggest drift',
      worst && worst.target !== null ? points(worst.share - worst.target) : '—',
      worst && worst.target !== null ? BUCKET_LABELS[worst.bucket] : 'no target set'
    ],
    ['Left out', compactMoney(r.excludedInr), 'property, crypto, policies and other']
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-10 gap-y-4 @2xl:grid-cols-4">
      {cards.map(([k, v, sub], i) => (
        <div key={k} className="anim-page border-t border-rule-strong pt-2" style={stagger(i, 60)}>
          <dt className="text-[13px] text-ink-muted">{k}</dt>
          <dd className="wide text-[20px] font-semibold">{v}</dd>
          <dd className="text-[12px] text-ink-muted">{sub}</dd>
        </div>
      ))}
    </dl>
  )
}

function MixSection({ r }: { r: RebalanceReport }) {
  const t = r.targets
  const rows = r.buckets.filter((b) => b.share > 0 || (b.target ?? 0) > 0)
  const capsKnown = r.caps.some((c) => c.band !== 'OTHER' && c.valueInr > 0)
  return (
    <Section
      id="mix"
      title={t ? 'Where you are against the target' : 'Your mix today'}
      note={
        <>
          Shares of the money in the five buckets, with funds opened up (a hybrid fund counts partly as equity, partly
          as debt). Property, crypto and insurance policies ({compactMoney(r.excludedInr)}) aren't easy to buy or sell
          in parts, so they sit outside the targets.
          {r.targetSource === 'FAMILY' && <strong className="ml-1 text-ink">Using the family target: this person has none of their own.</strong>}
        </>
      }
    >
      {t && (
        <Bullet
          label="Each bucket's share against its target"
          rows={rows.map((b) => ({
            key: b.bucket,
            label: BUCKET_LABELS[b.bucket],
            actual: b.share,
            target: b.target ?? 0,
            low: Math.max(0, (b.target ?? 0) - t.band),
            high: Math.min(1, (b.target ?? 0) + t.band)
          }))}
        />
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
              <th className="py-1.5 font-medium">Bucket</th>
              <th className="num py-1.5 font-medium">Value</th>
              <th className="num py-1.5 font-medium">Share</th>
              {t && <th className="num py-1.5 font-medium">Target</th>}
              {t && <th className="num py-1.5 font-medium">Drift</th>}
              {t && <th className="py-1.5 font-medium">Status</th>}
              <th className="num py-1.5 font-medium">Can't be sold</th>
            </tr>
          </thead>
          <tbody>
            {r.buckets.map((b) => (
              <tr key={b.bucket} className="border-b border-rule">
                <td className="py-1.5">
                  {BUCKET_LABELS[b.bucket]}
                  <div className="text-[12px] text-ink-muted">{BUCKET_NOTES[b.bucket]}</div>
                </td>
                <td className="num py-1.5">{rupees(b.valueInr)}</td>
                <td className="num py-1.5 font-semibold">{pct(b.share, 1)}</td>
                {t && <td className="num py-1.5">{pct(b.target)}</td>}
                {t && <td className="num py-1.5">{b.target !== null ? points(b.share - b.target) : '—'}</td>}
                {t && <td className={`py-1.5 text-[14px] ${STATUS[b.status].cls}`}>{STATUS[b.status].label}</td>}
                <td className="num py-1.5 text-ink-muted">{b.lockedInr > 0 ? rupees(b.lockedInr) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {capsKnown && (
        <div className="mt-8 max-w-[760px]">
          <h3 className="mb-1 text-[15px] font-semibold">Indian equity by company size</h3>
          <p className="mb-2 text-[13px] text-ink-muted">
            Large, mid and small cap as SEBI defines them (AMFI's list), inside funds too.
            {r.caps.find((c) => c.band === 'OTHER')!.share > 0.05 &&
              ` ${pct(r.caps.find((c) => c.band === 'OTHER')!.share)} isn't classified (funds without a portfolio, unlisted).`}
          </p>
          <StackBar
            label="Indian equity by market cap"
            format={(v) => pct(v)}
            segments={(['LARGE', 'MID', 'SMALL'] as const).map((k, i) => ({
              key: k,
              label: `${k[0]}${k.slice(1).toLowerCase()} cap`,
              value: r.caps.find((c) => c.band === k)!.share,
              color: `var(--series-${i + 1})`
            }))}
          />
          <dl className="mt-2 flex flex-wrap gap-x-6 text-[13px] text-ink-muted">
            {(['LARGE', 'MID', 'SMALL'] as const).map((k) => {
              const c = r.caps.find((x) => x.band === k)!
              return (
                <div key={k}>
                  <dt className="inline">{k[0] + k.slice(1).toLowerCase()}: </dt>
                  <dd className="num inline text-ink">{pct(c.share)}</dd>
                  {c.target !== null && <dd className="inline"> (target {pct(c.target)})</dd>}
                </div>
              )
            })}
          </dl>
        </div>
      )}
    </Section>
  )
}

// ---------------- targets editor ----------------

const toText = (t: Targets) => ({
  buckets: Object.fromEntries(BUCKETS.map((b) => [b, String(Math.round(t.buckets[b] * 1000) / 10)])) as Record<Bucket, string>,
  band: String(Math.round(t.band * 1000) / 10),
  caps: t.caps
    ? { LARGE: String(t.caps.LARGE * 100), MID: String(t.caps.MID * 100), SMALL: String(t.caps.SMALL * 100) }
    : null
})

function TargetsEditor({ r, personId, scopeLabel }: { r: RebalanceReport; personId: number | null; scopeLabel: string }) {
  const own = r.targetSource === 'OWN' ? r.targets : null
  const start = own ?? r.targets ?? r.suggestedTargets
  const [open, setOpen] = useState(!r.targets)
  const [form, setForm] = useState(() => toText(start))
  const save = useSetTargets()
  useEffect(() => setForm(toText(own ?? r.targets ?? r.suggestedTargets)), [own, r.targets, r.suggestedTargets])
  useEffect(() => setOpen(!r.targets), [r.targets])

  const n = (s: string) => Number(s.replace('%', '')) || 0
  const total = BUCKETS.reduce((s, b) => s + n(form.buckets[b]), 0)
  const capsTotal = form.caps ? n(form.caps.LARGE) + n(form.caps.MID) + n(form.caps.SMALL) : 100
  const valid = Math.abs(total - 100) < 0.05 && Math.abs(capsTotal - 100) < 0.05 && n(form.band) > 0
  const submit = () =>
    save.mutate(
      {
        personId,
        targets: {
          buckets: Object.fromEntries(BUCKETS.map((b) => [b, n(form.buckets[b]) / 100])) as Record<Bucket, number>,
          band: n(form.band) / 100,
          caps: form.caps ? { LARGE: n(form.caps.LARGE) / 100, MID: n(form.caps.MID) / 100, SMALL: n(form.caps.SMALL) / 100 } : null
        }
      },
      { onSuccess: () => setOpen(false) }
    )
  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <label key={label} className="flex items-center justify-between gap-3 border-b border-rule py-1.5 text-[15px]">
      <span>
        {label}
        {hint && <span className="block text-[12px] text-ink-muted">{hint}</span>}
      </span>
      <span className="flex items-center gap-1 whitespace-nowrap">
        <input
          value={value}
          inputMode="decimal"
          aria-label={`${label}, percent`}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 rounded border border-rule-strong bg-sheet px-2 py-0.5 text-right text-ink"
        />
        %
      </span>
    </label>
  )

  return (
    <Section
      id="targets"
      title="Target mix"
      note={
        r.targets
          ? `Saved for ${scopeLabel}. The allowed drift is how far a bucket can wander before it counts as off target.`
          : `No target yet for ${scopeLabel}. Here is today's mix rounded to 5% steps as a starting point; change it to what you want and save.`
      }
    >
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px]">
            {BUCKETS.filter((b) => (r.targets?.buckets[b] ?? 0) > 0)
              .map((b) => `${BUCKET_LABELS[b]} ${pct(r.targets!.buckets[b])}`)
              .join(' · ')}{' '}
            <span className="text-ink-muted">(±{pct(r.targets?.band)} points)</span>
          </p>
          <Button variant="quiet" onClick={() => setOpen(true)}>
            {r.targetSource === 'FAMILY' ? 'Set one for this person' : 'Change targets'}
          </Button>
        </div>
      ) : (
        <div className="grid max-w-[880px] grid-cols-1 gap-x-12 gap-y-6 @3xl:grid-cols-2">
          <div>
            {BUCKETS.map((b) =>
              field(BUCKET_LABELS[b], form.buckets[b], (v) => setForm((f) => ({ ...f, buckets: { ...f.buckets, [b]: v } })), BUCKET_NOTES[b])
            )}
            <div className={`mt-2 text-right text-[14px] ${Math.abs(total - 100) < 0.05 ? 'text-ink-muted' : 'font-semibold text-loss'}`}>
              Total {Math.round(total * 10) / 10}%{Math.abs(total - 100) >= 0.05 && ' (must be 100%)'}
            </div>
          </div>
          <div>
            {field('Allowed drift', form.band, (v) => setForm((f) => ({ ...f, band: v })), 'points either side, e.g. 5')}
            <label className="mt-4 flex items-center gap-2 text-[15px]">
              <input
                type="checkbox"
                checked={!!form.caps}
                onChange={(e) => setForm((f) => ({ ...f, caps: e.target.checked ? { LARGE: '70', MID: '20', SMALL: '10' } : null }))}
              />
              Also target Indian equity by company size
            </label>
            {form.caps && (
              <div className="mt-1">
                {(['LARGE', 'MID', 'SMALL'] as const).map((k) =>
                  field(`${k[0]}${k.slice(1).toLowerCase()} cap`, form.caps![k], (v) =>
                    setForm((f) => ({ ...f, caps: { ...f.caps!, [k]: v } }))
                  )
                )}
                {Math.abs(capsTotal - 100) >= 0.05 && (
                  <div className="mt-1 text-right text-[14px] font-semibold text-loss">Must add up to 100% ({capsTotal}%)</div>
                )}
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button disabled={!valid || save.isPending} onClick={submit}>
                Save target
              </Button>
              <Button variant="quiet" onClick={() => setForm(toText({ ...r.suggestedTargets, band: n(form.band) / 100 || 0.05 }))}>
                Use today's mix
              </Button>
              {r.targets && (
                <Button variant="quiet" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              )}
              {r.targetSource === 'OWN' && personId !== null && (
                <Button variant="danger" onClick={() => save.mutate({ personId, targets: null })}>
                  Use the family target instead
                </Button>
              )}
            </div>
            {save.error && <p className="mt-2 text-[14px] text-loss">{(save.error as Error).message}</p>}
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------------- plan ----------------

function PlanSection({
  r,
  newMoneyText,
  setNewMoneyText,
  allowSells,
  setAllowSells,
  family,
  loading
}: {
  r: RebalanceReport
  newMoneyText: string
  setNewMoneyText: (v: string) => void
  allowSells: boolean
  setAllowSells: (v: boolean) => void
  family: boolean
  loading: boolean
}) {
  const p = r.plan
  const buys = p.trades.filter((t) => t.action === 'BUY')
  const sells = p.trades.filter((t) => t.action === 'SELL')
  const sum = (xs: typeof p.trades) => xs.reduce((s, t) => s + t.amountInr, 0)
  const now = useMemo(() => new Map(r.buckets.map((b) => [b.bucket, b])), [r.buckets])
  return (
    <Section
      id="plan"
      title="What to do"
      note="New money goes to the buckets furthest below target. With selling allowed, only buckets above their allowed drift are sold, down to the target, picking the sales that cost the least tax: losses and tax-free long-term gains first."
    >
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-[15px]">
          New money to invest
          <span className="flex items-center rounded border border-rule-strong bg-sheet px-2">
            ₹
            <input
              value={newMoneyText}
              inputMode="numeric"
              placeholder="0"
              aria-label="New money to invest, rupees"
              onChange={(e) => setNewMoneyText(e.target.value)}
              className="w-32 bg-transparent px-1 py-1 text-right text-ink outline-none"
            />
          </span>
        </label>
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={allowSells} onChange={(e) => setAllowSells(e.target.checked)} />
          Allow selling (tax-aware)
        </label>
        {loading && <span className="text-[13px] text-ink-muted">Working it out…</span>}
      </div>

      {p.trades.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1.5 font-medium">Do</th>
                <th className="py-1.5 font-medium">What</th>
                <th className="py-1.5 font-medium">Bucket</th>
                <th className="num py-1.5 font-medium">Amount</th>
                <th className="num py-1.5 font-medium">Units</th>
                <th className="num py-1.5 font-medium">Gain</th>
                <th className="num py-1.5 font-medium">Tax</th>
              </tr>
            </thead>
            <tbody>
              {[...sells, ...buys].map((t, i) => (
                <tr key={i} className="border-b border-rule align-top">
                  <td className={`py-1.5 font-semibold ${t.action === 'SELL' ? 'text-loss' : 'text-gain'}`}>
                    {t.action === 'SELL' ? 'Sell' : 'Buy'}
                  </td>
                  <td className="py-1.5">
                    {t.holding ? t.holding.name : <span className="italic">{t.suggestion}</span>}
                    <div className="text-[12px] text-ink-muted">
                      {t.holding ? `${family ? `${t.holding.personName} · ` : ''}${t.holding.accountName}` : 'Not held yet'}
                      {t.note && ` · ${t.note}`}
                    </div>
                  </td>
                  <td className="py-1.5 text-[14px]">{BUCKET_LABELS[t.bucket]}</td>
                  <td className="num py-1.5 font-semibold">{rupees(t.amountInr)}</td>
                  <td className="num py-1.5 text-ink-muted">{t.units !== null ? fmtUnits(Math.round(t.units * 1000) / 1000) : '—'}</td>
                  <td className="num py-1.5">{t.gainInr !== null ? rupees(t.gainInr) : '—'}</td>
                  <td className="num py-1.5">
                    {t.action === 'BUY' ? (
                      '—'
                    ) : t.taxInr === null ? (
                      <span className="text-[13px] text-ink-muted">not known</span>
                    ) : (
                      <>
                        {rupees(t.taxInr)}
                        {(t.slabGainInr ?? 0) > 0 && (
                          <div className="text-[12px] text-ink-muted">+ {rupees(t.slabGainInr)} at slab</div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[14px]">
                <td className="py-2" colSpan={3}>
                  {sells.length > 0 && <>Sell {rupees(sum(sells))} · </>}Buy {rupees(sum(buys))}
                </td>
                <td colSpan={3} />
                <td className="num py-2 font-semibold">
                  {!sells.length
                    ? ''
                    : sells.every((s) => s.taxInr === null)
                      ? 'not known'
                      : sells.some((s) => s.taxInr === null)
                        ? `${rupees(p.taxInr)} + ?`
                        : rupees(p.taxInr)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {p.trades.length > 0 && (
        <div className="mt-6 max-w-[640px]">
          <h3 className="mb-1 text-[15px] font-semibold">The mix after these trades</h3>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                <th className="py-1 font-medium">Bucket</th>
                <th className="num py-1 font-medium">Now</th>
                <th className="num py-1 font-medium">After</th>
                <th className="num py-1 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {p.after
                .filter((a) => a.share > 0.0005 || (now.get(a.bucket)?.target ?? 0) > 0)
                .map((a) => (
                  <tr key={a.bucket} className="border-b border-rule">
                    <td className="py-1">{BUCKET_LABELS[a.bucket]}</td>
                    <td className="num py-1 text-ink-muted">{pct(now.get(a.bucket)?.share, 1)}</td>
                    <td className="num py-1 font-semibold">{pct(a.share, 1)}</td>
                    <td className="num py-1">{pct(now.get(a.bucket)?.target)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {p.notes.length > 0 && (
        <ul className="mt-6 max-w-[90ch] list-disc space-y-1 pl-5 text-[14px] text-ink-muted">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Section>
  )
}
