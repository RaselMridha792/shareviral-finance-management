-- transactions.invoice_no — the company's own document number.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-18-invoice-no.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE THAT USES IT. Really, this time.
-- ------------------------------------------------------------------------
-- Every other file in this directory says the same thing, but this one adds a
-- column to `transactions` rather than a new table, and that changes what
-- happens if the order is wrong.
--
-- Drizzle names every column in its SELECT. The transactions projection now
-- lists `invoice_no`, so against a database without it *every read of the
-- ledger* fails — the register, the dashboard, the exports, all of it. Not the
-- new field failing: the whole table.
--
-- And it fails as a bare `500 Internal server error`, because the exception
-- filter has one branch for Zod errors and one for HttpException, and a
-- Postgres driver error is neither. So the symptom is "the app is down" with
-- nothing in the response saying why.
--
-- ------------------------------------------------------------------------
-- Why a second reference column at all
-- ------------------------------------------------------------------------
-- `reference` already exists and holds the bank's: a wire reference off the
-- remittance advice, `FT26081200412`, or a cheque number. This one holds ours
-- — `INV-002`, `SAL-JUL`, `TOOL-JUL`, the number on the paper the money was
-- against.
--
-- They are two different facts about one payment and the sheets being replaced
-- carry both in separate columns. A single field would hold whichever was
-- typed first and lose the other on exactly the rows where somebody asks for
-- both.
--
-- Nullable, with no default and no backfill. Rows recorded before today
-- genuinely have no invoice number, and inventing one would be worse than the
-- blank: a blank says "not recorded", a made-up value says "this is the
-- number".
--
-- Safe to run twice.

begin;

alter table transactions
  add column if not exists invoice_no varchar(60);

-- Searched from the transactions filter alongside `reference`, so it wants the
-- same treatment. Partial, because most rows will not have one and there is no
-- point indexing a column of NULLs.
create index if not exists transactions_invoice_no_idx
  on transactions (invoice_no)
  where invoice_no is not null;

commit;

-- Should come back: exists = t, type = character varying, max length = 60,
-- nullable = YES, and the index present.
select
  (select count(*) = 1
     from information_schema.columns
    where table_name = 'transactions' and column_name = 'invoice_no') as exists,
  (select data_type from information_schema.columns
    where table_name = 'transactions' and column_name = 'invoice_no') as type,
  (select character_maximum_length from information_schema.columns
    where table_name = 'transactions' and column_name = 'invoice_no') as max_length,
  (select is_nullable from information_schema.columns
    where table_name = 'transactions' and column_name = 'invoice_no') as nullable,
  (select count(*) = 1 from pg_indexes
    where tablename = 'transactions'
      and indexname = 'transactions_invoice_no_idx') as index_present;
