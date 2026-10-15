# Family Portfolio

A Windows desktop app that keeps the family's investments in one encrypted database on this computer: Zerodha, Groww and INDmoney stocks, US stocks, mutual funds, ETFs, NPS, EPF, insurance, and everything else under **Other assets**: bank and post office deposits (FD, RD, NSC, KVP, SCSS, MIS, RBI bonds), PPF and Sukanya Samriddhi, bonds and NCDs, Sovereign Gold Bonds, gold and silver, property, crypto, savings accounts and anything else. Prices update live from free public sources. There's no server and no cloud account.

The **Analysis** screen covers XIRR by asset type and person, net worth month by month, income by financial year, the next 12 months of payouts and maturities, a maturity ladder, liquidity, concentration and the biggest winners and losers.

See [PLAN.md](PLAN.md) for the research, roadmap and design decisions.

## Using it

1. Install with `dist/Family Portfolio Setup <version>.exe`. Windows SmartScreen will warn because the installer isn't code-signed; choose **More info → Run anyway**.
2. Open **Import statements** and add, for each person:
   - **CAS PDF** from NSDL/CDSL (emailed monthly). It covers every demat account and mutual fund under one PAN. The password is usually the PAN in capitals. The demat table mixes shares with ETFs, government securities, NCDs and REIT/InvIT units; each is told apart by its ISIN (`IN0…` government, `…07…`/`…08…` debentures, `…25…` REIT units, `…23…` InvIT units). Bonds keep their statement value; REITs and InvITs get live prices (from whichever of NSE/BSE Yahoo still updates) and REITs count as property in the asset mix.
   - **CAMS/KFintech detailed CAS** (camsonline.com / mfcentral.com) for full mutual fund purchase history.
   - **Zerodha tradebook** CSVs (Console → Reports → Tradebook) for true stock average cost.
   - **Groww order history** (Excel), and a **trades file** for any other broker (template on the import screen).
   - **INDmoney US stocks**: the Holdings report (units, average price in $, "Holding Since") and the Order report (every buy and sell) from INDmoney → US Stocks → Reports. Both are old-style .xls files with an account block above the table; the app recognises them whichever import is chosen.
   - **Broker holdings files** for buy prices. NSDL/CDSL statements list units and value but not what you paid, so invested and gain stay blank for demat holdings. Zerodha Console → Portfolio → Holdings → Download (equity, and mutual funds for Coin) or Groww's holdings statements carry the average price; any file with ISIN or symbol, quantity and average price (or invested value) works. You can also type a price, and the date a holding was first bought, in its detail panel.
   - **Tax without a trade history.** Capital gains need purchase dates. With a tradebook the dates are exact. Without one, the Tax page builds lots from what is known: a first-bought date (INDmoney's "Holding Since", or typed in) dates the whole holding; Zerodha's "Quantity Long Term" puts those units a year and a day before the file (never long-term too early) and the rest in the last year. Estimated lots are marked, and they never get the 31 Jan 2018 grandfathering, which needs a real date: for holdings bought before Feb 2018, import the Zerodha tradebook (Console → Reports → Tradebook, one financial year per download) or enter the date. Cost is taken from, in order: your trades, a price you typed, the statement, a broker file, then an earlier statement scaled to today's units.
   - **Fund portfolio files** (only when needed): monthly portfolio disclosures are fetched automatically (see below). Import the Excel file by hand only for a fund house the app can't read.
3. Add **EPF** balances, **insurance** policies and **Other assets** on their own screens. Deposits, bonds and PPF grow by their own terms; gold, silver, SGBs and crypto follow live prices.
4. Switch between **Me**, **Dad** and **Family** with the tabs at the top left.
5. Open **Settings & backup**, save a backup, and write down the **recovery key**.

### Live data (all free, no keys)

| What | Source | How often |
|---|---|---|
| Indian stocks & ETFs, US stocks, dividends | Yahoo Finance chart API. Indian ETFs that arrive without a ticker are found by ISIN in NSE's ETF and equity lists (`nsearchives.nseindia.com/content/equities/eq_etfseclist.csv`, `EQUITY_L.csv`), then Yahoo's ISIN search; if there's still no market price, the ETF's AMFI NAV is used (shown as NAV, not LIVE) | Every minute while NSE or US markets are open, every 30 min otherwise |
| USD → INR (live, plus daily history for purchase-date cost) | Yahoo Finance | Same |
| Mutual fund NAVs | mfapi.in, falling back to AMFI's NAVAll.txt | Every 2 hours |
| NPS NAVs | npsnav.in | Every 2 hours |
| Sectors | NSE index constituent list (ISIN → industry), Yahoo search for US | Daily; NSE list weekly |
| US ETF holdings | Yahoo Finance quoteSummary | Daily |
| Gold & silver (INR per gram) | COMEX futures via Yahoo × USD→INR ÷ 31.1035 + India premium (6% default, Settings) | With stock prices |
| Crypto | Yahoo (SYM-USD × USD→INR), CoinGecko fallback | With stock prices |
| Weekly price history (net worth chart, sparklines) | All of the above, 5 years | Daily, only stale series |
| Fund houses (for MFs/ETFs) | AMFI NAVAll.txt section headers, falling back to mfapi.in `meta.fund_house` | With NAVs |
| Monthly portfolio disclosures (stocks inside your funds and ETFs) | AMFI's directory, then each fund house's own page (see below) | Daily check; downloads only when a newer month appears |

Prices only update while the app is running. When it starts it refreshes everything. Renamed tickers (e.g. TATAMOTORS → TMPV after the demerger) are followed automatically through NSE's ISIN list. If a source is down, the last known price is used and **Settings & backup** shows which source failed.

### Sectors & exposure: equity, market cap and debt

Every fund and ETF is opened up into what it holds, then added to what you hold directly.

- **Equity by sector.** Click a sector to list its companies with the amount held directly, through funds, in total, and as a share of the sector and of all your equity. Money in funds that report only sector totals (US ETFs) is shown as its own line, so the list adds up to the bar.
- **Large, mid and small cap.** SEBI's bands come from [AMFI's half-yearly list](https://www.amfiindia.com/otherdata/categorisation-of-stocks): ranks 1–100 by six-month average market cap are large cap, 101–250 mid cap, the rest small cap. It is downloaded automatically from `portal.amfiindia.com/spages/AverageMarketCapitalization<30Jun|31Dec><year>.xlsx` when a new half-year appears. Foreign shares, unlisted shares and fund equity not yet broken down have their own bands. Click a band for its companies.
- **Debt.** Bonds, deposits, EPF, PPF and post office schemes held directly, plus every bond and money-market paper inside your funds. Shown by type (central and state government, T-bills, corporate bonds, securitised debt, CP & CD, deposits, small savings), by credit rating (sovereign, AAA & A1+, AA, A and below, as printed in the fund house's file) and by issuer, with the share in sovereign or AAA paper and the largest single company or bank you are lending to. Types come from the ISIN (government paper starts `IN` + a digit; for companies the security code says debenture, CP, CD or securitised, including the newer letter-first codes such as `A7`).

### Automatic monthly portfolio disclosures

SEBI requires every fund house to publish each scheme's full portfolio within 10 days of month end. AMFI's [portfolio disclosure page](https://www.amfiindia.com/online-center/portfolio-disclosure) doesn't host the files; it's a directory of links to each fund house's own disclosure page. The app works from that directory:

1. **Directory:** reads the fund-house list embedded in AMFI's page (57 houses), cached for 30 days. A copy ships with the app in case AMFI is down.
2. **Your fund houses:** each MF/ETF you hold carries its fund house from AMFI's NAV file (or mfapi.in), which is matched to a directory entry.
3. **Finding the file**, in this order:
   - a direct API for houses whose page is a form (UTI: `utimf.com/api/get-consolidate-portfolio-disclosure?year=…&month=…`);
   - the page's plain HTML (about half the houses, e.g. PPFAS, Nippon, HDFC, DSP, Groww, Baroda BNP, Samco, Helios);
   - the page rendered in a hidden browser window, which also reads the JSON the page loads (SBI, Mirae, Motilal; ICICI Prudential's file list comes from its `apimf.icicipruamc.com` JSON, with files served from `icicipruamc.com/blob/…`).
4. **Choosing files:** monthly portfolio spreadsheets only (fortnightly, half-yearly, factsheets, dashboards and the like are skipped), newest month only. When a house publishes one file per scheme, only files named after your funds are taken, or the consolidated "all schemes" file. Zips are unpacked, and a zip of per-scheme workbooks (ICICI's has ~150) is narrowed to your funds.
5. **Reading:** each sheet is parsed and matched to your funds by scheme name; holdings are saved with source `AMC_AUTO`. A sheet can hold one scheme (most houses) or every scheme stacked in blocks (UTI's file, which also sits under an unhelpful name inside its zip). Funds are matched by the name on your statement and by the scheme's current name in AMFI's NAV file (looked up by ISIN), so renamed schemes (e.g. ICICI "Equity & Debt" → "Aggressive Hybrid") still match.

Each fund house gets at most two minutes for its page to render, so one slow site can't hold up the rest.

Nothing is downloaded if the newest month is already stored. **Settings → Disclosures and Exposure** shows each house's status (updated, up to date, not found, error), the files used, and an **Open page** link. **Check fund houses now** runs it on demand. Axis lists files only after you open its *Portfolios* section and pick a month, so the hidden window does exactly that and asks for the last three months the way the page's own month picker does. **Kotak** answers automated visits with a human check (Radware bot protection), so the app doesn't try; Settings says where to click on Kotak's page, and **Import its file** takes the download. The same goes for any other house that can't be read.

Data lives in `%APPDATA%\Family Portfolio\`:
- `portfolio.db`: the database, encrypted with SQLite3MultipleCiphers (ChaCha20).
- `db.key`: the database key, encrypted by Windows (DPAPI) for your Windows user.

> ⚠️ Only the same Windows user on the same PC can open the database. Backups (Settings & backup) are encrypted copies that open on any PC with the **recovery key**, so keep that key safe and separate from the backup. If the key file is ever lost, the app sets the old data aside and explains how to restore it.

## Development

Requirements: Node 22+, and Windows. Python 3.12+ is needed only to rebuild the PDF helper.

```bash
npm install
npm run dev          # app with hot reload
npm test             # unit + database integration tests
npm run typecheck
npm run smoke        # click through every screen of the built app with demo data
npm run dist         # type-check, build, smoke test, then the Windows installer into dist/
```

### The CAS PDF helper

CAS statements are parsed by [casparser](https://github.com/codereverser/casparser) (MIT), compiled with PyInstaller into `resources/bin/casparser.exe` and shipped inside the installer. End users never need Python. To rebuild it (once, or after bumping `tools/casparser/requirements.txt`):

```powershell
pwsh tools/casparser/build.ps1
```

The app runs it once per import. The PDF path goes in as an argument and the password over stdin (so it never shows in the process list). The helper replies with one JSON object.

### Dev harness

When not packaged, these environment variables help with testing:

| Variable | Effect |
|---|---|
| `FP_USER_DATA=<dir>` | Use a throwaway data folder instead of the real profile |
| `FP_SEED_DIR=tests/fixtures/demo` | Load the demo statements for Me and Dad on first start |
| `FP_SCREENSHOT_DIR=<dir>` | Save a PNG of each page, then quit (`FP_ROUTES`, `FP_SCOPES` choose which) |
| `FP_THEME=light\|dark` | Force the colour scheme |

### Layout

```
src/main/            Electron main process
  db/                Drizzle schema + encrypted SQLite connection
  importers/         CAS (via casparser.exe), Zerodha, Groww, generic trades, AMC portfolio files → one ImportBundle shape
  market/            free price/NAV/FX/sector clients and the refresh scheduler (MarketData)
  portfolio/         FIFO cost basis, holdings with live prices and INR, dividends, look-through exposure, EPF maths
  assets.ts          EPF, insurance and hand-entered NPS
  manualAssets.ts    deposits, PPF/SSY, bonds, SGB, gold/silver, property, crypto, cash, other
  portfolio/engines  valuation maths per asset kind (compounding, payouts, coupons, maturities)
  portfolio/analysis XIRR, net worth history, income, upcoming cash flows, liquidity, concentration
  services.ts        everything the UI can ask for; ipc.ts exposes it as window.api
src/preload/         typed, sandboxed bridge
src/renderer/        React UI (Tailwind, Anek Latin)
src/shared/          types shared by both sides
drizzle/             SQL migrations (npm run db:generate after editing schema.ts)
tools/casparser/     helper source + PyInstaller build script
tests/               vitest; tests/fixtures/demo holds sample statements in casparser's JSON shape
```
