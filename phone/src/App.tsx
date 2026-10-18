import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { setClientFrom, signedInEmail, signIn, signOut } from './lib/google'
import { useData } from './lib/data'
import { store } from './lib/store'
import { Home } from './screens/Home'
import { Holdings } from './screens/Holdings'
import { Plan } from './screens/Plan'
import { Properties } from './screens/Properties'
import { Spending } from './screens/Spending'
import { Vehicles } from './screens/Vehicles'
import { field, Primary, Sheet } from './ui'

// The chat (and the Claude SDK) loads only when Ask is first opened, keeping the app quick to start.
const Ask = lazy(() => import('./screens/Ask').then((m) => ({ default: m.Ask })))

type Tab = 'home' | 'holdings' | 'spending' | 'property' | 'vehicles' | 'plan'

function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full flex-col justify-center px-6 py-10">
      <div
        className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-stamp text-[28px] font-bold text-white dark:text-[#10162a]"
        aria-hidden
      >
        ₹
      </div>
      <h1 className="wide mb-3 text-[26px] leading-tight font-semibold">{title}</h1>
      {children}
    </main>
  )
}

/** First open without the link's sign-in client (a Home Screen app keeps its own storage on iPhone). */
function Setup() {
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (setClientFrom(text)) location.reload()
    else setBad(true)
  }
  return (
    <Gate title="Set up the phone app">
      <p className="mb-4 text-[15px] text-ink-muted">
        On the computer, open Family Portfolio → Settings → Phone app.{' '}
        {standalone
          ? 'This Home Screen app keeps its own storage, separate from Safari, so it needs the link once more: tap Copy link there, send it to this phone (WhatsApp or email to yourself), copy it here and paste it below.'
          : 'Scan the QR code with this phone’s camera and open the link in Safari; then tap Share → Add to Home Screen.'}
      </p>
      <form onSubmit={submit}>
        <input
          aria-label="Phone link from the computer"
          placeholder="Paste the phone link"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`${field} mb-3`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setBad(false)
          }}
        />
        <Primary type="submit" disabled={!text.trim()}>
          Set up
        </Primary>
      </form>
      {bad && (
        <p className="mt-3 text-[15px] text-loss">
          That isn&rsquo;t the phone link. Copy it from Settings → Phone app on the computer.
        </p>
      )}
    </Gate>
  )
}

function Unlock() {
  const { unlock, error } = useData()
  const [pass, setPass] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await unlock(pass, remember)
    setBusy(false)
  }
  return (
    <Gate title="Unlock your portfolio">
      <p className="mb-5 text-[15px] text-ink-muted">
        The passphrase you set on the computer, in Settings → Phone app.
      </p>
      <form onSubmit={submit}>
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Passphrase"
          placeholder="Passphrase"
          className={`${field} mb-3`}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        <label className="mb-5 flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-5 w-5"
          />
          Remember on this phone
        </label>
        <Primary type="submit" disabled={!pass || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Primary>
      </form>
      {error && <p className="mt-4 text-[15px] text-loss">{error}</p>}
    </Gate>
  )
}

function Menu({ onClose }: { onClose: () => void }) {
  const { sync, syncing, lock, fetchedAt, pending, error } = useData()
  return (
    <Sheet title="Sync and settings" onClose={onClose}>
      <dl className="mb-4 text-[15px]">
        <div className="flex justify-between border-b border-rule py-2">
          <dt className="text-ink-muted">Google account</dt>
          <dd>{signedInEmail() ?? '—'}</dd>
        </div>
        <div className="flex justify-between border-b border-rule py-2">
          <dt className="text-ink-muted">Downloaded</dt>
          <dd>
            {fetchedAt ? new Date(fetchedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          </dd>
        </div>
        <div className="flex justify-between border-b border-rule py-2">
          <dt className="text-ink-muted">Waiting for the computer</dt>
          <dd>{pending.length}</dd>
        </div>
      </dl>
      {error && <p className="mb-3 text-[14px] text-warn">{error}</p>}
      <div className="flex flex-col gap-2 pb-2">
        <Primary disabled={syncing} onClick={() => void sync()}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Primary>
        <button className="min-h-11 rounded-xl border border-rule-strong" onClick={() => void lock()}>
          Lock (ask for the passphrase again)
        </button>
        <button
          className="min-h-11 rounded-xl text-loss"
          onClick={async () => {
            if (!confirm('Sign out and remove the data from this phone? Entries not yet synced are lost.')) return
            await store.forget()
            signOut()
            location.reload()
          }}
        >
          Sign out and remove from this phone
        </button>
      </div>
      <p className="pb-3 text-[13px] text-ink-muted">
        Statements are imported on the computer. It syncs every 10 minutes while it runs; entries made here are applied
        then.
      </p>
    </Sheet>
  )
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { key: 'holdings', label: 'Holdings', icon: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { key: 'spending', label: 'Spending', icon: 'M3 7h18v12H3zM3 11h18M7 15h3' },
  { key: 'property', label: 'Property', icon: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6' },
  { key: 'vehicles', label: 'Vehicles', icon: 'M5 16l1.5-5h11L19 16M5 16h14v3H5zM7.5 19v1.5M16.5 19v1.5' },
  { key: 'plan', label: 'Plan', icon: 'M3 20l6-7 4 3 8-10M15 6h6v6' }
]

export function App() {
  const { phase, snapshot, syncing, error, sync } = useData()
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('fp.tab') as Tab) || 'home')
  const [menu, setMenu] = useState(false)
  const [asking, setAsking] = useState(false)
  useEffect(() => sessionStorage.setItem('fp.tab', tab), [tab])

  if (phase === 'starting') return <main className="min-h-full" />
  if (phase === 'setup') return <Setup />
  if (phase === 'signin')
    return (
      <Gate title="Family Portfolio">
        <p className="mb-6 text-[15px] text-ink-muted">
          Sign in with the Google account you chose on the computer. The app only uses its own hidden folder in your
          Drive, where the data is kept locked with your passphrase.
        </p>
        <Primary onClick={() => signIn()}>Sign in with Google</Primary>
        {error && <p className="mt-4 text-[15px] text-loss">{error}</p>}
      </Gate>
    )
  if (phase === 'empty')
    return (
      <Gate title="Nothing synced yet">
        <p className="mb-6 text-[15px] text-ink-muted">
          On the computer, open Settings → Phone app, finish the steps and press Sync now. Then come back here.
        </p>
        <Primary disabled={syncing} onClick={() => void sync()}>
          {syncing ? 'Looking…' : 'Look again'}
        </Primary>
        {error && <p className="mt-4 text-[15px] text-loss">{error}</p>}
      </Gate>
    )
  if (phase === 'locked' || !snapshot) return <Unlock />

  const tabs = TABS.filter(
    (t) =>
      (t.key !== 'spending' || Object.values(snapshot.scopes).some((x) => x.spending)) &&
      (t.key !== 'property' || snapshot.properties.length) &&
      (t.key !== 'vehicles' || snapshot.vehicles.length) &&
      (t.key !== 'plan' || snapshot.forecast)
  )
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-paper/95 px-4 pt-2 pb-2 backdrop-blur">
        <h1 className="wide text-[20px] font-semibold">{tabs.find((t) => t.key === tab)?.label ?? 'Home'}</h1>
        <div className="flex items-center gap-1">
          {snapshot.ai && (
            <button
              onClick={() => setAsking(true)}
              className="min-h-10 rounded-full bg-stamp px-4 text-[14px] font-semibold text-white dark:text-[#10162a]"
            >
              Ask
            </button>
          )}
          <button
            onClick={() => setMenu(true)}
            className="flex min-h-10 items-center gap-2 rounded-full px-3 text-[13px] text-ink-muted"
            aria-label="Sync and settings"
          >
            <span className={syncing ? 'animate-spin' : ''} aria-hidden>
              ↻
            </span>
            {syncing
              ? 'Syncing'
              : `Prices ${snapshot.pricesAsOf ? new Date(snapshot.pricesAsOf).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'as of last sync'}`}
          </button>
        </div>
      </header>
      <main className="flex-1 px-3 pb-28">
        {tab === 'home' && <Home />}
        {tab === 'holdings' && <Holdings />}
        {tab === 'spending' && <Spending />}
        {tab === 'property' && <Properties />}
        {tab === 'vehicles' && <Vehicles />}
        {tab === 'plan' && <Plan />}
      </main>
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-sheet/95 pt-1 backdrop-blur"
        aria-label="Sections"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${tab === t.key ? 'text-stamp' : 'text-ink-muted'}`}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
      {menu && <Menu onClose={() => setMenu(false)} />}
      {asking && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-paper" />}>
          <Ask onClose={() => setAsking(false)} />
        </Suspense>
      )}
    </div>
  )
}
