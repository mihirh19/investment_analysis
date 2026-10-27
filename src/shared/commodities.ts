// The commodity board: world futures that move Indian prices (oil, gas, metals, farm goods), and
// what the family sees at home (gold and silver in rupees, the farm's mandi prices).

export interface CommodityDef {
  symbol: string
  label: string
  unit: string
  group: 'Energy' | 'Metals' | 'Farm goods'
  /** Why it matters in India, in a line. */
  why: string
}

export const COMMODITIES: CommodityDef[] = [
  { symbol: 'BZ=F', label: 'Brent crude', unit: '$ a barrel', group: 'Energy', why: 'India buys most of its oil abroad; it feeds into fuel prices, inflation and the rupee.' },
  { symbol: 'CL=F', label: 'WTI crude', unit: '$ a barrel', group: 'Energy', why: 'The US benchmark; the gap to Brent shows how tight supply is.' },
  { symbol: 'NG=F', label: 'Natural gas (US)', unit: '$ per mmBtu', group: 'Energy', why: 'A guide to LNG costs for fertiliser, power and city gas.' },
  { symbol: 'GC=F', label: 'Gold', unit: '$ an ounce', group: 'Metals', why: 'With the rupee, it sets the gold price at home.' },
  { symbol: 'SI=F', label: 'Silver', unit: '$ an ounce', group: 'Metals', why: 'Precious and industrial (solar panels, electronics).' },
  { symbol: 'HG=F', label: 'Copper', unit: '$ a pound', group: 'Metals', why: 'Follows building and factory demand worldwide.' },
  { symbol: 'ALI=F', label: 'Aluminium', unit: '$ a tonne', group: 'Metals', why: 'Prices for Indian aluminium makers and buyers.' },
  { symbol: 'CT=F', label: 'Cotton', unit: '¢ a pound', group: 'Farm goods', why: 'World cotton prices pull on kapas prices at Gujarat mandis.' },
  { symbol: 'ZL=F', label: 'Soybean oil', unit: '¢ a pound', group: 'Farm goods', why: 'Edible oil prices pull on groundnut and mustard oil, so on those crops.' },
  { symbol: 'ZS=F', label: 'Soybeans', unit: '¢ a bushel', group: 'Farm goods', why: 'Sets the tone for oilseeds and soymeal exports.' },
  { symbol: 'ZW=F', label: 'Wheat', unit: '¢ a bushel', group: 'Farm goods', why: 'World wheat prices matter when India allows exports or imports.' },
  { symbol: 'ZC=F', label: 'Corn (maize)', unit: '¢ a bushel', group: 'Farm goods', why: 'Feed and ethanol demand; a guide for maize.' },
  { symbol: 'SB=F', label: 'Sugar', unit: '¢ a pound', group: 'Farm goods', why: 'World sugar prices decide whether Indian mills can export.' }
]

export interface CommodityRow extends CommodityDef {
  last: number | null
  change1d: number | null
  change1m: number | null
  change1y: number | null
  /** About a year of daily closes, for the sparkline. */
  points: number[]
}

export interface CommodityBoard {
  rows: CommodityRow[]
  /** At home: gold (₹ a 10 g, 24 carat) and silver (₹ a kg), and the farm's crops at its mandi. */
  india: { label: string; value: number; unit: string; change1d: number | null; asOf: string | null }[]
  at: string
}

/** Last close and its changes over a day, a month (21 trading days) and a year, from daily closes oldest first. */
export function summarise(closes: number[]): Pick<CommodityRow, 'last' | 'change1d' | 'change1m' | 'change1y'> {
  const n = closes.length
  const last = n ? closes[n - 1] : null
  const back = (k: number) => (n > k && closes[n - 1 - k] ? last! / closes[n - 1 - k] - 1 : null)
  return { last, change1d: back(1), change1m: back(21), change1y: n > 200 ? last! / closes[0] - 1 : null }
}
