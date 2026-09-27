# SFM — where things stand

> **Last updated 27 Sep 2026**, after the September 2026 redesign (SESSIONS.md #79–#95). This
> file is the state of the app as a whole: what it does, how it is put together, how to run it.
> [SESSIONS.md](SESSIONS.md) is the story — every change, newest first, with what it broke and
> what proved it. Read that for why; read this for what is true now.

ShareViral Finance Management, live at **app.hellonizam.com** / **api.hellonizam.com** and in
daily use with the company's own books. All nine phases are built and deployed. Since then the
app has been reshaped screen by screen from the owner's use of it, and on 27 Sep every screen
moved to the owner's September 2026 design handoff.

## Running it

```bash
npm install          # once
npm run dev          # shared watch + api (:4001) + web (:3000)
```

Open **http://localhost:3000**.

> Locally the database is on **Neon (Singapore)** — `apps/api/.env` points there — so the app
> needs internet. With no connection you can still run `npm run build:shared`,
> `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` — none of those touch the
> database.
>
> **Neon is not the live database.** Production is the `db` container on the VPS (see *Live*).
> Seeding or migrating from a laptop changes nothing on the live site.

A new file in `deploy/sql` reaches Neon with `node .apply1.mjs <file>`; `node .sql.mjs` replays
the whole directory in filename order and reports what it skips. The deploy does neither: it runs
each file once on the live database and records it (see *Live*).

### Sign-in accounts

`npm run db:seed` creates the first Super Admin and one test account for each other role, and
**prints the passwords once, to the terminal**. They are not written down here — this file is in
the repository, and a password in a repository is a password everybody has.

| Role | Email |
| --- | --- |
| Super Admin | superadmin@shareviral.cash |
| CEO | ceo@shareviral.cash |
| HR | hr@shareviral.cash |
| CFO | cfo@shareviral.cash |

`SEED_EMAIL` overrides the Super Admin's address, and `SEED_TEST_ROLES=false` skips the other
three. Lost them? Re-run the seed with `--reset-passwords` to issue new ones. These are
scaffolding for a local database; the live site's sign-ins are real people, managed in
**Settings → People who can sign in**.

Four roles since 5 Sep 2026 — Admin and Finance were retired. See *Roles* below.

## Demo data — so the screens aren't empty

```bash
npm run db:demo          # load a made-up July–August 2026
npm run db:demo -- wipe  # remove it again
```

Everything it creates is tagged `[demo]` and `wipe` removes exactly that tag —
your own entries are never touched. It loads two accounts, five vendors, six
employees plus a contractor, seventeen transactions, July's payroll paid and
August's left as a draft, one TDS challan, and two assessed tax instalments.

```bash
npm run db:bulk -- reset # a hundred of everything, on two accounts
npm run db:bulk -- dry   # build every row, write none — check the counts
npm run db:bulk -- wipe  # clear it and stop
```

The bulk seeder is for checking what the demo cannot: a second page, a filter, a total with
something to be wrong about. It creates no sign-ins and never writes `users`, their second
factor, `app_settings` or `schema_migrations`.

**Wipe either before the first real transaction goes in.** They are scaffolding
for looking around, not a foundation.

> **The live database carries neither.** The bulk data was loaded into it on 2026-08-20 to test
> paging and filters, and on 2026-08-26 `deploy/clean-for-production.sh` emptied 28 tables and
> kept five: the sign-ins with their second factor and recovery codes, the `app_settings` row
> with every credential cleared, and `schema_migrations` — emptying that would make the next
> deploy replay a directory that is not order-independent. It was handed over for real figures
> that day.
>
> The payroll test suites build their own run, and have since the demo people were removed on
> 2026-08-14: they used to borrow the demo's draft, and with it gone they reported "no draft run
> to take through" and *passed*.

## Done

**Phase 0 — foundation.** Drizzle on the standard `pg` driver (works against
Neon and the self-hosted Postgres with no code change), Zod validation
throughout, one error shape, request context for the audit trail. Shared package
carries permissions, money handling, fiscal periods, and the Bangladesh deadline
calendar.

**Phase 1 — sign-in and roles.** JWT access token plus an opaque refresh token
that rotates on every use; replaying an old one revokes the whole family. Roles
with a permission per screen — five then, four since 2026-09-05 — enforced by
the API rather than by hiding menu items. Audit trail written inside the same
transaction as the change it records. User management for Super Admin.

**Phase 2 — master data.** Accounts with opening balances, a two-level category
tree, vendors with e-TIN/BIN/PSR, and the settings row (financial year, number
format, book locking). The USD rate it also held is gone (see *Rates*), and the
Suppliers screen came off on 2026-08-19; the `vendors` table and API remain.

**Phase 3 — the ledger.** One `transactions` table behind four views: the
expense record (with sub-category routes), the full transaction list, the bank
register with a running balance, and the dashboard. Transfers create a linked
out+in pair. Rows are voided with a reason and, since 2026-08-27, can be moved to
a trash — never erased on the spot (see *The trash*). Excel downloads, amounts
as numbers and dates as dates, now live on Import and Export rather than on
every list; Reports keeps its own.

**Phase 4 — Excel import.** Upload → map the columns → preview → commit, with
duplicate detection so re-importing the same file flags every row instead of
silently doubling the balances, and one-click revert of a whole batch. The
parser handles `1,25,000`, `(4,500)`, `4500,50`, and Excel date serials, and
refuses to guess direction from an unsigned single column. It is the Import tab
of `/data` since 2026-08-21, and a file states one USD rate at the mapping step.

**Phase 5 — team and payroll.** Team records with no salary column;
compensation in its own table with history. Payroll runs generate lines, work
out each person's tax from the income year's rule (a typed figure can replace
it), finalise (which locks the figures and moves no money), then pay — which
writes the net to the ledger. Contractors stay off the salary sheet. Payslips
freeze designation and bank details at the time of the run.

**Phase 6 — tax.** What was withheld from salaries and vendor bills, month by
month, against what has been deposited. Challans wrote their own money-out row
to the ledger and linked to the deductions they cover; since 2026-08-21 the TDS
screen records the challan number and scan on each person's payroll line
instead (see *TDS*), and `tds_deposits` keeps its rows with no screen.
Quarterly withholding returns build themselves from the statutory calendar
(25 Oct / Jan / Apr / Jul — not the repealed half-yearly rule). Company income
tax: four advance instalments plus the annual return, with every due date
editable because NBR extends Tax Day most years.

**Phase 7 — money in dollars, and reports.** Built as a rate per day, period
reports with the one before them beside them, month-by-month bank statistics,
and the funding report. Since reshaped twice: there is no governing rate any
more — every entry carries its own (see *Rates*) — and Reports is now the
period's finance statement, with the bank statement beside it (see *Done:
Statement is really Reports*).

**Phase 8 — closing, watching, and running it yourself.** Closing the books
through a date, after which nothing on or before it can be created or edited —
voiding is the one exception, on the owner's decision of 31 Aug (see *The
closed-books lock*). The audit viewer: every change with who made it and what it
was before, filtered by date, action, area or person — with pay figures hidden
from a reader who may not see them, though never the fact that the change
happened. A Docker stack, nginx config and backup/restore scripts for the VPS.

**Phase 9 — the assistant.** Describe an entry in Bangla or English; it asks for
whatever is missing, one question at a time, then fills in an ordinary editable
form. It holds no tools and cannot write. Saving posts to the same endpoint the
manual form posts to, so permissions, validation and the audit trail apply
identically. It never supplies a USD rate: that is always asked for.

Switched on from **Settings → Assistant**: a Super Admin pastes an Anthropic
key and the screen becomes available, with no redeploy. The key is checked
against Anthropic before it is saved, sealed with AES-256-GCM before it is
stored, kept out of the audit trail, and never returned to a browser — the
panel shows only its last four characters.

## After Phase 9 — what the owner asked for once it was in their hands

The things below came from using the app, not from the plan. SESSIONS.md tells each change's
story from 20 Aug on; before that, the git log does.

### Roles

Four since 2026-09-05, in `packages/shared/src/permissions.ts`:

| Role | What it holds |
|---|---|
| Super Admin | everything, and alone holds `settings.write` and `users.manage` |
| CEO | reads everything — money and the audit log included — and writes nothing |
| CFO | all of operations: the ledger, accounts, payroll including paying it, tax, imports, the audit log. Not settings, not users |
| HR | the team and their pay (`team.compensation.*`), the salary sheet to read, subscriptions to read. Not the ledger, not Reports, and cannot change or release payroll |

Admin and CFO were the same array and Finance was that minus master data, so retiring them
removed two names, not a capability; everybody on them was moved to CFO first
(`2026-09-05-retire-admin-finance-roles.sql`). The Postgres enum keeps all six values
(`STORED_ROLES`), `ROLES` is the four that can be handed out, audit rows keep the role held at
the time, and a row on a retired role **fails closed** rather than throwing. The JWT guard reads
the role from the database on every request, so a change takes effect on the next click.

**A reader is offered nothing to write with.** Write controls are hidden without the
permission, and `RowActions` renders nothing without a handler — `disabled` now means only "not
for this row". `.rolesweep.mjs` signs in as all four roles, walks every screen and fails on a
write control offered to a reader. Two deliberate exceptions: the dashboard's Edit and Add,
which only arrange this browser's own view. A role typing a URL it lacks still reaches a page
shell and a 403 from the API; a proper refusal page is not built.

### Rates: none for the whole app, one on every entry

On the owner's word (31 Aug) there is no USD rate for the whole app. The Settings exchange-rate
tab, its rate history, the top bar's FX chip and the page-foot rate caption are all gone, and
Reports no longer converts a period at a governing rate — an entry or balance with no rate of its
own shows no dollar figure rather than an invented one.

Since 4 Sep no ledger row is written without a rate. Every write path requires one: the
transaction form (its bank charge inherits it), Cash In, Money Transfer (both halves), a
subscription payment, paying a payroll run, a TDS challan that names an account, an income tax
payment, and a statement import (one rate for the file). The assistant must ask for it rather
than supply it.

What remains of `fx_rates` is a fallback. A row with neither its dollars nor a rate — one written
before that — is read at the rate in force on its own day. The newest rate on file still feeds
`RateProvider`, which `Amount` uses for the `~`-marked counterpart it draws under a figure (off
wherever a screen draws both currencies itself), and `GET /fx/governing` still feeds the Accounts
overview. No screen writes a rate to that table any more.

### Money rules that hold everywhere

- **A bank charge is its own row.** Every kind of entry can carry one — the transaction form and
  every screen that opens it, Cash In, Money Transfer, a subscription renewal. It is a separate
  money-out row under Bank charges, linked by `transactions.charge_for_id`, so the heading keeps
  its own figure and a year's charges are one figure. It follows its parent: edited with it,
  moved to its date, voided, trashed and restored with it; clearing the box removes it; a charge
  cannot itself be charged. On money arriving it is still an out row; on a transfer it lands on
  the account the money left.
- **An account never goes below zero.** `apps/api/src/common/money/overdraft.ts`, asserted inside
  the transaction at every door money moves through — create, edit, void, transfer, import commit
  and revert, payroll pay, company-tax pay, TDS challan, trash delete and restore, an account's
  opening balance — against the lowest historical day and the present balance. **Anything new
  that writes transactions calls `overdraftWatch` before and `watch.assert(tx)` after**;
  `.overdraftqa.mjs` catches a missed one. Two concurrent writers on one account can still
  jointly overdraw at read-committed — documented and accepted for a team this size.
- **A transfer between our own accounts is not spending.** `transactions/own-money.ts` —
  `notATransfer()` — keeps both halves out of company money in and out and off the expense
  screens, and deliberately not out of the register, the statement, the per-account blocks, All
  transactions, the balances or the overdraft rule. The file lists where it must not be applied.

### The trash

Every table that holds a row somebody typed can delete it, singly or ticked in bulk
(`POST /trash/:kind/bulk`, all or nothing), into **Settings → Trashed**. The kinds, and the
permission each needs, are in `apps/api/src/modules/trash/trash.registry.ts`.

- **Deleting a money row also voids it**, so nothing deleted enters a total even if a list
  filter is missed.
- Restore brings back what went with a row — a transfer's other half, a heading's
  sub-categories, a bank charge. Purge and Empty-the-trash are the only permanent deletes; a
  purge the database's foreign keys refuse answers with a sentence.
- **The words match the act.** Trashing asks for the typed word `trash`; a permanent delete asks
  for `delete`.
- Business-data guards are gone on the owner's decision: an account, category, person or paid
  payroll run deletes whatever points at it. A deleted run never takes its ledger rows with it.
  **One guard stays — the last active Super Admin**, asserted after the write and inside the
  transaction on every path (`common/auth/last-super-admin.ts`), because ticking two together
  once went round the old per-row check and would have locked everybody out.
- The audit log, payslips, TDS allocations and import rows are not deletable. Nothing empties the
  trash on a schedule.

### The dashboard

A greeting card: the day, "Overview, <name>", chips for the accounts on screen, the people on
payroll and — for the current month only — the plans renewing this month, the month and year, and
**Total held**, the accounts' closings added in paisa. Then one block per account — opening, in,
out, current, with `opening + in − out = current` on every one — in an order the reader sets with
Edit (drag or arrows, kept in this browser; the default is bank, wallet, cash, card). Then the
expense cards the reader has chosen. The period is picked as a month and a year, opening on the
latest month. HR gets the greeting and an empty state, and no money.

### Accounts, Cash In and Money Transfer

**Accounts overview** is a card per account — the balance large in the account's primary
currency with the other under it, a lime **Total held** band added in paisa, and a month
dropdown that reads every figure as at that month's last day (an account opened later holds
nothing before it). **Primary currency** (BDT or USD) decides which figure leads and which box a
form asks for first. It does not denominate anything: every stored amount is taka. A USD-primary
account's balance is the **sum of its own dollars**, from an opening stated in dollars, each row
read from its stated dollars, else its own rate, else the rate on its day — and marked
approximate wherever a row had to be translated.

A card account holds the holder, number, expiry and CVC. The number and CVC are sealed with the
same `secret-box` as the assistant key and kept out of the list projection, the exports and the
audit rows; revealing them needs a role that writes accounts **and** the shared card password set
in **Settings → Your sign-in**. `card_last4` stays plain, to tell cards apart.

An account's page (`/accounts/[id]`) shows every field the account holds. Its register
(`/accounts/[id]/register`) is newest first, twenty to a page with the serial counting across
pages, a running balance, and nothing typed on it.

**Cash In** records money arriving. The account comes first, because it decides the order: the
account's own currency is typed, then the rate, then the other currency — worked out and locked —
then a bank charge. Any two of taka, dollars and rate decide the third, so exactly one is derived;
three free boxes is how a row in the owner's own sheet (INV-002) came to disagree with itself by
৳27,612.64. A tick, *"Money from inside the country — no dollars were sent"*, keeps a local
receipt from being counted as foreign funding. No category; Invoice and Reference are attached
papers rather than typed numbers, and neither is required. The screen shows one month, chosen
from a list beside Add cash, and adds its totals in paisa.

**Money Transfer** (`/transfers`, in the Accounts group) lists one row per pair — from, to, one
amount. A transfer is recorded through its form, voided or trashed as a pair, and never edited:
editing half a pair would leave the two accounts disagreeing, so it is void and record again.

### Expenses and subscriptions

- **Expense overview** (`/expenses/overview`) cuts the month into four slices that add to its
  spend, and writes the sum out underneath: **Salary** (the ledger's payroll rows), **AI tools
  and subscriptions**, **Office rent** (the sub-category, matched by slug), and **Operational** —
  everything else, including money filed under no heading. **Tax withheld** sits outside the sum,
  as held rather than spent. Transfers and voided rows count nowhere.
- **Operational expenses** (`/expenses`) is the heading grid, a card per heading. Which headings
  show is chosen per browser, including ones with nothing spent yet. A heading's page
  (`/expenses/<slug>`) filters by sub-category tab and pages twenty at a time.
- **Other expenses** (`/expenses/other`) is off the rail; its route still answers.
- Their month dropdown lists every month back to `RECORDS_START` (May 2026), newest first.
- **AI tools and subscriptions** (`/subscriptions`) — see *Done: AI tools and subscriptions*.

### All transactions

Every ledger row: SL, Date, Description, Amount (taka, dollars small under it), USD rate, Account,
Invoice and Reference — each a link or an eye over the attached paper, N/A with none — and the
row actions. The whole row is tinted, green for money in and red for out, and a link inside it
takes the row's colour and is told apart by its underline; the owner asked for the tint and it
stayed through the redesign. A tick column and bulk trash. No Category column (it still filters),
no Entry No. column (the app's own `TXN-…` number is on the bank statement, every export and the
documents drawer), and no Add button — an entry is recorded on the screen it belongs to. The same
table serves the heading pages and an account's register.

### Team

Current and Past tabs with a search, ordered by employee ID (optional, and unique among live
people only — a deleted person stops holding theirs). **Employment type** — Onsite, Remote,
Hybrid, Contractual — sits beside the engagement type, which is the payroll question and is not
changed by it.

**The employee profile is the company's own sheet** — nineteen columns, with age worked out from
date of birth rather than stored — and has since grown the cards the owner asked for: bank
details (account holder, branch and SWIFT beside the bank, account number and routing), current
salary with its split and every change before it (paged, trashable — the current one excepted),
payslips, the paid tools the person is on, social media accounts with the platforms' real marks,
e-TIN and one E-Return per income year, and what a previous employer paid — display only, sent
from the HR app, never calculated with. Mobile wallet and PSR are off the form. Thirteen fields
this app once invented are rejected by the schema; their columns keep older values. The Team
download returns the whole sheet, joining salary included.

Photos, CVs and appointment letters are uploaded files, not links, and sit on the Documents card
with the rest — including the HR app's four kinds (education certificate, release letter,
experience letter, bank details; bank details is filed with the pay papers). The add/edit form
sets pay too: a changed figure is a raise effective today, an unchanged one writes nothing.

**Payslips are reachable from the person**, newest first, drafts excluded —
not only by remembering which run a month belonged to.

### Payroll

Starting a month opens its people, each with their wage, ticked; Start builds the sheet for the
ticked set, and People on a draft changes it without touching the lines kept. The sheet follows
the owner's Excel: Name, Role, Dept, Basic, House Rent, Medical, Conveyance, Bonus, Other +,
Working Days, Gross, TDS, Other −, Net Pay, FX Rate, Net Pay (USD).

- **Working days** pro-rate the gross from the recorded salary over the month's real length.
  Everything rounds to whole taka; the tax is floored.
- **TDS** is worked out from the income year's rule and can be typed over. A typed figure is
  marked, and survives a recompute until "Work out the tax again".
- **Net Pay** can be typed over too, and the typed figure is then what is paid, printed and
  totalled (`net_amount_override`). Changing a component clears it.
- **One USD rate** above the table fills the empty rows, or replaces them all on a second button.
- **Documents**: Invoice and Reference for the whole run, several files each, attachable while it
  is still a draft.
- Finalise locks the figures on the server, not only on the screen. Paying needs a rate.

The payslip is drawn like the company's own and printed from the same page: the company name
once, Pay period (first day to last), Payment Date, working days as a number, both dates numeric,
no Prepared by, and the authorised signatory's scanned signature from Settings.

### TDS

`/tax/withholding` has two tabs, Salary deductions and the Tax calculator. The register lists
each taxed person for the period chosen and opens on the newest period that has tax. Each row
carries its challan number and scan, stored on the payroll line; one upload serves every row with
that number. "Also write it on the other N rows" is off by default. The rule itself — slabs,
rebate, minimum, exemption, one per income year — is **Settings → Salary TDS**, with a calculator
beside it.

**Income tax left the interface.** TDS is where this company's tax work
actually happens and a second tax screen beside it was noise. The records and
the `/api/income-tax/*` endpoints are untouched — instalments already assessed
are real payments against a real liability. See the note at the top of
`income-tax.service.ts` before assuming that module is dead.

### Import and Export, email, notifications

**Import and Export** (`/data`; `/import` redirects with its query) is the four-step importer on
one tab and every export on the other, grouped by what lands on the disk: CSV for Windows (the
team mail list — UTF-8 byte-order mark, CRLF, cells guarded against formula injection),
documents (among them the bank statement PDF: a cover, then the ledger in four columns, then the
movement), and spreadsheets (each the list endpoint's own output, the team data sheet among
them). The list is cut to what the reader may see; every endpoint keeps its own permission
behind it.

**Renewal reminders** go by email through Resend for any plan renewing within three days, once
per renewal (**Settings → Email**: the key, the addresses, a test to both, "Run today's
reminders"). The mail is nested tables and inline styles on purpose — do not tidy it into CSS.
**The bell** in the top bar raises four events — a plan renewing, the TDS deadline with tax
undeposited, a month ended with payroll unpaid, a voided row or a changed salary — each switchable
in **Settings → Notifications**.

### Settings

While `/settings` is open its own sidebar replaces the main nav: **Back to dashboard**, then ten
sections in four groups, each with a hint and, where it has one, a badge.

| Group | Sections |
|---|---|
| General | Company & formatting · Categories · Salary TDS |
| Access | Your sign-in · People who can sign in · What changed |
| Data | Trashed |
| Integrations | Assistant · Email · Notifications |

A section is `?tab=<id>` — the ids the old tab row took, so links still work — switched without a
reload, and a section the reader may not open is not offered (`settings/sections.ts`).

### PDFs and queries

**PDFs print ৳.** PDFKit's built-in faces are Latin-1, so reports had been
going out with no currency symbol and a hyphen for a minus. Noto Sans Bengali
is embedded, subset to 73KB, under the SIL OFL. If the font is ever missing the
service logs and falls back rather than printing mojibake. A character outside
the subset becomes a space — which is why a range prints with an en dash, not
an arrow.

**Two N+1s are gone.** The funding report asked for an exchange rate once per
remittance and TDS liability ran thirty-six queries to render a year; both are
flat at three now, with the output proved identical beforehand and after.

## The design system (27 Sep 2026)

Every screen follows the owner's **September 2026 design handoff**, `new version of the
design.zip` at the repository root. It is the spec: `source/*.dc.html` inside it holds the exact
values, and its README lists every page. It is in `.gitignore` on purpose — the owner's file, and
10 MB. Unzip it to a scratch folder, never into the repo. (`claude Design prototype for redesign
pages/` is August's design and is superseded.)

- **Tokens.** `apps/web/src/app/globals.css` holds the handoff's palette as `--sv-*`, light on
  `:root` and dark on `:root[data-theme="dark"]`. The older names every screen uses —
  `--background`, `--surface`, `--border`, `--primary`, `--positive`… — point at those values, so
  a screen takes the palette without renaming a class. The prefix exists because `--surface` and
  `--accent` already meant something else. `.sv-light` pins the light table on a subtree: sign-in
  and the preloader stay light in a dark app.
- **Light is the default.** The bootstrap picks light unless the stored preference says dark.
- **One face**, Plus Jakarta Sans, with figures in `tabular-nums`; `--font-num` still exists and
  answers with the same face. **Phosphor** icons, imported as
  `@phosphor-icons/react/dist/ssr/<Name>`. Violet is brand-as-type and links (underlined); lime
  is a fill.
- **Plain CSS** for the handoff's pieces is `apps/web/src/app/new-design.css`: `--sv-*` variables
  and `.sv*` classes only (`.sv-card`, `.sv-control`, `.sv-serial`, `.sv-tint-tile`,
  `.sv-button-quiet`, `.sv-switch-row`…).
- **Shared components**, under `apps/web/src/components/ui/`: `PageHeader` (the header card — a
  lime tile with the screen's filled icon, title 28/800, an optional `eyebrow`), `Card` /
  `CardHeader` (an optional violet icon tile), `Button` (lime primary, quiet white secondary;
  the handoff's sizes — `md` 44px, `sm` 38px), the fields in `field.tsx` (44px, 11px corners,
  1.5px line, violet with a halo while typing, red when refused — and, by where they sit, 42px
  in the filter card, 44px on the white ground in a header or `sv-toolbar` row, 40px on
  Reports' `sv-band`; new-design.css holds those rules), `Switch` and `SwitchRow` (the 44×24
  on/off, `role="switch"`),
  `Segmented` (tabs: a lime active chip, counts, icons), `StatStrip` / `StatCell`, `SummaryBar`,
  `EmptyState`, `StatusPill`, `RowActions` / `RowButton` (32px row buttons), `Dated` (a date with
  the violet calendar), and **`glyph.tsx`** — the one Material-name → Phosphor table, so callers
  still pass `icon="account_balance"` and an unmapped name still draws, in the old face.
- **Forms are centred popups**, not side drawers. `components/ui/drawer.tsx` kept its name and
  props, so none of its callers changed; it renders through a portal at the end of `<body>`,
  submits stop at the popup's edge (a nested form once submitted its parent too), and Escape
  closes only the top popup.
- **The shell.** A white 270px rail whose toggle hides it completely (0px, `inert`); a top bar
  with a caret breadcrumb, the theme switch and the bell; a main column of at most 1560px, 24px
  padding, blocks 18px apart. Tables: a lime-tint header band, violet-ink headings at 800, no
  vertical rules, a violet bar on the hovered row — and the old 7px cell padding, deliberately.
- **Sign-in** (`/login`) is the handoff's: form left, lime brand panel right, the old sign-in
  logic unchanged. The preloader (`components/boot/`) shows only between a successful sign-in and
  the dashboard being there — never on ordinary navigation. The handoff's Turnstile box, "Forgot
  password?" link and footer links were not built as drawn: nothing real stands behind them.

**Two traps, both written into `new-design.css`.**

1. **`globals.css`'s unlayered `* { border-color }` beats every Tailwind border-colour
   utility.** `border-primary`, `focus-visible:border-primary` and friends compute to the plain
   border colour. So a coloured border is a CSS class, not a utility. Moving the rule into
   `@layer base` would wake about fifty dormant utilities in 26 files — a visible change to those
   screens, and its own decision.
2. **Never name a class `ring`.** Tailwind reads it as its box-shadow utility.

A change here reaches every screen at once: find the callers, ask the owner, then measure with
`.uiqa.mjs` and `.sweep.mjs`.

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

## Verified (2026-08-15)

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
Restore drill                9/9  dump restored into a fresh database, the app
                             started against it and signed in to
User management              17/17  HR cannot self-promote, reset kills sessions
Live site                    24/24  cookies, roles, CSRF, token renewal
Assistant key                15/15  Super-Admin-only, sealed, never returned
Responsive                   measured at 360/390/768/1440 — no page scrolls
                             sideways, no short cell wraps
Production audit             71 claims across 5 lenses, 25 confirmed, all fixed
Page render sweep            every route, as Super Admin, CEO and HR
```

## The test suite

The checks above were throwaway scripts in a scratchpad. The ones worth keeping
now live in the repo and run on command:

```
npm test                 unit tests — money, periods, deadlines, dates,
                         permissions, subscriptions, TDS, files, signatures
                         (315 at the last count recorded, 27 Aug)
npm run test:integration suites 01–13, against the real database
npm run test:browser     32 checks — 14 screens × 4 widths × 2 themes, plus
                         the batch review table
npm run test:all         all three, in that order
```

CI runs `npm run build:shared`, `npm run typecheck`, `npm run lint` and `npm test`, each as its
own step, across all three workspaces. Run them the same way before pushing, and read each exit
code rather than the last lines of a pipe.

`test:integration` boots the API itself on a port the operating system says is
free, signs in as each role, and runs:

| suite | what it holds the app to |
|---|---|
| 01 money tie | the register equals the bank to the paisa |
| 02 ledger, payroll, audit | before/after on every money write |
| 03 permissions | 113 checks — every role against every endpoint |
| 04 exports | a download is exactly the filtered view |
| 05 FX | the governing-rate policy (written 14 Aug, before the global rate was removed) |
| 06 periods | both financial years, and 30 June / 1 July between them |
| 07 auth | rotation, reuse detection, role change, lockout |
| 08 payroll, tax, import | paying a run, TDS arithmetic, import and revert |
| 09 reopen | voiding a payment lets the run be paid again |
| 10 batch of drafts | many records saved one at a time, one bad row stranding none |
| 11 TDS over-deposit | a challan larger than the month it covers is reported |
| 12 file uploads | a file is what its bytes say, and exactly as private as the record it hangs on |
| 13 closed books | every way of changing money against a closed period — see *The closed-books lock* |

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

### The root harnesses

Most checking in this repository is done by scripts at the root, `.*.mjs` — over two hundred,
most of them named in the SESSIONS.md entry that wrote them. They drive the real app (Puppeteer
against `npm run dev`: web :3000, api :4001) and the database in `apps/api/.env`, and read what
was painted or stored rather than what the diff says. All but thirteen are tracked; those are in
`.gitignore` as local scratch (`.sweep.mjs`, `.pager.mjs`, `.linkcheck.mjs`, `.rolecheck.mjs`…).

- **No script names a machine's path any more.** The 95 that hard-coded `d:/codes/…` find the
  repository from `import.meta.url` since 27 Sep; the rest read `apps/api/.env` relative to where
  they are run. Run everything from the repository root.
- **`.battery.sh` runs the acceptance harnesses one after another** into `.battery.log`. Run it
  alone: harnesses seed and delete overlapping fixtures, and a battery sharing the database with
  anything else fails for reasons that are not the app. A block of browser failures is a stale
  dev server, or Neon dropping this machine's connection, until proved otherwise.

Written or brought up to date on 27 Sep, for the redesign:

| harness | what it holds |
|---|---|
| `.uiqa.mjs [route]` | the shared pieces on every screen — detail pages with real ids, every Settings section — at 1440 and 390: 28px SL boxes, 32px Phosphor row buttons, the lime active tab, a field's border and violet focus, nothing sideways, no console errors |
| `.settingsqa.mjs` | Settings' own sidebar: four groups, ten sections with hints, no tab row, the People badge against the database, each section from the rail without a reload, Back, a direct `?tab=` link, a CFO not offered People |
| `.accountsqa.mjs` | every balance on Accounts and an account's page against the API to the paisa; Total held = the cards added in paisa, now and at a month's end |
| `.shotqa.mjs <paths…>` | full-page screenshots of any paths at 1440 into `.shots/` — for looking at a page with data in it, not for measuring |
| `.loginqa.mjs` · `.shellqa.mjs` · `.dashboardqa.mjs` · `.popupqa.mjs` · `.headerqa.mjs` | sign-in and the preloader; the shell; the dashboard against the API to the paisa; the popups; the header card on every screen |
| `.regpage.mjs` | the register: every entry reaches the screen, serials 1..N across pages, Closing = the top row's balance. Finds columns by heading; with fewer than 41 entries its page-3 check says SKIPPED |
| `.capsweep.mjs` | fails if the FX chip or the rate caption comes back, or if a screen does not draw |
| `.acctqa.mjs` | each account's own card, a month of Cash In counted and summed in SQL, the register's running balance as a window sum; exits 1 on a disagreement |
| `.sweep.mjs` | every screen's heading 28px, padding 24, gap 18, nothing sideways at 1440, 1180 and 900 |

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

## One table no migration creates

`ai_corrections` — the table the assistant learns from — is in the Drizzle schema
(`apps/api/src/db/schema/ai-corrections.ts`) but was created by hand, and no file in
`deploy/sql` creates it. The live database has it: the bulk seeder wrote rows into it there on
2026-08-20. Any new database — a restore target, a second environment — needs it once:

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

## Live — on a VPS since 2026-08-15

| | |
|---|---|
| Web | https://app.hellonizam.com |
| API | https://api.hellonizam.com |
| Database window | https://db.hellonizam.com — Adminer, behind basic auth and a rate limit |
| Host | Hostinger KVM 1 · 1 vCPU · 4 GB · 50 GB · Ubuntu 24.04 LTS |
| Database | Postgres 17 in a container **on the same box**. Neon is only the local development database |

Everything runs behind one nginx under `/opt/sfm/deploy`: `db`, `adminer`, `api`, `web` and
`nginx` (`db` and `adminer` under the compose profile `local-db`).

**A push to `main` is a deploy.** GitHub Actions runs `test` (the four CI steps), then `build`
(both images to GHCR, tagged with the commit), then `verify`, which waits up to twenty minutes
for the live `/api/health` to report that commit; a newer push cancels an older run. `test`
gates `build`, so a lint error means no image and a server silently behind — `gh run list` and
`gh run view --log-failed` say why.

**The server deploys itself.** `sfm-deploy.timer` runs `deploy/watch-and-deploy.sh` a minute
after each check ends. Once the new commit's images are in the registry it resets the checkout
to that commit and runs `remote-deploy.sh`: every new `deploy/sql` file applied once and recorded
in `schema_migrations` **before** the containers swap, then pull, `up -d`, and a failure on any
nginx `[emerg]` or `[alert]` since the reload. Nothing reaches into the box from outside, and
**the server never compiles anything** — one vCPU cannot afford `next build`. Watch it with
`journalctl -u sfm-deploy.service -f` or `deploy/deploy.log`.

Rolling back is `IMAGE_TAG=<sha>` in `deploy/.env` and `docker compose up -d`;
every image is tagged with the commit it came from.

A command run inside a container runs the built image, not a working copy: a commit that has not
been pushed and deployed is simply not in there.

### Two subdomains, and what that changed

The app was built for a single origin, when the plan was a VPS with no domain.
It now has one, and the browser talks to both hosts, so:

- The auth cookies carry `Domain=.hellonizam.com` (`COOKIE_DOMAIN`). Without
  it the cookie is host-only to `api.*`, and `app.*` — which server-renders
  every page and needs it — never sees it. Sign-in would succeed and every page
  would still say signed out.
- `SameSite` stays **Lax**. The two hosts are the same *site*, and reaching for
  `None` here is a reflex that gives the cookie away to genuinely foreign sites
  for nothing.
- CORS names the app's origin exactly, with credentials.
- The CSRF header check is unchanged and is now *stronger*: cross-origin, a
  custom header forces a preflight, and only an allowed origin survives one.

Verified against the deployed site, not a local build — 15 checks covering the
cookie's scope and flags, both hosts receiving it, server-rendered pages being
authenticated, the browser bundle pointing at the right host, CORS, CSRF, and
sign-out actually clearing a domain-scoped cookie.

### A second application shares the box (since 2026-09-07)

The owner's HR app — **shareviral-hrm**, its own repository — runs on this server with no host
ports of its own. This nginx holds 80 and 443 and routes `hrm.hellonizam.com` to it over the
external `hellonizam-edge` network, which nginx joins alongside `default`. **Keep `default`
listed**: naming any network on a service replaces the implicit one, and nginx would lose `web`
and `api`. The HR app sends people across to this one, with their papers and what a previous
employer paid them.

Two outages came from the second stack, and each left a rule behind:

- **Upstreams are container names** — `sfm-web-1`, `sfm-api-1`, `sfm-adminer-1`. Both stacks call
  their services `web`, `api` and `adminer`, so on a shared network a service name resolved to
  either app, and the site flapped 502 for hours.
- **Scripts ask compose for this stack's database** (`COMPOSE_PROFILES=local-db docker compose
  ps -q db`) and print which container they chose. `docker ps | grep -db-` once found
  `hrm-db-1`, and the deploy tried to run this app's migrations in the HR database.
  `remote-deploy.sh`, `status.sh` and `clean-for-production.sh` all work this way now.

`docker image prune -af` at the end of the deploy is daemon-wide, and worth a look now that the
daemon holds two applications' images.

### Certificates

A Let's Encrypt certificate covers this app's three hostnames, filed under
`app.hellonizam.com`. Renewal uses **webroot**, not standalone: nginx holds
port 80, so a standalone renewal cannot bind and fails — silently, months
later, on a morning when the site suddenly looks untrusted. Proved with
`certbot renew --dry-run` while nginx was running; `certbot.timer` is active.

### Backups

`deploy/backup.sh` runs at 02:00 Dhaka from root's crontab and keeps 30 days. Each dump is
gzip-checked with its table and row counts asserted, copied to Google Drive and **verified
byte-for-byte on the far side**; the uploads go too. A backup that has never been restored is a
hope — see the next section.

### Notes for whoever is next

- `DATABASE_URL` must end in `?sslmode=disable` for the containerised Postgres.
  The app treats any non-localhost host as remote and demands TLS, which is the
  right default and wrong for a private Docker network. Leave it off and the
  pool cannot connect; the error says "Failed query" and names the SQL.
- `db.hellonizam.com` puts a database console on the open web, behind basic auth and a rate
  limit. That is a standing decision, not an oversight — but it is a decision.
- As of 26 Aug nothing monitors the site. If it stops at three in the morning, nobody knows until
  somebody opens it.

Retired: the Vercel and Render deployment. It is still described in
`DEPLOYMENT.md` should it ever be wanted again.

## The restore has been done (2026-08-14)

Phase 8 said a documented restore must actually be performed before the phase
closed. It has been, against the live database's own dump:

```
pg_dump the live database              672 KB, 23 tables, all 21 transactions
restore into a fresh Postgres          0 errors
start the app against the restored copy
sign in to it                          superadmin@shareviral.cash
read the figures back through the app  every balance to the paisa,
                                       July paid / August draft,
                                       1,024 audit entries, 25 people,
                                       signed_amount still generated,
                                       265 constraints
```

Nothing on Neon was touched. The dump is read-only; the restore went into a
throwaway Postgres created for the drill on a spare port and deleted after,
along with the dump — a dump is a full copy of everybody's password hashes and
the sealed assistant key, and it does not belong in a temp folder afterwards.

Two things the drill establishes that a green backup log cannot. **The generated
column survived**: `signed_amount` is what every balance in the app is computed
from, and a dump that flattened it to ordinary data would restore figures that
look right and stop updating. And **somebody can get in**: a restored database
whose passwords nobody remembers is not usable, so the drill sets a password on
the restored copy — which is what a real recovery has to do — and signs in.

### Repeating it

The database is the VPS container now, so the drill runs there:

- **`deploy/drill.sh`** is the rehearsal. It fetches the newest copy from Google Drive (or a
  named one), restores it into a scratch database beside the live one, compares the two, and
  drops the scratch copy whether it passes or not. It uses the Drive copy on purpose: the
  question is whether the bytes off the server are a database.
- **`deploy/restore.sh <dump | gdrive:…/sfm_….sql.gz>`** is the real restore. It overwrites the
  database it is pointed at, and refuses one that holds transactions unless `FORCE=1`.

The last restore recorded, on 2026-08-26, put the 25 August dump into a scratch database: 33
tables, 705 transactions, 120 team members, 5 users — the pre-wipe state exactly — and the live
`sfm` was never touched. Do it again after any schema change.

## Your data — done (2026-08-26)

What was left after the phases was not code, and it is done:

1. The sample data came out of the live database on 2026-08-26 (see *Demo data*). The live
   sign-ins are real people's, managed in **Settings → People who can sign in**.
2. The owner's own bank accounts and cards are in.
3. The category tree started from `deploy/sql/2026-08-26-categories.sql` — sixty-three rows,
   generated from the seeder's tree by `.gencats.mjs`, and a heading renamed by hand stays
   renamed when it runs again.
4. The books start in **May 2026** — `RECORDS_START` in `packages/shared`, where every month
   picker in the app counts back to.

## Four decisions the audit surfaced (2026-08-14), and where they stand

1. **`mustChangePassword` still does nothing.** It is stored, selected, echoed
   by `/auth/me` and now shown in amber on **People who can sign in** — and no
   guard consults it. Enforcing it would bounce everybody who carries it to a
   change-password screen on their next request, so it is left as it is until
   you say otherwise. The alternative is to drop the flag, so it stops implying
   a protection that is not there.
2. **Settled: the operational role reads the audit log.** Admin was given
   `audit.read`, and since 5 Sep Admin is CFO, which holds it.
3. **Settled: the vendor named `150000.00`** went when the live database was
   emptied on 2026-08-26, and the Suppliers screen had already gone.
4. **The Anthropic key and `SECRET_ENCRYPTION_KEY`.** The stored key had been
   orphaned by a changed `JWT_REFRESH_SECRET`; every credential in
   `app_settings` was cleared on 2026-08-26 anyway. Compose passes
   `SECRET_ENCRYPTION_KEY` to the API, and an unset one no longer defeats the
   fallback (an empty string used to). Set it, so rotating a JWT secret cannot
   orphan a sealed secret again.

## Done: AI tools and subscriptions (asked 2026-08-18, built from 2026-08-19)

A register of paid tools — what is bought, who is on it, which card pays it — at
`/subscriptions`, with every tool a person has ever been on shown on their profile under **Paid
tools**.

### What the owner's sheet was

The owner sent the CSV of `Master_Input`, its four dropdowns, and the person-by-tool matrix
under it. **Each row was not a tool** but one person's subscription to one tool for one billing
period, and **the matrix was a many-to-many link**: Clickup one row and twelve users, Github one
row and nine. **The email is the account holder, not the user** — Github is under nizam@, who is
not in the matrix at all. Who pays and who uses are different questions, and the app answers
both.

### The shape

Two tables, because a tool and a subscription to it are different things.

**`subscriptions`** — one plan, one price, one lifecycle:

| column | type | why |
|---|---|---|
| `tool_name` | text | what the tool is called — Claude, Figma, Github. Not a `vendors` row: typing a name used to mint a company on the books. `vendor_id` stays, nullable and unwritten, for rows from before |
| `plan_name` | text | "Max Plan 5x", "Professional Full seats" |
| `category` | enum | the sheet's ten, as an enum so it cannot drift |
| `cost_usd` | numeric(14,2) | the price as billed |
| `cost_bdt` | numeric(14,2) | what the card was actually charged |
| `usd_rate` | numeric(18,6) | the rate that charge worked out at |
| `charge_usd` | numeric(14,2), nullable | the card's charge on top of the price, in dollars, converted at the plan's own rate. `charge_bdt` is from the first version and is read and written nowhere |
| `billing_cycle` | text | none / monthly / quarterly / yearly — the shared array, not a pgEnum |
| `start_date` | date | |
| `next_renewal_on` | date, nullable | derived from the start and the cycle, moved on by a payment; nullable for "Credit Base" |
| `renewal_note` | text, nullable | and this is where that phrase lives |
| `status` | enum | active / paused / canceled / expired |
| `payment_method` | existing enum | how it is paid, separate from which account pays |
| `account_id` | uuid → accounts, nullable | which card or bank pays it |
| `bought_for` | text | "Engineering Core" — the team, as typed |
| `login_email` | text, nullable | a label, not a person |
| `website_url`, `invoice_no`, `reference`, `notes` | text, nullable | |

**`subscription_users`** — subscription × team member, with `from_date`, `until_date` and its own
`status`, which is *not* the plan's: a plan can be running while one person's seat was cancelled
in July. Picking one name is the same gesture as picking twelve, and it is what makes "which
tools is this person on" answerable for shared seats. A screenshot, the invoice and the bank
record hang on the plan as files.

**All three money columns are stored, on the owner's instruction**, and **the form takes any two
and computes the third** — type USD and BDT and the rate appears — so none of them can disagree
with the other two, which is exactly what INV-002 did in the Cash In sheet.

### Enums

| set | decision |
|---|---|
| `subscription_category` | **new** — AI Tool, Development, Marketing, Design, HR, Productivity, Management, eSIM, Server Support, Finance |
| `subscription_status` | **new** — active, paused, canceled, expired |
| `payment_method` | **the existing one, not extended**: bank transfer, cash, cheque, mobile banking, card, other. An earlier version of this note planned `paypal` and `payoneer`; they were never added |
| `billing_cycle` | **the shared `BILLING_CYCLES` array — not a pgEnum.** `vendors.billingCycle` is `text` too, and declaring the new column as a pgEnum would make two tables disagree about the same idea. Labels read Monthly / Quarterly / Yearly / Not recurring |

### How it behaves

- **Five tabs** — Active, Paused, Canceled, Expired, All — and a month filter: a plan is in a
  month if it had started by the end of it. Saving a plan moves the screen to the tab it landed
  in. The register reads in dollars with the taka under, and **Total / cycle** is price plus
  charge.
- **The tool's name opens the plan's own page** (`/subscriptions/[id]`), read-only, holding the
  columns the register does not: category, cost, rate, payment method, the note in full, and the
  seats — with the reminder that the price is the whole plan's.
- **Adding an active plan takes its first payment**, from the chosen account on its start date,
  once. A renewal is **Record a payment** on the row — dollars, the day's rate (the plan's is only
  the placeholder), the taka worked out and still typeable, a bank charge — and is **never taken
  automatically**: money leaving a bank has to be somebody's act, on a date they chose.
- Every payment is filed under the AI tools heading automatically and carries
  `transactions.subscription_id`, so it counts as tooling whichever account paid it.
- Reminders — email and the bell — go out for any plan renewing within three days, once per
  renewal.
- **Open (1 Sep):** a plan's screenshot can be replaced from the register's picture button, but a
  plan with none can no longer be given a first one since the paperclip came off the form.
  Reported, not decided.

## What the convention sweep found (2026-08-18)

Twelve agents mapped the six subsystems the new work has to match, each map
then checked against the files by a second agent. The findings that change
what gets written:

- **`billing_cycle` is plain `text`, not a pgEnum.** Corrected above.
- **"Subscriptions" already existed as a *view*, not a table** —
  `packages/shared/src/subscriptions.ts`, `GET /vendors/subscriptions` and
  `GET /exports/subscriptions`, all still there. Every
  figure in it comes from the ledger on purpose - the file says a stored
  "renews on the 3rd" is a habit rather than a schedule, and a monthly total
  built from it would assert spending that may never have happened. The stored
  table built since sits *beside* that rule: what was paid is still the ledger's
  own rows.
- **Attaching a file to a new kind of owner is not one change but five**, and
  four of them fail in ways that do not look like the cause: the
  `files_one_owner` check constraint (sums the owner columns and demands
  exactly 1, so a new column alone makes every upload rejected), `ownerOf()`
  (miss it and reads and deletes 404 with a message that reads like data
  corruption), `OWNER_PERMISSIONS` (**`GET /files/:id/content` carries no
  `@RequirePermission` - that map is the only gate, so a missing entry serves
  bytes to any signed-in user**), `KINDS_BY_OWNER`, and `SINGULAR_KINDS`.
  Six files have recreated `files_one_owner`; since
  `2026-09-02-payroll-run-files.sql` it counts **nine** owner columns, and
  anything that touches it again must sort after that file and count ten.
- **A transaction attachment needs none of that.** `transaction` is already a
  file owner with `receipt` and `other` kinds, and `transaction-form.tsx`
  already renders the uploader. The Cash In and Other Expenses attachments are
  nearly free.
- **A pgEnum value added without running the SQL fails only at runtime**, as a
  bare `500 Internal server error` - drizzle does no client-side enum checking
  and the exception filter has no branch for a driver error. And the reverse
  (a value live in the database but missing from the shared array) compiles
  clean everywhere and only surfaces as a wrong label on screen.
- **`ALTER TYPE ... ADD VALUE` cannot be used in the transaction that added
  it.** The house SQL style wraps everything in `begin; ... commit;`, so the
  value and anything using it must be separate. `2026-09-23-hr-file-kinds.sql`
  carries no `begin;` for this reason, and says so at length so nobody copies
  it as a template.
- **`packages/shared` is consumed as built `dist/`.** Editing `src` changes
  nothing until it is rebuilt — and a running `nest start --watch` does not
  re-require it; bounce the API after rebuilding.
- **HR's `vendors.read` is load-bearing for navigation**, not incidental - the
  whole Expenses group survives the sidebar filter only because that child
  does. Gating the tools screen on a new permission HR lacks removes the group.

Learned since, and worth the same weight:

- **Drizzle renders `${table.column}` inside a raw `sql` fragment unqualified.** Inside a
  correlated subquery with its own `FROM`, the bare name binds to the inner table: the payroll
  picker once found nobody with a wage and the run list counted no documents, both from valid SQL
  that raised nothing. Write the qualification out by hand.
- **A unique index over soft-deleted rows must be partial** (`where deleted_at is null`), or a
  trashed row keeps its value taken. It bit on salary dates (`compensation_history`) and on
  employee codes (`team_members`); the indexes written since — social accounts, E-Returns — are
  partial from the start.

## Still waiting on answers

Answered since this list was written: the bank accounts (the owner's own are in) and the start
date (May 2026, `RECORDS_START`). Still open as far as SESSIONS.md records:

1. **The category list** — whether the headings loaded on 26 Aug match how
   ShareViral actually spends.
2. **Payroll fields** — bonus, other additions, other deductions and a note are
   built. Is provident fund or a salary advance also needed?
3. **A sample of the current Excel** — so the import column mapping matches it
   rather than being guessed at.
4. **An Anthropic API key** — paste it into Settings → Assistant to switch the
   assistant on. Everything else works without it.

## The architecture document (2026-08-18)

It is a page in the app now: `apps/web/public/architecture.html`, served at
`/architecture.html`. It was a chat attachment before, which meant every edit
made a new copy and nobody could say which was current.

**Behind the login, deliberately.** The proxy matcher covers `.html`, so a
signed-out visitor is redirected. This is worth not undoing by accident: the
page names the defences that are designed and not yet built — two-factor, idle
timeout, and backup credentials kept off the box — next to the live domain.
Making it public is a one-word change to the matcher, and should be a decision
rather than a default. If a public version is wanted, cut the open items and
publish that, not this file.

Two things about the file itself:

- **The fonts are inlined**, nine latin faces as base64, which is most of its
  436KB. Not linked, on purpose: a font CDN announces every reader of this page
  to a third party, which sits badly on a document about how carefully the
  system is locked down. It also fails closed where the page is published as an
  artifact, whose CSP blocks external font hosts and would silently fall back.
- **The artifact copy is generated, never hand-edited.** Run
  `node scripts/architecture-artifact.cjs` — the artifact host wraps whatever it
  is given in its own `<html>`/`<head>`/`<body>`, so the full document has to be
  stripped down first. Edit the page in `apps/web/public/`, regenerate,
  republish. Only one of the two is ever written by a person, so they cannot
  drift.

## The closed-books lock was never missing (2026-08-18)

Worth writing down because it was got wrong twice, in opposite directions, and
the wrong version was published.

The claim in an earlier draft of the architecture page — "the column exists; no
write path reads it" — was false. `settings.assertPeriodOpen` is called from
**12 places across 6 modules**: transactions (create, update ×2, transfer),
accounts (the opening balance, its old date and its new), payroll (mark paid),
TDS (recording a deposit and changing one), income tax (payment), and imports
(preview and commit). None of them sit behind a condition.

The subtle one is `transactions.update`, which checks *two* dates — the one the
row currently sits on and the one it would move to. A guard on the incoming
date alone would look correct and still let anybody backdate a payment into a
signed-off month.

**Voiding is the exception, since 31 Aug, on the owner's decision.** The trash
could already change a closed month and `void` could not; asked which way to
resolve it, he opened `void` rather than closing the trash. A void does not
erase — the row stays, struck through, out of every total, with who and why in
the audit log — so a closed month can now be corrected but not quietly
rewritten, and creating or editing inside it is still refused. What he was told
at the time stands: the lock now stops new money appearing in a filed month; it
no longer stops a mistake in it being marked as one. `.lockedqa.mjs` holds it.

What was actually missing in August was a **test**. That is
`apps/api/test/integration/13-closed-books.mjs`, which closes the books, tries
each way of changing money against a row inside the period and a row outside
it, and — the point of the suite — proves an open row cannot be backdated in.
Every refusal is paired with the same call succeeding once the lock is lifted,
so a passing run cannot come from a malformed payload. It clears the lock in a
`finally`: a suite that died holding it would leave every write in the app
refused until somebody noticed.

**It still expects a void inside the period to be refused**, which the 31 Aug
decision reversed, so that check has to be turned round before the suite can
pass. Run it with `npm run test:integration -- 13`, against the local database.

## Two-step sign-in, and the screen left open (2026-08-18)

Both shipped, and the architecture page's roadmap is down to two items, neither
of which is in the application.

**Two-factor.** TOTP written out rather than installed, because RFC 6238
publishes test vectors and that makes the tests a check against the standard
instead of a recording of whatever the code does. Enrolment shipped a deploy
ahead of the check at sign-in, so nobody could be locked out by the feature
arriving — and the check is per account, not a switch, so anybody who has not
enrolled still signs in as before. Each person sets theirs up in **Settings →
Your sign-in**.

The thing worth remembering is the trap it nearly walked into. `JwtAuthGuard`
verifies a JWT, reads `sub` and `tv`, and lets the request through; it never
asked what the token was minted *for*, because until now this application only
made one kind. A sign-in challenge signed with `JWT_ACCESS_SECRET` would have
been a complete bypass — password, challenge, send it as the access token, skip
the phone. It is signed with a domain-separated key so it cannot verify as an
access token at all, and it carries a `typ` claim the guard now refuses. The
bypass is written out as a test in `challenge.spec.ts`.

Break-glass is in DEPLOYMENT.md: recovery codes first, then deleting the
enrolment with psql. Deliberately not possible from inside the app — an
administrator who can switch off somebody else's second factor is a way around
it.

**Idle timeout.** Two hours since 2026-08-27 (`IDLE_MS` in
`components/auth/idle-timeout.tsx`; it began at twenty minutes), a minute's
warning, then out. The session never ends while somebody is working: clicks,
keys, scrolls, touches and tab focus reset the clock, and the seven-day refresh
token behind it carries a full day's work. Three details that the obvious
implementation gets wrong: it compares timestamps rather than using
`setTimeout` (a closed lid suspends timers, so a laptop shut at six and opened
at nine would sign out two hours into the morning); the last activity is shared
between tabs through localStorage; and once the countdown is up only a click on
**Stay signed in** dismisses it, because a knocked desk should not keep a
finance system signed in all night.

**A session no longer dies at random.** Two refreshes carrying the same cookie
— every fetch on a screen left open past the access token's fifteen minutes —
used to be read as a stolen token replayed, and revoked the whole family.
`rotate()` now locks the row; inside a 30-second grace (`ROTATION_GRACE_MS`,
and only while the family still has a live head) the straggler gets an access
token and no new refresh cookie; and the browser sends one refresh at a time
(`refreshOnce()` in `lib/api-client.ts`). A replay after the window is still
refused and still takes the family with it.

## The rate limiter was charging six seconds for every sign-in (2026-08-18)

Reported as "login is slow". It was not the server.

The app and API are on different hostnames, so the browser sends a CORS
preflight before the POST. Both matched the exact-match login location, so one
sign-in spent two tokens from a budget of ten a minute — and the preflight went
first, taking the available one and leaving the real request to wait. Preflights
are excluded now with an empty limit key, which is nginx's own idiom for "not
this request". Adminer, which had been sharing the sign-in zone and draining it,
has its own.

**The part worth keeping.** The fix deployed four times and took effect zero
times, and every check said fine:

```
[emerg] limit_req "sfm_login" uses the "$login_limit_key" key
        while previously it used the "$binary_remote_addr" key
```

A `limit_req` shared memory zone survives a reload — that is how the counters
are not wiped every time — and nginx will only reuse one whose key still
matches. The key changed, the name did not, so the master read the new config,
refused it, and carried on with the old one. The site stayed up, `nginx -t`
passed, `nginx -s reload` returned success, the deploy went green. Renaming the
zone fixed it.

Three ways of checking were blind to this, and two of them were mine:

- `nginx -t` parses the files from disk in a fresh process.
- `nginx -T` does the same and prints them. **It does not report what the
  running master is serving**, which is the opposite of what was claimed when
  it replaced the old marker check. It is still worth having — it catches a
  stale mount, which has happened here — but it could never have caught this.
- `docker compose logs --tail 40` buries the reload under access logs.

`remote-deploy.sh` now reads the error log from the moment of the reload and
fails on `[emerg]` or `[alert]`. The only thing that told the truth throughout
was measuring behaviour: 5.97s is exactly 10r/m however confidently a file says
20.

## The six npm advisories, and why they stay (2026-08-18)

Dependabot is on now, so this will come up again. Both of `npm audit`'s
proposed fixes are **major downgrades** that would break the application, and
neither advisory is reachable from this code. Do not run `npm audit fix
--force`.

**esbuild — four of the six.** `drizzle-kit → @esbuild-kit/esm-loader →
@esbuild-kit/core-utils → esbuild 0.18.20`, which is inside the affected range.
The advisory is about esbuild's **dev server** letting any website read its
responses. Nothing here starts one: drizzle-kit uses esbuild to transpile
`drizzle.config.ts` and exits. It is also a devDependency, and the API image
runs `npm prune --omit=dev` and copies only `dist`, so it is not in the
deployed container at all. The root esbuild is 0.25.12 and already patched.

npm's fix is drizzle-kit **0.18.1**, down from 0.31.10 — it would take the
schema tooling with it.

**uuid — the other two.** `exceljs → uuid 8.3.2`. The advisory is a missing
buffer bounds check *in v3/v5/v6, when `buf` is provided*. exceljs calls
`uuidv4()` at three sites, all with no arguments — wrong version, and not the
vulnerable path either way.

npm's fix is exceljs **3.4.0**, down from 4.4.0 — it would take every Excel
download with it.

**What would change this.** A newer drizzle-kit that drops `@esbuild-kit`
(they moved to `tsx` at some point — worth checking when a major lands), or an
exceljs that moves off uuid 8. Both arrive as ordinary Dependabot pull
requests; neither is worth forcing.

## Decisions worth remembering

- **One ledger, not two.** Expenses and bank entries are the same table viewed
  differently. Separate tables drift the first time someone edits one.
- **Salary lives in its own table**, `compensation_history`, with every change
  kept. It was built so that no HR request could reach a salary; on 15 Aug 2026
  the owner decided HR owns pay, and now all four roles hold
  `team.compensation.read`. The table stayed separate, which made that change
  four lines instead of a migration, and a projection that does not join it —
  the personnel data sheet, for one — still cannot carry pay by accident. The
  **joining salary**, the offer-letter figure, sits on the team record itself;
  what somebody is paid *now* comes from `compensation_history`.
- **Money is `numeric(14,2)` and moves as strings.** Never a float; sums happen
  in SQL, and anything a screen must add is added in paisa (`toMinorUnits` /
  `fromMinorUnits`).
- **`accounts.currency` marks which account is for foreign spend. It does not
  denominate the figures** — every stored amount is taka, a USD card's included.
- **Every entry carries its own rate**, and there is no rate for the whole app.
  A figure with no recorded rate has no dollar value, rather than one borrowed
  from whatever rate was lying around.
- **Nothing is erased on the spot.** A money row is voided — struck through,
  still visible, out of every total — or moved to the trash, which voids it too.
  Only a purge from the trash removes a row, and the audit log cannot be
  deleted at all.
- **Salary tax is worked out, and can be typed over.** The income year's rule
  in Settings → Salary TDS produces each line's TDS, and a figure somebody types
  is marked as typed rather than passed off as the rule's. Company income tax is
  still recorded rather than calculated: the accountant supplies those numbers.

## Done: Statement is really Reports, and Reports becomes a bank statement (2026-08-19)

**Built.** Two screens, beside each other in the rail's Insight group.

### The rename

`/statement` was named wrong. Its contents were right — the owner said so — but a
reconciled period position with an executive summary and a sign-off is a
**report**, not a statement. So **Reports** (`/reports`) is that position now,
headed **Finance statement** since 27 Sep: the period, the closing balances,
where the money went, the notes, and up to four signatories, each with a scanned
signature that the PDF prints in a 2×2 grid. A save prunes signature files no
signatory names; nothing carries a signature from one period to the next.

What was called Reports gave up that name and became **Bank statement**
(`/statement`): the actual movements on the bank's own ledger, which is the
thing an accountant means by the word.

### What a bank statement is here

```
SL | Date | Description | Debit | Credit | Balance | Entry No. | Invoice
```

Another view of the same ledger All Transactions reads — in and out split into
two money columns instead of one signed one, with the running balance after
each line. **Oldest first**, the way a bank's paper reads (the owner asked for
it back after a spell of newest first), twenty to a page with the serial
counting across pages. The opening balance is a Brought forward line above the
rows, not a row, and the closing line says it is the whole period's, not the
page's.

**Entry No.** is the app's own `TXN-…` number with the bank's small under it,
and it and Invoice open whatever is attached. The owner's reasoning is worth
keeping: *"we are uploading a document on every transaction, aren't we?"* — so
the statement is where somebody goes to check that.

The PDF (on Import and Export) is the same register laid out rather than
recalculated: a cover, then the ledger — first, and in four columns, Date (with
the entry number under it), Debit, Credit, Balance, sized so nothing is cut —
then how the balance moved.

### Filtering

Deliberately almost none: an account, a start date and an end date. Nothing
else.

And the dollar/taka switcher came off, matching every other screen — taka
large, dollars underneath it, always both, never a toggle.

### The dollar figure — answered

Asked, because the instruction read two ways. The owner: *"no need for a
separate column for the dollar, it can go small underneath."*

So the same treatment as everywhere else: taka on the line, dollars small
beneath it, in the same cell. `Amount` already renders exactly that and is what
the other tables use — no new component.

## Done: the salary split, and where it belongs (asked 2026-08-19)

**Built.** The owner sent a handwritten sheet headed *Salary Statement*:

```
Basic         60,000
House Rent    30,000
Convence       6,000
Medical        4,000
             ---------
             1,00,000
```

One lakh split 60 / 30 / 6 / 4. They asked where it should live — the team
member's page, the TDS table, or somewhere else.

### Where it went, and why

**The team member's page, under Current gross.** That is where they pointed, and
it is the right place: the split is a fact about what somebody is paid, not
about a month or a tax. The page shows each component with its share, worked
out from the figures frozen at the raise that set them — so a person hired
under an older split still reads correctly if the rule changes.

**The payslip prints it** — `payroll_lines.earnings_breakdown`, frozen per
month — and the salary sheet has a column per component.

**Not the TDS table.** The owner asked for that one to be *ekdom simple* two
messages earlier, and four more money columns is the opposite.

### No migration for the components

`compensation_history.components` was already there, jsonb, added for exactly
this — the schema comment says *"Room for a basic / house rent / medical /
conveyance split without a migration"*.

### The percentages are a setting, not constants

60 / 30 / 6 / 4 is this company's convention, not a law, and the same argument
the owner made about TDS applies: the rule should be editable rather than
buried. It is `app_settings.salary_split`, a list of `{label, percent}` —
null means the shared default, `DEFAULT_SALARY_SPLIT`. `splitSalary` floors
each line to a whole taka and gives the remainder to Basic, so the parts always
add up to the gross exactly.

## Done: a signature on the payslip (2026-08-19)

**Built.** The plan below is what it turned out to be.

The owner: *"Put a signature section at the lower part of the payslip, and make
it dynamic — I want to upload it from Settings. Definitely mention the ratio and
the image size and make it required, so nothing bigger can be uploaded."* They
pointed at AUTHORISED SIGNATORY, which printed a name and a rule.

Since then: a second mark for **Prepared by** (`prepared_signature`) was added
in early September and went, shortly after, with the Prepared by block itself.
The file kind stays — Postgres cannot drop an enum value and it costs nothing —
and the slip now carries the one authorised signatory's mark.

### Where the file lives

`files` enforces that a file belongs to exactly one thing, by a check constraint
counting owner columns. A signature belongs to the COMPANY, so it has an owner
column pointing at `app_settings`. That row is keyed by a smallint with
`check (id = 1)`, so the column is a smallint, not a uuid. The invariant was
not weakened to allow an unowned file: an unowned row is unreachable through
every screen and still on disk.

Uploading a second signature retires the first in the same transaction —
`SINGULAR_KINDS` in files.service.ts, which already did exactly that for the
profile photo.

### The constraint the owner actually asked for

The numbers are exported constants in `packages/shared/src/files.ts`, and one
pure function, `checkSignatureImage`, takes width, height, bytes and mime and
returns ok or a reason. The browser and the server both call it — two
implementations of one rule is how they drift. `SIGNATURE_RULE` says it in
words: a PNG or JPEG under 300 KB, at least 300px wide, between 1.5:1 and 8:1.

Server-side, `readImageSize` reads the real dimensions from the bytes, with no
new dependency: PNG carries them in the IHDR and JPEG in its frame header. The
statement's signatures go one step further (`checkPrintableSignature`) and
refuse an interlaced PNG or a progressive JPEG at the door, because neither can
be embedded in a PDF.

"Mentioned" is half the request: Settings states the size, shape and types
before a file is chosen, not only after one is refused.

### The trap on the payslip

That page is measured against the company's own PDF and must fit one A4 sheet.
The signature has a fixed height in `pt` with the width following, or a tall
scan would push the slip onto two pages — which is worse than no signature. And
it shows on a white plate in Settings: a black PNG on a dark card is invisible.
