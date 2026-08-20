-- How somebody works: onsite, remote, hybrid or contractual.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-employment-type.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- One column on `team_members`. Drizzle names every column in its SELECT and
-- this table is read by the team list, every profile, payroll and the payslip
-- — so against a database without it, none of those queries return a row. Not
-- a blank column: a dead page.
--
-- ------------------------------------------------------------------------
-- What it holds, and what it is not
-- ------------------------------------------------------------------------
-- `engagement_type` already says whether the salary sheet draws somebody
-- (employee) or whether they bill (contractor), and payroll is built on it.
-- This is the other question — where and on what footing the work happens —
-- which nothing in this app recorded before. The two are kept apart because
-- payroll must not change meaning when HR marks somebody Remote.
--
-- Nullable, and null means nobody has said yet. Defaulting the column to
-- 'onsite' would have written an answer for a hundred and twenty people that
-- no one was asked, and there would then be no way to tell a deliberate Onsite
-- from a column nobody has touched. The screen prints an em dash for null.
--
-- The one backfill below is not a guess. A contractor is engaged
-- contractually; that is the same fact under a second name, not an inference
-- about where they sit. It matters because the Team page's Contractors panel
-- is being removed in favour of this column, and without the backfill the fact
-- that panel carried would leave the screen with nothing to replace it.
--
-- Safe to run twice: the update touches only rows still null, so a value HR
-- sets later is never overwritten by a re-run.

begin;

-- `create type` has no IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employment_type') then
    create type employment_type as enum (
      'onsite', 'remote', 'hybrid', 'contractual'
    );
  end if;
end
$$;

alter table team_members
  add column if not exists employment_type employment_type;

update team_members
   set employment_type = 'contractual'
 where engagement_type = 'contractor'
   and employment_type is null;

commit;

-- The column, and how many people have an answer on file.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'team_members' and column_name = 'employment_type')
      as column_exists,
  (select count(*) from team_members where employment_type is not null)
      as answered,
  (select count(*) from team_members where employment_type is null)
      as not_yet_set;
