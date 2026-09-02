-- The subscription charge is in dollars, not taka.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-subscription-charge-usd.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- subscriptions query dies outright against a database without this one — not
-- the new field failing, the whole AI tools screen.
--
-- WHY. `charge_bdt` shipped this afternoon on the reading that a card charge is
-- levied here, in taka. The owner corrected it looking at the form:
-- *"ekhane charge usd te hobe"*. It is part of what the vendor bills, so it
-- belongs beside `cost_usd` and converts at the plan's own `usd_rate` like the
-- price does.
--
-- ADDED, NOT RENAMED, and that distinction is the whole care in this file. A
-- rename would break the image that is still serving while the new one builds:
-- the old code selects `charge_bdt` by name, and a column that has just been
-- renamed out from under it takes every subscription query down with it. Two
-- columns for one minute is cheap; a dead screen is not.
--
-- THE OLD VALUES COME ACROSS. Any plan that already carries a taka charge gets
-- the dollar equivalent at its own stored rate, so nothing somebody typed is
-- lost and nothing is re-valued at a rate it never had. A plan with a taka
-- charge and no rate cannot be converted — it keeps its taka figure in the old
-- column and gets a null here, which the count at the foot reports rather than
-- rounds away. There should be none of those; the report is what proves it.
--
-- `charge_bdt` IS LEFT IN PLACE, holding whatever it held. It stops being read
-- and stops being written. Dropping a column that still has values in it is a
-- separate decision on a separate day, and this file does not make it.
--
-- NOTHING IS REWRITTEN. One nullable column, filled only where there was
-- already a charge to carry. No price, no rate and no taka figure moves.
begin;

alter table subscriptions
  add column if not exists charge_usd numeric(14, 2);

update subscriptions
   set charge_usd = round(charge_bdt / usd_rate, 2)
 where charge_bdt is not null
   and charge_bdt > 0
   and usd_rate is not null
   and usd_rate > 0
   and charge_usd is null;

commit;

-- What this file did, in figures. `stranded` must be 0: a taka charge that
-- could not be converted because its plan carries no rate.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'subscriptions' and column_name = 'charge_usd')
    as column_added,
  (select count(*)::int from subscriptions where charge_usd is not null)
    as carried_over,
  (select count(*)::int from subscriptions
    where charge_bdt is not null and charge_bdt > 0 and charge_usd is null)
    as stranded,
  (select count(*)::int from subscriptions where deleted_at is null)
    as plans_untouched;
