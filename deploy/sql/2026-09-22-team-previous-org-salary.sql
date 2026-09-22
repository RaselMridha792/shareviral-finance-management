-- What they were paid before they came here, carried over from the HR app.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-22-team-previous-org-salary.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment this one is in the projection and missing from the database, the
-- whole team query dies and the directory and the salary sheet go with it.
--
-- WHY. The HR app (a separate repository, hrm.hellonizam.com) collects a
-- joiner's previous employer and what they were paid there. Its owner asked
-- on 22 Sep 2026 for that figure to reach this app as well -- DISPLAY ONLY.
-- Nothing here reads it, no payroll arithmetic touches it, and nobody is paid
-- a taka differently because of it. It is context for whoever is looking at
-- the person: the one number that says whether the offer was a step up.
--
-- It is not pay. `joining_salary` is what THIS company agreed; this is what
-- SOMEBODY ELSE paid, and the two must never be added, compared by any code,
-- or fall into the same column. That is the whole reason it is a column of
-- its own rather than a note.
--
-- WHO WRITES IT. The HR app, through POST/PATCH /api/team-members, and only
-- ever with a figure it holds. It never sends a blank over something already
-- here. A person can also type it in the drawer.
--
-- SCOPE. The owner approved exactly this and nothing else in this repository:
-- one nullable column, one field on the create and update schemas, and one
-- row on the person's page. Every push here deploys, so the scope is worth
-- honouring literally.
--
-- NOTHING IS REWRITTEN. One nullable column; every existing row is
-- legitimately null and no backfill is possible -- this app has never held
-- the figure and has nowhere to derive it from.
begin;

alter table team_members
  add column if not exists previous_org_salary numeric(14, 2);

comment on column team_members.previous_org_salary is
  'What they were paid by their previous employer, as recorded in the HR app. '
  'DISPLAY ONLY: no payroll arithmetic reads it. Not to be confused with '
  'joining_salary, which is what this company agreed to pay.';

commit;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'team_members'
      and column_name = 'previous_org_salary')              as column_added,
  (select count(*) from team_members)                       as people_total,
  (select count(*) from team_members where previous_org_salary is not null)
    as people_with_a_previous_figure;
