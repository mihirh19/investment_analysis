import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorNote, PageHeader } from '../components/Shell'
import { Button, Field, Input } from '../components/ui'
import {
  openExternal,
  unwrap,
  useDisclosureStatus,
  useMarketStatus,
  useMetalPrices,
  useRefreshMarket,
  useSetGoldPremium,
  useSyncDisclosures
} from '../lib/api'
import { money, shortDate, timeAgo } from '../lib/format'

// What a source had nothing for, and what the app does instead, in that source's own terms.
const MISSED: Record<string, (names: string) => string> = {
  stocks: (n) =>
    `No live price for ${n}. It may be unlisted, renamed or delisted; the last price from your statement is used.`,
  funds: (n) => `No NAV found for ${n}; the last value from your statement is used.`,
  nps: (n) => `No NAV found for ${n}; the last value from your statement is used.`,
  sectors: (n) => `No sector found for ${n}, so it is counted under Other in Sectors & exposure.`,
  dividends: (n) => `No dividend history found for ${n}.`,
  history: (n) => `No price history found for ${n}; its chart starts from your own records.`,
  disclosures: (n) =>
    `Couldn't download the monthly portfolio from ${n}. See Fund portfolios from fund houses below for what to do.`,
  default: (n) => `Nothing found for ${n}.`
}

export function Settings() {
  const status = useMarketStatus()
  const refresh = useRefreshMarket()
  const backup = useMutation({ mutationFn: () => unwrap(window.api.backupDatabase()) })
  const reveal = useMutation({ mutationFn: () => unwrap(window.api.getRecoveryKey()) })
  const restore = useMutation({
    mutationFn: ({ file, key }: { file: string; key: string }) => unwrap(window.api.restoreDatabase(file, key))
  })
  const [restoreFile, setRestoreFile] = useState<string | null>(null)
  const [restoreKey, setRestoreKey] = useState('')
  const [copied, setCopied] = useState(false)

  return (
    <>
      <PageHeader title="Settings & backup" />

      <section aria-labelledby="sources" className="max-w-[880px]">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="sources" className="wide text-[19px] font-semibold">
            Price sources
          </h2>
          <Button
            variant="quiet"
            onClick={() => refresh.mutate([])}
            disabled={refresh.isPending || status.data?.refreshing}
          >
            {refresh.isPending || status.data?.refreshing ? 'Refreshing…' : 'Refresh everything now'}
          </Button>
        </div>
        <p className="mb-3 text-[14px] text-ink-muted">
          All free and public. Stock prices update every minute while NSE or US markets are open, every 30 minutes
          otherwise; fund and NPS NAVs every two hours; sectors and dividends once a day.
        </p>
        <table className="w-full text-[15px]">
          <tbody>
            {(status.data?.sources ?? []).map((s) => (
              <tr key={s.key} className="border-b border-rule align-top">
                <td className="py-2">
                  <span
                    aria-hidden
                    className={
                      'mr-2 inline-block size-2 rounded-full align-middle ' +
                      (s.lastError ? 'bg-warn' : s.lastSuccess ? 'bg-gain' : 'bg-rule-strong')
                    }
                  />
                  {s.label}
                  {s.lastError && <div className="mt-0.5 pl-4 text-[13px] text-warn">{s.lastError}</div>}
                  {s.failed.length > 0 && (
                    <div className="mt-0.5 pl-4 text-[13px] text-ink-muted">
                      {(MISSED[s.key] ?? MISSED.default)(
                        s.failed.slice(0, 6).join(', ') +
                          (s.failed.length > 6 ? ` and ${s.failed.length - 6} more` : '')
                      )}
                    </div>
                  )}
                </td>
                <td className="num py-2 text-[14px] text-ink-muted">
                  {s.lastError && !s.lastSuccess ? 'Not working' : `Updated ${timeAgo(s.lastSuccess)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorNote error={refresh.error ?? status.error} />
        <GoldPremium />
        <Disclosures />
      </section>

      <section aria-labelledby="backup" className="mt-14 max-w-[880px]">
        <h2 id="backup" className="wide mb-2 text-[19px] font-semibold">
          Backup
        </h2>
        <p className="max-w-[72ch] text-[15px] text-ink-muted">
          Your data is encrypted with a key that Windows keeps for your user account on this PC. A backup is an
          encrypted copy you can keep on a pen drive, OneDrive or Google Drive. To open it on a new or reinstalled PC
          you need the recovery key below, so write it down and keep it somewhere safe and separate from the backup.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
            {backup.isPending ? 'Saving…' : 'Save a backup'}
          </Button>
          {backup.data && <span className="text-[14px] text-gain">Saved to {backup.data}</span>}
        </div>
        <ErrorNote error={backup.error} />

        <div className="mt-6">
          {!reveal.data ? (
            <Button variant="quiet" onClick={() => reveal.mutate()}>
              Show recovery key
            </Button>
          ) : (
            <div className="rounded-md border border-rule-strong bg-sheet p-4">
              <div className="mb-1 text-[13px] text-ink-muted">
                Recovery key (anyone with this and a backup can read your data)
              </div>
              <code className="block text-[15px] break-all select-all">{reveal.data.match(/.{1,8}/g)!.join(' ')}</code>
              <div className="mt-3 flex gap-3">
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await navigator.clipboard.writeText(reveal.data!)
                    setCopied(true)
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button variant="quiet" onClick={() => reveal.reset()}>
                  Hide
                </Button>
              </div>
            </div>
          )}
          <ErrorNote error={reveal.error} />
        </div>
      </section>

      <section aria-labelledby="restore" className="mt-14 max-w-[880px]">
        <h2 id="restore" className="wide mb-2 text-[19px] font-semibold">
          Restore
        </h2>
        <p className="max-w-[72ch] text-[15px] text-ink-muted">
          Replaces everything on this computer with a backup, then restarts the app.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="quiet"
              onClick={async () => {
                const f = await unwrap(window.api.pickFile('BACKUP'))
                if (f) setRestoreFile(f)
              }}
            >
              {restoreFile ? 'Choose a different backup' : 'Choose backup file'}
            </Button>
            {restoreFile && <span className="truncate text-[14px]">{restoreFile.split(/[\\/]/).pop()}</span>}
          </div>
          {restoreFile && (
            <div className="flex items-end gap-3">
              <Field label="Recovery key">
                <Input
                  className="w-[560px]"
                  autoComplete="off"
                  spellCheck={false}
                  value={restoreKey}
                  onChange={(e) => setRestoreKey(e.target.value.replace(/\s+/g, ''))}
                />
              </Field>
              <Button
                variant="danger"
                className="border border-loss/50"
                disabled={restore.isPending || restoreKey.length !== 64}
                onClick={() => {
                  if (confirm('Replace all data on this computer with this backup?')) {
                    restore.mutate({ file: restoreFile, key: restoreKey })
                  }
                }}
              >
                Restore and restart
              </Button>
            </div>
          )}
          <ErrorNote error={restore.error} />
        </div>
      </section>
    </>
  )
}

/** India's gold price sits above the international price by the import duty; this sets that gap. */
function GoldPremium() {
  const prices = useMetalPrices()
  const save = useSetGoldPremium()
  const [pct, setPct] = useState<string | null>(null)
  const p = prices.data
  if (!p) return null
  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate([Number(pct ?? p.premiumPct)], { onSuccess: () => setPct(null) })
      }}
    >
      <Field
        label="India premium on gold and silver (%)"
        hint="Import duty added to the international price. 6% since the July 2024 budget."
      >
        <Input
          type="number"
          min="0"
          max="30"
          step="0.1"
          className="w-28"
          value={pct ?? String(p.premiumPct)}
          onChange={(e) => setPct(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="quiet" disabled={save.isPending || pct === null}>
        {save.isPending ? 'Recalculating…' : 'Save'}
      </Button>
      {p.goldPerGram && (
        <span className="mb-2 text-[14px] text-ink-muted">Gold now {money(p.goldPerGram, 'INR', 0)}/g for 24K</span>
      )}
      <ErrorNote error={save.error} />
    </form>
  )
}

const STATE_LABELS: Record<string, { label: string; tone: string }> = {
  UPDATED: { label: 'Downloaded', tone: 'text-gain' },
  UP_TO_DATE: { label: 'Up to date', tone: 'text-ink-muted' },
  NOT_FOUND: { label: 'File not found', tone: 'text-warn' },
  NO_PAGE: { label: 'No page listed', tone: 'text-warn' },
  ERROR: { label: 'Could not download', tone: 'text-warn' }
}

/** One row per fund house you hold: what the automatic monthly download found. */
function Disclosures() {
  const status = useDisclosureStatus()
  const sync = useSyncDisclosures()
  const rows = status.data ?? []
  return (
    <div className="mt-10">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="wide text-[17px] font-semibold">Fund portfolios from fund houses</h3>
        <Button variant="quiet" onClick={() => sync.mutate([true])} disabled={sync.isPending}>
          {sync.isPending ? 'Checking…' : 'Download again now'}
        </Button>
      </div>
      <p className="mb-3 max-w-[80ch] text-[14px] text-ink-muted">
        Each fund house publishes what every scheme holds once a month. The app finds the latest file on the page AMFI
        lists for that fund house, downloads it, and matches it to the funds and ETFs you hold. It checks daily and only
        downloads when a new month appears.
      </p>
      {rows.length === 0 && (
        <p className="text-[14px] text-ink-muted">Nothing checked yet. It runs after the first price refresh.</p>
      )}
      <table className="w-full text-[14px]">
        <tbody>
          {rows.map((r) => {
            const st = STATE_LABELS[r.state]
            return (
              <tr key={r.amc} className="border-b border-rule align-top">
                <td className="py-2 pr-4">
                  <div className="font-medium">{r.amc}</div>
                  {r.funds.length > 0 && <div className="text-[12px] text-ink-muted">{r.funds.join(', ')}</div>}
                  {r.unmatched.length > 0 && (
                    <div className="text-[12px] text-warn">Not in the file: {r.unmatched.join(', ')}</div>
                  )}
                  {r.message && <div className="text-[12px] text-warn">{r.message}</div>}
                </td>
                <td className={`py-2 pr-4 whitespace-nowrap ${st.tone}`}>
                  {st.label}
                  {r.period && (
                    <div className="text-[12px] text-ink-muted">{shortDate(`${r.period}-01`).replace(/^1 /, '')}</div>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {r.page && (
                    <button className="text-stamp hover:underline" onClick={() => void openExternal(r.page!)}>
                      Open page
                    </button>
                  )}
                  {(r.state === 'NOT_FOUND' || r.state === 'ERROR') && (
                    <Link to="/import?kind=FUND_PORTFOLIO" className="ml-3 block text-stamp hover:underline">
                      Import its file
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ErrorNote error={sync.error ?? status.error} />
    </div>
  )
}
