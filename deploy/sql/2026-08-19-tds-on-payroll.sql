-- The tax on a salary sheet becomes a calculation, not a typed figure.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-19-tds-on-payroll.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- Two columns on `payroll_lines`. Drizzle names every column in its SELECT, so
-- against a database without these, every read of the salary sheet fails —
-- not the new fields, the whole query.
--
-- ------------------------------------------------------------------------
-- What each one is for
-- ------------------------------------------------------------------------
-- `tds_basis` is everything the figure beside it was worked out from:
-- `{ fiscalYear, annualSalary, declaredInvestment, exactYear, policy }`.
--
-- The whole policy, not a reference to the row it came from. Tax policy rows
-- are edited in place — that is the point of a rule you can change from
-- Settings — so a reference would mean that setting next year's rates silently
-- rewrote the working behind every payslip already issued. An employee asking
-- in March why February deducted what it did has to get February's answer.
-- It is a snapshot for the same reason the bank details beside it are.
--
-- `annualSalary` is inside it because it is the other half of the sum and
-- because it is a projection, not a fact: twelve times that month's gross,
-- which is what the deduction assumes and what stops being true the moment
-- somebody gets a raise. Storing it is what lets a screen say so.
--
-- Null is a real state: a line from before the app calculated, or a run in an
-- income year nobody has configured a rule for. A run has to be buildable
-- either way, and "no rule set up" is honest where a zero looks deliberate.
--
-- `tds_declared_investment` is only read when the year's rule has
-- `assume_full_investment` switched off. With it on — the company's own
-- deliberate choice, so that somebody who invested nothing still gets the
-- rebate — everybody is treated as having invested the full eligible amount
-- and this is ignored. The column exists so that switching it off leaves
-- somewhere to put the real figure, rather than a switch that cannot be used.
--
-- Nothing already stored changes. Existing lines keep whatever tax was typed
-- into them, with a null basis, until somebody edits the gross or presses
-- "Work out the tax again" on a draft.
--
-- Safe to run twice.

begin;

alter table payroll_lines
  add column if not exists tds_basis jsonb,
  add column if not exists tds_declared_investment numeric(14, 2);

commit;

-- Both columns, and a count of the lines still carrying a hand-typed figure.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'tds_basis') as basis,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines'
      and column_name = 'tds_declared_investment') as declared,
  (select count(*) from payroll_lines
    where tds_amount <> 0 and tds_basis is null) as typed_in_before;
