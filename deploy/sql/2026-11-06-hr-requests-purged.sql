-- An HR request removed from the trash for good (the owner, 6 Nov 2026:
-- "trash theke remove korte hobe").
--
-- Removed for good, it leaves the trash and the app with no way back — but
-- its row stays, marked `purged_at`, hidden from everything except the HR
-- portal's status reads. Deleted outright, the HR portal's poll would find a
-- gap, read it as "never sent" and send the request again, to be decided a
-- second time. The trash registry's `purgeHides` is what uses this.
--
-- RUN THIS BEFORE THE CODE that reads it: Drizzle names every column in its
-- SELECT. IF NOT EXISTS, so a second run changes nothing.
alter table compensation_requests
  add column if not exists purged_at timestamptz;
alter table payroll_one_offs
  add column if not exists purged_at timestamptz;
alter table hr_budget_periods
  add column if not exists purged_at timestamptz;
alter table hr_budget_spends
  add column if not exists purged_at timestamptz;
