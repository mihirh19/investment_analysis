import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createMail, CAS_QUERY } from '../src/main/mailSync'
import { GMAIL_SCOPE } from '../src/main/google'

const CLIENT = { clientId: '1234-abcdef.apps.googleusercontent.com', clientSecret: 'GOCSPX-test-secret' }
const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A pretend Google: token endpoint plus a Gmail mailbox per account. */
function fakeGoogle(mailboxes: Record<string, { id: string; date: number; subject: string; pdf: string }[]>) {
  const tokens = new Map<string, string>() // access token → email
  let nextCodeEmail = ''
  const searches: string[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(String(init?.body))
      if (form.get('grant_type') === 'authorization_code') {
        expect(form.get('code_verifier')).toBeTruthy()
        return json({ refresh_token: `rt-${nextCodeEmail}`, id_token: idToken(nextCodeEmail), scope: `openid email ${GMAIL_SCOPE}` })
      }
      const email = form.get('refresh_token')!.replace(/^rt-/, '')
      if (email === 'revoked@gmail.com') return json({ error: 'invalid_grant' }, 400)
      tokens.set(`at-${email}`, email)
      return json({ access_token: `at-${email}`, expires_in: 3599 })
    }
    if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) return json({})
    const email = tokens.get(String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', ''))!
    const box = mailboxes[email] ?? []
    const path = url.pathname.replace('/gmail/v1/users/me', '')
    if (path === '/messages') {
      const q = url.searchParams.get('q')!
      searches.push(q)
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000
      const hits = box.filter((m) => m.date > after).sort((a, b) => b.date - a.date)
      return json({ messages: hits.slice(0, Number(url.searchParams.get('maxResults'))).map((m) => ({ id: m.id })) })
    }
    const att = path.match(/^\/messages\/(\w+)\/attachments\/(\w+)$/)
    if (att) return json({ data: Buffer.from(box.find((m) => m.id === att[1])!.pdf).toString('base64url') })
    const msg = box.find((m) => `/messages/${m.id}` === path)!
    return json({
      id: msg.id,
      internalDate: String(msg.date),
      payload: {
        headers: [{ name: 'Subject', value: msg.subject }],
        parts: [{ mimeType: 'text/plain' }, { filename: 'CAS.pdf', mimeType: 'application/pdf', body: { attachmentId: `a${msg.id}`, size: 9 } }]
      }
    })
  }) as typeof fetch
  return { f, searches, signInAs: (email: string) => (nextCodeEmail = email) }
}

function setup(g: ReturnType<typeof fakeGoogle>) {
  const settings = new Map<string, string>()
  const imported: { personId: number; content: string }[] = []
  const mail = createMail({
    getSetting: (k) => settings.get(k) ?? null,
    setSetting: (k, v) => settings.set(k, v),
    encrypt: (s) => `enc:${s}`,
    decrypt: (s) => s.replace(/^enc:/, ''),
    fetch: g.f,
    personName: (id) => (id === 1 ? 'Me' : 'Dad'),
    // The pretend browser: follow Google's redirect straight back to the app's listener.
    async openUrl(url) {
      const u = new URL(url)
      expect(u.searchParams.get('scope')).toContain(GMAIL_SCOPE)
      expect(u.searchParams.get('code_challenge_method')).toBe('S256')
      await fetch(new URL(`?code=ok&state=${u.searchParams.get('state')}`, u.searchParams.get('redirect_uri')!))
    },
    async importCas(personId, filePath) {
      const content = readFileSync(filePath, 'utf8')
      if (content.includes('locked')) throw new Error('Enter the PDF password')
      imported.push({ personId, content })
      return 'Imported'
    }
  })
  return { mail, settings, imported }
}

describe('statements from Gmail', () => {
  it('connects two Google accounts, each importing into its own person', async () => {
    const g = fakeGoogle({
      'me@gmail.com': [
        { id: 'm1', date: Date.parse('2026-08-12'), subject: 'NSDL CAS for July', pdf: 'me-july' },
        { id: 'm2', date: Date.parse('2026-09-12'), subject: 'NSDL CAS for August', pdf: 'me-aug' }
      ],
      'dad@gmail.com': [{ id: 'd1', date: Date.parse('2026-09-14'), subject: 'CDSL Consolidated Account Statement', pdf: 'dad-aug' }]
    })
    const { mail, imported, settings } = setup(g)
    expect(() => mail.saveClient({ clientId: 'nope', clientSecret: 'x' })).toThrow(/apps\.googleusercontent\.com/)
    mail.saveClient(CLIENT)
    expect(settings.get('google:client')).toMatch(/^enc:/)

    g.signInAs('me@gmail.com')
    const me = await mail.connect(1)
    g.signInAs('dad@gmail.com')
    const dad = await mail.connect(2)

    // First check of each mailbox takes only the latest statement.
    expect(imported).toEqual([
      { personId: 1, content: 'me-aug' },
      { personId: 2, content: 'dad-aug' }
    ])
    expect([me.status, dad.status, dad.personName]).toEqual(['OK', 'OK', 'Dad'])
    expect(g.searches[0]).toBe(`${CAS_QUERY} newer_than:60d`)
    // Refresh tokens are stored encrypted.
    expect(JSON.parse(settings.get('google:accounts')!)[0].token).toBe('enc:rt-me@gmail.com')

    // Nothing new: nothing imported twice.
    await mail.check()
    expect(imported).toHaveLength(2)
    expect(mail.setup().accounts.map((a) => a.message)).toEqual(['Nothing new.', 'Nothing new.'])
  })

  it('keeps going past a statement it cannot open, and asks to reconnect a revoked account', async () => {
    const g = fakeGoogle({
      'me@gmail.com': [{ id: 'm1', date: Date.parse('2026-09-12'), subject: 'CAS', pdf: 'locked' }]
    })
    const { mail } = setup(g)
    mail.saveClient(CLIENT)
    g.signInAs('me@gmail.com')
    const me = await mail.connect(1)
    expect(me.status).toBe('ERROR')
    expect(me.message).toMatch(/Remember the password/)
    expect(me.recent[0]).toMatchObject({ job: 'CAS', result: 'FAILED', subject: 'CAS' })
    // Not marked as handled: the next check tries it again.
    await mail.check('me@gmail.com')
    expect(mail.setup().accounts[0].recent.filter((x) => x.result === 'FAILED')).toHaveLength(2)

    g.signInAs('revoked@gmail.com')
    const r = await mail.connect(2)
    expect(r.status).toBe('RECONNECT')
    expect(mail.due()).toBe(false) // only the revoked one and a just-checked one
    await mail.disconnect('revoked@gmail.com')
    expect(mail.setup().accounts.map((a) => a.email)).toEqual(['me@gmail.com'])
  })
})
