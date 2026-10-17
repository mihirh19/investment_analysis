import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FetchFn } from './market/http'

/**
 * Google sign-in for reading statements from Gmail, with no server in between.
 *
 * The person creates their own OAuth client in Google Cloud once (type "Desktop app") and pastes
 * its ID and secret into Settings. Signing in opens the browser at Google's consent page; Google
 * sends the browser back to a one-off listener on 127.0.0.1 with a code, which is exchanged (with
 * a PKCE verifier) for a refresh token. The token is kept encrypted in the database, one per
 * Google account, so two or more accounts work side by side.
 *
 * Scope: gmail.readonly. The app can search and read mail and attachments, never send, delete or
 * change anything.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
/** The hidden per-app folder in the person's Drive, for the phone app's encrypted copy. */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
/**
 * Sign-in comes back to this fixed address. A "Desktop app" client accepts any port; a "Web
 * application" client (needed for the phone app) accepts only addresses registered with it, so
 * a fixed one can be registered: http://127.0.0.1:53682/
 */
export const LOOPBACK_PORT = 53682
export const LOOPBACK_REDIRECT = `http://127.0.0.1:${LOOPBACK_PORT}/`

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/** The refresh token no longer works (revoked, password changed, six months unused): sign in again. */
export class GoogleReconnectError extends Error {}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function emailFromIdToken(idToken: string | undefined): string | null {
  const part = idToken?.split('.')[1]
  if (!part) return null
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { email?: string }
    return claims.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

const SIGNED_IN_PAGE = (ok: boolean, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Family Portfolio</title><body style="font:16px system-ui;margin:15vh auto;max-width:34em;padding:0 16px;color:#1b2440"><h1 style="font-size:22px">${ok ? 'Signed in' : 'Not signed in'}</h1><p>${text}</p></body>`

/**
 * Signs in one Google account: opens the consent page and waits (up to five minutes) for the
 * browser to come back. Resolves with the account's email and refresh token.
 */
export async function signIn(
  client: GoogleClient,
  openUrl: (url: string) => void | Promise<void>,
  f: FetchFn = fetch,
  timeoutMs = 5 * 60_000,
  opts: { drive?: boolean; port?: number } = {}
): Promise<{ email: string; refreshToken: string; scopes: string[] }> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const server = createServer()
  const port = opts.port ?? LOOPBACK_PORT
  await new Promise<void>((res, rej) => {
    server.once('error', rej)
    server.listen(port, '127.0.0.1', () => res())
  }).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE' || port === 0) throw e
    // Something else holds the fixed port: any port still works with a "Desktop app" client.
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  })
  const actual = (server.address() as AddressInfo).port
  const redirectUri = actual === LOOPBACK_PORT ? LOOPBACK_REDIRECT : `http://127.0.0.1:${actual}/`

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sign-in was not finished within 5 minutes. Try again.')), timeoutMs)
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        if (url.pathname !== '/' || (!url.searchParams.has('code') && !url.searchParams.has('error'))) {
          res.writeHead(404).end()
          return
        }
        const error = url.searchParams.get('error')
        const ok = !error && url.searchParams.get('state') === state && !!url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          SIGNED_IN_PAGE(
            ok,
            ok
              ? 'You can close this tab and go back to Family Portfolio.'
              : error === 'access_denied'
                ? 'Access was not allowed. Go back to Family Portfolio to try again.'
                : 'Something went wrong. Go back to Family Portfolio and try again.'
          )
        )
        clearTimeout(timer)
        if (ok) resolve(url.searchParams.get('code')!)
        else reject(new Error(error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed. Try again.'))
      })
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: ['openid', 'email', GMAIL_SCOPE, ...(opts.drive ? [DRIVE_APPDATA_SCOPE] : [])].join(' '),
        include_granted_scopes: 'true',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        // Always ask, so a refresh token comes back, and let the person pick which account.
        prompt: 'consent select_account'
      })
      void Promise.resolve(openUrl(`${AUTH_URL}?${params}`)).catch(reject)
    })

    const res = await f(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
    })
    const body = (await res.json()) as { refresh_token?: string; id_token?: string; error?: string; error_description?: string; scope?: string }
    if (!res.ok) throw new Error(`Google refused the sign-in: ${body.error_description ?? body.error ?? res.status}`)
    if (!body.refresh_token) throw new Error('Google sent no refresh token. Remove Family Portfolio from your Google account’s third-party access and sign in again.')
    if (body.scope && !body.scope.includes(GMAIL_SCOPE))
      throw new Error('Gmail access was not ticked on Google’s consent page. Sign in again and allow reading email.')
    const email = emailFromIdToken(body.id_token)
    if (!email) throw new Error('Google did not say which account signed in.')
    if (opts.drive && body.scope && !body.scope.includes(DRIVE_APPDATA_SCOPE))
      throw new Error('Drive access was not ticked on Google’s consent page. Sign in again and allow it for the phone app.')
    return { email, refreshToken: body.refresh_token, scopes: (body.scope ?? '').split(' ').filter(Boolean) }
  } finally {
    server.close()
  }
}

/** A short-lived access token from the refresh token. */
export async function accessToken(client: GoogleClient, refreshToken: string, f: FetchFn = fetch): Promise<string> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
  if (body.error === 'invalid_grant')
    throw new GoogleReconnectError('Google no longer accepts this sign-in (it was removed, the password changed, or it went unused for six months). Connect the account again.')
  if (!res.ok || !body.access_token) throw new Error(`Google: ${body.error_description ?? body.error ?? res.status}`)
  return body.access_token
}

export async function revoke(refreshToken: string, f: FetchFn = fetch): Promise<void> {
  await f(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => null)
}

// ---------------- Gmail ----------------

export interface MailAttachment {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

export interface MailMessage {
  id: string
  /** When Gmail received it, ISO. */
  date: string
  from: string
  subject: string
  attachments: MailAttachment[]
}

interface Part {
  filename?: string
  mimeType?: string
  body?: { attachmentId?: string; size?: number }
  parts?: Part[]
  headers?: { name: string; value: string }[]
}

export class Gmail {
  constructor(
    private readonly token: string,
    private readonly f: FetchFn = fetch
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.f(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${this.token}` } })
    if (res.status === 401) throw new GoogleReconnectError('Google sign-in expired. Connect the account again.')
    if (res.status === 403) {
      const t = await res.text()
      throw new Error(
        /has not been used|is disabled/i.test(t)
          ? 'The Gmail API is not switched on in your Google Cloud project. Enable it there, then check again.'
          : 'Gmail refused the request (403).'
      )
    }
    if (!res.ok) throw new Error(`Gmail: ${res.status}`)
    return (await res.json()) as T
  }

  /** Message ids matching a Gmail search, newest first. */
  async search(q: string, max = 20): Promise<string[]> {
    const r = await this.get<{ messages?: { id: string }[] }>(`/messages?${new URLSearchParams({ q, maxResults: String(max) })}`)
    return (r.messages ?? []).map((m) => m.id)
  }

  async message(id: string): Promise<MailMessage> {
    const r = await this.get<{ id: string; internalDate: string; payload: Part }>(`/messages/${id}?format=full`)
    const header = (n: string) => r.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? ''
    const attachments: MailAttachment[] = []
    const walk = (p: Part) => {
      if (p.filename && p.body?.attachmentId)
        attachments.push({
          filename: p.filename,
          mimeType: p.mimeType ?? '',
          attachmentId: p.body.attachmentId,
          size: p.body.size ?? 0
        })
      for (const c of p.parts ?? []) walk(c)
    }
    walk(r.payload)
    return {
      id: r.id,
      date: new Date(Number(r.internalDate)).toISOString(),
      from: header('from'),
      subject: header('subject'),
      attachments
    }
  }

  async attachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.get<{ data: string }>(`/messages/${messageId}/attachments/${attachmentId}`)
    return Buffer.from(r.data, 'base64url')
  }
}

// ---------------- Drive: the hidden app folder ----------------

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
}

/** Files in the person's hidden app-data folder: only this sign-in client can see them. */
export class AppFolder {
  constructor(
    private readonly token: string,
    private readonly f: FetchFn = fetch
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.f(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` }
    })
    if (res.status === 401) throw new GoogleReconnectError('Google sign-in expired. Connect the account again.')
    if (res.status === 403) {
      const t = await res.text()
      throw new Error(
        /has not been used|is disabled/i.test(t)
          ? 'The Google Drive API is not switched on in your Google Cloud project. Enable it there, then sync again.'
          : /insufficient/i.test(t)
            ? 'This Google account has not allowed Drive for the phone app. Allow it in Settings → Phone app.'
            : 'Google Drive refused the request (403).'
      )
    }
    if (!res.ok) throw new Error(`Google Drive: ${res.status}`)
    return res
  }

  async list(prefix?: string): Promise<DriveFile[]> {
    const q = prefix ? `name contains '${prefix.replace(/'/g, "\\'")}'` : ''
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: 'files(id,name,modifiedTime)',
      pageSize: '200',
      ...(q ? { q } : {})
    })
    const r = (await (await this.call(`${DRIVE}/files?${params}`)).json()) as { files?: DriveFile[] }
    return (r.files ?? []).filter((x) => !prefix || x.name.startsWith(prefix))
  }

  async read(id: string): Promise<string> {
    return (await this.call(`${DRIVE}/files/${id}?alt=media`)).text()
  }

  /** Creates the file, or replaces its content when it exists. */
  async write(name: string, content: string, existingId?: string): Promise<string> {
    if (existingId) {
      await this.call(`${UPLOAD}/files/${existingId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content
      })
      return existingId
    }
    const boundary = `fp${Math.random().toString(36).slice(2)}`
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: ['appDataFolder'] }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
    const r = (await (
      await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      })
    ).json()) as { id: string }
    return r.id
  }

  async remove(id: string): Promise<void> {
    await this.call(`${DRIVE}/files/${id}`, { method: 'DELETE' })
  }
}
