import { useState } from 'react'
import type { GoogleAccountView } from '@shared/mail'
import { ErrorNote } from './Shell'
import { Button, Field, Input, Select } from './ui'
import {
  openExternal,
  useCheckMail,
  useConnectGoogle,
  useDisconnectGoogle,
  useGoogleSetup,
  usePersons,
  useSaveGoogleClient,
  useSetGooglePerson
} from '../lib/api'
import { shortDate, timeAgo } from '../lib/format'

const PHONE_ORIGIN = 'https://mihirh19.github.io'
const PHONE_APP = 'https://mihirh19.github.io/investment_analysis/'

/** A value to paste into Google Cloud, with a copy button. */
function Copyable({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-paper px-1.5 py-0.5 text-[12px]">{text}</code>
      <button
        type="button"
        className="text-[12px] text-stamp hover:underline"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

const CONSOLE = {
  driveApi: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  project: 'https://console.cloud.google.com/projectcreate',
  gmailApi: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
  consent: 'https://console.cloud.google.com/auth/overview',
  audience: 'https://console.cloud.google.com/auth/audience',
  clients: 'https://console.cloud.google.com/auth/clients'
}

const STATUS: Record<GoogleAccountView['status'], { text: string; cls: string }> = {
  OK: { text: 'Connected', cls: 'text-gain' },
  NEVER: { text: 'Not checked yet', cls: 'text-ink-muted' },
  ERROR: { text: 'Needs attention', cls: 'text-warn' },
  RECONNECT: { text: 'Sign in again', cls: 'text-loss' }
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button type="button" className="text-stamp hover:underline" onClick={() => void openExternal(href)}>
      {children}
    </button>
  )
}

/** Settings section: connect Gmail accounts so statements import by themselves. */
export function GoogleAccounts() {
  const setup = useGoogleSetup()
  const persons = usePersons().data ?? []
  const connect = useConnectGoogle()
  const check = useCheckMail()
  const [showSetup, setShowSetup] = useState(false)
  const [personId, setPersonId] = useState<number | null>(null)
  const s = setup.data
  const who = personId ?? persons[0]?.id ?? 1

  return (
    <section aria-labelledby="google" className="mb-12 max-w-[880px]">
      <h2 id="google" className="wide mb-2 text-[19px] font-semibold">
        Google accounts
      </h2>
      <p className="mb-4 max-w-[72ch] text-[14px] text-ink-muted">
        Connect the Gmail accounts your statements arrive in, and they import by themselves: the monthly CAS, and
        Zerodha, Groww or INDmoney tradebooks and holdings sent as Excel or CSV (read by the app itself, no Claude
        needed). Card and bank statements and contract notes are read too when Claude is switched on below. The app
        only reads (it cannot send, delete or change mail), checks every 12 hours while it runs, and keeps the sign-in
        encrypted on this computer.
      </p>

      {s && !s.configured && !showSetup && (
        <Button onClick={() => setShowSetup(true)}>Set up Google sign-in</Button>
      )}
      {s && !s.configured && showSetup && <ClientSetup onDone={() => setShowSetup(false)} />}

      {s?.configured && (
        <>
          {s.accounts.length > 0 && (
            <ul className="mb-4 border-t border-rule">
              {s.accounts.map((a) => (
                <AccountRow key={a.email} a={a} persons={persons} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Statements in it belong to">
              <Select value={who} onChange={(e) => setPersonId(Number(e.target.value))}>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button disabled={connect.isPending} onClick={() => connect.mutate([who])}>
              {connect.isPending ? 'Finish signing in in your browser…' : s.accounts.length ? 'Connect another account' : 'Connect a Google account'}
            </Button>
            {s.accounts.length > 0 && (
              <Button variant="quiet" disabled={check.isPending} onClick={() => check.mutate([undefined])}>
                {check.isPending ? 'Checking…' : 'Check for statements now'}
              </Button>
            )}
          </div>
          {connect.isPending && (
            <p className="mt-2 text-[13px] text-ink-muted">
              Pick the account in the browser. Google warns that the app isn&rsquo;t verified, because it is your own
              private app: choose Advanced, then Go to Family Portfolio, and allow reading email.
            </p>
          )}
          <ErrorNote error={connect.error ?? check.error} />
          <p className="mt-4 text-[13px] text-ink-muted">
            Google sign-in uses your own client, ending …{s.clientIdEnding}.{' '}
            <button className="text-stamp hover:underline" onClick={() => setShowSetup((x) => !x)}>
              {showSetup ? 'Hide' : 'Change it'}
            </button>
          </p>
          {showSetup && <ClientSetup onDone={() => setShowSetup(false)} />}
        </>
      )}
      <ErrorNote error={setup.error} />
    </section>
  )
}

function AccountRow({ a, persons }: { a: GoogleAccountView; persons: { id: number; name: string }[] }) {
  const setPerson = useSetGooglePerson()
  const disconnect = useDisconnectGoogle()
  const check = useCheckMail()
  const connect = useConnectGoogle()
  const st = STATUS[a.status]
  return (
    <li className="border-b border-rule py-3 text-[14px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium">{a.email}</span>
        <span className={st.cls}>{st.text}</span>
        <span className="text-ink-muted">{a.lastCheck ? `checked ${timeAgo(a.lastCheck)}` : ''}</span>
        <span className="ml-auto flex items-center gap-2">
          <Select
            aria-label={`Whose statements arrive at ${a.email}`}
            value={a.personId}
            onChange={(e) => setPerson.mutate([a.email, Number(e.target.value)])}
          >
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {a.status === 'RECONNECT' ? (
            <Button disabled={connect.isPending} onClick={() => connect.mutate([a.personId])}>
              Sign in again
            </Button>
          ) : (
            <Button variant="quiet" disabled={check.isPending} onClick={() => check.mutate([a.email])}>
              {check.isPending ? 'Checking…' : 'Check now'}
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => confirm(`Disconnect ${a.email}? Statements already imported stay.`) && disconnect.mutate([a.email])}
          >
            Disconnect
          </Button>
        </span>
      </div>
      {a.message && <p className={`mt-1 ${a.status === 'OK' ? 'text-ink-muted' : st.cls}`}>{a.message}</p>}
      {a.recent.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[13px] text-ink-muted hover:text-ink">Recent statements</summary>
          <table className="mt-1 w-full text-[13px]">
            <tbody>
              {a.recent.map((x, i) => (
                <tr key={i} className="border-b border-rule">
                  <td className="py-1 pr-3 whitespace-nowrap">{shortDate(x.received)}</td>
                  <td className="py-1 pr-3">{x.subject}</td>
                  <td className={`py-1 ${x.result === 'IMPORTED' ? 'text-gain' : 'text-warn'}`}>{x.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ErrorNote error={setPerson.error ?? disconnect.error ?? check.error ?? connect.error} />
    </li>
  )
}

/** The one-time Google Cloud setup: the person's own OAuth client, so no server sits in between. */
function ClientSetup({ onDone }: { onDone: () => void }) {
  const save = useSaveGoogleClient()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [web, setWeb] = useState(true)
  return (
    <div className="anim-pop mt-2 rounded-md border border-rule bg-sheet p-5 text-[14px]">
      <p className="mb-3 max-w-[72ch]">
        Once, about five minutes: Google lets a private app read your own mail through a sign-in you create in
        Google Cloud. It is free and needs no card.
      </p>
      <ol className="mb-4 max-w-[72ch] list-decimal space-y-2 pl-5">
        <li>
          <Ext href={CONSOLE.project}>Create a project</Ext> in Google Cloud, named Family Portfolio, signed in with
          either of your Google accounts.
        </li>
        <li>
          <Ext href={CONSOLE.gmailApi}>Enable the Gmail API</Ext> and, for the phone app, the{' '}
          <Ext href={CONSOLE.driveApi}>Google Drive API</Ext> for that project.
        </li>
        <li>
          Open <Ext href={CONSOLE.consent}>Google Auth Platform</Ext> and click Get started: app name Family Portfolio,
          your email for support and contact, audience <b>External</b>.
        </li>
        <li>
          Under <Ext href={CONSOLE.audience}>Audience</Ext>, click <b>Publish app</b> and confirm. Left in Testing,
          Google ends the sign-in every 7 days. It stays unverified, which is fine for your own family; Google only
          shows a warning when you sign in.
        </li>
        <li>
          Under <Ext href={CONSOLE.clients}>Clients</Ext>, create a client of type <b>Web application</b> (it serves
          this computer and the phone app alike). Add:
          <div className="mt-1 grid gap-1 text-[13px]">
            <div>
              Authorised JavaScript origin: <Copyable text={PHONE_ORIGIN} />
            </div>
            <div>
              Authorised redirect URIs: <Copyable text="http://127.0.0.1:53682/" /> and <Copyable text={PHONE_APP} />
            </div>
          </div>
          Then copy its client ID and secret here. (A <b>Desktop app</b> client works for Gmail only.)
        </li>
      </ol>
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate([{ clientId, clientSecret, web }], { onSuccess: onDone })
        }}
      >
        <Field label="Client ID">
          <Input required value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" />
        </Field>
        <Field label="Client secret">
          <Input required type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-3">
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} />
          It is a Web application client (needed for the phone app)
        </label>
      </form>
      <ErrorNote error={save.error} />
    </div>
  )
}
