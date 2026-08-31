-- A payroll line carries the rate it is read in dollars at.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-01-payroll-line-fx-rate.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment `fxRate` is in the payroll projection and missing here, the whole
-- payroll query dies and the salary sheet goes with it.
--
-- WHY. The sheet's "FX Rate" column printed the app's ONE governing rate on
-- every row, and "Net Pay (USD)" was that rate applied to the net. The owner is
-- removing that global rate from the app entirely — a single box that silently
-- restates every historical figure the moment somebody edits it — and his
-- instruction for this screen was to type it instead: *"fx rate take edit
-- option dite hobe etake prottekta table a fx rate likhte parbe"*.
--
-- So the rate becomes what every other figure in this app already is: a fact
-- stored on the row, frozen at the moment it was recorded, never recalculated
-- afterwards. `transactions.fx_rate` is the same column with the same
-- precision, for the same reason.
--
-- NULLABLE, AND THAT IS THE POINT. A line with no rate shows no dollar figure,
-- which is the truth: nobody has said what this month was worth in dollars.
-- The alternative — defaulting to today's rate — would invent a number and
-- print it as if somebody had checked it.
--
-- NOTHING IS REWRITTEN. One nullable column. Every existing line is
-- legitimately null: no per-line rate was ever typed, and back-filling the
-- global rate onto historical months would be exactly the silent restatement
-- this change exists to end.
--
-- numeric(18,6) matches `fx_rates.rate` and `transactions.fx_rate`. Six decimal
-- places because a rate is a divisor: at two places, 122.00 vs 122.004 moves a
-- 12,00,000 net by more than 30 dollars.
begin;

alter table payroll_lines
  add column if not exists fx_rate numeric(18, 6);

comment on column payroll_lines.fx_rate is
  'Taka per US dollar for THIS line, typed while the sheet is a draft. Null '
  'means nobody has stated one, and the dollar column stays empty rather than '
  'inventing a figure. Frozen once the run is finalised, like every other '
  'number on the sheet.';

commit;

-- A rate has to be a positive number. Written as a separate statement rather
-- than inline, so re-running this file on a database that already has the
-- constraint is a no-op instead of an error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payroll_lines_fx_rate_positive'
  ) then
    alter table payroll_lines
      add constraint payroll_lines_fx_rate_positive
      check (fx_rate is null or fx_rate > 0);
  end if;
end $$;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'fx_rate')
    as column_added,
  (select count(*) from pg_constraint
    where conname = 'payroll_lines_fx_rate_positive')       as constraint_added,
  (select count(*) from payroll_lines)                      as lines_total,
  (select count(*) from payroll_lines where fx_rate is not null)
    as lines_with_a_rate;
