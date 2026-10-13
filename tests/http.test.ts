import { describe, expect, it } from 'vitest'
import { fetchWith, getText, HttpError } from '../src/main/market/http'

/** A response whose headers arrive at once but whose body never finishes (until aborted). */
const stalled = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('partial'))
      init?.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }
  })
  return new Response(body, { status: 200 })
}) as typeof fetch

describe('http', () => {
  it('times out a body that stalls after the headers arrive', async () => {
    const t0 = Date.now()
    await expect(getText('https://slow.example.com/page', { fetch: stalled, timeoutMs: 200 })).rejects.toThrow(
      /slow\.example\.com: timed out/
    )
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('reports HTTP errors and passes the reader’s own errors through', async () => {
    const notFound = (async () => new Response('x', { status: 404, statusText: 'Not Found' })) as typeof fetch
    await expect(getText('https://h.example.com/a', { fetch: notFound })).rejects.toBeInstanceOf(HttpError)
    const ok = (async () => new Response('fine')) as typeof fetch
    await expect(
      fetchWith('https://h.example.com/a', { fetch: ok }, async () => {
        throw new Error('File too large')
      })
    ).rejects.toThrow(/^File too large$/)
    expect(await getText('https://h.example.com/a', { fetch: ok })).toBe('fine')
  })
})
