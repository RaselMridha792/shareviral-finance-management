# SFM — where things stand

ShareViral Finance Management. All phases built, deployed and audited end to end; last updated
**2026-08-14**, after a full end-to-end audit and the changes asked for from using the live
app.

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

**Phase 7 — money in dollars, and reports.** A rate per day, so a July report
stays translatable at July's rate long after July. Period reports at month,
quarter, half or full year with the one before it beside them; month-by-month
bank statistics; and the funding report — the one place USD is a fact rather
than a translation, showing what the CEO sent against what the bank landed and
the rate that transfer really achieved. Every translated figure carries the rate
and date that produced it. When no rate exists the figures come back as taka,
labelled taka.

**Phase 8 — closing, watching, and running it yourself.** Closing the books
through a date, after which nothing on or before it can be changed by anyone.
The audit viewer: every change with who made it and what it was before, filtered
by date, action, area or person — with pay figures hidden from a reader who may
not see them, though never the fact that the change happened. A Docker stack,
nginx config and backup/restore scripts for the VPS.

**Phase 9 — the assistant.** Describe an entry in Bangla or English; it asks for
whatever is missing, one question at a time, then fills in an ordinary editable
form. It holds no tools and cannot write. Saving posts to the same endpoint the
manual form posts to, so permissions, validation and the audit trail apply
identically.

Switched on from **Settings → Assistant**: a Super Admin pastes an Anthropic
key and the screen becomes available, with no redeploy. The key is checked
against Anthropic before it is saved, sealed with AES-256-GCM before it is
stored, kept out of the audit trail, and never returned to a browser — the
panel shows only its last four characters.

**After Phase 9 — what the owner asked for once it was in their hands.** The
things below came from using the app, not from the plan.

The **dashboard** is three blocks: what the bank holds, what the card holds,
what was spent — opening, in, out, closing, and the four read as a sentence
that ties. It had a trend chart, a category donut, a deadline card, a vendor
ranking, an account list and a recent-entries feed under those; each restated
something a dedicated screen already showed properly, and they were cut. The
period is picked as a month and a year, opening on the latest month. Every taka
figure carries an approximate dollar beneath it, at the rate that month's
funding arrived at.

**Income tax left the interface.** TDS is where this company's tax work
actually happens and a second tax screen beside it was noise. The records and
the `/api/income-tax/*` endpoints are untouched — instalments already assessed
are real payments against a real liability. See the note at the top of
`income-tax.service.ts` before assuming that module is dead.

**Cash-In** records money arriving, and asks what was sent in dollars. Given,
the row reaches the funding report with the rate it really achieved; left
blank, it is an ordinary local receipt. The form shows the division back as it
is typed, because a digit too many is obvious there and nearly invisible in a
report next quarter.

**The month's rate has one implementation.** The Cash-In screen used to
recompute it from the rows it had loaded; it asks the API now. One rule decides
every dollar figure in the app.

**The employee profile is the company's own sheet** and nothing more —
nineteen columns, with age worked out from date of birth rather than stored.
The bank, e-TIN and PSR fields stay on top of it because payroll and
withholding cannot run without them. Thirteen fields this app had invented are
rejected by the schema, not merely hidden. The columns remain in the database:
rows written before that decision keep their values. The Team download returns
that whole sheet, joining salary included.

**Payslips are reachable from the person**, newest first, drafts excluded —
not only by remembering which run a month belonged to.

**PDFs print ৳.** PDFKit's built-in faces are Latin-1, so reports had been
going out with no currency symbol and a hyphen for a minus. Noto Sans Bengali
is embedded, subset to 73KB, under the SIL OFL. If the font is ever missing the
service logs and falls back rather than printing mojibake.

**Two N+1s are gone.** The funding report asked for an exchange rate once per
remittance and TDS liability ran thirty-six queries to render a year; both are
flat at three now, with the output proved identical beforehand and after.

## The end-to-end audit (2026-08-14)

Five independent sweeps, each required to show its evidence and to say
UNTESTED rather than claim a pass it had not observed.

```
Endpoints        119 routes · 661 requests · 5 roles
                 no missing 401, no missing 403, no 500s
                 token forgery held on all six vectors — the guard reads the
                 role from the database and ignores the claim
Calculations     the books never broke: ~90 tie assertions after 21 money
                 mutations, all green — register, balances, dashboard groups,
                 TDS liability
CRUD             every entity created, read, updated, voided, archived,
                 restored; concurrency repeats all refused cleanly
Exports          14 exports · amounts are numeric cells · dates carry no
                 off-by-one · PDFs render ৳ from the built output
AI intake        no write tools · 5 of 5 intents land in the right table ·
                 nothing saves without confirmation · chats are private
Screens          every route in 3 roles · 223 of 226 money strings on screen
                 exactly derivable from that screen's API payload
```

**Twenty-one defects were found and fixed.** The ones worth remembering:

- **A PATCH wrote fields nobody sent.** `createSchema.partial()` keeps its
  defaults, so an absent key arrived with a value. Renaming an account zeroed
  its opening balance; marking a contractor resigned turned them into an
  employee; editing a vendor reset a USD subscription to BDT. `patchOf()`
  strips the defaults.
- **`?includeVoided=false` meant true.** `Boolean("false")` is `true`, so
  voided money re-entered the totals — and the same schema drives the Excel
  export.
- **The statement PDF dropped accounts.** It printed the first ledger plus one
  card, so with three accounts the main bank account — and eight of the
  period's nine entries — never appeared in the document that goes to an
  auditor.
- **HR could read the company's position**, payroll total included, through
  Reports. `reports.view` is no longer HR's.
- **One taka figure had four different dollar answers** across the dashboard,
  Reports and the statement. All three resolve through `governingRateFor` now
  and name which rate won.
- **Dollars were grouped in lakhs** — `$1,87,083`, which is not a dollar
  amount in any locale.
- **Two screens double-counted ৳39,975**, and the first attempt to fix it made
  things worse: `NOT (UNKNOWN)` is `UNKNOWN`, so every row without a vendor
  silently vanished. Only an assertion that refused to pass on an empty set
  caught it.

## Verified

```
typecheck / lint / build     clean across all three workspaces
unit tests                   154 pass
Phase 1 acceptance           15/15  roles, HR 403 from curl, token reuse
Phase 2 acceptance           21/21  category depth, permissions, book lock
Phase 3 acceptance           balance matches to the paisa, voids excluded
Phase 4 acceptance           21 parser tests, re-import flags, revert exact
Phase 5 acceptance           HR payload has zero pay fields, net-only payout
Phase 6 acceptance           44/44  June cliff, challan→ledger, quarterly dates
Phase 7 acceptance           period/bank/funding figures, USD never mislabelled
Phase 8 acceptance           audit redaction, book lock, restore refuses live db
User management              17/17  HR cannot self-promote, reset kills sessions
Live site                    24/24  cookies, roles, CSRF, token renewal
Assistant key                15/15  Super-Admin-only, sealed, never returned
Responsive                   measured at 360/390/768/1440 — no page scrolls
                             sideways, no short cell wraps
Production audit             71 claims across 5 lenses, 25 confirmed, all fixed
Page render sweep            every route, as Super Admin, CEO and HR
```

## The test suite (2026-08-14)

The checks above were throwaway scripts in a scratchpad. The ones worth keeping
now live in the repo and run on command:

```
npm test                 154 unit tests — money, periods, deadlines, dates,
                         permissions, subscriptions
npm run test:integration 262 checks across 9 suites, against the real database
npm run test:browser     20 checks — 14 screens × 4 widths × 2 themes
npm run test:all         all three, in that order
```

`test:integration` boots the API itself on a port the operating system says is
free, signs in as each of the five roles, and runs:

| suite | what it holds the app to |
|---|---|
| 01 money tie | the register equals the bank to the paisa |
| 02 ledger, payroll, audit | before/after on every money write |
| 03 permissions | 113 checks — every role against every endpoint |
| 04 exports | a download is exactly the filtered view |
| 05 FX | one rate governs every screen |
| 06 periods | both financial years, and 30 June / 1 July between them |
| 07 auth | rotation, reuse detection, role change, lockout |
| 08 payroll, tax, import | paying a run, TDS arithmetic, import and revert |
| 09 reopen | voiding a payment lets the run be paid again |

Between suites the runner puts the demo books back and **fails the run if a
suite changed them**. That is not politeness: suite 08 once left August's run
paid and its ৳3,95,000 out of petty cash, and the next suite quietly reported
nothing instead of failing, because it could no longer find a draft run. A
suite that leaves money moved will lie to the one after it.

`test:browser` needs a Chrome or Edge on the machine (`CHROME_PATH` if it is
somewhere unusual). It boots the API and the web app, signs in through the real
login form, and looks for the specific ways a finance screen goes wrong: a
table that escapes its container, text that cannot be read against what is
behind it, taka grouped in thousands, a hyphen where a minus belongs, a
translated dollar figure with no rate beside it.

Neither suite writes anything permanent. Both make their own throwaway accounts
rather than touching the demo logins, and remove them in a `finally` so an
interrupted run leaves nothing behind.

### Five bugs the suites found

1. **Reopen told you to do something that did not work.** A paid payroll run
   refused to reopen and said "void those ledger entries first" — and voiding
   them changed nothing, because the guard read the run's status, not the
   ledger. Anyone following the instruction to the letter had no way forward
   but the database.
2. **A reopened run could never be paid again.** Reopening moved the status
   back to draft and left every line flagged paid, so `pay` counted the unpaid
   lines, found none, and refused. Correcting a mistaken payment was impossible
   from the screen. The sibling of the first, found because a test's cleanup
   stopped working once the first was fixed.
3. **A report for quarter 9 answered with quarter 4.** One `index` field serves
   months and quarters, so its own maximum could not tell them apart, and the
   service closed the gap by clamping. The label was honest, but a finance
   report should not hand back a figure nobody asked for.
4. **An axis label with no number took the chart down.** `formatCompactMoney`
   guarded against a value it could not read and then handed that value to
   `formatMoney`, which throws on exactly those values.
5. **Dark mode's purple was below the contrast floor both ways.** White on it
   4.36:1, and it as type on a card 4.08:1 — every primary button and every
   purple label just under legible. One value could not fix both, so the fill
   went deeper and the type lighter.

And one found while writing the tests rather than by running them: the **login
form had no `method`**, which makes it a GET form. Submitted before React
hydrates — a slow connection, Enter pressed early — the browser navigated to
`/login?email=…&password=…`, writing the password into the address bar, into
history, and into the access log of anything in front of the app. It now posts.

## One deployment step, if production is a different database

`ai_corrections` — the table the assistant learns from — was created by hand on
the Neon database this repo's `.env` points at, not by a migration. If the
Render deployment reads a *different* database, run this once against it:

```sql
create table if not exists ai_corrections (
  id uuid primary key default gen_random_uuid(),
  target varchar(32) not null,
  said text not null,
  field varchar(64) not null,
  drafted text,
  corrected text,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_corrections_target_idx
  on ai_corrections (target, created_at);
```

Nothing breaks without it: the read is wrapped so a missing table logs a
warning and the assistant carries on with no past examples. It simply will not
learn until the table exists.

## Next: your data

Every phase is built and deployed. What is left is not code:

1. Replace the seeded accounts with real people (**Settings → People who can
   sign in**), then disable the seeded ones.
2. Wipe the demo data: `npm run db:demo -- wipe`.
3. Enter the real bank account and its opening balance on the day the records
   start.
4. Fix the category list to match how ShareViral actually spends.
5. Import or type the first month, and check the register's closing balance
   against the bank statement to the paisa.

Then, when you want off Vercel and Render, `DEPLOYMENT.md` has the VPS move.

## Four decisions the audit surfaced

1. **`mustChangePassword` does nothing.** It is stored, selected and echoed by
   `/auth/me`, and no guard consults it. All five seeded accounts carry it and
   can use every endpoint their role permits. Enforcing it would bounce
   everyone — the CEO included — to a change-password screen on their next
   request, so it is left as it is until you say otherwise. The alternative is
   to drop the flag, so it stops implying a protection that is not there.
2. **`admin` does not hold `audit.read`.** Only Super Admin and CEO can read
   the audit log, while admin is otherwise the full operational role. It
   matches the matrix as written; flagged in case it was not intended.
3. **A vendor named `150000.00` is live**, created before the free-text box was
   removed, from an amount typed into the wrong field. It is offered to the
   assistant as a real supplier in every prompt. You said you would clear it
   yourself once testing was done.
4. **The stored Anthropic key cannot be decrypted.** `SECRET_ENCRYPTION_KEY` is
   unset, so `secret-box` fell back to `JWT_REFRESH_SECRET`, which has since
   changed — the ciphertext is orphaned and the app reports "no key has been
   set". Re-entering it in Settings fixes it. Set `SECRET_ENCRYPTION_KEY` so
   rotating a JWT secret cannot orphan it again.

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
6. **An Anthropic API key** — paste it into Settings → Assistant to switch the
   assistant on. Everything else works without it.

Items 2 and 3 are needed before real data can be entered; 1 is worth fixing
before transactions are filed under the wrong headings.

## Decisions worth remembering

- **One ledger, not two.** Expenses and bank entries are the same table viewed
  differently. Separate tables drift the first time someone edits one.
- **Salary lives in its own table.** HR endpoints never join it, so there is no
  code path from an HR request to *current* pay — no raise, no payroll figure,
  no history.
- **The one exception, confirmed on 14 Aug 2026: HR sees the joining salary.**
  It is the figure from the offer letter, frozen on the day somebody joined,
  and it is HR's own paperwork. It appears on the team record, on the team
  screen and in the team export, deliberately. An earlier note in this file
  said the HR export carries no salary column at all; that was the plan before
  the exception was decided, and this is the version that holds. Anything about
  what a person is paid *now* stays behind `team.compensation.read`, which HR
  does not have.
- **Money is `numeric(14,2)` and moves as strings.** Never a float; sums happen
  in SQL.
- **Records are voided, never deleted.** A voided row stays visible, struck
  through, and out of the totals.
- **The app records tax, it does not calculate it.** The accountant supplies the
  numbers.
