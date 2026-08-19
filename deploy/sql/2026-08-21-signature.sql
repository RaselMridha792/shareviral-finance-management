-- The company's signature, for the foot of a payslip.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-signature.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- A column on `files` and a value on its kind. Drizzle names every column in
-- its SELECT, so without this every read of every attachment fails — the
-- documents popup, the team member's papers, the plan screenshots, all of it.
--
-- ------------------------------------------------------------------------
-- Why the settings row is an owner
-- ------------------------------------------------------------------------
-- `files` holds one rule: a file belongs to exactly one thing, counted by a
-- check constraint over its owner columns. A row owned by nothing is
-- unreachable through every screen and still on the disk — the kind of leak
-- found by running out of space.
--
-- A signature belongs to the company, and the company is the `app_settings`
-- row. So it becomes the fifth owner rather than an exception to the rule.
-- A smallint and not a uuid, because that table is keyed by one with
-- `check (id = 1)`.
--
-- The check is REPLACED, not added to. A new column outside the count would let
-- a row belong to two things and the constraint would go on saying it could
-- not.
--
-- The enum value is added after the commit: Postgres refuses to read a label in
-- the same transaction that created it.
--
-- Safe to run twice.

begin;

alter table files
  add column if not exists settings_id smallint
    references app_settings (id) on delete cascade;

create index if not exists files_settings_idx
  on files (settings_id);

alter table files drop constraint if exists files_one_owner;
alter table files add constraint files_one_owner check (
  (case when team_member_id  is not null then 1 else 0 end
 + case when transaction_id  is not null then 1 else 0 end
 + case when import_batch_id is not null then 1 else 0 end
 + case when subscription_id is not null then 1 else 0 end
 + case when settings_id     is not null then 1 else 0 end) = 1
);

commit;

alter type file_kind add value if not exists 'signature';

-- The column, the index, the kind, and that no existing file broke the rule the
-- new constraint enforces.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'files' and column_name = 'settings_id') as column_exists,
  (select count(*) = 1 from pg_indexes
    where indexname = 'files_settings_idx') as index_exists,
  (select count(*) = 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'file_kind' and e.enumlabel = 'signature') as kind_exists,
  (select count(*) = 1 from pg_constraint
    where conname = 'files_one_owner') as one_owner_constraint,
  (select count(*) from files where deleted_at is null) as files_still_readable;
