import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SPEND_CATEGORIES, SPEND_CATEGORY_LABELS, type SpendCategory, type StatementImportResult } from '@shared/ai'
import { Columns, HBars } from '../components/charts'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { pickStatement, useAiStatus, useDeleteStatement, useImportStatement, usePersons, useSetSpendCategory, useSpending } from '../lib/api'
import { compactMoney, money, shortDate } from '../lib/format'
import { scopePersonId, useScope } from '../lib/scope'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
const inr = (v: number | null | undefined) => money(v, 'INR', 0)
const daysTo = (iso: string) => Math.round((Date.parse(iso) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000)

function AddStatement() {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const add = useImportStatement()
  const [personId, setPersonId] = useState<number>(scope === 'family' ? (persons[0]?.id ?? 1) : scope)
  const [file, setFile] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<StatementImportResult | null>(null)
  const needsPassword = add.error instanceof Error && /password/i.test(add.error.message)
  const run = (path: string, pw?: string) => {
    setResult(null)
    add.mutate([{ personId, filePath: path, password: pw || undefined }], { onSuccess: (r) => setResult(r) })
  }
  return (
    <div className="mb-8 rounded-md border border-rule bg-sheet p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Whose">
          <Select value={personId} onChange={(e) => setPersonId(Number(e.target.value))}>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          disabled={add.isPending}
          onClick={async () => {
            const path = await pickStatement()
            if (!path) return
            setFile(path)
            setPassword('')
            run(path)
          }}
        >
          {add.isPending ? 'Claude is reading it…' : 'Add a statement (PDF)'}
        </Button>
        <span className="text-[13px] text-ink-muted">Any bank&rsquo;s card or account statement, or a Zerodha contract note.</span>
      </div>
      {needsPassword && file && (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            run(file, password)
          }}
        >
          <Field label="PDF password" hint="Remembered (encrypted) for this sender’s next statements">
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!password || add.isPending}>
            Open
          </Button>
        </form>
      )}
      {result && (
        <p className={`mt-3 text-[14px] ${result.duplicate ? 'text-ink-muted' : 'text-gain'}`}>
          {result.account}: {result.message}
        </p>
      )}
      {!needsPassword && <ErrorNote error={add.error} />}
    </div>
  )
}

export function Spending() {
  const { scope } = useScope()
  const ai = useAiStatus().data
  const q = useSpending(scopePersonId(scope))
  const setCat = useSetSpendCategory()
  const del = useDeleteStatement()
  const r = q.data
  const [month, setMonth] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cat, setCatFilter] = useState<SpendCategory | ''>('')
  const shownMonth = month ?? r?.byMonth.findLast((m) => m.total > 0)?.month ?? r?.months.at(-1) ?? null
  const mon = r?.byMonth.find((m) => m.month === shownMonth)
  const txns = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    return (r?.transactions ?? []).filter(
      (t) =>
        (!shownMonth || t.date.startsWith(shownMonth)) &&
        (!cat || t.category === cat) &&
        words.every((w) => `${t.description} ${t.merchant ?? ''}`.toLowerCase().includes(w))
    )
  }, [r, shownMonth, search, cat])
  const accountName = (id: number) => {
    const a = r?.accounts.find((x) => x.id === id)
    return a ? `${a.institution}${a.last4 ? ` ••${a.last4}` : ''}` : ''
  }

  return (
    <>
      <PageHeader title="Spending" />
      <ErrorNote error={q.error} />
      {ai && !ai.statements ? (
        <p className="mb-6 max-w-[72ch] rounded-md bg-warn-wash px-3 py-2 text-[14px] text-warn">
          Statements are read by Claude with your own API key.{' '}
          <Link to="/settings" className="underline">
            Turn on &ldquo;Read statements&rdquo; in Settings → Claude
          </Link>{' '}
          to add them here; with Gmail connected they then arrive by themselves.
        </p>
      ) : (
        <AddStatement />
      )}

      {r && r.dues.length > 0 && (
        <section aria-labelledby="dues" className="mb-8">
          <h2 id="dues" className="wide mb-2 text-[19px] font-semibold">
            Card bills to pay
          </h2>
          <ul className="max-w-[720px]">
            {r.dues.map((d) => {
              const days = daysTo(d.dueDate)
              return (
                <li key={d.accountId} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule py-2 text-[15px]">
                  <span>{d.name}</span>
                  <span className="num">
                    <b>{inr(d.totalDue)}</b>
                    {d.minimumDue ? <span className="ml-2 text-[13px] text-ink-muted">minimum {inr(d.minimumDue)}</span> : null}
                    <span className={`ml-3 text-[13px] ${days < 0 ? 'text-loss' : days <= 5 ? 'text-warn' : 'text-ink-muted'}`}>
                      {days < 0 ? `${-days} days late` : days === 0 ? 'due today' : `due ${shortDate(d.dueDate)}`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {r && r.accounts.length === 0 && !q.isLoading && (
        <p className="max-w-[72ch] py-4 text-ink-muted">
          No statements yet. Add a card or bank statement PDF and Claude turns it into transactions sorted by category:
          what you spend each month, where it goes, and when card bills are due.
        </p>
      )}

      {r && r.accounts.length > 0 && (
        <>
          <section aria-labelledby="by-month" className="mb-10">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="by-month" className="wide text-[19px] font-semibold">
                Spending by month
              </h2>
              <span className="text-[13px] text-ink-muted">Card payments, transfers and investments aren&rsquo;t counted as spending</span>
            </div>
            <Columns
              points={r.byMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.total }))}
              format={(v) => inr(v)}
              axisFormat={(v) => compactMoney(v)}
              label="Spending by month"
              seriesLabel="Spent"
              height={200}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.byMonth
                .filter((m) => m.total > 0)
                .map((m) => (
                  <button
                    key={m.month}
                    onClick={() => setMonth(m.month)}
                    aria-pressed={shownMonth === m.month}
                    className={`rounded-full border px-3 py-1 text-[13px] ${shownMonth === m.month ? 'border-stamp bg-stamp-wash text-stamp' : 'border-rule-strong text-ink-muted hover:text-ink'}`}
                  >
                    {monthLabel(m.month)}
                  </button>
                ))}
            </div>
          </section>

          {mon && mon.total > 0 && (
            <section aria-labelledby="by-category" className="mb-10">
              <h2 id="by-category" className="wide mb-3 text-[19px] font-semibold">
                Where {monthLabel(mon.month)}&rsquo;s {inr(mon.total)} went
              </h2>
              <HBars
                label={`Spending by category, ${monthLabel(mon.month)}`}
                series={[{ label: 'Spent', color: 'var(--series-1)' }]}
                format={(v) => `${inr(v)}  ${((v / mon.total) * 100).toFixed(0)}%`}
                rows={Object.entries(mon.byCategory)
                  .sort((a, b) => b[1]! - a[1]!)
                  .map(([k, v]) => ({ key: k, label: SPEND_CATEGORY_LABELS[k as SpendCategory], values: [v!] }))}
                selected={cat || null}
                onSelect={(k) => setCatFilter(cat === k ? '' : (k as SpendCategory))}
              />
            </section>
          )}

          <section aria-labelledby="accounts" className="mb-10">
            <h2 id="accounts" className="wide mb-3 text-[19px] font-semibold">
              Cards and accounts
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                    <th className="py-1.5 font-medium">Card or account</th>
                    <th className="py-1.5 font-medium">Whose</th>
                    <th className="py-1.5 font-medium">Latest statement</th>
                    <th className="num py-1.5 font-medium">Due / balance</th>
                    <th className="num py-1.5 font-medium">Limit used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.accounts.map((a) => {
                    const s = a.latest
                    return (
                      <tr key={a.id} className="border-b border-rule">
                        <td className="py-1.5">
                          {a.institution} {a.name}
                          {a.last4 && <span className="text-ink-muted"> ••{a.last4}</span>}
                        </td>
                        <td className="py-1.5 text-ink-muted">{a.personName}</td>
                        <td className="py-1.5 text-ink-muted">
                          {s ? `${shortDate(s.periodTo ?? s.statementDate)}, ${s.transactions} entries, from ${s.source}` : '—'}
                        </td>
                        <td className="num py-1.5">{s ? inr(a.kind === 'CREDIT_CARD' ? s.totalDue : s.closingBalance) : '—'}</td>
                        <td className="num py-1.5 text-ink-muted">
                          {s?.creditLimit && s.totalDue !== null ? `${Math.round((s.totalDue / s.creditLimit) * 100)}%` : '—'}
                        </td>
                        <td className="py-1.5 text-right">
                          {s && (
                            <button
                              className="px-2 text-[13px] text-loss hover:underline"
                              onClick={() => confirm('Remove this statement and its transactions?') && del.mutate([s.id])}
                            >
                              Remove latest
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="txns">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 id="txns" className="wide text-[19px] font-semibold">
                Transactions{shownMonth ? `, ${monthLabel(shownMonth)}` : ''}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Search: swiggy, amazon…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
                <Select value={cat} onChange={(e) => setCatFilter(e.target.value as SpendCategory | '')}>
                  <option value="">Every category</option>
                  {SPEND_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {SPEND_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
                <Button variant="quiet" onClick={() => setMonth(null)} disabled={!month}>
                  Latest month
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[13px] text-ink-muted">
                    <th className="py-1.5 font-medium">Date</th>
                    <th className="py-1.5 font-medium">What</th>
                    <th className="py-1.5 font-medium">Card or account</th>
                    <th className="py-1.5 font-medium">Category</th>
                    <th className="num py-1.5 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.slice(0, 400).map((t) => (
                    <tr key={t.id} className="border-b border-rule">
                      <td className="py-1 whitespace-nowrap">{shortDate(t.date)}</td>
                      <td className="py-1">
                        {t.merchant ?? t.description}
                        {t.merchant && <div className="text-[12px] text-ink-muted">{t.description}</div>}
                      </td>
                      <td className="py-1 text-ink-muted">{accountName(t.accountId)}</td>
                      <td className="py-1">
                        <select
                          aria-label="Category"
                          value={t.category}
                          onChange={(e) => setCat.mutate([t.id, e.target.value as SpendCategory])}
                          className={`rounded border border-transparent bg-transparent py-0.5 hover:border-rule-strong ${t.edited ? 'font-medium' : ''}`}
                        >
                          {SPEND_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {SPEND_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`num py-1 ${t.amount < 0 ? 'text-gain' : ''}`}>{t.amount < 0 ? `+${inr(-t.amount)}` : inr(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {txns.length === 0 && <p className="py-4 text-[14px] text-ink-muted">Nothing matches.</p>}
            </div>
          </section>
        </>
      )}
    </>
  )
}
