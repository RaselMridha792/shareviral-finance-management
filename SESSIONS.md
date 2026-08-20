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
