// Google sign-in for the phone app, and its hidden Drive folder. The sign-in client is the person's
// own "Web application" one (the same the desktop uses), so both see the same app folder.
// Sign-in is a full-page redirect: popups are unreliable in Home Screen apps on iOS.

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata'

const LS = {
  client: 'fp.client',
  token: 'fp.token',
  email: 'fp.email',
  state: 'fp.state'
}

/** Where Google sends the person back: this app's own address, exactly as registered. */
export const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`

const CLIENT_RE = /[\w-]+\.apps\.googleusercontent\.com/

/** The sign-in client: built in at publish time, or carried in the link the desktop's QR code opens. */
export function clientId(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('client')
  if (fromUrl && new RegExp(`^${CLIENT_RE.source}$`).test(fromUrl)) localStorage.setItem(LS.client, fromUrl)
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || localStorage.getItem(LS.client)
}

/**
 * This app's address with the sign-in client in it. A Home Screen app on iPhone keeps its own
 * storage, separate from Safari's, and starts from the address showing when it was added; keeping
 * the client in the address means the icon opens an app that is already set up.
 */
export function appAddress(): string {
  const id = localStorage.getItem(LS.client)
  return id ? `${redirectUri()}?client=${encodeURIComponent(id)}` : redirectUri()
}

/** Puts the client back in the address (after Google's redirect, or a reload that lost it). */
export function keepClientInAddress(): void {
  clientId()
  if (localStorage.getItem(LS.client) && !new URLSearchParams(location.search).get('client')) history.replaceState(null, '', appAddress() + location.hash)
}

/** Sets the client from the phone link (or just its client ID) pasted in. */
export function setClientFrom(text: string): boolean {
  const id = text.trim().match(CLIENT_RE)?.[0]
  if (!id) return false
  localStorage.setItem(LS.client, id)
  history.replaceState(null, '', appAddress())
  return true
}

export function signedInEmail(): string | null {
  return localStorage.getItem(LS.email)
}

interface Token {
  value: string
  expires: number
}

export function currentToken(): string | null {
  try {
    const t = JSON.parse(localStorage.getItem(LS.token) ?? 'null') as Token | null
    return t && t.expires > Date.now() + 60_000 ? t.value : null
  } catch {
    return null
  }
}

/** Goes to Google's sign-in; the app reloads with a token in the address. */
export function signIn(): void {
  const id = clientId()
  if (!id) throw new Error('Open this app from the link on your computer first (Settings → Phone app).')
  const state = crypto.randomUUID()
  localStorage.setItem(LS.state, state)
  const email = signedInEmail()
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
    ...(email ? { login_hint: email } : { prompt: 'select_account' })
  })
  location.assign(`${AUTH}?${params}`)
}

/**
 * Reads the token Google sent back in the address (#access_token=…), checks it answers our own
 * request, stores it, and tidies the address. Returns an error message for a refused sign-in.
 */
export async function finishSignIn(): Promise<string | null> {
  if (!location.hash.includes('access_token') && !location.hash.includes('error=')) return null
  const p = new URLSearchParams(location.hash.slice(1))
  const expected = localStorage.getItem(LS.state)
  localStorage.removeItem(LS.state)
  history.replaceState(null, '', appAddress())
  if (p.get('error')) return p.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : `Google: ${p.get('error')}`
  if (!expected || p.get('state') !== expected) return 'That sign-in did not come from this app. Try again.'
  if (!(p.get('scope') ?? '').includes('drive.appdata')) return 'Allow Drive on Google’s page: the app keeps its data there.'
  const value = p.get('access_token')!
  localStorage.setItem(LS.token, JSON.stringify({ value, expires: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000 }))
  try {
    const me = (await (
      await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${value}` } })
    ).json()) as { email?: string }
    if (me.email) localStorage.setItem(LS.email, me.email.toLowerCase())
  } catch {
    /* the email only pre-fills the next sign-in */
  }
  return null
}

export function signOut(): void {
  localStorage.removeItem(LS.token)
  localStorage.removeItem(LS.email)
}

export class SignInNeeded extends Error {
  constructor() {
    super('Sign in with Google to sync')
  }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = currentToken()
  if (!token) throw new SignInNeeded()
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
  if (res.status === 401) {
    localStorage.removeItem(LS.token)
    throw new SignInNeeded()
  }
  if (!res.ok) throw new Error(`Google Drive: ${res.status}`)
  return res
}

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
}

export async function listFiles(prefix: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name contains '${prefix}'`,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '200'
  })
  const r = (await (await call(`${DRIVE}/files?${params}`)).json()) as { files?: DriveFile[] }
  return (r.files ?? []).filter((f) => f.name.startsWith(prefix))
}

export async function readFile(id: string): Promise<string> {
  return (await call(`${DRIVE}/files/${id}?alt=media`)).text()
}

export async function createFile(name: string, content: string): Promise<void> {
  const boundary = `fp${crypto.randomUUID().slice(0, 8)}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: ['appDataFolder'] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
  await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  })
}
