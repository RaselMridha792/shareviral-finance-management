-- HR requests can go to the trash (the owner, 6 Nov 2026: "HR request page
-- tate sobkichui select, delete jeno kora jay"). The four tables a request
-- lives in get the soft-delete columns every deletable table has.
--
-- Only a decided request may go (the owner's choice): approved, rejected or
-- withdrawn, and a spend once paid. That rule, and the rule that one never
-- leaves the trash for good, live in the trash registry, not here.
--
-- RUN THIS BEFORE THE CODE that reads them: Drizzle names every column in its
-- SELECT, so code that knows `deleted_at` on these tables fails every query
-- against a table without it.
--
-- Defined here and nowhere else; IF NOT EXISTS, so a second run changes
-- nothing.
alter table compensation_requests
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table payroll_one_offs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table hr_budget_periods
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;

alter table hr_budget_spends
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists delete_reason text;
