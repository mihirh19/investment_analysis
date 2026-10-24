import { AIS_BOX, type Ship, type ShipsView } from '@shared/world'
import { getJson, type FetchFn } from '../market/http'
import { parseAisMessage, parseDigitraffic, parseDigitrafficVessels } from './parse'
import { WORLD_UA } from './sync'

const MINUTE = 60_000
/** Ships not heard from for this long drop off the map. */
const STALE = 30 * MINUTE
const MAX_AIS = 20_000

type VesselInfo = { name: string | null; type: number | null }

/**
 * Ships at sea, fetched only while the World map is open: Finland's Digitraffic (Baltic, no key,
 * minutes old) and, when the person has added their own free key, aisstream.io's live feed for
 * India's seas. The aisstream socket closes a few minutes after the map is left.
 */
export class ShipFeed {
  private dt: { at: number; ships: Ship[]; error: string | null } | null = null
  private dtVessels: { at: number; map: Map<number, VesselInfo> } | null = null
  private dtLoading: Promise<void> | null = null
  private readonly ais = new Map<number, Ship>()
  private readonly aisInfo = new Map<number, VesselInfo>()
  private aisError: string | null = null
  private socket: WebSocket | null = null
  private lastAsk = 0
  private idle: NodeJS.Timeout | null = null
  private retry: NodeJS.Timeout | null = null

  constructor(
    private readonly aisKey: () => string | null,
    private readonly f: FetchFn = fetch,
    private readonly makeSocket: (url: string) => WebSocket = (url) => new WebSocket(url)
  ) {}

  async view(): Promise<ShipsView> {
    this.lastAsk = Date.now()
    this.ensureAis()
    await this.digitraffic()
    const cutoff = Date.now() - STALE
    for (const [k, s] of this.ais) if (s.at < cutoff) this.ais.delete(k)
    const key = !!this.aisKey()
    return {
      ships: [...(this.dt?.ships ?? []), ...this.ais.values()],
      feeds: [
        {
          key: 'digitraffic',
          label: 'Baltic Sea (Finland)',
          credit: 'Source: Fintraffic / digitraffic.fi',
          count: this.dt?.ships.length ?? 0,
          error: this.dt?.error ?? null,
          on: true
        },
        {
          key: 'aisstream',
          label: 'India’s seas (your aisstream.io key)',
          credit: 'aisstream.io',
          count: this.ais.size,
          error: key ? this.aisError : null,
          on: key
        }
      ]
    }
  }

  /** Digitraffic positions, at most once a minute; vessel names and types every six hours. */
  private digitraffic(): Promise<void> {
    if (this.dt && Date.now() - this.dt.at < MINUTE) return Promise.resolve()
    this.dtLoading ??= (async () => {
      const opts = {
        fetch: this.f,
        timeoutMs: 30_000,
        headers: { 'User-Agent': WORLD_UA, 'Digitraffic-User': WORLD_UA, 'Accept-Encoding': 'gzip' }
      }
      try {
        if (!this.dtVessels || Date.now() - this.dtVessels.at > 6 * 60 * MINUTE) {
          try {
            this.dtVessels = {
              at: Date.now(),
              map: parseDigitrafficVessels(await getJson('https://meri.digitraffic.fi/api/ais/v1/vessels', opts))
            }
          } catch {
            // Names are a nicety; positions still show without them.
          }
        }
        const ships = parseDigitraffic(
          await getJson('https://meri.digitraffic.fi/api/ais/v1/locations', opts),
          this.dtVessels?.map
        )
        this.dt = { at: Date.now(), ships, error: null }
      } catch (e) {
        this.dt = { at: Date.now(), ships: this.dt?.ships ?? [], error: (e as Error).message }
      } finally {
        this.dtLoading = null
      }
    })()
    return this.dtLoading
  }

  private ensureAis(): void {
    const key = this.aisKey()
    if (this.idle) clearTimeout(this.idle)
    // Nobody looking for three minutes: close the socket.
    this.idle = setTimeout(() => this.closeAis(), 3 * MINUTE)
    if (!key || this.socket || this.retry) return
    let ws: WebSocket
    try {
      ws = this.makeSocket('wss://stream.aisstream.io/v0/stream')
    } catch (e) {
      this.aisError = (e as Error).message
      return
    }
    ws.binaryType = 'arraybuffer'
    this.socket = ws
    let refused = false
    ws.onopen = () => {
      // aisstream.io drops connections that don't subscribe within three seconds.
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [AIS_BOX],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        })
      )
      this.aisError = null
    }
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      if (raw.startsWith('{"error"')) {
        try {
          this.aisError = `aisstream.io: ${(JSON.parse(raw) as { error: string }).error}`
        } catch {
          this.aisError = 'aisstream.io refused the connection'
        }
        refused = true
        return
      }
      this.take(raw)
    }
    ws.onerror = () => {
      this.aisError ??= 'Could not reach aisstream.io'
    }
    ws.onclose = () => {
      if (this.socket === ws) this.socket = null
      // Still wanted and not turned away: try again in a minute.
      if (!refused && Date.now() - this.lastAsk < 3 * MINUTE && this.aisKey())
        this.retry = setTimeout(() => {
          this.retry = null
          this.ensureAis()
        }, MINUTE)
    }
  }

  /** One message from aisstream.io: a position, or a ship's name and type. */
  take(raw: string): void {
    const m = parseAisMessage(raw)
    if (!m) return
    if (m.name !== undefined || m.type !== undefined) {
      const info = this.aisInfo.get(m.mmsi) ?? { name: null, type: null }
      this.aisInfo.set(m.mmsi, { name: m.name ?? info.name, type: m.type ?? info.type })
    }
    const info = this.aisInfo.get(m.mmsi)
    const old = this.ais.get(m.mmsi)
    if (m.ship) {
      if (!old && this.ais.size >= MAX_AIS) {
        // Make room by dropping the ship heard from longest ago.
        let oldest: number | null = null
        for (const [k, s] of this.ais) if (oldest === null || s.at < this.ais.get(oldest)!.at) oldest = k
        if (oldest !== null) this.ais.delete(oldest)
      }
      this.ais.set(m.mmsi, {
        mmsi: m.mmsi,
        lat: m.ship.lat!,
        lon: m.ship.lon!,
        sog: m.ship.sog ?? null,
        cog: m.ship.cog ?? null,
        at: m.ship.at ?? Date.now(),
        name: info?.name ?? null,
        type: info?.type ?? null,
        source: 'aisstream'
      })
    } else if (old && info) this.ais.set(m.mmsi, { ...old, name: info.name ?? old.name, type: info.type ?? old.type })
  }

  private closeAis(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const ws = this.socket
    this.socket = null
    ws?.close()
  }

  /** The key changed or was removed: start over with it. */
  keyChanged(): void {
    this.closeAis()
    this.ais.clear()
    this.aisInfo.clear()
    this.aisError = null
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.closeAis()
  }
}
