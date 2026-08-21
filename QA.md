# QA — the pass before real data

Page by page, on a local copy, against the database rather than against
expectations. Newest at the bottom, so it reads as a walk through the app.

**How each page is examined.** `node .qa.mjs <route>` asks the same questions of
every screen — does it load, does it scroll sideways, are there console errors
or failed requests, do the headings sit over their columns, are there links with
no href, does the row count look like a page or a whole set. Then whatever that
page's own arithmetic is, computed in SQL and read back off the rendered page,
because most of the faults found in this codebase were invisible in a diff and
visible only in a figure.

**What "no findings" means here.** It means the checks below ran and passed. It
does not mean the page is right — a check nobody thought to write finds nothing.
Where a check was not possible, it says so.

---

## Dashboard — `/`

**Checked.** Ten account blocks against the ledger; page-level layout; console
and network.

| | |
|---|---|
| Balances | All 10 blocks: `CURRENT BALANCE` equals `opening_balance + Σ signed_amount` over entries that are not voided. Exact to the paisa. |
| Layout | No sideways scroll at 1440px. |
| Console / network | Nothing. No API call returned 4xx or 5xx. |
| Links | No `<a>` without an href. |

**Findings: none.**

**Two false alarms from the checker, both mine, both fixed.** The first read the
*first* money figure in each block — which is the period's opening balance, not
the current one — and reported six accounts as disagreeing with a ledger they
matched exactly. The second ignored the sign, because the app prints a Unicode
minus (`−`, U+2212) and the script stripped everything but digits. A check that
cries wolf is worse than no check: it teaches you to skip the output.

**Not checked.** The Edit / reorder mode and the "Add" card chooser were not
exercised — those write to `localStorage`, and the run only reads.

---

## Accounts — `/accounts`, `/accounts/[id]`, `/accounts/[id]/register`, `/accounts/cash-in`

**Checked.** All four screens through the harness, then three arithmetic checks.

| | |
|---|---|
| Balances on the list | All 10 match the ledger. |
| Register running balance | All 20 rows on page one follow: opening figure, then each row from the one above it. This is the check worth having — a running balance is wrong in a way that looks right, because every figure is individually plausible. |
| Cash In | 2 rows shown, and the ledger has exactly 2 money-in entries in the current month. The screen opens on the current month by default. |
| Layout | No sideways scroll on any of the four. |
| Console / network | Nothing on any of the four. |
| Pagination | The register pages at 20 with a pager; Cash In's 2 rows need none. |

**Findings: none.**

**One more false alarm, fixed in the harness.** It flagged the actions column on
two screens for having a right-aligned heading over cells that are not
right-aligned. They are: the `<td>` has no `text-align`, and the buttons are
pushed right by flexbox instead. The heading is blank, so there was nothing to
be out of line with. The harness now skips blank headings and counts
`justify-content: end` as alignment.

**Not checked.** Creating, editing or voiding an entry. The forms open from
these screens and the run does not submit.

---

## Expenses — `/expenses`, `/expenses/other`, and All transactions — `/transactions`

**Checked.** Three screens through the harness, then the two sets of figures
that decide whether these pages can be trusted.

| | |
|---|---|
| Expense headings | All 7 category totals for the current month equal the ledger, each transaction counted against its top-level category once. |
| Transactions summary | Money in and money out both match the sums that **exclude** voided entries — and the difference is large (৳30.3cr live against ৳33.0cr with voided), so the check means something. 11 voided entries exist in this database. |
| Layout | No sideways scroll on any of the three. |
| Console / network | Nothing. |
| Pagination | Other expenses and All transactions both page at 20 with a pager. |

**Findings: none.**

**Two more false alarms, both in the checking rather than the app.** The
category query joined categories to their children and then matched
transactions on "parent or child", which fans out: an entry filed against the
parent itself matched once per child and was counted that many times. Office &
premises came out at five times its real total. And "Other expenses" was found
in the sidebar rather than on the page, so it appeared to be missing. Both
fixed; the checker now maps each entry to its top-level category once and reads
`<main>` rather than the whole document.

**Worth writing down about this pass so far.** Every finding to date has been in
the checking, not the app — four of them. That is a real result about the app,
and it is also a warning about the method: a check written quickly against a
schema you half remember will disagree with a correct page more often than a
wrong page will. Each one has to be chased to the bottom before it is reported,
which is the slow part and the part that cannot be skipped.

**Not checked.** The category detail pages (`/expenses/[category]`), the chip
row of sub-categories, and the add/edit/void forms on any of these screens.

---

## Team, Payroll and TDS — `/team`, `/team/[id]`, `/payroll`, `/payroll/[runId]`, `/tax/withholding`

**Checked.** Five screens through the harness, the salary sheet measured
column by column, and the payroll data queried behind it.

| | |
|---|---|
| Loading | All five render. Team pages at 20 with a pager, payroll runs at 20, the salary sheet shows all 18 lines of the run. |
| Layout | No sideways scroll on any of the five. |
| Console / network | Nothing, on any of them. |
| Column alignment | Measured by where the text actually lands rather than by `text-align`. Five of the salary sheet's six money columns line up exactly; one does not — see below. |

### Findings

**1. The salary sheet's `Net` column sits about 16px left of its heading.**
Cosmetic, and the only column on the page that does. Its neighbours render an
`<input class="col-amount">` whose own padding places the figure; `Net` renders
an `Amount` directly into the cell, so the two end at different distances from
the column edge. Every other money column on the sheet — Gross, Bonus, Other +,
Tax, Other − — is exact.

**2. The warning triangle is on every Tax row, and the owner asked for it to
go.** Section 7.1 of the plan records the request and the reasoning, and the
mark is still there (`salary-sheet-screen.tsx:752`). It draws when a line has no
stored `tds_basis`, and **all 468 payroll lines in this database have none** —
so it is on every row rather than on the exceptional one, which is the opposite
of what a warning is for. Worth checking on the live site, where the same
seeder made the runs.

Worth one sentence before it is removed, which the plan also makes: it is the
only mark distinguishing a tax figure the app worked out from one somebody
typed. Removing it leaves the drawer as the only way to tell.

**Two more false alarms, both fixed in the harness rather than reported.** An
empty table draws one cell spanning every column, and counting its cells
against the headings called every empty screen "five columns short". And the
alignment check read `text-align` off the `<td>`, which these cells do not use
— they right-align through an input's padding, a flex row's `justify-end`, or a
two-line column's `items-end`. It measures the text's own box now, and went
from six columns flagged to the one that is genuinely out.

**Not checked.** Creating a payroll run, editing a line, finalising or paying;
the TDS working drawer; the challan panel.

---

## Subscriptions, category detail, Reports, Bank statement, Assistant, Import and Export, Settings

**Checked.** Seven screens through the harness, the bank statement measured
against the account it is for, and the Reports page's opening period traced back
to the code that chooses it.

| | |
|---|---|
| Loading | All seven render. Subscriptions and the statement page at 20 with a pager. |
| Layout | No sideways scroll on any of the seven. |
| Console / network | Nothing. |
| Bank statement columns | `SL · Date · Description · Debit · Credit · Balance · Transaction ID · Invoice` — the order asked for. |
| Brought-forward line | Date and figure both equal the account's own opening balance. The first row of the table is a real movement, not the blank placeholder it used to be. |

### Finding: Reports opens on a period a year old, and empty

`/reports` asks the API for `fiscalYear=2025&index=2` — August 2025 — on a day
in August 2026. The page shows **0 line items**, which is what that month
contains.

The month is worked out correctly and the year is not:

```ts
const current = periods.periods.findIndex((p) => today >= p.start && today <= p.end);
const index = current >= 0 ? current + 1 : 1;      // right: August is index 2
…
fiscalYear: periods.years[1],                      // wrong: years is [2026, 2025]
```

`periods.years` arrives newest first, so `years[1]` is the fiscal year *before*
the one the periods belong to. The index is computed against 2026's months and
then applied to 2025.

The comment two lines above says what was meant: *"Open on the period we are
actually in. Landing on July every August is the kind of small wrongness that
makes people stop trusting a document."* The intent is stated and the code does
the opposite of it for the year — the fourth time today a comment and its line
have disagreed.

`apps/web/src/app/(dashboard)/reports/page.tsx`. Not fixed; reported.

**One more false alarm, mine.** The statement's brought-forward date was read
through `new Date(...).toISOString()`, which shifts a day back at UTC+6, and
reported a mismatch the page did not have. Dates are read as text from SQL now.

**Not checked.** The twelve tables inside the period statement — their internal
arithmetic was not verified, only that the page renders and the period it opens
on is wrong. The assistant's chat, the export downloads from the Export tab
(those were checked when the tab was built), and every settings panel.

---

## Roles, and the write path

### Every role against every gated route

Checked against `ROLE_PERMISSION_SETS` rather than against an opinion — the
expectation is computed from the matrix both the sidebar and the API read, and
compared with where each role actually lands.

**13 routes × 5 roles = 65 combinations, all correct.** No role reaches a screen
it has no permission for, and none is refused one it does have. The second
matters as much as the first: a screen somebody cannot do their job on is not
filed as a bug, it is quietly worked around.

### CFO — the role nothing had ever exercised

`cfo` exists in the matrix and no user on this system has it, so "copied the
admin row" had been true only in the sense that nobody had looked. Exercised on
a token carrying the claim — the proxy and the API both read the claim, so this
needs no account invented on a live system. **All 9 gated routes behave as the
matrix says.**

### HR must not read salary — and does not

Route gating says nothing about this: HR is *allowed* on Team and Payroll, and
the filtering happens further down in the service's projection. Read both pages
as HR and looked for the three highest gross figures in the payroll. **Neither
page carries any of them.**

### The write path, measured in the ledger

Create, edit, void — asking the database what the account is worth after each
step, against an exact expected movement.

| step | expected | moved |
|---|---|---|
| create ৳1,234.56 out | −1,234.56 | −1,234.56 |
| edit to ৳2,000.00 | −765.44 | −765.44 |
| void it | +2,000.00 | +2,000.00 |
| net against the start | 0.00 | 0.00 |

The audit trail carries `create, update, void`. The probe row was removed and
the account returned to exactly where it began.

The void is the step worth having. A void that leaves the money in the total is
the same fault in reverse, and both look plausible on screen — the row is struck
through either way, and only the arithmetic tells them apart.

**Findings: none.**

**Not checked.** Writes through the forms themselves rather than the API — the
form is the same one on five screens, and whether its fields reach the endpoint
correctly is a separate question from whether the endpoint is right. Payroll
finalise and pay, which move money for a whole run. Creating an account, a team
member or a subscription.

---

## Writing through the form, payroll totals, Settings panels, the statement's tables

### The drawer, not the endpoint

`.writeqa.mjs` proved the API moves the ledger. That says nothing about whether
the drawer reaches it with what was typed — a field bound to the wrong key, a
number sent as text, a default quietly overriding an entry, all leave the
endpoint blameless and the row wrong. So: typed into the drawer the way a
person does, pressed the button it offers, then asked the database what arrived.

| | |
|---|---|
| description | as typed |
| amount | ৳3,141.59, as typed |
| direction | `out` — correct for an expense screen |
| date | today |
| category, account | both set from the screen's own context |
| the ledger | moved −3,141.59, exactly the amount |
| the page | shows the new row after a reload |

This is the most-used write path in the app: the same drawer serves five
screens. **Findings: none.** The probe row was removed.

Worth recording: `/transactions` has no add button, by design — the form is
mounted there only to edit a row. Creating happens on the category pages and
Other expenses.

### Payroll run totals

Every run's stored `total_gross`, `total_tds` and `total_net` compared with the
sum of its own lines. **All six runs in this database store 0.00 against lines
that add to real money**, and the salary sheet shows it: eighteen people with
real salaries, and `GROSS ৳0.00 · TAX WITHHELD ৳0.00 · NET TO PAY ৳0.00` above
them with a Finalise button beside.

**This is stale local data, not a fault in the app.** These runs were written at
00:22 on 20 August by the seeder that has since been replaced; the current one
writes the totals, and the service recomputes them from the lines at all three
places that can change a line. Nothing that a person does through the app leaves
them wrong.

**But it is worth one look on the live site**, because the failure mode is
unpleasant: the totals are stored rather than derived, so anything that writes
lines without calling `recalculate` produces a sheet whose footer contradicts
its own rows. Open any salary sheet on live and check the four figures at the
top are not zero.

### Settings — all ten tabs

Each opened in turn and watched for its own fetches. **Ten render, none logs an
error, none returns 4xx or 5xx.** Company & formatting, Categories, Exchange
rate, Salary TDS, Your sign-in, People who can sign in, What changed, Assistant,
Email, Notifications.

### The period statement's twelve tables

All twelve render. Ten of them show an empty-state row — which is not a
separate fault: it is the Reports finding above, the page opening on August
2025, a month with nothing in it.

**One more false alarm.** "What changed" was reported as failing because the
audit log lists an action called **"Failed sign-in"**, and the check matched the
bare word. A screen's content is not a diagnosis of the screen. Both detectors
now match the app's own error sentences.

---

## Where the pass ended

**Nineteen screens, ten settings panels, twelve statement tables, five roles,
and the write path both through the API and through the form.**

Three findings in the application:

1. **Reports opens on a period a year old and empty** — the month is computed
   from today, the fiscal year is taken from the wrong end of a list.
2. **The Tax warning triangle is on every row** — asked to be removed in
   section 7.1, still there, and drawn on every line because none has a stored
   basis.
3. **The salary sheet's Net column sits ~16px left of its heading** — cosmetic.

Nothing else disagreed: not a balance, not a total, not a permission, not a
write. Eight false alarms were raised and chased down, every one of them in the
checking rather than in the app — the wrong figure read from a block, a Unicode
minus, a blank heading, a fan-out join, a sidebar link, a `colSpan` row, a date
shifted by a timezone, and the word "Failed" in a row of the audit log.

That ratio is the honest summary of this pass. The application was right almost
everywhere it was asked; the instruments were not, and each one had to be taken
apart before anything could be reported. The harness knows all eight traps now.

---

## The three findings, fixed

**1. Reports opens on the month it is in.** Two places had to change, which is
why the first fix showed nothing: the page fetched the statement with one year
and the screen then handed the view `years[1]` and re-fetched last year's month
over the top of it. Both take `Math.max(...years)` now — an index is only right
while the order is, and the order of that list is not either file's to know.

Verified on the running page: `fiscalYear=2026&index=2`, August 2026 on screen,
and the statement's tables carrying 8, 3, 5, 4 and 7 rows where they carried an
empty-state line.

**2. The tax warning triangle is off.** It marked a line with no stored basis,
which was every line, and a mark that is on everything marks nothing. The cell
is still a button, its title still says which kind of figure this is, and the
drawer still shows the working where there is one — but the sheet no longer
distinguishes a computed tax from a typed one at a glance. That was the trade
the request came with.

**3. Net lines up.** Built like the Tax cell beside it rather than as a bare
`Amount` dropped into the `td` — every other money column places its figure
through something with its own width and padding, and Net was the exception.

Worth recording how that one ended: two measuring scripts disagreed about
whether the gap was 24px or nothing, and neither could be talked out of its
answer. A column whose alignment two instruments dispute is one to build the
way its neighbours are built, not one to keep arguing about. Both agree now.

**After the fixes**, all twelve screens sweep clean — no console errors, no
failed requests, no sideways scroll, no misaligned heading — and the four CI
steps pass.
