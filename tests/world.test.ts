import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, schema, type Db } from '../src/main/db'
import { eq } from 'drizzle-orm'
import { createServices } from '../src/main/services'
import {
  csvRecords,
  mergeEvents,
  parseArcgis,
  parseAisMessage,
  parseBisFx,
  parseBisPolicy,
  parseComtrade,
  parseDigitraffic,
  parseDigitrafficVessels,
  parseGdacs,
  parseOecdLatest,
  parsePlaces,
  parseScfi,
  parseTraffic,
  parseUsgs,
  parseWorldBank,
  parseYahooSpark
} from '../src/main/world/parse'
import { ShipFeed } from '../src/main/world/ships'
import { unwrapDateLine } from '../src/shared/geo'
import type { Geometry } from 'geojson'
import * as store from '../src/main/world/store'
import { WorldSync, WORLD_UA } from '../src/main/world/sync'
import { alpha3From2, alpha3FromNumeric, countryName, EURO_AREA, isCountry } from '../src/shared/countries'
import { figureAt, metricOf, scalePosition, shipClass, summariseTraffic, type TrafficDay } from '../src/shared/world'

const fx = (f: string) => join(__dirname, 'fixtures', 'world', f)
const text = (f: string) => readFileSync(fx(f), 'utf8')
const json = (f: string) => JSON.parse(text(f)) as unknown

describe('country codes', () => {
  it('joins the codes each source uses', () => {
    expect(alpha3From2('IN')).toBe('IND')
    expect(alpha3FromNumeric('356')).toBe('IND')
    expect(alpha3FromNumeric(36)).toBe('AUS')
    expect(countryName('USA')).toBe('United States')
    expect(countryName('XKX')).toBe('Kosovo')
    expect(isCountry('IND')).toBe(true)
    expect(isCountry('EAS')).toBe(false)
    expect(EURO_AREA).toContain('DEU')
  })
})

describe('World map readers', () => {
  it('reads CSV with quoted commas and doubled quotes', () => {
    const rows = csvRecords('A,B,C\n1,"x, y","say ""hi"""\r\n2,,z\n')
    expect(rows).toEqual([
      { A: '1', B: 'x, y', C: 'say "hi"' },
      { A: '2', B: '', C: 'z' }
    ])
  })

  it('reads PortWatch chokepoints, ports and daily traffic', () => {
    const chokes = parsePlaces(parseArcgis(json('chokepoints_list.json')).rows, 'chokepoint')
    expect(chokes.length).toBeGreaterThanOrEqual(20)
    const suez = chokes.find((c) => c.id === 'chokepoint1')!
    expect(suez.name).toBe('Suez Canal')
    expect(suez.lat).toBeCloseTo(30.59, 1)
    const ports = parsePlaces(parseArcgis(json('india_ports.json')).rows, 'port')
    expect(ports.find((p) => p.id === 'port776')?.locode).toBe('IN BOM')

    const days = parseTraffic(parseArcgis(json('chokepoints_daily.json')).rows)
    expect(days.length).toBe(14)
    expect(days[0]).toMatchObject({
      id: 'chokepoint1',
      date: '2026-10-12',
      total: 50,
      tanker: 20,
      container: 9,
      imports: null
    })
    const calls = parseTraffic(parseArcgis(json('india_ports_daily.json')).rows)
    expect(calls[0]).toMatchObject({
      id: 'port776',
      date: '2026-10-10',
      total: 26,
      container: 9,
      tanker: 3,
      imports: 311751,
      exports: 141507
    })
  })

  it('reports PortWatch paging and errors', () => {
    expect(parseArcgis({ features: [], exceededTransferLimit: true }).more).toBe(true)
    expect(() => parseArcgis({ error: { message: 'Invalid query' } })).toThrow('PortWatch: Invalid query')
  })

  it("reads UN Comtrade's India rows and drops the world total", () => {
    const p = parseComtrade(json('comtrade_ind_2024_partners.json'))
    expect(p.truncated).toBe(false)
    expect(p.rows.some((r) => r.partner === 'W00')).toBe(false)
    expect(p.rows.every((r) => r.flow === 'X' && r.cmd === 'TOTAL' && r.period === '2024')).toBe(true)
    expect(p.rows.find((r) => r.partner === 'AFG')?.partnerName).toBe('Afghanistan')
    const c = parseComtrade(json('comtrade_ind_2025_commods.json'))
    expect(c.rows.length).toBeGreaterThan(10)
    expect(new Set(c.rows.map((r) => r.flow))).toEqual(new Set(['M']))
    const big = parseComtrade({
      count: 500,
      data: Array.from({ length: 500 }, () => ({
        partnerISO: 'USA',
        flowCode: 'M',
        cmdCode: '85',
        period: '2025',
        primaryValue: 1
      }))
    })
    expect(big.truncated).toBe(true)
    expect(
      parseComtrade({
        data: [
          {
            partnerISO: 'S19',
            partnerDesc: 'Other Asia, nes',
            flowCode: 'X',
            cmdCode: 'TOTAL',
            period: '2025',
            primaryValue: 5
          }
        ]
      }).rows[0].partner
    ).toBe('TWN')
  })

  it('reads World Bank figures for countries only', () => {
    const { figures } = parseWorldBank(json('worldbank_trade_gdp.json'))
    expect(figures.length).toBeGreaterThan(20)
    expect(figures.every((f) => isCountry(f.iso3))).toBe(true)
    expect(figures.some((f) => f.iso3 === 'AFE')).toBe(false)
    expect(() => parseWorldBank([{ message: [{ value: 'Invalid value' }] }])).toThrow('World Bank: Invalid value')
  })

  it('reads BIS policy rates, spreading the ECB rate to euro members', () => {
    const rates = parseBisPolicy(text('bis_cbpol.csv'), new Date('2026-10-24'))
    const at = (c: string) => rates.find((r) => r.iso3 === c)
    expect(at('AUS')).toMatchObject({ period: '2026-10-15', value: 4.6 })
    // Austria's own series stopped in 1998; it now takes the euro area's.
    expect(at('AUT')?.period.startsWith('2026')).toBe(true)
    expect(at('AUT')?.value).toBe(at('DEU')?.value)
    expect(rates.some((r) => r.iso3 === 'XM')).toBe(false)
  })

  it("reads BIS exchange rates as each currency's move against the dollar", () => {
    const moves = parseBisFx(text('bis_xru.csv'))
    expect(moves.length).toBeGreaterThan(5)
    const tm = moves.find((m) => m.iso3 === 'TKM')
    if (tm) expect(tm.value).toBeCloseTo(0, 6)
    // Fewer units per dollar means the currency rose.
    expect(
      parseBisFx('REF_AREA,COLLECTION,TIME_PERIOD,OBS_VALUE\nIN,A,2026-08,90\nIN,A,2026-09,88\n')[0].value
    ).toBeCloseTo((90 / 88 - 1) * 100, 6)
  })

  it('reads the latest OECD yield and leading indicator per country', () => {
    const y = parseOecdLatest(text('oecd_irlt.csv'))
    const gbr = y.find((r) => r.iso3 === 'GBR')!
    expect(gbr.period >= '2026-08').toBe(true)
    expect(new Set(y.map((r) => r.iso3)).size).toBe(y.length)
    const cli = parseOecdLatest(text('oecd_cli.csv'))
    // Regional aggregates (G4E…) are not countries.
    expect(cli.every((r) => isCountry(r.iso3))).toBe(true)
  })

  it("reads Yahoo's monthly index moves", () => {
    const m = parseYahooSpark(json('yahoo_spark.json'))
    const bist = m.find((x) => x.symbol === 'XU100.IS')!
    expect(bist.change).toBeCloseTo((11116.99 / 13251.9 - 1) * 100, 6)
    expect(bist.date).toMatch(/^\d{4}-\d\d-\d\d$/)
  })

  it('merges USGS quakes with GDACS alerts', () => {
    const usgs = parseUsgs(json('usgs.geojson'))
    expect(usgs.length).toBe(12)
    expect(usgs[0]).toMatchObject({ kind: 'EQ', source: 'USGS', magnitude: 4.7 })
    const gdacs = parseGdacs(json('gdacs.json'))
    expect(gdacs.some((e) => e.kind === 'TC' && e.level === 'Red' && e.title.includes('CHAMPI'))).toBe(true)
    const q = { ...usgs[0], id: 'usgs:x', lat: 10, lon: 20, time: '2026-10-20T10:00:00.000Z' }
    const g = {
      ...gdacs[0],
      id: 'gdacs:EQ:1',
      kind: 'EQ' as const,
      lat: 10.4,
      lon: 20.2,
      time: '2026-10-20T11:00:00.000Z',
      level: 'Orange' as const
    }
    const merged = mergeEvents([q], [g])
    expect(merged).toHaveLength(1)
    expect(merged[0].level).toBe('Orange')
  })

  it('reads the SCFI composite', () => {
    expect(parseScfi(json('scfi_current.json'))).toEqual([
      { date: '2026-10-16', value: 3679.579 },
      { date: '2026-10-23', value: 3681.3369 }
    ])
    expect(() => parseScfi({ data: { lineDataList: [] } })).toThrow()
  })

  it('reads Digitraffic ships with names and aisstream messages', () => {
    const vessels = parseDigitrafficVessels(json('digitraffic_vessels.json'))
    const ships = parseDigitraffic(json('digitraffic_locations.json'), vessels)
    expect(ships.length).toBeGreaterThan(10)
    expect(ships[0]).toMatchObject({ mmsi: 273388930, lon: 28.445555, lat: 59.785395, sog: 0, source: 'digitraffic' })
    expect(vessels.get(305468000)).toEqual({ name: 'KERLI', type: 70 })

    const pos = parseAisMessage(
      JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: {
          MMSI: 419000123,
          ShipName: 'DESH ',
          latitude: 18.9,
          longitude: 72.8,
          time_utc: '2026-10-24 08:01:02.123456789 +0000 UTC'
        },
        Message: { PositionReport: { Sog: 12.5, Cog: 271, Latitude: 18.9, Longitude: 72.8 } }
      })
    )!
    expect(pos.mmsi).toBe(419000123)
    expect(pos.ship).toMatchObject({
      lat: 18.9,
      lon: 72.8,
      sog: 12.5,
      cog: 271,
      at: Date.parse('2026-10-24T08:01:02.123Z')
    })
    expect(pos.name).toBe('DESH')
    expect(parseAisMessage('not json')).toBeNull()
    expect(
      parseAisMessage(
        JSON.stringify({
          MessageType: 'ShipStaticData',
          MetaData: { MMSI: 1 },
          Message: { ShipStaticData: { Name: 'A', Type: 84 } }
        })
      )
    ).toEqual({ mmsi: 1, name: 'A', type: 84 })
    expect(shipClass(84)).toBe('tanker')
    expect(shipClass(null)).toBe('other')
  })
})

describe('World map figures', () => {
  it('places values on a colour scale around the middle', () => {
    const g = metricOf('growth')
    expect(scalePosition(g, 0)).toBe(0)
    expect(scalePosition(g, 8)).toBe(1)
    expect(scalePosition(g, 20)).toBe(1)
    expect(scalePosition(g, -2)).toBe(-0.5)
    expect(scalePosition(g, null)).toBeNull()
  })

  it('takes a year’s figure, or a recent earlier one', () => {
    const s = { '2022': 1, '2024': 3 }
    expect(figureAt(s, 2024)).toEqual({ period: '2024', value: 3 })
    expect(figureAt(s, 2023)).toEqual({ period: '2022', value: 1 })
    expect(figureAt(s, 2030)).toBeNull()
    expect(figureAt(s, null)).toEqual({ period: '2024', value: 3 })
  })

  it('compares the latest week with the same week a year before', () => {
    const days: TrafficDay[] = []
    const start = Date.parse('2025-09-01')
    for (let i = 0; i <= 420; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
      days.push({ date, total: i > 400 ? 20 : 80, tanker: 0, container: 0, dryBulk: 0, imports: null, exports: null })
    }
    const s = summariseTraffic(days)
    expect(s.latestDate).toBe(days.at(-1)!.date)
    expect(s.recent).toBe(20)
    expect(s.yearAgo).toBe(80)
    expect(s.weekly.at(-1)!.total).toBe(20)
    expect(summariseTraffic([]).recent).toBeNull()
  })
})

describe('World map sync', () => {
  let dir: string
  let db: Db
  let close: () => void
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fp-world-'))
    const o = openDatabase(join(dir, 't.db'), '7'.repeat(64), resolve('drizzle'))
    db = o.db
    close = () => o.sqlite.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const asked: { url: string; ua: string | null }[] = []
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push({ url, ua: new Headers(init?.headers).get('User-Agent') })
    const route: [string, string][] = [
      ['PortWatch_chokepoints_database', 'chokepoints_list.json'],
      ['Daily_Chokepoints_Data', 'chokepoints_daily.json'],
      ['PortWatch_ports_database', 'india_ports.json'],
      ['Daily_Ports_Data', 'india_ports_daily.json'],
      ['cmdCode=TOTAL', 'comtrade_ind_2024_partners.json'],
      ['comtradeapi', 'comtrade_ind_2025_commods.json'],
      ['worldbank', 'worldbank_trade_gdp.json'],
      ['WS_CBPOL', 'bis_cbpol.csv'],
      ['WS_XRU', 'bis_xru.csv'],
      ['DF_FINMARK', 'oecd_irlt.csv'],
      ['DF_CLI', 'oecd_cli.csv'],
      ['spark', 'yahoo_spark.json'],
      ['earthquake.usgs', 'usgs.geojson'],
      ['gdacs', 'gdacs.json'],
      ['sse.net.cn', 'scfi_current.json']
    ]
    const hit = route.find(([k]) => url.includes(k))
    if (!hit) return new Response('not found', { status: 404 })
    return new Response(text(hit[1]), { status: 200 })
  }) as unknown as typeof fetch
  const now = () => new Date('2026-10-24T06:00:00Z')

  it('stays off until the map is opened, then fetches every source politely', async () => {
    asked.length = 0
    let updates = 0
    const sync = new WorldSync(db, () => updates++, fake, 0, 0, now)
    await sync.run()
    expect(asked).toHaveLength(0)
    sync.opened()
    expect(sync.enabled()).toBe(true)
    await sync.run()
    expect(asked.length).toBeGreaterThan(20)
    expect(asked.every((a) => a.ua === WORLD_UA)).toBe(true)
    expect(updates).toBeGreaterThanOrEqual(9)

    const map = store.worldMap(db, sync.status())
    expect(map.sources.every((s) => s.updatedAt && !s.error)).toBe(true)
    expect(map.places.find((p) => p.id === 'chokepoint1')).toMatchObject({
      kind: 'chokepoint',
      name: 'Suez Canal',
      followed: true,
      latestDate: '2026-10-18'
    })
    expect(map.places.find((p) => p.id === 'port776')?.followed).toBe(true)
    expect(map.figures.tradeGdp && Object.keys(map.figures.tradeGdp).length).toBeGreaterThan(5)
    expect(map.figures.policyRate?.AUS).toEqual({ '2026-10-15': 4.6 })
    expect(map.figures.index1m?.TUR).toBeDefined()
    expect(map.figures.yield10y?.GBR).toBeDefined()
    expect(map.trade.length).toBeGreaterThan(20)
    expect(map.events.length).toBeGreaterThan(12)
    expect(map.freight.map((f) => f.date)).toEqual(['2026-10-16', '2026-10-23'])

    // Nothing is due again straight away; the paused switch stops everything.
    asked.length = 0
    await sync.run()
    expect(asked).toHaveLength(0)
    sync.setEnabled(false)
    await sync.run(true)
    expect(asked).toHaveLength(0)
  })

  it('asks PortWatch only for days it does not have yet', async () => {
    const sync = new WorldSync(db, () => {}, fake, 0, 0, now)
    await sync.chokepoints()
    asked.length = 0
    await sync.chokepoints()
    const daily = new URL(asked.find((a) => a.url.includes('Daily_Chokepoints_Data'))!.url).searchParams.get('where')
    // Two weeks before the latest stored day (18 Oct), so revised days are fetched again.
    expect(daily).toBe("date >= DATE '2026-10-04'")
  })

  it('records a failing source without stopping the others', async () => {
    const broken = (async (url: string, init?: RequestInit) =>
      url.includes('sse.net.cn') ? new Response('down', { status: 503 }) : fake(url, init)) as unknown as typeof fetch
    const sync = new WorldSync(db, () => {}, broken, 0, 0, now)
    sync.setEnabled(true)
    await sync.run()
    const st = sync.status().sources
    expect(st.find((s) => s.key === 'freight')?.error).toMatch(/503/)
    expect(st.find((s) => s.key === 'comtrade')?.error).toBeNull()
  })

  it('asks the World Bank again only for the indicators that failed', async () => {
    const flaky = (async (url: string, init?: RequestInit) =>
      url.includes('FI.RES.TOTL.CD')
        ? new Response('busy', { status: 502 })
        : fake(url, init)) as unknown as typeof fetch
    const sync = new WorldSync(db, () => {}, flaky, 0, 0, now)
    await expect(sync.worldBank()).rejects.toThrow(/reserves/)
    asked.length = 0
    await expect(sync.worldBank()).rejects.toThrow(/reserves/)
    expect(asked.filter((a) => a.url.includes('worldbank'))).toHaveLength(0)
  })

  it("keeps the person's aisstream key encrypted and checks its shape", () => {
    const services = createServices({
      db,
      casparserExe: '',
      encrypt: (s) => `enc:${s}`,
      decrypt: (s) => s.replace(/^enc:/, '')
    })
    expect(services.getAisStatus()).toEqual({ hasKey: false, keyEnding: null })
    expect(() => services.setAisKey('short')).toThrow(/aisstream/)
    expect(services.setAisKey('abcdef0123456789abcdef0123456789')).toEqual({ hasKey: true, keyEnding: '6789' })
    const stored = db.select().from(schema.settings).where(eq(schema.settings.key, 'world:ais')).get()!
    expect(stored.value).toContain('enc:abcdef')
    expect(services.removeAisKey()).toEqual({ hasKey: false, keyEnding: null })
    services.stopShips()
  })

  it('starts the updates the first time the map is opened', () => {
    let opened = 0
    const world = {
      opened: () => opened++,
      setEnabled: () => {},
      enabled: () => true,
      status: () => ({ sources: [], enabled: true, refreshing: false }),
      run: async () => {}
    }
    const services = createServices({ db, casparserExe: '', encrypt: (s) => s, decrypt: (s) => s, world })
    const map = services.getWorldMap()
    expect(opened).toBe(1)
    expect(map).toMatchObject({ enabled: true, places: [], trade: [] })
    services.stopShips()
  })
})

describe('live ships', () => {
  it('keeps aisstream positions with names from static messages', () => {
    const feed = new ShipFeed(() => null)
    feed.take(
      JSON.stringify({
        MessageType: 'ShipStaticData',
        MetaData: { MMSI: 7 },
        Message: { ShipStaticData: { Name: 'TANKER ONE', Type: 80 } }
      })
    )
    feed.take(
      JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: { MMSI: 7, latitude: 12, longitude: 60, time_utc: new Date().toISOString() },
        Message: { PositionReport: { Sog: 10, Cog: 90 } }
      })
    )
    const ais = (feed as unknown as { ais: Map<number, { name: string; type: number; lat: number }> }).ais
    expect(ais.get(7)).toMatchObject({ name: 'TANKER ONE', type: 80, lat: 12 })
    feed.stop()
  })
})

describe.skipIf(!process.env.FP_LIVE)('live World map sources', () => {
  it('fetches every source once', { timeout: 600_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-world-live-'))
    const o = openDatabase(join(dir, 't.db'), '8'.repeat(64), resolve('drizzle'))
    try {
      const sync = new WorldSync(o.db)
      sync.setEnabled(true)
      await sync.run()
      const map = store.worldMap(o.db, sync.status())
      console.log(JSON.stringify(map.sources.map((s) => [s.key, s.updatedAt, s.error])))
      console.log(
        'places',
        map.places.length,
        'followed',
        map.places.filter((p) => p.followed).length,
        'trade',
        map.trade.length,
        'events',
        map.events.length,
        'freight',
        map.freight.length
      )
      console.log(
        'figures',
        Object.fromEntries(Object.entries(map.figures).map(([k, v]) => [k, Object.keys(v!).length]))
      )
      const feed = new ShipFeed(() => null)
      const ships = await feed.view()
      feed.stop()
      console.log('ships', ships.ships.length, JSON.stringify(ships.feeds))
      expect(map.sources.filter((s) => s.error)).toEqual([])
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// FP_WRITE_DEMO=1 npx vitest run tests/world.test.ts -t "demo seed": refreshes tests/fixtures/demo/family.world.json from the live sources.
describe.skipIf(!process.env.FP_WRITE_DEMO)('World map demo seed', () => {
  it('writes a trimmed copy of live data for the demo profile', { timeout: 900_000 }, async () => {
    const { writeFileSync } = await import('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'fp-world-demo-'))
    const o = openDatabase(join(dir, 't.db'), '9'.repeat(64), resolve('drizzle'))
    try {
      const sync = new WorldSync(o.db)
      sync.setEnabled(true)
      await sync.run()
      const db = o.db
      const r3 = (x: number) => Math.round(x * 1000) / 1000
      const figures: Record<string, { iso3: string; period: string; value: number }[]> = {}
      for (const f of db.select().from(schema.worldFigures).all()) {
        if (/^\d{4}$/.test(f.period) && f.period < '2018') continue
        const value = Math.abs(f.value) >= 1000 ? Math.round(f.value) : Math.round(f.value * 100) / 100
        ;(figures[f.metric] ??= []).push({ iso3: f.iso3, period: f.period, value })
      }
      const traffic = db.select().from(schema.worldTraffic).all()
      const latest = traffic.reduce((m, t) => (t.date > m ? t.date : m), '')
      const day = (k: number) => new Date(Date.parse(latest) - k * 86_400_000).toISOString().slice(0, 10)
      const keep = traffic.filter((t) => t.date > day(42) || (t.date > day(372) && t.date <= day(364)))
      const followed = new Set(keep.map((t) => t.id))
      const places = db
        .select()
        .from(schema.worldPlaces)
        .all()
        .filter((p) => p.kind === 'chokepoint' || followed.has(p.id) || (p.vessels ?? 0) >= 1500)
        .map((p) => ({ ...p, lat: r3(p.lat), lon: r3(p.lon) }))
      const seed = {
        figures,
        places,
        traffic: keep,
        trade: db.select().from(schema.worldTrade).all(),
        events: store.events(db),
        freight: store.freight(db)
      }
      writeFileSync(resolve('tests/fixtures/demo/family.world.json'), JSON.stringify(seed))
      console.log(
        'wrote demo seed',
        JSON.stringify({
          places: places.length,
          traffic: keep.length,
          trade: seed.trade.length,
          events: seed.events.length
        })
      )
    } finally {
      o.sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('country shapes', () => {
  it('never jump across the 180° line, so no band is drawn across the map', async () => {
    const { feature } = await import('topojson-client')
    for (const file of ['countries-110m.json', 'countries-50m.json']) {
      const topo = JSON.parse(readFileSync(join('node_modules', 'world-atlas', file), 'utf8'))
      const fc = feature(topo, topo.objects.countries) as unknown as { features: { properties: { name: string }; geometry: Geometry }[] }
      const ringsOf = (g: Geometry) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [])
      const jumps = (g: Geometry) => ringsOf(g).some((r) => r.some((p, i) => i > 0 && Math.abs(p[0] - r[i - 1][0]) > 180))
      // Fiji and Russia (and Antarctica, which the map leaves out) cross it in the source.
      expect(fc.features.filter((f) => jumps(f.geometry)).map((f) => f.properties.name)).toEqual(expect.arrayContaining(['Fiji', 'Russia']))
      expect(fc.features.filter((f) => f.properties.name !== 'Antarctica' && jumps(unwrapDateLine(f.geometry)))).toHaveLength(0)
    }
  })
})
