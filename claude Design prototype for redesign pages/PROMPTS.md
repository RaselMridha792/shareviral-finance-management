# Page-by-page prompts for Claude Code

## How to run this handoff
1. Copy this folder into your repo (e.g. `docs/design_handoff_finance_app/`) and commit it, so
   Claude Code can read the reference HTML and the README directly.
2. Start Claude Code in the repo root.
3. **Session 1: prompt 0** — tokens, theme, app shell, shared primitives. Everything else builds on it.
4. Then **one page per session**, in the order in the table below. One page = one prompt = one PR.
5. After each page, ask it to run the app and compare against the reference side by side in both themes.

Reference files:
- `docs/design_handoff_finance_app/README.md` — brand rules, tokens, patterns, per-screen notes
- `docs/design_handoff_finance_app/Finance App v2.dc.html` — the design (sidebar switches screens,
  top-left button collapses it, top-right toggles the theme)

---

## Prompt 0 — tokens, theme, shell, primitives
```
Read docs/design_handoff_finance_app/README.md and open
docs/design_handoff_finance_app/Finance App v2.dc.html in a browser to see the target design.

It is a design reference in HTML, not code to copy. Recreate it in this codebase with our own
framework, component and styling conventions.

This session only:
1. Add the light and dark token sets from the README to our theme layer, keeping the oklch/hex values.
   Dark is the DEFAULT theme; light is the alternative. Persist the choice (localStorage
   svf-theme-brand) and repaint the document background with it.
2. Brand rules: #BFFF00 is a fill under near-black text and an accent on dark surfaces only —
   primary buttons, active nav, active tabs, focus ring, selection, row hover tint, progress fills,
   dark-mode links. In light mode links use oklch(0.45 0.10 122). Cash in stays green, cash out red.
3. Load Instrument Sans + IBM Plex Mono + Material Symbols Rounded. Every money figure, date, rate
   and id uses IBM Plex Mono with tabular-nums.
4. Build the shell: 272px sidebar (pure black in dark, light grey in light) with the section/nav
   structure from the README, collapsible to an 84px icon rail (persisted, labels as tooltips), and
   a mobile drawer below 900px with a backdrop; sticky top bar with sidebar toggle, breadcrumb,
   FX chip and theme toggle; the shared BDT footnote.
5. Build the shared primitives from "Structural patterns": StatStrip, SummaryBar, DataPanel
   (header + horizontally scrolling grid table with hover tint and optional total row),
   NumberedSection, ProgressBar, StatusPill, Tag, IconTile, EmptyState, FormField/Select,
   TabBar (underline) and SegmentedGroup (filled), primary/ghost buttons.

No page content yet. Show me the shell with an empty content area in both themes, at desktop,
rail and mobile widths.
```

---

## One prompt per page
Paste this and fill the two bracketed parts:

```
Read docs/design_handoff_finance_app/README.md, screen "[SCREEN NAME from the table]".
Open docs/design_handoff_finance_app/Finance App v2.dc.html and click "[SIDEBAR ITEM]" to see it.

The HTML is a design reference, not code to copy. Build this screen in our codebase on the shell and
primitives from the earlier session, with our routing and real API data — the figures in the
reference are placeholders from screenshots.

Requirements:
- Match layout, column sets, paddings, radii, type scale, icons and colours from the README.
- Reuse the shared primitives; no new one-off styles, no colours outside the token set.
- Money figures in IBM Plex Mono, tabular-nums, right-aligned in tables; green for money in, red for
  money out; USD lines prefixed with "≈".
- Wide tables scroll inside their card, never the page. Works at desktop, rail and mobile widths,
  in dark and light.
- Zero/missing values render as ৳0.00 or an em-dash in the faint colour, never blank.
- Filters, tabs, month pickers and exports must hit real query params/endpoints — tell me if an
  endpoint is missing instead of faking it.

When done: run the app, screenshot the page in both themes, and list anything you deviated from.
```

### Order
| # | SCREEN NAME | SIDEBAR ITEM |
| --- | --- | --- |
| 1 | Dashboard "Overview, Super" | Dashboard |
| 2 | Accounts | Accounts |
| 3 | Cash in | Cash-In |
| 4 | Expenses overview | Expenses |
| 5 | Other expenses | Other expenses |
| 6 | AI tools and subscriptions | AI tools & subscriptions |
| 7 | All transactions | All transactions |
| 8 | Team | Team |
| 9 | Payroll | Payroll |
| 10 | Salary sheet — September 2026 | Payroll → Open sheet |
| 11 | Withholding tax (TDS) | TDS |
| 12 | Statement (Reports) | Reports |
| 13 | Bank statement | Bank statement |
| 14 | Imports | Imports |
| 15 | AI Assistant | AI Assistant |
| 16 | Settings | Settings |

Settings is large — split it into two or three sessions by tab:
(a) Company & formatting + Closing the books, (b) Categories + Exchange rate,
(c) Salary TDS + Your sign-in + People who can sign in + What changed + Assistant.

---

## Final pass
```
Re-read docs/design_handoff_finance_app/README.md and review every screen you built: token usage
(no stray colours, lime never as text on light backgrounds), mono/tabular figures and column
alignment, dark and light modes, sidebar rail and mobile drawer, hover and focus states, empty
states, and horizontal scroll on wide tables. Fix what drifted and list what you changed.
```
