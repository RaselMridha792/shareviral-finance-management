-- A subscription's charge: what the card adds on top of the plan's price.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-subscription-charge.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- subscriptions query dies outright against a database without this one — not
-- the new field failing, the whole AI tools screen.
--
-- WHY. The owner:
--
--   *"Ai tools and subscription er eikhane tumi charge name akta field rakhba
--    jeta actual price er sathe add hobe calculation er somoy."*
--
-- A plan priced at $100 does not cost ৳12,277. The card adds its own charge on
-- the way — a conversion fee, a bank charge — and the figure that leaves the
-- account is the two together. Until now the app knew only the first, so every
-- total it stated for a foreign plan was short by an amount nobody had a place
-- to record.
--
-- IN TAKA, and named so. `cost_usd` is the price the vendor charges, `cost_bdt`
-- is that price converted at `usd_rate`. A card charge is not part of the
-- vendor's price and is not converted from it — it is levied here, in taka, by
-- the bank. Adding it to `cost_usd` would silently change what the plan is
-- said to cost the moment somebody re-derives the rate from the two, which is
-- exactly what `deriveCosts` in packages/shared does.
--
-- NULLABLE, like `cost_bdt` beside it. "No charge has been stated" and "the
-- charge is zero" are the same thing arithmetically and different things on a
-- form: a plan nobody has recorded a charge for should show an empty box, not
-- a confident 0.00. Every read treats null as nothing.
--
-- NOTHING IS REWRITTEN. One nullable column. Every existing plan reads null,
-- which is what was true of all of them — no row is read, moved or changed,
-- and no total this app has already stated moves by a taka until somebody
-- types a charge into a plan.
begin;

alter table subscriptions
  add column if not exists charge_bdt numeric(14, 2);

commit;

-- What this file did, in figures. `plans_with_charge` must be 0 immediately
-- after this runs; anything else means the column already existed with data.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'subscriptions' and column_name = 'charge_bdt')
    as column_added,
  (select count(*)::int from subscriptions where deleted_at is null)
    as plans_untouched,
  (select count(*)::int from subscriptions where charge_bdt is not null)
    as plans_with_charge;
