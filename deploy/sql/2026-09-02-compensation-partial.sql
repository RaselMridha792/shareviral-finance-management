-- A trashed salary row stops holding on to its date.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-compensation-partial.sql
--
-- READ THIS BEFORE MOVING IT. **This file and the code that goes with it must
-- ship in ONE deploy.** Every other migration in this directory goes out ahead
-- of its code; this one cannot, and the reason is worth writing down.
--
-- `setCompensation` inserts with `ON CONFLICT (team_member_id, effective_from)`.
-- Postgres infers which index that names, and the inference has to MATCH: a
-- conflict target with no `where` cannot use a partial index, and one with a
-- `where` cannot use a full index. So:
--
--   migration alone  → the index is partial, the old code's target matches
--                      nothing, and EVERY salary save errors.
--   code alone       → the new code's target names a partial index that does
--                      not exist yet, and EVERY salary save errors.
--
-- Together they are fine. The deploy applies this file before the containers
-- swap, so there is a window of seconds where the new index meets the old code
-- and a save in that window fails. That is the cost, it was explained, and the
-- owner chose it deliberately.
--
-- WHY AT ALL, given the bug is already closed. `compensation_effective_idx` is
-- UNIQUE on (team_member_id, effective_from) and is NOT partial, so a row in
-- the trash still occupies its date. That is what let a salary figure be
-- written INTO a trashed row — 200 back, nothing on screen, the person left on
-- their old pay. The code path was fixed by making that conflict un-delete the
-- row it lands on, and it works. This is the second lock: the index itself is
-- what was wrong, and while it stays wrong the fix is one edit away from being
-- undone by somebody who does not know why it is there.
--
-- WHAT CHANGES IN BEHAVIOUR. After this, recording pay on the same date as a
-- TRASHED row no longer collides with it — it inserts a new live row and leaves
-- the trashed one where it is. That is the better answer: the trashed row was
-- thrown away on purpose, and reviving it as a side effect of typing a figure
-- was never something anybody asked for.
--
-- NOTHING IS REWRITTEN. The index is replaced by a narrower one over the same
-- columns. No row is touched. Every date in use stays unique among the rows
-- that are actually there.
begin;

drop index if exists compensation_effective_idx;

create unique index if not exists compensation_effective_idx
  on compensation_history (team_member_id, effective_from)
  where deleted_at is null;

comment on index compensation_effective_idx is
  'One salary figure per person per date, among the rows that are actually '
  'there. Partial on deleted_at so a trashed row does not keep a date nobody '
  'can see. setCompensation''s ON CONFLICT carries a matching WHERE; the two '
  'have to be changed together or every salary save fails.';

commit;

-- What this file did, in figures.
select
  (select count(*) from pg_indexes
    where indexname = 'compensation_effective_idx'
      and indexdef ilike '%deleted_at is null%')             as index_is_partial,
  (select count(*) from compensation_history where deleted_at is null)
    as rows_live,
  (select count(*) from compensation_history where deleted_at is not null)
    as rows_trashed,
  (select count(*) from compensation_history)                as rows_total;
