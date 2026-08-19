# Handoff: ShareViral Finance — dashboard & app redesign

## Overview
A redesign of the ShareViral Finance admin app (BDT-first accounting for a small company):
dashboard, accounts, cash-in, expenses, subscriptions, transactions, team, payroll,
salary sheet and withholding tax. The goal of the redesign was a calmer, "industry grade"
finance surface: one dark sidebar, hairline-divided data panels instead of floating boxes,
monospaced tabular figures, and a full dark mode.

## About the design files
The files in this bundle are **design references written in HTML** — prototypes that show
the intended look, layout and behaviour. They are **not production code to copy**.
The task is to **recreate these screens inside the target codebase's own environment**
(React/Next, Vue, Blade, etc.) using its existing component library, routing and data layer.
If the project has no front-end conventions yet, pick the most appropriate framework and
implement the designs there.

All numbers, names and reference ids in the prototypes are copies of the real screenshots
supplied by the product owner. Treat them as **placeholder data** — everything must come
from the API in the real implementation.

## Fidelity
**High fidelity.** Colours, typography, spacing, radii, dark-mode values and copy are final.
Recreate pixel-for-pixel with the codebase's own primitives. Two deliberate simplifications:
- All transactions shows 15 of 31 rows plus a "Load the rest" affordance (real screen paginates).
- Reports, Statement, AI Assistant, Imports and Settings were not part of this redesign round.

## Files in this bundle
| File | Contains |
| --- | --- |
| `Finance Dashboard.dc.html` | Dashboard / "Overview, Super" screen (BDT accounts, USD card, expense overview) |
| `Finance App.dc.html` | All other screens, switched from the sidebar: accounts, cash-in, expenses overview, AI tools & subscriptions, other expenses, all transactions, team, payroll, salary sheet, withholding tax |
| `PROMPTS.md` | Ready-to-paste, one-page-at-a-time prompts for Claude Code |

Open either file in a browser to see the design. In `Finance App.dc.html` the sidebar items
switch screens; the ◑ button in the top bar toggles dark mode (persisted in `localStorage`
under `svf-theme`).

## Design tokens
Colours are authored in `oklch()` (CSS-native, keep them as-is).

### Light theme
| Token | Value | Used for |
| --- | --- | --- |
| `app-bg` | `oklch(0.975 0.003 255)` | page background |
| `surface` | `#ffffff` | cards, table bodies, top bar |
| `surface-alt` | `oklch(0.983 0.003 258)` | table headers, total rows, emphasis cell |
| `hairline` | `oklch(0.918 0.005 258)` | card borders, field borders |
| `hairline-soft` | `oklch(0.955 0.004 258)` | row separators |
| `ink` | `oklch(0.22 0.015 258)` | headings, primary numbers |
| `ink-body` | `oklch(0.25 0.015 258)` | body text |
| `muted` | `oklch(0.55 0.012 258)` | secondary text, labels |
| `faint` | `oklch(0.62 0.012 258)` | USD approximations, meta, em-dashes |
| `primary` | `oklch(0.52 0.13 264)` | primary buttons, active tab |
| `link` | `oklch(0.52 0.10 258)` | links, row actions |
| `positive` | `oklch(0.46 0.10 158)` | cash in / money received |
| `negative` | `oklch(0.48 0.13 27)` | cash out / money spent |
| `sidebar` | `oklch(0.235 0.018 262)` | sidebar background |
| `sidebar-active` | `oklch(0.30 0.022 262)` | active nav item |
| `sidebar-fg` | `oklch(0.84 0.01 262)` | nav labels (active: `oklch(0.98 0.002 258)`) |
| `sidebar-section` | `oklch(0.56 0.015 262)` | nav section headings |
| shadow | `0 1px 2px oklch(0.25 0.015 258 / 0.04)` | cards (light theme only) |

### Dark theme
| Token | Value |
| --- | --- |
| `app-bg` | `oklch(0.165 0.012 262)` |
| `surface` | `oklch(0.212 0.013 262)` |
| `surface-alt` | `oklch(0.245 0.015 262)` |
| `hairline` | `oklch(0.29 0.014 262)` (fields/inputs `oklch(0.31 0.015 262)`) |
| `hairline-soft` | `oklch(0.275 0.014 262)` |
| `ink` | `oklch(0.965 0.003 258)` |
| `muted` | `oklch(0.705 0.012 262)` |
| `faint` | `oklch(0.62 0.012 262)` |
| `positive` | `oklch(0.78 0.13 158)` |
| `negative` | `oklch(0.74 0.14 27)` |
| `sidebar` | `oklch(0.145 0.011 262)` |
| `sidebar-active` | `oklch(0.265 0.02 262)` |
| tag neutral | `bg oklch(0.28 0.02 262)` / `fg oklch(0.80 0.02 262)` |
| tag positive | `bg oklch(0.30 0.05 158)` / `fg oklch(0.86 0.11 158)` |
| tag negative | `bg oklch(0.30 0.055 27)` / `fg oklch(0.85 0.11 27)` |
| link | `oklch(0.78 0.10 258)` |
| card shadow | none |

Primary button colour is the same in both themes. Dark mode is applied by a
`data-theme="dark"` attribute on the app root; no colour is hard-coded per component
in the real implementation — map these to your theme layer.

### Typography
- Families: **IBM Plex Sans** (400/500/600/700) for text, **IBM Plex Mono** (400/500/600)
  for every money figure, date, rate, id and reference. Google Fonts.
- `h1` page title: 24px / 600 / `-0.02em`
- Card / panel title: 14.5px / 600
- Body & table cells: 13px, line-height 1.45
- Secondary meta: 11.5–12.5px
- Uppercase stat label: 10.5px / 600 / `0.11em` / uppercase
- Table header: 10.5px / 600 / `0.09em` / uppercase
- Hero figures: `clamp(19px, 1.55vw, 25px)` (dashboard strips), `clamp(22px, 1.7vw, 28px)`
  (single hero number), weight 500, 600 for balances/totals, `font-variant-numeric: tabular-nums`,
  letter-spacing `-0.02em`
- Never let a money figure be non-mono or non-tabular; columns must align.

### Spacing, radius, sizes
- Sidebar width **254px**, sticky, full height, own scroll.
- Top bar height **58px**, sticky, 1px bottom hairline, 32px side padding.
- Page gutter **32px**; page header padding `34px 32px 22px`; content stack gap **16–20px**.
- Card padding: hero/summary `20–22px 24px`; stat cell `20px 22px`; panel header `17px 20px 15px`.
- Table row padding `13–15px 20px`; column gap **14px**.
- Radii: cards/panels **12px**, buttons & fields **8px**, tab groups **9px**, chips **7px**,
  small mono tags **5–6px**, status pills **999px**.
- Icon squares 34px / radius 9px; avatars 30px circle.

### Structural patterns (reuse these, don't invent per screen)
1. **Stat strip** — one bordered panel, `display:grid` with `repeat(auto-fit, minmax(214px, 1fr))`,
   `gap: 1px` over a hairline-coloured panel background so every cell divider is a true hairline
   and survives wrapping. Cell = uppercase label, mono figure, USD approximation, footnote.
2. **Summary bar** — full-width card, label + one-sentence explanation on the left, hero figure
   and USD approximation right-aligned.
3. **Data panel** — card with optional header (title + one-line description), then
   `overflow-x: auto` wrapper, then an inner `min-width` grid: header row on `surface-alt`
   with hairlines above and below, body rows separated by `hairline-soft`, optional
   `surface-alt` total row at the bottom. Rows are CSS grid with fixed px columns and one
   `minmax(…, 1fr)` description column — not `<table>` — so the same column template is
   declared once for the header and once for the row.
4. **Progress bar** — 4px track, radius 2px, `hairline-soft` background, category-coloured fill.
5. **Status pill** — 999px radius, 11.5px/500, tinted background; positive for Active/Working/Paid/Cash in, negative for Cash out.

### Category dot colours (expenses / transactions)
Salary `oklch(0.60 0.12 220)`, Electricity & premises `oklch(0.55 0.15 275)`,
Advertising/Marketing `oklch(0.66 0.14 62)`, Office supplies `oklch(0.60 0.16 8)`,
Software & subscriptions / Technology `oklch(0.58 0.12 190)`. 7–8px circle, 8px gap before the label.

## Chrome (present on every screen)
**Sidebar** — brand block (30px rounded-square mark + "ShareViral" 14px/600 over "FINANCE"
11px uppercase tracked), then nav sections: OVERVIEW (Dashboard) · MONEY (Accounts,
Cash-In indented, Expenses with children Overview / AI tools and subscriptions / Other expenses,
All transactions) · PEOPLE (Team, Payroll) · TAX (TDS) · INSIGHT (Reports, Statement, AI Assistant).
Section headings 10px/600/`0.13em` uppercase. Items 13.5px, 9px 10px padding, 8px radius;
child items indented to 26px; active item gets `sidebar-active` background and white text.
Footer: Imports, Settings, then a hairline and the user block (SA avatar, "Super Admin" /
"Owner access", power icon).

**Top bar** — left breadcrumb `Finance / <screen>` (12.5px, current segment 500 weight in ink);
right an "FX locked ৳118.75 / $1" chip (6px green dot) and the 32px dark-mode toggle.

**Page footnote** — every screen ends with, above a hairline:
"Every amount in this system is recorded in BDT. Dollar figures are indicative only, translated
at ৳118.75 per USD as of 12 August 2026."

## Screens

### 1. Dashboard — "Overview, Super"
File: `Finance Dashboard.dc.html`.
Header: title + "Consolidated cash position across 4 accounts · reported in BDT", month and
year selects right-aligned. Three sections, each = section header row (h2 15px/600 + grey
qualifier text on the left, right-aligned net-for-the-month pill on account sections) followed
by a **stat strip**:
- *BDT accounts* (Master card · Petty cash (demo) · Standard Chartered Bank) — Opening balance
  ৳38,54,200.00 ("Carried forward from July") · Cash inflow ৳24,82,722.75 with "↓ in" marker and
  51%-of-movement bar · Cash outflow ৳23,62,800.04 with "↑ out" and 49% bar · Current balance
  ৳39,74,122.71 on `surface-alt` with the mono footnote "opening + in − out". Net pill +৳1,19,922.71.
- *USD card* — ৳69,537.00 / ৳1,22,500.00 (75%) / ৳39,975.00 (25%) / ৳1,52,062.00. Net pill +৳82,525.00.
- *Expense overview* — "Share of ৳23,62,800.04 that went out in August 2026" + a "Choose cards"
  dropdown button. Cells: Salary paid ৳21,78,700.04 (92% of outflow · 17 on payroll),
  AI & other tools ৳68,875.00 (3% · subscriptions), TDS withheld ৳4,500.00 (৳0 deposited to date,
  amber bar), Technology ৳68,875.00 (3% · hosting & devices).
Each cell shows the USD approximation under the figure. Tweakable flags in the prototype
(`showUsdApprox`, `showFlowBars`, `showShareBars`) are design options, not required features.

### 2. Accounts
Header "Accounts" / "Bank accounts and cards." + primary "+ Add account".
- Summary bar: TOTAL HELD, sentence "2 accounts in BDT, 1 in another currency — counted
  separately, because mixing them would give a figure that is money in neither.",
  figure ৳38,14,097.71 ≈ $32,118.72.
- Account cards, `repeat(auto-fit, minmax(310px, 1fr))`, 16px gap. Each: 34px tinted mono
  monogram (C card / B bank / $ USD / P cash) + name 14.5/600 + type-and-state line, type tag
  top-right; right-aligned balance (negative in `negative`, e.g. −৳59,031.29 for Master card);
  mono "Opened at … · date"; hairline; then "View details →" link and ghost Edit / Archive buttons.
  Cards: Master card −৳59,031.29 (opened ৳10,00,000.00 · 2026-05-01), Standard Chartered Bank
  ৳38,73,129.00 (৳18,50,000.00 · 2026-06-30, "Account · 1502734…"), USD card $152,062.00
  ≈ ৳1,80,57,362.50 (opened $187,083.00 · 2026-06-30).
- ARCHIVED label then the same card on `surface-alt` with muted figure: Petty cash (demo)
  ৳1,60,025.00, actions Restore and a red-outlined Delete.

### 3. Cash in
Header + month picker chip ("August 2026") + primary "+ Add cash".
Two cards: RECEIVED IN AUGUST 2026 — ৳26,05,222.75 in `positive`, "≈ $21,938.72 at the locked
rate", hairline footer row "Dollars actually entered / $21,665.65"; and RATE THIS MONTH — ৳118.30
with "Set by TXN-2026-000011 on 2026-08-01 — every taka figure this month is read in dollars at it."
Data panel "Every entry this month / 10 entries · scroll sideways for transaction id, bank and note",
min-width 1420px, columns: SL 38 · Invoice 110 · Description 1fr · Amount (BDT) 130 right ·
Amount (USD) 110 right · Rate 88 right · Transaction id 168 · Received bank 176 · Sender 150 · Note 130.
BDT amounts in `positive`; a "⚠" prefix marks invoice/transaction ids the system flagged.

### 4. Expenses overview
Header + month stepper (‹ August 2026 ›) + ghost Excel + primary "+ Add expense".
Summary bar: SPENT IN AUGUST 2026 / "Across 5 headings · 10 entries" / ৳24,02,775.04 ≈ $20,233.90
in `negative`. Then five heading cards (`minmax(268px, 1fr)`): dot + name, figure, USD, progress
bar, "<n>% of the month · <n> entries" — People ৳21,78,700.04 (91% · 2), Office & premises
৳1,11,600.00 (5% · 4), Technology ৳68,875.00 (3% · 2), Marketing ৳38,000.00 (2% · 1),
Administrative ৳5,600.00 (under 1% · 1).
Data panel "Every expense this month / 10 entries, newest first", min-width 1080px, columns
SL 34 · Date 100 · Category 172 (dot + label) · Description 1fr (title 500 + meta line
"Bank transfer · Master card" + optional amber mono tag "tax withheld ৳4,500.00") · Reference 176 ·
Amount (BDT) 134 right, prefixed "− " in `negative` · USD 100 right · Rate 96 right.

### 5. AI tools and subscriptions
Header + primary "+ Add a subscription". Tab group (Active 2 / Paused / Canceled / Expired / All)
with search field and "Every category" select on the right.
Data panel, min-width 1720px, columns Tool 196 (name 13.5/600 + plan line) · Category 96 ·
Cost (USD) 104 right · Equivalent (BDT) 128 right · Rate 80 right · Billing cycle 112 ·
Start date 112 · Next renewal 118 · Status 92 (Active pill) · Payment 120 · Department 140 ·
Users 176 · Notes 150 · Login account 190 (mono).
Rows: Claude AI (Max plan 5x) and Anthropic (Max), both $100.00 ≈ ৳12,277.00 @ 122.77, monthly,
Master card, Engineering Core. Closing note: "2 plans, 2 seats between them. What was actually
paid for these sits on the Expenses screens — these are the plans, not the payments."

### 6. Other expenses
Header + month stepper + primary "+ Add expense". Summary bar ৳23,33,900.04 ≈ $19,653.90 with
"2 recurring payments are left out — they are counted on AI tools and subscriptions."
Data panel "Every other expense in August 2026 / The 8 most recent of 10 money-out entries —
narrow the month, or open All transactions for the rest", min-width 1180px, columns
SL 34 · Date 100 · Category 162 · Description 1fr · Amount (BDT) 134 right · USD 96 right ·
Method & account 124 · Reference 180 · Rate 96 right.

### 7. All transactions
Header "Transactions" / "Every movement of money, in and out." + ghost Excel.
Stat strip of three: MONEY IN ৳37,85,222.75 ≈ $31,875.56 (positive) · MONEY OUT ৳27,36,121.04
≈ $23,041.02 (negative) · NET ৳10,49,101.71 on `surface-alt`, "≈ $8,834.54 · 31 entries in this view".
Filter row: search (flexible width), date-range field, "In and out", "All accounts",
"All categories" selects, and a "Show voided" checkbox.
Data panel, min-width 1240px, columns SL 34 · Date 100 · Type 96 (Cash in / Cash out pill) ·
Category 148 · Description 1fr (title + method/account meta + optional mono FX tag
"USD 200.00 @ 122.770000") · Reference 178 · Amount (BDT) 142 right, signed and coloured by
direction · USD 108 right · Rate 100 right. Footer row on `surface-alt`: "Showing 15 of 31 entries
in this view" + "Load the rest →".

### 8. Team
Header + ghost Excel + primary "+ Add person". Tab group "Current team 17 / Past team 1" with a
search field right. Panel header "Employees · 17 / Drawn on the monthly salary sheet".
Table min-width 1040px: Name 1fr (name 13.5/600 + "Employee") · Designation 250 ·
Department 116 (em-dash) · Joined 116 mono · Current salary 148 right (BDT over "≈ $x") ·
Status 100 (Working pill) · View link 78. 17 rows.

### 9. Payroll
Header + primary "+ New month". Table min-width 980px: Month 1fr (14px/600) · Status 100 (Paid pill) ·
Gross 176 right · Tax withheld 176 right · Net paid 176 right · Paid on 124 mono · action 112.
Rows: September 2026 — ৳11,02,000.00 / ৳25,299.96 / ৳10,76,700.04 / 2026-08-19;
August 2026 — ৳11,02,000.00 / ৳0.00 / ৳11,02,000.00 / 2026-08-16.
"Open sheet →" navigates to the salary sheet.

### 10. Salary sheet — September 2026
"← All payroll runs" back link, title, "17 people · paid on 2026-08-19", ghost Excel and Edit.
Stat strip of four: GROSS ৳11,02,000.00 ≈ $9,280.00 · ADDITIONS ৳0.00 "No bonuses this run" ·
TAX WITHHELD ৳25,299.96 "Stays with you until the challan is deposited" · NET TO PAY
৳10,76,700.04 ≈ $9,066.95 on `surface-alt`.
Table min-width 1080px: Name 1fr (name + designation) · Gross 150 right (BDT over USD) ·
Bonus 100 · Other + 100 · Tax 140 · Other − 100 · Net 160 (500 weight) · Payslip link 92.
Zero cells are shown as faint ৳0.00, never blank. Bottom `surface-alt` total row:
"Total · 17 people" ৳11,02,000.00 / ৳0.00 / ৳0.00 / ৳25,299.96 / ৳0.00 / ৳10,76,700.04.

### 11. Withholding tax (TDS)
Title "Withholding tax" / "Tax deducted from salaries — whose, and how much."
Tab group "Salary deductions / Tax calculator"; on the right a period segmented control
(Monthly active / Quarterly / Half year / Yearly) plus "August 2026" and "FY 2026-27" selects.
Summary bar: DEDUCTED IN AUGUST 2026, "The month we are in, for whichever period the table below
shows.", figure ৳0.00.
Panel header "August 2026" + "Everyone on a finalised payroll run in this period. Somebody who
owed no tax is listed at 0.00 rather than left out — this is who was paid, not only who was taxed."
Table min-width 760px: Employee 1fr · Salary 200 right (BDT over USD) · Tax deducted 180 right ·
Payslip link 96. 17 rows, then a `surface-alt` row "Deducted in August 2026 — ৳0.00".

## Interactions & behaviour
- Sidebar item → route change; active item highlighted; Expenses children always visible.
- Dark-mode toggle: flips `data-theme` on the app root, persists to `localStorage` (`svf-theme`),
  and also sets the document background so overscroll matches. Respect this persistence.
- Hover: nav items lighten their background; ghost buttons/fields take the `app-bg` tint;
  links darken. No motion beyond default colour transitions — keep it quiet (≤150ms if you add any).
- Month steppers / pickers, tab groups, search and select controls are **static in the prototype**;
  wire them to the existing query params and endpoints.
- "Open sheet →" and "← All payroll runs" navigate between payroll list and salary sheet.
- Wide tables scroll horizontally **inside the card** (the card keeps its radius and border);
  the page itself never scrolls sideways.
- Empty/zero values render as `৳0.00` or an em-dash in `faint`, never as blank cells.
- Every ⚠ marker means "system flagged this reference" — keep whatever rule the current app uses.

## State
Per screen: selected month/year, period granularity (TDS), tab (subscriptions status, team
current/past, TDS deductions vs calculator), filters (search text, date range, direction,
account, category, show-voided), pagination cursor for transactions, plus the global theme flag.
Server data: accounts, monthly cash-flow summary per account group, cash-in entries, expense
entries and heading rollups, subscriptions, transactions, employees, payroll runs, salary sheet
lines, withholding rows. Amounts are stored in BDT; USD figures are derived with the month's
locked rate and must be labelled as approximations ("≈").

## Assets
None. No image or icon files are used — monograms, arrows and markers are text glyphs, dots and
squares. Substitute the codebase's icon set where an icon reads better (nav items, Excel export,
search, chevrons) but keep the sizes and colours above.

## Recommended order of work
Chrome (sidebar, top bar, theme) → Accounts → Cash in → Expenses overview → Other expenses →
AI tools and subscriptions → All transactions → Team → Payroll → Salary sheet → Withholding tax.
See `PROMPTS.md` for a per-page prompt you can paste into Claude Code one at a time.
