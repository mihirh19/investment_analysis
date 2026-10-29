import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PLATFORM_LABELS, type ImportKind, type ImportResult, type Platform } from '@shared/types'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input, Select } from '../components/ui'
import { unwrap, useImports, usePersons, useRunImport, useUndoImport } from '../lib/api'
import { shortDate } from '../lib/format'
import { useScope } from '../lib/scope'

const KINDS: { kind: ImportKind; title: string; what: string; where: string }[] = [
  {
    kind: 'CAS_PDF',
    title: 'CAS statement (PDF)',
    what: 'Every demat account and mutual fund under one PAN: Zerodha, Groww, Coin and direct folios. Detailed CAMS/KFintech statements also bring each purchase and redemption.',
    where:
      'NSDL or CDSL email it every month. For full mutual fund history, request a "Detailed" statement from camsonline.com or mfcentral.com.'
  },
  {
    kind: 'ZERODHA_TRADEBOOK',
    title: 'Zerodha tradebook',
    what: 'Every stock and ETF trade, which gives the true average cost and realised profit.',
    where: 'console.zerodha.com → Reports → Tradebook → Equity. Download the CSV for each financial year.'
  },
  {
    kind: 'GROWW_ORDERS',
    title: 'Groww order history',
    what: 'Stock buys and sells made on Groww.',
    where: 'Groww → Stocks → Reports → Order history. Download the Excel file.'
  },
  {
    kind: 'INDMONEY_US',
    title: 'INDmoney US stocks',
    what: 'US shares and ETFs bought through INDmoney. The holdings report gives units, average price and the date each was first bought (for tax); the order report gives every buy and sell. Import both.',
    where:
      'INDmoney app or web → US Stocks → Reports. Download the Holdings report and the Order report (Excel, .xls) for the full period.'
  },
  {
    kind: 'GENERIC_TRADES',
    title: 'Trades file',
    what: 'Any broker without a supported export.',
    where: 'A CSV or Excel file with the columns shown below.'
  },
  {
    kind: 'BROKER_HOLDINGS',
    title: 'Broker holdings (buy prices)',
    what: 'Your average buy price for each stock, ETF and fund, so invested amount and gains show. NSDL/CDSL statements list units and value, not what you paid. Import the CAS first; this file only adds the prices.',
    where:
      'Zerodha: console.zerodha.com → Portfolio → Holdings → Download (once for Equity, once for Mutual funds if you use Coin). Groww: Stocks → Holdings → Download holdings; Mutual funds → Reports → Holdings statement. Any other broker’s file with ISIN or symbol, quantity and average price (or invested value) works too.'
  },
  {
    kind: 'FUND_PORTFOLIO',
    title: 'Fund portfolio (monthly disclosure)',
    what: 'What a mutual fund or ETF holds, so sectors and companies inside it count in Sectors & exposure. One file can cover all of a fund house’s schemes; only the funds you hold are used.',
    where:
      'Every fund house publishes this monthly on its website as an Excel file. Search “<fund house> monthly portfolio disclosure”, download the latest month and import it. Any person can be selected; the holdings apply to everyone who owns the fund.'
  }
]

const KIND_TITLES = {
  ...Object.fromEntries(KINDS.map((k) => [k.kind, k.title])),
  MANUAL: 'Entered by hand'
} as Record<ImportKind, string>

const TEMPLATE =
  'date,type,symbol,name,isin,quantity,price,fees,currency,market\n' +
  '2024-03-15,BUY,AAPL,Apple Inc,,2.5,172.40,0,USD,US\n' +
  '2024-06-20,DIVIDEND,AAPL,Apple Inc,,0,0.60,0,USD,US'

export function ImportPage() {
  const { scope } = useScope()
  const persons = usePersons().data ?? []
  const run = useRunImport()
  const [params] = useSearchParams()
  const [kind, setKind] = useState<ImportKind>(() =>
    KINDS.some((k) => k.kind === params.get('kind')) ? (params.get('kind') as ImportKind) : 'CAS_PDF'
  )
  const [personId, setPersonId] = useState<number | null>(scope === 'family' ? null : scope)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [typeNewPassword, setTypeNewPassword] = useState(false)
  const [platform, setPlatform] = useState<Platform>('INDMONEY')
  const [result, setResult] = useState<ImportResult | null>(null)

  const owner = personId ?? persons[0]?.id ?? null
  const savedPassword = useQuery({
    queryKey: ['savedPassword', owner],
    queryFn: () => unwrap(window.api.hasSavedCasPassword(owner!)),
    enabled: owner !== null && kind === 'CAS_PDF'
  })

  useEffect(() => {
    setFilePath(null)
    setResult(null)
    run.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const pick = async () => {
    const p = await unwrap(window.api.pickFile(kind))
    if (p) {
      setFilePath(p)
      setResult(null)
      run.reset()
    }
  }

  const submit = () => {
    if (!filePath || owner === null) return
    run.mutate(
      { kind, personId: owner, filePath, platform, password: password.trim() || undefined, rememberPassword: remember },
      {
        onSuccess: (r) => {
          setResult(r)
          setFilePath(null)
          setPassword('')
          setTypeNewPassword(false)
        },
        // Nothing saved opened the file: ask for this file's own password.
        onError: (e) => {
          if (/password/i.test(e instanceof Error ? e.message : String(e))) setTypeNewPassword(true)
        }
      }
    )
  }

  const useSaved = !!savedPassword.data && !typeNewPassword
  const needsPassword = kind === 'CAS_PDF' && !useSaved
  const fileName = filePath?.split(/[\\/]/).pop()

  return (
    <>
      <PageHeader title="Import statements" />

      <div className="grid grid-cols-1 gap-10 @7xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <fieldset>
            <legend className="mb-2 text-[14px] font-medium">What are you importing?</legend>
            <div className="flex flex-col border-t border-rule">
              {KINDS.map((k) => (
                <label
                  key={k.kind}
                  className={
                    'flex cursor-pointer gap-3 border-b border-rule px-1 py-3 ' +
                    (kind === k.kind ? 'bg-sheet' : 'hover:bg-sheet/60')
                  }
                >
                  <input
                    type="radio"
                    name="kind"
                    className="mt-1.5 accent-[var(--stamp)]"
                    checked={kind === k.kind}
                    onChange={() => setKind(k.kind)}
                  />
                  <span>
                    <span className="block font-medium">{k.title}</span>
                    <span className="block max-w-[72ch] text-[14px] text-ink-muted">{k.what}</span>
                    {kind === k.kind && <span className="mt-1 block max-w-[72ch] text-[14px] text-ink">{k.where}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {kind === 'GENERIC_TRADES' && (
            <div className="mt-4">
              <p className="mb-1 text-[14px] text-ink-muted">
                Columns (a header row is required). Type is BUY, SELL or DIVIDEND; for a dividend, put the total
                received in price.
              </p>
              <pre className="overflow-x-auto rounded-md border border-rule bg-sheet p-3 text-[13px] leading-relaxed">
                {TEMPLATE}
              </pre>
              <Button
                variant="quiet"
                className="mt-2 text-[14px]"
                onClick={() => navigator.clipboard.writeText(TEMPLATE + '\n')}
              >
                Copy template
              </Button>
            </div>
          )}

          <div className="mt-6 grid max-w-[640px] grid-cols-2 gap-4">
            <Field label="Whose statement">
              <Select value={owner ?? ''} onChange={(e) => setPersonId(Number(e.target.value))}>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'GENERIC_TRADES' && (
              <Field label="Held with">
                <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                  {(['INDMONEY', 'ZERODHA', 'GROWW', 'OTHER'] as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button variant="quiet" onClick={pick}>
              {filePath ? 'Choose a different file' : 'Choose file'}
            </Button>
            {fileName && <span className="truncate text-[15px]">{fileName}</span>}
          </div>

          {kind === 'CAS_PDF' && filePath && (
            <div className="mt-4 max-w-[640px]">
              {useSaved ? (
                <p className="text-[14px] text-ink-muted">
                  Using the saved PAN and passwords (Settings → PDF passwords); if none opens the file you are asked.{' '}
                  <button className="text-stamp underline" onClick={() => setTypeNewPassword(true)}>
                    Type a different one
                  </button>
                </p>
              ) : (
                <div className="grid grid-cols-2 items-end gap-4">
                  <Field label="PDF password" hint="NSDL/CDSL: usually the PAN in capitals. CAMS: the one you chose.">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                  <label className="mb-6 flex items-center gap-2 text-[14px]">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="accent-[var(--stamp)]"
                    />
                    Remember for this person
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <Button onClick={submit} disabled={!filePath || run.isPending || (needsPassword && !password.trim())}>
              {run.isPending ? 'Importing…' : 'Import'}
            </Button>
          </div>
          <ErrorNote error={run.error} />
          {result && <ResultNote r={result} />}
        </div>

        <History />
      </div>
    </>
  )
}

function ResultNote({ r }: { r: ImportResult }) {
  const parts = [
    r.transactionsAdded && `${r.transactionsAdded} new ${r.transactionsAdded === 1 ? 'entry' : 'entries'}`,
    r.snapshotsAdded &&
      (r.kind === 'FUND_PORTFOLIO'
        ? `${r.snapshotsAdded} fund holdings`
        : r.kind === 'BROKER_HOLDINGS'
          ? `buy prices for ${r.snapshotsAdded} ${r.snapshotsAdded === 1 ? 'holding' : 'holdings'}`
          : `${r.snapshotsAdded} holdings from the statement`),
    r.accountsCreated && `${r.accountsCreated} new ${r.accountsCreated === 1 ? 'account' : 'accounts'}`
  ].filter(Boolean)
  return (
    <div role="status" className="mt-4 max-w-[72ch] rounded-md border border-gain/40 bg-gain/5 px-4 py-3 text-[15px]">
      <p className="font-medium text-gain">Imported {r.fileName}</p>
      <p className="mt-1">
        {parts.length ? parts.join(', ') : 'Nothing new'}
        {r.transactionsSkipped > 0 && `. ${r.transactionsSkipped} entries were already recorded and skipped`}.
      </p>
      {r.notes && r.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[14px]">
          {r.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {r.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[14px] text-warn">
          {r.warnings.slice(0, 8).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {r.warnings.length > 8 && <li>…and {r.warnings.length - 8} more</li>}
        </ul>
      )}
    </div>
  )
}

function History() {
  const imports = useImports()
  const undo = useUndoImport()
  const rows = imports.data ?? []
  return (
    <aside aria-labelledby="history">
      <h2 id="history" className="wide mb-2 text-[17px] font-semibold">
        Imported so far
      </h2>
      {rows.length === 0 && <p className="text-[14px] text-ink-muted">Nothing imported yet.</p>}
      <ul className="border-t border-rule">
        {rows.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-3 border-b border-rule py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[15px]" title={b.fileName}>
                {b.fileName}
              </div>
              <div className="text-[13px] text-ink-muted">
                {KIND_TITLES[b.kind]}, {b.personName}, {shortDate(b.importedAt)}
                {b.summary && `, ${b.summary.transactionsAdded + b.summary.snapshotsAdded} rows`}
              </div>
            </div>
            <Button
              variant="danger"
              className="shrink-0 px-2 py-0.5 text-[13px]"
              disabled={undo.isPending}
              onClick={() => {
                if (confirm(`Remove everything imported from ${b.fileName}?`)) undo.mutate(b.id)
              }}
            >
              Undo
            </Button>
          </li>
        ))}
      </ul>
      <ErrorNote error={undo.error} />
    </aside>
  )
}
