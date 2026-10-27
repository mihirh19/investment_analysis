// The app's screens, grouped into sections. Each opens as a tab in the terminal; a section with
// more than one screen shows its others as tabs along the top of the screen. Codes are what the
// command line takes, terminal-style (HOLD, FARM, SCR…).

export interface NavPage {
  to: string
  label: string
  code: string
  end?: boolean
}

export interface NavSection {
  label: string
  pages: NavPage[]
  /** Deeper pages (a company under Research) belong to the section too. */
  prefix?: string
}

export const SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    pages: [
      { to: '/', label: 'Overview', code: 'HOME', end: true },
      { to: '/alerts', label: 'Alerts', code: 'ALRT' }
    ]
  },
  {
    label: 'Investments',
    pages: [
      { to: '/holdings', label: 'Holdings', code: 'HOLD' },
      { to: '/performance', label: 'Performance', code: 'PERF' },
      { to: '/analysis', label: 'Analysis', code: 'ANLY' },
      { to: '/exposure', label: 'Sectors & exposure', code: 'EXPO' },
      { to: '/xray', label: 'X-ray', code: 'XRAY' },
      { to: '/funds', label: 'Funds', code: 'FUND' },
      { to: '/dividends', label: 'Dividends', code: 'DIV' },
      { to: '/calendar', label: 'Calendar', code: 'CAL' }
    ]
  },
  {
    label: 'Assets',
    pages: [
      { to: '/property', label: 'Property & rent', code: 'PROP' },
      { to: '/farm', label: 'Farm', code: 'FARM' },
      { to: '/vehicles', label: 'Vehicles', code: 'VEH' },
      { to: '/retirement', label: 'EPF & NPS', code: 'EPF' },
      { to: '/insurance', label: 'Insurance', code: 'INS' },
      { to: '/other-assets', label: 'Other assets', code: 'OTH' }
    ]
  },
  { label: 'Loans & EMIs', pages: [{ to: '/loans', label: 'Loans & EMIs', code: 'LOAN' }] },
  {
    label: 'Spending & tax',
    pages: [
      { to: '/spending', label: 'Spending', code: 'SPND' },
      { to: '/tax', label: 'Tax', code: 'TAX' }
    ]
  },
  {
    label: 'Planning',
    pages: [
      { to: '/forecast', label: 'Forecast & inflation', code: 'PLAN' },
      { to: '/rebalance', label: 'Rebalance', code: 'REBL' },
      { to: '/scenarios', label: 'What if', code: 'WHATIF' }
    ]
  },
  {
    label: 'Research',
    prefix: '/research',
    pages: [
      { to: '/research', label: 'Monitor', code: 'MON', end: true },
      { to: '/research/screener', label: 'Screener', code: 'SCR' },
      { to: '/research/sectors', label: 'Sectors', code: 'SECT' },
      { to: '/research/flows', label: 'Money flows', code: 'FLOW' },
      { to: '/research/news', label: 'Announcements', code: 'NEWS' },
      { to: '/research/world', label: 'World', code: 'WLD' },
      { to: '/research/commodities', label: 'Commodities', code: 'CMDY' }
    ]
  },
  {
    label: 'Records',
    pages: [
      { to: '/activity', label: 'Activity', code: 'ACT' },
      { to: '/import', label: 'Import statements', code: 'IMP' },
      { to: '/people', label: 'People & accounts', code: 'PPL' },
      { to: '/settings', label: 'Settings & backup', code: 'SET' }
    ]
  }
]

export const ALL_PAGES = SECTIONS.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.label })))

export const pageActive = (p: Pick<NavPage, 'to' | 'end'>, pathname: string) =>
  p.end ? pathname === p.to : pathname === p.to || pathname.startsWith(`${p.to}/`)

export const sectionOf = (pathname: string) =>
  SECTIONS.find((s) => s.pages.some((p) => pageActive(p, pathname))) ??
  SECTIONS.find((s) => s.prefix && pathname.startsWith(s.prefix))

/** A tab's title for a route: the screen's name, or a company's symbol. */
export function titleFor(route: string): string {
  const path = route.split('?')[0]
  const page = ALL_PAGES.find((p) => path === p.to)
  if (page) return page.label
  const company = /^\/research\/([^/]+)$/.exec(path)
  if (company) return decodeURIComponent(company[1]).toUpperCase()
  return ALL_PAGES.find((p) => pageActive(p, path))?.label ?? 'Screen'
}
