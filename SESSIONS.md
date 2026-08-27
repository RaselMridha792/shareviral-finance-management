# What each session changed

Newest first. **Add an entry when you finish a piece of work** — this is the only way another
session, or the owner, learns what you did. Several sessions run on this repository at once.

Keep an entry short: what changed, what it means for anybody else, and anything left open. Say
what is *not* finished as plainly as what is. A half-built feature nobody flagged is worse than
one nobody started.

```markdown
## YYYY-MM-DD — one line naming the work

**Done.** What changed, and why it mattered. Commits: `abc1234`.

**Watch out.** Anything another session would trip over — a file you rewrote, a migration that
must run, an assumption that is no longer true.

**Open.** What you did not finish, and what the next person needs to know to pick it up.
```

---

## 2026-08-27 — "Rate this month" comes off Cash In

**Done.** One page, on the owner's instruction, and only that page. The strip above the table had
two cells; the second — "Rate this month", the figure plus the "Set by TXN-… on …" caption naming
the entry that fixed it — is gone. The strip is one cell now, "Received in {month}", and
`StatStrip` already stretched a lone cell across the row: that path existed for a reader without
`dashboard.money`, so it is the tested one rather than a new one.

**The rate is still fetched, and must be.** It is behind two things the cell did not own: the ~$
under the taka total, and the USD column for any row carrying no rate of its own (`dollarsOf`
falls back to the month's). Deleting `loadRate` to tidy up would blank both. What went with the
cell is only what nothing else read — `setBy` and the `firstFunded` helper behind it, which
existed to name the transfer in that caption.

The rate itself is not lost to a reader: the table's own **USD rate** column still carries the
rate each row was recorded at, which is where somebody checking a particular receipt looks anyway.

**Watch out.** `canSeeRate` (`dashboard.money`) now gates a *figure* rather than a cell —
without it the dollar line under the total is absent and the taka is untouched, which is why that
request is still allowed to fail quietly. `trimRate` is still used, by the table column;
`rateStatus` is still read, for the "No rate on record for this month" line under the total.
Nothing outside this file changed — the strip on other screens, the dashboard's FX badge and
Reports are untouched.

Measured on the running page, not read off the diff. `.ratebox.mjs` (untracked) walks all four
months in the picker and checks each: no "Rate this month" heading, no "Set by TXN-…" caption, no
`currency_exchange` icon anywhere in the document, while the strip keeps its taka and ~$ pair and
the table keeps its USD rate column. August's single receipt still reads ~$979.59 off the month's
rate with no rate of its own, which is the fallback proving the fetch survived. Four CI steps run
separately, all green (315 tests).

**Open.** Nothing half-done.

## 2026-08-27 — Cash In's month becomes a dropdown, and moves next to Add cash

**Done.** One page, on the owner's instruction. Cash In's month was a native `<input
type="month">` sitting alone in a `FilterBar` below the title — a field you type "mm/yyyy" into
or open a calendar popover for, and which says nothing about how far back the books go. It is now
the same `MonthPicker` dropdown the three expense screens got this morning: every month from
this one back to `RECORDS_START`, newest first, nothing greyed, growing on its own. Picking a
month resets to page one, which the old input already did.

It also moved into `PageHeader`'s `actions`, immediately left of "Add cash" — the shape
Expenses and Other expenses already use. The filter row is gone with it, so the stat strip sits a
line higher. A read-only user still gets the picker: `actions` is a fragment now rather than
`canWrite ? button : null`, so the month survives when the button does not.

`MonthPicker` itself is untouched — this is a new consumer, not a change. It still lives at
`components/expenses/month-picker.tsx` and is now imported from `components/accounts/`, which
is the first cross-folder use. Nothing about the expense screens changes.

**Watch out.** `MonthPicker` speaks `{from, to, label}` while this screen keeps its month as
`YYYY-MM`; the header converts both ways (`range.start` out, `next.from.slice(0, 7)` in).
`controlClass`, `FilterBar` and `cn` are no longer imported here — they had no other use on
the page. Still months and not the shared date range, deliberately: the totals are a month's and
the rate is asked for by fiscal year and period index, so a free from/to would name no period.

Measured on the running page, not read off the diff. `.cashin.mjs` (untracked) loads
`/accounts/cash-in` signed in and reads the DOM: the select is there, the old month input is
gone, four real options (August back to May 2026) with none disabled, and the box sits 8px left of
"Add cash" on the header row rather than in a row of its own. Picking July re-scoped the screen —
select, "Received in July 2026" heading and the table's first row all followed. Four CI steps run
separately, all green (315 tests).

**Open.** Nothing half-done. If `MonthPicker` picks up a third feature folder it probably wants
to move under `components/ui/` — that is a shared move and needs the owner's word, so it was
left alone.

## 2026-08-27 — Money Transfer has a page

**Done.** `/transfers`, "Money Transfer" under Money in the rail. Commit:
`fab219f`. The machinery all pre-existed — the paired-row endpoint, the
never-mounted `TransferForm`, pair-aware void and trash, the overdraft guard on
the paying side — and none of it had a door. The page lists one row per pair
(from → to, one amount), records through the existing form, voids and deletes
the pair from the row.

Three deliberate choices worth knowing:

- **No edit button on a transfer, and it is not a gap.** The update endpoint
  touches one row; editing half a pair would leave the two accounts
  disagreeing, which is the fault the pair exists to prevent. Void and record
  again.
- **`transferSchema` now refuses a zero amount** (packages/shared — rebuild
  dist), the refusal its sibling create/cash-in schemas always had.
- **`VoidDialog`'s prop narrowed** to `VoidableTransaction` (a `Pick` of the
  nine fields it reads). Every existing caller still passes a full
  `TransactionDto`; the change is structural only.

Also: the form's account pickers now say each account's balance beside its
name, and the new `GET /transactions/transfers` route sits **above**
`transactions/:id` in the controller — routes match in order.

**Watch out.** `ledgerApi.listTransfers` / `TransferRowDto` in `lib/ledger.ts`;
the nav item and the `/transfers` proxy gate ride `transactions.read`, the
transfer action `transactions.write`.

**Open.** Nothing on the page itself. The transfers listing has no date filter
yet — at twenty a page that will want the FilterBar treatment like every other
list. `.transferqa.mjs` (21 checks, API and browser both) is the harness.

---

## 2026-08-27 — the five fixes: no minus, the bank under the heading, blue links, delete that leaves, errors that explain

**Done.** The owner's five items from live use, plus what checking them turned
up. Commits: `f0059f6` (the balance rule), `6d54f5a` (honest errors),
`d36e7c8` (dashboard, links, payroll's stale delete).

**The balance rule is the one to know about.** An account can never go below
zero — enforced in `apps/api/src/common/money/overdraft.ts` and asserted inside
the same database transaction at every door money moves through: create, edit,
void, transfer, import commit, import revert, payroll pay, company-tax pay, TDS
challan, trash delete, trash restore, and the account's own opening balance.
Two conditions: the account's lowest historical day (catches backdated entries)
and its present balance. An account already negative still accepts deposits and
is only refused what makes it worse. **Anything new that writes transactions
must call `overdraftWatch` before its mutate and `watch.assert(tx)` after the
write** — `.overdraftqa.mjs` (25 checks) is the harness that will catch a
missed one.

**Deleted twins now explain themselves.** Creating a payroll month, a sign-in
email or a category name that clashes with a trashed row says it is in the
trash and how to free it; writing a deleted day's FX rate revives the day —
before this the new figure landed on the deleted row and vanished with it.
And `toError` in `api-client.ts` lifts the first field error into the message
when the API says only "Validation failed", so every screen names the actual
problem.

**Watch out.**

- **`--link` token** (globals.css, both themes, mapped as `--color-link`): every
  clickable text in a table is now `text-link underline decoration-link/40
  underline-offset-2 hover:decoration-link`. New table links should use it.
- **`SectionHeading` gained an optional `subtitle`** (ui/patterns.tsx) — the
  title is now wrapped in a div; callers without subtitle render as before.
- **`AccountGroup` gained `bankName`/`accountNumber`** (packages/shared —
  rebuild dist before typechecking).
- The dashboard hides accounts with zero opening, zero in, zero out for the
  viewed month; all hidden at once renders a sentence, not a bare Edit button.
- Payroll list: rows are `useState(initialPage)` — its delete refetches via
  `goToPage`, **never `router.refresh()`**; the same trap holds for any screen
  that copies a server prop into state.

**Open.**

- The overdraft guard's known hole: two concurrent writers on one account can
  jointly overdraw at read-committed isolation — documented in the file head,
  accepted for a team this size.
- Drawer forms that render field errors under fields now repeat that sentence
  in the banner (the banner used to say "Validation failed"). Cosmetic;
  suppressing the banner when field errors exist would be a 14-file sweep.
- The TDS amount cell on the salary sheet opens a drawer but keeps its plain
  money styling — underlining a figure would fight the money-column semantics.
  Decided, not missed.
- `seed-demo.ts` writes transactions unguarded (dev seeder, reaches Neon).

Harnesses: `.overdraftqa.mjs` (25 API checks, every door), `.fivefixui.mjs`
(12 browser checks: computed link colour+underline, dashboard subtitle, hidden
sleeper, delete-without-reload), `.delsweep.mjs` now counts only real rows.

---

## 2026-08-27 — deleting exists, and deleted rows count for nothing

**Done.** Every table that holds a row somebody typed can now delete it, the row
goes to a trash in `Settings → Trashed`, and nothing deleted enters a total.
Commits: `3c77fe8` (migration), `1880772` (API), `baaec88` (UI), `46bf9a6` (the
category lookups), `4aa0faa` (the chart of accounts).

The design decision worth knowing, because everything else follows from it:
**deleting a money row also voids it.** Twenty-nine query sites across nine
services already exclude voided rows, so a deleted transaction left every sum in
the application without one of those queries being edited. The list filters added
on top only decide visibility — and if one were ever missed, the failure is a
row visible where it should not be, not a total quietly wrong. The dangerous
failure was made impossible; the harmless one was left possible and obvious.

Fifteen kinds are deletable, listed in `apps/api/src/modules/trash/trash.registry.ts`
with the permission each needs and, where one applies, the reason it may be
refused: the last super admin, an account or category or vendor or person with
entries against it, a paid payroll run, a committed import. `audit_logs` is not
deletable and must not become so — a delete that can erase its own trace makes
the trash worthless. Payslips, TDS allocations and import rows are not deletable
either: they are derived from a parent, and removing one alone leaves that
parent's total no longer adding up.

Ten screens carry the button: all transactions, register, cash in, other
expenses, category detail, team, subscriptions, sign-ins, payroll runs, rate
history. `RowActions` gained an **optional** third button, so the eleven screens
not yet wired are byte-for-byte unchanged.

**Watch out.**

- **`RowActions` and `TableScroll`'s neighbours changed.** `RowActionsHead` now
  takes `deletable` and renders `w-32` instead of `w-24` when it is true. If a
  table looks narrow in the last column, that is why.
- **Rate history behaves differently.** It held the app's only irreversible
  delete; a rate now goes to the trash like everything else and can be restored.
- **Two migrations must run**: `2026-08-26-trash.sql` and
  `2026-08-26-categories.sql`. Both are idempotent and both were applied locally
  with `node .sql.mjs`. The categories one was run three times: still sixty-three
  rows, no duplicates, and a heading renamed by hand stayed renamed.
- **The category name lookups were wrong and are fixed.** Payroll resolves
  "Salary" and a challan resolves "TDS deposit" by name, and both checked
  `is_active` without checking `deleted_at`. Anything else that resolves a
  category by name needs the same clause.

**Open.**

- **Eleven screens have no delete button yet**, and `node .delwired.mjs` names
  them. Most are correct as they are — audit, payslips, TDS deductions, the
  report tables, tool seats are all either immutable or derived. The ones a
  future session might genuinely want are the imports list and a team member's
  salary history.
- **Only the nine wired screens were driven in a browser** (`node .delsweep.mjs`).
  The API was exercised for every kind (`node .trashqa.mjs`, `node .trashroles.mjs`),
  but restoring a payroll run or an import batch has not been watched on screen.
- **The trash has no age limit.** Nothing empties it on a schedule; somebody has
  to press the button. That is deliberate for now — an automatic purge is a
  delete nobody witnessed — but it means the trash grows.

The scripts: `.trashqa.mjs` (21 API checks), `.trashroles.mjs` (every role,
allowed and refused), `.trashui.mjs` (17 checks driving the dialog as a person
does), `.delsweep.mjs` (opens each wired screen and presses the button),
`.delwired.mjs` (names any screen with a button and no dialog — it caught one),
`.delfilter.mjs` (reads of a deletable table with no deleted filter),
`.gencats.mjs` (regenerates the categories migration from the seeder's tree).

---

## 2026-08-26 — the database is empty, and the four foundations are proven

**Done.** The sample data is out and the system is ready for real figures.
`deploy/clean-for-production.sh` emptied 28 tables and kept five — the five
sign-ins with their second factor and recovery codes, the `app_settings` row
with every credential cleared, and `schema_migrations`, because emptying that
would make the next deploy replay a directory that is not order-independent.

**Two faults that only exist in an empty database, both fixed.** They are worth
naming because every new installation starts in exactly that state and nothing
before today had ever looked at it.

- `/statement` called `notFound()` when there were no accounts, so a company on
  its first day followed the link in its own sidebar and was told the page does
  not exist. It says which thing is missing now. The app's other two
  `notFound()` calls are the honest kind and stay.
- **Settings → Salary TDS could not create the first tax rule.** The panel drew
  the editor only when a rule already existed, so a fresh install could not
  deduct tax at all — and the one message it showed pointed at "Settings →
  Tax", a tab that has not existed since it was renamed. The form opens on
  `DEFAULT_TDS_POLICY` now, under a notice saying plainly that nothing is
  saved, nothing is being deducted, and the figures are a starting shape rather
  than this year's circular.

**Proven, not assumed, before going live.**

| | |
|---|---|
| Backups | Nightly at 02:00, gzip checked, table and row counts asserted, copied to Google Drive and **verified byte-for-byte on the far side**. Fifteen copies off the server, plus the uploads. |
| Restore | The 25 August dump restored into a scratch database: 33 tables, 705 transactions, 120 team members, 5 users — the pre-wipe state exactly. Dropped afterwards; `sfm` never touched. |
| Certificates | 79 days, all three hostnames, `certbot.timer` active and running. |
| Application | Nineteen screens, the ledger arithmetic in SQL, 65 role-and-route combinations, HR blind to salary, and create/edit/void moving the balance by exactly the right amount. |

**Watch out.**

- **The pre-wipe data is recoverable until about 25 September** — thirty days of
  dumps sit in Drive. After that the sample ledger is gone for good.
- `db.hellonizam.com` is Adminer, reachable from the internet behind basic auth
  and a rate limit. A database console on the open web is a standing decision,
  not an oversight — but it is a decision.
- Nothing monitors the site. If it stops at three in the morning, nobody knows
  until somebody opens it.

**Open.**

- **Payroll finalise and pay have never been run.** That is the path that moves a
  whole month's salary, and the first real run should have its totals checked by
  hand.
- Writes were exercised through the API, not through the forms. The forms open
  and carry their fields; nothing has submitted one.

## 2026-08-21 — three revisions on the subscriptions page and the mail it sends

**Done.** Three things the owner asked for after using the app.

**Newest plan at the top.** The subscriptions list led with the next renewal date, on the
reasoning that "what is about to bill" is the commonest question. It is not the commonest
*action* — adding a plan is, and a new row landing mid-page, sorted by a date nobody has thought
about yet, reads as not having saved. `created_at desc, id desc`; the id makes the order total, so
two plans added in the same second cannot swap places between page loads and show twice in a
pager. The profile's Paid tools follows, since the point of the two sharing a component is that
they cannot disagree.

**The renewal mail has a shape.** It went out as a paragraph and a bare table. There is a header
that identifies the sender, the figures on their own panel, and one button doing the one thing
the message asks for. `email-layout.ts` holds it, and the test message uses the same wrapper — a
test that looks different from the real thing tests the sending and not the message.

**The FX chip is off the top bar**, on instruction.

**Watch out.**

- **Nothing on any screen now states the exchange rate.** The dashboard's rate caption was removed
  earlier on the stated understanding that the top bar chip still named it everywhere — that was
  the argument for the caption going. Both are gone now. The rate lives in Settings → Exchange
  rate, which is not somewhere a reader passes by accident. Every dollar figure is still a
  translation of a taka one; only the label saying so has gone.
- Email is not a browser: `email-layout.ts` is nested tables and inline styles on purpose, and the
  button is a table cell because a styled `<a>` loses its padding in Outlook. The mark is drawn
  from a coloured cell and a character rather than an `<img>`, which is blocked by default in
  about half of inboxes. Do not "tidy" any of that into CSS.

**Open.** Nothing from this piece. The mail was rendered and looked at rather than reasoned about,
but only in Chrome — Outlook and Gmail's own renderers are the ones that would surprise us, and
the honest test for those is sending one.

## 2026-08-21 — Import and Export, and the em-dash that broke a download

**Done.** `/import` is `/data` and the screen has two tabs. Import is what was already there,
four steps and untouched. Export is where every button removed from the other screens went — nine
datasets, each pointed at the endpoint its old button used, so the sheet is still the list
endpoint's own output and "the file matches what the screen would have shown" stays a property of
the code. No column picker, for the same reason. Commits: `<this push>`.

The controls a dataset offers are exactly the ones its endpoint reads. The query schemas are
`strictObject`, so a stray key is a 400 — but the quieter reason is that a date range on a dataset
with no dates narrows nothing and says nothing, and somebody takes the whole file for a filtered
one. The dataset list is cut to what the reader may already see; that is a courtesy, and every
endpoint keeps its own `@RequirePermission` behind it.

**A pre-existing bug came out of testing it.** `Content-Disposition` carried the filename raw, and
a header value may only hold Latin-1. Three accounts here are named like "BRAC Bank — payroll", so
the register export threw `ERR_INVALID_CHAR` and came back a 500 with nothing on screen to say
why. The same helper serves every sheet and every PDF, so this was one non-ASCII vendor or person
away on any of them — and this is a Bangladesh company. Both RFC 5987 forms now.

**Watch out.**

- **`proxy.ts` needed `/data` adding, and that is not cosmetic.** `deniedBy` returns null when no
  prefix matches, so a route absent from `ROUTE_PERMISSIONS` is gated by nothing. Renaming the
  path without it would have taken a screen out from behind `imports.run` and opened it to every
  signed-in role. `/import` keeps its entry so the refusal happens at the old URL.
- `/import` permanently redirects and carries its query string — the assistant's "Send to Import"
  arrives as `?batch=`, and losing it lands somebody on an empty file picker with their rows
  already staged and invisible. The assistant's two links point at `/data` directly now.
- `ImportScreen` no longer draws a `PageHeader`; `DataScreen` owns it.

**Open.**

- Payroll per-run and the period report are not in the export list. Both need a record chosen
  rather than a date range, and Reports keeps its own export by the owner's rule.
- Verified by calling all nine endpoints and reading the rendered page. Not verified against a
  non-super-admin role: the dataset list should shorten, and the endpoints refuse regardless, but
  that is a `.rolecheck.mjs` run somebody should do.

## 2026-08-21 — a reminder that only fired on one exact day

**Done.** The owner set a plan to renew in two days, waited, got no mail and no bell, pressed
"Run today's reminders now" and was told nothing renews. All three were one bug: both jobs matched
`next_renewal_on = today + 3` **exactly**, so a plan two days out was never a candidate.

Two failures share that shape and neither is exotic. A plan bought inside its own notice period —
Monday for a Wednesday renewal — was never reminded about at all. And one missed run, from a
restart or a deploy landing at nine in the morning, silently spent that plan's only chance. Both
jobs now take the window from today to three days out; `notification_log` and the unique index on
`notifications` keep it to one message per plan per renewal, keyed on the plan's own date rather
than on the moving target.

The button's answer was wrong in its own right: it said "nothing renews in three days" whenever
nothing *sent*, including when it had found four plans and every send had failed. Three outcomes
read differently now — nothing due, nothing new to send, and sent.

`BILLING_CYCLE_LABELS` lost its sentences: "Every month" → "Monthly", and the other three with it,
since "Monthly" beside "Every quarter" is worse than either style used throughout. The email body
was printing the raw enum (`monthly`) where the screen prints a label; it uses the label now.

Measured rather than reasoned about: a plan put two days out on the dev database, then the jobs
run. Before, one of the four plans in the window would have fired; after, the bell raised four
with each plan's own date in its title, a second run raised none, and the mail job attempted eight
messages — four plans, two recipients each. The table and drawer were read from the rendered page:
`["Monthly","Yearly"]` in the column, `Not recurring / Monthly / Quarterly / Yearly` in the select,
and no "Every month" left anywhere on the screen.

**Watch out.** `BILLING_CYCLE_LABELS` is in `packages/shared` and reaches three screens — the
subscriptions table, that same table on a team member's profile under Paid tools, and the
subscription drawer. Asked before changing it. `BILLING_CYCLE_HABIT_LABELS` ("About monthly") is a
different constant, used only by exports, and was left alone.

`RenewalReminderService.run()` returns `{ found, sent }` now, not a number.

**Open.** Nothing from this piece. The window is three days because that is what was asked for; if
it should be configurable, that is a column on `app_settings` and its own session.

## 2026-08-21 — the month becomes a list, and a heading's month stops ending at row 200

**Done.** Two things across the three expense screens, on the owner's instruction.

*The month stepper is a dropdown.* `‹ August 2026 ›` was one click to last month and eleven to
last September, and it never showed how far back the books went. It is a native `<select>` now —
the app's own `Select`, so it carries the same border, height and lime focus ring as every other
control in a filter row, and on a phone it opens the operating system's own wheel. It lists every
month from this one back to `RECORDS_START`, newest first, **with nothing greyed**: the list is
built from months that happened rather than fixed at twelve, so it has nothing to explain. Today
that is four rows, and it grows on its own.

The owner chose to change **all three** screens that share `MonthPicker` — Expense overview,
Other expenses, and the heading page — rather than the two they first named, so no two sibling
screens disagree about what picking a month looks like.

*The heading page's table pages, and neither expense screen stops at 200 any more.* The heading
page had no pager at all: it asked for `pageSize: 200` and rendered the answer whole, so a busy
month ended at row 200 with no pager, no warning and no way to the 201st. It now shows twenty to
a page, newest first, `serial(current, index)` so the first row of page two is 21, and the pager
is a sibling of the table rather than a child of its empty branch. Picking a sub-category tab
returns to page one; voiding the last row of the last page clamps instead of stranding.

Two hundred is the API's ceiling **per request**, and `paginationQuerySchema` is shared, so the
fix is more requests rather than a bigger one: the first reply carries the count and the rest are
fetched together. Other expenses got the same treatment — it already paged correctly, but over a
capped fetch, and it carried a line reading "Showing the most recent 200 of 340 — narrow the
month". That line is gone because the condition can no longer happen, and with it the `fetched`
state that only existed to detect it.

**Watch out.** Other expenses sums its own headline from these rows — no server figure answers
"money out with tooling excluded" — so the fetch there must stay whole. If anybody is tempted to
page it at the request, the headline silently becomes the spend of one page. The comment above
`REQUEST_MAX` says so; please leave it there.

Measured on the running pages, not read off the diff. `.catpage.mjs` and `.otherpage.mjs`
(untracked) seed a month past a page, walk every page front to back, then delete what they
seeded. Heading page, 52 rows: pages of 20/20/12, serials 1..52 unbroken across both breaks,
every seeded row reachable exactly once, dates never climbing back up, Next dead on the last page
and Previous on the first, a tab change landing back on page one, and no pager at all on a month
that fits. Other expenses, 82 rows: 20/20/20/20/2, serials 1..82, the card's heading and the walk
agreeing at 82, and the "Spent in July" headline equal to the sum of every row across all five
pages rather than the page's — ৳12,68,41,084.00 both ways. Both scripts also check the dropdown:
four real months, none disabled, and picking one re-scopes the screen. Four CI steps run
separately, all green (315 tests). Commits: `605e562`.

**Open.** Nothing half-done. The account register got the same twenty-row treatment in another
session this morning; the two arrived independently and both use `@/lib/pagination`, so there is
nothing to reconcile. Screens still on a fetch cap elsewhere in the app were not surveyed — that
is worth its own pass.

## 2026-08-21 — The rate caption comes off every screen

**Done.** On the owner's instruction, and after telling them what it reached first. The line at
the foot of nearly every page — "Dollar figures are approximate, translated from BDT at 121.50
per USD as of Aug 20. Every amount in this system is recorded in BDT." — is gone from the whole
app. Commits: `7cefe54`.

**This was a shared change, and it touched twenty screens.** `RateCaption` lived in
`components/money/` but was rendered by the shell, `layout/main-region.tsx`, under every route
except `/` and the full-bleed `/assistant`. So it was never one page's text: `/accounts`,
`/accounts/[id]`, `/accounts/[id]/register`, `/accounts/cash-in`, `/expenses`,
`/expenses/[category]`, `/expenses/other`, `/import`, `/payroll`, `/payroll/[runId]`,
`/payroll/[runId]/payslip`, `/reports`, `/settings`, `/statement`, `/subscriptions`,
`/tax/withholding`, `/team`, `/team/[id]`, `/transactions`, `/no-access`. The owner was given
that list and chose app-wide over per-page, so the render, the `NO_RATE_CAPTION` list it was
gated by, and `components/money/rate-caption.tsx` itself are all gone — an unreferenced component
left behind is the next session's puzzle.

**Watch out.**

- **The FX chip in the top bar is now the only place the rate is stated.** "FX locked ৳121.50 /
  $1" is on every screen and carries the promise the caption used to: a translated figure says
  what rate produced it. `rate-caption.tsx` used to say in its own comment that removing it was
  not a cosmetic decision; that note now lives in `main-region.tsx`, where the empty space is.
  **If that chip is ever removed, the sentence has to come back somewhere.**
- **`RateProvider` stays.** `useUsdRate` still feeds `Amount`'s dollar counterparts and
  `expenses/category-summary-panel.tsx`, and `useUsdRateContext` feeds the topbar chip. Only the
  caption's consumer went.
- **STATUS.md line 801 is stale**, and was before this: its "what differs from the table as it
  stands" comparison still says Rate is carried by "the page-foot caption", along with several
  other things about that table that stopped being true sessions ago. Left alone rather than
  half-corrected — it wants its own pass.

**Measured, not read off the diff.** `.capsweep.mjs` (untracked, at the root) signs in and visits
all **21 routes**, dynamic ones with real ids from the database, and checks three things on each:
the sentence is nowhere in the page text, the FX chip still is, and the page actually drew — so
"the caption is gone" cannot be satisfied by a screen that failed to load. All 21 clean. `node
.sweep.mjs` then re-measured the layout across every screen: `h1` 28, padding 32/34, gap 20, and
no horizontal page scroll at 1440, 1180 or 900 anywhere — removing a bordered `<p>` from the foot
of the column moved nothing above it.

*One thing that check caught about itself, not about the app:* `/payroll/[runId]/payslip` takes a
payroll **line** id, not a run id, and the payslip is a print document with no heading element at
all. Both were the script's assumptions; the route is fine.

## 2026-08-21 — Twenty entries to a page on the account register, newest first

**Done.** The owner's ask on **the account register** (`/accounts/[id]/register`), and nothing
else on it. The table drew every entry an account has ever had in one run, oldest first — 46 rows
per account on this laptop's data, 704 on the live one — so the most recent movement, which is
what somebody opens a register for, was at the bottom of a long scroll. It now pages at the app's
`PAGE_SIZE` of twenty and opens on the newest line. Commits: `5777cbe`.

*The reversal is on the screen, not in the query.* Same rule the Bank statement follows, and for
the same reason: the API orders the register ascending because the Balance column is a window
function over exactly that order, and turning the query round changes every figure in it. So
`register-screen.tsx` reverses a **copy** of the rows after each already carries its balance
(`register.rows.reverse()` in place would flip the props array and un-flip the table on the next
render). `transactions.service.ts` is untouched, which leaves the exported statement PDF and
every other consumer of `/accounts/:id/register` reading exactly as they did.

*The serial counts across the register rather than within a page.* This is the one thing that
needed a shared file — see below.

**Watch out.**

- **`components/ledger/transaction-table.tsx` gained one optional prop.** `TransactionTable`
  numbered its rows `index + 1`, which is the second row 1 twenty lines later once a screen
  pages, and the serial is not rendered anywhere the screen could reach. It now takes
  `page?: number`, **defaults to 1**, and numbers with `serial(page, index)` from
  `lib/pagination`. At the default that is `index + 1` exactly, so the other two callers —
  `ledger/transactions-screen.tsx` and `expenses/category-detail-screen.tsx` — render
  byte-identically; only the register passes a page. Nothing under `components/ui/`,
  `components/money/`, `lib/` or `packages/shared` was edited.
- **The page number lives in React state, not in the URL** — the same as the ten other paged
  screens. `setRange` puts it back to 1 on a date change, because the route does not change
  there, only its query, so React keeps this component and its page number across the
  navigation. `Math.min(page, totalPages)` clamps what a filter change cannot reach: a page
  number that outlives its rows after a void or a `router.refresh()`.
- **The "cannot be right" warning on cash and wallet accounts was reworded**, because the change
  made it wrong. It told the reader to "work down the list" to find the day the balance first
  went under; down the list is now backwards in time. It says to read the Balance column upwards
  from the oldest entry instead.
- **The four figures above the table are the period's, not the page's**, and they were left as
  they are — they sit above the date filter that decides them, in the stat-card row every screen
  in this app carries, and the Closing card already says "Should equal the bank statement". The
  qualifier the Bank statement's foot needed does not apply to a row of cards above the table.

**Measured, not read off the diff.** `.regpage.mjs` (untracked, at the root, adapted from
`.stmtpage.mjs`) drives the real page in a browser: it walks **every** account that has rows,
clicks through to the last page and checks what a diff cannot show — that the serials run 1..N
unbroken **across** the page breaks, that no entry is duplicated or dropped, that the dates never
rise between rows or over a break, that each page holds twenty and the last the remainder, that
the four figures do not change as pages turn, and that the top row's running balance equals the
Closing card. Nine accounts, all green: 46 rows in [20, 20, 6], 43 in [20, 20, 3], 41 in
[20, 20, 1], 40 in [20, 20], 37, 33, then 14, 3 and 2 with no pager at all. It also drives the
two states a pager gets wrong when nobody clicks it: on page 3 of City Bank, setting a From date
lands on **page 1** of the shorter list with serial 1 at the top, and a range with nothing in it
draws the empty message with **no pager** to strand anybody on.

**Open.**

- **All transactions still restarts its serial on page 2.** It pages from the API and passes no
  `page` to `TransactionTable`, so its twenty-first entry is a second "1". The prop it needs now
  exists and the fix is one line, but that is its own page and its own session.
- The owner wants twenty to a page on **every** table. Already paged: All transactions, Cash in,
  Other expenses, Payroll runs, Audit, FX rates, Users, Subscriptions, Team, member tools, Bank
  statement — and now the account register. Still unpaged, one page per session: `/import`
  (three tables), `/payroll/[runId]` salary sheet, `/tax/withholding`, `/team/[id]`, and the
  email panel in Settings.

## 2026-08-21 — Twenty movements to a page on the bank statement, newest first

**Done.** The owner's ask on **Bank statement**, and nothing else on it. The table drew every
movement an account has ever had in one run — 41 to 46 rows per account here, far more on the
live data — so the most recent one, which is what somebody opens this page for, was at the
bottom of a long scroll. It now pages at the app's `PAGE_SIZE` of twenty and opens on the newest
line. Commits: `14fa2cd`.

*The reversal is on the screen, not in the query.* The API orders the register by date ascending
because the Balance column is a window function over exactly that order — turn the query round
and every figure in it changes. So `bank-statement-screen.tsx` reverses a **copy** of the rows
after each already carries the balance it left behind (`register.rows.reverse()` in place would
flip the props array and un-flip the table on the next render). `transactions.service.ts` is
untouched, which is what leaves the account register at `/accounts/[id]/register` and the
exported statement PDF reading exactly as they did.

*The serial counts across the statement rather than within a page* — `serial(current, index)`
from `lib/pagination`, so the twenty-first movement is 21 and not a second 1. Number 1 is the
newest line, the same way every other paged table in this app numbers from its first row.

*The closing line now says what it totals.* It is the whole period's, and it sits under whichever
twenty rows are on screen — on page 3 a reader has every reason to read it as page 3's total. It
reads "Closing balance · whole period, not this page".

**Watch out.**

- **No shared component changed.** `Pagination`, `PAGE_SIZE` and `serial` already existed; this
  screen only started consuming them. Nothing under `components/ui/`, `components/money/`,
  `lib/` or `packages/shared` was edited, so no other screen moved.
- **The page number lives in React state, not in the URL** — the same as the eight other paged
  screens. `go()` puts it back to 1 on an account or date change, because the route does not
  change there, only its query, so React keeps this component and its page number across the
  navigation. A statement link still opens on page 1 for whoever receives it.
- **The "Brought forward" line still sits above the rows** and is now above the *newest* one,
  which is how a bank prints its header — but it is the opening figure of a list that now runs
  the other way. Left as it was, since it names its own date. The owner may want it paired with
  the closing figure; that is a decision, not a bug.

**Measured, not read off the diff.** `.stmtpage.mjs` (untracked, at the root) drives the real
page in a browser: it walks every account with rows, clicks through to the last page and checks
what a diff cannot show — that the serials run 1..N unbroken **across** the page breaks, that no
movement is duplicated or dropped, that the dates never rise between rows or over a break, that
each page holds twenty and the last the remainder, that the foot does not change as pages turn,
and that the top row's running balance equals the closing balance under the table. Six accounts,
all green: 46 rows in [20, 20, 6], 43 in [20, 20, 3], 41 in [20, 20, 1], 40, 37, 33. It also
drives the two states a pager gets wrong when nobody clicks it: on page 3 of City Bank, switching
account lands on **page 1** of the new one, and a range with nothing in it draws the empty message
with **no pager** to strand anybody on. Cross-checked against the database: the closing balance on
screen, −BDT 14,28,47,700.00, is the account's opening balance plus its live movements exactly.

**Open.** The owner wants twenty to a page on **every** table in the app. Already paged: All
transactions, Cash in, Other expenses, Payroll runs, Audit, FX rates, Users, Subscriptions, Team,
member tools — and now Bank statement. Still unpaged, one page per session:

- `/accounts/[id]/register` — the account register, the same table shape as this one and the
  obvious next session.
- `/import` (three tables), `/payroll/[runId]` salary sheet, `/tax/withholding`, `/team/[id]`,
  and the email panel in Settings.
- The Reports statement view (`statement-view.tsx`, three tables) is a printed document rather
  than a screen to page through — worth a decision before anybody paginates it.

## 2026-08-21 — The statement's signature block gets the signature

**Done.** The owner's ask on **Reports**, and nothing else on it. "Signed by" held a name and a
title, and the PDF's closing page drew a ruled line with nothing above it. Each signatory now
carries their own scanned mark, and the closing page prints it — laid out as a grid rather than
as the two boxes it used to be.

*On screen, the block is the document.* Two cards across, up to four, each holding the name, the
title and the signature on a white plate — the same slip of paper the PDF draws under the ink,
because a black scan on this app's dark card is invisible and reads as a failed upload. A
signatory with no mark says so in words: "No signature. The PDF prints a ruled line with the name
under it." The rule for what may be uploaded is printed under the block *before* a file is
chosen, not only after one is refused.

*In the PDF, up to four in a 2×2 grid.* The rule sits at the same height in every box whether or
not there is a mark above it — that is what makes the block read as a grid rather than as boxes
that closed up around what was missing. Three fills three cells and leaves the fourth empty.

*Four refusals, all measured through the real endpoint.* Not a PNG or JPEG; over 300 KB; under
300px wide; outside 1.5:1–8:1. And a fifth that is new: **an interlaced PNG or a progressive
JPEG is refused at the door**, because both open perfectly in any browser somebody would check
them in and neither can be embedded in a PDF at all — the failure would otherwise surface a month
later as an empty signature box on the document being sent out. `checkPrintableSignature` in
`packages/shared/src/files.ts`, with seven tests. It applies to the statement's kind only: the
payslip's `signature` is drawn by a browser, which is happy with both, and newly refusing a file
that has been printing correctly for months would be a bug rather than a check.

Commits: `291080b` (the migration, pushed alone and first), then this one.

**Watch out.**

- **The migration travels alone and had to land first.** `deploy/sql/2026-08-21-who-signs.sql`
  adds `files.statement_id` and the `statement_signature` file kind. Drizzle names every column
  in its SELECT, so the code without it kills every document list and every upload. Applied
  locally with a one-file runner and run twice; the kind, the column, the index and the
  constraint are all present and the file already stored stayed readable.
- **It is named "who-signs" so it sorts last.** `files_one_owner` is replaced for the fifth time,
  and replaying this directory alphabetically must not put a shorter rule back on top of a longer
  one. Every existing name sorts below "who". That is also why a migration about signatures is
  not called "signature".
- **The signature hangs on the statement, not on settings.** A settings file is written by
  `settings.write`, which only super_admin holds, and the people who reconcile a statement are
  Finance. A statement-owned file follows the statement's own pair — `reports.view` to read,
  `transactions.write` to change — which is exactly who may edit the page it appears on. The kind
  is deliberately **not** singular: four signatories need four marks.
- **Shared code was touched**, additively: `packages/shared/src/files.ts` gains a kind, an owner
  and `checkPrintableSignature`; `statement.ts` gains `signatureFileId` on a signatory. No
  existing screen's behaviour changes — the records keyed by file kind simply gained an entry,
  which the compiler required everywhere. `apps/api` gains `FilesService.bytes` and
  `StorageService.read`, both for the one caller that has to *embed* a file rather than serve it.
- **A save now prunes the signatures nobody points at.** Uploading one and leaving the page
  without saving used to leave a file owned by the statement that no signatory named. Measured:
  three uploads then a save naming one left **1 live row and eleven files off the disk**, and the
  one the statement named survived.
- **`node .sql.mjs` cannot replay this directory any more**, and has not been able to since
  `2026-08-20-subscriptions.sql` — that file re-adds the five-column `files_one_owner`, which
  rows created since then violate. It aborts there and every file after it is skipped. The deploy
  is unaffected: it records each file in `schema_migrations` and runs it once. Apply a single new
  file with `.apply1.mjs` instead.
- **The development database carries test signatories** on August 2025 and August 2026 —
  "Mirza Ashiqul Islam", "Farhana Rahman" and two more, with synthetic scrawls. Local only; the
  live database has none of it. `.sigclean.mjs` clears the company signature if a probe leaves
  one behind.

**Measured, not read off the diff.** The layout bug this found was invisible in the source: at
the old box height the second row of four signatures ran **9.8pt into the big figures** anchored
at the foot of the closing page. `.pdfgeom.mjs` inflates the PDF's content streams and reads the
drawing operators back out; `.siggrid.mjs` walks one, two, three and four signatories and reports
where each grid lands. After the fix: one row at 422.3→534.3, two rows at 412.3 and 532.3 ending
644.3, against figures that start at 659.9 — **clear by 15.6pt**, with the rules level across
each row even when one signatory in it has no mark.

`.pdfink.mjs` answers the question the geometry cannot: it inflates each embedded image, undoes
the PNG row filters and counts dark pixels — **four images, 720×180, 2.8% ink each**. That check
earned itself: the first fixture wrote an invalid filter byte on every scanline, producing a PNG
that decoded to the right size and drew as a blank white plate on screen and in the PDF. Without
counting pixels it would have passed as "the image is there".

Four CI steps run separately, all green (315 tests). The screen was loaded at 1440, 640 and
390px: no overflow at any of them, three signatures loading at 720×180, the fourth showing its
empty state.

**Open.**

- **Nothing carries a signature forward between periods.** Every month's statement wants its own
  upload, even when the same two people sign every month. That is deliberate for now — this
  screen's own note says carrying a sign-off across periods "would silently attach one period's
  sign-off to another's figures" — but if the owner finds re-uploading tedious, a "reuse last
  period's" control is where to start.
- The screen still offers Save to any role that can open Reports, and a read-only role gets a 403
  from the button. That was true before this work and is not changed by it.

---

## 2026-08-21 — The month switch becomes something you ask for

**Done.** The owner recorded a challan on one person on the live site and it landed on everybody
in July. Nothing was broken: the drawer's **"Everybody taxed in July 2026"** switch shipped
ticked, so Save wrote the number on all eighteen rows. The default is the thing that was wrong,
and it is now off.

*The switch is opt-in and says what it would do.* It reads **"Also write it on the other 17 rows
taxed in July 2026"** — the count comes from the table already on screen, and it is that row's own
month rather than the period the filter names, so a quarter's table still offers the right
eighteen. Under it: "Off, this changes Anika Akter and nobody else." It is drawn in its own
bordered block instead of as a bare line under the number field, because the last version was
readable and still got past somebody. On a month with one taxed person it is not drawn at all — a
switch that does nothing invites the reading that leaving it off means something.

*The API default flipped with it.* `applyToMonth` defaults to `false` in
`setLineChallanSchema`, so a caller that omits the field changes one row. Editing a row is a
claim about that row; writing one number eighteen times is tedious, and unpicking eighteen wrong
ones is worse.

Commit: `31a92e0`.

**Watch out.** **July 2026 on the live site is carrying whatever was typed on every row**, from
before this. Nothing here rewrites it — clearing it is: pencil on any July row, tick "Also write
it on the other N rows", leave the number empty, Save. That clears the month, and the numbers can
then go on one at a time.

No schema change, no migration. Three files: `packages/shared/src/tax.ts` (the default),
`line-challan-form.tsx` (the switch and its new `othersInMonth` prop), `withholding-screen.tsx`
(counts the rows and passes it). The two API doc comments that described the old default were
corrected — no behaviour in `tds.service.ts` or `tds.controller.ts` changed.

Measured, through the API and the browser (`.tdsdefault.mjs`, untracked). PATCH with the field
omitted: **rowsChanged 1**. Drawer opens **unticked**, labelled "the other 17 rows"; typing a
number and pressing Save touched **1** row and left **17** empty, and the toast named the person
rather than a count. Ticking it deliberately still reached **18**, and the toast said so. Four CI
steps run separately, all green (308 tests).

**Open.** The single-taxed-person case — where the switch is not drawn — was not exercised: every
month in the development database has eighteen taxed rows, so there was nothing honest to point
at. It is one condition, `othersInMonth > 0`.

---

## 2026-08-21 — The challan moves onto the person, and the challans table goes

**Done.** The owner's ask on the **TDS** page, and nothing else on it.

*A Challan number column, after Tax deducted.* Empty rows say **"Challan not recorded yet"** in
words rather than sitting blank — an empty cell on a tax table reads as a figure that failed to
load. A row that has one shows the number with a paperclip, and clicking it opens the same
documents popup the cash-in table's invoice number opens (`DocumentsDialog`, image or PDF, with a
download). A pencil in the same cell opens a drawer holding two fields and one switch: the challan
number, the file, and **"Everybody taxed in <month>"**, ticked by default.

*The number lives on the payroll line.* `payroll_lines.tds_challan_number`, and the scan hangs on
the line as a seventh file owner (`files.payroll_line_id`, kind `challan`, singular — attaching
another replaces it). The month switch writes the number on every taxed row of that payroll run and
leaves the zero-tax rows alone; unticked it writes one row. **The file is uploaded once**, from
whichever row was open, and every row carrying that number opens it — the register resolves the
scan by challan number, not by line, so twenty-five people do not mean twenty-five copies of one
PDF. Clearing a number hides its scan rather than deleting it; writing the number back on that row
shows it again.

*The Challans panel under the table is gone*, on the owner's instruction, and **its 28 rows are
untouched in `tds_deposits`** — nothing was migrated, backfilled or deleted. `challans-panel.tsx`
and `challan-form.tsx` are deleted with it and are one `git show` away. `tdsApi.deposits`,
`createDeposit`, `updateDeposit` and `allocate` still answer and now have no caller, which is what
the note at the top of `lib/tax.ts` already says about most of that file.

Commits: `a3c3be2` (migration, pushed alone and first), `d4fac46` (the page).

**Watch out.** **The migration travels alone and had to land first** — Drizzle names every column
in its SELECT, so shipping the code without it kills the payroll run, every payslip and this
register. `deploy/sql/2026-08-21-tds-line-challan.sql` is idempotent, applied locally with
`node .sql.mjs` and measured: both columns nullable, both indexes present, no row changed.

**It also repairs a bug that made the old challan attachment impossible.**
`2026-08-20-challan-file.sql` added `files.tds_deposit_id` and never added it to `files_one_owner`,
and `2026-08-21-signature.sql` then recreated that check without it — so a file owned only by a
deposit failed the constraint with a sum of zero. `FilesService.upload` never set the column either,
and `ownerOf` did not know it, so a challan scan could not be stored and would not have been
readable if it had been. The check now names all seven owner columns (this is the fourth file to
recreate it — it names every column that exists so replaying the directory cannot put a shorter
rule back on top), `upload` sets both new columns, and `ownerOf` answers for both.

Three shared things changed, all additive: `FILE_OWNERS` and `KINDS_BY_OWNER` gained
`payroll_line`; `SalaryTdsRow` gained `challanNumber` and `challanFileLineId`;
`DocumentsDialog` gained a third `owner` value behind the same default, so its five existing
callers are untouched. `SINGULAR_KINDS` gained `challan`. Nothing under `components/ui/` or
`components/money/` was touched.

Measured rather than argued, against the development database and through the browser
(`.tdswrite.mjs`, `.tdsedge.mjs`, `.tdsshot.mjs`, `.tdsflow.mjs`, untracked). Writing on one row
reached **18 of 18** taxed rows of July 2026 and **0** zero-tax rows; unticked, exactly **1**.
Clearing the month cleared 18 and left the file row stored; writing the number back resolved the
scan on all 18 again. A draft run answers 400, an unknown row 404, 61 characters 400. The upload
answered **201** and its bytes stream back at **200** — which is the constraint fix, end to end.
On screen at 1440/1024/390: **7** header cells, **0** rows whose cell count disagrees with the
header, the column at index 5, **18** pencils, **0px** of page overflow at every width, and the
footer spanning 4 + 1 + 2. Through the UI: pencil, untick, type, Save — the toast named the
person, the drawer closed, the table re-read itself and the database held 17 + 1. Four CI steps
run separately, all green (308 tests).

**Open.**

- **Nothing on this page records the deposit's date, bank or amount any more.** That was the
  challans panel's job and the owner asked for it to go; `tds_deposits` still holds all 28 rows and
  the endpoints still write them, so a compliance screen for the trail is a routing change plus the
  client that is already in `lib/tax.ts`, not a rebuild.
- **The register and `tds_deposits` do not know about each other.** A number typed on a salary row
  is not checked against a recorded challan and does not create one, deliberately — the owner chose
  the per-row column over reusing the deposit and allocation tables. If they should agree later,
  `tds_allocations` is the table that was built for it and it is still empty.
- **`GET /tds/deposits` and friends have no caller now.** Left in place; see above.

---

## 2026-08-21 — Team gets an Employment type column, and loses its second table

**Done.** The owner's two asks on the **Team** page, and nothing else on it.

*A new column, after Designation.* **Employment type** — Onsite, Remote, Hybrid, Contractual.
It is a new field, `team_members.employment_type`, and it is **not** `engagement_type`. That one
is the payroll question — employee means the salary sheet draws them, contractor means they bill
— and it stays exactly where it was, because marking somebody Remote must not change what the
monthly run does with them. The new one is the employment record: where and on what footing.

Nullable, and null prints an em dash. The migration seeds one value and only one: every
contractor became `contractual`, which is the same fact under a second name rather than a guess.
Nobody has been asked where anyone else works, so 45 of the 50 local rows read "—" and will until
HR opens their drawer. Defaulting the lot to Onsite would have put a hundred and twenty
unverified claims on a screen people answer questions from.

*The Contractors panel is gone, and its people are not.* One table now. Removing the panel on its
own would have dropped every contractor off the page — so the split by `engagementType` went with
it, and the fact that panel carried is the new column instead: a contractor reads **Contractual**
where somebody scanning the directory is already looking. Two panels over a page of twenty rows
also meant the second appeared and vanished depending on whether that page happened to hold a
contractor.

The panel heading is "Employees and contractors" rather than the tab's own name, which would have
restated a selected tab four pixels above it. The description still changes with the tab.

*The drawer can set it.* Two selects side by side — Type ("What payroll does with them") and
Employment type ("Where and on what footing"), hinted so the pair does not read as a duplicate.
"Not set" is a real option and stays selectable.

Commits: `ada36db` (migration, pushed alone and first), `393a7a7` (the page).

**Watch out.** **The migration travels alone and had to land first** — Drizzle names every column
in its SELECT, so the code without the column kills the team list, every profile, payroll and the
payslip. `deploy/sql/2026-08-21-employment-type.sql` is idempotent and its backfill only touches
rows still null, so a value HR sets later survives a re-run. Applied locally with `node .sql.mjs`
and measured: the enum has its four values, the column is nullable, 5 contractors carry
`contractual`, 45 employees are null.

`packages/shared/src/payroll.ts` gained `EMPLOYMENT_TYPES`, `employmentTypeSchema`,
`EMPLOYMENT_TYPE_LABELS` and one optional field on `createTeamMemberSchema`. Purely additive —
no existing caller changes behaviour, and the AI intake's `labelFor` already renders an unmapped
key as "Employment type" without help. Nothing else under `components/ui/`, `components/money/`
or `lib/` was touched.

Measured rather than argued, with `.teamcol.mjs`, `.teampast.mjs` and `.teamwrite.mjs`
(untracked). Both tabs, 1440/1024/768/390, both themes: **one** panel, **0px** of page overflow
everywhere, the column at index 5 on Current and index 6 on Past — after Designation, before
Department, in both — and **0** rows whose cell count disagrees with the header, which is the
failure the Last day column produced last time it was added. The table's `min-w` went 960 → 1080
for the extra column; the panel's own `overflow-x-auto` keeps the scroll inside the card (11px at
1440, 424px at 1024, which is ordinary for this app — the subscriptions table is 2064px wide).
End to end through the UI: an em dash, drawer defaulting to "Not set", pick Hybrid, save — the
cell reads Hybrid and the database column holds `hybrid`. Four CI steps run separately, all green
(308 tests).

**Open.** Three surfaces know nothing about the new field, deliberately, because they are not this
page:

- **The profile at `/team/[id]`** shows the engagement type and not this one. HR can set it from
  the list drawer and then not see it on the record it belongs to. Worth its own session.
- **The team export** (`exports.controller.ts`) has an Engagement column and no Employment type
  column.
- **Clearing it back to "Not set" is not possible from the drawer.** A blank enum is omitted from
  the PATCH rather than sent as null, so an existing value stays — the same behaviour gender and
  blood group have had all along. Fixing it means the nullable-patch treatment `endedOn` gets, for
  all four fields at once.

---

## 2026-08-21 — the filter segments become tabs, and the rate stops being printed twice

**Done.** Two small things the owner asked for on the heading page, on top of this morning's
redesign of it.

*The sub-category segments are tabs now.* They were three-line blocks carrying a colour dot, the
name, a short amount and a share — which made the strip the loudest thing on a page whose subject
is the number above it, for figures the total block prints the moment a tab is picked. They carry
the name and nothing else now, in the app's own `<Segmented>` — the same control the TDS screen
filters its four periods with, which is the shape the owner sent as the reference. Written once,
so "filter what is already on screen" looks like itself on every screen that does it.

One behaviour changed with the shape: a tab is not a toggle. Picking the selected one again used
to clear it; now it stays, and **"All" is how you clear it** — which is what a tab strip means
everywhere else in this app, and what the reference does.

*The `USD 39.00 @ 122.043217` chip is off the description column.* It printed the same two
figures the **Amount (USD)** and **USD rate** columns print, on the same row, three cells to the
right — in a green chip, so the loudest thing in a description was a repeat of it. The one fact
it carried that the columns do not is whether the dollars were really sent or only converted, and
the USD column already says that: a converted figure is marked `~`, a recorded one is not.
Nothing is lost.

**Watch out.** That chip lived in `components/ledger/transaction-table.tsx`, which three screens
use: **All transactions**, **the account register**, and this heading page. So it is gone from
all three — deliberately, because the two columns that replace it are rendered by the same
component and therefore exist wherever the chip did. Measured across them rather than argued:
`.usdbadge.mjs` (untracked) found 21 foreign-currency transactions in the database and **zero**
`CUR n @ rate` chips on `/transactions` and `/expenses/technology`, with both USD columns still
in place.

`.catpanel.mjs` (untracked, updated for `role="tablist"`) re-walked the panel: 1440/1024/768/390
in both themes, 0px of page overflow, 0px inside the strip, nothing clipped, the tabs wrapping to
a second row at 390 rather than scrolling sideways. Picking `Office & premises` took the figure
from ৳1,04,11,700.00 to ৳81,83,700.00, the sub-line to "1 entry · Office & premises" and the
table from 6 rows to 1; "All" put all three back. `node .sweep.mjs` on the three affected routes
is unchanged — h1 28, pad 32/34, gap 20, 0px sideways. Four CI steps run separately, all green
(308 tests). Commits: `29dd33d`.

**Open.** The composition bar's six hues no longer key to anything the reader can name — the tabs
are neutral, so the bar is now proportion without a legend. It still says how the month divides,
which is most of its job, but if it should either gain a legend or go, that is the owner's call
and its own session.

## 2026-08-21 — the sub-category pills become the control they were pretending to be

**Done.** The heading page (`/expenses/<heading>`) gets the owner's redesign of its first
section, from the handoff in `Downloads/Total and category button redesign`. The thin total strip
and the loose row of rounded pills are now one panel: a total block with a stat cluster and a
composition bar, and welded under it a filter track — an "All" segment plus one per
sub-category, in descending amount order. New file
`components/expenses/category-summary-panel.tsx`; the screen hands it the numbers and holds the
one piece of state.

**The pills were dead links, and now they filter.** They pointed at
`/expenses/<sub-category-slug>`, and that route resolves top-level headings only —
`tree.find(node => node.slug === slug)` never looks at `children` — so every one of them landed
on a 404. Measured, not assumed: `/expenses/hosting-servers` and `/expenses/domains` both render
the 404 page while `/expenses/technology` renders. Picking a segment now re-scopes the big
figure, its dollar line and the table below it, in place; picking it again, or "All", lets go.

Where the handoff and this codebase disagreed, the codebase won, and here is each one:

- **Colour.** The handoff is a dark-only palette of raw hex (`#0d0d0d`, `#0a0a0a`, `#1d1d1d`).
  This app has a light theme, so every surface, border and text colour goes through the existing
  tokens — panel `bg-surface`, track `bg-background`, segments `bg-surface` on it. Verified in
  both themes at 1440/1024/768/390.
- **Width.** No `max-width:1400px`. `MainRegion` deliberately has no maximum — there is a comment
  in it about the two columns of empty space that `max-w-7xl` used to leave — so the panel takes
  the content column.
- **Short amounts.** `৳82L`, `৳6.2k` from the existing `formatCompactMoney`, not the handoff's
  `৳2.56L`. That function's own comment explains why it stops at one decimal, and a second
  rounding rule for money on one screen is how the two drift apart.
- **Sub-category colour is derived, not stored.** Every sub-category in this database inherits
  its heading's colour — all four of Technology's are `#0d9488` — so a composition bar drawn from
  stored colours is one solid teal block. The panel uses the handoff's six-hue ramp by descending
  amount, walking the wheel in 55° steps past the sixth.
- **A 2px floor on composition-bar segments.** A sub-category worth 0.06% of the month draws as
  nothing, which reads as one fewer sub-category than the count beside it claims.

Measured with `.catpanel.mjs` (untracked) on the running page: at 1440/1024/768/390 in both
themes, 0px of page overflow, 0px inside the track, nothing clipped, the track wrapping 1 → 2 → 3
rows and the stat cluster dropping under the amount, and long names ellipsizing rather than
pushing out. Picking `Office & premises` took the figure from ৳1,04,11,700.00 to ৳81,83,700.00,
the sub-line to "1 entry · Office & premises" and the table from 6 rows to 1; picking it again
and pressing "All" both restored all three. `.catbar.mjs` (untracked) confirms no bar segment
draws at less than a pixel. `node .sweep.mjs` on the three expense routes: h1 28, pad 32/34, gap
20, 0px sideways at every width. Four CI steps run separately, all green (308 tests). Commits: `d566c06`.

**Watch out.** The page is keyed `${heading.id}:${from}:${to}` in `[category]/page.tsx`. That is
load-bearing, not decoration: `changeRange` is a client-side `router.push` to the same route, so
without the key the screen keeps its state and August's table stays scoped to a sub-category
somebody picked in July. If you add state to that screen, it resets on a month change — which is
what the handoff asks for.

**Open.** Nothing half-done. Two things noticed and left alone: the table still shows one capped
page of 200 rows while the segment counts come from the server's own count, so a heading with
more than 200 entries in a month would show a segment saying more entries than the filtered table
lists — pre-existing, and its own session. And `/expenses/<sub-category-slug>` still 404s; nothing
links to it any more, but the route could either learn to resolve children or say so plainly.

## 2026-08-21 — a heading becomes a card because somebody asked, not because money moved

**Done.** Three things on the Expenses overview, all asked for by the owner.

*"add category" now adds.* The drawer used to list only the headings this month's spend had
gone to, which meant ticking a box could never put a new card on screen — it could only swap
between the ones already there — and a heading created from the drawer appeared nowhere until
its first bill was recorded. It now lists **every** active `out` heading in the books, the quiet
ones under a "Nothing spent under these this period" rule, each row carrying its colour and
either its figure or "nothing yet". Tick as many as you like; a heading created here is ticked
on as it is made, so its card is there before a taka has been spent against it.

That needed the stored preference to change shape. It was a bare array of hidden ids, which
cannot express "show this one that has no spend" — the localStorage key `svf-expense-headings`
now holds `{on, off}`, and a bare array left by the old version is still read, as `off`. A
heading with spend is a card unless it is in `off`; one without spend is a card only if it is in
`on`. The load also refreshes the category tree now, not just the summary, because a heading
that was created a second ago has nothing in the summary to bring it back.

*The month's transaction table is gone.* "Every expense this month" is off the overview on the
owner's instruction — the cards are the page, and each heading has its own table one click away.
With it went the edit form, the void dialog and the accounts fetch that fed them; the page is
2033px of scroll shorter.

*The page scrolls again after a drawer closes.* Measured, not guessed — `.scrolllock.mjs`
(untracked) walked it: open the chooser, open "Create a heading" inside it, close both, and
`body` was still `overflow: hidden` until a reload.

**Watch out — this last one is a shared change, made with the owner's go-ahead.** `Drawer` and
`overlay.tsx`'s `useDismissable` each saved `body.style.overflow` on open and put it back on
close, which is only correct while exactly one of them exists. Nested — and they nest all over
this app: the category drawer opens from inside a transaction form, a confirm dialog from inside
a drawer — the inner one finds `hidden` and records *that* as the value to restore. Both now
call `useScrollLock` in `components/ui/scroll-lock.ts`, which counts holders: the first reads and
locks, the last restores. Its effect deliberately depends on `open` alone, because callers pass
inline `onClose` handlers whose identity changes every render and that churn was the other half
of the bug.

Sixteen files use `Drawer` and eight use the overlays, so this was measured across the app rather
than on one screen: `.drawerlock.mjs` (untracked) opened and closed 16 dialogs on 8 screens and
none left the page locked, and `node .sweep.mjs` is unchanged — every route 0px of sideways
scroll, h1 28, pad 32/34, gap 20. `.headings.mjs` (untracked) drove the real page: created a
heading, watched the card appear at once reading 0% · 0 entries with the other seven untouched,
reloaded, unticked it, unticked one with spend and put it back, then deleted its row again.

Four CI steps run separately, all green (308 tests). Commits: `f1f2a68`.

**Open.** Nothing half-done on the page. Two things noticed and deliberately left alone, each
wanting its own session: `components/ledger/documents-dialog.tsx`, `dashboard/expense-row.tsx`
and `subscriptions/screenshot-dialog.tsx` render `role="dialog"` by hand and take no scroll lock
at all — harmless today, but they are the three that will not get the fix above. And the
heading choice is still a browser preference; if it should follow the owner between machines it
is a column and a migration.

## 2026-08-21 — the dashboard's account order is the owner's to set

**Done.** An `Edit` button in the top-right corner of the dashboard puts the account blocks in
hand: drag one, or move it with the arrows beside its heading, then `Done`. `Reset` puts the
default back. The blocks and the ordering moved out of `overview-screen.tsx` into
`components/dashboard/account-blocks.tsx`, which now holds the store, the default order and the
block itself; the screen renders one `<AccountBlocks>`.

**The order is a browser preference, not a database change** — the owner's choice. `sort_order`
still belongs to the accounts page and every dropdown that follows it, and arranging the
dashboard no longer moves them. Kept exactly the way the expense row keeps its chosen cards:
`localStorage`, versioned key `sfm.dashboard.account-order.v1`, read through
`useSyncExternalStore` so there is no flash and no setState-in-effect. It does not follow anybody
to another machine; that is the point at which it earns a column.

The default, when nothing is saved, is **bank, mobile wallet, cash, card** rather than the
server's `sort_order`. On the live data that alone answers the ask — Standard Chartered Bank
above Master card — without touching a row in the live database.

Measured on the running page with `.dashorder.mjs` (untracked): default order correct, 20 move
buttons for 10 blocks, an arrow moves and saves, a dispatched drag lands the bottom block on top,
the order survives a reload, the arrows disappear when not editing, and `Reset` returns the
default and clears the key. Four CI steps run separately, all green. Commits: `1092318`.

**Watch out.** Dragging reads the carried block from a ref rather than from state: `dragover` can
arrive in the same tick as `dragstart`, before React has re-rendered, and the first version of
this did nothing at all when it did. If you rewrite the drag handlers, keep the ref.

**Open.** Nothing on the page is left half-done. If the order should follow the owner between
laptop and phone, that is a column on `app_settings` and a migration — its own session, by the
rule about schema changes travelling alone.

## 2026-08-21 — the dashboard shows every account, one block each

**Done.** The overview's balance blocks are per account rather than per currency. It used to
build exactly two: every BDT account summed into "BD Bank overview" with the names listed in
grey beside it, and anything else into "Card overview". With two accounts on the live site that
is one row of figures for the bank and the card together — the question "what is on the card"
had no answer on the screen that exists to answer it.

`accountGroups` in `overview.service.ts` now maps the account rows straight to blocks:
`key` is the account id, `label` its name, and a new `type` carries bank/card/wallet/cash. The
heading is the account's name with its type as the grey qualifier (owner's choice — no bank name
or masked number), and the icon comes from the same four the Accounts screen uses. No combined
total block: the owner asked for the accounts and nothing above them.

Measured rather than reasoned about — `.dashblocks.mjs` (untracked) loads the real page with a
real token and reads the rendered figures: **10 accounts in the dev database, 10 blocks on the
page, names matching, and `opening + in − out = closing` on every one of them.** Four CI steps
run separately, all green. Commits: `40dee9f`.

**Watch out.** `AccountGroup` in `packages/shared/src/reports.ts` changed shape — `accounts:
string[]` is gone, `key` is now an id rather than `"bank" | "card"`, and `type` is new. Asked
before touching it: the only consumers are the dashboard screen and the overview service, and
grep found no other screen. Anything reading `group.accounts` will not compile.

**Open.** Archived accounts (`is_active = false`) still get a block, because dropping a balance
silently is worse than a block nobody looks at. On live it does not arise — both accounts are
active — but if the owner archives one and does not want it on the dashboard, that is a one-line
filter. Nothing else on the page was touched.

## 2026-08-20 — one session, one page

**Done.** `CLAUDE.md` now carries how revisions are run: a page at a time, one session per page,
in sequence rather than side by side. The owner's reason is the one that matters — a single
session carrying twenty screens runs out of room and starts forgetting the first ones. Running
them in sequence also retires the collision problem that cost this repository an afternoon: two
sessions in one working tree, one rewriting a file the other had just committed.

The rule that came with it, and it is the owner's: **shared code is asked about before it is
changed.** A page-scoped session cannot see what a change to `TableScroll` does to the other
twenty tables, so it finds every screen that uses the component, says which ones they are, and
waits for a decision. Measuring afterwards — `node .sweep.mjs` — is the check, not the argument.

**Watch out.** Three kinds of change now travel alone rather than inside a page's work: schema
and migrations, deploy or CI configuration, and auth or permissions. Each of those breaks the
whole site when it breaks, and a failure folded into a page's diff is a failure nobody can
attribute — which is exactly what happened on the 20th.

## 2026-08-20 — a hundred rows in every table, on two accounts

**Done.** The live database — the `db` container, not the Neon one in `apps/api/.env` — now
carries sample data at a size pagination, filters and totals can actually be tested against. 704
transactions — 18 of them voided, so the struck-through row is a state that exists to be looked
at — 2,700 payroll lines, 408 compensation rows, 354 TDS allocations, and 120 each of
vendors, team members, subscriptions, files, statements, notifications, imports, exchange rates
and the rest: **26 of 33 tables at a hundred or more**. Accounts are down to the two that were
asked for, Master card and Standard Chartered Bank; `Petty cash (demo)` and `USD card` are gone.
Commits: `3020509`, `e60360c`, `34eec1c`, `bf89d17`.

Both registers were checked **in SQL** rather than taken from the seeder's own arithmetic —
`opening_balance + sum(signed_amount)` with a window function for the running minimum. Standard
Chartered: opening 18,50,000, low 8,97,013, closing 1,52,75,006. Master card: opening 10,00,000,
low 6,48,863, closing 39,78,140. Neither goes negative at any point in the two years.

**Watch out.**

- **It runs from the image, not the working copy**: `docker compose exec -T api node
  apps/api/dist/db/seed-bulk.js reset`. A commit that is not pushed and deployed is not in it —
  the first attempt at the no-users change would have created the users anyway.
- **It creates no sign-ins.** `users`, `user_two_factor` and `recovery_codes` are left exactly as
  found, the same treatment as `app_settings`: read, never written, in either direction. So is
  `schema_migrations`. The five real accounts, their sessions, 2FA and 40 recovery codes are
  untouched, and the Resend key survived.
- `reset` empties 22 tables and writes ~5,500 rows **inside one transaction**, so a failure
  anywhere rolls the wipe back with it. This only works because the pool is node-postgres over
  the wire protocol; Neon's http driver would make `transaction()` a batch.
- **The 30 old `files` rows are gone and their bytes are still in `/data/uploads`**, and the 120
  new rows have no bytes behind them. `deploy/sql`-style cleanup is `deploy/sweep-orphan-files.sh`,
  which reports both directions; `--delete` removes only the orphaned bytes, never rows.
- **Sample data must not decide who gets production email.** Two rows nearly did, on the day
  Resend went live: sample users with role `cfo`, and `loginEmail` on every plan — the renewal
  reminder mails both. No CFOs are created now, and `loginEmail` holds free text that cannot
  parse as an address.
- **A dry run is only worth having if it is the same run.** `cat(name)` fell back through `??` to
  `pick()`, which only evaluates when the name is missing — so whether it consumed a random draw
  depended on what was already in the database. The rehearsal reported a register never below
  nine lakh and the load that followed put it seventy-two lakh under. Nothing that decides
  whether the generator advances may depend on what is already stored.
- The bank's floor is now a property, not a tuning. A pass over the finished ledger inserts a
  further transfer, dated the day before, wherever the balance would fall through 5,00,000.
  Raising the wire size twice is what shipped the negative register.
- The 18 voided rows are **clones of entries already there** — a void is nearly always the same
  payment typed twice — and transfers, payroll and challan rows are excluded, since a cloned
  transfer leg would put a third row in a group of two. They are filtered out of the floor pass
  and the closing balances, the same rule the application's totals use: adding them moved the
  transaction count from 686 to 704 and left every balance figure identical.

**Open.**

- Three tables will never reach a hundred and each is a decision: `accounts` (2, asked for),
  `app_settings` (1, `CHECK (id = 1)`), `tax_policies` (20, one row per fiscal year). `users` (5),
  `user_two_factor` (4), `recovery_codes` (40) and `schema_migrations` (20) are left alone.
- **The verification pass over every page is now unblocked** — that was the reason for this work.

## 2026-08-20 — email, notifications, and the pipeline that hid its own failures

**Done.**

- **Saving the Resend API key returned 500.** Two separate causes, both found. Compose passes an
  unset variable as an empty string, and `??` does not fall back on `""` — so the encryption
  key's fallback never fired (`ebd387d`). Then the real one: `request()` in `api-client.ts` sets
  `"Content-Type"`, and two email calls set `"content-type"` as well. Different object keys, same
  HTTP header, so `fetch` joined them into `application/json, application/json` — which no body
  parser matches, so `@Body()` arrived `undefined` (`49eb448`). Headers now merge through
  `Headers`, where spelling cannot matter.
- **The email test reaches the address it is meant to prove.** It sent only to the signed-in
  user, so the admin address in Settings could not be checked without waiting for a real renewal.
  It now sends to both and names each result. Added `email_to_staff`: a sign-in address is a
  login, not always a mailbox, and reminders to an address that does not exist bounce — which a
  provider that scores senders counts against the mail that matters (`5520de0`).
- **In-app notifications, end to end** (`e720bbd`). A bell in the top bar with an unread count, a
  `notifications` table, four events (a plan renewing in three days, the TDS deadline with
  something still undeposited, a month ended with payroll unpaid, a voided row or a changed
  salary), a Settings → Notifications tab with per-event switches and a "Check now" button.
  Raising is idempotent through a unique index, so the daily job, a restart and a retry between
  them raise one row.
- **Bank statement**: the opening balance left the table — it was the only row with no serial, no
  debit and no credit, and read as an entry somebody forgot to fill in. It is a line above the
  rows now. Invoice joined Transaction ID after the balance (`ebcc44f`).
- **Team profile → Paid tools** shows the whole subscription row rather than four of its
  fourteen columns, from a component both it and the subscriptions screen use, so the two cannot
  drift. Seat names are links to profiles; the table pages twenty at a time (`ebcc44f`).
- **A wide table stopped taking the page with it.** A statically-positioned `overflow-x: auto`
  box does not contain its own scrollable overflow: the profile's tools table scrolled inside its
  own box and still added a thousand pixels to the document. Fixed in `TableScroll`, so all
  twenty-one tables get it, and measured across every screen at three widths (`ebcc44f`).
- **The deploy applies `deploy/sql` itself**, before the containers swap (`3bffcbe`). This is the
  fix for an outage caused the same afternoon: a release added columns whose SQL had only been
  run locally, and every page that reads settings went down until it was typed by hand.
- **The pipeline stopped hiding its own delays** (`57ebed8`). `concurrency` said
  `cancel-in-progress: false` directly under a comment claiming a newer push cancels an older
  run. It queues instead, and `verify` waits twenty minutes before failing — so three pushes in
  an hour left the newest one's build unstarted while the server ran a release two commits old.
  Cancelling is also the only honest setting, because the server deploys `origin/main`'s tip and
  nothing else. The watcher now logs what it is waiting for, once per commit.

**Watch out.**

- **`apps/api/src/db/seed-bulk.ts` belongs to the session doing the live data push.** It was
  rewritten mid-afternoon while another session had just committed to it. Do not edit it without
  saying so.
- The live database is the `db` container, not the Neon one in `apps/api/.env`. Confirmed by
  comparing `app_settings` between them.
- **There is no CFO user.** Renewal reminders go to CFOs and super admins, so today only the
  super admin and the admin address in Settings receive them.
- The super admin's sign-in address changed to a real mailbox on 2026-08-20. The old one had no
  inbox, which is why the first test messages went nowhere.

**Open.**

- **Import → "Import and Export"** (section 12 of the plan) is not started: the screen keeps its
  four-step import as one tab and gains an export tab — pick a dataset, pick a date range,
  download — and `/import` becomes `/data`. Every export button removed from the other screens
  was meant to land here.
- A verification pass over every page, worth doing *after* the live data push, since pagination
  and filters cannot be tested against thirty-three transactions.
- `refresh_tokens` had 384 rows for five users and nothing prunes it. Not a problem yet.
