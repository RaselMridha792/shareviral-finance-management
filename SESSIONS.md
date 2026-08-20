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
default and clears the key. Four CI steps run separately, all green. Commits: `PENDING`.

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
