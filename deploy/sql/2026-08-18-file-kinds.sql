-- Two new file kinds: invoice, bank_statement.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-18-file-kinds.sql
--
-- ------------------------------------------------------------------------
-- What breaks if this is not run, and what does not
-- ------------------------------------------------------------------------
-- Milder than the invoice_no column, and worth knowing the difference.
--
-- `file_kind` is an enum TYPE, not a column. Reading files carries on working
-- perfectly — every existing row holds a label the type already has. Only an
-- *upload* of one of the new kinds fails, and it fails at the insert, as a bare
-- 500, because drizzle does no client-side enum checking and the exception
-- filter has no branch for a Postgres driver error.
--
-- So the ordering is still SQL-then-code, but a wrong order breaks two upload
-- buttons rather than the whole ledger.
--
-- ------------------------------------------------------------------------
-- Why `add value` is on its own, outside any transaction
-- ------------------------------------------------------------------------
-- `alter type ... add value` is legal inside a transaction on Postgres 12+,
-- but the new label CANNOT BE USED in the same transaction that added it —
-- Postgres raises `unsafe use of new value`. Nothing here uses the labels, so
-- a transaction would in fact be safe; it is left out anyway, so that this
-- file cannot become the one where somebody adds a backfill below and gets an
-- error that names neither the cause nor the fix.
--
-- `if not exists` makes each statement safe to run twice. It requires the type
-- to exist, which it does — `file_kind` was created with the files table on
-- 16 Aug.
--
-- ------------------------------------------------------------------------
-- Order matters here too, for a quieter reason
-- ------------------------------------------------------------------------
-- Enum sort order is creation order, not alphabetical, and `add value` appends
-- to the end. The TypeScript array puts these two after `receipt` and before
-- `import_source`, so `after 'receipt'` keeps the database agreeing with it.
-- Without that, any `order by` on this column would disagree with the order
-- the labels appear in the app.

alter type file_kind add value if not exists 'invoice' after 'receipt';
alter type file_kind add value if not exists 'bank_statement' after 'invoice';

-- Both should be present, and in the position the TypeScript array has them.
select enumlabel, enumsortorder
  from pg_enum
 where enumtypid = 'file_kind'::regtype
 order by enumsortorder;
