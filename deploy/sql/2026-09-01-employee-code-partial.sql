-- A deleted person stops holding on to their employee ID.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-01-employee-code-partial.sql
--
-- THE BUG, in the owner's words: *"kono ekta data upload diye delete korar por
-- abar upload dite gele nicchena..erokom error dekay"* — add somebody, delete
-- them, try to add them again, and the drawer answers **Internal server error**.
--
-- WHY. `team_members_employee_code_idx` is UNIQUE on
-- `(coalesce(entity_id, …), employee_code)` and is NOT partial. Deleting a
-- person is a SOFT delete — the row stays, with `deleted_at` set, which is the
-- whole point: it can be restored from Settings > Trashed and its payslips and
-- ledger entries keep pointing at somebody real. But the row keeps its
-- employee_code too, so the code is still taken, and re-adding the same person
-- collides with a row nobody can see. Postgres raises 23505, nothing catches
-- it, and the browser gets a 500 with no idea what to fix.
--
-- This is the third time this exact shape has bitten: the same non-partial
-- unique index over soft-deleted rows silently swallowed a salary figure on
-- `compensation_history` this week, and `team_socials` was written partial from
-- the start because of it. This is that lesson applied to the table it was
-- learned on.
--
-- SAFE TO DO ON ITS OWN, unlike the compensation one. Nothing writes to
-- `team_members` with an `ON CONFLICT` that names this index — the two
-- `onConflictDoUpdate` calls in `team-members.service.ts` are on
-- `compensation_history` and `team_ereturns`. So making this partial cannot
-- break a save the way narrowing the compensation index would.
--
-- NOTHING IS REWRITTEN. The index is replaced by a narrower one over the same
-- column. No row is touched, no value changes, and every code in use stays
-- unique among the people who are actually here.
--
-- WHAT IT ALLOWS, deliberately: a deleted person and a live person may now hold
-- the same code. That is correct — the code identifies somebody on the payroll,
-- and a deleted row is not on it. If the deleted person is later RESTORED,
-- there would then be two live rows with one code; the restore path does not
-- check for that today, and it is written down in SESSIONS.md beside the same
-- gap on compensation rather than fixed in a migration that travels alone.
begin;

drop index if exists team_members_employee_code_idx;

create unique index if not exists team_members_employee_code_idx
  on team_members (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), employee_code)
  where deleted_at is null;

comment on index team_members_employee_code_idx is
  'One employee code per live person. Partial on deleted_at so a soft-deleted '
  'row does not keep a code nobody can see, which made re-adding a deleted '
  'person fail with a 500.';

commit;

-- What this file did, in figures.
select
  (select count(*) from pg_indexes
    where indexname = 'team_members_employee_code_idx'
      and indexdef ilike '%deleted_at is null%')             as index_is_partial,
  (select count(*) from team_members where deleted_at is null)  as people_live,
  (select count(*) from team_members where deleted_at is not null)
    as people_deleted,
  (select count(*) from team_members
    where deleted_at is not null and employee_code is not null)
    as codes_freed;
