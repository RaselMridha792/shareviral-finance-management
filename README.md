# ShareViral Finance Management

An internal finance portal for a Bangladesh company, replacing the spreadsheets
that currently hold the books. Money in and out, payroll, vendors, withholding
tax, company income tax, reports, and Excel export — in one place, with a role
boundary that HR cannot cross to reach a salary figure.

Bangladesh only. The USA enters in exactly one place: the CEO funds the company
in dollars and wants the reports translated into dollars. There is no second set
of books.

## Layout

```
apps/web        Next.js 16 · React 19 · Tailwind v4        :3000
apps/api        NestJS 11 · Drizzle · PostgreSQL           :4001
packages/shared Zod schemas, permissions, money, periods, deadlines
```

`packages/shared` is the point. A schema written there validates the API
request, the web form, and — later — what the assistant is allowed to ask for.
One definition, so the three cannot drift.

## Running it

```bash
npm install
cp apps/api/.env.example apps/api/.env       # fill in DATABASE_URL and the JWT secrets
cp apps/web/.env.example apps/web/.env.local

npm run db:push          # create the tables
npm run db:seed          # create the accounts — prints the passwords once
npm run db:seed-categories

npm run dev              # shared watch + api + web
```

Then open <http://localhost:3000>.

Want something on the screen before the real numbers arrive:

```bash
npm run db:demo          # a made-up July–August 2026
npm run db:demo -- wipe  # and remove it again
```

Everything the demo creates is tagged, and `wipe` removes exactly that tag —
entries you made yourself are never touched.

## Commands

| | |
| --- | --- |
| `npm run dev` | all three workspaces, watching |
| `npm run typecheck` · `npm run lint` · `npm test` | must all be clean |
| `npm run build` | production build of all three |
| `npm run db:push` | apply the schema |
| `npm run db:check` | is the database reachable, and how fast |
| `npm run db:seed -- --reset-passwords` | new passwords for the seeded accounts |

## How it is built

**One ledger, not two.** Expenses, the bank register, the monthly report and the
dashboard are four views of a single `transactions` table. Separate tables would
need every expense to have a matching bank row, and the two drift the first time
someone edits one.

**Salary lives in its own table.** `team_members` has no salary column at all;
compensation is a separate table that HR-reachable endpoints never join. A
field-stripping serializer can be forgotten. A missing join cannot.

**Money is `numeric(14,2)` and moves as a string.** Never a float. Sums, running
balances and differences are computed in SQL.

**Records are voided, not deleted.** A voided row stays visible, struck through,
and out of every total.

**The app records tax, it does not calculate it.** The accountant supplies the
figures; the app holds them to the statutory calendar — including the June TDS
deposit cliff and the quarterly (not half-yearly) withholding return.

**Audit rows are written inside the same transaction as the change.** Either
both land or neither does.

**Every "today" goes through `todayInDhaka()`.** A UTC server is six hours behind
Dhaka, which is enough to file a 3 a.m. entry on the 1st into the previous month.

## Documents

- **[Working the books](https://claude.ai/code/artifact/830bfbf9-64a5-48d7-a542-645a021ee7b8)** — the handbook, for everyone who signs in.
- **[How it is built, and why](https://claude.ai/code/artifact/452c4571-0fe2-48e1-a485-568830d6b6e4)** — the architecture notes, for whoever maintains this next.
- [STATUS.md](STATUS.md) — what is built, what is verified, what is next.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel and Render today, the VPS when you want it.

## Security

`.env` is git-ignored and must stay that way. Passwords are printed once by the
seed script and stored nowhere else — not in this repository, not in STATUS.md.
Both auth tokens are httpOnly cookies; the refresh token rotates on every use
and replaying a spent one revokes the whole session family.
