// The family farm: crops grown each season, what they cost, what was harvested and sold, what is
// still in the godown or standing in the field, and today's mandi prices. Shared by main, the
// renderer and the phone app.

/** Crops grown in Gujarat, with Agmarknet's commodity name and id for mandi prices. */
export const CROPS = {
  GROUNDNUT: { label: 'Groundnut', gu: 'મગફળી', agmark: 'Groundnut', agmarkId: 10 },
  WHEAT: { label: 'Wheat', gu: 'ઘઉં', agmark: 'Wheat', agmarkId: 1 },
  COTTON: { label: 'Cotton (kapas)', gu: 'કપાસ', agmark: 'Cotton', agmarkId: 15 },
  CUMIN: { label: 'Cumin (jeera)', gu: 'જીરું', agmark: 'Cummin Seed(Jeera)', agmarkId: 38 },
  CASTOR: { label: 'Castor', gu: 'એરંડા', agmark: 'Castor Seed', agmarkId: 106 },
  BAJRA: { label: 'Bajra', gu: 'બાજરી', agmark: 'Bajra(Pearl Millet/Cumbu)', agmarkId: 28 },
  CHANA: { label: 'Chana (gram)', gu: 'ચણા', agmark: 'Bengal Gram(Gram)(Whole)', agmarkId: 6 },
  MUSTARD: { label: 'Mustard (rai)', gu: 'રાયડો', agmark: 'Mustard', agmarkId: 12 },
  SESAME: { label: 'Sesame (til)', gu: 'તલ', agmark: 'Sesamum(Sesame,Gingelly,Til)', agmarkId: 11 },
  JOWAR: { label: 'Jowar', gu: 'જુવાર', agmark: 'Jowar(Sorghum)', agmarkId: 5 },
  MAIZE: { label: 'Maize', gu: 'મકાઈ', agmark: 'Maize', agmarkId: 4 },
  TUR: { label: 'Tur (arhar)', gu: 'તુવેર', agmark: 'Red gram/Arhar/Tur(whole)', agmarkId: 45 },
  MOONG: { label: 'Moong', gu: 'મગ', agmark: 'Green Gram(Moong)(Whole)', agmarkId: 9 },
  URAD: { label: 'Urad', gu: 'અડદ', agmark: 'Black Gram(Urd Beans)(Whole)', agmarkId: 8 },
  SOYBEAN: { label: 'Soybean', gu: 'સોયાબીન', agmark: 'Soyabean', agmarkId: 13 },
  CORIANDER: { label: 'Coriander (dhana)', gu: 'ધાણા', agmark: 'Corriander seed', agmarkId: 92 },
  FENNEL: { label: 'Fennel (variyali)', gu: 'વરિયાળી', agmark: 'Soanf', agmarkId: 114 },
  ONION: { label: 'Onion', gu: 'ડુંગળી', agmark: 'Onion', agmarkId: 23 },
  GARLIC: { label: 'Garlic', gu: 'લસણ', agmark: 'Garlic', agmarkId: 25 },
  POTATO: { label: 'Potato', gu: 'બટાકા', agmark: 'Potato', agmarkId: 24 }
} as const
export type CropKey = keyof typeof CROPS
export const CROP_KEYS = Object.keys(CROPS) as CropKey[]

/**
 * How mandis sell a crop when they don't quote each variety: Saurashtra yards quote groundnut as
 * jini (fine, small seed) and jadi (bold), wheat as lokwan and tukda, chana as white and yellow.
 */
export const PRICE_CLASSES: Partial<Record<CropKey, { key: string; label: string; gu: string; note: string }[]>> = {
  GROUNDNUT: [
    { key: 'Jini', label: 'Jini (fine)', gu: 'જીણી', note: 'Small-seeded, mostly bunch (Spanish, "Java") groundnut' },
    { key: 'Jadi', label: 'Jadi (bold)', gu: 'જાડી', note: 'Bold-seeded, mostly spreading and semi-spreading (Virginia) groundnut' }
  ],
  WHEAT: [
    { key: 'Lokwan', label: 'Lokwan', gu: 'લોકવન', note: 'Lokwan wheat' },
    { key: 'Tukda', label: 'Tukda', gu: 'ટુકડા', note: 'Wheat sold as tukda' }
  ],
  CHANA: [
    { key: 'White', label: 'White (kabuli)', gu: 'સફેદ', note: 'White chana' },
    { key: 'Yellow', label: 'Yellow (desi)', gu: 'પીળા', note: 'Yellow chana' }
  ]
}

/**
 * Varieties commonly sown in Gujarat, with the names farmers use and the class a yard usually
 * sells them as. A trader can class a lot differently: the season's "sells as" can be changed.
 */
export const VARIETIES: Partial<Record<CropKey, { name: string; aka?: string[]; cls?: string; note?: string }[]>> = {
  GROUNDNUT: [
    { name: 'GG-20', aka: ['G20', 'G-20', '20'], cls: 'Jadi', note: 'Bold, semi-spreading' },
    { name: 'TG-37A', aka: ['37', 'G37', 'G-37', 'TG 37', 'TJ-37', 'TJ 37'], cls: 'Jini', note: 'Small seed, bunch' },
    { name: 'GJG-9', aka: ['9'], cls: 'Jini', note: 'Bunch' },
    { name: 'GJG-22', aka: ['22'], cls: 'Jadi', note: 'Bold, semi-spreading' },
    { name: 'GJG-17', aka: ['17'], cls: 'Jadi', note: 'Bold, spreading' },
    { name: 'GJG-31', aka: ['31'], cls: 'Jini', note: 'Bunch' },
    { name: 'GJG-32', aka: ['32'], cls: 'Jini', note: 'Bunch' },
    { name: 'GG-2', aka: ['2'], cls: 'Jini', note: 'Bunch' },
    { name: 'GG-5', cls: 'Jini', note: 'Bunch' },
    { name: 'GG-7', cls: 'Jini', note: 'Bunch' },
    { name: 'GG-11', aka: ['11'], cls: 'Jadi', note: 'Bold, spreading' },
    { name: 'GG-12', cls: 'Jadi', note: 'Bold, spreading' },
    { name: 'GG-13', cls: 'Jadi', note: 'Bold, spreading' },
    { name: 'JL-24', aka: ['24', 'Phule Pragati'], cls: 'Jini', note: 'Small seed, bunch' },
    { name: 'Kadiri-6', aka: ['K-6', 'K6'], cls: 'Jini', note: 'Bunch' },
    { name: 'Java', aka: ['Jawa'], cls: 'Jini', note: 'Small seed (trade name)' },
    { name: 'Jini', aka: ['Gini', 'Zini', 'Fine', 'જીણી'], cls: 'Jini', note: 'Fine: the yard class itself' },
    { name: 'Jadi', aka: ['Bold', 'જાડી'], cls: 'Jadi', note: 'Bold: the yard class itself' }
  ],
  WHEAT: [
    { name: 'Lokwan', aka: ['Lok-1', 'Lok 1', 'લોકવન'], cls: 'Lokwan' },
    { name: 'GW-496', aka: ['496'], cls: 'Tukda' },
    { name: 'GW-322', aka: ['322'], cls: 'Tukda' },
    { name: 'GW-366', aka: ['366'], cls: 'Tukda' },
    { name: 'GW-451', aka: ['451'], cls: 'Tukda' },
    { name: 'GW-513', aka: ['513'], cls: 'Tukda' },
    { name: 'Tukda', aka: ['ટુકડા'], cls: 'Tukda' },
    { name: 'Sharbati' }
  ],
  COTTON: [{ name: 'BT cotton', aka: ['BT', 'Shankar', 'Narma BT', 'Bt'] }, { name: 'Desi' }],
  CUMIN: [{ name: 'GC-4', aka: ['4'] }, { name: 'GJC-3', aka: ['3'] }],
  CHANA: [
    { name: 'GJG-3', cls: 'Yellow' },
    { name: 'GG-5', cls: 'Yellow' },
    { name: 'Kabuli', aka: ['White'], cls: 'White' },
    { name: 'Desi', aka: ['Yellow'], cls: 'Yellow' }
  ]
}

/** The catalogue entry a typed name means: "37" or "G37" is TG-37A. */
export function findVariety(crop: CropKey, name: string | null | undefined) {
  const n = (name ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!n) return null
  return (VARIETIES[crop] ?? []).find((v) => [v.name, ...(v.aka ?? [])].some((a) => a.toLowerCase().replace(/[\s_-]+/g, '') === n)) ?? null
}

export type FarmSeasonKind = 'KHARIF' | 'RABI' | 'SUMMER' | 'STOCK'
export const SEASON_LABELS: Record<FarmSeasonKind, string> = {
  KHARIF: 'Kharif (monsoon)',
  RABI: 'Rabi (winter)',
  SUMMER: 'Summer',
  STOCK: 'Stock from earlier'
}

/** GROWING: in the field. HARVESTED: in the godown (some may be sold). CLOSED: all sold or used. */
export type FarmStatus = 'GROWING' | 'HARVESTED' | 'CLOSED'

export const FARM_COST_KINDS = {
  SEED: 'Seed',
  FERTILISER: 'Fertiliser',
  PESTICIDE: 'Pesticide & spray',
  LABOUR: 'Labour',
  MACHINERY: 'Tractor & machinery',
  DIESEL: 'Diesel & electricity',
  WATER: 'Irrigation & water',
  LAND_RENT: 'Land rent',
  TRANSPORT: 'Transport',
  STORAGE: 'Storage & bags',
  OTHER: 'Other'
} as const
export type FarmCostKind = keyof typeof FARM_COST_KINDS

/** A quantity as typed: quintals (100 kg), man (20 kg, how Saurashtra quotes groundnut) or kg. */
export type QtyUnit = 'QTL' | 'MAN' | 'KG'
export const QTY_UNITS: Record<QtyUnit, { label: string; perQtl: number }> = {
  QTL: { label: 'quintal (100 kg)', perQtl: 1 },
  MAN: { label: 'man (20 kg)', perQtl: 5 },
  KG: { label: 'kg', perQtl: 100 }
}
export const toQuintals = (value: number, unit: QtyUnit) => value / QTY_UNITS[unit].perQtl

export type FarmEntryType = 'COST' | 'HARVEST' | 'SALE' | 'LOSS'

export interface FarmEntry {
  id: number
  seasonId: number
  date: string
  type: FarmEntryType
  costKind: FarmCostKind | null
  /** Quintals harvested, sold or lost. */
  quantityQtl: number | null
  /** Sale rate, ₹ per quintal. */
  rate: number | null
  /** ₹: the cost, or what the sale brought in before charges. */
  amount: number
  /** Mandi commission, hamali, transport on a sale. */
  charges: number | null
  mandi: string | null
  note: string | null
}

export interface FarmSeasonInput {
  id?: number
  personId: number
  crop: CropKey
  /** G20, Bold, Lokwan…: valued at that variety's price when the mandi reports it. */
  variety?: string | null
  /** What the mandi sells it as (Jini, Jadi…) when it doesn't quote the variety; from the catalogue when empty. */
  priceClass?: string | null
  season: FarmSeasonKind
  /** The year the crop is harvested (kharif 2026 is harvested Oct–Nov 2026). */
  year: number
  field?: string | null
  areaAcres?: number | null
  sownOn?: string | null
  expectedQtl?: number | null
  status: FarmStatus
  /** Mandi for this crop's price; the farm's default when empty. */
  market?: string | null
  note?: string | null
}

export type FarmEntryInput = Omit<FarmEntry, 'id'> & { id?: number }

/** One mandi's price for a crop on a day, ₹ per quintal. */
export interface MandiPrice {
  crop: CropKey
  market: string
  date: string
  min: number | null
  max: number | null
  modal: number
}

export interface CropPrice {
  crop: CropKey
  market: string
  /** The latest day with a price, and the price; null when none was found. */
  latest: MandiPrice | null
  /** Average modal price over the last 30, 90 and 180 days, and a year ago. */
  avg30: number | null
  avg90: number | null
  avg180: number | null
  yearAgo: number | null
  /** Minimum support price this season, ₹/quintal, when the crop has one. */
  msp: number | null
  mspSeason: string | null
  /** Each variety or class's latest price at this mandi, highest first, with the day's range when known. */
  varieties: { name: string; modal: number; date: string; min: number | null; max: number | null; source: 'AGMARKNET' | 'APMC' }[]
  /** Daily modal prices, oldest first, at most a year. */
  history: { date: string; modal: number }[]
  /** The price the family is waiting for, and whether today's has reached it. */
  target: number | null
  targetReached: boolean
}

export interface FarmSeasonView extends Required<Omit<FarmSeasonInput, 'id'>> {
  id: number
  personName: string
  entries: FarmEntry[]
  costs: number
  costsByKind: Partial<Record<FarmCostKind, number>>
  harvestedQtl: number
  soldQtl: number
  lostQtl: number
  /** Sales after mandi charges. */
  salesNet: number
  /** Quintals still in the godown from this season. */
  inStockQtl: number
  /** What a quintal cost to grow (costs ÷ harvest), when both are known. */
  costPerQtl: number | null
  /** Today's price × what is in stock, or × the expected yield while growing. */
  stockValue: number
  expectedValue: number | null
  /** Sales + what is left at today's price − costs. */
  profit: number
  profitPerAcre: number | null
  price: number | null
}

export interface FarmStock {
  personId: number
  personName: string
  crop: CropKey
  variety: string | null
  /** What the price is: the variety's own, its class's (e.g. Jini), or the middle of all varieties that day. */
  pricedAs: { kind: 'VARIETY' | 'CLASS' | 'CROP'; name: string | null }
  quantityQtl: number
  price: number | null
  priceDate: string | null
  market: string
  value: number
  /** Growing cost of what is left, when the seasons' costs are known. */
  cost: number | null
}

export interface FarmReport {
  defaultMarket: string
  /** In the godown now: counted in net worth. */
  stock: FarmStock[]
  stockValue: number
  /** Still in the field: expected yield at today's price, not counted. */
  growing: { seasonId: number; personName: string; crop: CropKey; season: FarmSeasonKind; year: number; areaAcres: number | null; expectedQtl: number | null; expectedValue: number | null }[]
  seasons: FarmSeasonView[]
  prices: CropPrice[]
  /** This financial year's farm income: sales after charges, and costs paid. */
  thisFy: { fy: string; sales: number; costs: number }
  pricesAsOf: string | null
  priceError: string | null
}

/** For the season form: varieties the mandi reported lately, the yard's classes with today's price, and Agmarknet's list. */
export interface CropVarieties {
  reported: { name: string; modal: number; date: string }[]
  classes: { key: string; label: string; gu: string; note: string; modal: number | null; min: number | null; max: number | null; date: string | null }[]
  all: string[]
}
