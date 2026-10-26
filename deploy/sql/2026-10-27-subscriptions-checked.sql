-- The Check column on AI tools & subscriptions: Checked or Unchecked, set by
-- hand on the plan's form (the owner, 27 Oct 2026: "notun ekta field add korte
-- hobe Check: checked, unchecked ... dropdown hobe ... edit kora jabe new add
-- korar somoy o bosano jabe and table a eta dekhabe").
--
-- The boss's sheet has a Check column on every tool row; this is that, per
-- plan. Every plan already on file starts unchecked, so the owner ticks each
-- one as they check it.
--
-- RUN THIS BEFORE THE CODE that reads it: Drizzle names every column in its
-- SELECT, so code that knows `checked` against a table without it fails every
-- subscription query.
--
-- Defined here and nowhere else; IF NOT EXISTS, so a second run changes
-- nothing.
alter table subscriptions
  add column if not exists checked boolean not null default false;
