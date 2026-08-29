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

## 2026-08-29 — team papers live in the app

**Done.** Three of the owner's new items, all on the team page.

1. **The drawer takes files, not links.** Photo, CV and appointment letter were URL boxes
   ("a link, not an upload — a Drive file…"); the owner's rule is that every paper lives in the
   app's own store. The drawer — add and edit, one component, both doors — now offers three
   pickers; the files are held in state and uploaded after the save answers with an id, into the
   same store the profile's Documents card reads (`profile_photo` / `cv` / `appointment_letter`
   kinds, which already existed). A failed upload after a successful save is a toast naming the
   paper, never a reason to resubmit the form — resubmitting would create the person twice.
2. **"Linked elsewhere" is gone from the profile.** The three URL columns keep their values in
   the database — removing a column to satisfy a screen would destroy what somebody typed — they
   are simply no longer shown or written from anywhere.
3. **e-TIN is optional** — it already was in the contract (`optionalOf(etinSchema)`), so the
   change is the hint now saying so, and a check that proves a blank passes rather than assuming.

Commits: `2c40862`.

**Watch out.** Old Drive links still exist on ~18 people and are now invisible — deliberately,
per the owner's instruction, but if somebody asks "where did the CV link go", the answer is: the
column still holds it; upload the file itself to the Documents card. The drawer no longer writes
`photoUrl`/`cvUrl`/`appointmentLetterUrl`, and since updates are partial, editing a person leaves
their old stored links untouched.

**Open.** `.teamdocsqa.mjs` (10 checks) drives it, including the drawer's own path — a real file
picked in the browser, saved, and found in `files` under the new person. Still queued from this
batch: the accounts-page primary-currency card (item 1 of the owner's list).


## 2026-08-28 — the edit drawer sets pay too

**Done.** The owner's follow-up to the morning's Current salary work: the field existed on create
only, and "make editing flexible — the same drawer either way". Both edit affordances (the pencil
on the directory row, the Edit button inside the profile) already opened the same `TeamMemberForm`;
what was missing was the field on edit. Now:

- **Editing shows Current salary, prefilled with the live figure** — fetched when the drawer opens,
  and the box waits for the fetch rather than mounting empty over a real salary.
- **A changed figure lands as a raise effective today**, through `setCompensation` and everything
  it carries — split snapshot, closing of the previous row, sensitive audit line, reason "Changed
  from the profile drawer".
- **An unchanged figure writes nothing.** Saving the drawer without touching the box must not
  manufacture a raise dated today; the API compares against the current figure and skips.
- **A second change on the same day amends today's row** instead of erroring. `setCompensation`'s
  "A figure already starts on that date" refusal is gone — it read as a safeguard and was a trap
  (a typo corrected five minutes later hit a wall). The unique index stays; a collision now means
  amend, on the Pay tab as well, and each amendment writes its own audit row.

Commits: `024933f`.

**Watch out.** `updateTeamMemberSchema` no longer omits `currentSalary` — the permission gate in
`TeamMembersService.update()` is what stands between a role without `team.compensation.write` and
a pay write, same as `create()`. The Pay tab's duplicate-date behaviour changed with this (amend,
not refuse); `CompensationForm` on the profile needed no edit but its users will notice the error
is gone.

**Open.** Nothing half-done. `.sixqa.mjs` grew to 22 checks and covers the raise, the skip, the
same-day amendment and the prefilled edit drawer.


## 2026-08-28 — the owner's six items, from one screenshot batch

**Done.** Six requests handed over together, one commit each where the diffs allowed it.

1. **Current salary at add time** (`6160d69`). The directory said "Not set" for everyone because
   nothing at create ever wrote `compensation_history`. The Add person drawer now offers a
   create-only Current salary; the API writes it through the raise path — split snapshot,
   effective from joining, sensitive audit row, one transaction. An EDIT refuses the key: raises
   keep their one door, the Pay tab. **Found on the way: the schema comment claiming HR lacks
   `team.compensation.write` is stale — `aa987e9` granted it deliberately.** The gate stays as
   defence for roles genuinely without it.
2. **Mobile wallet and PSR off the team drawer** (same commit) — no money moves outside a bank.
   Columns stay; the profile page still displays old values read-only.
3. **Subscriptions Payment Method unmerged** (`dbcc66b`). The field labelled Payment Method was an
   account picker with the method derived from the account's type. Now: a method dropdown (shared
   enum) + a separate Account/Card field, two table columns to match. **No migration —
   `payment_method` and `account_id` both already existed.**
4. **Primary currency leads** (`0f3d6c6`). USD-primary accounts show dollars big, taka small, on
   the accounts overview and the dashboard blocks; BDT accounts unchanged. The `~`/`≈` markers
   move with the figure — a translation stays marked as one — and no rate means taka-first, never
   a promoted blank.
5. **Receipt link removed, url-types dropped, typed "N/A" is a blank** (`1b49f7b`). Every link
   schema shares `isNAText`; no input is `type="url"`.
6. **Empty cells read N/A** (same commit) — 55 sites, 24 files, replaced against an enumerated
   list. Deliberate keeps: the printed statement's brought-forward row (structurally blank, not
   missing) and one form placeholder glyph.

**Watch out.**

- **A failed `build:shared` still emits broken JS into `dist/`**, and the dev API keeps serving
  whatever it loaded at startup — nest only restarts on its own `src`. That combination cost an
  hour today: a mid-edit build failure left `subscriptions.js` calling an unimported function, and
  every subscription create with a website 500'd until the API was bounced. If a screen 500s right
  after shared work, bounce the API before debugging the code.
- `use-row-delete`'s screens were re-driven after the sweep touched their placeholder cells — the
  full battery is green.

**Open.** `.sixqa.mjs` (19 checks) covers all six; it is in `.battery.sh`. The subscriptions rows
created before the account picker existed default to `payment_method='card'` — a bank-paid plan
among them shows "Card" until edited once. Cosmetic, one edit per row in the new dropdown.


## 2026-08-27 — Invoice No. and Transaction ID stop being compulsory

**Done.** The owner's instruction: none of Invoice No., Transaction ID or Reference may be
required. Money arrives without an invoice and a bank does not always give a number, and a box
that refuses the entry is how a real receipt goes unrecorded — or gets recorded with an invented
number, which is worse than blank, because a blank says "none" and a number says something untrue.

The contract already allowed all three to be empty; `recordCashInSchema` even carried a comment
saying so and adding that "the screen is where *every field is required* belongs". **Cash In was
the only screen insisting**, and it did so twice — the `required` attribute on both inputs and the
red asterisk on both labels. Both are gone, and the schema's comment no longer claims a rule the
owner has since reversed.

Measured on the way in rather than assumed: the expense drawer, the transfer drawer and the
subscription drawer never required them.

Commits: `194b3e9`.

**Watch out.** The sweep is the point, not the fix. `.optionalref.mjs` walks **every** drawer that
asks for these fields and reads the `required` flag off the live inputs, plus the asterisk off the
labels — so the next screen that quietly adds one is caught. It also records a cash-in through the
API with neither number and checks both columns land as `null`, not as an empty string dressed up
as a value.

**Open.** Nothing half-done. Description, date, account and amount stay required on Cash In, which
is what the harness's last check is careful to allow: it asserts only that neither number is among
what the form objects to, rather than that the form validates with everything blank.


## 2026-08-27 — a heading names what goes with it, and then takes it

**Done.** The owner's rule: show the heading and the things under it in the warning, with the same
`›` the screen already draws, and if the person agrees it deletes. Two things had to be built
before that warning could be true.

**Categories had no delete at all.** The kind has been live on the API since the trash was built
and reachable from no screen. Headings now carry a trash button beside edit and *Sub-category*, and
each sub-category chip carries its own.

**A heading now takes its sub-categories with it.** It did not before: the children stayed,
pointing at a parent in the trash, which means they were drawn nowhere — the panel renders headings
and their children — while payments carried on being filed against them. Invisible and still in
use is the worst of the three possible answers.

This reuses the seam that already existed rather than inventing one: `siblingIds` is what takes
both halves of a transfer, and it now takes a heading's children. Coming back out,
`siblingIdsInTrash` matches on `deleted_at` equality — the same trick `restore` already uses for
`voided_at` — so restoring a heading brings back exactly the children that went in with it, and a
sub-category somebody deleted on its own last week stays where they put it. Measured, not assumed.

The warning is per row, so a heading with nothing under it makes no claim about sub-categories. It
also says the part people actually worry about: payments already filed keep their amounts and no
total moves — they read as Uncategorised until it is restored.

Commits: `b3b39a7`.

**Watch out — one shared file changed.** `components/ui/use-row-delete.tsx` now accepts
`consequences` as a function of the row as well as a plain node. Additive and backward compatible;
every existing caller still passes a node. The screens that use the hook are transfers, the five
ledger screens behind `use-transaction-delete`, payroll, rate history, sign-ins, subscriptions,
team — and now categories. All of them were driven afterwards rather than reasoned about: the full
battery, twenty harnesses, is clean.

The audit wording moved with it. `alsoWent()` replaces the hardcoded "and its matching transfer
row", which would otherwise have described three sub-categories as a transfer row in the permanent
record.

**Open.** `.catdelqa.mjs` (15 checks, API and browser) is the harness. Deleting a heading does not
touch entries filed under it — that was already the decision recorded in the registry, and it is
now said out loud in the dialog instead of only in a comment.


## 2026-08-27 — two hours idle, and never while somebody is working

**Auth only, on its own push.** Commit `ae9989c`.

**Done.** The owner's rule, stated plainly: *the session does not end while anybody is active; two
hours of inactivity means signing in again.* `IDLE_MS` is `120 * 60_000`.

The first half of that rule was already true and is now tested rather than assumed. The idle clock
is not a session length — every deliberate action resets it, and the seven-day refresh token behind
it is what lets a person work all day without being interrupted. `.sessionqa.mjs` proves it from
the worst starting point it can: ninety idle minutes, one click, and the clock reads two seconds.

**Watch out — one deliberate exception, and it is not a bug.** Once the last-minute dialog is up,
activity *underneath* it is ignored; only the **Stay signed in** button counts. That is the whole
point of the guard: a knocked desk, a cat or a drifting trackpad must not answer on behalf of
somebody who walked away. Mouse movement is not an activity event anywhere for the same reason —
clicks, keys, scrolls, touches and tab focus are.

A test written the other way round *failed*, correctly: clicking through the overlay from inside
the final minute does nothing, because the overlay is what receives the click.

**Open.** Nothing half-done. One trap for anyone testing this by hand: activity is written to
localStorage at most once every ten seconds, so winding the clock back and clicking straight away
is throttled and reads as no activity at all. Real use never meets it; a test does.


## 2026-08-27 — the whole battery re-run on top of the auth and challan work

**No source changed.** The owner asked whether the earlier fixes still hold after the session and
challan work went in — `api-client.ts` in particular sits on every request path. So all nineteen
harnesses were re-run against `6e6fc12`, which is what production is serving.

**Result: nineteen of nineteen clean**, 180-odd checks. Live matches HEAD and both deploys are
green.

**Two harnesses were lying, and both are fixed.** Worth reading before trusting a red battery:

- **`.trashui.mjs` had no wipe at the start** — it only deleted its own two rows at the end. A run
  that died before cleanup (the local API stopping mid-run is enough, and it did) left a row
  wearing the same description. The next run then aimed the dialog by that description, hit the
  *stranger*, trashed it, and reported its own row as untouched: three failures that read exactly
  like a broken delete. The delete was never broken — the network log showed `POST 201` against a
  third id. It now clears `description like 'UI QA:%'` before seeding.
- **`.trashqa.mjs` picked a category with `limit 1` and no `order by`**, then asserted the id
  appeared nowhere in `GET /categories`. When the lottery handed it a heading, six children still
  carried that id in `parentId` and the check failed — while the category itself had left the list
  exactly as it should. It now picks a leaf in a fixed order and asserts on rows, not on a
  substring of the payload.

**Watch out.** Both failures cost time because a red harness reads as a broken app. The rule that
found them: when a harness fails, ask what the app actually did before asking what the app got
wrong — the network log settled both in one run.

**Open.** Trashing a *heading* category leaves its children pointing at a parent that is in the
trash — six of them, measured. Nothing counts wrong because of it, so it is not the rule the owner
set, but what those child rows render as has not been looked at. Nobody's item yet.


## 2026-08-27 — a challan in the trash stops counting as tax paid

**Done.** The register that lists challans filtered `deleted_at` from the day it was written. The
figures that add challans up did not — they only asked whether the linked payment had been
voided. So trashing a challan took it off the screen and left its money in every total, and an
**unpaid tax obligation read as settled**: the month showed `outstanding 0.00`, the Reports
overview counted it as deposited, and the dashboard's "withheld but not yet deposited" warning
never fired. Nothing on any screen contradicted it — the row was simply gone and the total was
simply wrong.

Six places summed challans and **none** of them excluded a trashed one. Three had the voided-
payment half; three had no filter at all:

| Where | Had | Reaches |
|---|---|---|
| `tds.service.ts` `outstandingAllTime` | voided only | Reports overview, bank statement |
| `tds.service.ts` `liability` | voided only | the TDS screen's month rows |
| `tds.service.ts` `pending` | voided only | the dashboard's tax card, the Reports export |
| `overview.service.ts` `taxMoved` | nothing | Reports "tax deposited" |
| `ai-tools.ts` `taxStatus` | nothing | what the assistant answers about tax |
| `notification-events.ts` `undepositedTds` | nothing | the nightly reminder |

The rule now lives in one file, `tds/challan-counts.ts`, and all six read it — `CHALLAN_COUNTS`
for the five that sum deposits, `ALLOCATION_COUNTS` for the reminder, which sums *allocations* and
needs the deposit brought into scope first. One constant rather than six restatements, for the
reason this repository keeps re-learning: a condition written out six times is a condition that is
right in five of them.

Commits: `8019d90`.

**Watch out.** Two places deliberately do **not** take the rule, and both would be wrong if they
did:

- **`AccountsService.attachments()`** counts what still points at an account so it can say whether
  the account is deletable. A trashed challan is still a row holding a foreign key and Postgres
  will still refuse the delete — filtering there would promise a delete the database then rejects.
- **`listDeposits`** keeps its own `deleted_at`-only filter. The register answers "what challans
  exist", which is a different question from "what counts as paid": a challan whose payment was
  voided is still a record somebody entered, and hiding it would leave nothing to correct.

**Open.** `.challanqa.mjs` (17 checks) is the harness; it seeds October 2026 for the figures and
July 2026 for the reminder, because the nightly sweep only looks at last month and this one. Every
check was watched failing before the fix, including the reminder — that one was proved by
switching `ALLOCATION_COUNTS` off for a run rather than by reasoning about it.

**The same defect exists next door and is untouched.** `income-tax.service.ts` `list()` filters
`deleted_at` on its no-year branch and calls `fetch()` (unfiltered) on its assessment-year branch —
the five-of-six shape again, in one function — and `pending()` there has no filter and feeds the
Reports export. There is no web screen for it, so it is API-and-export-only. That was said about
`tds-deposit` too, right before it turned out to reach four screens. It wants its own session.


## 2026-08-27 — the session lasts an hour, and stops dying at random

**Auth only, on its own push**, per the rule about auth travelling alone.

**Done.** The owner's report was "the session expires very early and signs me out". It was two
faults, and only one of them was the twenty minutes anybody would guess at.

1. **The idle timeout was twenty minutes.** It is an hour now — `IDLE_MS` in
   `auth/idle-timeout.tsx`. The last minute is still spent asking "Still there?", and past the
   hour it still signs out: the guard is aimed at an unattended desk in a shared office, and that
   is worth keeping.
2. **Two refreshes arriving together killed the session outright.** The refresh cookie belongs to
   the browser, not to a tab, so two requests dispatched before either reply's `Set-Cookie`
   landed both carried the same token. The first rotated it; the second was read as a stolen
   token being replayed, and `rotate()` revoked the whole family. Measured before the fix: two
   concurrent refreshes left `alive = 0` — even the winner's brand-new token was dead, so the
   next click went to the sign-in screen. A screen left open past the access token's quarter of
   an hour fires all its fetches at once when touched, and every one of them 401s, so this was
   reachable in one tab.

The second fix has three parts, and the middle one is the part that matters:

- `rotate()` now reads the row `for update`, so two requests carrying the same token are decided
  rather than raced. Without the lock both read a clean row and both rotated it, leaving the
  family with two live heads while the browser could only keep one.
- Inside a **30-second window**, and only while the family still has a live head, the straggler
  is answered with a fresh access token and **no new refresh cookie**. That last part is what
  makes it safe whichever reply arrives last: only the winner ever writes a refresh cookie, so
  the browser cannot be left holding a token that has already been retired.
- The browser sends **one refresh at a time** (`refreshOnce()` in `lib/api-client.ts`), so the
  noise is not made in the first place.

Reuse detection is narrowed, not switched off, and the harness proves it still fires: a replay
after the window is refused **and takes the family with it**, a straggler whose family has no
live head is refused, and a token that signed out cannot refresh.

Commits: `a812869`.

**Watch out.** `ROTATION_GRACE_MS` in `token.service.ts` is a deliberate security trade-off: a
stolen refresh token presented within 30 seconds of the legitimate rotation gets one access token
without tripping detection. Shorten it and the race returns; lengthen it and the window widens.
The access token TTL is untouched at 15 minutes — the proxy renews it before each render, and
that path was checked rather than assumed.

**Open.** `.sessionqa.mjs` at the repository root is the harness — 13 checks, API and browser. It
creates and deletes one local account and never prints its password. It winds the idle clock back
**after** the page is up, because the component stamps "now" on mount and a value written before
the navigation is silently overwritten — the first version of the test failed for exactly that
reason and would have passed a broken fix.


## 2026-08-27 — TDS: four faults on one screen, and the missing row action

**Done.** The owner reported two things about `/tax/withholding` — no way to delete, and "data
doesn't come properly, and the same data is in every tab". The second turned out to be four
separate faults stacked on one screen, each of which alone looked like the whole complaint:

1. **A trashed payroll run stayed on the register.** The soft-delete filter reached the payroll
   *lists* but not the nine joins behind the TDS register, so a run in the trash kept its people
   on screen and its tax in the period total. Both are now one shared constant,
   `FINALISED_OR_LATER` in `tds.service.ts`, so five-of-six coverage is no longer possible.
   Proved by trashing a seeded run: rows 1 → 0, total 2500.00 → 0.00, and back on restore.
2. **Switching granularity anchored on the period's start**, so coarse → fine always landed the
   reader on July. One round trip through the tabs and every tab genuinely did show the same
   rows — this is the "same data in all tabs" report, and it was real. `chooseGranularity` now
   anchors on today when today falls inside the period being left.
3. **The page opened on the month we are in**, which is the month least likely to hold a
   finalised run, so it opened empty. New `latestPeriodWithTax()` walks the periods newest-first
   and opens on the newest one that actually has tax.
4. **`monthRange()` echoed the calendar year as the fiscal one**, putting the screen a whole
   fiscal year out between January and June. Now `fiscalYearOf(range.start, mode)`.

And the row action: the register's rows now end with the same edit + delete pair every other
table has. The pencil moved out of the challan cell into `RowActions`; delete asks first ("Take
this challan off the row?") and then clears the number and its month flag. It removes the
*challan*, not the deduction — a deduction belongs to a finalised payroll run and is deleted by
deleting that run, which is what the trash is for.

Commits: `81d365c`.

**Watch out.** `FINALISED_OR_LATER` is the one place the register decides what counts. Anything
new that reads payroll for tax should use it rather than writing `status <> 'draft'` again — the
missing `deleted_at is null` is exactly how this bug happened.

**Open.** `.tdsqa.mjs` at the repository root drives all five (11 checks, local only — it writes
and deletes). Its `wipe()` clears 2026-09 and 2026-11 payroll runs by month as well as by label,
because a leftover fixture from an earlier probe fails the insert rather than the check.


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

## 2026-08-27 — a transaction id, or just the slip

**Done.** All four entry drawers (expense, cash in, transfer, subscription)
offer a choice above the reference field: **Transaction ID** (box + paperclip,
unchanged) or **Reference only** (paperclip alone — the paper *is* the
reference). The tables answer in one cell: number → clickable as before,
no number but paperwork → an **eye** that opens the same drawer, neither →
a dash. Commit: `06a45d7`.

**Nothing is stored to say which kind an entry is.** A row with a number is
the first case, one without is the second — so the flag cannot drift from the
data, no migration was needed, and every pre-existing entry reads correctly.
The shared piece is `components/ledger/reference-kind.tsx`
(`ReferenceKindToggle`, `ReferenceCell`, `ReferenceInput`).

**Watch out.** The subscriptions listing gained `documentCount` (API
projection + web DTO), counting invoice/bank files but **not** the plan's own
screenshot — the number cells do not open that one. A table using
`ReferenceCell` must pass a real count; an eye over an empty drawer is worse
than the dash it replaces.

---

## 2026-08-27 — an account chooses its primary currency

**Done.** The account form's currency choice (now labelled **Primary
currency**) governs the drawers. USD-primary account: the expense drawer asks
dollars-first and derives the taka (computed-until-touched); Cash In makes the
dollars required; Money Transfer grows a dollars+rate pair when either side is
USD-primary and writes them on both halves; the transfers table gains
Amount (USD) and USD rate columns. Commit: `fc167ff`.

**The invariant held, on purpose:** every stored amount is still taka
(`transactions.amount`, balances, every SQL sum). The dollars land in
`original_amount`/`fx_rate`/`usd_rate` beside the taka — recorded, never
counted. `.usdprimaryqa.mjs` (10 checks) proves both sides.

**Watch out.**

- **`isToolSpend()` changed**: the non-BDT-account half now also requires
  `accounts.type = 'card'`. Behaviour-preserving today (every non-BDT account
  is a card), but a USD-primary *bank*'s spending no longer auto-counts as AI
  tooling — which is the point.
- `transferSchema` gained optional `usdAmount`/`usdRate` (shared — rebuild
  dist). The transfer service writes originals on both halves when both are
  present.
- The three entry forms each derive `usdPrimary` from the accounts prop — an
  account picker that stops carrying `currency` breaks the flip silently.

---

## 2026-08-27 — the word matches the act: trash in, delete out

**Done.** The owner's catch: the row action said "Delete" but moved the row to
the trash. All row-ceremony language is now trash-language — tooltip "Move to
trash", dialog "Move this X to the trash?", **typed word `trash`**, button
"Yes, trash this X". The word **delete** (typed word `delete`) survives only
where it is true: the trash's permanent removal and Empty-the-trash. Commit:
"The word matches the act".

Side effect worth knowing: the two ceremonies now take **different typed
words**, so trained fingers from trashing rows cannot type through a permanent
delete. `DeleteDialog` gained `mode: "trash" | "delete"` plus `title`/`intro`
overrides; screens that trash rows change nothing (trash is the default).

**Watch out.** Any new probe or test must ask for
`button[aria-label="Move to trash"]` and match `/to the trash\?/` — the three
browser harnesses were retaught in the same commit.

---

## 2026-08-27 — the transfers table joins the standard

**Done.** Money Transfer now follows the owner's table rule like everything
else: **Invoice No.** and **Transaction ID** as their own columns, both opening
the documents drawer (blue over paper, amber over nothing, underlined either
way); the form carries the same two fields with paperclips, files upload after
the pair records. The invoice lands on both halves so either register shows
it; paperwork anchors on the out half. Commit: "The transfers table joins the
standard". `.transferqa.mjs` is at 23 checks.

**Watch out.** `transferSchema` gained `invoiceNo` (shared — rebuild dist).
The `Attach` paperclip helper now has a **third** local copy
(transfer-form.tsx, beside transaction-form and cash-in-form) — the extraction
into one shared file is the known rough edge, now three copies strong.

---

## 2026-08-27 — the guards come off, and the pages stop going stale

**Done.** Two owner decisions. Commits: `fbfa436`, `32ea898`.

**Every business-data delete guard is gone.** Accounts, categories, vendors,
team members and committed imports all delete freely now, entries or no
entries. What each deletion leaves behind is deliberate and documented in the
registry: ledger rows keep their money counted, a deleted category's entries
read as Uncategorised, a deleted person's payments stay. **One guard remains
— the last super admin —** because deleting it locks every door in the app
with the key inside; the owner can order that one gone too. Permanent
deletion still meets the database's own wall (FK) when rows point at the
thing being purged: that now answers as a sentence, and Empty-the-trash purges
what it can and names the kinds that stayed.

**The client page cache is off** (`experimental.staleTimes: {dynamic: 0,
static: 0}` in next.config.ts). The payroll "latest data update hocchena"
report was Next reusing a whole prefetched page for five minutes —
per its own docs, and invisible in dev because dev does not prefetch. Every
navigation now asks the server. The payroll list also syncs its rows when a
refreshed prop arrives (render-phase sync).

**Watch out.**

- Deleting an account/category/person no longer warns about their entries.
  The trash restores everything, but a purge of a still-referenced row is
  refused by the database — with a sentence now, not a 500.
- `staleTimes 0/0` trades prefetch speed for correctness everywhere. If a
  screen ever feels slow to open, this is the knob, but turn it knowingly.
- A production `next build` was run locally to prove the experimental key is
  valid on this Next version before the deploy met it.

---

## 2026-08-27 — a paid payroll run deletes like any other

**Done.** The owner reversed the trash's paid-run guard: the `blockedWhen` on
kind `payroll-run` is removed and the delete dialog's copy rewritten. Commit:
the one titled "A paid payroll run deletes like any other".

What still holds, and the dialog now says so: **deleting a run never touches
the ledger.** The salary payment rows a paid run posted stay on All
transactions — void or delete them there, or the money still reads as spent.
Restore brings the run back whole (paid status, lines). A permanent delete
cascades run → lines → challan allocations → payslip-file rows (all FKs are ON
DELETE CASCADE, verified against the database), while ledger rows survive even
that.

**Watch out.** If somebody deletes a paid run and forgets the ledger half, the
month's salary total on the dashboard stays spent with no sheet behind it —
that is now possible by design. The audit log holds both halves of the story.

---

## 2026-08-27 — the full battery, run once over everything

**Done.** Every harness this codebase has, run in sequence against the local
stack at the day's final state, plus a read-only sweep of the live site. All
green; no code changed.

| Harness | Covers | Result |
|---|---|---|
| four CI steps | build:shared, typecheck, lint, test | all 0 |
| `.trashqa.mjs` | delete/restore/purge/empty, totals move exactly | 21/21 |
| `.trashroles.mjs` | every role incl. CFO, allowed and refused | holds |
| `.overdraftqa.mjs` | never-below-zero through all eleven doors, deleted twins | 25/25 |
| `.transferqa.mjs` | transfer pair listing, void/trash as one, form refusals | 21/21 |
| `.payrollpickqa.mjs` | choose-the-people flow, edits survive, all fences | 17/17 |
| `.fivefixui.mjs` | link colour measured, dashboard subtitle, hidden sleeper | 12/12 |
| `.trashui.mjs` | the delete dialog's gates, driven as a person | 17/17 |
| `.delsweep.mjs` | every delete-wired screen, button pressed for real | 9 clean |
| `.qa.mjs` (15 routes) | headings, tables, alignment, sideways scroll | nothing flagged |

Live, read-only only (no POSTs, no sign-ins): `/api/health` reports exactly
`origin/main`'s hash; eleven protected API routes answer 401 and a made-up one
404; `/login` serves the form in ~0.26s; all eight protected pages 307 to
login with the right `next`; the TLS certificate has 78 days and renews
itself. 25/25.

**Watch out.** Nothing new. The standing gaps are the ones already on
record: payroll finalise→pay has never moved real money end-to-end, and the
Reports inner tables' arithmetic has not been hand-checked against a known
dataset.

---

## 2026-08-27 — Cash In carries no category

**Done.** The Category field is out of the Add cash drawer, the cash-in schema
(strict — a stale client sending one gets a loud 400) and the service's cash-in
door. Commit: `c6b64d3`. Only that door: POST /transactions, the AI intake and
the Excel import still require a category. The seam is `create()`'s signature —
category optional internally, required in the public schema.

Checked before allowed: every reader of a null category was measured. Lists
LEFT-join and draw a dash; the dashboard and Reports income breakdowns bucket
null as "Uncategorised" **keeping the amount**; the statement maps it by hand;
the export prints an empty cell. `category_id` was nullable in both databases
all along — no migration. Existing cash-in rows keep their categories.

**Watch out.** `cash-in-form.tsx` no longer takes a `categories` prop and the
cash-in page no longer fetches the tree. If a future screen reuses the form,
nothing category-shaped is left in it.

---

## 2026-08-27 — payroll: who is on the month is chosen, not assumed

**Done.** Starting a payroll month now opens with the month's own people —
each with their wage, ticked by default — and Start builds the sheet for the
ticked set; the separate Build click is gone. On a draft sheet the **People**
button reopens the same checklist; finalise locks it, reopen unlocks it.
Commit: `a9c1766`.

The machinery is `PayrollService.syncMembers` (POST `/payroll/runs/:id/members`,
declarative: the run comes to hold exactly the given people) plus
`GET /payroll/eligible?periodYear&periodMonth`. **Sync is not the rebuild**:
`generateLines` still wipes and rebuilds (use it for raises); sync leaves kept
lines untouched — typed bonuses and breakdowns survive the list changing. Both
build lines through one `buildLine` helper now, so they cannot drift.

**Watch out.**

- **Drizzle renders `${table.column}` in a raw `sql` fragment as the BARE
  column name** — no table qualifier. Inside a correlated subquery that bare
  name binds to the *inner* table first: the eligible list's correlation
  silently became `ch.team_member_id = ch.id`, false on every row, and the
  picker said nobody in the company had a wage. Valid SQL, invisible in the
  diff. If you embed a column reference into raw SQL that contains its own
  FROM, write the qualification out by hand (`"team_members".id`).
- The old build path's compensation lookup never filtered `deleted_at` — a
  trashed salary row could decide pay. Fixed inside `buildLine`.
- `member-picker.tsx` is shared by the start-a-month form and the sheet's
  People drawer — change it once, both doors change.

**Open.** Nothing on the flow itself. `.payrollpickqa.mjs` (17 checks, API +
browser) is the harness; payroll finalise→pay itself has still never been
exercised end-to-end with real bank entries — unchanged from before.

---

## 2026-08-27 — Money Transfer has a page

**Done.** `/transfers`, "Money Transfer" inside the Accounts accordion in the
rail (the owner moved it in from the section's top level — it sits with Cash In,
the other way money moves through our own accounts; the breadcrumb reads
Finance / Accounts / Money Transfer on its own). Commit:
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
