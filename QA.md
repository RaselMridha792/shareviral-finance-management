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
