# Brief — the month an entry belongs to, and a Bank status page like the boss's sheet

**For:** four Claude sessions, one after another, each its own push. **Piece 1 is a schema
change and travels alone.**
**From:** the planning session, 13 Oct 2026, from the owner's words and three answers.

## Why

The boss keeps the company's books in a Google Sheet, one tab per month. Each tab opens with
a **BANK STATUS** table, one row per bank account:

> Account Name · Opening (BDT) · Opening (USD) · IN (BDT) · IN (USD) · OUT (BDT) · OUT (USD) ·
> Fee (BDT) · Fee (USD) · Closing (BDT) · Closing (USD) · Check · Note

His **May** tab holds money that moved in **June**:
- the funding arrived 9 June;
- the transfers ran on 11 June;
- May's salaries were paid on 12 June.

He closed May's books in June. The app has one date per entry and counts an entry in its
date's month, so the sheet's May lands in the app's June. May reads ৳0 on the Dashboard and
on Accounts.

The owner, 13 Oct: *"may er sheet a boss bank status likhe rakche. tahole amra mayte gele
dashboard a and accounts a sob jaygay 0 keno dekhacche? etato thik na"*.

The owner's answers (AskUserQuestion, 13 Oct):
1. **The table lives under Accounts:** Accounts ▸ Bank status, with a month picker.
2. **A month is the month an entry belongs to**, not the month of its date.
3. **Check is automatic, and Note is typed by hand.**

Two earlier answers also hold here:
- No FX revaluation entries (12 Oct). A month's BDT opening is the previous month's BDT
  closing, even when the dollar rate has moved.
- The sheet's figures are used as they are (12 Oct).

## The model

- **`txn_date` stays the day the money moved.** Everything that is about a day keeps using it:
  - the overdraft rule (no account below zero on any day);
  - the bank statement's day-by-day running balance (`/statement`);
  - matching against the bank's own statement;
  - **TDS, unchanged in this brief.** Ask the owner before moving it.
- **New: `transactions.books_month`**, the first day of a month, **NULL meaning "the month of
  `txn_date`"**.
  - Every existing row stays right with no backfill.
  - Only an entry that belongs to another month carries a value.
- **One expression, written once:** `coalesce(books_month, date_trunc('month', txn_date)::date)`.
  - Put it in a single helper, and have every month view call that helper.
  - It must not be retyped module by module. Ten modules filter transactions by date today,
    and ten copies of a rule is how one of them ends up different.
- **A books month is the date's month or an earlier one.**
  - A later month is refused with a sentence: "An entry cannot belong to a month after the
    one it is dated in."
  - The owner can widen this rule later. Prepayments are the case that would need it.
- **Closed periods:**
  - an entry may not be dated in a closed month;
  - it may not belong to a closed books month;
  - it may not be moved into or out of one.

  `settings.assertPeriodOpen` checks both months.

## Piece 1 — schema, alone

Add `deploy/sql/2026-10-13-books-month.sql`. It must be idempotent, and it must not redefine
anything an earlier file defined.

The file holds four things:

1. **The column.** `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS books_month date;`
2. **A guard.** Add `transactions_books_month_first`, a check that `books_month` is null or the
   first of a month. Add it only if it is missing, using the `pg_constraint` pattern the other
   files use.
3. **`account_month_notes`:**
   - columns: `id`, `account_id` (references `accounts`, on delete cascade), `month` (a date,
     checked to be the first of a month), `note text not null`, `updated_by` (references
     `users`, on delete set null), `updated_at`;
   - `unique (account_id, month)`.
4. **A one-time backfill for payroll rows.** It is idempotent, and harmless on live, which has
   no payroll rows since the reset:

   ```sql
   UPDATE transactions t
      SET books_month = make_date(r.period_year, r.period_month, 1)
     FROM payroll_runs r
    WHERE t.payroll_run_id = r.id
      AND t.books_month IS NULL
      AND date_trunc('month', t.txn_date)::date <> make_date(r.period_year, r.period_month, 1);
   ```

Update the Drizzle schema in the same commit, and add nothing that reads the column. Drizzle
names every column in its SELECT, so the file has to run before code that knows the column.
The deploy guarantees that on live. Locally, run `node .sql.mjs`.

## Piece 2 — writing it

**The API.** Add an optional `booksMonth` (an ISO date on the 1st) to these endpoints:
- the general create;
- cash-in;
- transfer;
- pay-subscription;
- the transaction update;
- the transfer update.

Absent means null, which is the month of the date.

**Rows that take their books month automatically:**
- **Payroll.** `pay` writes every salary row with the run's own period whenever that differs
  from the payment date's month. A May run paid on 12 June is May's, and nobody is asked.
- **Bank-fee rows** made from `chargeAmount` or `chargeUsd` take their parent's books month.
- **A transfer's two halves** always share one books month.

**The forms.** Add an optional **"Belongs to month"** field to:
- Cash In;
- Money Transfer;
- the expense form(s);
- the subscription Renew / Record payment drawer;
- each edit drawer.

The field starts empty. Its hint names the default, for example "June 2026, from the date".

**Also:**
- **The Assistant's map** (`app-map.ts` files) learns the field, so its drafts can carry it.
- **The Excel export** of transactions gains a "Books month" column.
- **All transactions** keeps its date filter. A row whose books month differs from its date
  shows a small "May books" mark.

## Piece 3 — the month views read it

**First, a change to piece 2's rule (the owner, 13 Oct).** A books month may be **later** than
the date's month. The owner's answer to "can a payment made early belong to the next month?" was
*"হ্যাঁ, নিয়ম খুলে দাও"*.

- `storedBooksMonth` (`transactions/books-month.ts`) stops refusing a later month.
- `BOOKS_MONTH_LATER_MESSAGE` goes, together with every test that expected the refusal.
- The `app-map.ts` wording changes too: "Never a later month than the date's" is no longer
  true.
- The cases:
  - two July-tab tool payments that were charged in June;
  - July's salaries paid on 30 June;
  - a subscription paid ahead.
- **Closed periods still apply to both months**, the date's and the books month.

The boss's data on the local database needs exactly this. Two July payments dated 22–23 June
(`import-ledger.json`: `July:tool:63`, `July:tool:80`) were refused "July books".

Every screen that answers "how much in month X" groups by the books month:
- **Dashboard** (`reports/overview.service.ts`): each account's opening, inflow, outflow and
  current figure, and the expense cards;
- **Accounts:** the overview, and an account's own page, wherever a month's figures appear;
- **Expenses:** `transactions/expense-overview.ts` and the category screens;
- **Reports → Statement:** `statement.service.ts`, `reports.service.ts` and `own-dollars.ts`;
- **Vendors:** the per-period figures;
- **the Assistant's look-ups** (`ai-intake/ai-tools.ts`) that total a month.

**Opening balances.** A month's opening is the account's opening balance plus every entry
whose books month is earlier.

**Unchanged, on purpose:**
- the overdraft rule;
- `/statement` (the bank statement);
- reconciliation;
- TDS;
- `fx.service.ts`;
- the date filter on All transactions.

**The shared-code rule applies.** This changes what a month means on several screens. The owner
asked for exactly that ("dashboard a and accounts a sob jaygay"), so list every screen the
helper reaches in the handover.

**Measure, do not read.** Write a harness:
- an entry dated 12 June with books month May counts in May on the Dashboard, Accounts,
  Expenses and Statement, and not in June;
- the overdraft rule still judges it on 12 June;
- an entry with no books month behaves exactly as before.

## Piece 3b — writing a later books month (the owner, 13 Oct)

Piece 3 made the read side ready for a later books month. That includes its fix: July's salary
paid on 30 June now counts in July, not June. Piece 3 did not touch the write side, because it
reaches `packages/shared` and every books-month form. This piece is that, on its own, before
piece 4.

- **`storedBooksMonth`** (`transactions/books-month.ts`) stops refusing a month after the date's
  month. A month equal to the date's month still stores null.
- **`BOOKS_MONTH_LATER_MESSAGE`** leaves `packages/shared`, and so does every test that expected
  the refusal. Rebuild shared (`npm run build:shared`).
- **The forms' month list** also offers the three months after the date's month. The forms are:
  - the expense form;
  - Cash In;
  - Money Transfer;
  - Renew / Record payment;
  - every edit drawer that has the field.

  List these screens in the handover, under the shared-code rule; the owner has already decided
  the change itself.
- **The wording.** The `app-map.ts` files and `BOOKS_MONTH_MEANS` drop "never a later month".
- **Closed periods** still check both months.
- **Measure it.** A harness shows three things:
  - an entry dated 22 June with books month July is accepted;
  - it counts in July on the Dashboard, Accounts, Expenses and Statement;
  - the overdraft rule still judges it on 22 June.

**Then, the data.** These are the two entries the rule held back:
- **Local:** `import-ledger.json`'s `July:tool:63` and `July:tool:80` get `booksMonth` 2026-07-01
  (a PATCH on each id).
- **Live:** the replay's `--fix-later-months` (SESSIONS #160).

After that, every BANK STATUS cell of May–August matches the sheet, rounding aside.

## Piece 4 — Accounts ▸ Bank status

**Where:** `/accounts/bank-status`, under the Accounts accordion in the sidebar. It has a books
month picker, and opens on the current month.

**Rows:** one per active account, plus any archived account that moved money that month. A
totals row closes the table.

**Columns, in the sheet's order:**

| Column | What it holds |
|---|---|
| Account Name | The bank name, as the sheet names the account ("JP Morgan Chase"), with the account's own name small under it ("Exprovia LLC"). |
| Opening | The previous books month's closing. |
| IN | `in` rows, transfers in included. |
| OUT | `out` rows, except those in the **Bank charges** category. |
| Fee | `out` rows in **Bank charges**: the automatic charge rows and the typed ones. |
| Closing | Opening + IN − OUT − Fee. |
| Check | **Matched** when this month is reconciled in the app, otherwise "—". |
| Note | Typed in the row. |

Opening, IN, OUT, Fee and Closing each show BDT and USD.

- **USD comes from each row's own dollars:**
  - `original_amount` when the row states USD;
  - otherwise the taka divided by the row's rate.

  Reuse `own-dollars.ts` or `AccountsService.ownCurrencyBalance`; do not write a third
  version. Opening USD comes from `opening_balance_usd` plus the earlier rows.
- **Check.**
  - Find where reconciliation is recorded: `statements.status = 'reconciled'` or `audited`
    for the period that covers the month.
  - If reconciliation turns out to be per account, use the account's.
  - Check is never typed.
- **Note.**
  - People with `accounts.write` (Super Admin and CFO) edit it in place.
  - It is saved to `account_month_notes`, and the change is audited.
  - Anyone with `accounts.read` can see it.
- **Design.**
  - Build it from the app's table pieces (`TableScroll`, `Th`, `Amount`…).
  - Changing any of them is the ask-first rule.
  - Right-aligned money columns need the specific rule (CLAUDE.md, `text-right` on `thead th`).

## Piece 4b — a revaluation is part of the Opening, as in the sheet

Piece 4 is live as of `ea445cb`. Measured on the local database, which holds the whole import,
every month's Closing matches the sheet. There are two exceptions:
- **Payoneer in June**, which is piece 3b;
- **how a dollar account's revaluation is shown.**

The sheet revalues a dollar account at each month's rate and shows the new figure as that
month's **Opening**, with IN at 0. The app records the same revaluation as an "Exchange gain"
(or "Exchange loss") entry on the 1st (the owner, 13 Oct). The page counts that entry in IN:

| Month | Account | The page | The sheet |
|---|---|---|---|
| June | JPMorgan | Opening 8,49,120, IN 3,132 | Opening 8,52,252, IN 0 |
| July | Payoneer | IN 525 | IN 0 |

What to change:
- **The fold.** On Accounts ▸ Bank status only, rows in the **Exchange gain** and **Exchange
  loss** categories join that month's Opening: previous Closing + gain − loss. They leave IN and
  OUT.
- **The Closing does not move.**
- **A hint on the Opening** (or the cell) says it includes the month's revaluation. Otherwise an
  Opening that differs from last month's Closing reads as a fault.
- **The dollar columns** fold the same way.
- **Other screens are unchanged.**

**Measure it** on a copy that has the import: June JPMorgan reads Opening 8,52,252 with IN 0.
Every month's Closing is unchanged.

## Piece 4c — a revaluation is worth $0

Piece 4b (`bd04ef6`, #166) found this. The sheet revalues a dollar account in taka only, so its
dollars do not move: June opens JPMorgan at **$6,960**. The app turns the "Exchange gain" row
into dollars at the row's rate, so it shows **$6,985.58**. The +$25.58 is ৳3,132 ÷ 122.45.
Payoneer's July gain adds a few dollars the same way. These figures reach Accounts' own dollar
balance too.

**The owner said yes on 13 Oct** (*"hea korbo kore felo"*):
- **The rule.** A row in the **Exchange gain** or **Exchange loss** category counts **$0** in
  every dollar figure:
  - the dollar balance on Accounts;
  - the dollar columns on Bank status and the Dashboard;
  - `own-dollars.ts`.

  Its taka is unchanged.
- **Where the rule lives.** It sits in the one place the per-row dollar figure is worked out
  (moved into a function by piece 4), not in each screen.
- **The shared-code rule applies.** List every screen whose dollars move.

**Measure it.** Write a harness:
- June JPMorgan opens at **$6,960.00** on Bank status;
- Accounts' dollar balance for JPMorgan is the same before and after, apart from the
  revaluation rows;
- every taka figure is unchanged.

## Piece 4d — Check can be ticked by hand (the owner, 13 Oct)

The owner: *"bank status a manual check marked manually o kora jabe"*.

The rule today (piece 4) is that Check reads **Matched** only when the month's statement is
reconciled in Reports. That record is for the whole company, so every row agrees. The owner
also wants a tick per row, by hand, the way the sheet's Check column is filled in.

- **The rule.** Check is **Matched** when either of these holds:
  - **this account and this month** are ticked by hand;
  - the month is reconciled.

  The cell says which one. A hand tick shows who ticked it and when, for example on hover.
- **Who.**
  - People with `accounts.write` (Super Admin and CFO) can tick and untick. It is the same gate
    as Note.
  - Everyone with `accounts.read` sees the tick.
  - Both ticking and unticking are audited.
- **Unticking** removes the hand tick only. A reconciled month still reads Matched.

### 4d-1, schema alone

Add `deploy/sql/2026-10-13-bank-status-checks.sql`. It must be idempotent.

- **A table of its own**, `account_month_checks`:
  - `account_id` references `accounts`, on delete cascade;
  - `month` is a date, checked to be the 1st of a month;
  - `checked_by` references `users`, on delete set null;
  - `checked_at timestamptz not null default now()`;
  - `unique (account_id, month)`.
- **Why not a column on `account_month_notes`:** there `note` is not null, and a row is gone
  when its note is cleared. Either a tick would need a note to exist, or clearing a note would
  untick the row.

Update the Drizzle schema in the same commit, and add nothing that reads it. Run `node .sql.mjs`
locally, and push it alone.

### 4d-2, the page

- **The service.** It reads the table, writes it with `PUT /accounts/bank-status/check` (body:
  `{ accountId, month, checked }`), and deletes the row on untick.
- **The page.** The Check cell gets a tick control for writers. Readers see the result only.

**Measure it** with a harness:
- tick, then reload, and the row still reads Matched by hand;
- untick, and it no longer does;
- a reconciled month still reads Matched with no tick;
- a reader cannot tick (403);
- the audit holds both changes.

## The data step, after pieces 1–4 are on the local database

The owner is importing the boss's sheet a month at a time. The May tab is already in the local
database, and the comparison against the sheet is SESSIONS #160.

1. **Set the books month to May 2026 on the May-tab entries that are dated in June:**
   - the funding (9 June) and its fee;
   - JPMorgan → Bank Asia (11 June);
   - Bank Asia → Payoneer (11 June);
   - the two Claude payments (11 June);
   - the ৳120 payroll transfer fee (12 June).

   The salary rows get May from the backfill in piece 1.
2. **Open Bank status for May.** It should read exactly the sheet's May table, apart from two
   things:
   - rounding: the app keeps two decimals, the sheet keeps four;
   - the Payoneer ৳0.32 that #160 explains.

   The expected figures:

   | Account | IN | OUT | Fee | Closing |
   |---|---|---|---|---|
   | JPMorgan | 17,08,000 | 8,54,000 | 4,880 | 8,49,120 |
   | Bank Asia | 8,54,000 | 5,17,535.90 | 120 | 3,36,344.10 |
   | Standard Chartered | 0 | 0 | 0 | 0 |
   | Payoneer | 26,277.90 | 26,277.58 | 0 | 0.32 |

3. **The owner checks it**, and only then does anything go to live.

## Not in this brief

- TDS by books month.
- The June tab of the import, which continues after this.
