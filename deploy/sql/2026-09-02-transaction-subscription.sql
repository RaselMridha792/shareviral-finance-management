-- A ledger row remembers which subscription it paid for.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-transaction-subscription.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment `subscriptionId` is in the transactions projection and missing here,
-- the whole ledger query dies and the site goes with it.
--
-- THE BUG THIS FIXES, and it is mine. The owner: *"expense overview te geleo
-- dekhtechi ai tools and subscription er card a 0 dekhacche ... tar mane eta
-- kothao record hocchena"*.
--
-- Paying for a plan writes an ordinary expense. Whether that expense COUNTS as
-- tooling is decided by `isToolSpend()`, which asks two questions: was it paid
-- to a vendor of a recurring type, or was it settled on a non-taka card. It
-- used to answer yes to the first, because `payForSubscription` stamped
-- `vendorId` onto the row.
--
-- I removed that stamp last week, and I was right to: `transactions.vendor_id`
-- has a foreign key to `vendors`, and what was being written into it was a
-- `subscriptions` id — a different table. The insert could only ever have
-- failed. But removing it left the row with NOTHING tying it to the plan, so a
-- subscription paid from an ordinary taka bank account stopped being tooling
-- and quietly became an operational expense. On the card it reads ৳0.
--
-- The heuristic was always a heuristic. "Paid on the prepaid card" is a guess
-- about intent; "this row paid THAT plan" is a fact, and the fact is what the
-- app should be counting. This column records it.
--
-- ON DELETE SET NULL, deliberately. Deleting a plan must never delete or block
-- the money that left the bank for it — the payment happened, and the ledger is
-- the record of what happened. The row loses its link and keeps its figure.
--
-- NOTHING IS REWRITTEN. One nullable column. Every existing row is legitimately
-- null: no payment recorded before today knows which plan it was for, and there
-- is no honest way to guess — `payForSubscription` wrote the tool's name into
-- the description, and two plans from one vendor produce the same sentence.
begin;

alter table transactions
  add column if not exists subscription_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_subscription_id_fkey'
  ) then
    alter table transactions
      add constraint transactions_subscription_id_fkey
      foreign key (subscription_id) references subscriptions(id)
      on delete set null;
  end if;
end $$;

create index if not exists transactions_subscription_idx
  on transactions (subscription_id)
  where subscription_id is not null;

comment on column transactions.subscription_id is
  'The plan this expense paid for, when it paid for one. What makes a '
  'subscription payment count as tooling a fact rather than a guess about '
  'which card it was on. Null on every row that is not a plan payment.';

commit;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'transactions' and column_name = 'subscription_id')
    as column_added,
  (select count(*) from pg_constraint
    where conname = 'transactions_subscription_id_fkey')     as fk_added,
  (select count(*) from transactions)                        as rows_total,
  (select count(*) from transactions where subscription_id is not null)
    as rows_linked;
