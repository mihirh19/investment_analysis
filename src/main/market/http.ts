export type FetchFn = typeof fetch

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string
  ) {
    super(message)
  }
}

export interface HttpOptions {
  fetch?: FetchFn
  timeoutMs?: number
  headers?: Record<string, string>
}

export async function getText(url: string, opts: HttpOptions = {}): Promise<string> {
  return fetchWith(url, opts, (res) => res.text())
}

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  return fetchWith(url, opts, async (res) => (await res.json()) as T)
}

/** Response headers only; the timeout stops once they arrive. Prefer fetchWith to read the body. */
export async function request(url: string, opts: HttpOptions = {}): Promise<Response> {
  return fetchWith(url, opts, async (res) => res)
}

/**
 * Fetches and reads the response with `read`, all within the timeout: a server that sends headers
 * and then stalls mid-body fails instead of hanging forever.
 */
export async function fetchWith<T>(url: string, opts: HttpOptions, read: (res: Response) => Promise<T>): Promise<T> {
  const f = opts.fetch ?? fetch
  const ms = opts.timeoutMs ?? 15_000
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new HttpError(0, url, `Could not reach ${new URL(url).host}: timed out`))
    }, ms)
  })
  const unreachable = (e: unknown) => {
    if (e instanceof HttpError) return e
    const reason = (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message
    return new HttpError(0, url, `Could not reach ${new URL(url).host}: ${reason}`)
  }
  const work = (async () => {
    let res: Response
    try {
      res = await f(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...opts.headers },
        signal: ctrl.signal,
        redirect: 'follow'
      })
    } catch (e) {
      throw unreachable(e)
    }
    if (!res.ok) throw new HttpError(res.status, url, `${res.status} ${res.statusText} from ${new URL(url).host}`)
    try {
      return await read(res)
    } catch (e) {
      // A body cut off by the timeout reads as an abort; anything else is the reader's own error.
      throw (e as Error).name === 'AbortError' ? unreachable(e) : e
    }
  })()
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
    work.catch(() => undefined) // a late failure after the timeout is already reported
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; failures are returned, not thrown. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<({ ok: true; item: T; value: R } | { ok: false; item: T; error: Error })[]> {
  const out: ({ ok: true; item: T; value: R } | { ok: false; item: T; error: Error })[] = []
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      try {
        out.push({ ok: true, item, value: await fn(item) })
      } catch (error) {
        out.push({ ok: false, item, error: error as Error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Calendar date (YYYY-MM-DD) of a unix timestamp in a given UTC offset (seconds), e.g. IST = 19800. */
export function dateInOffset(unixSeconds: number, offsetSeconds: number): string {
  const d = new Date((unixSeconds + offsetSeconds) * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** "09-10-2026" (DD-MM-YYYY) → "2026-10-09" */
export function dmyToIso(s: string): string {
  const [d, m, y] = s.split('-')
  return `${y}-${m}-${d}`
}
