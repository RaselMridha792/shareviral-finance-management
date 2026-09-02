-- A bank charge is its own ledger row, tied to the entry that incurred it.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-transaction-bank-charge.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- ledger query dies outright against a database without this one — not the new
-- field failing, every money screen in the app.
--
-- WHY. The owner: *"sob dhoroner transaction a ei charge ta rakho. karon bank
-- charge dorkar hoy sob transaction er khetrei."* Asked how it should count,
-- he chose **a separate row under Bank charges** rather than folding it into
-- the amount — so ৳10,000 of rent with a ৳115 charge is ৳10,000 of rent and
-- ৳115 of bank charges, and the account is ৳10,115 lighter. The category
-- already exists; nothing in the books had a way to reach it.
--
-- THE LINK, and why it is not optional. Without one, voiding a payment leaves
-- its charge standing, deleting one leaves an orphan, and nothing can say which
-- charge belonged to which entry. `transfer_group_id` beside it is the
-- precedent: two rows that move together are joined so that `void` and the
-- trash can follow the join. This is the same idea with a direction — the
-- charge points at what it was levied on, and the parent knows nothing about
-- the charge except by being pointed at.
--
-- ON DELETE CASCADE is deliberately NOT used. Every delete in this app is soft:
-- rows carry `deleted_at` and the trash puts them back. A cascade would apply
-- only to a hard delete, which is the purge — and there the charge must go with
-- its parent, which the foreign key then does. Both readings are served.
--
-- NOTHING IS REWRITTEN. One nullable column and an index. Every existing row
-- reads null, which is what was true of all of them: no charge has ever been
-- recorded, so no row is a charge for another. No amount, no balance and no
-- total moves by a taka until somebody types one.
begin;

alter table transactions
  add column if not exists charge_for_id uuid
    references transactions (id);

create index if not exists transactions_charge_for_idx
  on transactions (charge_for_id);

commit;

-- What this file did, in figures. `charges_so_far` must be 0 immediately after
-- this runs; anything else means the column already existed and carried data.
select
  (select count(*)::int from information_schema.columns
    where table_name = 'transactions' and column_name = 'charge_for_id')
    as column_added,
  (select count(*)::int from pg_indexes
    where tablename = 'transactions'
      and indexname = 'transactions_charge_for_idx')                as index_added,
  (select count(*)::int from transactions where charge_for_id is not null)
    as charges_so_far,
  (select count(*)::int from transactions where deleted_at is null)
    as rows_untouched,
  (select count(*)::int from categories
    where slug = 'bank-charges' and deleted_at is null)             as heading_exists;
