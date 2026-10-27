import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { cropExports } from '../src/main/farmExports'

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'comtrade', f), 'utf8')

describe('crop exports from UN Comtrade', () => {
  it('reads a year by buyer and the latest month, then keeps them a week', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-exp-'))
    const o = openDatabase(join(dir, 't.db'), 'b'.repeat(64), resolve('drizzle'))
    try {
      const asked: string[] = []
      const year = JSON.parse(fx('groundnut-2025.json'))
      const f = (async (url: string) => {
        asked.push(url)
        const u = new URL(url)
        const period = u.searchParams.get('period')!
        if (u.pathname.endsWith('/A/HS')) {
          if (period === '2025') return new Response(JSON.stringify(year))
          // The year before: the same buyers, a fifth smaller.
          return new Response(JSON.stringify({ ...year, data: year.data.map((r: { netWgt: number }) => ({ ...r, netWgt: r.netWgt * 0.8 })) }))
        }
        if (period === '202606') return new Response(fx('groundnut-202606.json'))
        if (period === '202506') return new Response(JSON.stringify({ count: 1, data: [{ partnerISO: 'W00', partnerCode: 0, netWgt: 20_000_000, primaryValue: 1 }] }))
        return new Response(JSON.stringify({ count: 0, data: [] }))
      }) as unknown as typeof fetch
      const now = new Date('2026-10-27T06:00:00Z')
      const x = (await cropExports(o.db, 'GROUNDNUT', f, now, 0))!
      expect(x).toMatchObject({ crop: 'GROUNDNUT', hs: '1202', year: 2025 })
      expect(x.tonnes).toBeCloseTo(750362.017, 2)
      expect(x.prevTonnes).toBeCloseTo(750362.017 * 0.8, 2)
      expect(x.partners[0]).toMatchObject({ iso: 'IDN', name: 'Indonesia' })
      expect(x.partners[0].share).toBeCloseTo(216497730 / 750362016.999)
      expect(x.latestMonth).toEqual({ month: '2026-06', tonnes: 25711.52, usd: 30110077.864, yearAgoTonnes: 20000 })
      // Aug, Jul empty; Jun found, plus Jun a year before.
      expect(asked.filter((u) => u.includes('/M/HS')).map((u) => new URL(u).searchParams.get('period'))).toEqual(['202608', '202607', '202606', '202506'])
      expect(asked.every((u) => new URL(u).searchParams.get('reporterCode') === '699')).toBe(true)
      const n = asked.length
      await cropExports(o.db, 'GROUNDNUT', f, new Date('2026-10-30T06:00:00Z'), 0)
      expect(asked.length).toBe(n)
      expect(await cropExports(o.db, 'TUR', f, now, 0)).toBeNull()
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
