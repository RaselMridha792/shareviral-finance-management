-- A payroll run's own paperwork: the invoice, and the bank's record of it.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-payroll-run-files.sql
--
-- RUN THIS BEFORE THE CODE. The API's insert names `payroll_run_id`, and
-- Drizzle names every column in its SELECT, so code shipped against a database
-- without this column does not fail politely on the upload — it kills every
-- query that reads `files`, on every screen.
--
-- WHY A NINTH OWNER, when 2026-09-01-team-ereturns.sql went out of its way to
-- avoid one. That file could avoid it because an e-Return acknowledgement is
-- honestly a document *about a person*, and `team_member_id` was already
-- counted. There is no such honest home here. The owner asked for the slot to
-- exist when the run is CREATED and be filled later:
--
--     *"payroll toiri korar somoy invoice and reference upload korar option tao
--      diye diyo"* … *"hea eta pore add kore dibo edit option to achei taina"*
--
-- The obvious alternative was the salary transaction the run writes when it is
-- paid — no new column, and the paper would sit with the money. It is the
-- wrong shape for what was asked: that row does not exist until the money
-- moves, so a run in draft would have nowhere to put its invoice, which is
-- precisely the moment he wants the slot. `payroll_line_id` is no better — a
-- run-level document filed against one arbitrary person's line is a lie about
-- whose paper it is. So: a real column, for a real owner.
--
-- THE ORDERING TRAP, which this file is the fourth to walk into. Six migrations
-- have now dropped and recreated `files_one_owner`, each counting one more
-- column, and replaying this directory in filename order would put an older
-- eight-column rule back on top of this nine-column one — after which every
-- upload here fails with a constraint violation nobody would connect to a file
-- written weeks earlier. Two things keep that from happening and both matter:
-- the deploy RECORDS each file in `schema_migrations` and never re-runs it, and
-- this filename sorts after all six. Anything that touches this constraint
-- again must sort after this file and must count TEN.
--
-- NOTHING IS REWRITTEN. One nullable column, one index, and a check that is
-- strictly wider than the one it replaces — every existing row has exactly one
-- owner set and a null in the new column, so the sum it is checked against is
-- the number it already was. No row is read, moved or changed.
begin;

alter table files
  add column if not exists payroll_run_id uuid
    references payroll_runs (id) on delete cascade;

create index if not exists files_payroll_run_idx on files (payroll_run_id);

-- Recreated rather than amended: Postgres has no "add a term to a check".
-- Dropping first and adding inside the same transaction means there is no
-- instant at which a concurrent insert could file a file under two owners.
alter table files drop constraint if exists files_one_owner;
alter table files add constraint files_one_owner check (
  (case when team_member_id  is not null then 1 else 0 end
 + case when transaction_id  is not null then 1 else 0 end
 + case when import_batch_id is not null then 1 else 0 end
 + case when subscription_id is not null then 1 else 0 end
 + case when settings_id     is not null then 1 else 0 end
 + case when tds_deposit_id  is not null then 1 else 0 end
 + case when payroll_line_id is not null then 1 else 0 end
 + case when statement_id    is not null then 1 else 0 end
 + case when payroll_run_id  is not null then 1 else 0 end) = 1
);

commit;

-- What this file did, in figures. `owner_terms` must read 9; if it reads 8 an
-- older migration has been replayed on top of this one.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'files' and column_name = 'payroll_run_id')  as column_added,
  (select count(*)::int from pg_indexes
    where tablename = 'files' and indexname = 'files_payroll_run_idx') as index_added,
  (select count(*)::int
     from pg_constraint c,
          regexp_matches(pg_get_constraintdef(c.oid), 'IS NOT NULL', 'g')
    where c.conname = 'files_one_owner')                            as owner_terms,
  (select count(*)::int from files where deleted_at is null)        as files_untouched;
