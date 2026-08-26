-- Deleting, and somewhere for deleted things to go.
--
-- Voiding already exists and stays: a voided money row is struck through, drops
-- out of every total, and remains on the screen where somebody put it. That is
-- the right answer for a correction — the entry happened and its reversal is
-- part of the story.
--
-- Deleting is the other case, and the owner is right that it was missing: a row
-- entered against the wrong account, a duplicate typed twice, a test entry from
-- the first week. Nobody wants those struck through on the ledger for ever.
-- They should go, be recoverable for a while, and then really go.
--
-- WHAT EACH TABLE GETS
--
--   deleted_at      when, and the flag every list filters on
--   deleted_by      who, because "it disappeared" is not an answer
--   delete_reason   why, typed into the confirmation box
--
-- WHY MONEY ROWS ALSO GET voided_at SET (in the API, not here)
--
-- `voided_at` is already excluded from every total in this application —
-- twenty-nine query sites across nine services check it. Adding a second flag
-- and remembering to filter it in all twenty-nine is how one gets missed, and a
-- missed one is a deleted row still counted in a total: invisible, and wrong in
-- the direction nobody checks.
--
-- So deleting a money row sets both. Every existing total excludes it the day
-- this ships, without a single sum being edited. The lists then hide it by
-- `deleted_at`, and if a list is ever missed the row is *visible* rather than
-- silently counted — the harmless failure instead of the dangerous one.
--
-- WHAT IS DELIBERATELY NOT DELETABLE
--
--   audit_logs        the record of who deleted what. A delete that can erase
--                     its own trace makes the trash worthless.
--   app_settings      one row by CHECK constraint.
--   schema_migrations the deploy's own bookkeeping.
--   tax_policies      the slabs. Superseded per year, never removed.
--   payroll_lines,    derived from a run, an allocation or a batch. They go
--   tds_allocations,  when their parent goes; deleting one on its own would
--   import_rows       leave a total that no longer adds up.

alter table transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table categories
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table payroll_runs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table tds_deposits
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table income_tax_records
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table withholding_returns
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table fx_rates
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table statements
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table compensation_history
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table subscription_users
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table import_batches
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

-- The six that already had the column gain the other two, so one shape covers
-- every deletable table and the trash can read them all the same way.
alter table accounts
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table team_members
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table subscriptions
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table vendors
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table files
  add column if not exists delete_reason text;

alter table users
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

-- The trash screen asks one question of every table — "what is deleted, newest
-- first" — so each one gets the index that answers it. Partial, because the
-- rows it covers are the rare ones and a full index on a column that is null
-- for every live row earns nothing.
create index if not exists transactions_deleted_idx
  on transactions (deleted_at desc) where deleted_at is not null;
create index if not exists categories_deleted_idx
  on categories (deleted_at desc) where deleted_at is not null;
create index if not exists payroll_runs_deleted_idx
  on payroll_runs (deleted_at desc) where deleted_at is not null;
create index if not exists tds_deposits_deleted_idx
  on tds_deposits (deleted_at desc) where deleted_at is not null;
create index if not exists income_tax_records_deleted_idx
  on income_tax_records (deleted_at desc) where deleted_at is not null;
create index if not exists withholding_returns_deleted_idx
  on withholding_returns (deleted_at desc) where deleted_at is not null;
create index if not exists fx_rates_deleted_idx
  on fx_rates (deleted_at desc) where deleted_at is not null;
create index if not exists statements_deleted_idx
  on statements (deleted_at desc) where deleted_at is not null;
create index if not exists compensation_history_deleted_idx
  on compensation_history (deleted_at desc) where deleted_at is not null;
create index if not exists subscription_users_deleted_idx
  on subscription_users (deleted_at desc) where deleted_at is not null;
create index if not exists import_batches_deleted_idx
  on import_batches (deleted_at desc) where deleted_at is not null;
create index if not exists accounts_deleted_idx
  on accounts (deleted_at desc) where deleted_at is not null;
create index if not exists team_members_deleted_idx
  on team_members (deleted_at desc) where deleted_at is not null;
create index if not exists subscriptions_deleted_idx
  on subscriptions (deleted_at desc) where deleted_at is not null;
create index if not exists vendors_deleted_idx
  on vendors (deleted_at desc) where deleted_at is not null;
create index if not exists files_deleted_idx
  on files (deleted_at desc) where deleted_at is not null;
create index if not exists users_deleted_idx
  on users (deleted_at desc) where deleted_at is not null;
