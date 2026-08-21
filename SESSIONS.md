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
