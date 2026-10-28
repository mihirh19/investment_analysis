import { pageActive, type NavPage } from '../lib/nav'

// The simple look's map of the app: a few areas along the top, each with its screens as tabs, and
// everything else under More. Every screen is the same one the terminal shows.

export interface Area {
  label: string
  /** Where the area opens. */
  to: string
  pages: NavPage[]
  /** Deeper pages (a company, a fund) that belong to the area too. */
  match?: RegExp
}

export const AREAS: Area[] = [
  { label: 'Home', to: '/', pages: [{ to: '/', label: 'Home', code: 'HOME', end: true }] },
  {
    label: 'Investments',
    to: '/holdings',
    pages: [
      { to: '/holdings', label: 'Holdings', code: 'HOLD' },
      { to: '/performance', label: 'Returns', code: 'PERF' },
      { to: '/analysis', label: 'Analysis', code: 'ANLY' },
      { to: '/exposure', label: 'Sectors', code: 'EXPO' },
      { to: '/xray', label: 'X-ray', code: 'XRAY' },
      { to: '/dividends', label: 'Dividends', code: 'DIV' },
      { to: '/calendar', label: 'Calendar', code: 'CAL' },
      { to: '/tax', label: 'Tax', code: 'TAX' }
    ]
  },
  {
    label: 'Stocks',
    to: '/research',
    match: /^\/research\/(?!funds$|fund\/)/,
    pages: [
      { to: '/research', label: 'Markets', code: 'MON', end: true },
      { to: '/research/screener', label: 'Screener', code: 'SCR' },
      { to: '/research/sectors', label: 'Sectors', code: 'SECT' },
      { to: '/research/flows', label: 'Money flows', code: 'FLOW' },
      { to: '/research/news', label: 'Announcements', code: 'NEWS' },
      { to: '/research/commodities', label: 'Commodities', code: 'CMDY' },
      { to: '/research/world', label: 'World', code: 'WLD' }
    ]
  },
  {
    label: 'Mutual funds',
    to: '/funds',
    match: /^\/research\/fund\//,
    pages: [
      { to: '/funds', label: 'My funds', code: 'FUND' },
      { to: '/research/funds', label: 'Explore funds', code: 'MFS' }
    ]
  },
  { label: 'Farm', to: '/farm', pages: [{ to: '/farm', label: 'Farm', code: 'FARM' }] },
  {
    label: 'Plan',
    to: '/forecast',
    pages: [
      { to: '/forecast', label: 'Forecast', code: 'PLAN' },
      { to: '/rebalance', label: 'Rebalance', code: 'REBL' },
      { to: '/scenarios', label: 'What if', code: 'WHATIF' },
      { to: '/spending', label: 'Spending', code: 'SPND' }
    ]
  }
]

/** Under More: grouped, and each opens on its own (no tabs). */
export const MORE: { label: string; pages: NavPage[] }[] = [
  {
    label: 'What you own',
    pages: [
      { to: '/property', label: 'Property & rent', code: 'PROP' },
      { to: '/vehicles', label: 'Vehicles', code: 'VEH' },
      { to: '/retirement', label: 'EPF & NPS', code: 'EPF' },
      { to: '/insurance', label: 'Insurance', code: 'INS' },
      { to: '/other-assets', label: 'Other assets', code: 'OTH' },
      { to: '/loans', label: 'Loans & EMIs', code: 'LOAN' }
    ]
  },
  {
    label: 'Records',
    pages: [
      { to: '/alerts', label: 'Alerts', code: 'ALRT' },
      { to: '/activity', label: 'Activity', code: 'ACT' },
      { to: '/import', label: 'Import statements', code: 'IMP' },
      { to: '/people', label: 'People & accounts', code: 'PPL' },
      { to: '/settings', label: 'Settings & backup', code: 'SET' }
    ]
  }
]

/** The area a screen belongs to, if any (More's screens belong to none). */
export function areaOf(pathname: string): Area | undefined {
  return (
    AREAS.find((a) => a.pages.some((p) => pageActive(p, pathname))) ?? AREAS.find((a) => a.match?.test(pathname))
  )
}
