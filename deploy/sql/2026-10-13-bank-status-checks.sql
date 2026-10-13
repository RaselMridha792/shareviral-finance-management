-- The Check column of Accounts > Bank status, ticked by hand
-- (docs/briefs/2026-10-13-books-month-and-bank-status.md, piece 4d-1).
--
-- WHY. Check reads Matched when the month's statement is reconciled in
-- Reports, and that record is for the whole company, so every row agrees. The
-- owner, 13 Oct: "bank status a manual check marked manually o kora jabe" --
-- a tick per account per month, the way the sheet's Check column is filled in.
--
-- account_month_checks       one row per account per books month that someone
--                            ticked by hand; unticking deletes the row. Removed
--                            with its account; outlives the person who ticked
--                            it.
--
-- Not a column on account_month_notes: there note is not null and the row goes
-- when its note is cleared, so a tick would need a note, or clearing a note
-- would untick the row.
--
-- RUN THIS BEFORE THE CODE (piece 4d-2 reads it).
--
-- Defined here and nowhere else; IF NOT EXISTS throughout, so a second run
-- changes nothing.
begin;

create table if not exists account_month_checks (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  month       date not null,
  checked_by  uuid references users(id) on delete set null,
  checked_at  timestamptz not null default now(),
  constraint account_month_checks_month_first check (extract(day from month) = 1),
  constraint account_month_checks_one unique (account_id, month)
);

commit;

-- What this file did, in figures.
select
  (select count(*)::int from information_schema.tables
    where table_name = 'account_month_checks')                 as checks_table,
  (select count(*)::int from pg_constraint
    where conname in ('account_month_checks_month_first',
                      'account_month_checks_one'))             as constraints;
