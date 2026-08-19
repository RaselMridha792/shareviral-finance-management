# Page-by-page prompts for Claude Code

## How to run this handoff
1. Put this whole folder inside your repo (e.g. `docs/design_handoff_finance_app/`) and commit it,
   so Claude Code can read the HTML references and this README directly.
2. Start Claude Code in the repo root.
3. **First session: build the chrome once** (prompt 0). Everything else depends on it.
4. Then do **one page per session**, in the order below. One page = one prompt = one PR.
   Fresh session per page keeps context small and diffs reviewable.
5. After each page, ask Claude Code to run the app and compare against the HTML reference
   side by side, then fix differences before moving on.

Reference files to point at:
- `docs/design_handoff_finance_app/README.md` — tokens, patterns, per-screen specs
- `docs/design_handoff_finance_app/Finance Dashboard.dc.html` — dashboard
- `docs/design_handoff_finance_app/Finance App.dc.html` — all other screens (sidebar switches them)

---

## Prompt 0 — chrome, theme and shared primitives (do this first)
```
Read docs/design_handoff_finance_app/README.md and open
docs/design_handoff_finance_app/Finance App.dc.html in a browser to see the target design.

These are design references in HTML, not code to copy. Recreate them in this codebase using our
existing framework, component and styling conventions.

Task, this session only:
1. Add the design tokens from the README (light + dark) to our theme layer. Keep the oklch values.
   Dark mode is a data-theme="dark" attribute on the app root, persisted in localStorage under
   svf-theme, and it also sets the document background.
2. Load IBM Plex Sans and IBM Plex Mono. Every money figure, date, rate, id and reference uses
   IBM Plex Mono with tabular-nums.
3. Build the app shell: 254px sticky dark sidebar (brand, nav sections, footer items, user block)
   and the 58px sticky top bar (breadcrumb, "FX locked" chip, dark-mode toggle), plus the shared
   BDT footnote line.
4. Build the shared primitives described under "Structural patterns": StatStrip, SummaryBar,
   DataPanel (header + horizontally scrolling grid table with header row, hairline rows and
   optional total row), ProgressBar, StatusPill, tag, ghost button, primary button, field/select.
   Match the padding, radii and type scale in the README exactly.

Do not build any page content yet. Show me the shell rendered with an empty content area, in both
light and dark mode.
```

---

## One prompt per page
Paste the block below and replace the two bracketed parts. Keep the rest identical.

```
Read docs/design_handoff_finance_app/README.md, section "[SECTION TITLE, e.g. 3. Cash in]".
Open docs/design_handoff_finance_app/[Finance App.dc.html or Finance Dashboard.dc.html] in a
browser and switch to that screen ([sidebar item name]) to see the target design.

The HTML is a design reference, not code to copy. Build this screen in our codebase using the
shell and primitives from the previous session, our routing, and real data from our API — the
numbers in the reference are placeholders from screenshots.

Requirements:
- Match layout, column widths, paddings, radii, type scale and colours from the README section.
- Reuse the shared primitives; do not add new one-off styles or new colours.
- Money figures: IBM Plex Mono, tabular-nums, right-aligned in tables, positive/negative colours
  only for cash in / cash out. Show the USD line as an approximation with "≈".
- Wide tables scroll horizontally inside the card, never the page.
- Zero and missing values render as ৳0.00 or an em-dash in the faint colour, never blank.
- Works in light and dark mode.
- Filters, tabs, month pickers and export buttons must be wired to real query params/endpoints
  (they are static in the reference) — tell me if an endpoint is missing instead of faking it.

When done: run the app, screenshot the page in both themes, and list any place you deviated
from the reference and why.
```

### Order and the values to fill in
| # | SECTION TITLE | File | Sidebar item |
| --- | --- | --- | --- |
| 1 | 1. Dashboard — "Overview, Super" | Finance Dashboard.dc.html | Dashboard |
| 2 | 2. Accounts | Finance App.dc.html | Accounts |
| 3 | 3. Cash in | Finance App.dc.html | Cash-In |
| 4 | 4. Expenses overview | Finance App.dc.html | Expenses › Overview |
| 5 | 6. Other expenses | Finance App.dc.html | Expenses › Other expenses |
| 6 | 5. AI tools and subscriptions | Finance App.dc.html | Expenses › AI tools and subscriptions |
| 7 | 7. All transactions | Finance App.dc.html | All transactions |
| 8 | 8. Team | Finance App.dc.html | Team |
| 9 | 9. Payroll | Finance App.dc.html | Payroll |
| 10 | 10. Salary sheet — September 2026 | Finance App.dc.html | Payroll › Open sheet |
| 11 | 11. Withholding tax (TDS) | Finance App.dc.html | TDS |

---

## Final pass prompt
```
Read docs/design_handoff_finance_app/README.md again, then review every screen you built against
it: token usage (no stray colours), mono/tabular figures, column alignment, dark mode, hover
states, empty-state rendering, and horizontal scroll behaviour on the wide tables. Fix what drifted
and list what you changed.
```
