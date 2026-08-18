# SFM — where things stand

ShareViral Finance Management. All phases built, deployed and audited end to end; last updated
**2026-08-15**, after a full end-to-end audit, a test suite that runs on command, and a deploy
verified against the live site rather than a local build.

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

> **The demo people were removed on 2026-08-14**, at the owner's request, once
> the seventeen real employees were in. Everything that existed only because of
> them went with them: both payroll runs, all twelve lines, six salary records,
> six TDS allocations, July's ৳3,76,300 salary payment and the ৳18,700 challan
> that covered it. Standard Chartered rose by ৳3,95,000, none of which was ever
> real money. The demo accounts, vendors and transactions are still there.
>
> So the payroll screen is empty until the first real run. That is correct, and
> it is also why the payroll test suites build their own run now — they used to
> borrow the demo's draft, and with it gone they reported "no draft run to take
> through" and *passed*.

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

## The test suite (2026-08-14)

The checks above were throwaway scripts in a scratchpad. The ones worth keeping
now live in the repo and run on command:

```
npm test                 154 unit tests — money, periods, deadlines, dates,
                         permissions, subscriptions
npm run test:integration 278 checks across 11 suites, against the real database
npm run test:browser     32 checks — 14 screens × 4 widths × 2 themes, plus
                         the batch review table
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
| 10 batch of drafts | many records saved one at a time, one bad row stranding none |
| 11 TDS over-deposit | a challan larger than the month it covers is reported |

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

> **Settled on 2026-08-15: it is not a different database.** Live reads the same
> Neon instance, and `ai_corrections` is there. Nothing below needs doing today.
> It stays written down because it comes back the moment production moves — to
> the VPS, or to a second Neon branch.

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

## Live (2026-08-15) — moved to a VPS

| | |
|---|---|
| Web | https://app.hellonizam.com |
| API | https://api.hellonizam.com |
| Host | Hostinger KVM 1 · 1 vCPU · 4 GB · 50 GB · Ubuntu 24.04 LTS |
| Database | Postgres 17 in a container **on the same box** — Neon is retired |

Everything runs behind one nginx: `db`, `api`, `web` and `nginx` as four
containers under `/opt/sfm/deploy`. Push to `main` and GitHub Actions tests,
builds both images, pushes them to GHCR and tells the server to pull. **The
server never compiles anything** — one vCPU cannot afford `next build`, and a
deploy that makes the site slow for the people using it is not a deploy.

Rolling back is `IMAGE_TAG=<sha>` in `deploy/.env` and `docker compose up -d`;
every image is tagged with the commit it came from.

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

### Certificates

One Let's Encrypt certificate covers both names, filed under
`app.hellonizam.com`. Renewal uses **webroot**, not standalone: nginx holds
port 80, so a standalone renewal cannot bind and fails — silently, months
later, on a morning when the site suddenly looks untrusted. Proved with
`certbot renew --dry-run` while nginx was running.

### Backups

`deploy/backup.sh` runs at 02:00 Dhaka from root's crontab and keeps 30 days.
The dump has been restored once, into a scratch database beside the live one,
and the figures matched to the paisa. A backup that has never been restored is
a hope.

### Notes for whoever is next

- `DATABASE_URL` must end in `?sslmode=disable` for the containerised Postgres.
  The app treats any non-localhost host as remote and demands TLS, which is the
  right default and wrong for a private Docker network. Leave it off and the
  pool cannot connect; the error says "Failed query" and names the SQL.
- Render generates its own JWT secret, so tokens minted from this repo's `.env`
  are refused by anything deployed. To reach a deployment you sign in.

Retired: the Vercel and Render deployment. It is still described in
`DEPLOYMENT.md` should it ever be wanted again.

Both build from `main` automatically, so a push is a deploy. The browser only
ever talks to the Vercel URL: `/api/*` is rewritten to Render, which keeps the
session cookie same-origin. **Render's free plan sleeps** — the first request
after a quiet spell takes about a minute while the API wakes.

**Live reads the same Neon database this repository's `.env` points at.** That
was established rather than assumed: a sign-in attempt for an address that does
not exist wrote its "no such account" line into *this* database. So anything
changed here is already changed live — the demo people were removed once, not
twice — and the `ai_corrections` step below is already done.

Render generates its own `JWT_ACCESS_SECRET`, so a token minted from this
repo's `.env` is refused by the live API. That is correct and worth knowing
before debugging a puzzling 401: to reach live you sign in, you do not mint.

Verified after the 2026-08-15 deploy, against the deployed site rather than a
local build:

```
sign-in through the live web app        the Vercel rewrite reaches Render and
                                        the cookie comes back
the API is the new build                quarter 9 refused, with its reason
                                        the over-deposit figure is present
the team                                18 — the seven demo people are gone
payroll                                 empty, waiting for the first real run
balances                                match this database to the paisa
a write without the custom header       403 — the CSRF guard is on
every screen, 4 widths, both themes     112 renders, nothing flagged
```

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

`deploy/restore.sh` is written for the VPS, where the database is a container
it can reach through `docker compose`. Today the database is Neon, so the drill
runs by hand:

```bash
# 1. Dump. Read-only; safe against the live database at any time.
pg_dump --dbname="$DATABASE_URL_UNPOOLED" --clean --if-exists --no-owner \
        --no-privileges -f sfm.sql

# 2. Restore somewhere that is NOT production. A scratch server, a Neon branch,
#    anything but the database you are trying to protect.
createdb -h localhost -p 5599 -U postgres sfm_restore
psql -h localhost -p 5599 -U postgres -d sfm_restore -v ON_ERROR_STOP=on -f sfm.sql

# 3. Point the API at it and sign in. Steps 1 and 2 passing prove nothing on
#    their own — a restore nobody has signed in to is not verified.
DATABASE_URL=postgres://…/sfm_restore PORT=4188 npm run start -w @finance/api

# 4. Delete the copy and the dump.
```

Do this again after any schema change, and delete the dump when finished.

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

## Next: which tools each person uses (asked for 2026-08-18)

**Not built yet — waiting on the data.** The owner will send the AI & tools
data and the changes to that page; the shape of the link should be obvious
from it. Recorded now so it is not re-derived from scratch later.

**What was asked for.** A section on a team member's page listing the paid
tools that person uses, with tabs for Active / Cancelled / Paused / All, and
every tool they have *ever* been on — history, not just what is live today.

**What exists.** `vendors` already carries the subscription itself:
`billingCycle`, `billingAmount`, `billingCurrency`, `nextRenewalOn`,
`billingAccountId`. What it does not carry is anybody's name.

**Three things the current schema cannot express, and they decide the design:**

1. **A tool has two states, and this needs four.** `vendors.isActive` is a
   boolean and it means archived-or-not, which is a different question from
   whether a subscription is running. Paused and cancelled both land on
   `false` today and cannot be told apart.

2. **A column would be wrong; this is many-to-many.** One Claude or ChatGPT
   Team seat is used by several people, and one person uses several tools. A
   `team_member_id` on `vendors` can only say "this tool belongs to one
   person", which is false the first time two people share a seat.

3. **"Every tool they have ever used" means the link needs dates.** A row that
   only says "Mirza uses Claude" cannot answer "what was Mirza on in June".
   The link needs a start, an end, and its own status — which is *not* the
   tool's status: a subscription can be perfectly active while one person's
   access to it was cancelled in July.

So the likely shape is a join table — person, tool, from, until, status — and
the tabs read from the link's status rather than the vendor's. That also gives
"what does this tool cost us per person" for free, which nothing answers today.

**What to send, so the first version is right rather than a guess:**

- For each tool: is it running, paused or cancelled, and since when?
- Who is on each tool right now?
- Anybody removed from a tool earlier — who, which tool, roughly when? (This
  is the part that cannot be reconstructed later; the rest can be read off a
  bill.)
- Whether seats are counted per person or the tool is one flat cost, since
  that decides whether a per-person figure is real or a division.

## Next: the Cash In form, as the spreadsheet actually needs it (asked 2026-08-18)

**Not built yet.** Thirteen fields were specified, all required except the
note, all shown in the table.

**Already there:** date, landed-in account (dropdown, staying as it is), USD
sent, dollar rate, amount received, transaction id, description, and the
sender's bank name / account name / account number.

**Missing:** serial number, invoice number, the invoice PDF, the bank
statement screenshot, and an optional note separate from the required
description.

The uploads are less work than they look: the `files` table, the upload
endpoint, the type sniffing and the private-serving rules all exist already —
this is a second and third attachment point, not new machinery.

### The one thing to get right: three money fields, two facts

BDT, USD and the rate are given as three inputs, and any two of them decide the
third. Three independent boxes means they can disagree, and **in the sheet that
was sent, one row already does**:

```
INV-002   BDT 18,87,619.00   USD 15,600.16   rate 122.77
          18,87,619 ÷ 15,600.16  =  121.00 exactly
          15,600.16 × 122.77     =  19,15,231.64   ← ৳27,612.64 more
```

The other three rows are exact to the paisa at their stated rates. So INV-002's
rate column is wrong, or its amounts are — and nothing in a spreadsheet says
which.

The remittance itself only has two facts: the CEO sent a number of dollars, and
the bank landed a number of taka. **The rate is not a third fact, it is the
result** — which is exactly how the funding report already treats it, showing
"what was sent, what landed, and the rate that transfer really achieved". So
the form should take USD and BDT and show the rate computed, read-only, as it
is typed. INV-002 then cannot be entered at all, which is the point.

Worth confirming with the owner before building, since it means one box on
their sheet becomes an output.

### Two smaller questions

- **Serial number** — the sheet's SL is 1, 2, 3, 4, which is row order rather
  than a value. Entries already carry `ref_no` (`TXN-2026-000412`). Is SL a
  number to store, or the invoice number doing that job?
- **Clickable cells** — transaction id and invoice number open the uploaded
  documents; the BD bank opens that account's page. That last one needs the
  section below to exist first.

## Next: accounts and cards have no page of their own (asked 2026-08-18)

**Not built yet.** `/accounts/[id]` exists but renders only the register — the
running balance, entry by entry. Everything the account itself holds has a form
to enter it and nowhere to read it back: bank name, branch, account number,
routing number, SWIFT, currency, type, opening balance and its date, and notes.

So: a View details button on every account and card, leading to a page that
shows all of it. The register stays; this sits with it rather than replacing
it.

This is also what the Cash In table's bank link points at, so it comes first.

## Next: the AI & tools tracker, as the sheet actually is (data received 2026-08-18)

**Not built.** The owner sent the CSV export of `Master_Input`, screenshots of
all four dropdowns, and the person-by-tool matrix that sits below the data.
Recorded here because the sheet answers most of the design questions the
earlier note asked.

### What the sheet is

**Each row is not a tool.** It is one person's subscription to one tool for one
billing period. Claude Pro appears nine times because seven people are on it
and some have renewed - khairul@ has June (Expired) and July (Active): one
subscription, two months.

**The matrix underneath is the many-to-many link**, and it settles the question
the earlier note left open:

| tool | rows in Master_Input | people marked Yes |
|---|---|---|
| Clickup | 1 - $130, "13 seats", omar@ | 12 |
| Github | 1 - $40, nizam@ | 9 |

One subscription, twelve users. A `team_member_id` column on `vendors` would
have lost eleven of them.

**The email is the account holder, not the user.** Github is under nizam@ and
nizam does not appear in the matrix at all. Who pays and who uses are different
questions and the app needs both.

### The four dropdowns, from the screenshots

- **Category** — AI Tool, Development, Marketing, Design, HR, Productivity,
  Management, eSIM, Server Support, Finance
- **Billing Cycle** — Monthly, Annually, quarterly
- **Status** — Active, Paused, Canceled, Expired
- **Payment Method** — Card, PayPal, Bank Transfer, paypneer

### Answered by the owner, 18 Aug

- **Five tabs**, final: Active, Paused, Canceled, Expired, All.
- **Nobody is matched to a name.** The sheet's matrix and its seventeen names
  are not imported. Instead a subscription records the **team it was bought
  for** as free text, and **who uses it** is chosen from the app's own active
  team members.
- **The login email stays free text** — it may not be an office address, so it
  is a label rather than a person.
- The red marks, the three Claude spellings, the price differences and the
  empty columns are **not worth chasing**: the data is dummy, and what matters
  is the shape.

### The shape, decided

Two tables, because a tool and a subscription to it are different things -
Claude is one vendor and nine of these.

**`subscriptions`** — one plan, one price, one lifecycle:

| column | type | why |
|---|---|---|
| `vendor_id` | uuid → vendors | the company. Claude, Figma, Github |
| `plan_name` | text | "Max Plan 5x", "Professional Full seats" |
| `category` | enum | the sheet's ten, as an enum so it cannot drift |
| `cost_usd` | numeric(14,2) | the price as billed |
| `cost_bdt` | numeric(14,2) | what the card was actually charged |
| `usd_rate` | numeric(18,6) | the rate that charge worked out at |
| `billing_cycle` | existing enum | none / monthly / quarterly / yearly - already in the app |
| `start_date` | date | |
| `next_renewal_on` | date, nullable | nullable is what "Credit Base" needs |
| `renewal_note` | text, nullable | and this is where that phrase lives |
| `status` | enum | active / paused / canceled / expired |
| `payment_method` | existing enum | plus `payoneer`, which the app lacks |
| `account_id` | uuid → accounts, nullable | which card actually pays it |
| `bought_for` | text | "Engineering Core" - the team, as typed |
| `login_email` | text, nullable | a label, not a person |
| `screenshot_file_id` | uuid → files, nullable | opened from the tool's name |
| `notes` | text, nullable | |

**`subscription_users`** — subscription × team member, both keys.

Chosen over a single `user_id` because it costs nothing and the sheet already
needs it: Clickup is one row and twelve users, Github one row and nine. Picking
one name from the dropdown is the same gesture as picking twelve, and it is
what makes "which tools is this person on" answerable for shared seats too.

**All three money columns are stored, on the owner's instruction.** I argued
for dropping BDT and the rate - they are empty in all 32 rows, and the app's
usual rule is that a dollar price is the fact and taka is a reading of it. The
owner needs all three, which is their call, and it is recorded here as theirs
rather than re-argued later.

They come with one thing attached, because the alternative is the fault already
found in the Cash In sheet: **the form takes two and computes the third.** Type
USD and BDT and the rate appears; type USD and the rate and BDT appears. All
three are stored, and none of them can disagree with the other two - which is
exactly what INV-002 does today, off by ৳27,612 with nothing to say which
column was wrong.

### Enums — the sheet's values are final, so missing ones get created

| set | decision |
|---|---|
| `subscription_category` | **new** - the sheet's ten, exactly |
| `subscription_status` | **new** - active, paused, canceled, expired |
| `payment_method` | **extend** the existing one with `paypal` and `payoneer` (the sheet's `paypneer`) |
| `billing_cycle` | **reuse the shared array — but it is NOT a pgEnum.** `vendors.billingCycle` is `text("billing_cycle").notNull().default("none")`; only the shared `BILLING_CYCLES` array and its zod schema constrain it. An earlier version of this note called it an existing enum, which was wrong. Declaring the new table's column as a pgEnum would make two tables disagree about the same idea, one checked by Postgres and one not. The sheet's Monthly / quarterly / Annually are the existing monthly / quarterly / yearly, and the screen shows the sheet's wording. |

### Also asked for### Also asked for

An upload field for a screenshot of the tool, viewable by clicking the tool's
name in the table - the same pattern as the Cash In invoice and statement. The
`files` machinery already covers it.

## Next: the All Transactions table (asked 2026-08-18)

Nine columns wanted: SL, Date, Type, Category, Description, Reference No.,
Amount (BDT), Amount (USD), Rate. Reference No. opens the attached document.
Money in shows `+` in green, money out `-` in red.

**The sign and the colour are already built.** `transaction-table.tsx` renders
`<Amount showSign tone={direction === "in" ? "in" : "out"} />` today. Nothing
to do there.

### What differs from the table as it stands

| wanted | today |
|---|---|
| SL | not present; `Ref` is (`TXN-2026-000412`) |
| Type | no column - the sign and colour carry it |
| Reference No. | present, **not clickable** |
| Amount (USD) | not a column - a second line under the taka |
| Rate | not a column - a badge on rows that have one, plus the page-foot caption |

And two columns exist that the sketch does not have: **Party** (vendor or
counterparty) and **Account** (which bank or card).

**To confirm before building:** whether SL is needed when `Ref` exists; whether
Party and Account stay - dropping Account loses "which card did this leave
from"; and whether Type earns its own column when the colour already says it.

### One thing about the sketch itself

The owner has said not to audit dummy data, and this is the last time it comes
up - but it is a structural fault in the template rather than a typo, and it is
in the column the request is about.

**`Amount (USD)` is `Amount (BDT)` shifted up one row:**

```
row 1   BDT 18,87,619   USD  13,35,000   <- row 2's BDT
row 2   BDT 13,35,000   USD   4,10,323   <- row 3's BDT
row 3   BDT  4,10,323   USD   1,42,296   <- row 4's BDT
```

The USD column also carries the taka symbol. INV-002's real USD figure is
$15,600.16 in the Cash In sheet, not 13,35,000.

The app cannot reproduce this - the two amounts are separate stored columns and
there is no operation that slides one against the other. It is noted only
because starting the real books from this template would carry the error in.

## Next: Other Expenses (asked 2026-08-18)

Nine columns: SL, Date, Category, Description, Amount (BDT), Amount (USD),
Payment Method, Reference No., USD Rate. Reference No. opens an attached
screenshot. Choosing the "Others" category during entry offers a screenshot
upload.

**This is not a new page.** `/expenses/other` already exists and is already
"everything except tooling" - the sheet's own header says "Excluding AI &
Tools", and the API has an `excludeToolSpend` predicate built on the same
definition the tools screen counts with. The work is changes to that screen,
not a new one.

**The figures in this sheet are internally consistent**, unlike the All
Transactions one: 44,816 / 370.38 = 121.00, 25,935 / 214.34 = 121.00,
140,000 / 1,147.54 = 122.00. Exact.

**Payment Method needs nothing new.** Bank Transfer, Cash and Mobile Banking
are all already in the app's `payment_method` enum.

**Two rows carry no USD at all** - the cash one and the mobile banking one -
which reads as deliberate: there was no conversion, so there is no dollar
figure. Worth confirming, because the alternative (always translate at the
app's rate) is a different column.

**Reference No. is empty in all five rows** and is the field that is meant to
be clickable. Open question below.

## What the convention sweep found (2026-08-18)

Twelve agents mapped the six subsystems the new work has to match, each map
then checked against the files by a second agent. The findings that change
what gets written:

- **`billing_cycle` is plain `text`, not a pgEnum.** Corrected above.
- **"Subscriptions" already exists as a *view*, not a table.** There is
  `packages/shared/src/subscriptions.ts`, `GET /vendors/subscriptions`,
  `GET /exports/subscriptions`, and a `subscription-payment-form.tsx`. Every
  figure in it comes from the ledger on purpose - the file says a stored
  "renews on the 3rd" is a habit rather than a schedule, and a monthly total
  built from it would assert spending that may never have happened. The new
  stored table must sit *beside* that view without contradicting it.
- **Attaching a file to a new kind of owner is not one change but five**, and
  four of them fail in ways that do not look like the cause: the
  `files_one_owner` check constraint (sums the owner columns and demands
  exactly 1, so a new column alone makes every upload rejected), `ownerOf()`
  (miss it and reads and deletes 404 with a message that reads like data
  corruption), `OWNER_PERMISSIONS` (**`GET /files/:id/content` carries no
  `@RequirePermission` - that map is the only gate, so a missing entry serves
  bytes to any signed-in user**), `KINDS_BY_OWNER`, and `SINGULAR_KINDS`.
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
  value and anything using it must be separate.
- **`packages/shared` is consumed as built `dist/`.** Editing `src` changes
  nothing until it is rebuilt.
- **HR's `vendors.read` is load-bearing for navigation**, not incidental - the
  whole Expenses group survives the sidebar filter only because that child
  does. Gating the tools screen on a new permission HR lacks removes the group.

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
**12 places across 6 modules**: transactions (create, update ×2, void,
transfer), accounts (opening balance), payroll (mark paid), TDS (deposit),
income tax (payment), and imports (preview and commit). None of them sit behind
a condition.

The subtle one is `transactions.update`, which checks *two* dates — the one the
row currently sits on and the one it would move to. A guard on the incoming
date alone would look correct and still let anybody backdate a payment into a
signed-off month.

What was actually missing was a **test**. Enforced-but-untested is the exact
shape of thing this repository keeps getting bitten by: it looks finished from
every angle until somebody adds a write path and forgets the line. That is now
`apps/api/test/integration/13-closed-books.mjs`, which closes the books, tries
each way of changing money against a row inside the period and a row outside
it, and — the point of the suite — proves an open row cannot be backdated in.
Every refusal is paired with the same call succeeding once the lock is lifted,
so a passing run cannot come from a malformed payload.

Note it clears the lock in a `finally`. The other suites restore their settings
on the way out, which is fine for a cosmetic one; a suite that died holding
*this* lock would leave every write in the app refused until somebody noticed.

**It has not been run yet.** `apps/api/.env` points at Neon and the live VPS has
its own Postgres, so until it is settled which database that is, closing the
books against it is not something to do unattended. Run it with
`npm run test:integration -- 13`.

## Two-step sign-in, and the screen left open (2026-08-18)

Both shipped, and the architecture page's roadmap is down to two items, neither
of which is in the application.

**Two-factor.** TOTP written out rather than installed, because RFC 6238
publishes test vectors and that makes the tests a check against the standard
instead of a recording of whatever the code does. Enrolment shipped a deploy
ahead of the check at sign-in, so nobody could be locked out by the feature
arriving — and the check is per account, not a switch, so anybody who has not
enrolled still signs in as before.

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

**Idle timeout.** Twenty minutes, a minute's warning, then out. Three details
that the obvious implementation gets wrong: it compares timestamps rather than
using `setTimeout` (a closed lid suspends timers, so a laptop shut at six and
opened at nine would sign out twenty minutes into the morning); the last
activity is shared between tabs through localStorage; and once the countdown is
up only a click dismisses it, because a knocked desk should not keep a finance
system signed in all night.

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

## Next: Statement is really Reports, and Reports becomes a bank statement (asked 2026-08-19)

**Not built.** To be picked up only after the All Transactions and TDS work is
pushed — the owner was explicit about the order.

### The rename

`/statement` is named wrong. Its contents are right — the owner said so — but a
reconciled period position with an executive summary and a sign-off is a
**report**, not a statement. It takes the name Reports.

What is called Reports today gives up that name and becomes **Bank statement**:
the actual movements on the bank's own ledger, which is the thing an accountant
means by the word.

### What a bank statement is here

The columns, from the sheet the owner sent:

```
SL | Date | Description | Debit | Credit | Balance
```

It is another view of the same ledger All Transactions reads — in and out split
into two money columns instead of one signed one, with the running balance
after each line. The register at `/accounts/[id]/register` already computes a
running balance the same way; this is that, without being tied to one account.

Plus one column the sheet does not have and the owner asked for by name: the
transaction's own id, clickable, opening whatever is attached to it. Their
reasoning is worth keeping: *"we are uploading a document on every transaction,
aren't we?"* — so the statement is where somebody goes to check that.

### Filtering

Deliberately almost none: a start date and an end date. Nothing else.

And the dollar/taka switcher comes off, matching every other screen — taka
large, dollars underneath it, always both, never a toggle.

### One thing to ask before building

*"table er khetre usd and bdt er jonne only new row add hote pare"* — for USD
and BDT only a new row may be added. That reads two ways: a second **column**
for the dollar figure, or the dollar figure on a second **line inside the same
cell**, which is what every other table on this app does. Ask rather than guess.
