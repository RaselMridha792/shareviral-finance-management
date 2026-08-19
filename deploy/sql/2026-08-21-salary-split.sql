-- How a gross salary divides, as a rule rather than four numbers in code.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-salary-split.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- One column on `app_settings`. Drizzle names every column in its SELECT, and
-- `app_settings` is read on nearly every page — so against a database without
-- it, the whole settings query fails and the app has no company name, no number
-- format and no exchange rate. Not one missing field: every screen.
--
-- ------------------------------------------------------------------------
-- What it holds
-- ------------------------------------------------------------------------
-- The owner's own convention, off a handwritten sheet: a one lakh salary is
-- Basic 60,000, House Rent 30,000, Conveyance 6,000, Medical 4,000.
--
-- Percentages and not amounts, because that is what makes it a rule instead of
-- one person's figures. A list of `{label, percent}` and not four columns, for
-- the same reason `payroll_lines.earnings_breakdown` is a list: the next
-- allowance somebody invents should cost a label, not a migration.
--
-- Nullable, and null means the shared default rather than "no split". A company
-- that has never opened this setting still gets a payslip with a proper
-- breakdown, which is the behaviour anybody would expect on day one.
--
-- Not seeded here on purpose. Writing the default into the row would make it
-- look like somebody chose it, and there would then be no way to tell a
-- deliberate 60/30/6/4 from a column nobody has ever touched.
--
-- Safe to run twice.

begin;

alter table app_settings
  add column if not exists salary_split jsonb;

commit;

-- The column, and whether anybody has set a rule of their own yet.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'app_settings' and column_name = 'salary_split') as column_exists,
  (select salary_split is null from app_settings where id = 1) as using_the_default;
