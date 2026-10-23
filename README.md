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
| Home prices for property (₹ per sq ft by city and carpet-area band) | [NHB RESIDEX](https://residex.nhbonline.org.in), the National Housing Bank's quarterly index from bank and housing-finance valuations, about 50 cities (Gujarat: Ahmedabad, Gandhinagar, Rajkot, Surat, Vadodara). The FY 2017-18 base series (from June 2018) is joined to the FY 2024-25 one | Weekly; a new city downloads when a property is saved |
| Monthly portfolio disclosures (stocks inside your funds and ETFs) | AMFI's directory, then each fund house's own page (see below) | Daily check; downloads only when a newer month appears |

Prices only update while the app is running. When it starts it refreshes everything. Renamed tickers (e.g. TATAMOTORS → TMPV after the demerger) are followed automatically through NSE's ISIN list. If a source is down, the last known price is used and **Settings & backup** shows which source failed.

### Property & rent

Each home, flat, tenement, shop or plot gets its own section.

- **Value.** Pick its RESIDEX city and one of three ways. *Grow with city prices* takes your latest estimate (or the price paid) and moves it with the city's price per sq ft for that size of home. *Carpet area × city price* uses the city's average for the size band, plus or minus a locality premium. *Only my estimates* uses what you type in, with an optional yearly growth rate; this suits land. Before the series starts (mid-2018), the yearly growth rate bridges the gap. The page also shows the area-based figure as a cross-check, and the Jantri value if you enter it (look it up on GARVI). These are city-level estimates, not a valuation of your particular home.
- **Rent.** Add the tenancy (tenant, rent, due day, deposit, agreement dates; 11 months by default) and record rent as it arrives. Each month of the financial year shows paid, part paid, due or overdue. Click a month to record it, or mark every overdue month received at once. The agreement's end date is flagged 45 days ahead. Until a tenancy is added, a plain monthly rent figure is assumed to arrive.
- **Expenses and tax.** Property tax, maintenance, repairs, insurance and home-loan interest feed the net yield and the year's *Income from house property*: rent less property tax, less the 30% standard deduction, less loan interest.
- **Returns.** Value growth a year (CAGR), XIRR including rent and expenses, and gross and net rental yield over the last 12 months.

### Vehicles

Cars and bikes live on their own page, outside the investment totals (they lose value with age, so they would distort the asset mix and returns).

- **Add from documents.** Pick the RC (DigiLocker or mParivahan PDF), the insurance policy schedule or the PUC certificate and the details fill in: number, make, model, fuel, registration and validity dates, insurer, policy number, cover period, IDV, premium, no-claim bonus. Password-protected PDFs ask for the password. Files are kept inside the encrypted database and open in the default viewer from a temporary copy. A plate number can't be looked up automatically: Parivahan's lookup needs an OTP and a captcha, and the instant-lookup websites are paid services that would receive your number.
- **What's due.** Insurance (30 days ahead), PUC (15 days; none for an EV; a new vehicle's first is due a year after registration), registration (15 years for a private vehicle), service (every 12 months or 10,000 km for a car, 6 months or 3,000 km for a two-wheeler, or your own interval), and the end of a vehicle loan (with the reminder to remove hypothecation). Links open Parivahan's PUC, Vahan and e-challan pages.
- **Value.** The latest policy's IDV carried forward with IRDAI's depreciation schedule (5% under six months, then 15/20/30/40/50% to five years, then about 5 points a year), or the ex-showroom price depreciated the same way.
- **Running costs.** Fuel, service, repairs, tyres, insurance, PUC, tolls, parking and fines by month; cost per km and mileage from odometer readings.

### Statements from Gmail (Google accounts)

Settings → Google accounts connects one or more Gmail accounts, each tied to a person, and checks them every 12 hours while the app runs (and on demand). It finds the monthly CAS (NSDL, CDSL, CAMS, KFintech) and imports it with that person's saved CAS password, and broker reports sent as spreadsheets (below). Card and bank statements need Claude (see *Claude*).

- **Broker reports, no Claude.** Mail from Zerodha, Groww or INDmoney with an `.xlsx`, `.xls` or `.csv` attachment (first check: the last 400 days, at most 25 messages; then anything newer). The importer is chosen from the file's columns (`src/main/importers/detect.ts`), not its name: a Zerodha tradebook, a Groww order history, an INDmoney US report or a holdings statement go through the same importers as a picked file, so trades already imported are skipped. Anything else (P&L, ledger) is listed as skipped.

- **Sign-in** uses the person's own OAuth client, so there is no server: create a Google Cloud project, enable the Gmail API, set the audience to External and **publish** it (in Testing, Google ends sign-ins after 7 days), then create a *Desktop app* client and paste its ID and secret into Settings. The app stays unverified, so Google shows a warning at sign-in (Advanced → Go to Family Portfolio); unverified apps are limited to 100 users, plenty for a family.
- **Flow.** Browser consent with PKCE and a one-off listener on `127.0.0.1`; scope `gmail.readonly` only. The refresh token is stored encrypted; disconnecting revokes it.
- **First check** of an account imports only the newest CAS from the last 60 days; later checks import anything newer, never the same email twice. A statement that fails only for lack of a saved password is retried after you import one CAS by hand with *Remember the password* ticked.

### Forecast & inflation

Projects everything held today, month by month, to a chosen year (2060 by default).

- **Growth.** Each kind of holding grows at its own editable return (shares and equity funds 11%, debt 7%, gold 8%, EPF 8.25%, PPF 7.1%, NPS 9%, property 5%, savings 3%). Funds are sorted by their AMFI category; hybrids are split. A low and a high run, with returns moved by ±2 points (scaled by how volatile each kind is), give the range.
- **Money going in.** SIPs with a yearly step-up in the month each started, until their last year or retirement; EPF contributions from the EPF page, rising with salary. SIPs seen in the last six months of fund purchases are suggested.
- **Inflation by category.** Groceries, rent, health, education, transport, power, clothes, household, personal care, leisure, fixed EMIs and the rest, each defaulting to its official rate: the ten-year rise of MoSPI's All-India consumer price index (base 2012, `api.mospi.gov.in/api/cpi/getCPIIndex`, no sign-up needed for a few records), refreshed monthly, with the December 2015–2025 figures built in. Health also offers the private-healthcare cost trend (Aon, 11.5% for 2026), since the CPI health index weights government care heavily. Your spending mix gives a personal inflation rate, used for "today's money by your own costs".
- **Goals and retirement.** Goals grow with their category's inflation and are paid from the investments in their year. From the retirement year, SIPs and EPF stop and living costs are drawn monthly (never from property); the page shows what retirement needs (a year's costs ÷ the withdrawal rate, 3.5% by default), what is projected, and how long the money lasts. "Costs covered" is the first year the withdrawal rate of the investments pays the year's living costs.

### Returns and tax when the history is partial

Few people have every tradebook back to their first purchase. Two rules keep such holdings in:

- **Tax.** When the trade files don't explain all the units held, the rest are taken as bought the day before the earliest trade on file (shown as "Before …") at the average cost, and sales use them up first (FIFO). With twelve months of tradebook, everything older is correctly long-term. The broker's own long-term count (Zerodha's "Quantity Long Term") still wins for open lots, since a gap between trade files can't be seen.
- **Performance.** A holding without its full purchase history is measured from the earliest record imported. When trade files reach back further than the statements, that is the day before the first trade: the units the trades don't explain count as held from then, at that day's price, and every trade after counts as itself (the net worth chart and dividends use the same units). Otherwise it is the first statement: counted as bought that day at that day's price, with later changes in units that no trade explains as buys or sells. Holding-level XIRR under three months is shown as too recent. Importing older CAS statements takes the measurement further back.

### Loans & EMIs

Home, car, gold, personal, education and farm loans and the Kisan Credit Card (`src/main/loans.ts`, `src/renderer/src/pages/Loans.tsx`). Net worth on the Overview, Analysis and the phone becomes what is owned less what is owed, today and at every month end of the net worth chart.

- **EMI loans** are followed month by month from the amount, rate, tenure (or EMI) and start, taking EMIs as paid on time (auto-debit) unless that is switched off and EMIs are recorded; part-prepayments go straight to the principal, and a balance read off a statement restarts the schedule from there. Each shows what is owed, the next EMI, EMIs left, the payoff date, interest still to pay, and this financial year's interest and principal (with the 24(b)/80C facts for a home loan under the old regime). "If I prepay" works out the interest saved and how much sooner the loan ends with the EMI unchanged.
- **Gold loans** (principal at the end): the principal less repayments, interest recorded as paid, interest due to the end.
- **Kisan Credit Card**: drawings and repayments, interest by the day at the full rate (7%) and at the rate after the 3-point prompt repayment help, repayments applied to interest first, and the repay-by date.

### Farm

The Farm page (`src/main/farm.ts`, `src/renderer/src/pages/Farm.tsx`) keeps each crop season of a person's farm: crop, season (kharif, rabi, summer), field, acres, sowing date and expected yield, then its costs (seed, fertiliser, pesticide, labour, machinery, diesel, irrigation, land rent, transport, storage), harvests, sales (rate, mandi charges, mandi) and losses. Quantities can be typed in quintals, man (20 kg, how Saurashtra quotes groundnut) or kg; everything is kept in quintals. Each season can name its variety in a searchable list: what the mandi reported lately (with its price), the varieties common in Gujarat with the names farmers use (`VARIETIES` in `src/shared/farm.ts`: "37" or "G37" is TG-37A, "gini" is jini), then Agmarknet's full list; and the class it sells as (groundnut jini/fine or jadi/bold, wheat lokwan or tukda, chana white or yellow), filled in from the variety and changeable. Stock is valued at the most specific price there is: the variety's own (Agmarknet quotes Rajkot groundnut as G20 and Bold), then its class's, then the middle of all varieties that day. Class prices come from Rajkot APMC's own daily rates (`src/main/market/apmcRajkot.ts`, apmcrajkot.com: the yard's low and high in ₹ a man, kept day by day as the page has only today's), alongside Agmarknet.

- **Net worth.** What was harvested and not yet sold or lost is in the godown and counts in net worth at today's mandi price, as the asset class *Farm produce* (chart group "Cash, farm & other": eight hues are all the charts can tell apart), "available in days" for liquidity, and outside income tax (agricultural income). Its cost basis is the season's costs per quintal harvested. A crop still in the field is shown at its expected yield × today's price but not counted until harvested. Produce already in the godown from before can be added as stock.
- **Season profit.** Sales after charges + what is left at today's price − costs, and per acre; a growing crop shows its expected profit.
- **Mandi prices** (`src/main/market/mandi.ts`) come from Agmarknet (Ministry of Agriculture), the JSON its own pages use, no key: the last week of modal prices per variety for the chosen mandi (default Rajkot, per season if needed), kept day by day, and monthly averages for the past year from its monthly analysis. Only crops the farm grows, holds or watches are fetched, at most every six hours, as part of the daily market refresh. Each crop is compared with its 30/90/180-day averages, a year ago and the MSP (`src/main/market/msp.ts`, from the Ministry's MSP statement and Kharif 2026-27), and can have a target price: the app shows a Windows notification once when it is reached.
- **Selling: outlook and facts** (`src/renderer/src/components/FarmOutlook.tsx`), for each crop in stock or growing. *Past seasons*: from six years of Agmarknet's monthly averages at the mandi, how the price moved from this month to 1, 3 and 6 months later in each year (typical, worst, best). *Hold or sell*: what is in the godown at today's price against waiting, at those moves, after drying loss, storage and interest (entered once). *Mandis today*: every mandi in the state with its price and arrivals (Agmarknet's dashboard data), and what is left after the transport cost entered for each. *Arrivals* at the mandi against the month's average. *Market note* (switch "Market notes for the farm" in Settings → Claude; `src/main/farmNote.ts`): Claude searches the web (`web_search_20260209`) for what is moving the price and writes a short note led by a range for the next 1–3 months and its confidence, with the sources it cited; only the crop, the mandi and public prices are sent, never the family's stock or money; at most one a day per crop. None of it says to sell or hold.
- **Phone and chat.** The phone app's Assets tab has a Farm view (godown, field, prices, seasons) and records costs, harvests and sales, applied on the next sync; Ask your money has a farm tool.

### Phone app (iPhone, free)

A companion web app in `phone/`, installed from Safari with **Add to Home Screen** (no App Store, no Apple fee), published on GitHub Pages at `https://mihirh19.github.io/investment_analysis/`. It shows net worth, holdings, card spending and bills due, this year's capital gains and tax-free room left (with the lots that could use it), how it is doing (returns against the benchmarks by period and by year, worst fall, XIRR by account and holding; equity by sector against the Nifty 500, market cap, debt by type and rating; funds with Regular-plan cost, expense ratios and overlaps; the mix against its targets), property and rent, vehicles and what's due, and the forecast, for the family or each person, and records rent received, property expenses, fuel and running costs, PUC and insurance renewals. Statements are still imported on the desktop.

- **Sync without a server.** The desktop writes `fp-snapshot.json` to the hidden app-data folder of one Google account's Drive (scope `drive.appdata`, which can see nothing else in Drive) every 10 minutes while it runs, only when the figures changed. The phone writes each entry as `fp-inbox-*.json`; the desktop applies it through the same checks as its own forms, deletes it, and lists it in the next snapshot so the phone stops showing it as pending. An entry that can't be applied stays in Drive and is reported in Settings.
- **End-to-end encrypted.** Both directions are sealed with a passphrase chosen in Settings → Phone app: PBKDF2-SHA256 (600,000 rounds) to an AES-256-GCM key, gzip inside (`src/shared/vault.ts`, Web Crypto on both sides). Google stores only ciphertext. The phone can keep the derived key (non-extractable) in IndexedDB; the desktop keeps the passphrase encrypted with the OS key store so it can sync unattended.
- **One sign-in client for both.** Drive's app folder belongs to the sign-in client, so the desktop and the phone use the same *Web application* client: the desktop signs in through `http://127.0.0.1:53682/` (a fixed loopback port registered with the client), the phone through a full-page redirect to the Pages address (popups are unreliable in Home Screen apps). The client ID reaches the phone in the QR code's link (`?client=…`) or is built in from the repository variable `GOOGLE_CLIENT_ID`. The manifest has no `start_url` on purpose, so the Home Screen icon keeps that link, and the app puts `?client=` back in the address after Google's redirect or a reload: a Home Screen app on iPhone has its own storage, separate from Safari's, and starts from the address showing when it was added. If one still opens without it, its setup screen takes the link pasted in (Settings → Phone app → Copy link).
- **Ask your money on the phone** (switch in Settings → Claude, off by default). The desktop puts the person's Claude key into the snapshot, so it travels and rests inside the same passphrase-locked copy; turning the switch off or removing the key re-sends a copy without it. The phone runs the desktop's own chat (`src/shared/chat.ts`, same prompt and rules) straight against the Claude API from the browser (`dangerouslyAllowBrowser`; Anthropic allows browser requests), over tools that read the synced copy (`phone/src/lib/ask.ts`), plus `fund_history` from mfapi.in, which also allows browser requests. Live stock prices, fund search and Gmail stay desktop-only (Yahoo and AMFI block browsers). The chat code loads only when Ask is first opened, so the app still starts small.
- **Build and publish.** `npm run phone:build` (output `dist-phone/`), `npm run phone:preview`; `.github/workflows/phone.yml` publishes on pushes to `master` (Settings → Pages → Source: GitHub Actions). `FP_PHONE_DEMO=1 npx vitest run tests/phone-demo.test.ts` writes a locked demo snapshot (`dist-phone/demo.json`) for trying the app without Google.

### Sectors & exposure: equity, market cap and debt

Every fund and ETF is opened up into what it holds, then added to what you hold directly.

- **Equity by sector.** Click a sector to list its companies with the amount held directly, through funds, in total, and as a share of the sector and of all your equity. Money in funds that report only sector totals (US ETFs) is shown as its own line, so the list adds up to the bar.
- **Large, mid and small cap.** SEBI's bands come from [AMFI's half-yearly list](https://www.amfiindia.com/otherdata/categorisation-of-stocks): ranks 1–100 by six-month average market cap are large cap, 101–250 mid cap, the rest small cap. It is downloaded automatically from `portal.amfiindia.com/spages/AverageMarketCapitalization<30Jun|31Dec><year>.xlsx` when a new half-year appears. Foreign shares, unlisted shares and fund equity not yet broken down have their own bands. Click a band for its companies.
- **Debt.** Bonds, deposits, EPF, PPF and post office schemes held directly, plus every bond and money-market paper inside your funds. Shown by type (central and state government, T-bills, corporate bonds, securitised debt, CP & CD, deposits, small savings), by credit rating (sovereign, AAA & A1+, AA, A and below, as printed in the fund house's file) and by issuer, with the share in sovereign or AAA paper and the largest single company or bank you are lending to. Types come from the ISIN (government paper starts `IN` + a digit; for companies the security code says debenture, CP, CD or securitised, including the newer letter-first codes such as `A7`).

### Claude: statements and "Ask your money"

Off until the person enters their own Claude API key in Settings → Claude (checked with a free model lookup, kept encrypted with the OS key store). Each feature has its own switch and says what it sends; the month's requests and approximate cost are shown. Model `claude-opus-5-5` with the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).

- **Read statements** (`src/main/statements.ts`): any bank's credit card or account statement PDF, or a Zerodha contract note. The text is taken out here with `casparser.exe --text`, trying no password and then each remembered PDF password (encrypted; a new one is remembered once it opens a file), so only text is sent; a scanned PDF without a text layer is sent as the PDF itself. Claude returns a fixed shape (structured outputs, Zod schema `StatementSchema`) that is checked before saving: dates, dues, limits, balances, every transaction with its direction and one of 24 categories. Statements are de-duplicated by a fingerprint of account, period, amount and count, so one read by hand and again from Gmail is stored once. Contract-note trades go through the Zerodha tradebook mapping with their trade numbers, so they match a later tradebook import.
- **Spending page**: spending by month (card payments, transfers, investments and income left out), where a month's money went by category, card bills not yet seen paid (paid = a payment of the total due later on the card, or a matching card payment from a bank account), cards and accounts, and every transaction with its category editable.
- **From Gmail**: with "Read statements" on, each connected account's check also takes messages whose subject says credit card/account statement, e-statement or contract note (first check: the last 45 days, at most 10; then anything newer), alongside the CAS.
- **Ask your money** (`src/main/chat.ts`): a side panel on every page (or the full window). Claude answers with the SDK's tool runner over the pages' own figures (overview, holdings, tax, performance, income, spending, property, vehicles, forecast, sectors, funds, EPF/NPS/insurance), compacted; it streams the answer and says what it looked at.
  - **Market data** (`src/main/marketLookup.ts`): `stock` (any NSE/BSE stock, ETF or index, NSE first, from Yahoo's chart data: price, day change, 52-week range, returns to 5 years, worst fall), `fund_search` (any mutual fund by name: AMFI returns and expense ratios for Direct and Regular, AUM, risk, plus scheme codes and NAVs from AMFI's daily file), `fund_history` (a scheme's NAV returns by period and calendar year from mfapi.in) and `inflation` (MoSPI CPI).
  - **Gmail** (switch "Search my Gmail", off by default): `gmail_search` (Gmail search syntax across the connected accounts, read-only), `gmail_read` (one email's text, HTML stripped) and `gmail_import` (an email's CAS, broker spreadsheet or statement into the mailbox owner's books, only when asked; importers skip duplicates). The prompt tells Claude that email text is data, never instructions. The system prompt has it answer only from tool results and explain rather than recommend securities (not a SEBI-registered adviser). `ANTHROPIC_API_KEY=… npx vitest run tests/ai-live.test.ts` reads a made-up statement with the real API.

### Sector and fund facts (not recommendations)

Facts laid out for deciding, never a "buy this": the app doesn't pick stocks, funds or sectors.

- **Your sectors against the market** (Sectors & exposure): each NSE industry's share of your Indian equity, after looking inside funds, beside its share of the Nifty 500. The market weights use NSE's Nifty 500 list (`ind_nifty500list.csv`) and AMFI's six-month average market caps, i.e. full rather than free-float market value, so promoter-heavy companies weigh a little more than in the official index.
- **A sector's record**: its NSE indices' price returns over 1, 3 and 5 years, distance from the 52-week high, and today's P/E against its own ten years (median and percentile), from niftyindices.com's historical price and P/E/P/B/dividend-yield data (`/BackPage/getHistoricaldatatabletoString`, `/BackPage/getpepbHistoricaldataDBtoString`, after a page visit for the session cookie). The **sector scoreboard** lists all of them, sortable.
- **Funds and ETFs that track a sector**: every index fund, ETF and sectoral fund in AMFI's fund-performance data whose benchmark is that sector's index, with expense ratio (Direct plan; the ETF's own), size, 1/3/5-year returns and the 1-year gap to the index (tracking difference).
- **Overlapping funds, side by side** (Funds): pairs of your funds owning a quarter or more of the same companies, with each fund's TER for the plan you hold, size, returns against its benchmark, risk level and the share of it in companies the other doesn't own.
- **Data**: AMFI's fund performance (`/gateway/pollingsebi/api/amfi/fundperformance`, every open-ended scheme by sub-category, on the latest published business day) and TER (`/api/populate-te-rdata-revised?…&excel=true`, the latest figure per scheme). Both, and the NSE data, refresh weekly. `FP_LIVE=1 npx vitest run tests/insights-live.test.ts` checks them against the live sites.

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
  portfolio/property property page: city market, rent months, house-property income (rent.ts: rent maths)
  market/residex     NHB RESIDEX city list and price series
  vehicles.ts        vehicles: reminders, IDV value, running costs; encrypted document store
  importers/vehicleDocs  reads RC, motor policy and PUC text (via casparser.exe --text)
  google.ts          Google sign-in (loopback + PKCE) and a read-only Gmail client
  mailSync.ts        connected accounts and statement jobs (CAS today)
  portfolio/analysis XIRR, net worth history, income, upcoming cash flows, liquidity, concentration
  services.ts        everything the UI can ask for; ipc.ts exposes it as window.api
src/preload/         typed, sandboxed bridge
src/renderer/        React UI (Tailwind, Anek Latin)
src/shared/          types shared by both sides
drizzle/             SQL migrations (npm run db:generate after editing schema.ts)
tools/casparser/     helper source + PyInstaller build script
tests/               vitest; tests/fixtures/demo holds sample statements in casparser's JSON shape
```
