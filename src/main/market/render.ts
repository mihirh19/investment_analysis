import { BrowserWindow, session } from 'electron'
import { linksFromJson, type FoundLink, type RenderPlan } from './disclosures'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const SPREADSHEET = /\.(xlsx?|xlsb|zip)(?:$|[?#])/i
const MENTIONS_SPREADSHEET = /\.(xlsx?|xlsb|zip)\b/i
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Collect each link with its own text and the text of its row or card, which usually carries the
// scheme name and the month ("Portfolio as on 30 September 2026 for Mirae Asset Flexi Cap Fund").
const COLLECT = `(() => {
  const out = []
  for (const a of document.querySelectorAll('a[href]')) {
    const box = a.closest('tr, li, [class*=card], [class*=item], [class*=row]') || a.parentElement
    const own = (a.innerText || a.title || a.getAttribute('aria-label') || a.getAttribute('download') || '').trim()
    const ctx = box ? (box.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : ''
    out.push({ url: a.href, text: own.slice(0, 200), context: ctx })
  }
  return out
})()`

interface CdpResponse {
  requestId: string
  type?: string
  response: { url: string; mimeType: string }
}

interface CdpRequest {
  type?: string
  request: { url: string; method: string; headers: Record<string, string>; postData?: string }
}

// Headers a page script cannot set itself; the browser adds them.
const BROWSER_HEADERS = /^(user-agent|referer|origin|host|cookie|connection|content-length|accept-encoding|sec-)/i

/**
 * Clicks the innermost element whose text matches, as a person would to open a section (its
 * wrappers share the same text but don't react; the click bubbles up to the real handler).
 */
const clickScript = (pattern: string) => `(() => {
  const re = new RegExp(${JSON.stringify(pattern)}, 'i')
  const el = [...document.querySelectorAll('button, a, summary, [role=button], [role=tab], h2, h3, h4, div, span, li')]
    .filter((e) => re.test((e.childElementCount === 0 ? e.textContent : e.innerText || '').trim()))
    .pop()
  if (!el) return false
  el.click()
  return true
})()`

/**
 * Opens a fund house's disclosure page in a hidden, sandboxed window, lets its scripts build the
 * page, and returns the links. Pages that list files from their own API (ICICI) are read through
 * the JSON they load; a plan can open a section first and ask for earlier months the way the page's
 * own month picker does (Axis). Nothing is saved: the session lives in memory, downloads and
 * popups are blocked (their URLs are kept), and the window is destroyed afterwards.
 */
export async function renderLinks(url: string, plan: RenderPlan = {}, settleMs = 8000): Promise<FoundLink[]> {
  const ses = session.fromPartition(`disclosure-${Date.now()}`, { cache: false })
  const captured = new Set<string>()
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    // Skip heavy assets; note spreadsheet requests made by the page's own scripts.
    if (['image', 'media', 'font'].includes(details.resourceType)) return cb({ cancel: true })
    if (SPREADSHEET.test(details.url)) captured.add(details.url)
    cb({})
  })
  ses.on('will-download', (e, item) => {
    captured.add(item.getURL())
    e.preventDefault()
  })

  const win = new BrowserWindow({
    show: false,
    width: 1366,
    height: 900,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      // Hidden windows are throttled; some pages then never finish building their lists.
      backgroundThrottling: false
    }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (SPREADSHEET.test(u)) captured.add(u)
    return { action: 'deny' }
  })

  const fromJson: FoundLink[] = []
  const reads: Promise<void>[] = []
  const jsonRequests = new Map<string, string>()
  const requests: CdpRequest['request'][] = []
  const dbg = win.webContents.debugger
  try {
    // A blank page first gives the window a renderer; protocol commands sent before that never answer.
    await Promise.race([win.loadURL('about:blank').catch(() => undefined), sleep(10_000)])
    await Promise.race([watchJson(), sleep(5_000)])
    await Promise.race([win.loadURL(url, { userAgent: UA }).catch(() => undefined), sleep(30_000)])
    await sleep(settleMs)
    if (plan.click) {
      const clicked = await Promise.race([
        win.webContents.executeJavaScript(clickScript(plan.click), true).catch(() => false),
        sleep(5_000).then(() => false)
      ])
      if (clicked) await sleep(5_000)
    }
    if (plan.repeat) {
      // The page's own request, sent again for other months from inside the page (same session).
      const { url: urlRe, body: bodyRe, bodies } = plan.repeat
      const sent = [...requests]
        .reverse()
        .find((r) => new RegExp(urlRe, 'i').test(r.url) && (!bodyRe || new RegExp(bodyRe, 'i').test(r.postData ?? '')))
      if (sent?.postData) {
        const headers = Object.fromEntries(Object.entries(sent.headers).filter(([k]) => !BROWSER_HEADERS.test(k)))
        let original: Record<string, unknown> = {}
        try {
          original = JSON.parse(sent.postData) as Record<string, unknown>
        } catch {
          /* not JSON: nothing to vary */
        }
        const calls = bodies(original).map((b) => ({
          url: sent.url,
          method: sent.method,
          headers,
          body: JSON.stringify(b)
        }))
        await Promise.race([
          win.webContents
            .executeJavaScript(
              `(async (calls) => { for (const c of calls) { try { await fetch(c.url, { method: c.method, headers: c.headers, body: c.body, credentials: 'include' }) } catch {} } })(${JSON.stringify(calls)})`,
              true
            )
            .catch(() => undefined),
          sleep(20_000)
        ])
        await sleep(2_000)
      }
    }
    const links = (await Promise.race([
      win.webContents.executeJavaScript(COLLECT, true),
      sleep(10_000).then(() => [])
    ])) as FoundLink[]
    await Promise.race([Promise.all(reads), sleep(5_000)])
    return [
      ...(links ?? []).filter((l) => SPREADSHEET.test(l.url)),
      ...fromJson,
      ...[...captured].map((u) => ({ url: u, text: '' }))
    ]
  } finally {
    try {
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* window going away */
    }
    win.destroy()
    ses.webRequest.onBeforeRequest(null)
  }

  /** Reads JSON responses (XHR/fetch) for file listings, via the DevTools protocol. */
  async function watchJson(): Promise<void> {
    try {
      dbg.attach('1.3')
    } catch {
      return // no protocol access: links in the page itself still work
    }
    dbg.on('message', (_e, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const p = params as CdpRequest
        if (p.type === 'XHR' || p.type === 'Fetch') requests.push(p.request)
      } else if (method === 'Network.responseReceived') {
        const p = params as CdpResponse
        if ((p.type === 'XHR' || p.type === 'Fetch') && /json|text\/plain/i.test(p.response.mimeType))
          jsonRequests.set(p.requestId, p.response.url)
      } else if (method === 'Network.loadingFinished') {
        const id = (params as { requestId: string }).requestId
        const source = jsonRequests.get(id)
        if (!source) return
        reads.push(
          (
            dbg.sendCommand('Network.getResponseBody', { requestId: id }) as Promise<{
              body: string
              base64Encoded: boolean
            }>
          )
            .then(({ body, base64Encoded }) => {
              const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
              if (text.length > 5_000_000 || !MENTIONS_SPREADSHEET.test(text)) return
              fromJson.push(...linksFromJson(JSON.parse(text), win.webContents.getURL() || source))
            })
            .catch(() => undefined)
        )
      }
    })
    await dbg.sendCommand('Network.enable').catch(() => undefined)
  }
}
