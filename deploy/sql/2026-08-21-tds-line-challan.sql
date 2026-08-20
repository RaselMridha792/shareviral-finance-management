-- A challan number on the person it was deposited for, and the scan behind it.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-tds-line-challan.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- Drizzle names every column in its SELECT, so the code that reads
-- `payroll_lines.tds_challan_number` kills the payroll run, every payslip and
-- the withholding register until this has run.
--
-- ------------------------------------------------------------------------
-- What changes
-- ------------------------------------------------------------------------
-- The withholding register lists one row per person per month. The owner's ask
-- is that the challan the tax was deposited under is readable on that row, and
-- that the paper behind it opens from the number — so the number lives on the
-- payroll line, and the scan hangs on the line as a seventh file owner.
--
-- `tds_deposits` and `tds_allocations` are untouched and keep their 28 rows.
-- They record a deposit as the bank made it — one challan, one amount, many
-- people — and nothing here rewrites that history.
--
-- ------------------------------------------------------------------------
-- Why the constraint is replaced, again
-- ------------------------------------------------------------------------
-- `files` holds one rule: a row belongs to exactly one thing, counted across
-- its owner columns. A new owner column outside that count would let a file
-- belong to two things while the constraint went on claiming it could not, so
-- the check is REPLACED rather than added to. This is the fourth file to do
-- that, which is why it names every owner column that exists rather than the
-- ones it happens to care about — replaying this directory in filename order
-- must not put an older, shorter rule back on top of a newer one.
--
-- It also repairs one: `2026-08-20-challan-file.sql` added `tds_deposit_id`
-- and never added it to the count, so a challan scan could not be stored at
-- all — the insert failed the check with a sum of zero. Measured on the
-- development database before writing this: the constraint counted five
-- columns, and `files` holds no row owned by a deposit.
--
-- Safe to run twice.

begin;

-- The challan this person's withheld tax was deposited under. Nullable, and
-- null is the ordinary state: a month's tax is deposited after the run is
-- finalised, so every line starts without one.
alter table payroll_lines
  add column if not exists tds_challan_number text;

-- The scan. One nullable foreign key per owner, like every other document in
-- this table — see the note on `files` for why ownership is not a type/id pair.
alter table files
  add column if not exists payroll_line_id uuid
    references payroll_lines (id) on delete cascade;

-- The same partial index the other owner columns have: a file is looked up by
-- what it hangs on, and only rows that hang on a line are worth indexing.
create index if not exists files_payroll_line_idx
  on files (payroll_line_id)
  where payroll_line_id is not null;

-- Read a month's challan numbers without reading the month's payroll.
create index if not exists payroll_lines_challan_idx
  on payroll_lines (tds_challan_number)
  where tds_challan_number is not null;

alter table files drop constraint if exists files_one_owner;
alter table files add constraint files_one_owner check (
  (case when team_member_id  is not null then 1 else 0 end
 + case when transaction_id  is not null then 1 else 0 end
 + case when import_batch_id is not null then 1 else 0 end
 + case when subscription_id is not null then 1 else 0 end
 + case when settings_id     is not null then 1 else 0 end
 + case when tds_deposit_id  is not null then 1 else 0 end
 + case when payroll_line_id is not null then 1 else 0 end) = 1
);

commit;

-- `challan` is already a value of `file_kind` — 2026-08-20-challan-file.sql
-- added it — so there is no `alter type` here and nothing that has to sit
-- outside the transaction.

-- The column, the owner, the rule, and that no existing file broke it on the
-- way through.
select
  (select count(*) from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'tds_challan_number') as line_column,
  (select count(*) from information_schema.columns
    where table_name = 'files' and column_name = 'payroll_line_id') as file_column,
  (select count(*) from pg_constraint
    where conname = 'files_one_owner') as one_owner_constraint,
  (select count(*) from files where deleted_at is null) as files_still_readable;
