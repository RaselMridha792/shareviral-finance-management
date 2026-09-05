# The owner's list

Updated 1 Sep 2026, overnight. **Everything marked done below is pushed and
deployed** — the "unpushed" notes this table used to carry were from earlier in
the day and are gone. Each item's own section further down says what was built,
what it broke, and what proved it.

## The state of it, 1 Sep 2026, 05:00

**Everything below is pushed and deployed.** The last deploy carries the lot;
`api.hellonizam.com/api/health` answers 200 and the app redirects to sign-in as
it should.

**All 41 acceptance harnesses pass.** `.battery.sh` reported five failures on
its first clean run — `.refkindqa`, `.navchk`, `.rolecheck`, `.linkcheck` and
`.sweep`. Every one of them was the machine rather than the app: three could not
resolve Neon (`ENOTFOUND` / `ENETUNREACH`) and one hit a detached Puppeteer
frame. Re-run one at a time, all five pass.

Worth writing down because it cost an hour twice tonight: **the battery must run
alone.** Its own header says so, and both times something else was driving the
same database the log filled with failures that were nothing but two harnesses
seeding and deleting each other's fixtures. A run alongside anything else is not
evidence.

Two harness faults of the same family were fixed rather than worked around:
`.refkindqa` had fixtures dated `2026-08-19` and Other expenses opens on the
current month, so on the first of September every one of them fell off the
screen and three checks blamed the product. And `.dateqa` now fails a blank
page — a compile error mid-session had it walking seventeen empty screens and
ticking all seventeen.

## What is LEFT

| # | What | State |
|---|---|---|
| 50 | Payslip: the company name printed twice | **done** |
| 51 | **Payroll: invoice and reference upload** when a run is created | **done** |
| 56 | **Exports: a Windows CSV mail list, a data sheet, a bank statement PDF** | **done** |
| 57 | **Salary sheet: the tax auto-fills AND can be typed over** | **done** |
| 58 | **Subscriptions: a Charge added to the price** | **done** |
| 59 | **Subscriptions: three live bugs — the dollar balance, the save error, the vanishing row** | **done** |
| 60 | **Subscriptions: the charge is in dollars, not taka** | **done** |
| 61 | **A bank charge on every kind of transaction** | **done** |
| 62 | **Cash In: one order, the derived box locked, a charge on both account kinds** | **done** |
| 63 | **Expense overview: Office rent replaces Uncategorised, cards get the dashboard's look** | **done** |
| 64 | **A dollar card's balance stood still while its taka moved** | **done** |
| 65 | **Subscriptions register reads in dollars, taka under it** | **done** |
| 66 | **Payroll carries no paisa; the tax box is usable; Net follows the boxes** | **done** |
| 67 | **A USD account showing ৳56.70 and $0.00** | **done** |
| 55 | Payslip: Prepared by removed, both dates numeric, footer trimmed and made readable | **done** |
| 52 | Payslip: Working days as a number | **done** |
| 53 | Payslip: the Gross-and-Deductions line | **done** |
| 54 | Payslip: the currency in front of the words | **done** |
| 43 | Money transfer: the date read `2026-07-02` | **done** — and it exposed a blind spot in the sweep |
| 44 | **Money transfer**: eye buttons, tick column + trash | **done** — preview and multiple upload were already there |
| 45 | **All transactions**: Invoice and Reference, Entry No. off, eye buttons | **done** — the rest of it already existed |
| 46 | **All transactions**: one red, not two | **done** |

## 74. Admin and Finance retired; four roles left

> *"admin role take delete kore daw and Finance Role take delete kore daw ekhane
> Finance and CFO akoi role er under a ache tader kaj akoi and admin er dorkar
> nai super admin holei hobe"* — and then, mid-work: *"make sure kono data jeno
> na haray"*.

He was right about the premise, and the code said so: **`admin` and `cfo` were
literally the same array**, and `finance` was that array minus master data. So
this removed two names, not two capabilities.

**Two pushes, in this order, and the order is the whole item.**

`hasPermission()` looks the role up in a map and calls `.has()` on the result.
For a role the code no longer knows that entry is `undefined`, so it does not
return false — **it throws**. A user still on `admin` when the code shipped
would have met a **500 on every request in the app**, not a refusal. Measured,
not assumed. So `3aebf9f` moved everybody first, on the release before the list
shrank, while the running code still understood both values.

**Where they went, and why not Super Admin.** He said "super admin holei hobe",
and Super Admin was declined for a reason worth writing down: it is the only
role with `settings.write` and `users.manage`, so moving fourteen people there
would have handed all of them the ability to change company settings and to
create and deactivate sign-in accounts — something they had never had. **CFO is
Admin's row exactly**, so an Admin moved there lost nothing and gained nothing.
Finance gained four (accounts.write, categories.write, team.write, audit.read),
which is his decision that the two are one job.

**Nothing was deleted.** 33 users before, 33 after. Every transaction, payroll
line and file keeps the id of whoever made it. Soft-deleted users moved too —
restoring one months later is exactly how a lone `admin` reappears on a release
that throws on it.

**History was not rewritten.** `audit_logs.actor_role` records the role somebody
held AT THE TIME; 140 entries still say `admin` and 46 still say `finance`, and
they should. That drove the shape of the code:

- `STORED_ROLES` (six) describes the **database** — Postgres has no
  `ALTER TYPE … DROP VALUE`, so `pgEnum("user_role", STORED_ROLES)` keeps
  Drizzle's picture of the column true.
- `ROLES` (four) is what the app will **hand out**.
- `ROLE_LABELS` is keyed by the six, so an August entry still reads "Admin"
  rather than going blank.
- Anything reading a role off a row — `AuthenticatedUser`, `UserDto`,
  `AuditEntryDto.actorRole`, the request context, the audit writer — is
  `StoredRole`. The compiler found all of them; that is the whole reason to have
  two types rather than one.

**`hasPermission` now fails closed.** No row in the matrix means no permissions,
where it used to mean an exception. A user somehow on a retired role can sign in
and sees nothing — diagnosable and safe, where a 500 is neither.

**Nobody was logged out, and nobody had to be.** The JWT guard re-reads
`users.role` from the database on **every request** rather than trusting the
token's claim, so a session opened before the migration carried the new role on
its very next click. Bumping `tokenVersion` would have signed fourteen people
out to fix a staleness that does not exist here.

**The users screen tells the truth again.** Its one-line role summaries had HR
as *"The team directory. Never salary."* — untrue since 2026-08-15, when the
owner gave HR compensation. A wrong summary on the screen where roles are
**handed out** is worse than none. It now reads "The team and their pay.
Prepares payroll but cannot release it, and does not see the ledger." A new
account starts at CFO, not the Finance that no longer exists.

**Proved by `.rolesqa.mjs`** — 21 checks against the real API and the real
database. The ones that matter: a row on a retired role **fails closed rather
than throwing**; not one user is left on either; 33 users before and after; the
migration's own audit rows name who moved and from what; 186 historical entries
keep their old actor role; a live CFO still reaches the ledger, accounts,
payroll and the audit log, and is still refused user management; and the API
**refuses to create anybody as Admin** (400, and no row written).

## 73. The bank statement PDF: ledger first, four columns, nothing cut

> *"bank statement export er etake valo ekta font a daw. ekhane font gula onek
> boro boro dekhacche etar ui ke sundor koro. line by line statement take surute
> rakho tarpor graph chart gulake nice rakho. and ekhane line by line table ta
> theke description bad daw. ekhane date, debit credit, and ballance field
> gulake rakho kono kichu jeno kata na pore font choto kore diyo dorkar hole."*

**The ledger moved ahead of the charts.** Right, and not only a preference: the
line-by-line is what somebody opens a statement to read, and the charts are a
summary of it. A summary before the thing it summarises asks the reader to take
it on trust. Pages are now cover → ledger → movement.

**Four columns, Description gone.** It was taking 37% of the sheet and every
other column was being cut to pay for it. Measured in the real face, at the old
widths: the date needed **55.9pt of 54.9pt** and printed "09/06/20..", the
description **210.6pt of 184.7pt**. Now, on the same figures:

    Date      104.1pt      Debit  113.6pt      Credit  113.6pt      Balance  142.0pt

**Debit then Credit, not In then Out.** `bank-statement-screen.tsx` puts
`direction === "out"` under Debit and `"in"` under Credit; the PDF had the same
two figures in the other order under other names, so a reader had to check the
headings before trusting either. This is the one thing on the page that would be
*wrong* rather than ugly if reversed, so the harness asserts it from the built
rows rather than from the source.

**The transaction number stays, under the date.** It is not a description — it
is the handle you match a row to the bank's own statement by, and a statement
whose rows cannot be identified is not one you can reconcile. It costs no width:
it sits on the second line the date's row already has. A voided row says VOIDED
there too, which it used to say in the description's detail line.

**Two bugs found on the way.**

The period read *"05/05/2026 05/09/2026"* — a range with nothing between its
ends. The label is built with a `→`, **U+2192 is not in the embedded subset**,
and `drawable()` turns an uncovered character into a space. Changed to an en
dash, which is in the subset, and `SUBSTITUTES` now catches an arrow as a
hyphen so the next one degrades instead of vanishing.

And the harness's own first run measured columns **26pt too wide** — it assumed
PDFKit's default 48pt margin where the service uses 61. A width check on the
wrong page width would have called a cut column fine.

**Type came down rather than the font changing.** Cover display 58 → 40, page
titles 36 → 25, ledes 12.5 → 10.5, the cover's figure boxes and its foot band
sized explicitly, the ledger table at `scale: 0.86`. The typeface is still Noto
Sans Bengali and has to be: it is what draws **৳** at all — the built-in
faces are Latin-1 and print the taka sign as nothing. Its Latin is the Noto
Sans skeleton, so it is a real text face rather than a fallback. A different
one means embedding another licensed file, which is a decision for the owner.

**Three additive options on `pdf.service.ts`** — `size`/`height` on
`figureBoxes` and `bigFigures`, `scale` on `stackTable`. Per block, defaulting
to exactly what the other two reports already got, because that file draws the
finance statement and the overview as well. Both were regenerated afterwards
(6 pages and 1 page, 200) rather than reasoned about.

**Proved by `.stmtpdfqa.mjs`** — 17 checks. A PDF cannot be read back as text
here: the face is subsetted, so every string in the file is a run of glyph ids.
So it measures the two things that decide the document instead — the spec the
report builds, and **the width each cell will draw at, computed with PDFKit and
the real embedded font** against the width its column actually has. That second
one is the only way to know `fit()` is not about to append "..", because nothing
in the source says it is going to.

## 71. Payroll's selection bar was inside the table

> *"ekhane dekho multiple select korar por eta table er vitore dhuke jacche and
> broken hoye jacche. team page er ta thik ache eirokom howa ucit. issue ta
> sudhu payroll page er moddhe ache."*

Right on all three counts, including the last. `<BulkBar>` sat between
`<table>` and `<thead>` on the payroll list. Nothing but a caption, a colgroup,
a row group or a script may live there, so the browser hoists the div out during
parsing and paints it wherever it lands — a 185px box floating over the first
rows, the table starting 131px above where the bar ended.

Moved above `<TableScroll>`, which is where Team's has always been. Above the
scroller rather than inside it, so the bar spans the card whatever the table's
width is and does not scroll sideways away from the ticks it belongs to.

**Only payroll**, and that was checked rather than taken on trust: nine screens
render a `BulkBar` and a short script walked all nine comparing `<table` and
`</table>` counts before each one. Eight were already outside. (The script's
first run said payroll was *still* inside after the fix — it was counting the
word `<table>` inside the explanatory comment I had just written. The line
numbers settle it: bar at 271, table at 282.)

**Proved by `.bulkbarqa.mjs`** — 9 checks in a real browser, because a layout
fault is invisible in a diff. It ticks the header checkbox on both pages and
measures the bar's box against the table's:

    Team      bar ends 356, table starts 460, 1104px of a 1108px table
    Payroll   bar ends 234, table starts 234, 1102px of a 1102px table

And it was run against the **broken** build first, to be sure it detects rather
than merely passes — 4 of 9 failed, naming the descendant relationship, the
131px overlap and the 185px width.

That run also improved the harness: the check named *"does not overlap the
header row"* **passed** on the broken build, because the hoisted box happened to
land over the data rows instead of the header. The one check named after the
symptom was the one that missed it. It now asks about the whole table.

**Two dev-server notes that cost time.** Port 3000 was running a different
project entirely, so every page answered 404 and it read like a routing fault;
the SFM web server is on 3001. And the bar is found by `[role="status"]` — the
first attempt hunted for a `div` containing the word "selected" with a button
in it, which matched nothing and reported "no bar" for both pages, which reads
exactly like the feature being absent.

## 72. Accounts overview: balances as at the end of a month

> *"also account overview page a date month filter any diyo dropdown akare"*

On a screen of balances a month can only mean one thing — what each account held
when that month ended — so the dropdown sends the month's **last day** and every
figure on the page is read up to it, the total included.

**Its own dropdown, not the Expenses `MonthFilter`**, and the reason is one word
on one row. That control's escape hatch reads "Every month", which is right for a
screen listing entries and meaningless for a screen showing balances. Here it
reads **As it stands now**. Reusing the shared control would have meant changing
that label for the three Expenses screens and the subscriptions register too, to
say something none of them mean.

**One predicate, not three edited expressions.** `counted(asOf)` answers "does
this row count" once, and the three balance expressions — taka, own-currency,
and the is-this-exact flag — are now functions of it. `currentBalance` is
`balanceUpTo(null)`, so every existing caller including the dashboard produces
the identical SQL it always did. The comment on `balances()` explains why that
mattered: two places working out the same money two ways is how two screens come
to disagree with no way to tell which to believe.

**The opening balance is part of the cutoff.** An account opened in March holds
**nothing** at the end of January, and adding its opening figure to a January
total would report money that was not there. `openingUpTo` handles it, and
without a cutoff it is simply the opening balance, so today's behaviour is
unchanged to the byte.

**Proved by `.asofqa.mjs`** — 13 checks. A taka bank and a dollar card, both
opened 1 March, one movement a month:

    end of Feb     ৳        0.00    card $     0.00     (not open yet)
    end of Mar     ৳  1,50,000.00   card $ 1,000.00
    end of Apr     ৳  1,30,000.00   card $   700.00
    end of May     ৳  1,40,000.00   card $   700.00
    as it stands   ৳  1,40,000.00   card $   700.00

The check worth having is the April card row: the cutoff has to reach the
own-currency expression as well as the taka one, or the page looks filtered and
is only half filtered. A junk `asOf` is refused with a 400 rather than ignored.

## 70. A renewal is not billed at the rate the plan was signed at

The owner, on Record a payment:

> *"renew er ekhane bank charge ane diyo. also usd bdt and usd rate sobgula
> field e aino. karon prottek renewal a rate soman thakena."*

The last clause is the whole item. A plan stores the rate its price was struck
at — sign a $100 plan at 120 and it carries ৳12,000 forever. The drawer offered
a taka box and a rate box, so a renewal in April at 128.50 either went in at
January's figure or somebody did the multiplication in their head, every month.

The money block is now the one Cash In uses, in the order the money is actually
known:

    Amount (USD)   $100.00        what the card was billed
    USD rate        128.50        the day's, not the plan's
    Amount (BDT)  ৳12,850.00      worked out, and still typeable
    Bank charge      ৳230.00      its own row under Bank charges

Every box is optional and every one has the plan's own figure behind it, so an
ordinary renewal at the usual price and rate is still a date and a button.

**Three things about the shapes.**

The taka is **derived until touched** — `bdtTouched`, the same guard the
transaction and Cash In forms carry. The gap between the product and the typed
figure is exactly what a card's own rounding looks like, so overwriting it would
be the drawer arguing with the statement.

The rate's placeholder is the plan's, **not its value**. A box that arrives
already filled is a box nobody re-reads, and the entire reason this one exists
is that the figure moves between renewals. Left alone it still uses the plan's.

The **bank charge is not the plan's charge**. `chargeUsd` on a plan is part of
what the VENDOR bills and is already inside the price; this is what the BANK
takes on top, and like everywhere else it becomes its own row rather than being
buried in the amount.

**The service now settles the rate before the amount**, which is what makes the
whole thing work: taka is what was typed, else the dollars at *this payment's*
rate, else the plan's stored taka. It also states the dollars whenever there are
any. It used to state them only when the taka had **not** been typed over —
right while the drawer had no dollar box, wrong now that it has one: a renewal
billed $100 at 125 and settled at ৳12,750 is three facts at once and the row can
hold all three.

**Proved by `.renewqa.mjs`** — 20 checks, every figure read back out of the
table:

    January, nothing typed          ৳12,000.00  $100.00  @120.000000
    April, the rate has moved       ৳12,850.00  $100.00  @128.500000
    Bank charge — July                 ৳230.00        —  @125.000000
    July, with a bank fee           ৳12,500.00  $100.00  @125.000000
    October, the card took else     ৳12,750.00  $100.00  @125.000000
    card: $3,598.16 of an opening $4,000.00

That last figure is the one worth reading twice: $400 of plans **and $1.84 of
bank charge** — ৳230 at 125. The charge row states no dollars, so the card reads
it back at the rate on the row, and the rate is on the row because the charge
inherits the payment's.

**Three faults were the harness, not the app**, and each is worth knowing.
The card opened at zero, so the overdraft guard refused every renewal and the
run measured that guard instead of this drawer. The charge row's description is
built from the payment's — "Bank charge — Claude — … with a bank fee" — so
finding the payment by its note found the charge instead; it has to be found by
shape (`charge_for_id is null`). And a charge row references its parent, so a
cleanup that deletes payments first violates the foreign key.

## 69. Net Pay is typed over, and then it IS the figure

The other half of #68's sentence. Asked where an edited Net Pay should land, the
owner was unambiguous:

> *"net pay ta to automatic calculation hobe eta ok but ami cai ami edit kore
> jodi kichu bosai oitai pore actual hobe. like age net pay dhoro 100 taka ami
> bosalam 110 taka oi 110 takai db te save hobe and oita dhore calculation
> hobe."*

Not a hint, not an adjustment folded into another column. **110 is saved, and
110 is what everything then reads.**

**Two commits, and in this order.** `net_amount` is `GENERATED ALWAYS AS (gross +
bonus + other_additions − tds − other_deductions) STORED`, and Postgres refuses
a write to a generated column outright, so this needed a column — which means a
migration, which travels alone and goes first. `aca9c26` added
`net_amount_override numeric(14,2)` and a CHECK keeping it above zero; the code
followed once that was confirmed live.

Not a writable `net_amount`. Making that one writable means dropping and
recreating it on a table holding paid salary history — a destructive change to
reach what an added column reaches safely. Keeping both is also what lets a
sheet whose four components no longer sum to its Net actually **say** so.

**One expression, one place.** `effectiveNet` is
`coalesce(payroll_lines.net_amount_override, payroll_lines.net_amount)`, written
out once at the top of the service and used by all five readers — the sheet, the
payslip, a member's payslip list, the run's total, and the export. Table-
qualified deliberately: Drizzle renders a column inside a `sql` template
UNQUALIFIED, and two of those queries join other tables. The DTO keeps the name
`netAmount`, so nothing downstream had to learn a second field and nothing can
read the wrong one of the two.

**Changing a component clears a typed net.** The typed figure was typed for the
row as it stood; change the gross or the tax and it describes a row that no
longer exists. So rather than leaving the sheet silently disagreeing with its own
arithmetic for good, the arithmetic comes back and can be typed over again. This
is deliberately *unlike* `tdsManual`, which survives a recompute — that recompute
fires by itself off a rule, while this is somebody rebuilding the row by hand.

On the screen: the Net Pay column is a box like its neighbours, coloured when the
figure was typed, and `key={liveNet}` keeps it following the row while the other
columns are being edited (the input is uncontrolled, so without a changing key it
would keep showing what it mounted with). Emptying it sends `null` and puts the
arithmetic back — its own save path, because the contract rightly refuses `""`
for an amount.

**One real bug, found by driving rather than by reading.** A typed zero came back
**500**: `amountSchema` accepts `"0.00"` — right for a bonus, wrong for a net —
so the DB's CHECK was the only thing refusing it, and a constraint violation is
not an error message. The contract now refuses it with a sentence.

**Proved by `.netpayqa.mjs`** — 19 checks, and the one that matters is the last:

    Ayesha   gross=40,000.00  tds=0.00  arithmetic=40,500.00  typed=41,277.00
    Bipul    gross=50,000.00  tds=0.00  arithmetic=50,000.00  typed=—
    run total_net = 91,277.00        money that left the bank = 91,277.00
    (the arithmetic alone would have paid 90,500.00)

The typed figure survives being finalised, and it is what the salary transaction
is written for. Everything is read back out of the table, not off a response
body.

**A trap worth writing down again**: three of these checks failed against a dev
server that had loaded an older `packages/shared`. `npm run build:shared`
rebuilds the `dist`, but a running `nest start --watch` does not re-require it —
it only reloads on its own restart. A block of failures that the built contract
demonstrably disagrees with means the server, not the code.

## 68. One USD rate for the whole salary sheet

The owner, in the same breath as #67:

> *"payroll table a net pay tao editable rakho. also dollar rate prottek sarite
> thakuk tarporeo opore ek jaygay rakho jekhane rakhle table er sobgula field a
> auto fill hobe caile edit o korte parbe."*

The FX RATE column read **N/A on every line**, and there was nothing wrong with
it — the rate had to be typed into each of seventeen boxes and nobody had.
Seventeen people paid on one day are converted at one rate, so seventeen boxes
were seventeen chances to mistype it.

A box above the table now, with two buttons:

- **Fill the empty rows** — the default. Lines that already state their own rate
  are left alone, so filling the column cannot quietly undo a figure somebody
  typed for one person.
- **Replace every row** — separate, and second, because it *does* undo that.
  It deserves its own click.

`POST /payroll/runs/:id/fx-rate`, `payroll.write` (it edits figures on a draft,
which is what the per-line box already does — nothing moves, so not
`payroll.pay`).

**It is a fill, not a second home for the figure.** The rate still lives in each
line's own `fx_rate` and each line stays editable afterwards. Nothing on the run
remembers what was typed above — there is no second place for the rate to live,
and so no way for the sheet and its rows to disagree. That was the one design
decision here and it is the reason the rest is small.

Two guards, checked rather than borrowed, because this writes without going
through `updateLine`: a **finalised sheet refuses it** like every other figure on
it, and a **person already paid keeps the rate they were paid at**.

**Proved by `.sheetrateqa.mjs`** — 14 checks. It builds three people and a July
draft, watches the column start at N/A, types one line's rate by hand, fills the
rest, and reads `payroll_lines.fx_rate` back out of the table at every step:

    Ayesha     fx_rate=130.000000   (typed, then filled, then typed again)
    Bipul      fx_rate=125.000000
    Cathy      fx_rate=125.000000

**Net Pay editable is NOT in this** — it is the other half of the same sentence
and it needs a migration. `net_amount` is a `GENERATED ALWAYS AS … STORED`
column (`gross + bonus + other+ − tds − other−`), so Postgres will not take a
write to it at all. Two honest shapes, and the choice is the owner's because it
changes what a payslip says:

1. **Typing a Net adjusts Other + / Other −.** No migration. The row still adds
   up and the reader can see where the difference went — but a figure appears in
   a column nobody typed.
2. **A `net_amount_override` column.** Additive migration, travels alone. The
   typed figure is the figure — but the row visibly stops adding up, which on a
   payslip is its own problem.

Asked; not started.

## 67. A rate on every entry, everywhere

The owner, straight after the dollar card that would not move:

> *"baddhotamulok all transactions er jonne rate bosate hobe. puro application a
> joto dhoroner transaction a hok na keno manually prottekbar rate bosate
> hobe."*

The background is #64 and #66. A row with no `usd_rate` and no stated dollars
cannot be read in dollars at all, so it adds its taka to a foreign account's
balance and nothing to the dollars beside it. Both of those sessions added a
fallback — the account's rate, then the day's rate off `fx_rates`. This closes
the hole at the other end: **no row is written without a rate in the first
place.**

**Nine paths write a ledger row.** They were not all obvious, and four of them
were writing rateless rows in silence because they bypass `create()` entirely
and insert straight into `transactions`:

| Path | Before | Now |
|---|---|---|
| the transaction form (`create`) | a box, saving without it allowed | **required**, contract and form |
| its bank charge row | inherited | inherits — unchanged, and checked |
| Cash In | already required | unchanged |
| Money transfer | asked **only** when a USD account was on a side | **required on every transfer**, both halves stamped |
| a subscription payment | stamped **conditionally** — a plan with no rate wrote a rateless expense | always; typed on the drawer, else the plan's own, else refused |
| paying a payroll run | **nothing** | required on the Pay drawer, stamped on the consolidated row and on every per-person row |
| a TDS challan deposit | **nothing** | required whenever an account is named, since only then is a row written |
| an income tax payment | **nothing** | required |
| a bank statement import | **nothing** | one rate for the file, on the mapping step, stamped on every row it writes |

The compiler found the first two callers by itself — dropping `.optional()` off
`createTransactionSchema.usdRate` names every place that has to supply one. It
could not find the other four, because a raw `.insert(transactions)` has no
opinion about a column nobody mentions. Those came from grepping for
`insert(transactions)` across the API, which is the only way to enumerate them.

**Two decisions worth knowing.**

*The rate is not pre-filled on the transaction form,* though the last recorded
one is named in the hint. A box that arrives already answered is a box nobody
reads, and the whole point of the instruction is that the day's rate is stated
rather than inherited. The two places it IS pre-filled are the subscription
drawer — a plan states the rate its dollar price was struck at, and that is the
rate the payment happened at unless the card was billed on another day — and,
coming next, the payroll sheet, where he asked for exactly that shape:
*"opore ek jaygay rakho jekhane rakhle table er sobgula field a auto fill hobe
caile edit o korte parbe."*

*An import states one rate for the whole file.* A statement spans days whose
rates differed, so this is the rate the file is READ at rather than a claim
about each row's own day; a row that needs its own can be opened afterwards.
Anything else means asking for two hundred rates at the mapping step.

**The assistant is the one place a rate could have been invented.** It drafts
entries and stages imports, it knows roughly what a dollar is worth, and that
is precisely why it must not write one. `usdRate` is now in the field reference
automatically — that block is generated from `createTransactionSchema`, so it
cannot drift — and the prompt names it explicitly as a field to ask for. An
import plan without a rate is refused at `importMapping()` rather than filled
in, because a rate the model chose would sit on every row of a two-hundred-row
batch with nobody having typed it.

**Proved by `.rateqa.mjs`** — 22 checks, all passing. It drives every path
through the API and then reads `usd_rate` **back out of the table**, because a
201 says the request was accepted and says nothing about what landed in the
column. It also asserts the six forms carry a `required` rate box, so a
contract that demands one cannot ship with a form that does not ask.

    an expense that states its rate      out    1000.00   rate=121.500000
    Bank charge — an expense with a ...  out      25.00   rate=121.500000
    a transfer that states its rate      out    5000.00   rate=121.500000
    a transfer that states its rate      in     5000.00   rate=121.500000
    funding that states its rate         in    10000.00   rate=121.500000
    Tool — a subscription payment        out    2430.00   rate=121.500000
    Tool — a payment at another rate     out    2430.00   rate=130.000000

**No migration.** Every column this uses already exists; what changed is that
they stop being left null. Old rows keep their nulls and are still read through
#64's and #66's fallbacks — those stay, and are the reason nothing already in
the books moved.

**Still open, and next:** the payroll sheet's own two — Net Pay editable, and a
sheet-level FX rate that fills every row's FX RATE column (which reads N/A on
every line today) while each row stays individually editable.

## 43. The date on Money transfer, and why nothing caught it

The owner: *"money transfer table er akhono date formatting change hoynai."* He
was right, and it had been wrong since #1 — through #1, through #37's widening,
through every green run of `.dateqa.mjs`.

**The sweep was blind, and the reason is worth keeping.** Reading a table's
textContent runs the cells together, so a row whose serial is 1 and whose date
is 2026-08-25 reads as `12026-08-25`. The pattern carried `(?<!\d)` in front of
the year — "not preceded by a digit" — so the `1` from the SL column made every
date look like part of a longer number and every match was thrown away. **Every
table in this app has a serial column.** The sweep has been reporting seventeen
screens clean while it could not see a single one of their dates.

It is the same failure the file's own older comment describes — `` matched
nothing between "A" and "0" — wearing a new costume: `` was replaced by a
lookbehind, and the lookbehind was wrong the same way.

The lookbehind is gone. A false positive is a loud failure somebody looks at; a
false negative is a bug shipping. With it gone the sweep immediately found the
Money transfer date, which is now `formatDate`d like everywhere else, and
nothing else — so the other sixteen screens really were clean.

## 50. The company name, printed twice

From a marked screenshot of the payslip header. "ShareViral Finance Management"
appears beside the SV logo at the top, and again in its own line directly
underneath — `slip-legal`, at `payslip-view.tsx:175`, which joins
`companyName` with `companyLegalNote`.

The fix is not simply deleting the line: it carries **two** things joined by a
dot, and only the first is the duplicate. `companyLegalNote` is whatever the
company registered as — the sort of thing a payslip is expected to state once —
so the line should print the note alone and drop the name, and disappear
entirely when there is no note rather than leaving an empty rule.

Worth checking with it: the name appears twice more further down, at
`:359` ("Accounts & Finance, {companyName}") and `:388` (the signatory
fallback). Those are not duplicates — each says who, in a block about who — but
they should be read once with fresh eyes while this is open.

## 50, 52–55. The payslip, in one pass

Seven changes to one document, done together because that is what one document
deserves — and measured together, because every one of them is the kind a diff
shows perfectly while the page shows something else.

- **The company name once.** The line under the logo joined the name to the
  registered note; only the name was the duplicate. The note stands alone now,
  and the line disappears when there is no note rather than leaving a rule with
  nothing on it.
- **Working days is a number.** A null `workingDays` MEANS the whole month, so
  it prints the month's own length — 30 for September, 28 for February — and a
  typed 30 prints identically, because they say the same thing. No column, no
  migration: the run knows its own year and month.
- **The check line under Net payable is gone.** Both figures are the two totals
  directly above it, and a document that restates its own arithmetic under the
  answer has two places to disagree.
- **The words are words.** The currency was printed in front of the amount in
  words while also sitting above the figure and on both column headings — four
  times on one band, and only that one read as part of the amount.
- **Both dates are dd/mm/yyyy.** This block deliberately used the file's own
  long form; the owner asked for numeric, and since both changed together they
  still read as one kind of fact.
- **Prepared by is gone.** What it said was that Accounts & Finance prepared the
  slip, which the slip implies by existing and which nobody signs. The grid
  keeps its two columns so the signatory stays in the right-hand half rather
  than drifting to the middle on every document.
- **The footer.** "Computer-generated payslip · no physical signature required"
  came off — and it had stopped being true, since the slip carries a real mark
  when one is uploaded. What is left under Confidential went from 6pt to 7.5pt
  and a lighter grey: it is the line telling somebody they have seven days to
  report a mistake in their pay, and a notice nobody can read is a notice that
  was not given.

**The prepared-by signature went with the block.** It was added an hour before
the block was removed, so the field and its prop are gone rather than left
offering somewhere for a file to go and nowhere for it to appear.
`SignatureField` keeps its `kind` prop and the `file_kind` enum keeps its value
— Postgres cannot drop one and it costs nothing — so putting it back is a
handful of lines if the block ever returns.

`.payslipsignqa.mjs` — 13 checks, rewritten around the new slip. The alignment
it was written for stopped being a question when the second block left.

## 52, 53, 54. Three more on the payslip

All three are in `payslip-view.tsx`, and with #50 that makes four — worth doing
in one pass rather than four visits to one document.

**52 — Working days reads a number.** *"ekhane full month lekha thakbena day
hisebe lekha thakbe 30 hole 30."* Line 219 prints `"Full month"` whenever
`workingDays` is null, which is the common case: null MEANS the whole month, and
the slip currently says so in words. He wants the count.

The number is derivable — the run knows its year and month, and `monthRange`
already gives the last day — so this is a render change and needs no column. The
one thing to get right is that null and a typed 30 must then print identically,
because they mean the same thing; if they ever should not, it is the pro-rata
gross that says so, and that is already its own column on the sheet.

**53 — the check line under Net payable goes.** Lines 269–273 print
`Gross 1,00,000.00 · Deductions 1,750.00` under the amount in words. Both
figures are already on the slip, in the two totals directly above it.

**54 — the amount in words loses its "BDT".** Line 266 prints
`{settings.baseCurrency} {inWords(...)}`, so it reads "BDT Ninety Eight
Thousand…". The currency is stated twice more in that same black band — above
the figure on the right, and on both column headings — so the words can be
words.

## 67. ৳56.70 in the account, $0.00 beside it

*"ekhane 56 taka dekhacche dollar er ghor 0 keno? etato right hiseb holona
taina. ami hisebe 1 poysaro gormil caina."* — the Exprovia LLC account, USD,
reading `$0.00` over `৳56.70`.

**The row had everything it needed.** ৳56.70, a currency, and a rate of 123.26
recorded with it — `transactions_fx_complete` will not let a row state dollars
without one. It also carried a **zero** in the dollars, and
`ownCurrencyBalance` reads a stated dollar figure before it reads any rate. So
a zero read as a fact beat the rate sitting beside it, and $0.46 came out as
$0.00. Worse, `ownCurrencyExact` counted the row as a record, so the screen did
not even mark the figure approximate.

#64's fallback could not reach it: that one catches rows stating **nothing**,
and this row states zero, which is not the same shape.

**A stated zero cannot be a fact, and the database is what says so.**
`transactions_amount_positive` is `CHECK (amount > 0)` — a row that moved
nothing cannot be written at all — so no honest row is worth taka and zero
dollars at once. A zero there is a box left at its placeholder. Both
expressions now require `original_amount <> 0`, and the row falls through to
the rate it was written with. Measured: ৳56.70 ÷ 123.26 = **$0.46**, and a row
that states real dollars is still taken at its word.

It stays a *record* rather than an estimate, and that is right: the app's own
rule is "its dollars **or** its own rate", the rate was recorded on the day,
and nothing is guessed at today's price.

**Where the zeros come from, not fixed and not needing to be.** The transaction
form sends `plainAmount(usdEntered) || undefined`, and `plainAmount("0")` is
the string `"0"` — truthy — so typing a zero in the USD box writes exactly this
row. The reader ignores it now, present and future, so a writer guard would
change no figure; it is noted rather than done because that form has been
edited heavily this week and the change would have to move three coupled
fields at once to keep `transactions_fx_complete` satisfied.

`.zerodollarqa.mjs`, 7 checks. One of them asserts the *licence* rather than
the behaviour: the ledger is asked to write a zero-amount row and must refuse,
because that refusal is the whole reason a stated zero may be treated as a
missing figure.

## 66. No paisa in payroll, a tax box you can type in, and a Net that follows

Three complaints off one screenshot of the May sheet.

**The paisa.** *"ami kono employee er salary te to eirokom decimal kono number
deinai"* — and he had not. Two places made them: **days worked** (৳90,000 ×
18⁄31 = ৳52,258.0645) and the **percentage split** (60/30/4/6 of a pro-rated
figure). Asked whether the tax should round with the rest — it has a challan
consequence — he said everything should. So:

- the pro-rated gross rounds to a whole taka;
- `scaleBreakdown` rounds each part to a whole taka and still pins the drift on
  the largest, so the parts sum to EXACTLY the gross;
- `splitSalary` floors each percentage line to a whole taka and gives the
  remainder to Basic, same property;
- `monthlyTds` floors to a whole taka. **Floored, not rounded**: a deduction a
  taka light is settled by the return, one a taka heavy has been taken from
  somebody's pay without authority. The advisor's own page reads 417 flat, so
  this lands a taka under their figure rather than over it.

Three unit tests encoded the old paisa figure (`416.66`) and now state the new
rule with the reason. The shortfall over a year went from eight paisa to eight
taka, which is the price of a payslip with no paisa on it.

**Existing rows keep their paisa** — nothing rewrites history. A draft is
brought onto the new rule by Rebuild list, or by touching working days, or by
"Work out the tax again".

**The tax box.** `w-full` on a flex child beside the working button in a 112px
column squeezes to nothing, so on rows carrying a stored working there was no
box to click — *"jader tds 0 tader okhane edit kora jacchena"*. It is
`flex-1 min-w-0` now and the column is `w-36`. The harness MEASURES the
rendered width rather than looking for the element, because a 4px input is
present and unusable.

**Net Pay follows the boxes as they are typed.** He read a gross of 116,078
beside a net of 116,129 and called it wrong arithmetic; he was right about the
screen. Net is a generated column and the server recomputes it on save, but
between typing and blurring the cell still showed the last saved figure. The
row now keeps what its boxes hold and computes the net from them, reset
whenever the server sends a new line — so a value the server worked out always
wins over a stale keystroke. Driven by typing into the gross WITHOUT blurring,
so the only thing that can have moved is the figure on screen.

## 65. The subscriptions register reads in dollars

*"dollar amount boro kore dekhao and takar amount choto kore dekhao."* Every
plan here is priced in dollars by its vendor and the taka is what the rate made
of it that month, so this one table reads in the currency the bills are written
in. The ledger is still taka and every total elsewhere still is.

Both figures go through the app's own formatter rather than being written by
hand — dollars group western, taka group in lakhs, and a figure printed raw
would read differently from the same figure everywhere else. `.chargeqa.mjs`
asserts the ORDER off the cell's children now, because the order is the claim.

## 64. The card that read $1,500 all month

*"ekhane money add korle change hoyna dollar ammount ta. also jodi ami kono
kichu khoroco kori amount change hoyna. eta diye ai subscription kinlam tao
dekhi 1500 dollar e thake."* — on the Payoneer card, reading `~$1,500.00` over
৳1,87,083.00.

Driven through every door money reaches that card by (`.carddollarqa.mjs`), and
the report was right about the symptom and wrong about the cause: **most doors
worked.** Cash In moved it, an expense that recorded its dollars moved it, and
a subscription payment moved it — that last one only because it was fixed
yesterday. Two did not, and both for the same reason.

**A row carrying neither its dollars nor a rate contributed exactly zero.**
`ownCurrencyBalance` reads `original_amount` first, then the row's own
`fx_rate`/`usd_rate`, and had nothing after that — so any entry typed on a
screen that asks for neither moved the taka and left the dollars where they
were. Measured: ৳6,138.50 out, $0.00 off the card.

It now falls back to **the rate in force on the row's own day**, from
`fx_rates` — never today's, because valuing an old row at today's price moves
a figure nobody touched, which is the whole reason the stored dollars are
preferred above it. A row dated before the company recorded any rate takes the
earliest on file. The figure stays marked approximate: `ownCurrencyExact` is
untouched, so the tilde the owner is looking at stays, and the number under it
now moves.

**The second door was ours.** The bank charge row written by yesterday's work
carried no rate of its own, so ৳245.54 of charge came off the taka and $0.00
off the card. It inherits its entry's rate now — `usdRate`, the reference rate
a taka figure is read back in, not `fxRate`, which would claim the bank
converted it.

One thing worth knowing before reading a local run: **this database has no FX
rates at all**, so the fallback correctly contributes nothing here and the
first run reported the fix not working. The harness seeds one and removes it,
which is what the live system already has.

And a caution for the next session, which cost twenty minutes: three harnesses
reported five to ten failures each, all of them browser checks, because the web
dev server was a leftover from a previous session. Restarting it turned every
one of them green without a line of code changing. A browser check that fails
in a block is a stale server until proven otherwise.

## 63. Expense overview: Office rent, and the dashboard's cards

*"ekhan theke uncategorized ta remove kore oi jaygay office rent ta rakho and
card gulake sundor UI daw dashbaord a jemon card ache onekta oirokom with
colorful progress bar and equivalant usd/bdt."*

**The catch, put to him before any code.** The four boxes partition the month —
that equality is the page's whole design (#23) and the `+ + + =` line under
them is its proof. Uncategorised is the catch-all; Office rent is a
SUB-category under Office & premises, so its money was already inside
Operational. Swapping one for the other would have double-counted rent and
dropped money with no heading. Asked, he chose **to keep the sum**: rent is
carved OUT of operational, and operational became the remainder — so what used
to be Uncategorised now lands there rather than disappearing. And by
*"Office rent"* he meant the sub-category alone, not the whole heading.

**By slug, never by name.** The tree carries a stray top-level heading also
called "Office rent", slug `office-rent-test`. Matching on the name would have
folded somebody's test category into the company's rent; the harness now spends
৳1,234 on that decoy and asserts it lands in Operational instead.

**The bug this would have shipped with, and it is the app's oldest one.**
`transactions.category_id in (…)` is UNKNOWN when the category is null, and
`not UNKNOWN` is UNKNOWN — so a row with no heading satisfied neither the rent
filter nor its negation and fell out of every slice. The four came to ৳7,000
less than the total they exist to equal. It is the same shape as the ৳72,700
that vanished through `isToolVendor()`, and the fix is the same
`coalesce(…, false)`. A screenshot could not have caught it; the arithmetic
check did, on the first run.

**The cards are the dashboard's, not this page's own.** `StatStrip` +
`StatCell` + `ShareBar` — one panel with hairline-ruled cells rather than four
floating boxes. Each carries a bar sized by its share of the month and coloured
from the app's `--chart-*` palette, reusing the dashboard's own tones for the
two slices that appear on both screens. Deliberately NOT the semantic
green/red: those mean money in and money out here, and every slice is money
out. The text stayed as he asked it to be — heading, amount, equivalent, no
paragraph — because a bar's length is not a paragraph.

Proved by `.overviewqa.mjs`, now 35 checks. The ones that earn their place: the
four still add to the total exactly; rent is ৳85,000 and Operational is smaller
by that much rather than larger; the decoy is not rent; money with no heading is
in Operational rather than lost; the strip holds exactly four cells; every cell
has a bar; the four bars are four different colours; salary's bar is longer
than rent's; and every card shows both currencies.

One stale assertion was retired on the way past: it required the sentence
*"transfers between our own accounts are not spending"* to be on the page — a
note the owner had removed months ago — so it tested for text he asked to
delete. It now checks the behaviour instead: the ৳5,00,000 transfer is nowhere
in the total.

## 62. Cash In: one order, the derived box locked, a charge either way

*"ekhane usd bank select korle charge field ta nai … bdt select hole … field
gula ultapalta position a ache also auto calculate hoyna. equivalant field tay
type kora jay eta vul eta auto select hobe."* And the order, spelled out:
*"bdt select hole: bdt amount, usd rate, auto fill, bank charge. r usd hole:
usd amount, usd rate, bdt auto fill, bank charge."*

Three faults in one drawer, and the cause of all three was that the money block
was **written twice** — once for a dollar account and once for a taka one — and
the two copies had drifted. The dollar copy never got a Bank charge box. The
taka copy had it in the middle, and derived nothing.

**One block now, and the ORDER flips with the account rather than the boxes
being written twice.** Four in a fixed sequence: the account's own currency
(typed), the rate, the other currency (worked out, locked), the bank charge.
Which of the first and third is typed follows the account; that exactly one of
the two is derived is the same rule in both directions.

**Deriving the dollars is only honest now.** The taka that lands is regularly
short of dollars × rate, and until yesterday that difference had nowhere to go
— so deriving either side would have buried a bank charge inside a rate. The
charge has its own row since #61, and what is left is arithmetic.

**The locked box is still not locked blind.** On a dollar account the taka is
read-only only while the arithmetic owns it: an entry from before the dollars
were recorded has none to derive from, and a box that is empty AND locked is
one nobody can save. `usdSent` is also seeded from the row being edited now —
it started blank, which was survivable while the taka was typed and is not once
the dollars drive it.

Proved by `.cashinorderqa.mjs` — 17 checks, the four labels read in **document
order** on each account kind, the derived box measured for its value AND its
`readOnly`, the rate changed to watch the derived figure move with it, and the
whole thing saved to confirm ৳122,000 in, $1,000 recorded, ৳450 charged as its
own row and the account netting ৳121,550.

Three of those checks failed first on the harness rather than the app, and each
is worth the next person knowing: a `SearchableSelect` keeps its value in a
hidden input, so setting that input picks no account and every "BDT layout"
assertion was really looking at the dollar one; `[name="description"]` matches
Next's `<meta name="description">` in the head before it reaches the form; and
guessing an element's prototype to find the `value` setter throws on anything
that is not the tag you guessed. A fourth: the Cash In screen lists the current
month, so a fixture dated last month passes every database check and is
invisible to the pencil that is supposed to reopen it.

### What the review caught before any of this shipped

An adversarial pass over the diff (three reviewers, every claim then handed to
a separate agent told to refute it) returned **twelve findings, all of which
survived**. Four distinct faults under the duplicates, and every one of them
was in the change rather than in the old code:

**Every taka receipt would have been filed as a foreign remittance.** The
derived dollars can never be blank — the rate is required and prefilled — and
`original_currency is not null` is the whole test `OverviewService` uses for
the dashboard's CEO funding, with `ReportsService.funding` selecting on
`original_currency = 'USD'`. Blank used to carry the meaning; the old box said
*"Blank for a local receipt"*, and a locked box cannot be left blank. Put to
the owner, who chose a tick: **"Money from inside the country — no dollars were
sent."** Unticked the derived figure is recorded and the receipt counts as
funding; ticked the input loses its `name`, `FormData.get` answers null, and
the row stays what it is. Seeded on an edit from whether the row recorded any
dollars, so a correction cannot reclassify it.

**Editing a dollar-account receipt would have rewritten its stored taka.**
Seeding `usdSent` from the row made `isDerived` true on the first render of an
edit, so the locked box showed dollars × rate and the update sent that product
— the file's own comment had documented this exact hazard as the reason the
lock was conditional, and seeding defeated it. Worse where the row carried no
rate of its own: the fx effect backfills the newest rate on file, so a June
receipt opened in September would have been revalued at September's rate.
Fixed with `moneyTouched` — the arithmetic takes over only once somebody moves
one of its inputs, which is the same guard `transaction-form.tsx` already
carries as `bdtTouched`.

**The bank charge box was inert on a correction.** It opened blank whatever the
entry carried, and `chargeAmount` was missing from the update payload, so
typing one did nothing and clearing one could not clear it.

**The drift warning cried wolf.** It compares the entered rate against taka ÷
dollars, which only means something when a person typed both. With one side
derived the difference is a rounding — ৳500 at 122.77 derives $4.07, which
reads back as 122.85 — so it fired on ordinary small receipts. It now shows
only where both figures were stated independently.

## 61. A bank charge on every kind of transaction

*"sob dhoroner transaction a ei charge ta rakho. karon bank charge dorkar hoy
sob transaction er khetrei."*

**The decision that shaped everything.** Asked how a ৳115 charge on ৳10,000 of
rent should count, he chose **a separate row under Bank charges** over folding
it into the amount. So the heading keeps its own ৳10,000, the charge is ৳115 of
Bank charges, and the account is ৳10,115 lighter either way — and a year's bank
charges are one figure on the Expenses screen instead of being spread
invisibly through every other heading. The category already existed with
nothing able to reach it.

**`charge_for_id`**, self-referencing, migration `2026-09-02-transaction-bank-charge.sql`,
pushed alone as `015e8a4`. The link is not decoration: `transfer_group_id`
beside it is the precedent — rows that move together are joined so `void` and
the trash can follow the join. Without it, voiding a payment leaves its charge
standing and deleting one leaves an orphan.

**Where the box is.** All transactions (and every screen that opens the same
form — Expenses, Other expenses, the register, a category page), Cash In, and
Money transfer. On a wire arriving the charge is still an **out** row, because
a charge on money coming in is money going out. On a transfer it lands on the
account the money **left**.

**What follows the parent, all of it driven rather than assumed:**

- the account moves by amount **plus** charge;
- raising the charge rewrites the same row rather than adding a second;
- an edit that never mentions the charge leaves it standing — the notes must
  not delete a charge nobody spoke about;
- clearing the box removes the row rather than leaving a ৳0.00 line item on the
  Expenses screen for somebody to read and wonder about;
- moving the entry to another date takes its charge to that date, so a payment
  corrected into another month does not leave its charge behind in the old one;
- voiding the entry voids the charge, and the account gets **both** figures
  back;
- deleting takes the charge into the bin and restoring brings it back — which
  needed BOTH sides of the trash, since `companionsOf` and `siblingIdsInTrash`
  are separate lookups and the first version fixed only the delete. The restore
  answered 201 the whole time and quietly left the charge in the bin.

**Two things found by driving it that reading would not have shown.**

`= any($1::uuid[])` — Drizzle binds a JS array as ONE parameter, so Postgres
read a single id as an array literal, refused it, and **every delete of a
transaction answered 500**. `sql.join` with one placeholder per id is what the
driver can actually send.

And a charge could itself be charged. The charge is an ordinary ledger row, so
the edit drawer opened on one offered it a Bank charge box of its own — a row
nothing would ever reconcile. Refused in the service, not only hidden on the
screen, because the screen is not the only door.

Proved by `.bankchargeqa.mjs` — 31 checks, every money figure read from the
**ledger** rather than from a response, and the round trip driven on the real
form: the box opens showing the charge already on the entry, which is the
failure that would have had somebody re-type a charge and double it.

## 60. The subscription charge is in dollars

*"ekhane charge usd te hobe"*, on a screenshot of the price panel — correcting
the reading #58 shipped on a few hours earlier.

`charge_bdt` was built on the idea that a card charge is levied here, in taka,
by the bank. It is not: it is part of what is billed, so it sits beside
`cost_usd` and converts at the plan's own rate exactly as the price does.

**Added, not renamed**, and that is the whole care in the migration. A rename
breaks the image still serving while the new one builds — the old code selects
`charge_bdt` by name, and a column renamed out from under it takes every
subscription query down with it. Two columns for one minute is cheap; a dead
screen is not. `2026-09-02-subscription-charge-usd.sql`, pushed alone as
`fb1f571`.

Any plan already carrying a taka charge got the dollar equivalent **at its own
stored rate**, so nothing typed is lost and nothing is re-valued at a rate it
never had. The verification counts anything that could not be converted — a
taka charge on a plan with no rate — rather than rounding it away. Locally:
0 carried, 0 stranded. `charge_bdt` stays in place holding whatever it holds;
it is read and written nowhere now, and dropping a column that still has values
is a separate decision on a separate day.

**Two helpers, not one.** `payableUsd` is price + charge; `payableBdt` is the
**stored** taka price plus the charge converted at the plan's own rate. The
stored figure rather than `costUsd × usdRate`, because that is what the form
derived and what every screen has been showing, and re-deriving it here would
be a second answer to a settled question. The charge is converted at the plan's
own rate and never at today's, or a settled total would move every time the
rate did.

The form's box is now **Charge (USD)** under the dollar box it adds to, and the
line beside it states both totals — `$105.00 · ৳12,890.85`. The plan page shows
the charge under Cost (USD) and a Total per cycle carrying both. The register's
Total / cycle column keeps its taka figure with the split now in dollars
(`$100.00 + $5.00`). And the ledger's `originalAmount` is now price **plus**
charge, because the charge is in dollars too — so a $105 plan takes $105 off
the card, which is the same function the screen prints.

`.chargeqa.mjs` 20 checks and `.subsfixqa.mjs` 16 checks, both passing against
the dollar model.

## 59. Three live bugs on AI tools and subscriptions

*"payment record add korle account theke taka kattechena, tarpor edit kore save
dile error dicche, Ami expired duto subscription add korlam oigulao kaj
korchena."*

All three were real, all three were reproduced before anything was changed
(`.subsbugs.mjs` prints what the API actually answered), and none of them was
visible in a diff.

**1. The money did not come off the card.** The taka balance moved every time —
that was never the problem. A foreign account's balance ON SCREEN is stated in
its own currency, and `AccountsService.ownCurrencyBalance` builds that from each
row's `original_amount`, or from the row's own rate where there is none. A row
carrying neither contributes **zero**. `payForSubscription` wrote neither, so a
$100 plan paid from a dollar card took **$0.00** out of it and marked the
balance an estimate into the bargain. Measured before the fix:
`ownBalance 0.00, ownBalanceExact false`.

It now writes the dollars, the currency and the rate — but only where the price
was not typed over. A hand-typed amount is a figure whose dollars nobody
stated, so it carries the plan's rate and makes no dollar claim, which leaves
the screen to mark it an approximation rather than have this invent one.
`originalAmount` is the **vendor's** price, not price-plus-charge: the bank's
charge is levied here in taka, and the two figures are different on purpose.

**2. Every save reported an error, and every save had worked.** `update()`
returned nothing, so Nest answered **200 with an empty body**; the browser
client calls `response.json()` on anything that is not a 204, and the thrown
`Unexpected end of JSON input` was reported as *"Could not save that"*. It also
broke a second thing quietly: the form reads `saved.id` afterwards to attach the
invoice and the bank record, and on an edit `saved` was `undefined` — so a file
chosen while editing could never upload.

`update()` now answers with the plan. **The first attempt at this fix did
nothing at all**: the method already ended in `return this.audit.mutate({…})`,
so the new `return this.get(id)` underneath it was unreachable. It compiled, it
typechecked, and the browser kept reporting the same error — caught only
because the harness drives the screen. The `mutate` is awaited now.

**3. A plan saved as Expired vanished.** The register opens on Active. Save a
plan as Expired — or edit an active one to Expired — and it matched nothing on
screen afterwards, so the table looked untouched and the save looked like it
had failed. Which is exactly what somebody adding two of them would report.
Nothing was hidden and nothing was broken; the screen simply kept showing a
filter that excluded the thing it had just been asked to make. The form now
tells the screen which status it saved and the screen moves to that tab. "All"
is left alone, because it already shows the row.

Proved by `.subsfixqa.mjs` — 16 checks. The one that matters reads the
**accounts screen's own balance endpoint**, not a sum: `$4000.00 → $3900.00`,
and `ownBalanceExact false → true`.

## 58. Subscriptions: the charge on top of the price

*"Ai tools and subscription er eikhane tumi charge name akta field rakhba jeta
actual price er sathe add hobe calculation er somoy and table eo dekhabe +
diye choto kore."*

A plan priced at $100 does not cost this company the taka it converts to — the
card adds its own charge, and the figure that leaves the account is the two
together. There was nowhere to record the second, so every total the app stated
for a foreign plan was short by an amount nobody could enter.

**`charge_bdt`, and in taka on purpose.** `cost_usd` is the vendor's price and
`cost_bdt` is that price at `usd_rate`; a card charge is levied here, by the
bank, and is not converted from anything. Folding it into either would change
what the plan is said to cost the moment something re-derives the rate from the
two — which `deriveCosts` in packages/shared does on every keystroke in the
form. Migration `2026-09-02-subscription-charge.sql`, pushed alone as `341a6b3`.

**One helper, five callers.** `payableBdt()` in the shared package is the only
place the two are added, and the ledger, the pay dialog's hint and placeholder,
the renewal email and the bell notification all call it. The alternative —
`Number(a) + Number(b ?? 0)` written out five times — is four correct copies
and a fifth that forgets the `?? 0` and prints `NaN` in somebody's inbox.

**In the form it is on its own row, under a rule.** Not a fourth box beside
USD / rate / BDT: those three are one fact stated three ways and the panel's
own caption says *"type any two — the third follows"*. A fourth box inside that
group reads as a fourth way of saying the same price. The harness retypes a
rate after setting a charge and asserts the charge did not move, because that
is the failure this arrangement exists to prevent.

**The bug this would have shipped with.** `create()` lists its columns
explicitly and spreads only the three `moneyOf` derives — so `chargeBdt` was in
the schema, in the form, in the request body and silently dropped on the way
into the database. A plan saved with the box filled came back with a null in
it. Nothing errored. Found by asserting the stored value rather than the
response.

**In the register, one column and not three.** He asked for the charge to show
*"table eo … + diye choto kore"*, and the register had **no money column at
all** — he had Cost (USD), Equivalent (BDT) and USD Rate taken off it himself
(*"baki gula single page a jabe"*), so there was no price for a `+৳x` to sit
beside. Asked which he wanted; he chose a single **Total / cycle** column with
the split small underneath. So the three that were removed stay removed and are
still on the plan's page; what came back is the one figure that actually leaves
the account. `12,890.85` on the line, `12277.00 + 613.85` under it in 11px, and
nothing under a plan that has no charge.

It sits after Plan and before Account/Card, where the standard column order
puts an amount. `SubscriptionHeadCells` is shared with the **Paid tools** table
on a team member's profile, so that screen gains the column too — which is what
item 9.1 wanted there anyway. Both tables' min-widths went up by 152px and
`.sweep` reports `/subscriptions` clean at 1440, 1180 and 900.

Proved by `.chargeqa.mjs` — 20 checks. The money one records a payment and
reads the **ledger** back rather than the label: ৳12,277.00 + ৳613.85 leaves
the account, a plan with no charge still takes exactly its price, and a typed
amount still beats both.

## 57. The salary sheet's tax: worked out, and typeable over

*"ekhane tds ta editable koro. etato auto fill hobe eksathe ami duita feature
cai. mane auto calculate hoye tds bosbe ami caile karota edit o korte parbo."*

`updatePayrollLineSchema` refused `tdsAmount` on purpose and its comment said
why: *"a screen that let somebody type over it would make the stored working a
lie"*. That objection is right, and it is an objection to typing over a figure
while still **claiming a rule produced it** — not to typing. So the line now
records which of the two it holds.

**`tds_manual`**, one boolean, migration `2026-09-02-tds-manual.sql`, pushed
alone as `6bb2572`. Deliberately not `tds_basis = null`: that already means "no
rule produced this", which is equally true of a line from a year with no rule
configured, and those must start computing the day one is set up.

**What the mark buys.** Typing sets it and clears `tdsBasis`, because there is
no longer a working to show. The recompute that fires on a gross, working-days
or declared-investment change then **skips a marked line and says so in the
response**. Without that, typing a tax and afterwards correcting a working day
would put the rule's figure back with no message — which reads as the edit box
not working rather than as the rule reasserting itself, and is the failure the
harness is built around. "Work out the tax again" is the one deliberate way
back: it clears the mark across the run and reports how many typed figures it
replaced.

On the sheet the cell is a box on a draft and read-only once finalised, like
every other figure. A typed figure keeps a dotted amber underline and says on
hover what it is and how to undo it — the cost of making this editable is that
a sheet stops being readable as "all of this came from the rule", and the mark
is what buys that back.

`tdsManual` is in the schema **and** in `getRun`'s projection. A column that
reaches one and not the other is how this app has three times shipped a field
that stored correctly and read back N/A.

`.tdseditqa.mjs`, 23 checks. Two of them were harness faults worth recording:
`blur()` on an input that was never focused fires nothing at all, so the first
run reported the cell not saving when what had not happened was the blur.

## 56. Three exports, in three formats

*"amar export option a new ekta export section add koro eta hobe windows CSV
format export … Team Member Mail - Id, Name, Depertment, Email Address … r ekta
thakbe Team member Data Sheet (Sheet format a) … arekta lagbe bank statement.
Sundor Ekta Graphical PDF version a."*

The export screen is now grouped by **what lands on the disk** — CSV for
Windows, Documents, Spreadsheets — and every card and button wears its format.
Three kinds of file in one unlabelled grid is how somebody mails a colleague an
.xlsx they cannot open.

**The mail list, as Windows CSV.** Four columns and nothing else, because that
is what a mail merge reads. "Windows CSV" is a specific file and none of what
makes it one shows in a diff:

- a **UTF-8 byte-order mark**, without which Excel on Windows reads the system
  code page and a Bangla name arrives as mojibake — fatal for the one thing a
  mail list is for;
- **CRLF** endings, per RFC 4180;
- a **guard against formula injection**. Excel *evaluates* a cell beginning
  `=`, `+` or `@`, so a department typed as a formula is code running on the
  machine of whoever opens the file, and this one gets mailed to accountants.
  Text cells get a leading apostrophe. Money and number cells deliberately do
  not: `-500.00` is a negative figure, not an attack, and quoting it would
  break the sum at the foot of somebody's column.

**People with no address on file are left out.** A blank address is not a
recipient and a merge fails on that line rather than skipping it — said on the
card above the button and counted in the audit line, because a silent omission
is what this codebase keeps getting bitten by.

**The data sheet** is the personnel record, distinct from the `team-members`
directory beside it: identity, contact, emergency, bank, tax, education. Marked
sensitive in the audit log, which the directory is not — it carries NID, e-TIN
and bank account numbers. Salary stays out and cannot be added by widening the
column list, because `compensation_history` is a table this projection does not
join.

**The bank statement PDF** is the same `register()` result the spreadsheet
uses, laid out rather than recalculated: a cover with the position, a page
showing how the balance moved and where the money went, then the line-by-line.
It reuses the layout engine the financial statement already ships on.

One type made honest on the way past: `TeamMemberDto` never declared
`employeeCode`, `bankAccountHolder`, `bankBranch` or `bankSwift`, though the
projection has returned all four for weeks and the screens read them. Nothing
changed at runtime.

`.exportqa.mjs`, 29 checks — the CSV verified byte by byte against a
deliberately hostile fixture (a name that is a formula, a department with a
comma, a Bangla name, and somebody with no address at all).

## 51. Payroll: attaching the invoice and the bank record

*"ekhane payroll toiri korar somoy invoice and reference upload korar option tao
diye diyo."*

**The three questions this was waiting on, and the owner's answers.**

1. *Which paper is it?* Nobody sends this company a salary invoice — it is the
   payer. Answer: **leave the names alone for now.** *"tumi invoice name rakho
   pore ami dekhe nibo ki upload korar dorkar hoy."* So the slots read
   **Invoice** and **Reference**, which is what the pair is called on every
   other money table here, and what actually goes in them is his to decide.
2. *At creation, or at payment?* Answer: **at creation, fillable later.**
   *"hea eta pore add kore dibo edit option to achei taina."*
3. *One per run, or one per person?* Answer: **one for the whole run.**
   *"puro run er jonne ektai."*

**Answer 2 decided the architecture, and it cost a ninth owner column.** The
cheap version was to hang the file on the salary transaction a run writes when
it is paid — no migration, and the paper would sit with the money. It is the
wrong shape for what he asked: that row does not exist until the money moves,
so a run in draft would have nowhere to put its invoice, which is precisely the
moment he wants the slot. `payroll_line_id` was no better — a run-level
document filed against one arbitrary person's line is a lie about whose paper
it is.

So `files` gained `payroll_run_id`, and `files_one_owner` was recreated
counting nine. `2026-09-02-payroll-run-files.sql`, pushed alone as `eb6a97b`.
**Six migrations have now fought over that constraint.** What keeps the
directory safe is that the deploy records each file and never re-runs it, plus
filename order; anything that touches it again must sort after this file and
must count **ten**. The migration says so in its own header.

**Where it lives.** The two slots are a Documents panel on the salary sheet —
`/payroll/[runId]`, which is where the runs table's edit pencil already goes,
which is what he meant by *"edit option to achei taina"*. Above the table, not
below it: a sheet is twenty rows long and anything under them is found by
nobody. Multiple files per slot (a bank advice is regularly several pages
photographed separately), preview on the page rather than a download, and an
empty slot that says **"Not on file"** rather than showing nothing — the same
reasoning as the team member's document card, which is that the question being
asked is "is this month's paper in yet", and a list can only show what is
there.

The runs table got the pair as columns too, with the eye that opens only where
its own drawer has something. `RunDocuments` is a local component rather than a
generalised `DocumentSlots`, because `components/files/` is shared and shared
changes are the owner's call.

**One thing outside payroll was touched, additively:**
`ledger/documents-dialog.tsx` learned a fourth owner (`payroll_run`) — a new
member on a union and a new branch on the fetch chain. No existing caller's
path changes. Flagging it because that dialog is on five screens.

**The bug this would have shipped with, which no diff would have shown.** The
run list's document counts came back **0 for every run** while the files were
sitting in the database. `documentCountOf` correlated the subquery with
`${payrollRuns.id}` interpolated into a `sql` template — and **Drizzle renders
a column inside `sql` unqualified, as `"id"`.** Inside `from files df`, `"id"`
resolves to the file's own id, so the condition silently became
`df.payroll_run_id = df.id`. It compiles, it runs, it raises nothing, and the
table draws N/A on a run whose invoice is right there. The sibling helper in
`transactions.service.ts` writes `transactions.id` as raw text and is fine,
which is why the pattern looked safe to copy. Written out now, with the reason
in a comment.

Proved by `.runfilesqa.mjs` — 21 checks, all passing. The ones worth having:
the constraint really counts nine; a file claiming two owners is still refused
by the database, written straight past the service; the invoice goes on **while
the run is a draft with zero salary transactions in existence**, which is the
whole design in one assertion; the counts come back 1 and 0 rather than 0 and
0; the eye appears on Invoice and **N/A on Reference**, so no click lands in an
empty drawer; and HR — which holds `payroll.read` on purpose, since it reads
the sheet — may see the paper but is refused `403` when it tries to attach one.

That last check was wrong in the first draft of the harness: it asserted HR got
a 403 on *reading*, which would have been a finding about the app and was
actually a mistake about the permission matrix. Corrected to drive the half
that is really the gate.

## 49. The payslip's two signatures, level

Two asks, and they turned out to be one fix. *"payslip er duita same height a
nei left er ta ektu nice namiye diyo also prepared by je ache onar signature
upload korar option rekhe diyo settings a."*

The right block carried 26pt of signature plus a 2pt gap above its rule; the
left carried nothing. So the two rules sat **28pt apart** on a document where
they read as a pair. Nudging the left block down by a magic number would have
fixed the one state he photographed and broken the other three, so instead both
blocks now **reserve the same height** whether or not there is a mark in them —
level when neither is signed, when either is, and when both are.

**A second file kind, not a second row of the first.** `signature` is singular
by rule — the comment on it says "Two signatures on file would mean a payslip
had to pick" — and these are two different people signing two different things.
`prepared_signature` is its own kind, added to the `file_kind` enum in its own
migration, and added to the singular list beside `signature` so a second upload
replaces rather than adds. It joins `SIGNATURE_KINDS` too, which is the one line
that holds it to the same shape rule as the others.

**One component, rendered twice.** `SignatureField` takes the kind, and both
marks come back from the one settings endpoint — so each field picks out its own
rather than taking `[0]`, which would have handed whichever was uploaded first
to both blocks.

`.payslipsignqa.mjs` — 13 checks. It measures `getBoundingClientRect().top` on
each rule in **all four states**, because "they look level" is exactly the claim
a screenshot makes and a diff cannot check. It also builds a real
signature-shaped PNG — 600×100 — rather than reusing the 1×1 placeholder every
other harness here uses: the app refuses anything under 300px wide or outside
1.5:1 to 8:1, and the first run read that refusal as the upload being broken.
And it puts the company's own signatures back exactly as it found them.

## 47. "Could not save that", and the heading nobody had to choose

**The save that failed, and the message that said nothing.** The owner switched
a plan's bank account and got *"Could not save that."* That string is what this
form printed for anything that was **not** an ApiError — a dropped connection, a
parse error, anything — so it could not say which, or whether the plan had
saved.

Worse: `onSaved()` was INSIDE the try. It closes the drawer and reloads the
list, and anything it threw landed in the same catch and was reported as a
failed save — on a plan that had just been written. The obvious next move on
seeing that is to save again. It now runs after the try, only when everything
that can fail has succeeded, and the fallback message carries the real error
text instead of a shrug.

**The heading picker is gone from both drawers.** *"ekhane alada kore field
rakhar dorkar nai expense heading er jonne. eta by default Ai tools and
subscriptions er under a jabe ... akoi vabe recoed payment drawer eo ei expense
heading option ta rakcho oitao tule diyo."*

He is right, and it was my overcorrection. The ledger refuses an uncategorised
expense — that is still true and still the reason the field appeared — but every
payment through this door is a subscription payment, so the answer was the same
every time and the question was asked twice: once when a plan was added, again
on every renewal.

`subscriptionCategoryId()` resolves it: the slug `ai-tools` first, then a name
reading like AI tools, subscriptions or software — because installs rename their
headings and this company's live one is called "Ai Tools and Subscriptions". If
neither matches it **refuses with a sentence** naming what to add. Writing the
expense uncategorised instead would put it on no Expenses screen at all, which
is the complaint the whole feature exists to answer: a silent wrong answer is
worse than a loud refusal.

The subscriptions page stopped fetching the category tree with it — nothing on
that screen reads it now.

## 48. Two more raw dates, and the sweep that could not see either

Payroll's **Paid on** column printed `2026-09-02`. That is the second raw date
in a day, and the second time `.dateqa.mjs` reported the screen clean.

The first miss was the pattern. **This one was the data.** No run on the
development database has ever been paid, so that column reads N/A on every row
here and the browser had nothing to look at. A sweep that drives a screen can
only see what today's data happens to produce, and a column that is empty on
this machine is a column nobody is checking.

So the sweep now reads the **source** as well: every `.tsx` under `apps/web/src`
is scanned for a JSX text child of the form `{something.someDate}` with no
formatter inside the braces. It does not care what is in the database.

Three things had to be learned by running it, each of which had it silently
finding nothing:

- **A lookbehind on the brace, not a character class.** JSX children sit on
  their own indented line, so the character before the whitespace is a newline
  — which `[^=\s$]` rejects. The check reported itself green while matching
  nothing at all.
- **`${...}` is not JSX.** Without excluding it,
  `new Date(\`${row.effectiveFrom}T00:00:00Z\`)` read as a raw date on screen.
- **Only what is inside the braces counts as formatting.** It looked at sixty
  characters either side, and the money cell next door calls `toLocaleString` —
  so the payroll date was excused by its neighbour.

`value={row.txnDate}` on a DateInput is still correct and still skipped: that
control wants an ISO string.

`.dateqa.mjs` — 23 checks now, and it fails on a blank page, on a raw date on
screen, and on a raw date in the source.

## 44. Money transfer: two eyes, a tick column, and the pair

**Half of what was asked for already existed**, which is worth saying rather
than quietly building twice: the transfer form has taken multiple files and
previewed them since #6, and All transactions has had its tick column since #4.
What was actually missing was the two eyes on this screen and its tick column.

**The eyes.** This table had its own `NumberCell`, a fifth private copy of a
cell four screens share, and it could not offer a way in when a file was
attached with no number typed — which is what most of these rows look like now
that the number stopped being asked for. Both columns are `ReferenceCell` now,
counted on `invoiceCount` and `recordCount` so an eye never opens a drawer
belonging to the other column. `NumberCell` is deleted.

**The tick column, and the one thing it had to get right.** A transfer is TWO
ledger rows — out of one account, into the other — and the whole reason this
screen exists is that the two must never disagree. `useBulkSelect` keys on
`outId`, the half files hang on and the half the single-row delete already
sends, and `siblingIdsInTrash` follows `transfer_group_id` so both halves go
together. The bar counts **transfers**, not rows: saying "2" for one transfer
would be a lie about how much money is involved.

The total is summed in minor units. Adding `numeric(14,2)` text with `+` is how
a figure ends up a paisa out and nobody can say where.

`.transfersqa2.mjs` — 11 checks. The one that earns its keep counts the LEDGER
rows either side of a bulk delete and requires 6 → 4: at 5 one half would have
been left behind, and the two accounts would have stopped reconciling on the
screen built to stop exactly that.

## 45, 46. All transactions: two columns, two eyes, one colour

**45 — Invoice and Reference, and the app's own number off the screen.**
*"ekhaneo same vabe invoice and reference thakbe entry no thakbena. eye button
thakbe."* Both columns now use `ReferenceCell`, the same component Cash In,
Other expenses and Subscriptions already use — four screens showing one pair of
facts had four different cells, and only one of them offered a way in when a
file was attached with no number typed. It answers three states: the number as
a link, an **eye** when there is only paper, and N/A when there is neither.

`TXN-2026-000038` is not lost. It is on the bank statement, in every Excel
export, on the overview PDF and in the documents drawer's own title — checked
before removing the column. What it is not any more is a column on the list of
every row, where it repeated a fact nobody was looking for.

**And the counts had to be split first.** Both columns used to read the row's
TOTAL file count, so an entry carrying only an invoice would have offered an eye
on Reference too — a click into an empty drawer, which is the complaint that
took the amber triangle off this table in #27. `invoiceCount` and `recordCount`
are counted apart in the projection now, on both the transactions and the
transfers queries.

**46 — one colour per row.** *"row te text gular color ek jaygay garo red
arekjaygay halka red so sob color red hobe jei row red hobe kono extra kore blue
korar dorkar nai link er khetre. sudhu underline holei colbe."*

Two exceptions used to live in `globals.css`: a link kept link-blue and a muted
caption kept grey. Both are gone. A link inside a coloured row is that row's
colour and is told apart by its **underline**, which is what an underline is
for; a caption is the row's colour, shaded rather than grey, because "quieter
than the figure beside it" was the job and the row's colour already does it.

`color: inherit` rather than deleting the rules, and that is not fussiness:
`.text-link` is set ON the element, so without naming it at higher specificity
the child keeps its own colour and nothing changes. The decoration follows the
text too — a red link with a blue underline would have been the same complaint
in a smaller place.

A **Badge** still keeps its tone. It paints its own background and states a
status rather than a shade of the row.

`.txncolsqa.mjs` — 11 checks. It attaches a file of ONE kind and requires the
other column to say N/A, and it measures the link, the caption and the row with
`getComputedStyle` rather than reading the stylesheet.

## 44, 45, 46. The next batch — Money transfer and All transactions

Written down as asked, not started. Three of them are the same work on two
screens, which is worth doing together rather than twice.

**44 — Money transfer.** The Invoice and Reference columns get the eye button
the other money tables have; the drawer previews what is attached; more than one
file can be attached; and the table gets a tick column with Move to trash.

**45 — All transactions.** The same Invoice and Reference treatment, **Entry
No. comes off**, the edit drawer opens carrying every field the row holds,
uploads preview, and multiple files can go on one entry.

Worth settling before either is built, because #34 has just been through this:
"Reference" on these screens is the BANK's number and it is now attach-only,
while "Entry No." is the app's own `TXN-2026-000038`. Taking Entry No. off All
transactions removes the app's own handle for a row from the screen that lists
every row — which is fine if nothing quotes it, and a problem if the bank
statement or a report does. That is one grep, and it goes first.

**46 — one red, not two.** On a money-out row the text is dark red in some
cells and light red in others, and a link inside it is blue. The owner: *"sob
color red hobe jei row red hobe kono extra kore blue korar dorkar nai link er
khetre. sudhu underline holei colbe."* So a red row is red throughout, and a
link inside one is told apart by its underline rather than by a second colour.
That is a change to how links look inside `transaction-table.tsx`, and it should
be checked against the money-in rows too — green has the same problem.


## 41. Adding a subscription takes the money out

The owner, and he was right that it was big: *"ami already add subscription er
somoy tools er dam koto oita likhe felchi ... akhon expense overview te geleo
dekhtechi ai tools and subscription er card a 0 dekhacche. dashboard er moddheo
ai and other tools er section a nei eita. also all transaction er moddheo nai.
tar mane eta kothao record hocchena mane taka katechena"*.

**Two faults, and the second was mine.**

1. **Adding a plan wrote no money at all.** It recorded an arrangement and
   waited for somebody to press a second button in a column called Payment. He
   had typed the price and nothing moved.
2. **Even once pressed, the payment did not COUNT as tooling** unless it landed
   on a non-taka card. `isToolSpend()` asked "paid to a recurring vendor, or
   settled on the card that buys tools", and I removed the vendor stamp last
   week — correctly, because it was writing a `subscriptions` id into a column
   with a foreign key to `vendors`, so the insert could only ever have failed.
   But that left nothing tying the row to the plan, and a plan paid from an
   ordinary taka bank fell out of tooling into operational expenses.

**The fix for the second is a fact instead of a guess.**
`transactions.subscription_id`, its own migration, pushed first. "Paid on the
prepaid card" was always a heuristic about intent; "this row paid that plan" is
a fact. The heuristics are kept BEHIND it rather than replaced, because every
payment recorded before the column existed has a null in it and those rows are
still tooling — dropping them would rewrite history downward.

**On renewals, he chose to be told rather than charged.** Offered automatic
monthly deduction, he took the reminder: *"na, renew-er somoy amake ekta barta
dileii hobe"*. So adding a plan takes ONE payment, on its start date, only when
it is active, and only on create — editing a plan never charges again. The
reminder that already fires three days before a renewal is what carries the
rest, and one click on the row records it. An app that writes money nobody
watched is an app whose books stop agreeing with the bank the first time a card
is declined.

**Two fields became required**, and they had to: without an account there is
nothing to take the money from, and without an expense heading the charge lands
where no Expenses screen shows it — which is the complaint itself. Both are
checked BEFORE the plan is written, so a refusal leaves nothing behind rather
than a plan with no payment.

**The Payment column is gone**, on his word. The act moved into the row's own
actions, because it is still how a renewal is recorded and how a first payment
is retried when a card is refused.

**Tool name and Plan are two columns now**, not one stacked cell — *"eta alada
row hobe"*. Stacked, the plan read as a caption with no heading to scan against.

`.subspaysqa.mjs` — 10 checks, driven from a plain **BDT bank** account, which
is exactly the case the old heuristic missed: the expense exists, it remembers
its plan, the account is poorer by exactly the price, the Expenses overview's
tooling slice is no longer zero, the four slices still add up, and the
dashboard's own AI figure agrees.

## 39. A deleted person stops holding their employee ID

The owner: *"kono ekta data upload diye delete korar por abar upload dite gele
nicchena..erokom error dekay"* — add somebody, delete them, add them again,
**Internal server error**.

`team_members_employee_code_idx` was UNIQUE on `(entity, employee_code)` and NOT
partial. Deleting a person is a SOFT delete: the row stays so it can be restored
and so payslips keep pointing at somebody real — but it kept its code, so the
code stayed taken and re-adding collided with a row nobody can see. Postgres
raised 23505, nothing caught it, and the browser got a 500.

**Third time this shape has bitten.** The same non-partial unique index over
soft-deleted rows swallowed a salary figure on `compensation_history` this week,
and `team_socials` was written partial from the start because of it.

Safe alone, unlike the compensation one: nothing writes to `team_members` with
an `ON CONFLICT` naming this index. Migration `2026-09-01-employee-code-partial`,
pushed on its own. Driven end to end: add 201, delete 201, add again **201**
where it used to be a 500 — and two LIVE people with one code still refused, now
with a readable 400 rather than a crash.

## 38, 39b, 40. Three asks, done in parallel and proved afterwards

Three agents worked disjoint files at once. **Two lost their connection before
proving anything**, so none of it was taken on trust — `.threeasksqa.mjs` drives
all three against the running app, 15 checks.

**38 — the payslip.** "Value date" is a bank's word for the day money settles
and nobody here reads it that way, so it is **Payment Date**. "Credited to" is
now **Pay period**, showing the month's first day to its last — the run already
carries the year and month, so no new column and no parsing of a label. And the
bank account comes out of the foot, because the header already prints it: the
header was checked before anything was removed. One file, so the PDF follows.

One thing corrected after the agent finished: it used the app's `formatDate`
(01/05/2026) for the pay period, sitting beside a payment date the same block
prints as "31 May 2026". A payslip carries document-grade dates on purpose —
its own header comment says so — so the period matches the block.

**39b — the Team list is ordered by employee ID.** The owner asked whether it
could be done with the data untouched. It could: everybody on the books joined
the same day, so the old leading key separated nobody and the sort fell through
to the NAME. Nothing was wrong with a single row — only the ORDER BY. Somebody
with no code sorts last, which was measured rather than assumed. **Payroll is
deliberately left on seniority**: the sheet, its Excel and every payslip trace to
that one order, and a document that gets printed and signed does not follow a
directory's sort.

**40 — one paperclip off the subscription drawer.** The clip beside Tool name
attached the plan screenshot; its state, its ref, its preview hook and its upload
call went with it, because dead state is how a form grows a field nobody can
reach. **A consequence worth knowing:** the only other way to attach a screenshot
is the small picture button on the register, and that button only appears when a
plan ALREADY has one. So an existing screenshot can still be replaced, and a
plan with none can no longer be given a first one. Reported, not decided.



**#12b is done** — `9a38c30`. You answered all three questions: the FX rate
history page was deleted rather than given a tick, Payroll runs got one, and
Users got one with the tick withheld on your own row (the Delete button on that
row is already withheld, and a bulk action must not offer what the single-row
action does not).

## 38. The payslip

Three changes, from a marked screenshot of `payroll/payslip-view.tsx` — the
page the PDF is printed from, so this is one file and both outputs follow.

1. **"Value date" becomes "Payment Date."** Banking language for the day the
   money settles; nobody here reads it that way.
2. **"Credited to" becomes "Pay period"**, holding the dates the salary is FOR
   — *"jekhane kon tarikh theke kon tarikh er salary take dibo"*. So the month's
   first day to its last, not a bank account.
3. **The bank details come out of Payment details.** The header already prints
   BANK ACCOUNT beside the name; printing it again at the foot says the same
   fact twice on a one-page document.

Worth settling before it is built: the run holds a `payment_date` and a
`period_year`/`period_month`, so **the pay period is derivable and needs no new
column** — but a run PAID before it is finalised, or a line with working days
short of the month, both have a period that is not simply "1st to last". The
first is what the label should say; the second is already shown as Working Days
on the sheet.

More coming — the owner is adding to this list before we start on it.

### The three that were yours to decide — all three done

He was given the detail and chose all three. `.salarylocksqa.mjs`, 14 checks.

**1. `compensation_effective_idx` is partial now**, and this is the one that
needed care. Its migration and its code **cannot be separated**:
`setCompensation` inserts with `ON CONFLICT (team_member_id, effective_from)`,
Postgres infers which index that names, and the inference has to match — a
target with no `where` cannot use a partial index, and one with a `where` cannot
use a full one. Migration alone, or code alone, and EVERY salary save fails. So
they shipped in one commit, and the harness's first three checks exist purely to
prove that did not happen: a first figure, a later figure, and a rewrite of an
existing date, which is the branch that actually takes the conflict.

What changes in behaviour: recording pay on the same date as a TRASHED row no
longer collides with it. It inserts a live row and leaves the trashed one alone
— better than the old answer, which revived a row somebody had thrown away as a
side effect of typing a figure.

**And it opened a door, which the harness caught before it shipped.** With the
index partial, a trashed row can no longer come back to a date something else
has taken meanwhile — Postgres refuses with a 23505 that reaches the browser as
"Internal server error". That is the same class of bug the index exists to
close, arriving through the door the fix itself opened. `assertDateStillFree`
turns it into a sentence.

**2. Restoring a salary row checks what it is coming back INTO.** Restore
everywhere else lifts `deleted_at` and hands the row back, which is right for an
expense — the world has not changed shape. A salary row is different: trash the
one in force, record another while it is gone, restore the first, and two rows
both say "still in force" while the resolvers take whichever sorts first. Now
refused, with a sentence saying to record a new change instead. Only
`compensation` — this is not a rule about trash, it is a rule about a table
where two open rows is a contradiction.

**3. `backfillCompensationFromJoining` stops counting trashed rows.** It asked
whether any row existed at all, so somebody whose only salary had been thrown
away counted as "already has pay". They were then invisible in three places at
once: not generated onto a payroll sheet, "Not set" in the directory, and
neither offered nor listed as skipped by the one action that exists to repair
exactly that.

### The original note, kept for the reasoning

- **`compensation_effective_idx` should be partial** (`where deleted_at is null`),
  the way every index written today is. It cannot be done on its own: making it
  partial without also giving `setCompensation`'s `ON CONFLICT` a matching
  `where` makes every salary save fail. Code and migration have to land together,
  which breaks the "migration goes first" rule — so it wants a deliberate,
  awake decision. **The reachable half of the bug is already fixed in code**;
  this is the belt to the braces.
- **Trash restore does not check for an overlap.** Restoring a compensation row
  only nulls `deleted_at`; it can in principle leave two rows with no end date.
  Not reachable from any screen.
- **`backfillCompensationFromJoining` ignores `deleted_at`**, so a person whose
  only salary row was trashed is invisible to the repair action — neither
  offered nor listed as skipped.

## What was done

| # | What | Note |
|---|---|---|
| 1, 2 | Dates day/month/year; "As at" gone | #37 found two more places the sweep never opened |
| 3 | "Record" off the register | |
| 4 | Multi-select and bulk trash | six money/list tables |
| 5 | Card fields, CVC behind a password | |
| 6 | Reference replaces Transaction ID; invoices become uploads | superseded in part by #34 |
| 7 | Cash In reordered | and #32 |
| 8 | **The global FX rate is gone from the whole app** | Reports was the last of it, and the worst |
| 9, 16 | Bank section; Wallet fields removed | |
| 10 | Void allowed in a locked period | your decision, recorded |
| 13 | Tick column on Settings > Trashed | |
| 17, 36 | Salary changes history, then its pager, ticks and trash | #36 closed two data traps |
| 18, 33 | **A subscription that is paid takes money out of the bank** | it 404'd on every click until #33 |
| 20, 21 | Subscription save error; renewal date derived from the cycle | |
| 24-27, 31 | All transactions and the bank statement, as you read them | |
| 28 | The TDS working panel | it opened, and it was broken |
| 29 | An FX rate per payroll LINE | supersedes #11 |
| 30 | The Breakdown link | |
| 32 | Cash In follows the account's currency | |
| 34 | Reference is attach-only; our number is "Entry No." | |
| 35 | An attached file's name reads as content | five places |
| 37 | Payslip and Reports dates | |
| 14 | Social media on a team member | done, with the **real brand logos** he asked for |
| 15 | e-TIN and one E-Return per income year | e-TIN already existed |
| 12a | **The lock-out hole, found and shut** | it was open on the live site |

## 24-27, 31. Two tables, read the way the owner reads them

Five items, done together because they are five edits to two files and one
verification pass — `.tabletidyqa.mjs`, 15 checks, all passing.

**All transactions** (`ledger/transaction-table.tsx`, `transactions-screen.tsx`):

- the **Category** column is gone. It read N/A on most rows — a transfer has no
  category — and the screens that group BY category are the Expenses ones. The
  data is untouched: `categoryName` still arrives on every row and still drives
  the category filter above the table.
- the **dollars moved under the taka** in one Amount cell, the shape the account
  cards already use. Two columns for one figure cost the table width and made
  the taka and the dollars read as separate facts.
- the **whole row carries the direction** — a green tint for money in, red for
  out — and the amount stopped colouring itself, because saying it twice in two
  different greens was the clutter being complained about. A voided row gets no
  tint at all: it is out of every total, and a colour would say it still counts.
- the **small line under the description** lost the payment method and the
  transfer chip, both of which have columns. What stays is the party, the
  tax-withheld mark and the voided reason — facts with nowhere else to appear.
- **"All accounts" and "Show voided" are gone** from the filter row.

**A reference with nothing attached is not a link.** It used to render as one on
every row with an amber warning triangle when there was no document — so the
commonest case opened an empty drawer, and a mark meant for the exception sat on
most of the table. The number still shows, because it is how an entry is quoted
to a bank; what goes is the pretence that it opens something.

**Bank statement** (`reports/bank-statement-screen.tsx`) reads **oldest first**,
which is how a bank's own paper reads and the direction the running balance is
computed in. Same row colours.

The harness earns its keep here twice, and both times it was the HARNESS that
was wrong while the screen was right:

- `getComputedStyle` answers **`oklab(...)`**, not `rgb(...)`, because the tints
  are alpha shades of tokens that are `oklch`. An rgb-only parser called every
  colour on the page "none". In oklab the second number is the green-red axis.
- the statement page reads **`?account=`**; the harness asked for `?accountId=`,
  so it fell back to whichever account sorts first and measured somebody else's
  money while reporting confidently on this one.

It also checks the two things most likely to be broken BY this work: that the
headings and the cells still agree on how many columns there are, and that the
running balance still ends at the account's closing figure now that the rows are
the other way round (100,000 + 50,000 - 9,000 = 141,000).

## 28. The tax working — it opened, and it was broken

"Verify only" was the plan, because the code plainly had a `TdsWorkingDrawer`
and the cell plainly called it. It did open. Then the harness measured the panel
and found three elements crossing its right-hand edge by up to 201px — the fault
in the owner's screenshot, still there.

**Why, and it is worth remembering.** The drawer was rendered inside the `<td>`
the tax figure sits in. A drawer is `position: fixed`, so it is painted at the
edge of the window and looks completely independent of the table — but
`white-space` INHERITS down the DOM regardless of where an element is painted,
and `globals.css` has `.table-data th, td { white-space: nowrap }`. So every
label in the panel was forbidden to wrap. "Rebate — on investment 39,000.00, on
income 12,000.00, ceiling 10,000.00" then forced the content to 833px inside a
447px drawer.

Nothing in the diff of either file could show this. It took asking the browser
for every element's bounding box.

The fix is page-local and makes the sheet simpler: the open line lives on the
screen, `LineRow` gets an `onShowWorking` callback, and ONE panel is mounted
beside the other drawers instead of one per row. `BreakdownDrawer` went with it
— dead since #30 removed the link that opened it, and invisible to the compiler
because its `onClose` still mentioned `setBreakdown`.

**A trap left standing, deliberately.** Any drawer mounted inside a table cell
will inherit `nowrap` the same way. One line in `components/ui/drawer.tsx`
(`whitespace-normal` on the panel) would end it for good, but that file is
shared by nineteen screens and the rule here is to ask before touching those.
Today only the salary sheet did it, and it no longer does.

`.tdsdrawerqa.mjs` — 12 checks. It builds its own person, wage and March sheet,
because this database has nobody with a salary, and deletes all three
afterwards. Its first run reported the screen as broken twice when the harness
was wrong: the heading reads "TDS" and it was looking for "Tax", and there were
no lines to measure at all.

## 29. A rate typed on the LINE

The owner: *"fx rate take edit option dite hobe etake prottekta table a fx rate
likhte parbe"*. This replaces #11, which was the same idea a month at a time.

The sheet used to be handed the app's ONE governing rate, print it on every row
under "FX Rate", and divide each net by it for "Net Pay (USD)". That is the rate
#8 is removing from the app: one box that restates every historical figure the
moment somebody edits it. Now each line carries the rate it was read in dollars
at, frozen where it was typed — the same shape every other figure here already
has.

The whole chain, because missing one link is how this has failed three times
before:

| where | what |
|---|---|
| `deploy/sql/2026-09-01-payroll-line-fx-rate.sql` | `fx_rate numeric(18,6)`, nullable, positive-check. Pushed alone, before the code |
| `db/schema/team.ts` | the column |
| `payroll.service.ts` | **the projection** — the step forgotten on accounts, team members and vendors, each time storing perfectly and reading back N/A |
| `shared/payroll.ts` | `fxRate` on the update contract, six decimal places, null clears it |
| `lib/payroll.ts` | `fxRate` on the DTO |
| `salary-sheet-screen.tsx` | `RateCell`, its own save path, and the dollars per row |

Four things worth knowing:

- **`RateCell`, not `Cell`.** `Cell` renders an `Amount` when it is not editable,
  and an `Amount` puts a taka sign in front. 122.50 taka to the dollar is not
  ৳122.50.
- **The total is added up from the lines**, not the month's net over one rate —
  there is no longer one rate to divide by. Lines without a rate are counted and
  said out loud: `≈ $945.71 (1 without a rate)`. A dollar total quietly missing
  four people is worse than none.
- **Null is a real answer.** No rate means no dollar figure, rather than
  converting at whatever today's rate happens to be.
- **The page stopped fetching a rate.** `/payroll/[runId]` called
  `fxApi.governing()` for these two columns and no longer does.

**A hole found while doing it, and closed.** `updateLine` guarded `line.isPaid`
and nothing else — so every figure on a FINALISED, unpaid sheet was still
writable through the API. The screen stops drawing editable cells the moment a
run leaves draft, `finalize` is documented as "Locks the figures", and
`generateLines`, `syncMembers` and `recalculateTds` all refuse a non-draft run.
This one did not, so the lock was something the screen believed rather than
something the app enforced. It now refuses, and names `reopen` as the way back.

`.payrollfxqa.mjs` — 19 checks, two people on one sheet at two different rates,
which is the one thing a global rate cannot express. It drives the projection,
the refusals (zero, negative, letters), typing into the box, the totals row, and
the finalised sheet from both sides.

## 21. A renewal date nobody types

`nextRenewalAfter(startDate, cycle, today)` in `packages/shared`, six unit
tests, plus `.renewalqa.mjs` (15) driving it against a real plan.

Counted forward rather than added once: a plan entered today may have started in
2024, and `start + one cycle` would be a date two years in the past presented as
"next renewal". Strictly after today, and null for a cycle with no length.

**What it must NOT do is the interesting half.** Recording a payment advances
the stored date by a cycle — real information this cannot know — so the date is
re-derived only when the START DATE or the CYCLE actually changes. Deriving it
on every save would pull a card charge back a month the next time somebody fixed
a typo in the notes, and nothing on screen would show it happening. The harness
checks that specific sequence: pay, then edit the notes, then assert the date is
where the payment left it.

`nextRenewalOn` is gone from the contract rather than accepted-and-ignored — a
value the server silently discards is worse than one it rejects.

**One crash found on the way.** `nextRenewalAfter("")` reaches `parseIsoDate("")`
and throws, and a new plan has no start date until somebody types one — so the
Add drawer rendered nothing at all and the button appeared dead. Guarded, and
the field now says "Choose when it started" until there is one.

## 33. Paying for a subscription answered 404, live

Found while building #21, in my own work from the day before. The Pay button on
**AI tools and subscriptions** could never have worked: `payForSubscription`
asked `VendorsService.billingPlan(id)`, which reads the **`vendors`** table,
while every id on that screen comes from **`subscriptions`**. Every click
answered *"That subscription is not here"*.

It shipped green. Nothing caught it because both tables carry a billing cycle,
a renewal date and a billing account, so the code reads correctly and typechecks
perfectly — the only way to see it was to press the button.

Two more faults behind the first, neither reachable until the lookup was fixed:

- **`vendorId: plan.id`.** `transactions.vendor_id` has a foreign key to
  `vendors`. A `subscriptions` id there is an insert that fails outright, so
  even a corrected lookup would have written nothing.
- **No category.** `createTransactionSchema` requires one and the code passed
  `plan.defaultCategoryId ?? undefined` — a column `subscriptions` does not
  have. An expense with no heading appears on no Expenses screen, which is
  precisely the *"kono history thakena"* being complained about.

Fixed by moving the lookup to where the data is: `SubscriptionsService` gained
`billingPlan` and `setNextRenewal`, and `TransactionsModule` now imports
`SubscriptionsModule` — safe in that direction, since `SubscriptionsModule`
imports nothing, and the reverse is the cycle that put this method on the
transactions side to begin with. `vendorId` is gone; the plan is named in the
description. And **the Pay drawer now asks which expense heading the charge
belongs under**, because a subscription's own category (`ai_tool`, `hosting`)
is the register's vocabulary and not the company's expense headings — there is
nothing to derive it from.

## 32. Cash In asks in the currency the account thinks in

The owner, with two screenshots: *"account switch holeo currency switch
hocchena. ekhane field take primary usd thakbe jokhon usd thake oi card er
primary currency. r bdt thakbe oi card er type bdt thakle."*

The drawer asked Amount (USD) then Rate then Amount (BDT) for every account,
whatever it was. Now the account decides which box comes FIRST:

- **USD-primary account** — dollars, then the rate, then the taka they come to,
  read-only. Unchanged; this is what the screen already did for everyone.
- **BDT account** — the taka FIRST, typed, and never derived. The dollars and
  the rate follow as the optional pair, because a local receipt has neither.

`accountId` and `usdPrimary` moved above the arithmetic that reads them, and the
whole amounts block is rendered in one order or the other rather than rewritten.

**Nothing about storage changes**, and half the harness exists to prove it:
`transactions.amount` is still the taka that landed and `original_amount` still
the dollars, on both kinds of account. `accounts.currency` marks which account
is for foreign spend; it does not denominate anything.

**Three things a review agent found in the first plan, all fixed here:**

- **Deriving the taka on a BDT account would be the app arguing with the bank.**
  `isDerived` is now gated on `usdPrimary`, so filling in the optional dollars
  and a rate beside a typed taka leaves the taka alone. The harness types
  50,000 taka, then 1,000 dollars at 122, and requires the box to still read
  50,000 — 122,000 would mean the arithmetic had overruled the statement.
- **Switching from a USD account to a BDT one dropped the figure on screen.**
  The derived taka is recomputed each render and lives nowhere, so the moment
  the account changed the box that had just become the required one went empty.
  It is carried into state during the render that notices the flip.
- **The taka was not normalised on the way out.** Its neighbour has always used
  `plainAmount`; this box did not need it while arithmetic filled it, and now it
  is the primary hand-typed field on every BDT account. "1,00,000" is a figure
  to a reader and not one to `numeric(14,2)`.

`.cashcurrencyqa.mjs` — 14 checks. It builds one account of each currency,
because the dev database has no USD account at all and a harness that silently
exercised one kind twice would have proved nothing.

Two notes for whoever runs it: the account picker is a `SearchableSelect` and
has to be driven the way a person does — open, type to narrow, click the
`role="option"` — and the harness now CHECKS the account actually changed,
because the first version missed silently and every check below it measured the
default account. And its cleanup deletes in dependency order and refuses to
throw: another harness running at the same time will hang a TDS deposit off
"the first account", which for a minute can be one of these.

## 34. Reference stops being typed, and stops sharing a name

Two changes, because there were two things called Reference and the owner, asked
which he meant, said both.

**The box goes.** *"sobgula table eri reference upload only hobe ekhane field
dorkar nai. etao invoice tar motoi hobe."* Invoice was already attach-only -
"No invoice attached" and a paperclip - while Reference beside it was a text box
with a paperclip, so the pair looked like two different kinds of thing when they
are one: the bank's record of the movement. All four forms now read
"No reference attached". The `reference` column stays, every number already in
it stays, and the "number or slip" toggle that governed the box goes with it -
there is only the slip now, so there is nothing to choose between.

**The two numbers get two names.** `TXN-2026-000005` is issued by this app;
`FT26081200412` is issued by the bank. All transactions called ours
"Transaction number", which reads exactly like the bank's transaction id, and
the bank statement printed `reference ?? refNo` under the heading "Reference" -
the bank's number when one had been typed, ours when it had not, with nothing to
say which you were looking at. Both columns are now **Entry No.**, holding our
number with the bank's small underneath.

**Two things the harness caught that the diff could not:**

- **An edit would have erased the bank's number.** A form that stops sending a
  field it used to send empties that column one save at a time. The subscription
  form's `reference` is now read-but-never-written, so an existing value keeps
  being submitted. `.refuploadqa.mjs` edits a row's description and asserts the
  reference is still there afterwards - that is the check that matters.
- **The legacy rows lost their number on screen.** #27 put the "N/A" branch on
  the transactions table for an entry with no document, and that branch never
  rendered `row.reference` - only the has-a-document branch did. So an entry
  carrying a typed reference and NO attachment showed nothing, and now that a
  reference is attached rather than typed, those legacy rows are precisely the
  ones that exist. Both branches show it.

`.refuploadqa.mjs` - 19 checks. It creates an entry carrying a bank reference
the way every existing live row carries one, then proves the box is gone on four
forms, the number still displays on two tables, and an unrelated edit leaves it
alone.

## 35. An attached file's name reads like a caption

From the Cash In drawer: once a file is attached, its name
("Tohibar_Academy_Tech...") sat in the same muted tone as the hint underneath
telling you to attach one, and the eye and the cross beside it — being icons —
carried more weight than the name they act on. The owner: *"upload document
gular name color change hobe."*

The name now steps forward (`font-medium text-foreground`); the row stays muted,
which is right for the two buttons.

**Five places, not one.** `Attach` is copied verbatim into
`cash-in-form.tsx`, `transaction-form.tsx` and `transfer-form.tsx`, and
`subscription-form.tsx` has its own version — plus a FIFTH rendering, the plan
screenshot picker written inline in that same file, which the harness caught
because it was still muted after the other four were done. Changing four of five
would have been worse than changing none. (`document-slots.tsx`, which lists
files already SAVED, was already right: the name is foreground and the size and
uploader below it are the muted line.)

None of these live under `components/ui/`, `components/money/`, `lib/` or
`packages/shared`, so this is four page-local edits rather than a shared change
— but it does reach Cash in, All transactions, the register, Expenses, Other
expenses, the category pages, Money transfer and Subscriptions, which is worth
knowing.

`.attachnameqa.mjs` — 12 checks. It attaches a real file on each form and asks
the BROWSER for the computed colour of the name and of the caption beside it,
because `text-foreground` in the source proves nothing about what gets painted.
Three of its own faults, all of the same family this file keeps hitting:

- the browser answers `lab(95.93 …)` here, not `oklab(0.95 …)`. The parser knew
  only oklab, so every real colour fell through, returned null, and two nulls
  compared equal — it reported two visibly different colours as identical.
- the subscription screenshot slot has no field hint to compare against, so the
  comparison was against null. It now falls back to any muted caption.
- it looked for an Add button on All transactions. There is none — an entry is
  recorded where it belongs, not on the list that shows all of them — so the
  form was opened from Other expenses instead, which is one of the screens that
  actually uses it.

## 36. Salary changes - a pager, a tick column, and two traps it opened

Asked for from a team member's profile: *"ekhane pagination add koro and aro
beshi data rakhte parbo. also ekhane multiple select and trash a felar option
tao diyo ei table a."* The screenshot's own first row read *"just test"*, which
is the case for wanting a delete.

The panel now pages at twenty with the serial counting across pages, carries a
tick column and a bulk **Move to trash**, and a trash button per row. The
**current** salary is not in this list and cannot be reached from it - it is the
row every future payroll sheet reads, and the app has no notion of a person with
no current salary.

**The delete was the dangerous part.** A search of every reader of
`compensation_history` found two traps waiting for whoever performed the first
one. Neither was reachable before, because nothing in the app could delete one
of these rows. Both are closed here.

**Trap 1 - a figure typed in, saved, and invisible.**
`compensation_effective_idx` is on `(team_member_id, effective_from)` and is NOT
partial, so a trashed row still occupies its date. Recording pay effective on
that same date takes the `onConflictDoUpdate` branch, whose `set` wrote the
amount and never cleared `deleted_at`: the request answered 200, the screen
refreshed, and nothing appeared. The person kept the older salary and the new
figure sat in the trash. It now un-deletes the row it lands on - somebody
recording a figure for a date is saying that IS the figure for that date. The
same fix stops a raise stamping an end date onto a row that is in the trash.

**Trap 2 - the table saying one thing and the money doing another.**
Nothing in this app resolves a salary through `effective_to`; payroll and the
directory both take the newest row starting on or before the date they want
(`payroll.service.ts:1120`, `:451`, `:1196`, `team-members.service.ts:559`,
`:692`). That column is written once, by the change that closes the row, and
nothing repairs it. So deleting a row out of the MIDDLE left its predecessor
stamped with an end date from a row nobody can see: the money quietly carried on
paying the predecessor's figure while this column claimed it had stopped months
earlier. The **Until** cell is now derived from the row that follows, so the two
cannot disagree.

**What deliberately does not change**, and the confirmation says so: a finalised
or paid sheet keeps its figures - `payroll_lines.gross_amount` is frozen when
the sheet is built. The one live edge is a DRAFT sheet, whose pro-rata path
re-reads this table, so a draft keeps its figure until somebody edits that
person's working days.

**Left standing, and worth the owner's decision** - none of it reachable from
this screen, all of it reachable by a deliberate API call:

- `compensation_effective_idx` should be partial (`where deleted_at is null`).
  That is a migration and travels alone.
- Restoring a compensation row from Settings > Trashed only nulls `deleted_at`.
  It does not check for an overlapping open row, so a restore can in principle
  leave two rows with no end date.
- `backfillCompensationFromJoining` tests `not exists (...)` without filtering
  `deleted_at`, so a person whose only salary row was trashed is invisible to
  the repair action - neither offered nor listed as skipped.

`.salaryhistoryqa.mjs` - 17 checks, built on a twenty-two-raise history so the
pager has a second page to get wrong. Three of its first failures were the
harness: the pager text sits past the slice it was reading, a two-piece date
substring matched the wrong row, and the delete dialog arms on TWO gates (a tick
AND the word "trash" typed out) where the harness had filled only the reason -
it clicked a disabled button and reported the product as deleting nothing. A
fourth read the row count while the request was still in flight; it now waits
for the fact rather than for a clock.

## 37. The Payslips table printed ISO dates — and so did Reports

Spotted by the owner: Salary changes reads `30/08/2026` and the Payslips panel
directly under it read `2026-06-29`. Two panels on one screen disagreeing.

**Why #1 missed it, which matters more than the fix.** `.dateqa.mjs` walked
seven LIST screens and no detail page. `/team/[id]` was never opened, so the
sweep reported the app converted while that table had never been touched.

The sweep now walks seventeen screens — every list plus the profile, the salary
sheet, an account, its register, Reports and Settings — and the widening
immediately found a second miss nobody had reported: **Reports** printed
`2026-09-01 → 2026-09-30` in its header, `2026-09-30` in two table cells, and
carried **"as at"** in two places, which is the exact phrase #2 removed a
fortnight ago. It survived because the sweep that checked for "as at" only ever
opened an account drawer.

**And the sweep learned to fail on a blank page.** Mid-fix a JSX comment was
placed between two attributes — a compile error, which in dev 500s every route.
The sweep then walked seventeen blank screens and ticked every one: seventeen
passes in a run where the whole site was down. "No bad dates found" and "no
dates found" are now different answers.

`.dateqa.mjs` — 22 checks.

## 14. Social media on a team member

*"Team member ar social media add korte hobe eta ekta section thakbe jekhane
tara add new add new kore social media account add korte parbe. eta obossoi
icons soho hobe."*

A **Social media** card on the profile, above the money. Each account is a chip
carrying its platform, its handle and a link out; the card's own drawer adds and
removes them with "Add another". Ten platforms, one account each.

`team_socials` is a TABLE, not a jsonb column on `team_members`, and the reason
is operational rather than aesthetic: a jsonb column would have to join the team
projection, and Drizzle names every column in its SELECT — so shipping the code
before the migration ran would kill the directory, the payroll picker and the
salary sheet at once. A separate table can only fail its own card. Its unique
index is **partial** (`where deleted_at is null`), which is the lesson from #36
applied before it could bite.

The whole list is replaced in one request, the shape `syncMembers` and the
subscription seats already use: a list somebody edits has one truth, and one
request means one audit row instead of three that have to be read together.

**A handle is not an address and the app does not pretend otherwise.**
`socialUrl` takes a pasted URL as typed, joins a bare handle to the platform's
base (dropping the "@" people type out of habit), and returns **null** for a
WhatsApp number or an "other" — those render as plain text, because a link that
lands on the wrong profile is worse than no link.

### The icons — the real ones, inlined

He asked for the real logos, so seven of the ten platforms draw their actual
mark: Facebook, Instagram, X, YouTube, GitHub, WhatsApp and Telegram. The paths
come from **simple-icons**, whose data is CC0.

**They are written into `brand-marks.ts` rather than imported, and there is no
new dependency.** The package has no per-icon entry point — importing one name
pulls the whole index, and the index is 3,457 icons. Seven are wanted and their
path data is 5.4 KB; shipping half a megabyte of logos nobody asked for to a
portal people open on phones is not a trade worth making for the convenience of
an import. Refreshing them is a minute's work and is needed when a brand changes
its logo, which is roughly never.

**Three keep the lettered chip**, and it is not a shortcut:

- **LinkedIn** — simple-icons removed it after a trademark request, so there is
  no CC0 mark to use. Drawing an approximation of a trademark is worse than not
  drawing one. Its chip is the LinkedIn blue with "in" on it, which is what the
  eye uses to find it in a row anyway.
- **Website** and **Other** have no brand by definition.

Both shapes are the same size on the same baseline, so a row mixing them reads
as one row rather than as two kinds of thing.

`.socialsqa.mjs` — 21 checks. The three that matter: sending a shorter list
REPLACES rather than appends (an append would quietly accumulate duplicates
every time somebody removed one), removing a platform and adding it straight
back is not refused (the partial index earning its keep), and the three chips
are distinct in both mark and colour — a row of identical grey squares would
satisfy "there is an icon" and fail the thing icons are for.

## 15. e-TIN, and one E-Return per income year

*"1. E-Tin Number 2. E Return (akhane akta kore ortho bochor thakbe like
2026-2027 and document upload korar option thakbe. Ata every year a 1 ta hobe)"*

**The e-TIN half was already built** — `team_members.etin`, on the edit form and
on the profile. Worth checking before writing anything, and it saved a column
nobody needed.

The return is new: an **E-Return** card on the profile listing one row per income
year, with a drawer to record one.

- **The year is stored as a number and shown in full.** `fiscal_year` holds the
  year the year STARTS in — 2026 means 2026-2027 — because `periods.ts` already
  speaks that way. A first draft of this duplicated `fiscalYearOf` and
  `fiscalYearLabel` before noticing they existed; both were deleted and the
  existing ones imported. What survives is one genuinely new helper,
  `fiscalYearLabelLong`, because the owner asked for "2026-2027" written out and
  `fiscalYearLabel` gives the short "FY 2026-27" the rest of the app reads in.
- **The picker runs backwards only.** A return for a year that has not finished
  cannot have been filed, and offering it is how one is recorded against the
  wrong label. A year already recorded is greyed out rather than silently
  overwritten.
- **One per year is the database's job, not the screen's** — a partial unique
  index on `(team_member_id, fiscal_year) where deleted_at is null`. Two people
  recording the same year from two tabs get one row, and a year that was trashed
  and is being recorded again does not collide with its own deleted row. That
  last clause is #36's lesson applied before it could bite.
- **The acknowledgement has exactly one home.** It is a `team_member` file of
  kind `e_return`, so it appears as a slot on the person's existing Documents
  card. `files_one_owner` counts eight owner columns and three migrations have
  already fought over that constraint; a ninth owner would mean a fourth. A
  second upload control on the E-Return card was written and then removed — two
  places for one file is two places that disagree the first time one is used.

`.ereturnqa.mjs` — 17 checks. Recording the same year twice corrects rather than
duplicates; a trashed year can be recorded again; the picker leads with
2026-2027 and offers nothing later; and the acknowledgement's slot is on the
Documents card, once.

## 8. The last place a report read a rate nobody typed

The owner's rule: *"report ta calculate hobe kono fx rate theke na, karon
prottekta transaction a manual dollar type er option ache."* The dashboard and
Settings were done earlier; the statement was the last holdout, and it was the
worst one.

`moneyForEntry` took `fxRate ?? usdRate ?? THE PERIOD'S GOVERNING RATE`, and
marked the third case "estimated". So every entry recorded without a rate, and
every BALANCE — the opening carried forward, the withheld-tax figure — was
valued at a rate resolved from Settings. That figure moved. Editing the fixed
rate in Settings silently restated the dollar column of every month already
filed, including months that had been signed off.

Gone, all three: the entry fallback, the opening balance's, and the withheld
tax's. An entry or a balance with no recorded rate now has no dollar figure and
the page prints a dash, whose title already said the right thing —
*"A blank is honest; a number produced from whatever rate was lying around is
not."*

With it went `fxForPeriod`, the `FxService` injection, and the note that used to
promise figures were *"translated at 118.75"*. That sentence had become a claim
about arithmetic the statement no longer does. It now says which entries carry
their own rate and that everything else is in taka alone.

**What the owner will SEE change**, and it is worth him knowing: the headline
"Closing bank balance" and "Free cash" lose their dollar equivalents, because a
balance in taka has no recorded dollar value and the only way to print one was
to pick a rate. If he wants them back, the honest way is a rate typed on the
statement itself — the same shape #29 gave the payroll sheet — not a return to
one that changes under him.

`.reportsfxqa.mjs` — 10 checks, and one of them is the whole point: it reads
every dollar figure off the page, moves the fallback rate to 250, reads them
again, and requires all of them to be identical. A statement that passes every
other check and fails that one is exactly the bug — it looks right until
somebody opens Settings.

## 19 + 22. The register opens on this month, and a plan has a page

**#19, and the owner settled what "monthly" means:** *"ekhane sudhu current
month dekhabe oi month a jodi kono subscription thake oigula dekhabe. r current
month a new kena hole otao dekhabe."*

So a plan is in a month if it **had started by the end of it** — everything
running then, plus anything bought during it. The filter is on
`subscriptions.start_date`, the table's own Date column, and the query key is
called `startedBy` rather than `to` so nobody reads it as a ledger range.

It deliberately does not mean "paid in this month", and that is worth knowing:
nothing ties a payment back to a plan. `payForSubscription` writes an ordinary
expense with the tool named in the description and no plan id on the row, and
two plans from one vendor produce the same description. Answering that question
needs a `transactions.subscription_id` column and its own migration.

Whether a plan was still ALIVE that month is the status tabs' job, and they
already exist — so the month and "Active" compose into "the plans running in
September" without this filter having to invent a cancellation date the table
does not hold.

The register opens on this month. **Every month** is one row above it, because a
plan runs across months and "show me all of them" is a question this screen gets
constantly; what he asked for is where it starts.

**#22:** the register went from seventeen columns to eleven — his list, and the
eleven were already in his order once the six were deleted, so this was a
deletion and not a reordering. Category, Equivalent (BDT), Cost (USD), USD Rate,
Payment Method and Notes are on **`/subscriptions/[id]`**, a read-only page the
tool's name now opens.

Four things about that page:

- **No API change was needed.** `GET /subscriptions/:id` already returned all 22
  fields and attached the seats.
- **The note is shown whole.** It was a table cell truncated at sixteen
  characters, which is the one shape a note cannot survive.
- **The seats are a table, with the footnote that matters most here**: the price
  above is the WHOLE plan's. A page about one tool is exactly where somebody
  reads a thirteen-seat plan's price as what one person costs.
- **It is read-only.** Editing is the drawer the register already opens; a
  second form would be a second place for the same fields to disagree.

**The team profile changed too, and that was deliberate.**
`subscription-columns.tsx` is one file used by both the register and "Paid
tools" on every team member's page — it exists precisely so the two cannot
drift, so the six columns left both. The trim also made `numberFormat` dead on
that path, which cascaded out of four files.

`.subsmonthqa.mjs` — 17 checks. The one that earns its keep: a filter wired to a
query key the server ignores looks identical on screen — same rows, no error —
so this creates a plan started in 2024 and one started this month and requires
June 2024 to show the first and not the second.

## 23. The Expenses overview — four slices that add up

Asked for: rename the category grid **Operational expenses**, build a new
overview with at least six dynamic boxes including Salary, and take Other
expenses off the menu.

**The first plan for it was wrong and was thrown away.** A review agent found
that its six boxes counted the same money five times — salary sat inside
Operational, inside Other and inside the headline, so "Other expenses" would
have read HIGHER than "Operational expenses" beside it. Shown both shapes, the
owner chose the one that adds up. So the arithmetic IS the design:

```
Salary + AI tools and subscriptions + Operational + Uncategorised = Spent this month
```

Each slice is defined by excluding the ones before it, which is what makes the
equality hold rather than nearly hold. **The page writes the sum out underneath
the boxes**, in figures — a total nobody can check is a total people go on
checking by hand, and this is also the page's own test: if the four ever stop
adding to the headline it says so rather than looking plausible.

**Tax withheld sits outside the sum**, in its own box, labelled as held. It is
in the account and it is not the company's to spend. Folding it in would make
the total wrong in the one direction that matters on a finance screen.

Four decisions worth their reasons:

- **Salary is the LEDGER's payroll rows, not the payroll tables.** Reading
  `payroll_lines` would answer "what did we pay people" better — it knows about
  a sheet finalised and not yet paid — but a figure that is not part of the
  ledger cannot be a slice of the ledger's total. `created_via = 'payroll'` is
  the money that actually left the bank.
- **Uncategorised gets a box because it appears nowhere else.** The category
  grid inner-joins categories, so money out with no heading is invisible on
  every existing screen. It is exactly the expense somebody needs to go and
  file.
- **One query, four `filter` clauses.** Four queries over the same rows would be
  four chances for the window to be written slightly differently, and the
  equality would then fail for a reason nobody could see.
- **The grid stays at `/expenses`** and the overview takes `/expenses/overview`.
  Moving the grid would break `category-detail-screen`'s way back, every
  `/expenses/{slug}?from=&to=` bookmark, and the crumb every heading page
  inherits — for no gain, since a NEW page was what was asked for.

**Other expenses is off the rail; its route, its permission gate and its links
stay** — the Uncategorised box is one of them. The breadcrumb is built from the
rail's hrefs, so that screen now names its own last crumb; without that the
trail would have stopped at "Expenses" and the page you were on would have been
nameless.

`.overviewqa.mjs` — 22 checks. It seeds one row into each slice at four
distinct figures, plus a 500,000 transfer between our own accounts and an 88,000
voided expense, and requires: the four to add to the total exactly, salary NOT
to be inside Operational, the transfer not to be counted, and the voided row not
to be counted. Four boxes that each look plausible while double-counting is
precisely the failure a screenshot cannot catch.

## 12a. The lock-out hole — found, proven, and shut

**It was real, and it was open on the live site.**

Two guards already existed and both were correct: `UsersService.update` refuses
to demote or disable the last super admin, and the trash registry's `user` entry
refuses to delete the last one.

**The bulk path went round both.** `trash.service.ts` evaluates `blockedWhen`
once per row, BEFORE anything is written, from a plain client rather than the
transaction. Tick two super admins together and each row's subquery sees a table
that still holds the other: count is 2, neither is blocked, and both go out in
one statement. **Zero active super admins**, no error, no warning — and with
nobody able to reach Settings, add a sign-in, restore anybody or promote
anybody, the way back is a hand-written UPDATE on the production database.

`assertSuperAdminRemains` in `common/auth/last-super-admin.ts` states the
invariant once and asserts it **after the write and inside the transaction**, on
all three paths: the bulk delete, the single delete, and demote/disable. Two
things about how it is written matter:

- **It is an absolute post-condition, not a delta.** "At least one active super
  admin exists" — so it catches a table that was already empty as well as one
  this request emptied. Every guard before it asked a question whose answer was
  still the old one.
- **It takes `for update` on the super-admin rows.** Postgres is read-committed,
  so two concurrent transactions each deleting a DIFFERENT super admin cannot
  see each other's uncommitted work: both would count one survivor and both
  would commit. The lock makes the second wait and count what actually remains.

`.lockoutqa.mjs` — 11 checks. It builds two throwaway super admins, sends the
exact request a "select all on this page" tick would produce, and requires a
refusal AND that not one row moved. Then it deletes down to one and proves the
three single paths still refuse. The last check is the one that matters: after
every refusal, `GET /auth/me` still answers 200 — a guard that refuses and
leaves the table half-emptied would pass everything above it.

## 12b. The tick columns — NOT built, and here is why

The owner asked for tick columns on Users, FX rate history and Payroll runs.
The hole above had to be shut first and now is. The ticks themselves were left,
deliberately, because each of the three raises a question that is his to answer:

- **FX rate history is unreachable.** `RateHistory` is rendered only by
  `FxPanel`, and `FxPanel` is imported by nothing — there is no route in the app
  that opens it. A tick column on a screen nobody can reach is work that cannot
  be seen. Worth asking whether that panel should come back at all, since #8 has
  now removed the global rate it managed.
- **`.bulkuiqa.mjs` asserts Payroll runs must NOT have a tick.** That harness
  loops over the screens that were deliberately excluded and fails if one grows
  one. Adding it to Payroll means changing a rule somebody wrote down on
  purpose, which is his call and not a silent edit.
- **A tick column on Users puts self-delete back in reach.** The panel withholds
  the Delete button on your own row, but there is no server-side guard —
  `POST /trash/user/:me` succeeds today. A header tick meaning "every row on
  this page" includes yours. That needs its own guard first, the same shape as
  the one above.

Each is small. None should be guessed at overnight on a live payroll system.

## 35. An attached file's name is the wrong colour

Arrived 1 Sep with the Cash In drawer. Once a file is attached, its name
("Tohibar_Academy_Tech...") renders in a colour close enough to the drawer's
own text that it reads as a caption rather than as the thing you just attached
— and the eye and the cross beside it are louder than the name they act on.

The owner: *"upload document gular name color change hobe."*

Where it lives is the part to check before touching anything: the name is drawn
by the shared file components under `components/files/`, so whatever is changed
reaches every form that attaches a document — cash in, transactions, other
expenses, subscriptions, team member, TDS challans. That is the ask-first list.

Not started.

## 34. Reference stops being typed

Arrived 1 Sep, with the Cash In drawer as the example: **Invoice** is already an
attach-only field — "No invoice attached" and a paperclip — while **Reference**
beside it is still a text box with a paperclip. The owner: *"sobgula table eri
reference upload only hobe ekhane field dorkar nai. etao invoice tar motoi
hobe."*

So the pair becomes symmetrical: both are things you attach, neither is a thing
you type, on **every** table and form that carries them — cash in, transactions,
other expenses, category pages, subscriptions.

Two things to settle before it is built, because there is data behind it:

- **`reference` holds values today.** The screenshot shows `FT26081200412`, a
  real bank reference. Removing the input must not remove the column or the
  values — a reference already recorded still has to display. This is a change
  to how one is ADDED.
- **`refNo` is not `reference`.** The app issues `TXN-2026-000005` itself, and
  the transactions table's "Reference" column shows that. The typed
  bank-reference field is a different thing with a confusingly similar name, and
  whichever way this goes, the two must not end up sharing a box.

Not started.

## 32. Cash In does not follow the account's currency

Arrived 1 Sep with two screenshots. Choosing a different account in **Received
Bank Name** leaves the amount fields exactly as they were.

The owner's rule: *"ekhane field take primary usd thakbe jokhon usd thake oi
card er primary currency. r bdt thakbe oi card er type bdt thakle."* So the
form's primary amount box is the chosen account's own currency — a USD account
asks for dollars first, a BDT account asks for taka first — and the other
becomes the derived one.

Worth stating before it is built, because this app has a rule about it that
looks like it contradicts the ask and does not: **`accounts.currency` marks
which account is for foreign spend; it does not denominate the stored figures.**
Every amount in the ledger is BDT, a USD card's included. So this is a change to
which box is asked for FIRST and which is computed — not to what gets stored,
and not to what any report reads.

Not started.

## 3. The register's "Record" button

`/accounts/[id]/register` — the page reached from **Entries and balance** on an
account. The owner: *"jotogula account ache ekhane add record name ekta button
ache jetar dorkar nai ekhane karon ekhane kono record manually add korbona"*.
Nothing is entered by hand on this screen; the button is `+ Record` at the top
right of `accounts/register-screen.tsx`. It goes, along with whatever drawer it
opened if nothing else opens that.

## 4. Multi-select and bulk trash — where it stands

**Done and measured.** `POST /trash/:kind/bulk` (all-or-nothing, one
transaction, N+1 audit rows under one request), `useBulkSelect`, `BulkBar`,
`TickHead`/`TickCell`, one scoped CSS rule, `DeleteDialog` counting, and the
tick column live on **Team** and **All transactions**. `.bulktrashqa.mjs` (20)
and `.bulkuiqa.mjs` (12) drive both.

**Adopted:** Team, All transactions, Cash in, Other expenses, AI tools and
subscriptions — six tables over eight screens (transaction-table serves three).

**Still to adopt**, same three edits each: Settings > Users, Settings > FX rate
history, Payroll runs, and Money transfer. None is a money screen the owner
works in daily, which is why they are last. The register and category screens come free with
`transaction-table.tsx` once their screens pass `bulk` down.

**Deliberately excluded**, each for a reason in the code rather than a
judgement: the bank statement (no delete path at all), TDS withholding (its
"delete" clears a challan number, it does not delete), the salary sheet and
report ledgers (no row identity), audit and email logs (records of what
happened), the importer (already has checkboxes meaning the opposite), and the
trash panel itself (same control, different verbs — the obvious follow-on,
since undoing a 40-row delete is currently 40 clicks).

## 4b. The original note

The owner: *"table gulate multiple select option rakho. karon ami multiple
select kore trash a falate cai. akhon to prottekta one by one trash a felte
hoy"*.

Every `.table-data` table gets a tick column, a "select all on this page" tick
in the header, and — once something is ticked — a bar offering **Move to
trash** for the whole selection.

Three things this must get right, because a bulk delete is the one control
where being careless is expensive:

- it can only ever offer what that table's single-row action already offers.
  A table whose rows cannot be trashed does not grow a tick column.
- the confirmation names the count and the money, not "3 items".
- the API needs a real bulk path, or one request per row with a single audit
  entry — deleting 40 rows must not write 40 unexplained audit lines.

## 9. A team member's bank details

From the Add/Edit person drawer. Three of the six the owner listed are missing:

| | Field | Reality |
|---|---|---|
| 1 | Bank Name | `team_members.bank_name` — exists |
| 2 | **Account Holder Name** | **missing** — a salary often goes to an account in a slightly different name, and the bank rejects a transfer that does not match |
| 3 | Account Number | `bank_account_number` — exists |
| 4 | **Branch Name** | **missing** |
| 5 | Routing | `bank_routing` — exists |
| 6 | **SWIFT Code** | **missing** |

Three new nullable columns. Migration travels alone.

## 18. A subscription that is paid takes money out of the bank

The owner: *"ai tools and subscription ta kaj korena thik vabe. ekhane kichu
kinle eta taka katena bank theke kono history thakena eta puro fix koro perfect
vabe."*

**He is right, and the gap is structural rather than a bug.** A subscription is
a row in `vendors` with billing fields — cycle, amount, currency, next renewal,
billing account. It never writes a transaction. The "paid this period" figure
on that screen is computed by summing transactions that happen to carry the
vendor's id, so money only appears there if somebody separately recorded an
expense and remembered to tag it. Nothing about adding or renewing a plan
touches an account balance.

So: a plan is a plan, and a payment is a payment, and the app only had the
first.

**The shape, and the one rule it must not break.** A payment gets recorded from
the subscription — an action on the row that writes a real `transactions` entry
against the billing account, tagged with the vendor and its category, for the
plan's amount, and rolls `next_renewal_on` forward by the billing cycle.

It must NEVER happen by itself. Money leaving a bank has to be somebody's act,
with a date they chose: a scheduler that quietly created expenses would put
figures in the books that nobody typed, and the first time a card was declined
the app and the bank would disagree with no way to tell which was right.

Everything else follows from that entry existing: the balance moves because it
is an ordinary expense, the history is the ledger's own, the overdraft rule
applies, the trash and the audit log work, and "paid this period" stops being a
guess.

Still to settle before building: whether a payment may be recorded for a month
already paid (probably yes, with a warning — a plan can be charged twice), and
what happens when the card's currency is not the plan's.

## 23. Expenses: an overview that is actually an overview

The owner: *"expenses er overview page tay akhon category item gula asteche. er
name change kore operational expenses kore daw. also overview er jonne new ekta
page banao ... minimum 6ta rakho overview te jegula dynamic asbe. ekhane salary
ta thakte pare jehetu oitao ekta expenses. menu theke other expenses ta remove
kore diyo jehetu oita overview tei thakbe."*

So: what is on `/expenses` today is the CATEGORY grid, and it should be called
**Operational expenses**. A new overview sits above it with the six or so
figures somebody actually opens the page for — and they must be computed, not
typed. The obvious six, each of which the app can already answer:

  AI tools and subscriptions · Salary paid · Tax withheld · Operational
  expenses (the category grid's own total) · Tools and card spend · Other
  expenses

Salary belongs there and is the owner's own point: payroll IS an expense, and
leaving it off the expenses page is why the page never matched the bank.

"Other expenses" comes off the rail because it becomes a box on the overview.

## 24. All transactions: three things off that screen

- **"All accounts" goes.** The filter offers only individual accounts; a
  combined view is what the Reports screens are for.
- **USD reads small under the taka**, the way the account cards do, instead of
  its own column.
- **"Show voided" goes.** A voided row is struck through in place; a checkbox
  that hides them is a second way to ask the same question.

## 28-31. The salary sheet and the statement

**28 — the TDS cell already opens its working.** `TdsCell` is a button on every
row, draft or finalised, and `TdsWorkingDrawer` sits behind it. Nothing to
build; it needs driving once to confirm the drawer actually renders, because
the owner asked for something the code says exists.

**29 — an FX rate per LINE.** The owner: *"fx rate take edit option dite hobe
etake prottekta table a fx rate likhte parbe."* The cell prints the month's
governing figure today, and that figure is exactly what has been removed from
the rest of the app. A rate stored on the LINE is the shape every other figure
now has — the row carries what it was worth and nothing recalculates it later.
`payroll_lines` has no such column, so this is a migration and travels alone.
It supersedes #11's per-month rate: per line is finer and the owner asked for
it second.

**30 — the Breakdown link is gone.** The four figures it opened are already
columns on the same row with their percentages in the headings.

**31 — the bank statement reads oldest first**, and takes the same whole-row
colour as #25. Oldest-first is what a bank's own paper does and what makes a
running balance readable; the screen's own description already says "newest
first", so that line changes too.

## 26-27. The transactions table, tidied

**26 — two things off it.** The Category column (every row reads N/A because a
transfer has none, and the categorised ones are read on the Expenses screens),
and the small grey line under each description carrying the payment method and
a "transfer" chip.

**27 — a reference with nothing attached says N/A.** The Transaction number cell
renders a link and a warning triangle even when no document is on the entry, so
clicking it opens an empty viewer. No paper, no link.

## 25. A row is one colour

The owner: *"je je table a money in oikhaner puro row green thakbe r jetay
money out oitar puro row red hobe karon eirokom multiple color text ektu
ogochalo lage."* Direction is the row's fact, not the amount cell's. Green and
red tints on the row, and the per-cell colouring goes.

## 20-22. The rest of that screen

**20 — the save error, fixed.** The drawer posted `invoiceNo` and `reference`
to a `strictObject` schema that knew neither, and neither column existed. See
`deploy/sql/2026-08-31-subscription-reference.sql` for what was measured.

**21 — the renewal date is computed.** The owner: *"If select Monthly hoy tahole
renews date auto calculation hobe ekhane notun kore renewal date dite hobena oi
field ta remove korte hobe."* Started on + cycle gives it. `advanceCycle()` in
transactions.service.ts already does the arithmetic for a payment; the drawer
should show the answer rather than a box. Keep the column — a plan whose renewal
was typed before today still has it, and some cycles ("none") have no answer.

**22 — the table carries the important columns only.** The owner's list: SL,
date, account, invoice, transaction/reference, login account, username,
department, billing cycle, next renewal date, status. Everything else moves to a
single view page for one plan. That page does not exist yet.

## 19. A monthly date filter on that screen

The status tabs and the search filter it; a period does not. Same shape as the
Expenses screens' month picker, which already exists.

## 14. Social media accounts on a person

A section on the profile where several accounts are added one at a time —
"add new, add new" — each with the platform's icon. So it is a LIST, not a
handful of fixed columns: somebody has two Facebook pages, somebody has none,
and a fixed set of boxes gets both wrong.

A `team_member_links` table (member, platform, url, sort order), the platform
as an enum so the icon is chosen from something known rather than guessed from
the URL. Migration travels alone.

## 15. e-TIN, and an E-Return for each year

The Tax card holds an e-TIN and a single assessment year today. The owner wants
**one E-Return per fiscal year** — 2026-2027, 2027-2028 — each with its own
document. That is a list again, and for the same reason: a person accumulates
one a year for as long as they are employed, and a single row cannot hold last
year's as well as this year's.

`files` already attaches to a team member, so the document needs no new table —
but the RETURN does: which year, whether it was filed, and the file against it.

## 16. Wallet, off the profile

"Where they are paid" prints Wallet and Wallet number, both N/A for everyone.
The owner wants them gone. Done alongside #9, since it is the same card.

## 17. The salary changes already recorded, shown

The profile prints the CURRENT gross and the date it started, and nothing
before it. But every change is already stored: `setCompensation` writes a row
with its own `effective_from` and `change_reason` each time pay is set, which
is what "Since 2026-08-30" is reading.

So this is a reader over rows that exist, not a new record — no migration. The
card lists what pay was, from when, and why it changed, newest first.

## 10-13. What the owner decided on 31 Aug, asked one at a time

**10 — Void inside a locked period is allowed.** Today the trash lets a closed
month be changed and `void` refuses, which is the inconsistency that started
the question. Asked which way to resolve it; the owner chose to open `void` up
rather than close the trash down. Said to him at the time, and worth keeping
here: after this, locking a month stops preventing anything and becomes a
label. His books, his call.

**11 — A payroll month carries its own USD rate.** Typed when the run is
finalised and frozen with it, so salary and tax can be read in dollars without
any governing rate and without last month's figures moving. This is the same
principle as every other figure in the app now: the row carries its own rate.
It needs a column on `payroll_runs`, a box on the finalise step, and the
dashboard's salary/tax dollar view back — reading that stored rate, nothing else.

**12 — Tick columns on the last three tables**, with the lock-out hole closed
FIRST: `TrashService` checks "is this the last super admin" per row, before the
write and outside the transaction, so ticking both super admins together
defeats it and locks everyone out of Settings and Users. That check moves
inside the transaction and counts the whole selection. Auth-adjacent, so its
own push.

**13 — Settings > Trashed gets the tick too**, with both verbs: Restore and
Delete for ever. Undoing a mistaken 40-row delete currently takes 40 clicks,
which makes the bulk delete more dangerous than it needs to be.

## 8. No global FX rate

The owner: *"puro application er kono central or global currency rate ba fx rate
rakhbona ... jehetu prottek transaction a sob jog biyog hocchei tai calculation
ta transaction diyei hoye jabe ... eta setting thekeo remove kore diba"*.

He is right about the principle, and it is the same one that fixed the dollar
balances: a row knows what it was worth on its own day, and dividing a total by
today's rate invents a figure. This finishes that argument.

It is the biggest item on this list, and the reason is worth writing down
before anybody starts:

- `app_settings.fx_fixed_usd_bdt`, `fx_mode`, `fx_provider`, `fx_report_basis`
  and the whole `fx_rates` table exist, with a Settings tab and a rate history.
- `FxService.convert` and `fxForPeriod` are what every report uses to answer
  "show me this period in dollars" — the currency toggle on Reports, the period
  card, the bank stats, the funding report. Those all convert a PERIOD, and a
  period has no single transaction to take a rate from.
- So this is not a deletion; it is a decision about what a dollar column MEANS
  once there is no governing rate. The honest answer is the one the account
  balances already use: sum the dollars each row carries, and mark the total
  approximate where a row carries none. Anything that cannot be summed that way
  loses its dollar view rather than showing an invented one.
- Schema, and it touches settings and every report. Several pushes.

## 7. Cash In: the account first, and no typing over the arithmetic

Two things on that drawer:

- **Received Bank Name moves above the amounts.** Which account it is decides
  whether the form asks for dollars at all, so it cannot be the last question.
- **Amount (BDT) is computed and must stop being typeable.** It already reads
  "Worked out from the two above"; a box that says that and accepts typing is
  a box that will disagree with its own arithmetic. Read-only, with the working
  shown beside it.

## 6. Reference, not Transaction ID — and many documents per entry

The owner, on the Cash In drawer and every drawer like it:

- **"transaction id dorkar nai ekhane only reference lekha thakbe"** — the
  Transaction ID / Reference-only pair goes; one field, called Reference.
- **"Invoice a sudhu upload system thakbe field lagbena"** — the invoice number
  box goes entirely. An invoice is a document, not a number to type.
- **Several documents per entry**, on both, not one.
- **In the tables, an eye** to open what is attached.
- **When there are several, a slider** (or some other way of moving between
  them) rather than a list.

What this disturbs, and why it is not a small change:

- `invoiceNo` and `refNo` are columns, and both are *shown* in tables and
  *searched*. Dropping the invoice number from the form is not the same as
  dropping the column — existing rows have numbers in it, and CLAUDE.md's rule
  about the owner's data means the column stays and the form stops asking.
- Files already attach to a transaction (`files.transaction_id`), so several
  per entry needs no migration — but the drawer's `Attach` helper holds exactly
  one `File`, and so does every caller.
- The viewer opens one document. A slider over several is new.
- Same shape appears in the transaction drawer, the transfer drawer and the
  cash-in drawer, all three of which carry the duplicated `Attach`.

## 5. Card accounts — THE OWNER'S DECISION, recorded as his

Asked on 31 Aug which of three shapes to build. His answer, verbatim:

> **"card er puro number save hobe, cvc encrypted hobe"**

So: the whole card number is kept, and the CVC is encrypted. Option C of the
three that were put to him, with the consequence stated at the time — that
PCI-DSS forbids storing a CVC after authorisation, that this is a company
recording its own cards rather than a processor holding customers', and that
the liability is his to weigh. He weighed it.

**One step further than asked, deliberately:** the NUMBER is sealed too, not
only the CVC. A number in an ordinary column would be served by `GET /accounts`
(it is in `projection`), written into the Accounts spreadsheet, and copied into
`audit_logs.before` by every mutation on that table — three leaks from one
column. Sealed, all three close for free. `card_last4` stays plain because it
is what the screen shows to tell one card from another.

**Still unanswered, and needed before the reveal is built:** what "password
diye protect" means — the person's own login password re-entered, or a separate
shared card password. Nothing like the second exists (no table, no column, no
hashing path) and it cannot be revoked when somebody leaves. The first reuses
`assertPassword`, which is `private` on `TwoFactorService` and would have to be
exported — auth code, so its own push.

**Shipped so far:** `deploy/sql/2026-08-31-card-fields.sql`, alone, as the rule
requires. Seven nullable columns, no backfill, applied twice locally with
`.dataintact.mjs` proving 32 tables and 2,591 rows unmoved.

**Next, in order:** the reveal gate (auth, alone) → shared schema + API with
`seal()` on write and the sealed columns kept OUT of `projection` → the drawer.

## 5b. The original note

The account drawer, when **Type** is `Card`. The owner's list, in order:

1. Card Holder Name
2. Type
3. Bank Name / Card Company Name
4. Card Name, **Card 16 digit, EXP Date, CVC — behind a password**
5. Opening Balance
6. Opening balance date
7. Primary currency
8. Order
9. Notes

The middle group is the whole difficulty. A card number and CVC are not
ordinary fields: storing them is a decision about liability, not a schema
change. What "password protect" means has to be settled with the owner before
anything is built — who may see them, what is stored, and whether the CVC is
stored at all. `secret-box.ts` already seals values at rest and is the obvious
tool; the harder question is who may unseal.

Schema and migration travel alone, so this is at least two pushes.

---

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

## 2026-08-30 — the owner's revision batch: team, and the dollars that would not stay put

**Six items, all with the owner's standing constraint: every piece of existing data survives.**
Nothing here rewrites a stored figure. Two migrations, both additive, both in their own commit.

**Team (`804a6a5`, `f7d91ac`, migration `5e86cfc`).**

- **Employee ID.** The column, its unique index and the payslip that prints it have been there
  since 2026-08-19 — nothing could type into it and no screen read it. It is **optional**, which
  is the whole difference from the version that was removed for being required: the eighteen
  people on the books keep no ID and nothing demands one. Emptying the box clears it, using the
  union `endedOn` already uses, because `optionalText` maps `""` to undefined and on a patch that
  means "leave it alone". A duplicate now names who holds it instead of a bare 500 — which is
  what the bare unique index would have produced the moment the field became typeable.
- **Seniority order.** The directory ran A–Z and now runs by joining date, so SL 1 is the first
  hire. **Three keys**: `joined_on` is a DATE, so people hired the same day have no defined order
  and OFFSET paging can show one twice and another never. All **seven** places that list people
  carry the same keys — directory, compensation backfill, salary sheet, payroll picker, TDS
  register, unallocated TDS lines, subscription seats. One alone and the sheet disagrees with the
  directory about who row one is, on a document that gets signed.
- **Resignation letter.** Offered to somebody who has left — *and* whenever a letter is already on
  file, whatever their status, because hiding a document that exists reads as losing it.
  `on_leave` counts as still here.

**The dollars (`826a280`, migration `cdb737d`).** The owner's report: $14,000 in, and the card
said $13,969, then $13,485. Diagnosed before touching anything — the card divided the running
**taka** balance by **today's** governing rate, while the money went in at the rate of its own
day. Every row already carried its dollars in `original_amount`; **no balance anywhere read it.**

So a foreign account's balance is now the **sum of its dollars**, from an opening stated in its
own currency. A BDT account takes the taka expression verbatim — dividing it by a rate nobody
asked about is how the transfer's stamped `usd_rate` turned a taka account's balance into dollars
in the first draft. A row with no dollars falls back to its **own** recorded rate before anything
else; a row with no rate at all contributes nothing and makes the figure **approximate**, marked.
The taka ledger is untouched, so company totals, payroll and tax read exactly what they read
before. The transfer picker and the transfer rows follow.

Commits: `5e86cfc`, `804a6a5`, `f7d91ac`, `cdb737d`, `826a280`. **Not pushed** — the owner asked
to hold.

**Watch out.**

- **Two migrations must reach production before the code**, which the deploy already guarantees —
  it applies `deploy/sql` before swapping containers. Both are additive and both were applied
  locally with `node .sql.mjs` and verified by query.
- **`opening_balance_usd` is null for every existing foreign account** except ones that opened at
  zero taka, which the migration backfills exactly. Until somebody states it, those accounts read
  approximate. The owner's Exprovia LLC opened at ৳0.00, so it is covered.
- The one predicate that decides exact-versus-approximate needs `coalesce(..., false)` around the
  whole test. Three-valued logic makes an all-null row UNKNOWN rather than false and `bool_and`
  skips it — so the single row that should have made the answer approximate was the single row
  silently ignored. It failed exactly that way before the coalesce went in.
- A comment inside a Drizzle `sql` template literal must carry **no backticks**. One of them ended
  the string and took the API down with "Missing initializer in const declaration".

**Open.** Harnesses: `.teamorderqa.mjs` (13), `.resignqa.mjs` (7), `.usdstableqa.mjs` (18), all in
`.battery.sh` — which now runs **27** and was green end to end, though four of them had to be
re-run: the local API reloads when a file is saved, and a battery started in that window dies on
`ECONNRESET` and reads exactly like a broken app. `.trashroles.mjs` gained a start-wipe for the
same reason `.trashui.mjs` did — its `ref_no` is unique, so debris from a crashed run fails the
next run's INSERT rather than a check. Still queued from the same batch: the Cash In screen has not been re-read since the
dollars became stable — the figure it shows on a USD-primary landing account should now come from
the account's own balance rather than a conversion, and nobody has driven it.


## 2026-08-30 — a transfer between our own accounts is not an expense

**Done.** The owner found it: moving money from Exprovia LLC to M/S Exprovia was listed on Other
expenses, under no category, beside the electricity bill. A transfer is stored as two rows sharing
a `transfer_group_id`, and the `out` half is a `direction='out'` transaction like any other — so
every query asking "what went out" counted it.

Measured before touching anything. A ৳50,000 transfer between two of our own accounts moved:

| Surface | Before the fix | Right answer |
|---|---|---|
| Other expenses list | +1 row | must not appear |
| company `moneyOut` (Reports overview) | +50,000 | must not move |
| the statement's `moneyOut` | +50,000 | must not move |
| the sending account's own `moneyOut` | +50,000 | **must** move |
| All transactions | +2 rows | **must** list both |
| the category breakdown | unchanged | already immune — a transfer has no category |

So the rule is not "hide transfers", it is **"a transfer is not spending, but it is a movement"**.
`transactions/own-money.ts` holds it once — `notATransfer()` — with the list of places it must NOT
be applied written into the file: the register, the statement, the per-account dashboard blocks,
All transactions, the balances and the overdraft rule. A new `excludeTransfers` filter carries it
to the screens that ask for it; the Other expenses screen sets it on **both** of its calls, or the
subtraction that works out the tooling count would count transfers as tools.

Both halves are excluded from the company totals, not just the outgoing one — that is why the net
still ties and both figures become honest rather than one of them.

Commits: `4c52971`. **Not pushed** — the owner asked to hold.

**Open.** `.notspend.mjs` (9 checks) proves both directions, including that a query which does not
ask to exclude transfers still gets them — the register depends on that. The battery was
interrupted mid-run by the session ending and wants a clean pass before this goes out.


## 2026-08-30 — an uploaded document opens where it was uploaded

**Done.** The owner's bug: every paper on a team member's profile answered
*"api.hellonizam.com refused to connect"*. Not the upload, not the storage — the viewer.

The app is served from one host and the API from another, and the API sends `X-Frame-Options:
SAMEORIGIN` and `frame-ancestors 'self'`. `DocumentViewer` pointed an `<iframe>` straight at the
API, so the browser refused it. Reproduced locally before touching anything, in the browser's own
words: *Framing 'localhost:4001' violates … "frame-ancestors 'self'". The request has been
blocked.*

`DocumentViewer` now fetches the bytes through the session it already holds and frames a `blob:`
URL, whose origin is the page's own. **The header is not relaxed** — the API goes on refusing to
be framed by anybody, which is what that header is for, and a check asserts it still does.

**This lesson had already been paid for once.** `ledger/documents-dialog.tsx` hit the same wall
and wrote `PdfFrame` to work around it, with the reason in a comment. The shared viewer never
learned it. Two copies of one lesson is how the second gets forgotten; the new comment says so,
and folding them together is a job for whoever is next in both files.

**The rest of the site: swept, and clean.** There are exactly two `<iframe>`s in the whole web
app — the ledger's (already correct) and this one. Everything else pointing at the API is an
`<img>` or an `<a href>`, and neither is governed by frame headers; the images were *measured*
loading rather than assumed (`naturalWidth` from the API host, fine). No `<embed>`, `<object>`,
`<video>` or `<audio>` anywhere. `.docviewqa.mjs` carries that sweep so a future frame pointed at
a file URL fails a test rather than a person.

Commits: `6d171a9`. **Not pushed** — the owner asked to hold.

**Watch out.** `components/ui/overlay.tsx` is shared, but only `DocumentViewer` inside it changed,
and `DocumentViewer` has exactly one caller: the Documents card on a team member's profile. The
file's other exports — `ConfirmDialog`, `ImageLightbox`, `useDismissable` — are untouched and
reach every delete dialog in the app; the full battery was run for that reason.

**Open.** Nothing on this. The two copies of the blob technique remain two copies.


## 2026-08-29 — the salary sheet reads like the owner's Excel

**Done.** The last of the owner's payroll batch. Their sheet (found as today's
"Untitled spreadsheet - Sheet1.csv" download, 15:52) fixes the column order, and the table now
follows it exactly: SL · Name · Role · Dept · Basic · House Rent · Medical · Conveyance · Bonus ·
Other + · Working Days (of the month's real length) · Gross · TDS · Other − · Net Pay · FX Rate ·
Net Pay (USD) · actions.

What moved and what appeared:

- **Role and Dept are their own columns** (the build-time snapshots), no longer a grey line under
  the name.
- **The split columns run in the sheet's order** — Basic, House Rent, Medical, Conveyance — via a
  preference sort; an unknown label keeps its first-seen place at the end rather than vanishing.
- **Working Days is a column on the sheet itself**, editable in draft: typing 10 into a 31-day
  month pro-rates the row through the same server path as the drawer (proven: 31,000 → 10,000.00
  in the database). The month's own number, or an emptied box, means a full month.
- **Gross moved after the components**, as the sheet has it.
- **FX Rate and Net Pay (USD)** — the month's governing rate (the `fx/governing` endpoint from
  this morning) and the net translated at it, `≈`-marked; N/A when nothing governs. The totals
  row carries the USD total too.

**One deliberate departure from the sheet: `Other −` stays**, between TDS and Net. It is not in
the Excel, but it still moves the net — a figure that counts but cannot be seen is the class of
bug this app exists to hunt. If the owner wants it gone, it is one column and its total.

Commits: `6f78421`.

**Open.** `.sheetqa.mjs` (5 checks) drives the order, the snapshots, the day-typing and the FX
columns. The payslip PDF still prints its own layout — nobody has asked for it to match the sheet.


## 2026-08-29 — payroll: working days drive the pay

**Done.** The owner's payroll rules, all in `updateLine`:

- **One number.** Paid days is gone from the contract, the drawer and the slip — the pair printed
  "14 of 14" and meant nothing. `paid_days` stays in the database, unwritten.
- **The divisor is the month's own length** — 28/29/30/31, never a typed 26 or 30. Proven on
  February 2032 (leap, 29), April (30) and May (31); 30 days into that February is refused naming
  the 29.
- **Gross = salary × days ÷ length**, and every earnings line scales with it, rounding drift
  pinned on the largest line so the parts still sum to the gross exactly — 31,000 was chosen for
  the harness precisely because it divides nothing evenly.
- **The tax is worked out on the pro-rated figure.** Proven with money in it under the real
  fiscal-2026 rule: a 150k month owes 9,000; ten days of it owes exactly what a hand-set gross of
  the same figure owes, and less than the month.
- **The base is the recorded salary, never the line's own gross** — 10 days then 20 days
  pro-rates from 31,000 both times; from the shrunk gross a second save would halve pay silently.
- **Null restores the full month**, and **a hand-typed gross clears the day count** — a figure
  must not claim to come from days it did not come from.

Commits: `0a892b1`.

**Watch out.** The breakdown drawer's footer used to promise "the totals on the salary sheet do
not change" — that promise is deliberately dead: working days now re-figure the gross and the tax
on the sheet. The payslip prints "Working days: N days" or "Full month".

**Open.** The owner also wants the payroll table laid out like their Excel — the file has not
reached the chat yet, so that half waits for it. `.prorataqa.mjs` (17 checks) is the harness;
`.payrollpickqa.mjs`'s save-check now polls instead of sleeping 1.5s — it was a stopwatch, and it
flaked both ways to prove it.


## 2026-08-29 — the governing rate reaches the accounts cards

**Done.** The owner's item 1: a USD-primary account still sat stated in taka on the live accounts
page. The swap logic was fine — the rate never arrived. `accounts/page.tsx` read the raw
`fx_rates` TABLE (empty on the live site) through an endpoint behind `settings.read` (failing
quietly for most roles on top of being empty), while the Settings rate every report already uses
— 122.50 — never reached the cards.

New `GET /fx/governing` returns this month's governing rate by the one resolution order the app
has (funded → Settings → table), behind `accounts.read` because it is one number every reader of
that page needs, not the rate register. The page reads it; proven under exactly the live
condition — fx table empty, Settings 122.50 — with the card then leading `~$500.00` over
`৳61,250.00`.

Commits: `7285b80`.

**Open.** Nothing on this item. The owner has queued payroll work (working-days pro-rata, tax on
the pro-rated amount, the sheet's column order) — next session's page.


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
