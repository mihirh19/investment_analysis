import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoogleAccountView, GoogleSetup, MailFound, MailHit, MailJob } from '@shared/mail'
import {
  accessToken,
  DRIVE_APPDATA_SCOPE,
  Gmail,
  GoogleReconnectError,
  revoke,
  signIn,
  type GoogleClient,
  type MailAttachment,
  type MailMessage
} from './google'
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
/** Card and bank statements and contract notes; never a CAS (that has its own job). */
export const STATEMENT_QUERY =
  'has:attachment filename:pdf {subject:"credit card statement" subject:"card statement" subject:"account statement" subject:"statement of account" subject:"e-statement" subject:estatement subject:"monthly statement" subject:"debit card" subject:"contract note"} -subject:"consolidated account statement" -subject:CAS'

/** Broker reports sent as spreadsheets: Zerodha Console, Groww and INDmoney downloads. */
export const REPORT_QUERY =
  'has:attachment {filename:xlsx filename:xls filename:csv} {from:zerodha from:groww from:indmoney from:indstocks}'

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
  /** The same for card and bank statements and contract notes. */
  statementsAfter?: string | null
  /** The same for broker reports (Excel/CSV). */
  reportsAfter?: string | null
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
  importCas(personId: number, filePath: string, password?: string): Promise<string>
  /** Reads a card or bank statement or a contract note (with Claude); resolves to a short summary. */
  importStatement?(personId: number, filePath: string, source: string, password?: string): Promise<string>
  /** Whether reading statements with Claude is switched on. */
  statementsEnabled?(): boolean
  /** Imports a broker's Excel/CSV report (tradebook, holdings…) by its columns; resolves to a summary. */
  importReport?(personId: number, filePath: string, fileName: string): Promise<string>
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

  interface Job {
    job: MailJob
    query: string
    /** Receipt time of the newest message handled, kept per account. */
    after: string | null
    /** First check: how far back, and how many. */
    firstWindow: string
    firstMax: number
    run(personId: number, filePath: string, messageId: string, fileName: string): Promise<string>
    passwordHint: string
    /** Which attachments to take (PDFs unless said). */
    attachments?: RegExp
  }

  const MAIL_DIR = join(tmpdir(), 'family-portfolio-mail')
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

  /** Saves one attachment to a temporary file, runs fn on it, then deletes it. */
  async function withAttachment<T>(gmail: Gmail, messageId: string, att: MailAttachment, fn: (file: string) => Promise<T>): Promise<T> {
    // Keep the attachment's own extension: importers read xlsx, xls and csv by it.
    const ext = att.filename.match(/\.[a-z0-9]{2,4}$/i)?.[0].toLowerCase() ?? '.pdf'
    const file = join(MAIL_DIR, `${messageId}-${att.attachmentId.slice(0, 12)}${ext}`)
    try {
      mkdirSync(MAIL_DIR, { recursive: true })
      writeFileSync(file, await gmail.attachment(messageId, att.attachmentId))
      return await fn(file)
    } finally {
      rmSync(file, { force: true })
    }
  }

  const gmailFor = async (a: StoredAccount) => new Gmail(await accessToken(requireClient(), d.decrypt(a.token), d.fetch), d.fetch)
  const accountOf = (email: string) => {
    const a = load().find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!a) throw new Error(`${email} is not connected (connected: ${load().map((x) => x.email).join(', ') || 'none'}).`)
    return a
  }
  const hit = (a: StoredAccount, m: MailMessage): MailHit => ({
    account: a.email,
    person: d.personName(a.personId),
    id: m.id,
    date: m.date.slice(0, 10),
    from: m.from,
    subject: m.subject,
    snippet: m.snippet,
    attachments: m.attachments.map((x) => x.filename)
  })

  /** Imports the PDF attachments of new messages for one job, oldest first. */
  async function syncJob(a: StoredAccount, gmail: Gmail, j: Job, seenSoFar: string[]): Promise<{ found: MailFound[]; after: string | null; seen: string[] }> {
    const q = j.after ? `${j.query} after:${Math.floor(Date.parse(j.after) / 1000)}` : `${j.query} newer_than:${j.firstWindow}`
    const ids = (await gmail.search(q, j.after ? 10 : j.firstMax)).filter((id) => !seenSoFar.includes(id)).reverse()
    const found: MailFound[] = []
    let after = j.after
    const seen = [...seenSoFar]
    for (const id of ids) {
      const msg = await gmail.message(id)
      const pdfs = msg.attachments.filter((x) => (j.attachments ?? /\.pdf$/i).test(x.filename))
      // A statement that only lacked its password is tried again on the next check.
      let retry = false
      for (const att of pdfs) {
        const base = { at: now().toISOString(), job: j.job, subject: msg.subject, received: msg.date }
        try {
          const message = await withAttachment(gmail, id, att, (file) => j.run(a.personId, file, id, att.filename))
          found.push({ ...base, result: 'IMPORTED', message })
        } catch (e) {
          const m = errorText(e)
          const locked = /password/i.test(m)
          if (locked) retry = true
          found.push({
            ...base,
            result: 'FAILED',
            message: locked ? `${m} ${j.passwordHint}` : m,
            // So the log can offer a password box for this file.
            ...(locked ? { messageId: id, needsPassword: true } : {})
          })
        }
      }
      if (retry) break
      seen.push(id)
      if (!after || msg.date > after) after = msg.date
    }
    return { found, after, seen: seen.slice(-500) }
  }

  async function checkOne(a: StoredAccount): Promise<void> {
    const c = requireClient()
    try {
      const gmail = new Gmail(await accessToken(c, d.decrypt(a.token), d.fetch), d.fetch)
      const cas = await syncJob(
        a,
        gmail,
        {
          job: 'CAS',
          query: CAS_QUERY,
          after: a.casAfter,
          // First time: the last fourteen months of CAS emails, oldest first (each is a dated snapshot of
          // the holdings plus the transactions since the last one). Then: anything newer.
          firstWindow: '14m',
          firstMax: 14,
          run: (personId, file) => d.importCas(personId, file),
          passwordHint: 'Type the file’s password in the box below it (it is remembered for later files), or save your PAN under Settings → PDF passwords.'
        },
        a.seen
      )
      const found = [...cas.found]
      let seen = cas.seen
      let statementsAfter = a.statementsAfter ?? null
      if (d.importStatement && d.statementsEnabled?.()) {
        const st = await syncJob(
          a,
          gmail,
          {
            job: 'STATEMENT',
            query: STATEMENT_QUERY,
            after: statementsAfter,
            firstWindow: '6m',
            firstMax: 30,
            run: (personId, file, messageId) => d.importStatement!(personId, file, `gmail:${messageId}`),
            passwordHint: 'Type the file’s password in the box below it (it is remembered for later files), or save your PAN under Settings → PDF passwords.'
          },
          seen
        )
        found.push(...st.found)
        seen = st.seen
        statementsAfter = st.after
      }
      // Broker reports emailed as Excel or CSV (tradebook, holdings…): read by the app itself.
      let reportsAfter = a.reportsAfter ?? null
      if (d.importReport) {
        const rp = await syncJob(
          a,
          gmail,
          {
            job: 'REPORT',
            query: REPORT_QUERY,
            after: reportsAfter,
            firstWindow: '400d',
            firstMax: 25,
            attachments: /\.(xlsx|xls|csv)$/i,
            run: (personId, file, _id, name) => d.importReport!(personId, file, name),
            passwordHint: ''
          },
          seen
        )
        found.push(...rp.found)
        seen = rp.seen
        reportsAfter = rp.after
      }
      const imported = found.filter((x) => x.result === 'IMPORTED').length
      const failed = found.filter((x) => x.result === 'FAILED').length
      update(a.email, {
        lastCheck: now().toISOString(),
        status: failed ? 'ERROR' : 'OK',
        message: failed
          ? found.find((x) => x.result === 'FAILED')!.message
          : imported
            ? `Imported ${imported} statement${imported > 1 ? 's' : ''}.`
            : 'Nothing new.',
        casAfter: cas.after,
        statementsAfter,
        reportsAfter,
        seen,
        recent: [...found.reverse(), ...a.recent].slice(0, 20)
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
    /**
     * Searches the connected mailboxes (Gmail search syntax), newest first, for Ask your money.
     * A mailbox that fails is reported in problems; the others still answer.
     */
    async search(query: string, opts: { max?: number; email?: string } = {}): Promise<{ results: MailHit[]; problems: string[] }> {
      const accounts = opts.email ? [accountOf(opts.email)] : load().filter((a) => a.status !== 'RECONNECT')
      if (!accounts.length) throw new Error('No Gmail account is connected. Connect one in Settings → Google accounts.')
      const max = Math.min(Math.max(opts.max ?? 10, 1), 25)
      const results: MailHit[] = []
      const problems: string[] = []
      for (const a of accounts) {
        try {
          const gmail = await gmailFor(a)
          for (const id of await gmail.search(query, max)) results.push(hit(a, await gmail.message(id)))
        } catch (e) {
          problems.push(`${a.email}: ${errorText(e)}`)
        }
      }
      return { results: results.sort((x, y) => y.date.localeCompare(x.date)).slice(0, max), problems }
    },

    /** One email with its text (cut to a sensible length). */
    async read(email: string, id: string): Promise<MailHit & { text: string }> {
      const a = accountOf(email)
      const m = await (await gmailFor(a)).message(id)
      const text = m.text.length > 12000 ? `${m.text.slice(0, 12000)}\n…(cut)` : m.text
      return { ...hit(a, m), text }
    },

    /**
     * Imports one email's attachments into the mailbox owner's books: spreadsheets as broker reports,
     * a CAS with the saved CAS password, other PDFs as statements (when reading them is switched on).
     * Imports skip what is already there, so doing one twice changes nothing.
     */
    async importMessage(email: string, id: string, password?: string): Promise<MailFound[]> {
      const a = accountOf(email)
      const gmail = await gmailFor(a)
      const msg = await gmail.message(id)
      const found: MailFound[] = []
      for (const att of msg.attachments) {
        const sheet = /\.(xlsx|xls|csv)$/i.test(att.filename)
        if (!sheet && !/\.pdf$/i.test(att.filename)) continue
        const cas = !sheet && /\b(e-?)?CAS\b|consolidated account statement/i.test(`${msg.subject} ${att.filename}`)
        const job: MailJob = sheet ? 'REPORT' : cas ? 'CAS' : 'STATEMENT'
        const base = { at: now().toISOString(), job, subject: msg.subject, received: msg.date }
        try {
          const message = await withAttachment(gmail, id, att, async (file) => {
            if (sheet) {
              if (!d.importReport) throw new Error('This version cannot import spreadsheets from mail.')
              return d.importReport(a.personId, file, att.filename)
            }
            if (cas) return d.importCas(a.personId, file, password)
            if (!d.importStatement || !d.statementsEnabled?.())
              throw new Error('Card and bank statements need "Read statements" switched on in Settings → Claude.')
            return d.importStatement(a.personId, file, `gmail:${id}`, password)
          })
          found.push({ ...base, result: 'IMPORTED', message })
        } catch (e) {
          const m = errorText(e)
          const locked = /password/i.test(m)
          found.push({ ...base, result: 'FAILED', message: m, ...(locked ? { messageId: id, needsPassword: true } : {}) })
        }
      }
      if (!found.length) throw new Error('That email has no PDF, Excel or CSV attachment to import.')
      const cur = accountOf(email)
      const allIn = found.every((x) => x.result === 'IMPORTED')
      // Once every file of the email is in, its earlier "needs a password" lines are done with.
      const earlier = allIn ? cur.recent.filter((x) => !(x.messageId === id && x.needsPassword)) : cur.recent
      // An email still locked is left for the next check; one that is in (or failed for another reason) is not retried.
      const locked = found.some((x) => x.needsPassword)
      update(cur.email, {
        seen: locked || cur.seen.includes(id) ? cur.seen : [...cur.seen, id].slice(-500),
        recent: [...[...found].reverse(), ...earlier].slice(0, 20)
      })
      return found
    },

    /**
     * Reads the last three months of statements from stockbrokers again, ignoring which emails were
     * handled before: for ones skipped by an earlier version (a securities statement used to be
     * dropped as "not a statement"). Imports skip what is already there, so nothing is doubled.
     */
    async rereadBrokerStatements(email: string): Promise<MailFound[]> {
      const a = accountOf(email)
      if (!d.importStatement || !d.statementsEnabled?.())
        throw new Error('Reading statements needs "Read statements" switched on in Settings → Claude.')
      const gmail = await gmailFor(a)
      const r = await syncJob(
        a,
        gmail,
        {
          job: 'STATEMENT',
          query: `${STATEMENT_QUERY} {from:zerodha from:groww from:indmoney}`,
          after: null,
          firstWindow: '3m',
          firstMax: 40,
          run: (personId, file, messageId, _name) => d.importStatement!(personId, file, `gmail:${messageId}`),
          passwordHint: 'Type the file’s password in the box below it (it is remembered for later files), or save your PAN under Settings → PDF passwords.'
        },
        []
      )
      const cur = accountOf(email)
      update(cur.email, {
        seen: [...new Set([...cur.seen, ...r.seen])].slice(-500),
        recent: [...[...r.found].reverse(), ...cur.recent].slice(0, 20)
      })
      return r.found
    },

    due(): boolean {
      if (!client()) return false
      const accts = load().filter((a) => a.status !== 'RECONNECT')
      return accts.some((a) => !a.lastCheck || now().getTime() - Date.parse(a.lastCheck) > 12 * 3600_000)
    }
  }
}

export type Mail = ReturnType<typeof createMail>
