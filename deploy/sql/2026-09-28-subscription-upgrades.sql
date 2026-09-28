-- A plan's upgrades: when, from what, to what, and the payment it took.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-28-subscription-upgrades.sql
--
-- RUN THIS BEFORE THE CODE. Nothing reads the table until the code that
-- follows it ships, but that code names every column in its SELECT and would
-- take the subscriptions register down with it if the table were missing.
--
-- WHY. The owner, 28 Sep 2026: "upgrade plan name ekta option diba and oitar
-- details o add korar option rakhba jate kono existing plan ke upgrade korte
-- pare" -- and in the same message, "akoi month a kono plan duibar renew
-- hobena". Until now an upgrade was done by adding a SECOND plan (Claude Max
-- 5x and Max 20x sit side by side on the live register, the note on one
-- saying it was upgraded from the other), and nothing could tell a renewal
-- payment from any other payment on a plan.
--
-- WHAT IT HOLDS. One row per upgrade: the plan's name and price before and
-- after, the day it took effect, and -- when the vendor charged for the
-- upgrade there and then -- the ledger row that charge became. That last link
-- is what lets "a plan renews once a month" be enforced: every live payment on
-- a plan is a renewal (or its first payment) UNLESS an upgrade row names it.
-- No backfill is needed for that reading to be right -- every payment written
-- before today was one of those two.
--
-- The plan row itself still holds the CURRENT name and price; this is the
-- history, not a second copy of the present.
--
-- NOTHING IS REWRITTEN. A new table, empty, and two indexes.
begin;

create table if not exists subscription_upgrades (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  upgraded_on     date not null,
  from_plan_name  varchar(160) not null,
  to_plan_name    varchar(160) not null,
  from_cost_usd   numeric(14, 2),
  to_cost_usd     numeric(14, 2) not null,
  from_charge_usd numeric(14, 2),
  to_charge_usd   numeric(14, 2),
  usd_rate        numeric(18, 6),
  -- The payment the upgrade took, if the vendor charged for it on the day.
  -- Set null, not cascade: voiding or trashing that row must not erase the
  -- fact that the plan changed.
  transaction_id  uuid references transactions(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

create index if not exists subscription_upgrades_subscription_idx
  on subscription_upgrades (subscription_id, upgraded_on);
create index if not exists subscription_upgrades_transaction_idx
  on subscription_upgrades (transaction_id);

comment on table subscription_upgrades is
  'A plan''s upgrades: the name and price before and after, the day, and the '
  'payment the upgrade took (if any). A payment named here is NOT a renewal '
  'for the once-a-month rule.';

commit;
