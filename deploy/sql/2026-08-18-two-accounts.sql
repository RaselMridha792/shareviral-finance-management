-- The two accounts asked for: Master card, and Standard Chartered Bank.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-18-two-accounts.sql
--
-- SQL rather than the screen only because nobody with a browser open was
-- available to type it. There is nothing here the Accounts page could not do;
-- if you would rather add them by hand, do that and skip this file.
--
-- ------------------------------------------------------------------------
-- Ten lakh each, as an OPENING BALANCE. Read that twice.
-- ------------------------------------------------------------------------
-- It is not a transaction, and the difference is the whole point. An opening
-- balance says "the books start here": it belongs to no month, appears in no
-- report as money in, and moves no period's totals. A ledger entry of ten lakh
-- would show up as income on the day it was dated, and would be wrong in every
-- report that month ever appears in.
--
-- These were described as dummy figures, and an opening balance is the one
-- place a wrong number costs nothing to correct. Edit the account and every
-- balance recomputes from it, because a register is its opening figure plus
-- everything that has moved since. Nothing has to be unpicked.
--
-- The date is 1 May 2026, the month the records begin. An opening balance
-- dated later than entries that already exist makes the running balance
-- disagree with itself for every entry before it.
--
-- ------------------------------------------------------------------------
-- Safe to run twice, and it will never overwrite an account that exists.
-- ------------------------------------------------------------------------
-- `on conflict` is not used, deliberately, twice over.
--
-- It could not be used as written anyway: the uniqueness rule here is an
-- expression index over `(coalesce(entity_id, …), lower(name))`, so
-- `on conflict (name)` does not match it and errors out.
--
-- And the behaviour is wrong even if it worked. By the second time anybody
-- runs this, these accounts may hold real money and a real opening balance,
-- and a file that quietly resets that figure to ten lakh is a bad thing to
-- leave in a repository. So: insert when absent, touch nothing when present,
-- and let the verification at the bottom say which happened.

begin;

-- created_by / updated_by want a real person; the super admin is who would
-- have typed this on the screen. Matching on lower(name) because that is what
-- the unique index does — "master card" and "Master card" are one account.
insert into accounts (
  name, type, currency, opening_balance, opening_balance_on,
  bank_name, is_active, created_by, updated_by
)
select
  v.name,
  v.type::account_type,
  'BDT',
  v.opening,
  date '2026-05-01',
  v.bank,
  true,
  actor.id,
  actor.id
from (
  select id from users
   where role = 'super_admin' and deleted_at is null
   order by created_at
   limit 1
) as actor
cross join (values
  ('Master card',             'card', 1000000.00, null::text),
  ('Standard Chartered Bank', 'bank', 1000000.00, 'Standard Chartered Bank')
) as v(name, type, opening, bank)
where not exists (
  select 1 from accounts a where lower(a.name) = lower(v.name)
);

commit;

-- What is there now.
--
-- `entries` should be 0 and `balance` should equal `opening_balance` on a
-- fresh insert. If an account already existed, these will show its real
-- figures instead — which is the point of not overwriting it.
select
  a.name,
  a.type,
  a.opening_balance,
  a.opening_balance_on,
  a.is_active,
  (select count(*) from transactions t where t.account_id = a.id) as entries,
  a.opening_balance
    + coalesce((
        select sum(t.signed_amount)
          from transactions t
         where t.account_id = a.id and t.voided_at is null
      ), 0) as balance
from accounts a
where lower(a.name) in ('master card', 'standard chartered bank')
order by a.name;
