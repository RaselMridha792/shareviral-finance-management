# Brief — reset the live data for real use: keep Team and Accounts, new sign-ins

**For:** one Claude session. This empties the **live** database, which cannot be undone
except from its backup. Read the whole brief before writing anything.
**From:** the planning session, 4 Oct 2026, from the owner's words and four answers.

## What the owner asked

> "ami application a real data insert korbo … team e users data sobgula thakuk. accounts
> a connected account gula thakuk. baki sob reset kore daw. new super admin create koro
> ei mail a: finance@shareviral.cash, new CFO mail hobe: yeasin@shareviral.cash, New CEO
> role hobe: delence@shareviral.cash, admin access tar dorkar nai apatoto"

The four answers (AskUserQuestion, 4 Oct):
1. **Sign-ins: remove every existing login and create all of them new, except the HR
   portal's login.** That covers `rasel.exprovia@gmail.com` and the test logins.
   **Changed by the owner the same day: "hr er connection vanga jabena tar login
   thakuk"** — the HR link must not break, so the HR portal's login stays.
2. **Keep the categories, the TDS slabs and Settings.** That covers company details,
   appearance, the Anthropic, Google and Resend keys, the Assistant's settings and the
   owner's instructions.
3. **Remove all the plans** on AI tools and subscriptions, and the vendors with them.
   The question was "vendors and plans", the answer "remove all plans from here now".
   Show vendors in the report as emptied, and **say so to the owner before the wipe**,
   so they can stop it if they meant to keep vendors.
4. **The HR portal's requests and the team's salary history: reset both.**

"admin access tar dorkar nai apatoto": there is no `admin` role any more (retired on
5 Sep, `permissions.ts`). Read this as: only Super Admin, CFO and CEO for now, and
nobody else.

## What stays, and what goes

**Kept, as they are:**
- `team_members`, with bank details, and their documents (rows in `files` that belong to
  a team member);
- `accounts`, with card secrets and opening balances;
- `categories`;
- `tax_policies` and `tax_policy_bands`;
- `app_settings`, **including its keys, unlike `clean-for-production.sh`**;
- `schema_migrations` (never empty it; the deploy replays from it).

**Emptied:** everything else. That is at least:
- transactions, transfers, expenses;
- vendors, subscriptions and their users and upgrades;
- invoices;
- payroll runs and lines;
- `compensation_history` (the owner's answer 4);
- `compensation_requests`, `payroll_one_offs`, `hr_budget_periods`, `hr_budget_spends`;
- bank advices and their lines, bank statements and reconciliation, imports;
- audit logs, notifications;
- AI chats, attachments, corrections and usage;
- refresh tokens (everybody signs in again);
- `files` rows that belonged to emptied records.

**Take the list from the live database's own tables** (`information_schema`), as
`clean-for-production.sh` does, so that a table added later is emptied by default rather
than kept by mistake. Name the kept ones.

**Users:** the three new sign-ins stay, and so does **the HR portal's login**. Every
other user is removed.
- Find which user the HR portal signs in as: the `hr` role, used by the portal's doors.
- If more than one user has the `hr` role, list them in the report and let the owner
  name the portal's. Never guess.
- Its sessions (`refresh_tokens`) are emptied with everyone's, so the portal signs in
  again on its next call. Its password does not change, so that works as before. Check
  it after the wipe: send one request from the HR portal and see it arrive.
- Tables pointing at `users`: `two-factor`, `files`, the four `ai_*` tables. Check that
  every foreign key to `users` is in an emptied table or is ON DELETE SET NULL before
  you delete anybody.
- Kept tables also carry `created_by` and `updated_by`. Point those at the new Super
  Admin, or set them NULL where the column allows it, so that no kept row names a
  removed person.
- If a hard delete is refused anywhere, mark the user removed and inactive the app's
  own way, and say which way you chose.

**Account balances:** with every transaction gone, each account's balance is its opening
balance. Tell the owner to set each one's real opening balance and date before entering
the real money.

## How it is done, in this order

1. **A script, `deploy/reset-keep-team-and-accounts.sh`**, modelled on
   `clean-for-production.sh`:
   - report-only by default: every table, its row count, kept or emptied, and the users
     kept and removed;
   - `--wipe` takes a `pg_dump` first, and stops if the dump is suspiciously small;
   - one `TRUNCATE` of the named tables, **no CASCADE**, so a stray reference fails
     loudly;
   - then the users and the `created_by` / `updated_by` columns, all in one
     transaction.

   Prove it on the **local** database first: report, wipe, then check the counts, sign
   in, open Team and Accounts. Push it alone. It is an ops script; the deploy brings it
   to `/opt/sfm/deploy`.
2. **The owner creates the three new sign-ins in the app, before the wipe**, while they
   can still get in as the old Super Admin. Settings → People who can sign in:
   - `finance@shareviral.cash`, Super Admin;
   - `yeasin@shareviral.cash`, CFO;
   - `delence@shareviral.cash`, CEO.

   Passwords are typed by the owner in the app, never in chat. **The owner signs in as
   `finance@shareviral.cash`** in a private window and checks that it works. Only then
   go on.
3. **The owner runs the report on the server** and sends the output. It has counts and
   emails, no secrets. You read it with them: vendors emptied (answer 3), salaries
   emptied (answer 4), the three users kept, and nothing kept that should go.
4. **The owner runs `--wipe`**, then `./deploy/sweep-orphan-files.sh` (report) and, after
   reading it, `--delete`, so the bytes of the removed files go.
5. **The HR portal.** Its login stays (answer 1, as changed), so the link holds.
   - **But its requests in finance are emptied (answer 4)**, so the HR portal's own
     records point at finance rows that are gone: its pay changes, one-offs, budgets and
     spends.
   - Its hourly poll will get nothing back for those ids.
   - Write a short note the owner can paste to the HR portal's session: what was reset
     in finance, and that the HR side should reset or close those requests too, so that
     nothing waits on finance for ever.
6. **SESSIONS:** what was emptied (with the counts the report gave), what was kept, where
   the dump is, and what the owner enters next:
   - opening balances;
   - salaries;
   - vendors and plans;
   - the HR link.
