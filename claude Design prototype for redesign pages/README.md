# Handoff: ShareViral Finance — full app redesign

## Overview
Redesign of the ShareViral Finance admin app (BDT-first accounting for a small company).
Every screen in the product sidebar is covered: Dashboard, Accounts, Cash-in, Expenses overview,
AI tools & subscriptions, Other expenses, All transactions, Team, Payroll, Salary sheet,
Withholding tax (TDS), Statement (Reports), Bank statement, AI Assistant, Imports, and Settings
with all eight of its tabs.

## About the design file
`Finance App v2.dc.html` is a **design reference written in HTML** — a prototype showing the
intended look, layout and behaviour. It is **not production code to copy**. Recreate these screens
in the target codebase's own environment (React/Next, Vue, Blade…) using its component library,
routing and data layer. Open the file in a browser: the sidebar switches screens, the top-left
button collapses the sidebar to an icon rail, and the top-right button toggles dark/light.

All names, amounts and reference ids are copied from screenshots of the live app — treat them as
**placeholder data**; everything must come from the API.

Also in the bundle: `Finance Dashboard.dc.html` and `Finance App.dc.html` are the earlier
iteration (smaller type, no icons) — kept only for history. Build from **v2**.

## Fidelity
**High fidelity.** Colours, type, spacing, radii, icon choices, dark/light values and copy are final.
Known simplifications: All transactions shows 15 of 31 rows plus a "Load the rest" affordance;
Settings → What changed is an empty state (no data was supplied); the Statement's fund-movement
chart is two pillars (opening/closing) rather than a full waterfall.

## Brand
- **Primary / accent: `#BFFF00`** (ShareViral lime). Used as a *fill* under black text, and as an
  accent colour on dark surfaces only.
  Where it appears: primary buttons (lime fill, `#08090A` text), active sidebar item (lime text +
  3px inset lime left bar + lime tint background), active tabs and step chips, links **in dark mode**,
  expense share bars, statement chart pillars, checkbox ticks, logo mark, focus ring
  (`outline: 2px solid #BFFF00; outline-offset: 2px`), text selection, table-row hover tint
  (`oklch(0.62 0.19 122 / 0.07)`), and the round icon tiles (lime at 15% with a lime glyph).
  Where it must NOT appear: body text, small labels, table numbers, large filled areas.
  On white, lime text is unreadable (~1.4:1) — in light mode links use the deep-lime
  `oklch(0.45 0.10 122)` instead.
- **Secondary / canvas: `#000000`.** Sidebar is pure black in dark mode; the dark page canvas is a
  lifted near-black (see tokens) so data panels stay readable.
- Money semantics are deliberately NOT brand-coloured: cash in stays green, cash out stays red.
- **Dark mode is the default.** Light mode is a supported alternative (its sidebar is light grey).
  The choice persists in `localStorage` under `svf-theme-brand`; the sidebar rail state under
  `svf-sidebar`.

## Design tokens
Authored in `oklch()` / hex — keep the values, map them into the theme layer.

### Light theme
| Token | Value | Used for |
| --- | --- | --- |
| app-bg | `oklch(0.975 0.003 255)` | page background |
| surface | `#ffffff` | cards, table bodies, top bar |
| surface-alt | `oklch(0.983 0.003 258)` | table headers, total rows, inputs, emphasis cells |
| hairline | `oklch(0.918 0.005 258)` | card and field borders |
| hairline-soft | `oklch(0.955 0.004 258)` | row separators |
| ink | `oklch(0.22 0.015 258)` | headings, primary numbers |
| ink-body | `oklch(0.25 0.015 258)` | body text |
| muted | `oklch(0.55 0.012 258)` | secondary text, labels |
| faint | `oklch(0.62 0.012 258)` | USD approximations, meta, em-dashes |
| primary | `#BFFF00` on `#08090A` text | primary buttons, active tabs |
| link | `oklch(0.45 0.10 122)` | links, row actions |
| positive | `oklch(0.46 0.10 158)` | cash in |
| negative | `oklch(0.48 0.13 27)` | cash out |
| sidebar | `oklch(0.968 0.003 258)` | sidebar background (light mode) |
| sidebar item | `oklch(0.42 0.012 258)`, active `oklch(0.24 0.015 258)` on `oklch(0.62 0.19 122 / 0.26)` | nav |
| card shadow | `0 1px 2px oklch(0.25 0.015 258 / 0.04)` | cards (light only) |

### Dark theme (default)
| Token | Value |
| --- | --- |
| app-bg | `#141417` |
| surface | `#1C1C21` |
| surface-alt | `#232329` |
| hairline | `#303037` (fields `#3A3A42`) |
| hairline-soft | `#2A2A31` |
| ink | `oklch(0.965 0.003 258)` |
| muted | `oklch(0.705 0.012 262)` |
| faint | `oklch(0.62 0.012 262)` |
| positive | `oklch(0.78 0.13 158)` |
| negative | `oklch(0.74 0.14 27)` |
| sidebar | `#000000`, item `oklch(0.84 0.01 262)`, active `#BFFF00` on `oklch(0.72 0.20 122 / 0.16)` |
| link | `#BFFF00` |
| tag neutral | bg `#292930`, fg `oklch(0.80 0.02 262)` |
| tag positive | bg `oklch(0.30 0.05 158)`, fg `oklch(0.86 0.11 158)` |
| tag negative | bg `oklch(0.30 0.055 27)`, fg `oklch(0.85 0.11 27)` |
| card shadow | none |

The prototype implements dark mode as `data-theme="dark"` on the app root plus `!important`
overrides keyed on `data-r="…"` role attributes (`card`, `cardalt`, `thead`, `row`, `field`,
`chip`, `btnghost`, `ink`, `num`, `muted`, `label`, `faint`, `pos`, `neg`, `tag`, `tagpos`,
`tagneg`, `link`, `track`, `foot`, `iconTile`, `sidebar`, `sbTitle`, `sbSub`, `sbSection`,
`sbItem`, `sbDiv`). That is a prototype device only — in the real app these are theme tokens.

### Typography
- **Instrument Sans** 400/500/600/700 for all prose and UI text; **IBM Plex Sans** 400/500/600/700
  for every money figure, date, rate, id and reference — always with
  `font-variant-numeric: tabular-nums` so columns align. No monospaced font is used anywhere.
  Both from Google Fonts.
- h1 page title 28px/600/`-0.02em`, with a 27px icon at 75% opacity to its left (12px gap)
- card / section title 16px/600 · sub-line 13.5px muted
- body and table cells 14.5px (line-height ~1.45) · meta 12.5–13.5px
- uppercase stat label 11.5px/600/`0.11em` · table header 11.5px/600/`0.09em`
- hero figures `clamp(25px, 2vw, 32px)` (single figure) and `clamp(22px, 1.8vw, 28px)`
  (strip cells), weight 500, 600 for balances and totals
- sidebar nav 15px, section headings 11px/600/`0.13em` uppercase

### Icons
**Material Symbols Rounded** (variable, `FILL 0, wght 400, opsz 24`), 17–21px inline, 27px in page
titles. Nav: space_dashboard, account_balance, savings, receipt_long, auto_awesome, shopping_basket,
swap_vert, groups, payments, percent, bar_chart, description, smart_toy, upload_file, settings.

**Sidebar icons are colour-coded per item** — one hue each, same chroma, lightness swapped per theme:
`oklch(0.78 0.16 <hue>)` in dark, `oklch(0.56 0.16 <hue>)` in light. Hues: Dashboard 250,
Accounts 205, Cash-In 158, Expenses 27, AI tools & subscriptions 295, Other expenses 62,
All transactions 225, Team 185, Payroll 138, TDS 340, Reports 265, Bank statement 45,
AI Assistant 310, Imports 100, Settings 240. The active item's icon switches to lime
(`#BFFF00` dark / `oklch(0.48 0.15 122)` light) and to `FILL 1`.

**Every card heading, section heading and uppercase stat label carries a leading icon** (17px for
stat labels, 19px for card headings, 21px for dashboard section headings, 27px for page titles),
coloured by meaning rather than decoration: green `oklch(0.62 0.13 158)` for money in, red
`oklch(0.62 0.16 27)` for money out, lime `oklch(0.58 0.15 122)` for balances, blue
`oklch(0.62 0.13 250)` for people/company, cyan `oklch(0.62 0.12 205)` for FX and composition,
amber `oklch(0.68 0.14 62)` for tax and status, violet `oklch(0.62 0.15 295)` for AI/keys,
neutral `oklch(0.62 0.012 258)` for history and generic. Examples: opening balance → history,
cash inflow → south_west, cash outflow → north_east, current balance / net to pay →
account_balance_wallet, total held → savings, rate → currency_exchange, tax → percent,
executive summary → summarize, cash composition → pie_chart, fund movement → trending_up,
notes → sticky_note_2, categories → category, two-step sign-in → shield.
Actions: add, download, edit, archive, restore, delete, save, upload, calculate, key, person_add,
visibility, receipt_long, picture_as_pdf, search, calendar_month, expand_more, chevron_left,
chevron_right, arrow_forward, arrow_back, lock, lock_open, info, shield, check, menu, menu_open,
close, light_mode, dark_mode, logout, credit_card, account_balance, payments, savings (account tiles),
table_view. Substitute the codebase's own icon set if it has one — keep sizes and placement.

### Spacing, radius, layout
- Sidebar 272px, collapsed rail 84px (icons only, label in `title`), pure-black in dark mode,
  sticky full height with its own scroll.
- Top bar: min-height 66px, sticky, hairline bottom, `padding: 12px clamp(16px, 3vw, 32px)`,
  wraps on narrow screens. Contents: sidebar toggle (36px), breadcrumb `Finance / <screen>`,
  "FX locked ৳118.75 / $1" chip, theme toggle.
- Page gutter `clamp(16px, 3vw, 32px)`; page header `clamp(22px, 3vw, 34px)` top; content stack gap 16–20px.
- Card padding: summary `23px 26px`, stat cell `23px 24px`, panel header `20px 23px 18px`.
- Table rows `15–16px 23px`, column gap 14–16px.
- Radii: cards 12px (14px on centred empty states), buttons/fields 8px, tab groups 9–10px,
  chips 7px, pills 999px, small mono tags 5–6px. Icon tiles 34–52px.
- **Responsive:** below 900px the sidebar becomes a fixed drawer over a 55% black backdrop
  (toggle becomes a hamburger, `close` when open, closes on navigation and backdrop tap);
  the app grid collapses to one column; gutters and type shrink via `clamp()`; card grids are
  `repeat(auto-fit, minmax(…, 1fr))`; wide tables scroll horizontally **inside** their card.

### Structural patterns (reuse; do not invent per screen)
1. **Stat strip** — one bordered panel, `grid` `repeat(auto-fit, minmax(244px, 1fr))`, `gap: 1px`
   over a hairline-coloured panel background so dividers are true hairlines and survive wrapping.
   Cell = uppercase label, mono figure, "≈ $…" line, footnote.
2. **Summary bar** — label + one-sentence explanation left, hero figure and USD right.
3. **Data panel** — card, optional header (title + one-line description), `overflow-x: auto`
   wrapper, inner `min-width` grid: header row on surface-alt between hairlines, body rows
   separated by hairline-soft with a lime hover tint, optional surface-alt total row.
   Rows are CSS grid with fixed px columns and one `minmax(…, 1fr)` description column — not `<table>`.
   Every column is separated by a hairline vertical rule (`border-left: 1px solid oklch(0.905 0.005 258)`,
   dark `#35353D`) on each cell except the first, sitting in the middle of the column gap
   (`padding-left: 8px; margin-left: -8px` so text does not shift). Applies to header, body and total rows.
4. **Numbered report section** (Statement) — card whose title carries a mono `01`…`07` prefix.
5. **Progress bar** — 4px track, radius 2px, hairline-soft background, lime or category fill.
6. **Status pill** — 999px, 11.5–12px/500, tinted: positive for Active/Working/Paid/Cash in,
   negative for Cash out, amber for Draft/Restricted, neutral otherwise.
7. **Centred empty state** — 52px round lime icon tile, 19px/600 title, 14.5px muted paragraph,
   one lime-text action link.
8. **Form field** — label 14px/500, control on surface-alt with hairline border and 8px radius,
   help text 12.5px muted underneath. Selects show a trailing `expand_more`.
9. **Tab bars** — either an inline row above a hairline with a 2px lime underline on the active tab
   (Statement, Settings), or a bordered segmented group with a lime-filled active chip
   (subscriptions, team, TDS period, import steps).

### Category colours
Salary `oklch(0.60 0.12 220)` · Office & premises / Electricity / Internet / Office rent
`oklch(0.55 0.15 275)` · Marketing & Advertising `oklch(0.66 0.14 62)` · Administrative /
Office supplies `oklch(0.60 0.16 8)` · Technology / Software `oklch(0.58 0.12 190)` ·
Tax `oklch(0.55 0.15 290)` · Money in `oklch(0.55 0.13 158)` · Other `oklch(0.70 0.01 258)`.
7–9px dot, 8–11px gap before the label.

## Chrome
**Sidebar** — 36px lime rounded-square mark with a black `trending_up` glyph, "ShareViral" 16px/600
over "FINANCE" 12px uppercase tracked. Sections: OVERVIEW (Dashboard) · MONEY (Accounts, Cash-In
indented 24px, Expenses, AI tools & subscriptions indented, Other expenses indented, All
transactions) · PEOPLE (Team, Payroll) · TAX (TDS) · INSIGHT (Reports, Bank statement, AI Assistant)
· SYSTEM (Imports, Settings). Footer: hairline, SA avatar, "Super Admin / Owner access", logout icon.
In rail mode section headings become 1px dividers and every row centres its icon.

**Page footnote** — on every screen, above a hairline: "Every amount in this system is recorded in
BDT. Dollar figures are indicative only, translated at ৳118.75 per USD as of 12 August 2026."

## Screens
Content, columns and copy for each screen are in the prototype — open it and read the screen, then
match these structural notes.

1. **Dashboard "Overview, Super"** — month/year selects; three sections (BDT accounts, USD card,
   Expense overview), each a section header (title + grey qualifier + net-for-the-month pill) over a
   stat strip: opening balance / cash inflow (↓ in, share bar) / cash outflow (↑ out, share bar) /
   current balance on surface-alt with the mono footnote "opening + in − out".
2. **Accounts** — total-held summary bar; account cards `minmax(310px, 1fr)` with icon tile, type
   tag, right-aligned balance (negative in red), mono "Opened at … · date", hairline, "View details →"
   plus ghost Edit / Archive; ARCHIVED group on surface-alt with Restore and a red-outlined Delete.
3. **Cash in** — month chip + "Add cash"; two cards (received this month with a "dollars actually
   entered" hairline footer; rate this month with the transaction that set it); 10-row data panel
   (SL, invoice, description, BDT, USD, rate, transaction id, received bank, sender, note), inflows green,
   ⚠ prefix on flagged references.
4. **Expenses overview** — month stepper, Excel, Add expense; spent summary bar; five heading cards
   with dot, figure, USD, progress bar, "n% of the month · n entries"; 10-row expense panel with a
   category dot column, two-line description (title + method/account) and an amber "tax withheld" tag.
5. **AI tools and subscriptions** — status tab group + search + category select; 14-column plan panel
   (tool/plan, category, cost USD, equivalent BDT, rate, cycle, start, next renewal, status, payment,
   department, users, notes, login); closing note that these are plans, not payments.
6. **Other expenses** — same as 4 without the heading cards; note that 2 recurring payments are
   counted on the subscriptions screen.
7. **All transactions** — three-cell stat strip (money in / money out / net on surface-alt);
   filter row (search, date range, direction, account, category, show-voided); 15-of-31 row panel with
   Cash in/Cash out pills, signed coloured amounts, mono FX tag under the description, footer row.
8. **Team** — current/past tab group + search; 17-row panel (name + "Employee", designation,
   department, joined, salary BDT over USD, Working pill, View).
9. **Payroll** — "New month"; two-row panel (month, Paid pill, gross, tax withheld, net paid, paid on,
   "Open sheet →").
10. **Salary sheet — September 2026** — back link, Excel/Edit; four-cell stat strip (gross, additions,
    tax withheld with its caveat, net to pay); 17-row sheet with zero cells shown as faint ৳0.00 and a
    surface-alt total row; Payslip link per row.
11. **Withholding tax (TDS)** — deductions/calculator tabs, period segmented control + month + FY;
    deducted summary bar; 17-row panel (employee, salary, tax deducted, Payslip) with a total row.
12. **Statement (Reports)** — Monthly/Quarterly/Half year/Yearly tabs; period card (mono month tile,
    company, date range, Cycle/Draft/line-item chips, FY + month selects, PDF); closing bank and card
    balance cards; numbered sections 01 Executive summary, 02 Cash composition, 03 Fund movement
    (two lime pillars + "where it went"), 04–07 per-account ledgers (opening row, empty note, closing
    row on surface-alt); Notes to the accounts (numbered editable notes + Add a note); Cycle and Status
    cards; Signed-by card; lime Save.
13. **Bank statement** — account select + date range; one panel: brought-forward row, 16 rows
    (SL, date, description, transaction id, debit red, credit green, balance BDT over USD), closing
    row on surface-alt totalling debit and credit; note about voided entries.
14. **AI Assistant** — centred "Not switched on" empty state linking to Settings → Assistant.
15. **Imports** — four numbered step chips (step 1 active), dashed drop-zone card with lime
    "Choose file", "Past imports" panel with an empty state.
16. **Settings** — eight underline tabs:
    *Company & formatting* (company card, financial year and figures with sample number chips, lime
    Save, "Closing the books" card with lock note and date + Close the books);
    *Categories* (intro card + Add heading, then one card per heading: dot, name, money-out/in tag,
    Rename and Sub-category ghost buttons, sub-category chips on surface-alt, empty-state line);
    *Exchange rate* (source select, fixed rate, which rate reports use, translation caveat, Save,
    rate-history panel with Record a rate);
    *Salary TDS* (income-year select, exemption fraction/cap, six slab rows, investment rebate grid,
    two lime checkboxes with explanations, minimum tax, Save the rule, "Check a figure" card);
    *Your sign-in* (two-step sign-in card with warning note and lime CTA);
    *People who can sign in* (intro + Add someone, five-row table: name with "must change password"
    flag, email, role pill, Active pill, last signed in, edit and Password actions);
    *What changed* (empty state);
    *Assistant* (API key card with Off pill and Switch it on, "What leaves the building" select with
    caveat, model note, "What it cannot do" list of three).

## Interactions & behaviour
- Sidebar item → route change; active item gets lime text, lime tint and the 3px inset bar;
  Expenses children are always visible; rail mode keeps the icon and shows the label as a tooltip.
- Sidebar toggle: desktop collapses to the rail (persisted); mobile opens the drawer.
- Theme toggle: flips `data-theme`, persists, and repaints the document background so overscroll matches.
- Settings tabs and Statement tabs switch content in place; other tab groups, month steppers, search,
  selects and export buttons are static in the prototype — wire them to real query params/endpoints.
- Hover: nav items lighten; ghost buttons/fields take the surface tint; data rows take a 7% lime tint.
- Zero/missing values render as `৳0.00` or an em-dash in the faint colour, never blank.
- Keep motion minimal: the only transitions are the sidebar width/transform (160–220ms ease).

## State
Per screen: month/year, period granularity, active tab (settings tab, statement period, subscription
status, team current/past), filters (search, date range, direction, account, category, show-voided),
transactions pagination, plus global theme and sidebar-rail flags.
Server data: accounts, monthly cash-flow per account group, cash-in entries, expenses and heading
rollups, subscriptions, transactions, employees, payroll runs, salary-sheet lines, withholding rows,
statement (summary/composition/movement/per-account/notes/status/signatures), bank-statement lines,
import history, and every settings group. Amounts are stored in BDT; USD figures are derived with the
period's locked rate and must always be labelled "≈".

## Assets
No image files. Icons are Material Symbols Rounded; the logo mark is a lime rounded square with a
`trending_up` glyph — swap in the real ShareViral mark when available.

## Recommended order of work
Chrome + tokens + primitives → Dashboard → Accounts → Cash in → Expenses overview → Other expenses →
AI tools & subscriptions → All transactions → Team → Payroll → Salary sheet → Withholding tax →
Statement → Bank statement → Imports → AI Assistant → Settings (one tab at a time).
`PROMPTS.md` has a paste-ready prompt per page.
