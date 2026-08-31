-- A subscription's reference — the column the form has been sending to nothing.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-08-31-subscription-reference.sql
--
-- RUN THIS BEFORE THE CODE.
--
-- WHY. This one is a bug report, not a feature. The owner wrote: "error ta fix
-- koro. data update korte gele error dey", and the drawer answered "Could not
-- save that" whenever anything was typed in Invoice No. or Reference.
--
-- The reason: the web DTO declares `invoiceNo` and `reference` on a
-- subscription, the drawer collects both and posts them — and NEITHER COLUMN
-- EXISTS. `createVendorSchema` is a `z.strictObject`, so an unrecognised key
-- does not get ignored; it fails the whole request. Two fields nobody could
-- store were quietly making every edit that touched them impossible, and the
-- message said only that it had not worked.
--
-- Measured, before this file:
--     PATCH /vendors/:id  {"reference":"REF-1"}  -> 400 Unrecognized key: "reference"
--     PATCH /vendors/:id  {"invoiceNo":"Inv"}    -> 400 Unrecognized key: "invoiceNo"
--     PATCH /vendors/:id  {"notes":"..."}        -> 200
--
-- So the fix is split, deliberately:
--
--   REFERENCE gets a column. It is what the bank or the card statement calls
--   the charge, the owner asked for it by name, and a subscription is charged
--   against a statement line like anything else.
--
--   INVOICE NO. does NOT. The owner's instruction on the same day was "Invoice
--   a sudhu upload system thakbe field lagbena" — an invoice is a document, not
--   a number. The bill attaches through `files`, which already handles a
--   subscription's paperwork, and the form has stopped asking for a number. A
--   column added here would be a column nothing ever fills.
--
-- NOTHING IS REWRITTEN. One nullable column.
begin;

alter table vendors
  add column if not exists reference text;

comment on column vendors.reference is
  'What the bank or card statement calls the charge. Theirs, not ours — the '
  'invoice is a document and attaches through files.';

commit;

select
  (select count(*) from information_schema.columns
    where table_name = 'vendors' and column_name = 'reference') = 1 as column_added,
  (select count(*) from vendors) as vendors_total;
