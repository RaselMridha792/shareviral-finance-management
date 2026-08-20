@AGENTS.md

# SFM — read this before you touch anything

ShareViral Finance Management: an internal finance portal for a Bangladesh company, live at
**app.hellonizam.com** / **api.hellonizam.com**. Real money, real payroll, real tax filings. It is
in daily use, so a broken deploy is an outage rather than an inconvenience.

npm workspaces: `apps/web` (Next.js 16), `apps/api` (NestJS 11), `packages/shared` (Zod schemas
and anything both sides need).

## Start and finish

**At the start of a session**, read `SESSIONS.md` — the newest entry is what changed most
recently and what is still open. `STATUS.md` describes the app as a whole.

**When you finish a piece of work**, add an entry at the top of `SESSIONS.md`. Other sessions —
and the owner — have no other way to know what you did. An entry costs a minute; discovering
somebody else's half-finished change by tripping over it costs an hour.

**More than one session often runs on this repository at once.** So:

- **Never `git add -A`.** Stage the files you actually changed, by name. `-A` sweeps another
  session's unfinished work into your commit, and it has already happened once.
- `git pull --rebase origin main` before you commit. Main moves while you work.
- If a file changes under you mid-task, somebody else owns it. Leave it and say so.
- Push when the work is finished, not to save progress. **Every push deploys.**

## The things that have actually cost time here

- **`packages/shared` is consumed as built `dist/`.** Editing its `src` changes nothing until
  `npm run build --workspace @finance/shared`.
- **Run `npm run lint` at the repository root.** CI lints all three workspaces. Linting only
  `apps/web` let two deploys fail.
- **The local database and the live one are different databases.** `apps/api/.env` points at
  Neon; production is the `db` container (`postgres://…@db:5432/sfm`). Seeding or migrating from
  a laptop reaches Neon and changes nothing on the live site.
- **Schema changes go in `deploy/sql` as idempotent SQL** (`IF NOT EXISTS`). The deploy applies
  every file there before the containers swap. Apply them locally yourself with `node .sql.mjs`.
  Shipping code whose migration has not run takes the site down — Drizzle names every column in
  its SELECT, so one missing column kills the whole query.
- **Money is `numeric(14,2)` strings.** Sum in SQL, never with JS floats.
- **`accounts.currency` marks which account is for foreign spend. It does not denominate the
  figures** — every amount in this app is BDT, including a USD card's.
- **`.table-data thead th` (0,1,2) outranks a bare utility class (0,1,0).** `text-right` on a
  table heading silently does nothing without a matching specific rule.
- **`ALTER TYPE … ADD VALUE` cannot run inside a transaction**, needs `IF NOT EXISTS`, and has to
  reach both databases.

## Verify by measuring, not by reading the diff

Most of the bugs found in this codebase were invisible in a diff: a column that never got its
alignment, a pager that asked for 50 rows while numbering in 20s, a filter built and never wired
to a caller, a feature shipped against a database that lacked its table. There are throwaway
scripts at the repository root for exactly this — `.sweep.mjs` measures every screen's layout,
`.pager.mjs`, `.linkcheck.mjs`, `.rolecheck.mjs`, `.sql.mjs` applies migrations locally. Write
another when you need one.

Before saying something works: run it, load the page, query the database. "It compiles" and "the
tests pass" are not the same claim as "it does the thing".

**Check the exit code, not the last three lines.** `npm run lint | tail -3 && git commit` cannot
fail: the pipe makes the exit status `tail`'s, and the tail shows the last workspace rather than
the one that broke. Four commits went out that way before CI caught three formatting errors, and
because the `test` job gates `build`, no image was published and the server sat two releases
behind while every log said nothing. Run the four CI steps as CI runs them, each on its own:

```bash
npm run build:shared && npm run typecheck && npm run lint && npm test
```

## Working with the owner

- Explanations in **plain Bangla**; code, commands and commit messages in English.
- **No Bangla text inside shell commands** — ASCII only.
- **Passwords, tokens and API keys go into the server terminal, never into chat.**
- The owner gives work page by page and decides scope; you decide order and when to push. After
  each finished piece, one or two lines saying it is done — not a report.
