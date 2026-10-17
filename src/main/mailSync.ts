import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoogleAccountView, GoogleSetup, MailFound } from '@shared/mail'
import { accessToken, DRIVE_APPDATA_SCOPE, Gmail, GoogleReconnectError, revoke, signIn, type GoogleClient } from './google'
import type { FetchFn } from './market/http'

/**
 * Connected Google accounts and the statements fetched from them. Each account belongs to one
 * person (the one whose statements arrive in that mailbox), so a family with two Gmail accounts
 * connects both and each imports into the right person.
 *
 * Jobs run oldest-unseen first and remember the messages they have handled, so nothing is imported
 * twice. A failure (no saved PDF password, an unreadable file) is kept in the account's log for
 * the Settings page instead of stopping the others.
 */

const CLIENT_KEY = 'google:client'
const ACCOUNTS_KEY = 'google:accounts'

/** NSDL, CDSL, CAMS and KFintech consolidated account statements. */
export const CAS_QUERY =
  'has:attachment filename:pdf {subject:"consolidated account statement" subject:CAS subject:e-CAS subject:eCAS}'

interface StoredAccount {
  email: string
  personId: number
  /** Encrypted refresh token. */
  token: string
  addedAt: string
  lastCheck: string | null
  status: GoogleAccountView['status']
  message: string | null
  /** Receipt time of the newest CAS handled; later checks look only after it. */
  casAfter: string | null
  seen: string[]
  recent: MailFound[]
  /** What the account allowed at its last sign-in (Gmail always; Drive for the phone app). */
  scopes?: string[]
}

export interface MailDeps {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  encrypt(plain: string): string
  decrypt(stored: string): string
  fetch?: FetchFn
  openUrl?(url: string): void | Promise<void>
  personName(id: number): string
  /** Imports a CAS PDF for a person with their saved password; resolves to a short summary. */
  importCas(personId: number, filePath: string): Promise<string>
  now?(): Date
}

export function createMail(d: MailDeps) {
  const now = () => (d.now ? d.now() : new Date())
  const load = (): StoredAccount[] => JSON.parse(d.getSetting(ACCOUNTS_KEY) ?? '[]') as StoredAccount[]
  const store = (xs: StoredAccount[]) => d.setSetting(ACCOUNTS_KEY, JSON.stringify(xs))
  const update = (email: string, patch: Partial<StoredAccount>) =>
    store(load().map((a) => (a.email === email ? { ...a, ...patch } : a)))
  const client = (): (GoogleClient & { web?: boolean }) | null => {
    const raw = d.getSetting(CLIENT_KEY)
    return raw ? (JSON.parse(d.decrypt(raw)) as GoogleClient & { web?: boolean }) : null
  }
  const requireClient = () => {
    const c = client()
    if (!c) throw new Error('Set up Google sign-in first: paste the client ID and secret from Google Cloud.')
    return c
  }
  let running: Promise<GoogleAccountView[]> | null = null

  const view = (a: StoredAccount): GoogleAccountView => ({
    email: a.email,
    personId: a.personId,
    personName: d.personName(a.personId),
    addedAt: a.addedAt,
    lastCheck: a.lastCheck,
    status: a.status,
    message: a.message,
    recent: a.recent
  })

  async function syncCas(a: StoredAccount, gmail: Gmail): Promise<{ found: MailFound[]; casAfter: string | null; seen: string[] }> {
    // First time: just the latest statement from the last two months. Then: anything newer.
    const q = a.casAfter
      ? `${CAS_QUERY} after:${Math.floor(Date.parse(a.casAfter) / 1000)}`
      : `${CAS_QUERY} newer_than:60d`
    const ids = (await gmail.search(q, a.casAfter ? 10 : 1)).filter((id) => !a.seen.includes(id)).reverse()
    const found: MailFound[] = []
    let casAfter = a.casAfter
    const seen = [...a.seen]
    const dir = join(tmpdir(), 'family-portfolio-mail')
    for (const id of ids) {
      const msg = await gmail.message(id)
      const pdfs = msg.attachments.filter((x) => /\.pdf$/i.test(x.filename))
      // A statement that only lacked its password is tried again on the next check.
      let retry = false
      for (const att of pdfs) {
        const base = { at: now().toISOString(), job: 'CAS' as const, subject: msg.subject, received: msg.date }
        const file = join(dir, `${id}-${att.attachmentId.slice(0, 12)}.pdf`)
        try {
          mkdirSync(dir, { recursive: true })
          writeFileSync(file, await gmail.attachment(id, att.attachmentId))
          found.push({ ...base, result: 'IMPORTED', message: await d.importCas(a.personId, file) })
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          if (/password/i.test(m)) retry = true
          found.push({
            ...base,
            result: 'FAILED',
            message: /password/i.test(m)
              ? `${m}. Import one CAS by hand with "Remember the password" ticked; later ones then import by themselves.`
              : m
          })
        } finally {
          rmSync(file, { force: true })
        }
      }
      if (retry) break
      seen.push(id)
      if (!casAfter || msg.date > casAfter) casAfter = msg.date
    }
    return { found, casAfter, seen: seen.slice(-500) }
  }

  async function checkOne(a: StoredAccount): Promise<void> {
    const c = requireClient()
    try {
      const gmail = new Gmail(await accessToken(c, d.decrypt(a.token), d.fetch), d.fetch)
      const cas = await syncCas(a, gmail)
      const imported = cas.found.filter((x) => x.result === 'IMPORTED').length
      const failed = cas.found.filter((x) => x.result === 'FAILED').length
      update(a.email, {
        lastCheck: now().toISOString(),
        status: failed ? 'ERROR' : 'OK',
        message: failed
          ? cas.found.find((x) => x.result === 'FAILED')!.message
          : imported
            ? `Imported ${imported} statement${imported > 1 ? 's' : ''}.`
            : 'Nothing new.',
        casAfter: cas.casAfter,
        seen: cas.seen,
        recent: [...cas.found.reverse(), ...a.recent].slice(0, 20)
      })
    } catch (e) {
      update(a.email, {
        lastCheck: now().toISOString(),
        status: e instanceof GoogleReconnectError ? 'RECONNECT' : 'ERROR',
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }

  return {
    setup(): GoogleSetup {
      const c = client()
      return {
        configured: !!c,
        clientIdEnding: c ? c.clientId.split('.')[0].slice(-6) : null,
        webClient: !!c?.web,
        accounts: load().map(view)
      }
    },

    /** The sign-in client's public ID (for the phone app) and whether it is a "Web application" one. */
    clientInfo(): { clientId: string; web: boolean } | null {
      const c = client()
      return c ? { clientId: c.clientId, web: !!c.web } : null
    },

    /** A short-lived token for an account; asks for the Drive folder when `drive` is set. */
    async tokenFor(email: string, opts: { drive?: boolean } = {}): Promise<string> {
      const a = load().find((x) => x.email === email)
      if (!a) throw new Error(`${email} is not connected. Connect it in Settings → Google accounts.`)
      if (opts.drive && !(a.scopes ?? []).includes(DRIVE_APPDATA_SCOPE))
        throw new Error(`${email} has not allowed Drive for the phone app yet. Click “Allow Drive” in Settings → Phone app.`)
      return accessToken(requireClient(), d.decrypt(a.token), d.fetch)
    },

    hasDrive(email: string): boolean {
      return (load().find((x) => x.email === email)?.scopes ?? []).includes(DRIVE_APPDATA_SCOPE)
    },

    saveClient(input: GoogleClient & { web?: boolean }): GoogleSetup {
      const clientId = input.clientId.trim()
      const clientSecret = input.clientSecret.trim()
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
        throw new Error('The client ID ends in .apps.googleusercontent.com; copy it from Google Cloud → Credentials.')
      if (clientSecret.length < 10) throw new Error('Paste the client secret too (it starts with GOCSPX-).')
      const before = client()
      d.setSetting(CLIENT_KEY, d.encrypt(JSON.stringify({ clientId, clientSecret, web: !!input.web })))
      // A sign-in belongs to the client it was made with: a new client means signing in again.
      if (before && before.clientId !== clientId)
        store(
          load().map((a) => ({
            ...a,
            status: 'RECONNECT' as const,
            message: 'The Google sign-in client changed: click “Sign in again”.',
            scopes: []
          }))
        )
      return this.setup()
    },

    /** Opens Google's sign-in in the browser and adds (or reconnects) the account that signs in. */
    async connect(personId: number, opts: { drive?: boolean } = {}): Promise<GoogleAccountView> {
      if (!d.openUrl) throw new Error('No browser to sign in with')
      const { email, refreshToken, scopes } = await signIn(requireClient(), d.openUrl, d.fetch, undefined, opts)
      const existing = load().find((a) => a.email === email)
      const acct: StoredAccount = existing
        ? { ...existing, token: d.encrypt(refreshToken), status: 'NEVER', message: null, scopes }
        : {
            scopes,
            email,
            personId,
            token: d.encrypt(refreshToken),
            addedAt: now().toISOString(),
            lastCheck: null,
            status: 'NEVER',
            message: null,
            casAfter: null,
            seen: [],
            recent: []
          }
      store([...load().filter((a) => a.email !== email), acct])
      await checkOne(acct)
      return view(load().find((a) => a.email === email)!)
    },

    setPerson(email: string, personId: number): GoogleSetup {
      update(email, { personId })
      return this.setup()
    },

    async disconnect(email: string): Promise<GoogleSetup> {
      const a = load().find((x) => x.email === email)
      if (a) await revoke(d.decrypt(a.token), d.fetch)
      store(load().filter((x) => x.email !== email))
      return this.setup()
    },

    /** Checks every connected account (or one), one at a time. Overlapping calls share a run. */
    check(email?: string): Promise<GoogleAccountView[]> {
      if (running) return running
      running = (async () => {
        try {
          if (!client()) return []
          for (const a of load()) if (!email || a.email === email) await checkOne(a)
          return load().map(view)
        } finally {
          running = null
        }
      })()
      return running
    },

    /** True when an automatic check is due (every 12 hours). */
    due(): boolean {
      if (!client()) return false
      const accts = load().filter((a) => a.status !== 'RECONNECT')
      return accts.some((a) => !a.lastCheck || now().getTime() - Date.parse(a.lastCheck) > 12 * 3600_000)
    }
  }
}

export type Mail = ReturnType<typeof createMail>
