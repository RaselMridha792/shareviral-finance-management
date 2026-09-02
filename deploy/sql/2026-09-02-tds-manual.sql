-- A payroll line remembers whether its tax was typed or worked out.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-tds-manual.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- sheet's query dies outright against a database without this one — not the
-- edit failing, the whole salary sheet.
--
-- WHY. The owner wants both halves at once:
--
--   *"etato auto fill hobe eksathe ami duita feature cai. mane auto calculate
--    hoye tds bosbe ami caile karota edit o korte parbo."*
--
-- The tax has been an output since the app started calculating it, and
-- `updatePayrollLineSchema` refused `tdsAmount` on purpose — its comment reads
-- "a screen that let somebody type over it would make the stored working a
-- lie". That objection is right and it is not an objection to what he asked
-- for; it is an objection to typing over a figure while still claiming a rule
-- produced it. This column is what lets both be true. A typed figure is
-- marked as typed, so:
--
--   * the recompute that fires when the gross, the working days or the
--     declared investment change LEAVES a typed figure alone instead of
--     silently overwriting what he just entered — which is the failure that
--     would have made the feature look broken rather than absent;
--   * the sheet and the working drawer can say which of the two a figure is;
--   * "Work out the tax again" still clears the lot and recomputes, so there
--     is one deliberate way back to the rule.
--
-- NOT `tds_basis = null`. That column already means "no rule produced this",
-- which is also true of a line from a year with no tax rule configured — and
-- those must still start computing the day a rule is set up. One column
-- carrying two different reasons for the same null is how the recompute would
-- skip the wrong lines.
--
-- NOTHING IS REWRITTEN. One boolean with a default, so every existing line
-- reads false: every figure on the books today was worked out by the app,
-- which is exactly what false says. No row is read, moved or changed.
begin;

alter table payroll_lines
  add column if not exists tds_manual boolean not null default false;

commit;

-- What this file did, in figures. `typed_so_far` must be 0 immediately after
-- this runs; anything else means the column already existed and carried data.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'tds_manual')
    as column_added,
  (select count(*)::int from payroll_lines)                as lines_untouched,
  (select count(*)::int from payroll_lines where tds_manual) as typed_so_far;
