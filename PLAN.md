# Family Portfolio Tracker: Research & Plan

_Last updated: 2026-10-11_

**Shape of the app:** a **local desktop app** (Electron + React + TypeScript) with a **local SQLite database**.
There's **no server and no cloud**: all data stays on this PC, and the app fetches prices directly from free public sources.

## 1. Goal

One desktop app showing **all** family investments in one place, for **me** and **Dad** separately and combined:

| Asset | Where it's held today |
|---|---|
| Indian stocks | Zerodha, Groww |
| US stocks | INDmoney (and others) |
| Mutual funds | Zerodha (Coin) |
| EPF | EPFO |
| NPS | NSDL / Protean CRA |
| Life insurance | Insurer policies |
| Dividends | Credited from all of the above |

What it has to show:
- Net worth, and how it changed **year by year** (calendar year and financial year)
- Returns per holding, account, asset class and person (XIRR, absolute, compared with a benchmark)
- **Sector and industry split across everything**, including the stocks *inside* mutual funds
- Dividend income tracking
- Live or near-live prices from **free** sources
- Latest news for each holding
- Rule-based **review/sell alerts** (targets, stop-loss, concentration, rebalancing, tax harvesting)

---

## 2. Research findings: how to get the data

### 2.1 Holdings and transactions

| Source | Best free method | How the app ingests it | Notes |
|---|---|---|---|
| **All Indian demat holdings (Zerodha + Groww) + all MFs** | **NSDL/CDSL monthly CAS PDF** (emailed every month for each PAN) | "Import CAS" button → parsed by [`casparser`](https://github.com/codereverser/casparser) (MIT) | ⭐ **This is the backbone.** One PDF per PAN covers every broker and every MF. Works for Dad too, with his PAN. |
| MF full transaction history | **CAMS/KFintech "Detailed" CAS** (camsonline.com / mfcentral.com) | Same importer | Gives the full history from day one, which accurate XIRR and capital gains need. |
| Zerodha stocks: cost basis & trades | **Console tradebook CSV** (primary), Kite Connect Personal API (optional, free) | CSV import / `kiteconnect` npm | The free API tier has **no market data**, and its token expires daily. CSV import is enough. |
| Groww stocks | Groww order history / P&L export (CSV/XLSX) | CSV/XLSX import | The Groww Trade API costs ₹499/month, so skip it. |
| INDmoney US stocks | Manual entry, or statement import (Tax & Reports → US Stocks) | Form / CSV import | INDmoney has no public API. |
| EPF | EPFO member passbook PDF, or manual monthly entry | Form / PDF import | No public API. |
| NPS | NSDL CRA transaction statement (units per scheme) | Import + daily NAV | Units × NAV gives the daily value. |
| Life insurance | Manual entry (policy no., type, sum assured, premium, due date, maturity / surrender value) | Form | Term plans show cover only. Endowment and ULIP plans show fund or surrender value. |

> **Account Aggregator** can't be used: only regulated entities (FIUs) can pull data, not individuals.

**Key design decision:** use **ISIN** as the universal instrument ID. The same stock from Zerodha, Groww and the CAS then merges automatically.

### 2.2 Free price feeds (called directly from the app)

| Asset | Primary (free) | Fallback | Refresh while the app is open |
|---|---|---|---|
| NSE/BSE stocks, ETFs | **Yahoo Finance** (`yahoo-finance2` npm, `.NS` / `.BO`). ETFs from a CAS have no ticker, so it's found by ISIN in NSE's ETF list (`eq_etfseclist.csv`) and equity list (`EQUITY_L.csv`), then Yahoo ISIN search | The ETF's AMFI NAV (shown as NAV) | Every 1–5 min during market hours |
| US stocks & ETFs | **Yahoo Finance**: price, dividends, splits, sector, fundamentals, news | **Finnhub free tier** (~60 calls/min, official API) | Every 1–5 min during US hours |
| Mutual funds | **AMFI `NAVAll.txt`** (official) / **mfapi.in** (has full history) | — | Once a day |
| NPS | **npsnav.in** API (has history) | — | Once a day |
| USD/INR | Yahoo `USDINR=X` | frankfurter.app | Daily, plus intraday |
| Benchmarks | Yahoo `^NSEI`, `^CRSLDX` (Nifty 500), `^GSPC` | — | Daily |

**Because there's no always-on server**, prices only update while the app is running. That's fine:
- **On startup, the app backfills** every day it missed. Yahoo, mfapi and npsnav all provide historical prices, so year-by-year charts never have gaps.
- The app can **sit in the system tray** and **auto-start at Windows login**, so intraday prices and alerts keep working during the day.

⚠️ Yahoo and NSE are **unofficial** sources that can rate-limit or break. Mitigations:
- A fallback chain (Yahoo → NSE / Finnhub → last cached price)
- Batched requests and caching every price in SQLite
- A "data health" indicator that shows when a source last succeeded
- All network calls run in Electron's **main process**, not the UI, which avoids CORS problems and lets the app handle cookies for NSE

### 2.3 Sector, industry and market-cap data

| Need | Source |
|---|---|
| Indian stock → sector / industry | NSE industry classification (Macro sector → Sector → Industry → Basic industry); Yahoo `assetProfile` as fallback |
| US stock → sector | Yahoo `assetProfile.sector / industry` (fallback: Finnhub profile) |
| **MF look-through** (stocks inside each fund) | Each AMC's **monthly portfolio disclosure** (Excel on the AMC site), **fetched automatically** (§2.3.1). Only the funds actually held need it. |
| Large / Mid / Small cap | **AMFI semi-annual market-cap classification list** |
| MF category | AMFI scheme category (Large Cap, Flexi Cap, ELSS, Debt…) |

### 2.3.1 Monthly portfolio disclosures (researched 2026-10-11)

- SEBI requires each fund house to publish every scheme's portfolio monthly (within 10 days of month end), on its own website.
- **AMFI's [portfolio disclosure page](https://www.amfiindia.com/online-center/portfolio-disclosure) is only a directory.** It hosts no files. It links to each fund house's monthly (and fortnightly / half-yearly) disclosure page. The list (57 houses, with `amc_monthly_portfolio_disclosure` URLs) is embedded as JSON in the page, so it can be read without rendering.
- Each house's page is different. In a probe of 54 pages:
  - **27 had spreadsheet links in plain HTML**, e.g. PPFAS, Nippon, HDFC, DSP, Groww, Baroda BNP Paribas, Samco, Helios.
  - **SBI, Mirae, Motilal Oswal** build the list with JavaScript, so the page has to be rendered (hidden Electron window).
  - **ICICI Prudential** loads its list from `POST apimf.icicipruamc.com/nms/v1/downloads/files`. Called directly from Node it answers 404 in the body, so the rendered page's own JSON responses are read via the DevTools protocol. Files are at `icicipruamc.com/blob/downloads/Files/Monthly Portfolio Disclosures/<year>/<Mon>/…zip` (26 MB, ~150 per-scheme xlsx); the bare `/downloads/…` path redirects to a dead host.
  - **UTI** is a form (year + month). Its API `utimf.com/api/get-consolidate-portfolio-disclosure?year=YYYY&month=Month` works directly and returns a CloudFront zip.
  - **Axis** shows no file links even rendered; not automated yet (manual import + "Open page").
- File layouts vary: one consolidated workbook with a sheet per scheme (SBI, Nippon, PPFAS), one file per scheme (Mirae, HDFC, PPFAS also), or a zip of either (ICICI, UTI). The picker handles all three and only downloads what matches the funds held.
- Implementation: `src/main/market/disclosures.ts` (directory, link extraction, file picking, house adapters, sync), `render.ts` (hidden window + JSON capture), `amcRegistry.ts` (bundled directory copy). Status per house is stored in setting `disclosures:status` and shown in Settings.

### 2.4 Dividends
- **Indian stocks:** NSE corporate actions / Yahoo dividend events × shares held on the record date.
- **US stocks:** Yahoo dividend events × shares. Track the **25% US withholding tax** separately (foreign tax credit, Form 67).
- **MF IDCW payouts:** from the CAMS/KFintech CAS transactions.
- Output: dividend income by year, by person and by holding, plus yield-on-cost and an upcoming-dividends calendar.

### 2.5 News
| Source | Covers |
|---|---|
| NSE/BSE corporate announcements (results, board meetings, dividends) | Indian stocks, official |
| Google News RSS (`news.google.com/rss/search?q=<company>`) | Indian + US |
| Yahoo `search()` news / Finnhub company news | US stocks |
| Moneycontrol / ET Markets RSS | Indian market news |
| *(Optional)* LLM daily digest of your holdings' news | A few ₹ a day of API cost |

### 2.6 Existing tools considered
Ghostfolio, Portfolio Performance, INDmoney, Kuvera and Value Research all lack one or more of the following: Indian CAS/EPF/NPS support, MF look-through, a "me + Dad" family view, custom alert rules, or local data ownership. **Decision: build our own.**

---

## 3. Architecture (local desktop, no server)

```
┌──────────────────────── Electron app (Windows) ─────────────────────────┐
│                                                                         │
│  Renderer (UI)  — React + TypeScript + Vite                             │
│    Tailwind + shadcn/ui · ECharts (treemap, sunburst, lines)            │
│    TanStack Table (holdings) · TanStack Query (data fetching via IPC)   │
│             │                                                           │
│             │  typed IPC via preload (contextIsolation ON,              │
│             │  nodeIntegration OFF)                                     │
│             ▼                                                           │
│  Main process (Node.js)                                                 │
│    ├─ db/          better-sqlite3 (+ SQLCipher encryption) · Drizzle ORM│
│    ├─ importers/   CAS (casparser helper) · Zerodha CSV · Groww XLSX ·  │
│    │               INDmoney · EPF · NPS · manual forms                  │
│    ├─ providers/   yahoo-finance2 · NSE · AMFI/mfapi · npsnav ·         │
│    │               Finnhub · RSS  (each behind one PriceProvider API)   │
│    ├─ analytics/   XIRR · TWR · year-wise · sector look-through · tax   │
│    ├─ jobs/        scheduler (prices, NAVs, news, corporate actions,    │
│    │               startup backfill)                                    │
│    ├─ alerts/      rules engine → Windows toast notifications           │
│    └─ secrets/     Electron safeStorage (Windows DPAPI)                 │
│                                                                         │
│  resources/casparser.exe  — small Python helper, runs only during an    │
│                             import and returns JSON (not a server)      │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ▼
  %APPDATA%/PortfolioTracker/portfolio.db   (encrypted SQLite)
  + daily encrypted backup copy → OneDrive / Google Drive folder
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** + **electron-vite** | Fast dev setup and hot reload for main + renderer |
| UI | **React + TypeScript**, Tailwind, shadcn/ui | Your choice; good component ecosystem |
| Charts | **Apache ECharts** (`echarts-for-react`) | Treemap/sunburst for sectors, big time-series |
| Tables | TanStack Table | Sorting, grouping, totals for holdings |
| DB | **SQLite** via `better-sqlite3-multiple-ciphers` | Synchronous and fast, with SQLCipher **encryption at rest** |
| ORM / migrations | **Drizzle ORM** + drizzle-kit | Typed schema and SQL migrations |
| Prices | `yahoo-finance2` (v4, needs Node 22+, which current Electron ships), plain `fetch` for NSE/AMFI/mfapi/npsnav/Finnhub | |
| CAS PDF parsing | **`casparser`** packaged as a standalone `.exe` (PyInstaller), called with `child_process` → JSON | It's the most mature CAS parser, and porting it is weeks of work. It runs only during an import. *(Optional later: port to TypeScript with `pdfjs-dist` to drop Python.)* |
| Excel / CSV import | SheetJS (handles `.xls` + `.xlsx` AMC files), `papaparse` | |
| RSS | `rss-parser` | |
| XIRR | Small in-house TypeScript function (Newton + bisection fallback) | Easy to unit-test |
| Scheduler | `node-cron` in the main process | |
| Notifications | Electron `Notification` (Windows toast) + tray icon | |
| Secrets | Electron `safeStorage` | Stores the DB key, CAS passwords, Finnhub key and Kite key, encrypted by Windows |
| Packaging | **electron-builder** → Windows NSIS installer | |
| Tests | Vitest (analytics, importers using real sample statements as fixtures) | |

### Security
- The DB is encrypted (SQLCipher). The key is kept in `safeStorage`, and an optional app PIN/password unlocks it at launch.
- The renderer is sandboxed: no Node access, and only whitelisted IPC calls.
- PANs and CAS passwords are never written in plain text. CAS PDFs are deleted (or optionally archived encrypted) after import.
- Broker access is read-only. **The app never places trades.**

### Me + Dad
- Both are **profiles in the same database** (`person` table) with a Me / Dad / Family switcher. You import Dad's CAS and statements with his PAN.
- If Dad wants to use it on his own PC, he can install the same app with his own DB, or you can export a **PDF/HTML family report** for him.

### Mobile (deferred)
With no server, phones can't show live data. Options for later:
1. **Export a monthly PDF/HTML report** to your phone (simple, Phase 3).
2. A **read-only mobile companion** (React Native/Capacitor, reusing React components) that opens an encrypted snapshot file synced via OneDrive/Drive (Phase 5, optional).

---

## 4. Data model (SQLite, core tables)

```
person          (id, name, pan_hash, relation)            -- Me, Dad
account         (id, person_id, platform, type, currency) -- Zerodha-Equity, Groww-Equity,
                                                          -- Zerodha-Coin-MF, INDmoney-US, EPF, NPS-Tier1, Policy-XYZ
instrument      (id, isin, symbol_nse, symbol_bse, ticker_us, name,
                 asset_class, sector, industry, mcap_bucket, amfi_code, nps_code)
transaction     (id, account_id, instrument_id, date, type[BUY/SELL/DIV/SPLIT/BONUS/SIP/CONTRIB/INTEREST],
                 qty, price, amount, fees, currency, source_file, import_batch_id)
holding_snapshot(account_id, instrument_id, date, qty, avg_cost)   -- reconciled against the CAS monthly
price_daily     (instrument_id, date, close, source)               -- EOD history (backfilled)
price_live      (instrument_id, ts, price, source)                 -- latest intraday only
fx_rate         (pair, date, rate)
corporate_action(instrument_id, type, ex_date, record_date, value)
mf_constituent  (mf_instrument_id, month, stock_isin, weight_pct)  -- look-through
insurance_policy(id, person_id, insurer, type, sum_assured, premium, freq, next_due,
                 maturity_date, current_value)
alert_rule      (id, person_id, scope, rule_type, params_json, active)
alert_event     (id, rule_id, fired_at, message, seen)
news_item       (instrument_id, published_at, title, url, source)
import_batch    (id, type, file_name, imported_at, rows, status)   -- undo a bad import
setting         (key, value)                                       -- tax rates, target allocation, refresh interval
```

---

## 5. Features

### 5.1 Screens
1. **Overview:** total net worth (Me / Dad / Family), day change, allocation donut, net-worth line since inception.
2. **Performance:** XIRR overall and per account, **year-by-year returns (CY and FY)**, vs Nifty 50 / Nifty 500 / S&P 500 (in INR), drawdown chart.
3. **Exposure:** sector treemap and industry table **with MF look-through**, large/mid/small split, India vs US, top-10 underlying stocks, MF overlap.
4. **Holdings:** one table across all brokers grouped by ISIN, with quantity, average cost, LTP, P&L, XIRR, weight and holding period.
5. **Dividends:** by year / month / person, yield-on-cost, upcoming ex-dates, US withholding tax.
6. **Retirement:** EPF + NPS corpus and a projection.
7. **Insurance:** policies, total cover per person, premium calendar with reminders.
8. **Tax:** realized STCG/LTCG this FY, LTCG still available under the ₹1.25 L exemption, Schedule 112A export, Schedule FA list. Tax rates live in `setting` because they change with budgets.
9. **News:** feed filtered to your holdings.
10. **Import center:** drag-and-drop statements, import history, undo.
11. **Settings:** refresh interval, API keys, backup folder, target allocation, auto-start.

### 5.2 Review / sell alerts (rule-based, you set the rules)
> These are **signals you define**, not investment advice. The app flags; you decide.

| Rule | Example |
|---|---|
| Target / stop-loss | "Alert when INFY ≥ ₹2,200 or ≤ ₹1,450" |
| Trailing stop | "Down 20% from the high since I bought" |
| Concentration | "Any single stock > 10% of equity", "Any sector > 25% (look-through)" |
| Rebalancing drift | Target 60/25/15 (IN-equity / US-equity / debt); alert at ±5% drift |
| MF underperformance | "Fund trails its benchmark over a rolling 3Y for 2 consecutive quarters" |
| Tax harvesting | "Unrealized LTCG still under ₹1.25 L before 31 Mar" / "tax-loss harvest candidates" |
| Holding period | "Lot becomes LTCG in 7 days" |
| Events | Results date, dividend ex-date, insurance premium due |

Delivery: Windows toast + tray badge + an in-app alerts list. On startup, any rules that would have fired while the app was closed are evaluated.

---

## 6. Project structure

See the Layout section of [README.md](README.md). The code follows electron-vite conventions (src/main, src/preload, src/renderer, src/shared).

---

## 7. Phased roadmap

| Phase | Duration | Deliverables |
|---|---|---|
| **0. Data collection** | Week 1 | Download for **Me and Dad**: NSDL/CDSL CAS (last 12 months), CAMS/KFintech detailed CAS, Zerodha Console tradebook (all years), Groww order history, INDmoney US statements, EPF passbook, NPS statement, policy documents. |
| **1. Skeleton + import** ✅ | Done 2026-10-10 | electron-vite + React + TS scaffold; encrypted SQLite + Drizzle schema; `casparser.exe` helper; CAS / Zerodha / Groww / generic-trades importers with dedupe + undo; manual entry; Import center; Overview, Holdings, Activity, People screens; Windows installer. Still to verify against **real** CAS PDFs and a real Groww export. |
| **2. Live prices + analytics** ✅ | Done 2026-10-11 | Recovery key + encrypted backup/restore; live prices (Yahoo for IN/US stocks & ETFs, mfapi/AMFI for MF NAVs, npsnav for NPS) with per-source status; USD→INR live and at purchase-date rates; day change; market-hours scheduler; renamed-ticker following via NSE ISIN list; price-history charts. **Still to do:** XIRR, year-by-year performance vs benchmarks, tray + auto-start. |
| **3. Deep analytics** ✅ (mostly) | Done 2026-10-11 | Sector / industry with **MF & ETF look-through** (AMC portfolio files, Yahoo for US ETFs); top underlying companies; geography; asset mix; dividends (estimated from units held on ex-dates, US withholding, FY view, 12-month outlook); EPF (passbook + projection) / NPS (live NAV, manual units) / insurance. **Still to do:** market-cap split, PDF/HTML family report. |
| **3b. All asset types + deep analysis** ✅ | Done 2026-10-11 | Deposits (FD/NSC/KVP/SCSS/MIS/POTD/RBI bonds), RD, PPF/SSY, bonds, SGB, gold & silver (live), property, crypto (live), cash, other; XIRR by type and person; net worth history; income by FY; upcoming cash flows; maturity ladder; liquidity; treemap; winners/losers; motion and new charts; UI smoke test gating releases. |
| **3c. Live ETFs + automatic disclosures** ✅ | Done 2026-10-11 (v0.4.0) | Indian ETF prices via NSE ISIN lists → Yahoo ISIN search → AMFI NAV; monthly portfolio disclosures fetched automatically from each held fund house via AMFI's directory (plain HTML, rendered pages with JSON capture, UTI API); per-house status and "Check fund houses now" in Settings. **Still to do:** Axis and any other house the probe can't read. |
| **4. Intelligence** | Next | Alerts engine + Windows notifications; news feed; tax module (STCG/LTCG, harvesting, 112A); benchmarks vs Nifty/S&P 500; loans and net worth after liabilities. |
| **5. Optional** | Later | Kite Personal API sync; casparser port to TypeScript; LLM news digest; read-only mobile companion. |

---

## 8. Cost summary

| Item | Cost |
|---|---|
| All data sources (CAS, AMFI, mfapi, npsnav, Yahoo, NSE, Finnhub free, RSS) | **₹0** |
| Server / hosting | **₹0 (none)** |
| Code signing certificate (removes the Windows SmartScreen warning) | Optional. It's not needed for personal use. |
| Optional: LLM news digest | ~₹100–300/month |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Yahoo/NSE unofficial endpoints break | Provider abstraction + fallback chain + cached prices + health indicator |
| Prices stale when the app is closed | Startup backfill from historical APIs; tray + auto-start |
| CAS PDF format changes | Pin the `casparser` version; keep sample PDFs as regression tests |
| Python helper adds packaging complexity | Built once with PyInstaller and shipped as a resource; can be ported to TS later |
| Incorrect cost basis → wrong XIRR/tax | Reconcile against the monthly CAS and flag mismatches |
| PC loss / disk failure | Daily encrypted backup to a OneDrive/Drive folder; restore option in Settings |
| Data leak | Encrypted DB, safeStorage, sandboxed renderer, no secrets in git |

---

## 10. Open decisions

Defaults taken for Phase 1 (say if any should change):

1. **Dad:** both profiles on your PC. ✔ default
2. **Price freshness:** 1–5 min delayed prices. ✔ default
3. **US platforms:** INDmoney via the trades file or manual entry; other brokers use the same template. ✔ default
4. **App lock:** none for now, since the database is already encrypted and tied to your Windows login. A PIN can be added later.
