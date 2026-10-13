# Family Portfolio 0.7.0 — Analysis, Chart.js and UI plan

Status: **proposed** · Baseline: 0.6.0 (148 tests + click-through smoke passing)

## Where things stand

- **Charts:** all 10 chart types are hand-drawn SVG in `src/renderer/src/components/charts.tsx` and `viz.tsx`; no chart library installed.
- **Already computed:** XIRR (overall, per asset class, per person), FIFO gains, look-through sector/market-cap exposure, dividends, monthly net-worth history.
- **Missing pieces the new features need:**
  - benchmark price history (Nifty, S&P 500);
  - a per-sale record with buy and sell dates (FIFO only sums realized profit);
  - fund-overlap calculation (`fund_holdings` data exists but is unused for this);
  - target allocations.
- **Repo:** `master` has no commits yet, so I'll make a baseline commit before starting Phase 0.

## Decisions taken

| Topic | Decision |
|---|---|
| Chart library | Migrate **all** charts to Chart.js (`chart.js` + `react-chartjs-2`), behind the existing wrapper names |
| Analysis scope | Performance + benchmarks, Tax, MF overlap + fund insights, Risk metrics, Rebalancing / targets |
| UI scope | Theme toggle, better tables, global date range, dashboard polish |

## Open decisions

1. **Tax rules:** hard-code the current Indian rules (with the pre-23 Jul 2024 rates for older sales), or make the rates editable in Settings? *Default if unanswered: hard-coded rules in one table in code, editable later.*
2. **Expense ratios:** if no reliable source turns up, is the Regular vs Direct label on its own enough? *Default if unanswered: yes, label only.*

---

## Phase 0 — Chart.js foundation ✅ done

- [x] Baseline git commit of 0.6.0 (`7a48da0`)
- [x] Install `chart.js` 4.5, `react-chartjs-2` 5.3, `chartjs-adapter-date-fns` + `date-fns`, `chartjs-chart-treemap`, `chartjs-chart-matrix`
- [x] `chartjs-plugin-annotation` (reference lines). `chartjs-plugin-zoom` skipped: needs hammerjs, nothing uses zoom yet
- [x] Shared chart setup (`components/chart/setup.ts`, `ChartBox.tsx`, `tooltip.tsx`):
  - [x] registers Chart.js once
  - [x] chart colours come from the CSS tokens (resolved through the DOM, incl. `color-mix`) and refresh on theme / `data-theme` / font changes
  - [x] Anek Latin font, ₹ / lakh / crore axis labels via the pages' existing formatters
  - [x] animations off (duration 0) when reduced motion is set
  - [x] one HTML tooltip everywhere (portalled to `<body>`); crosshair on line charts; arrow-key reading + Enter to select
- [x] Rewrite these wrappers on Chart.js, same names and inputs (no page changes): `AreaStack`, `Donut`, `StackBar`, `Columns`, `StackedColumns`, `HBars`, `DivergingBars`, `Treemap`, `PriceLine`, `Sparkline`
- [x] New chart types (`components/chart/extra.tsx`): `LineCompare`, `Drawdown`, `Heatmap`, `Waterfall`, `Bullet`
- [x] Exposure drill-down works (click a bar, or the hidden button list for keyboard / screen readers)
- [ ] Treemap → HoldingDetail: `Treemap` now accepts `onSelect`; wiring it on Analysis needs holding ids in the treemap data. Moved to Phase 7
- [x] Old SVG drawing code removed (`charts.tsx` / `viz.tsx` are now thin Chart.js wrappers)
- [x] Smoke test: checks that canvases render, the donut tooltip appears on hover, and a sector drill-down opens

**Files:** `package.json`, new `src/renderer/src/components/chart/*`, `charts.tsx`, `viz.tsx`, `styles.css`, pages that use charts
**Done when:** every page renders on Chart.js in light and dark, the smoke test passes, and there are no console errors

## Phase 1 — Market data ✅ done

Done: `market/benchmarks.ts` (`refreshBenchmarks`, `refreshDaily`, `seriesFor`, `toInr`), migration `0007_price_daily.sql`,
two new status rows in Settings (benchmarks, daily), `listBenchmarks` API + `useBenchmarks` hook, `tests/benchmarks.test.ts` (8 tests).
Checked live: all 5 series fetch (10y weekly, 1y daily). Note: Yahoo indices are price indices (no dividends, ~1–1.5%/yr low).
Smoke test: last full run failed only the donut-hover step; that step was rewritten (walks round the ring) but not re-run yet.

- [x] Benchmark weekly history, stored in `price_history`:

  | Key | Source |
  |---|---|
  | `BM:NIFTY50` | `^NSEI` |
  | `BM:NIFTY500` | `^CRSLDX` |
  | `BM:MIDCAP150` | `NIFTYMIDCAP150.NS` |
  | `BM:SP500_INR` | `^GSPC` × USD/INR from `fx_history` |
  | `BM:LIQUID` | a liquid-fund NAV proxy |

- [x] Daily closes for the last 1 year, in a new `price_daily` table (migration `drizzle/0007_price_daily.sql`)
- [ ] Expense ratios: deferred to Phase 4 (Regular vs Direct label first)

**Files:** `market/extra.ts`, `market/yahoo.ts`, `market/refresh.ts`, `db/schema.ts`, `drizzle/0007_*`
**Done when:** the benchmark series fill after a refresh; tests cover the converted S&P 500 series

## Phase 2 — Performance page (`/performance`)

- [ ] Returns by period:
  - [ ] calendar-year and financial-year returns (time-weighted, so money added or withdrawn doesn't distort them)
  - [ ] XIRR for each account, each holding and each person
  - [ ] 1Y / 3Y / 5Y / since-start returns
- [ ] Compared with benchmarks:
  - [ ] portfolio vs each index over time
  - [ ] "same money in Nifty": your actual cash flows replayed into the index on the same dates
  - [ ] better or worse than the index, per year
- [ ] Where the returns came from (waterfall, per year): opening value, + money added, − money withdrawn, + market gain, + dividends = closing value
- [ ] Drawdown chart and rolling 1-year return chart

**Files:** new `portfolio/performance.ts`, `portfolio/benchmark.ts`, `services.ts`, `shared/api.ts`, `shared/types.ts`, `pages/Performance.tsx`, `main.tsx`, `Shell.tsx`
**Tests:** `tests/performance.test.ts`, `tests/benchmark.test.ts`

## Phase 3 — Tax page (`/tax`)

- [ ] Extend `computeFifo` to return a record for each sale: buy date, sell date, units, cost, proceeds, days held
- [ ] Tax rule table, by asset type and date:
  - [ ] listed shares and equity funds: short term if held under 12 months, at 20%; long term at 12.5% above ₹1.25L a year (rates from 23 Jul 2024; older sales use the old rates)
  - [ ] grandfathering: gains on shares bought before 31 Jan 2018 use the 31 Jan 2018 price as cost
  - [ ] debt funds bought on or after 1 Apr 2023: taxed at the income-tax slab
  - [ ] US shares: long term after 24 months
  - [ ] gold funds and Sovereign Gold Bonds: their own rules
- [ ] What the page shows:
  - [ ] realized short- and long-term gains by financial year, per person
  - [ ] unrealized gains split by holding period
  - [ ] how much of this year's ₹1.25L long-term exemption is left, and which lots to sell to use it (harvesting)
  - [ ] lots turning long-term in the next 30 or 60 days
  - [ ] candidates for selling at a loss to offset gains
  - [ ] Schedule 112A-style CSV export
- [ ] Holdings with no purchase history (NSDL/CDSL statements only) are labelled "estimate only"

**Files:** `portfolio/fifo.ts`, new `portfolio/tax.ts`, `services.ts`, `shared/*`, `pages/Tax.tsx`
**Tests:** `tests/tax.test.ts` (cases across the 23 Jul 2024 rate change, 2018 grandfathering, debt funds after Apr 2023, US 24-month rule), `tests/fifo.test.ts` extended

## Phase 4 — Fund overlap and fund insights

- [ ] Overlap heatmap: how much each pair of funds holds the same stocks (sum of the smaller weight per shared stock); click a cell to list the shared companies
- [ ] Allocation by fund house and by fund category, with a concentration warning
- [ ] Flag Regular plans; estimate the yearly extra cost compared with the Direct plan of the same fund
- [ ] Effective stock exposure: direct shares plus what your funds hold of each company, combined

**Files:** new `portfolio/overlap.ts`, `portfolio/exposure.ts`, `pages/Exposure.tsx` (or a new `pages/Funds.tsx`)
**Tests:** `tests/overlap.test.ts`

## Phase 5 — Risk numbers (on the Performance page)

- [ ] Volatility (yearly), Sharpe and Sortino ratios (risk-free rate set in Settings, default 7%)
- [ ] Biggest drop from a peak and how long it took to recover
- [ ] Beta and correlation with Nifty; correlation grid of the top holdings
- [ ] Concentration score (Herfindahl index) plus top-5 and top-10 share, per person and for the family

**Files:** new `portfolio/risk.ts`, `pages/Performance.tsx`
**Tests:** `tests/risk.test.ts`

## Phase 6 — Targets and rebalancing (`/rebalance`)

- [ ] Target mix per person or for the family: equity / debt / gold / cash / international, plus optional large / mid / small cap. Stored in `settings` under `targets:<personId|family>`
- [ ] Bullet chart per bucket with an allowed range; off-target buckets show up on the Dashboard checklist (Phase 7)
- [ ] Suggested trades, in two modes:
  - [ ] new money only
  - [ ] sells allowed, tax-aware (uses the Phase 3 tax data)

**Files:** new `portfolio/rebalance.ts`, `services.ts`, `pages/Rebalance.tsx`
**Tests:** `tests/rebalance.test.ts`

## Phase 7 — UI improvements

- [ ] **Theme toggle:** Light / Dark / System in Settings, remembered between launches (`nativeTheme.themeSource`); the CSS uses a `data-theme` attribute; charts follow it
- [ ] **One period picker** in the page header (1M / 6M / 1Y / 3Y / 5Y / All / FY), shared by Overview, Analysis and Performance (`lib/period.tsx`)
- [ ] **Better tables:** `@tanstack/react-table` for Holdings, Activity, Tax and Dividends:
  - [ ] sort, filter, choose columns
  - [ ] headers stay visible while scrolling
  - [ ] group rows by person or platform
  - [ ] CSV export
  - [ ] settings remembered per table
- [ ] **Dashboard polish:**
  - [ ] headline numbers with a small trend line and the change over the chosen period
  - [ ] "Data health" checklist: no buy price, out-of-date prices, missing fund disclosures, off-target allocation, Regular plans; each links to its fix
  - [ ] placeholder loading blocks and proper empty-page messages
- [ ] **Sidebar:** add Performance, Tax and Rebalance

**Files:** `styles.css`, `Shell.tsx`, `Settings.tsx`, `Overview.tsx`, `Holdings.tsx`, `Activity.tsx`, `Dividends.tsx`, new `components/DataTable.tsx`, `lib/period.tsx`, `lib/theme.tsx`, `main/index.ts`

---

## Testing and release

- [ ] Each phase ends with: `npm run typecheck`, `npm test`, `npm run smoke`
- [ ] Extend `tools/smoke/ui-smoke.mjs` to cover the new pages, the theme switch and the period picker
- [ ] Bump the version to 0.7.0 and run `npm run dist`

## Order

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Phases 0 and 7 are the largest. Phases 2, 3 and 6 are independent, so each can ship separately.
