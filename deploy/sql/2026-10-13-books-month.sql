-- The month an entry belongs to, and a note per account per month
-- (docs/briefs/2026-10-13-books-month-and-bank-status.md, piece 1).
--
-- WHY. The boss closes a month's books in the month after: his May tab holds
-- the funding of 9 June, the transfers of 11 June and May's salaries paid on
-- 12 June. The app counted an entry in its date's month, so May read 0 on the
-- Dashboard and on Accounts. The owner, 13 Oct: "a month is the month an
-- entry belongs to, not the month of its date".
--
-- transactions.books_month   the first day of the month the entry belongs to.
--                            NULL means "the month of txn_date", so every
--                            existing row stays right with no backfill, and
--                            only an entry that belongs to another month
--                            carries a value. Every month view reads
--                            coalesce(books_month, date_trunc('month', txn_date)::date)
--                            through one helper in the code. txn_date stays the
--                            day the money moved: the overdraft rule, the bank
--                            statement, reconciliation and TDS keep using it.
--                            "Not later than the date's month" is the API's
--                            rule rather than a CHECK, so the owner can widen
--                            it (prepayments) without a migration.
--
-- account_month_notes        the Note column of Accounts > Bank status, typed
--                            by hand, one per account per month. Removed with
--                            its account; outlives the person who typed it.
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so code
-- that knows books_month dies against a database without it.
--
-- Defined here and nowhere else; IF NOT EXISTS throughout, so a second run
-- changes nothing.
begin;

alter table transactions
  add column if not exists books_month date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_books_month_first'
  ) then
    alter table transactions
      add constraint transactions_books_month_first
      check (books_month is null or extract(day from books_month) = 1);
  end if;
end $$;

create table if not exists account_month_notes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  month       date not null,
  note        text not null,
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint account_month_notes_month_first check (extract(day from month) = 1),
  constraint account_month_notes_one unique (account_id, month)
);

-- Payroll: a run's salary rows belong to the run's period, whatever day they
-- were paid. Touches only rows still NULL whose date is in another month, so a
-- second run finds nothing. Live has no payroll rows since the reset.
update transactions t
   set books_month = make_date(r.period_year, r.period_month, 1)
  from payroll_runs r
 where t.payroll_run_id = r.id
   and t.books_month is null
   and date_trunc('month', t.txn_date)::date <> make_date(r.period_year, r.period_month, 1);

commit;

-- What this file did, in figures.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'transactions' and column_name = 'books_month')
    as column_added,
  (select count(*)::int from pg_constraint
    where conname = 'transactions_books_month_first')          as check_added,
  (select count(*)::int from information_schema.tables
    where table_name = 'account_month_notes')                  as notes_table,
  (select count(*)::int from transactions
    where books_month is not null)                             as rows_with_books_month;
