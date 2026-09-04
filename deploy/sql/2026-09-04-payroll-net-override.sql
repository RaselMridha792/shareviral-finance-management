-- A payroll line can carry a Net Pay somebody typed, in place of the one the
-- arithmetic produced.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-04-payroll-net-override.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- sheet's query dies outright against a database without this one — not the
-- edit failing, the whole salary sheet.
--
-- WHY. The owner, asked where a typed Net Pay should land:
--
--   *"net pay ta to automatic calculation hobe eta ok but ami cai ami edit kore
--    jodi kichu bosai oitai pore actual hobe. like age net pay dhoro 100 taka
--    ami bosalam 110 taka oi 110 takai db te save hobe and oita dhore
--    calculation hobe."*
--
-- So the typed figure is the figure. Not a hint, not an adjustment folded into
-- another column — what he types is what the person is paid, what the ledger
-- row is written for, and what the payslip says.
--
-- WHY A SECOND COLUMN RATHER THAN A WRITABLE `net_amount`. `net_amount` is
-- `GENERATED ALWAYS AS (gross + bonus + other_additions - tds -
-- other_deductions) STORED`, and Postgres refuses a write to a generated column
-- outright. Making it writable means dropping and recreating it, which on a
-- table holding paid salary history is a destructive change to reach a result
-- an added column reaches safely. The arithmetic figure stays exactly where it
-- is and keeps being computed; this column says "somebody disagreed, and this
-- is what they said".
--
-- It also keeps the disagreement visible. A sheet where the four components no
-- longer sum to the Net is a sheet that has to SAY so, and it can only say so
-- while both figures still exist. Fold the difference into `other_additions`
-- and the row adds up again by putting a number in a column nobody typed.
--
-- HOW IT IS READ. Every reader takes `coalesce(net_amount_override,
-- net_amount)`. That is one expression, in the projection every screen and
-- every export already goes through, so a place that reads the net cannot
-- accidentally read the wrong one of the two.
--
-- NOTHING IS REWRITTEN. One nullable column, no default, no backfill. Every
-- existing line reads null, which means "nobody has disagreed with the
-- arithmetic" — true of every line on the books today. No row is read, moved
-- or changed, and every net already paid stays exactly what it was.
begin;

alter table payroll_lines
  add column if not exists net_amount_override numeric(14, 2);

-- A typed net is a real payment figure, so it obeys the same rule the amount on
-- a ledger row does: more than nothing. A zero net is not somebody being paid
-- nothing, it is somebody having mistyped.
alter table payroll_lines
  drop constraint if exists payroll_lines_net_override_positive;
alter table payroll_lines
  add constraint payroll_lines_net_override_positive
  check (net_amount_override is null or net_amount_override > 0);

commit;

-- What this file did, in figures. `typed_so_far` must be 0 immediately after
-- this runs; anything else means the column already existed and carried data.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'net_amount_override')
    as column_added,
  (select count(*)::int from pg_constraint
    where conname = 'payroll_lines_net_override_positive')
    as constraint_added,
  (select count(*)::int from payroll_lines)                    as lines_untouched,
  (select count(*)::int from payroll_lines
    where net_amount_override is not null)                     as typed_so_far;
