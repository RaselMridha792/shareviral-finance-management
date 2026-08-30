-- An opening balance stated in the account's own currency.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-08-30-account-opening-own-currency.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment `accounts.opening_balance_usd` is in the projection and missing from
-- the database, the whole accounts query dies and the site goes with it.
--
-- WHY. Every amount this app stores is BDT, including a dollar account's, and a
-- USD-primary account's dollars have been shown by dividing its taka balance by
-- one rate. That only reads back correctly while the rate never moves: $14,000
-- put in at 118.00 stores 16,52,000.00, and today's governing rate of 122.50
-- reads it back as $13,485.71. The money is right and the figure is wrong, and
-- the owner has been watching the dollars shrink.
--
-- The fix is to add the dollars up instead of dividing the taka, and that needs
-- one figure the schema has never had: what the account HELD in its own
-- currency on the day it opened. Every movement since already carries its own
-- dollar figure in transactions.original_amount.
--
-- NOTHING IS REWRITTEN. One nullable column is added. `opening_balance` keeps
-- its value and its meaning, every transaction row is untouched, and an account
-- with no figure here simply reports its own-currency balance as approximate
-- rather than exact — which is the honest answer, not a broken one.
--
-- The one backfill is exact rather than converted: an account that opened at
-- zero taka opened at zero dollars, at any rate that has ever existed. It is
-- written `where opening_balance = 0 and opening_balance_usd is null` so a
-- re-run cannot overwrite a figure somebody has since typed.
begin;

alter table accounts
  add column if not exists opening_balance_usd numeric(14, 2);

comment on column accounts.opening_balance_usd is
  'What the account held in its own currency on opening_balance_on. Null when '
  'nobody has stated it; only meaningful when currency <> ''BDT''.';

update accounts
   set opening_balance_usd = 0
 where opening_balance = 0
   and opening_balance_usd is null;

commit;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'accounts' and column_name = 'opening_balance_usd') = 1
    as column_added,
  (select count(*) from accounts where opening_balance_usd is not null)
    as accounts_with_own_opening,
  (select count(*) from accounts where currency <> 'BDT' and opening_balance_usd is null)
    as foreign_accounts_still_unstated;
