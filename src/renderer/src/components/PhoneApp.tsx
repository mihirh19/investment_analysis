import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ErrorNote } from './Shell'
import { Button, Field, Input, Select } from './ui'
import {
  useAllowPhoneDrive,
  useConfigurePhone,
  useGoogleSetup,
  usePhoneSync,
  useSyncPhone,
  useTurnOffPhone
} from '../lib/api'
import { timeAgo } from '../lib/format'

/** A step of the setup: done, the one to do now, or still ahead. */
function Step({ n, state, title, children }: { n: number; state: 'done' | 'now' | 'later'; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-rule py-3">
      <span
        aria-hidden
        className={
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ' +
          (state === 'done' ? 'bg-gain text-white' : state === 'now' ? 'bg-stamp text-white' : 'bg-rule text-ink-muted')
        }
      >
        {state === 'done' ? '✓' : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${state === 'later' ? 'text-ink-muted' : ''}`}>{title}</div>
        {state !== 'later' && children && <div className="mt-1 text-[14px]">{children}</div>}
      </div>
    </li>
  )
}

/** Settings section: the iPhone (or any phone) app, synced through the person's own Google Drive. */
export function PhoneApp() {
  const google = useGoogleSetup().data
  const q = usePhoneSync()
  const configure = useConfigurePhone()
  const allow = useAllowPhoneDrive()
  const sync = useSyncPhone()
  const off = useTurnOffPhone()
  const s = q.data
  const [account, setAccount] = useState('')
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const accounts = google?.accounts ?? []
  const chosen = s?.account ?? (account || accounts[0]?.email || '')
  useEffect(() => {
    if (!s?.phoneUrl) return setQr(null)
    void QRCode.toDataURL(s.phoneUrl, { margin: 1, width: 220, color: { dark: '#1b2440', light: '#ffffff' } }).then(setQr)
  }, [s?.phoneUrl])

  if (!s || !google) return null
  const step1 = google.configured && s.webClient
  const step2 = step1 && !!s.account && s.driveAllowed
  const step3 = step2 && s.passphraseSet
  const live = step3 && !!s.lastSync

  return (
    <section aria-labelledby="phone" className="mb-12 max-w-[880px]">
      <h2 id="phone" className="wide mb-2 text-[19px] font-semibold">
        Phone app
      </h2>
      <p className="mb-2 max-w-[72ch] text-[14px] text-ink-muted">
        See everything on your iPhone and record rent, fuel, a PUC or a renewal on the go. It installs from Safari
        (free, no App Store) and syncs through a hidden folder in your own Google Drive. Both sides lock the data
        with a passphrase only you know, so Google stores only scrambled bytes. Statements are still imported here.
      </p>
      <ol className="max-w-[760px]">
        <Step n={1} state={step1 ? 'done' : 'now'} title="Google sign-in with a Web application client">
          {!google.configured
            ? 'Set it up in Google accounts above, choosing a Web application client.'
            : 'The app has your sign-in client saved as a Desktop app one, which the phone can’t use. In Google accounts above, click “Change it” and paste a Web application client’s ID and secret with the box ticked (if yours already is a Web application client, paste the same one again). Then sign the account in again.'}
        </Step>
        <Step n={2} state={step2 ? 'done' : step1 ? 'now' : 'later'} title="The Google account whose Drive carries it">
          {accounts.length === 0 ? (
            'Connect a Google account above first.'
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Account">
                <Select value={chosen} onChange={(e) => setAccount(e.target.value)} disabled={!!s.account && s.driveAllowed}>
                  {accounts.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                disabled={allow.isPending}
                onClick={() =>
                  configure.mutate([{ account: chosen }], { onSuccess: () => allow.mutate([chosen]) })
                }
              >
                {allow.isPending ? 'Finish in your browser…' : 'Allow Drive'}
              </Button>
              <span className="text-[13px] text-ink-muted">Google asks once; tick the Drive box.</span>
            </div>
          )}
        </Step>
        <Step n={3} state={step3 ? 'done' : step2 ? 'now' : 'later'} title="A passphrase for the phone">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (pass !== again) return
              configure.mutate([{ account: chosen, passphrase: pass }], {
                onSuccess: () => {
                  setPass('')
                  setAgain('')
                  sync.mutate([])
                }
              })
            }}
          >
            <Field label="Passphrase" hint="10+ characters; a few unrelated words">
              <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Again">
              <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button type="submit" disabled={!pass || pass !== again || configure.isPending}>
              {s.passphraseSet ? 'Change passphrase' : 'Set passphrase'}
            </Button>
            {pass && again && pass !== again && <span className="text-[13px] text-loss">They don’t match.</span>}
          </form>
          <p className="mt-2 text-[13px] text-ink-muted">
            You type it once on the phone. It can’t be recovered: if you forget it, set a new one here and on the phone.
          </p>
        </Step>
        <Step n={4} state={live ? 'done' : step3 ? 'now' : 'later'} title="Open it on the iPhone">
          <div className="flex flex-wrap gap-6">
            {qr && <img src={qr} width={180} height={180} alt="QR code that opens the phone app" className="rounded-md border border-rule" />}
            <div className="max-w-[50ch] text-[14px]">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Point the iPhone camera at the code and open the link in Safari.</li>
                <li>
                  Tap Share, then <b>Add to Home Screen</b>. Open it from the Home Screen from now on.
                </li>
                <li>
                  In the Home Screen app, sign in with {s.account ?? 'the same Google account'} and type the passphrase
                  (it keeps its own storage, separate from Safari&rsquo;s).
                </li>
              </ol>
              {s.phoneUrl && (
                <p className="mt-3 text-[13px] text-ink-muted">
                  If the Home Screen app asks for the link, send it to the phone and paste it there:{' '}
                  <button
                    className="text-stamp hover:underline"
                    onClick={() => {
                      void navigator.clipboard.writeText(s.phoneUrl!)
                      setCopied(true)
                    }}
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </p>
              )}
            </div>
          </div>
        </Step>
      </ol>

      {step3 && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[14px]">
          <Button variant="quiet" disabled={sync.isPending} onClick={() => sync.mutate([])}>
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
          <span className="text-ink-muted">
            {s.lastSync ? `Synced ${timeAgo(s.lastSync)}` : 'Not synced yet'}
            {s.lastApplied ? `, ${s.lastApplied} entr${s.lastApplied === 1 ? 'y' : 'ies'} from the phone` : ''}. Every
            10 minutes while this app runs.
          </span>
          <button
            className="text-[13px] text-loss hover:underline"
            onClick={() => confirm('Stop syncing with the phone?') && off.mutate([])}
          >
            Turn off
          </button>
        </div>
      )}
      {s.lastError && <p className="mt-2 text-[14px] text-warn">{s.lastError}</p>}
      <ErrorNote error={configure.error ?? allow.error ?? sync.error ?? off.error} />
    </section>
  )
}
