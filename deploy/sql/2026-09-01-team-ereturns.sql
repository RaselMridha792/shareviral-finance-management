-- One E-Return per fiscal year, per person, with the document behind it.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-01-team-ereturns.sql
--
-- RUN THIS BEFORE THE CODE, AND ON ITS OWN.
--
-- The owner: *"1. E-Tin Number 2. E Return (akhane akta kore ortho bochor
-- thakbe like 2026-2027 and document upload korar option thakbe. Ata every year
-- a 1 ta hobe)"*.
--
-- The e-TIN half is already here — `team_members.etin`, on the form and on the
-- profile — so this file is only the return.
--
-- ------------------------------------------------------------------------
-- The file kind, first, and outside any transaction
-- ------------------------------------------------------------------------
-- `alter type ... add value` is legal inside a transaction on Postgres 12+, but
-- the new label CANNOT BE USED in the same transaction that added it —
-- Postgres raises `unsafe use of new value`. Nothing below uses it, so a
-- transaction would in fact be safe; it is kept out anyway, so that this cannot
-- become the file where somebody adds a backfill underneath and gets an error
-- naming neither the cause nor the fix.
--
-- `after 'etin_certificate'` puts the label where the TypeScript array has it,
-- so an `order by` on this column agrees with the order the app lists them in.

alter type file_kind add value if not exists 'e_return' after 'etin_certificate';

-- ------------------------------------------------------------------------
-- The return itself
-- ------------------------------------------------------------------------
-- WHY THE FILE HANGS ON THE PERSON, NOT ON THIS ROW.
--
-- `files` has a check constraint, `files_one_owner`, requiring exactly one of
-- its eight owner columns to be set. Three separate migrations have already
-- dropped and recreated it, each counting one more column, and replaying that
-- directory in filename order puts an older rule back on top of a newer one.
-- Adding a ninth owner would mean touching it a fourth time.
--
-- It does not need touching. The document is a `team_member` file with kind
-- `e_return` — an owner the constraint already counts — and this row points at
-- it by id. The return is the record; the file is a document about the person,
-- which is what it actually is.
begin;

create table if not exists team_ereturns (
  id             uuid primary key default gen_random_uuid(),
  team_member_id uuid not null
                 references team_members (id) on delete cascade,

  -- The year the fiscal year STARTS in. 2026 means 2026-2027, which runs July
  -- to June in Bangladesh. Stored as the number rather than the label because
  -- `deadlines.ts` already speaks in start years and a stored label would be
  -- a second spelling of the same fact.
  fiscal_year    integer not null,

  -- The acknowledgement, when there is one. Nullable: a return can be recorded
  -- as filed before the receipt is to hand, and refusing the row until the PDF
  -- arrives is how the record never gets made at all.
  file_id        uuid references files (id) on delete set null,

  -- The day it was submitted, if anybody noted it.
  submitted_on   date,
  notes          varchar(300),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references users (id),
  updated_by     uuid references users (id),

  deleted_at     timestamptz,
  deleted_by     uuid references users (id),
  delete_reason  text
);

create index if not exists team_ereturns_member_idx
  on team_ereturns (team_member_id, fiscal_year);

comment on table team_ereturns is
  'One income-tax e-Return per person per fiscal year. fiscal_year holds the '
  'year the year STARTS in: 2026 is 2026-2027, July to June.';

alter table team_ereturns
  drop constraint if exists team_ereturns_year_sane;
alter table team_ereturns
  add constraint team_ereturns_year_sane
  check (fiscal_year between 2000 and 2200);

commit;

-- One per year, per person, and PARTIAL.
--
-- `where deleted_at is null` is the whole point. A non-partial unique index
-- over soft-deleted rows cost this repo a silent data bug on 1 Sep 2026: the
-- trashed row kept occupying its key, an insert took the ON CONFLICT branch,
-- the figure was written INTO the trashed row, and the request answered 200
-- while the screen showed nothing. Partial, a deleted return gets out of the
-- way of the one replacing it.
do $$
begin
  if not exists (
    select 1 from pg_class where relname = 'team_ereturns_one_per_year'
  ) then
    create unique index team_ereturns_one_per_year
      on team_ereturns (team_member_id, fiscal_year)
      where deleted_at is null;
  end if;
end $$;

-- What this file did, in figures.
select
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'file_kind' and e.enumlabel = 'e_return')  as kind_added,
  (select count(*) from information_schema.tables
    where table_name = 'team_ereturns')                          as table_created,
  (select count(*) from pg_class
    where relname = 'team_ereturns_one_per_year')                as unique_index,
  (select count(*) from team_ereturns)                           as rows_now;
