-- Which reading of the salary exemption a year uses.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-exemption-mode.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- One column on `tax_policies`. Drizzle names every column in its SELECT, so
-- without it every read of the tax rule fails — the Settings tax panel, the
-- calculator, and every payroll run that works out a deduction.
--
-- ------------------------------------------------------------------------
-- Why it exists
-- ------------------------------------------------------------------------
-- The exemption has been "a fraction of the salary, or a cap, whichever is
-- lower" — one rule with two halves, and no way to run either half alone.
--
-- The Finance Act rewords this most years, and the owner wants to be able to
-- follow whichever wording the year actually has rather than wait for a code
-- change. So: 'lower', 'fraction' or 'cap'.
--
-- Text and not an enum, deliberately. A fourth reading should cost a row edit
-- and not a type migration on a table with one row per income year. The
-- application validates the value; the column only has to hold it.
--
-- Defaulted to 'lower', which is what every existing row already behaves as —
-- so applying this changes nobody's tax by a single paisa.
--
-- Safe to run twice.

begin;

alter table tax_policies
  add column if not exists exemption_mode text not null default 'lower';

commit;

-- The column, and that no year's figures moved.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'tax_policies' and column_name = 'exemption_mode') as column_exists,
  (select count(*) = 0 from tax_policies
    where exemption_mode not in ('lower', 'fraction', 'cap')) as values_valid,
  (select count(*) from tax_policies where exemption_mode <> 'lower') as changed_years;
