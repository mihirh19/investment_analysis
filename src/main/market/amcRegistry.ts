// Snapshot of AMFI's portfolio-disclosure directory (amfiindia.com/online-center/portfolio-disclosure),
// taken 2026-10-11. Used when the live page cannot be read; the live list is preferred.

export interface AmcEntry {
  id: string
  name: string
  /** The fund house's own monthly portfolio disclosure page. */
  monthlyUrl: string | null
}

export const BUNDLED_AMC_REGISTRY: AmcEntry[] = [
  { id: '62', name: '360 ONE Mutual Fund', monthlyUrl: 'https://www.360.one/asset/mutual-funds/downloads/' },
  { id: '85', name: 'Abakkus Mutual Fund', monthlyUrl: 'https://www.abakkusmf.com/statutory-disclosures.html#' },
  {
    id: '3',
    name: 'Aditya Birla Sun Life Mutual Fund',
    monthlyUrl: 'https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolio'
  },
  { id: '86', name: 'AlphaGrep Mutual Fund', monthlyUrl: 'https://www.alphagrepmf.ai/disclosures' },
  { id: '80', name: 'Angel One Mutual Fund', monthlyUrl: 'https://www.angelonemf.com/downloads' },
  { id: '87', name: 'ASK MUTUAL FUND', monthlyUrl: 'https://www.askmutualfund.com/#/downloads' },
  { id: '53', name: 'Axis Mutual Fund', monthlyUrl: 'https://www.axismf.com/statutory-disclosures' },
  {
    id: '75',
    name: 'Bajaj Finserv Mutual Fund',
    monthlyUrl: 'https://www.bajajamc.com/downloads?statutory-disclosures='
  },
  { id: '48', name: 'Bandhan Mutual Fund', monthlyUrl: 'https://bandhanmutual.com/downloads/disclosures' },
  { id: '46', name: 'Bank of India Mutual Fund', monthlyUrl: 'https://www.boimf.in/investor-corner#t2' },
  {
    id: '4',
    name: 'Baroda BNP Paribas Mutual Fund',
    monthlyUrl: 'https://www.barodabnpparibasmf.in/downloads/monthly-portfolio-scheme'
  },
  {
    id: '32',
    name: 'Canara Robeco Mutual Fund',
    monthlyUrl:
      'https://www.canararobeco.com/documents/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio/'
  },
  { id: '81', name: 'Capitalmind Mutual Fund', monthlyUrl: 'https://capitalmindmf.com/statutory-disclosures.html#' },
  { id: '91', name: 'Carnelian Mutual Fund', monthlyUrl: null },
  { id: '84', name: 'Choice Mutual Fund', monthlyUrl: 'https://choicemf.com/disclosures/monthly-portfolio' },
  {
    id: '6',
    name: 'DSP Mutual Fund',
    monthlyUrl: 'https://www.dspim.com/about-us/mandatory-disclosure/portfolio-disclosures'
  },
  { id: '47', name: 'Edelweiss Mutual Fund', monthlyUrl: 'https://www.edelweissmf.com/statutory#Portfolio-of-Schemes' },
  {
    id: '27',
    name: 'Franklin Templeton Mutual Fund',
    monthlyUrl: 'https://www.franklintempletonindia.com/investor/reports?firstFilter-12'
  },
  { id: '63', name: 'Groww Mutual Fund', monthlyUrl: 'https://growwmf.in/statutory-disclosure/portfolio' },
  {
    id: '9',
    name: 'HDFC Mutual Fund',
    monthlyUrl: 'https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio'
  },
  { id: '76', name: 'Helios Mutual Fund', monthlyUrl: 'https://www.heliosmf.in/portfolio-disclosure/' },
  {
    id: '37',
    name: 'HSBC Mutual Fund',
    monthlyUrl:
      'https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources/information-library#&accordion1446811090=2'
  },
  {
    id: '20',
    name: 'ICICI Prudential Mutual Fund',
    monthlyUrl:
      'https://www.icicipruamc.com/news-and-media/downloads?currentTabFilter=Disclosures&&subCatTabFilter=MonthlyPortfolioDisclosures'
  },
  { id: '65', name: 'IL&FS Mutual Fund (IDF)', monthlyUrl: 'http://www.ilfsinfrafund.com/other.php' },
  {
    id: '42',
    name: 'Invesco Mutual Fund',
    monthlyUrl: 'https://invescomutualfund.com/literature-and-form?tab=Complete'
  },
  { id: '70', name: 'ITI Mutual Fund', monthlyUrl: 'https://www.itiamc.com/statuory-disclosure' },
  {
    id: '82',
    name: 'Jio BlackRock Mutual Fund',
    monthlyUrl: 'https://www.jioblackrockamc.com/statutory-disclosure/disclosures/monthly-portfolio-disclosure'
  },
  {
    id: '16',
    name: 'JM Financial Mutual Fund',
    monthlyUrl: 'https://www.jmfinancialmf.com/downloads/Portfolio-Disclosure'
  },
  {
    id: '17',
    name: 'Kotak Mahindra Mutual Fund',
    monthlyUrl: 'https://www.kotakmf.com/Information/forms-and-downloads'
  },
  { id: '88', name: 'Lakshya Mutual Fund', monthlyUrl: null },
  { id: '18', name: 'LIC Mutual Fund', monthlyUrl: 'https://www.licmf.com/downloads/monthly-portfolio' },
  {
    id: '69',
    name: 'Mahindra Manulife Mutual Fund',
    monthlyUrl: 'https://www.mahindramanulife.com/downloads#mandatory-disclosures'
  },
  { id: '45', name: 'Mirae Asset Mutual Fund', monthlyUrl: 'https://www.miraeassetmf.co.in/downloads/portfolio' },
  {
    id: '89',
    name: 'Monarch Mutual Fund',
    monthlyUrl: 'https://www.monarchamc.in/forms-downloads/portfolio-holdings/monthly'
  },
  {
    id: '55',
    name: 'Motilal Oswal Mutual Fund',
    monthlyUrl: 'https://www.motilaloswalmf.com/downloads/scheme-portfolio-details'
  },
  { id: '54', name: 'Navi Mutual Fund', monthlyUrl: 'https://navi.com/mutual-fund/downloads/portfolio' },
  {
    id: '21',
    name: 'Nippon India Mutual Fund',
    monthlyUrl: 'https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures'
  },
  { id: '73', name: 'NJ Mutual Fund', monthlyUrl: 'https://downloads.njmutualfund.com/njmf_download.php?nme=127' },
  { id: '90', name: 'Nuvama Mutual Fund', monthlyUrl: null },
  {
    id: '78',
    name: 'Old Bridge Mutual Fund',
    monthlyUrl: 'https://oldbridgemf.com/statutory-disclosures.html#v-pills-tabContent2'
  },
  {
    id: '58',
    name: 'PGIM India Mutual Fund',
    monthlyUrl: 'https://www.pgimindia.com/mutual-funds/disclosures/Portfolios/Monthly-Portfolio'
  },
  { id: '64', name: 'PPFAS Mutual Fund', monthlyUrl: 'https://amc.ppfas.com/downloads/portfolio-disclosure/' },
  { id: '13', name: 'quant Mutual Fund', monthlyUrl: 'https://quantmutual.com/statutory-disclosures' },
  { id: '41', name: 'Quantum Mutual Fund', monthlyUrl: 'https://www.quantumamc.com/portfolio/combined/-1/1/0/0' },
  { id: '74', name: 'Samco Mutual Fund', monthlyUrl: 'https://www.samcomf.com/StatutoryDisclosure' },
  { id: '22', name: 'SBI Mutual Fund', monthlyUrl: 'https://www.sbimf.com/portfolios' },
  { id: '67', name: 'Shriram Mutual Fund', monthlyUrl: 'https://www.shriramamc.in/investor-statutory-disclosures' },
  {
    id: '33',
    name: 'Sundaram Mutual Fund',
    monthlyUrl: 'https://www.sundarammutual.com/Monthly-Fortnightly-Adhoc-Portfolios'
  },
  { id: '25', name: 'Tata Mutual Fund', monthlyUrl: 'https://www.tatamutualfund.com/schemes-related' },
  { id: '26', name: 'Taurus Mutual Fund', monthlyUrl: 'https://taurusmutualfund.com/monthly-portfolio' },
  {
    id: '83',
    name: 'The Wealth Company Mutual Fund',
    monthlyUrl: 'https://www.wealthcompanyamc.in/literature-forms/portfolio-documents/monthly/'
  },
  {
    id: '72',
    name: 'Trust Mutual Fund',
    monthlyUrl: 'https://www.trustmf.com/disclosures?activeTab=portfolio-disclosures'
  },
  {
    id: '79',
    name: 'Unifi Mutual Fund',
    monthlyUrl: 'https://unifimf.com/statutorydocuments/#monthly-portfolio-disclosure'
  },
  { id: '61', name: 'Union Mutual Fund', monthlyUrl: 'https://www.unionmf.com/about-us/downloads/monthly-portfolio' },
  {
    id: '28',
    name: 'UTI Mutual Fund',
    monthlyUrl: 'https://www.utimf.com/downloads/consolidate-all-portfolio-disclosure'
  },
  {
    id: '71',
    name: 'WhiteOak Capital Mutual Fund',
    monthlyUrl: 'https://mf.whiteoakamc.com/regulatory-disclosures/scheme-portfolios'
  },
  {
    id: '77',
    name: 'Zerodha Mutual Fund',
    monthlyUrl: 'https://www.zerodhafundhouse.com/resources/disclosures?source=footer'
  }
]
