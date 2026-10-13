-- TDS handed back to the staff it was taken from
-- (docs/briefs/2026-10-13-tds-refunded-to-staff.md, piece T1).
--
-- WHY. The boss's sheet: May's salaries were paid gross, June's took May's
-- TDS and June's, and in July "TDS deducted for May and June has been
-- refunded to team members" -- 35,421 paid back out of Standard Chartered.
-- The TDS page works out what is owed as withheld - deposited, with no idea
-- of tax handed back, so it reads 81,177 owed where the truth is 45,756.
--
-- tds_refunds        one row per refund: the month whose TDS it hands back,
--                    the amount, the day, and optionally the ledger row that
--                    paid it out. NOT a challan: it never reaches the challan
--                    list or a return. What is owed becomes
--                    withheld - deposited - refunded (piece T2).
--
-- Outlives its ledger row and the people who wrote it (set null). Soft
-- deletion as on tds_deposits.
--
-- RUN THIS BEFORE THE CODE (piece T2 reads it).
--
-- Defined here and nowhere else; IF NOT EXISTS throughout, so a second run
-- changes nothing.
begin;

create table if not exists tds_refunds (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid,
  period_year     integer not null,
  period_month    integer not null,
  amount          numeric(14, 2) not null,
  refunded_on     date not null,
  transaction_id  uuid references transactions(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references users(id) on delete set null,
  updated_by      uuid references users(id) on delete set null,
  deleted_at      timestamptz,
  deleted_by      uuid,
  delete_reason   text,
  constraint tds_refunds_month check (period_month between 1 and 12),
  constraint tds_refunds_amount_positive check (amount > 0)
);

create index if not exists tds_refunds_period_idx
  on tds_refunds (period_year, period_month)
  where deleted_at is null;

commit;

-- What this file did, in figures.
select
  (select count(*)::int from information_schema.tables
    where table_name = 'tds_refunds')                          as refunds_table,
  (select count(*)::int from pg_constraint
    where conname in ('tds_refunds_month',
                      'tds_refunds_amount_positive'))          as checks,
  (select count(*)::int from pg_indexes
    where indexname = 'tds_refunds_period_idx')                as period_index;
