// The app's pages, grouped into a few sections. The sidebar lists sections; a section with more
// than one page shows its pages as tabs above the page.

export interface NavPage {
  to: string
  label: string
  end?: boolean
}

export interface NavSection {
  label: string
  pages: NavPage[]
}

export const SECTIONS: NavSection[] = [
  { label: 'Overview', pages: [{ to: '/', label: 'Overview', end: true }] },
  {
    label: 'Investments',
    pages: [
      { to: '/holdings', label: 'Holdings' },
      { to: '/performance', label: 'Performance' },
      { to: '/analysis', label: 'Analysis' },
      { to: '/exposure', label: 'Sectors & exposure' },
      { to: '/funds', label: 'Funds' },
      { to: '/dividends', label: 'Dividends' }
    ]
  },
  {
    label: 'Assets',
    pages: [
      { to: '/property', label: 'Property & rent' },
      { to: '/farm', label: 'Farm' },
      { to: '/vehicles', label: 'Vehicles' },
      { to: '/retirement', label: 'EPF & NPS' },
      { to: '/insurance', label: 'Insurance' },
      { to: '/other-assets', label: 'Other assets' }
    ]
  },
  { label: 'Loans & EMIs', pages: [{ to: '/loans', label: 'Loans & EMIs' }] },
  {
    label: 'Spending & tax',
    pages: [
      { to: '/spending', label: 'Spending' },
      { to: '/tax', label: 'Tax' }
    ]
  },
  {
    label: 'Planning',
    pages: [
      { to: '/forecast', label: 'Forecast & inflation' },
      { to: '/rebalance', label: 'Rebalance' }
    ]
  },
  { label: 'Research', pages: [{ to: '/research', label: 'Research' }] },
  {
    label: 'Records',
    pages: [
      { to: '/activity', label: 'Activity' },
      { to: '/import', label: 'Import statements' },
      { to: '/people', label: 'People & accounts' },
      { to: '/settings', label: 'Settings & backup' }
    ]
  }
]

export const pageActive = (p: NavPage, pathname: string) =>
  p.end ? pathname === p.to : pathname === p.to || pathname.startsWith(`${p.to}/`)

export const sectionOf = (pathname: string) => SECTIONS.find((s) => s.pages.some((p) => pageActive(p, pathname)))
