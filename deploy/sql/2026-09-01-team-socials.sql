-- A team member's social accounts — as many as they have.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-01-team-socials.sql
--
-- RUN THIS BEFORE THE CODE, AND ON ITS OWN.
--
-- WHY A TABLE AND NOT A jsonb COLUMN. Both shapes are already in this schema
-- and they are used for different things: jsonb where a value is a SNAPSHOT
-- frozen when it was written and read back whole (compensation_history
-- .components, payroll_lines.tds_basis), a table where it is a LIST SOMEBODY
-- EDITS over time (compensation_history itself, subscription_users). A person's
-- social accounts are the second kind.
--
-- The decisive argument is operational rather than aesthetic. A jsonb column on
-- `team_members` has to join that service's projection, and Drizzle names every
-- column in its SELECT — so shipping the code before this file has run on the
-- server would kill EVERY team query at once: the directory, the payroll
-- picker, the salary sheet. A separate table cannot do that. The worst it can
-- do is fail its own card, on one screen, with the rest of the profile intact.
--
-- NOTHING IS REWRITTEN. A new table and nothing else. Every existing row, every
-- existing column and every existing query is untouched.
begin;

create table if not exists team_socials (
  id            uuid primary key default gen_random_uuid(),
  team_member_id uuid not null
                 references team_members (id) on delete cascade,

  -- Plain text, not a pgEnum, matching `subscriptions.billing_cycle` and
  -- `vendors.billing_cycle`: the list of platforms will grow, and a pgEnum
  -- means an ALTER TYPE that cannot run in a transaction and has to reach two
  -- databases. The shared package is the one place the list is written down.
  platform      text not null,

  -- What was typed. A handle ("@nizam") or a whole address — both are useful
  -- and people paste whichever they have. The app builds the link from the
  -- platform and this, and shows the raw value when it cannot.
  handle        text not null,

  -- The order they should read in, so a person can put the one that matters
  -- first. Sparse on purpose, like every other sort column here.
  sort_order    integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references users (id),
  updated_by    uuid references users (id),

  deleted_at    timestamptz,
  deleted_by    uuid references users (id),
  delete_reason text
);

create index if not exists team_socials_member_idx
  on team_socials (team_member_id);

comment on table team_socials is
  'One row per social account a team member has. Edited as a list; the whole '
  'list is replaced in one request, so ordering and removal are one act.';

commit;

-- One account per platform per person, and PARTIAL.
--
-- `where deleted_at is null` is not decoration. A non-partial unique index over
-- soft-deleted rows caused a silent data bug in this repo on 1 Sep 2026: a
-- trashed compensation row kept occupying its key, the insert took the ON
-- CONFLICT branch, the figure was written INTO the trashed row, and the screen
-- showed nothing while the request answered 200. Partial, a deleted row gets
-- out of the way of the one replacing it.
--
-- Its own statement so re-running this file is a no-op rather than an error.
do $$
begin
  if not exists (
    select 1 from pg_class where relname = 'team_socials_one_per_platform'
  ) then
    create unique index team_socials_one_per_platform
      on team_socials (team_member_id, platform)
      where deleted_at is null;
  end if;
end $$;

-- What this file did, in figures.
select
  (select count(*) from information_schema.tables
    where table_name = 'team_socials')                       as table_created,
  (select count(*) from pg_class
    where relname = 'team_socials_one_per_platform')         as unique_index,
  (select count(*) from team_socials)                        as rows_now,
  (select count(*) from team_members where deleted_at is null) as people;
