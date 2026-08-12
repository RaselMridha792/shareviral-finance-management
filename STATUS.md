# SFM — where things stand

ShareViral Finance Management. Last updated at the end of **Phase 9** (2026-08-13). All phases built.

## Running it

```bash
npm install          # once
npm run dev          # shared watch + api (:4001) + web (:3000)
```

Open **http://localhost:3000**.

> The database is on **Neon (Singapore)**, so the app needs internet. With no
> connection you can still run `npm run typecheck`, `npm run lint`, `npm test`,
> and `npm run build` — none of those touch the database.

### Sign-in accounts

`npm run db:seed` creates one account per role and **prints the passwords once,
to the terminal**. They are not written down here — this file is in the
repository, and a password in a repository is a password everybody has.

| Role | Email |
| --- | --- |
| Super Admin | superadmin@shareviral.cash |
| CEO | ceo@shareviral.cash |
| Admin | admin@shareviral.cash |
| Finance | finance@shareviral.cash |
| HR | hr@shareviral.cash |

Lost them? Re-run the seed with `--reset-passwords` to issue new ones. These are
scaffolding accounts: replace them with real people before the app holds real
money.

## Demo data — so the screens aren't empty

```bash
npm run db:demo          # load a made-up July–August 2026
npm run db:demo -- wipe  # remove it again
```

Everything it creates is tagged `[demo]` and `wipe` removes exactly that tag —
your own entries are never touched. It loads two accounts, five vendors, six
employees plus a contractor, seventeen transactions, July's payroll paid and
August's left as a draft, one TDS challan, and two assessed tax instalments.

**Wipe it before the first real transaction goes in.** It is scaffolding for
looking around, not a foundation.

## Done

**Phase 0 — foundation.** Drizzle on the standard `pg` driver (works against
Neon today and a self-hosted Postgres later with no code change), Zod validation
throughout, one error shape, request context for the audit trail. Shared package
carries permissions, money handling, fiscal periods, and the Bangladesh deadline
calendar.

**Phase 1 — sign-in and roles.** JWT access token plus an opaque refresh token
that rotates on every use; replaying an old one revokes the whole family. Five
roles with a permission per screen, enforced by the API rather than by hiding
menu items. Audit trail written inside the same transaction as the change it
records. User management for Super Admin.

**Phase 2 — master data.** Accounts with opening balances, a two-level category
tree, vendors with e-TIN/BIN/PSR, and the settings row (financial year, number
format, USD rate, book locking).

**Phase 3 — the ledger.** One `transactions` table behind four views: the
expense record (with sub-category routes), the full transaction list, the bank
register with a running balance, and the dashboard. Transfers create a linked
out+in pair. Rows are voided with a reason, never deleted. Excel download on
every list, amounts as numbers and dates as dates.

**Phase 4 — Excel import.** Upload → map the columns → preview → commit, with
duplicate detection so re-importing the same file flags every row instead of
silently doubling the balances, and one-click revert of a whole batch. The
parser handles `1,25,000`, `(4,500)`, `4500,50`, and Excel date serials, and
refuses to guess direction from an unsigned single column.

**Phase 5 — team and payroll.** Team records with no salary column; compensation
in its own table with history. Payroll runs generate lines, take a typed-in tax
figure per person, finalise (which moves no money), then pay — which writes one
consolidated ledger row for the net only. Contractors stay off the salary sheet.
Payslips freeze designation and bank details at the time of the run.

**Phase 6 — tax.** What was withheld from salaries and vendor bills, month by
month, against what has been deposited. Challans write their own money-out row
to the ledger and link to the deductions they cover, so an auditor asking what a
challan paid for gets names and reference numbers. Quarterly withholding returns
build themselves from the statutory calendar (25 Oct / Jan / Apr / Jul — not the
repealed half-yearly rule). Company income tax: four advance instalments plus the
annual return, with every due date editable because NBR extends Tax Day most
years. The dashboard's pending card carries figures, not just dates.

## Verified

```
typecheck / lint / build     clean across all three workspaces
unit tests                   85 pass
Phase 1 acceptance           15/15  roles, HR 403 from curl, token reuse
Phase 2 acceptance           21/21  category depth, permissions, book lock
Phase 3 acceptance           balance matches to the paisa, voids excluded
Phase 4 acceptance           21 parser tests, re-import flags, revert exact
Phase 5 acceptance           HR payload has zero pay fields, net-only payout
Phase 6 acceptance           44/44  June cliff, challan→ledger, quarterly dates
Page render sweep            every route, as Super Admin, CEO and HR
```

The scripts live in the session scratchpad, not the repo — they are throwaway
checks, not a test suite.

## Next: your data, and the VPS

Exchange rates with a fixed/live switch and a failure policy, the CEO's
USD-denominated view (a translation, always captioned with the rate and date),
the monthly finance report, bank statistics with month-on-month comparison, and
the funding report showing USD sent against BDT landed with the realised rate.

Then Phase 8 (period lock, audit viewer, nginx with self-signed TLS, a tested
backup restore) and Phase 9 (the AI intake, which saves nothing without an
explicit confirmation).

## Still waiting on answers

1. **The category list** — 39 are seeded as a proposal. Which headings are wrong
   or missing for how ShareViral actually spends?
2. **Bank accounts** — you said one for now. Which bank, which account number,
   and what is its balance on the day the records start?
3. **The start date** — you said the 1st of each month. Which month is the
   first? Everything before it becomes the opening balance.
4. **Payroll fields** — bonus, other additions, other deductions and a note are
   built. Is provident fund or a salary advance also needed?
5. **A sample of the current Excel** — so the import column mapping matches it
   rather than being guessed at.
6. **An Anthropic API key** — needed before the Phase 9 assistant can run.

Items 2 and 3 are needed before real data can be entered; 1 is worth fixing
before transactions are filed under the wrong headings.

## Decisions worth remembering

- **One ledger, not two.** Expenses and bank entries are the same table viewed
  differently. Separate tables drift the first time someone edits one.
- **Salary lives in its own table.** HR endpoints never join it, so there is no
  code path from an HR request to a salary figure.
- **Money is `numeric(14,2)` and moves as strings.** Never a float; sums happen
  in SQL.
- **Records are voided, never deleted.** A voided row stays visible, struck
  through, and out of the totals.
- **The app records tax, it does not calculate it.** The accountant supplies the
  numbers.
