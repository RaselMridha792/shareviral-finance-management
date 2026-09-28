-- Saved invoices: the Invoice Builder's documents, kept rather than only drawn.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-29-invoices.sql
--
-- RUN THIS BEFORE THE CODE. The trash counts every kind it knows on every
-- visit to Settings -> Trashed, and the code that follows adds invoices to
-- that list -- without the table the whole trash screen fails, not just the
-- invoices.
--
-- WHY. The owner, 29 Sep 2026: "All invoice a table format a invoice gula
-- save thakbe. okhan theke view kora jabe, edit kora jabe, delete kora jabe".
-- Until now the builder kept one draft in the browser and nothing else; an
-- invoice that had been sent existed only as the PDF somebody downloaded.
--
-- WHAT IT HOLDS. One row per invoice. `document` is the builder's whole
-- state -- every box on the form, the lines, the items, the colours, the
-- logo -- so opening it again gives back exactly what was saved. The columns
-- beside it are read out of that document when it is saved, for the list to
-- search, sort and show without unpacking it: the number, the status, who it
-- is to, the dates, and the total (worked out on the server in paisa from the
-- items, never taken from the browser).
--
-- An invoice is NOT a ledger entry. Saving one moves no money and touches no
-- balance; it is a document the company sent.
--
-- The number is unique among live invoices (case-insensitive), so a trashed
-- invoice's number can be used again -- and restoring that one is refused
-- while the number is taken (see trash.service.ts).
--
-- NOTHING IS REWRITTEN. A new table, empty, and two indexes.
begin;

create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number varchar(60) not null,
  status         varchar(12) not null default 'DRAFT',
  client_name    varchar(300),
  issued_on      date,
  due_on         date,
  total_amount   numeric(14, 2) not null default 0,
  usd_rate       numeric(18, 6),
  document       jsonb not null,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  delete_reason  text,
  constraint invoices_status_check
    check (status in ('SENT', 'PAID', 'UNPAID', 'DRAFT', 'OVERDUE'))
);

create unique index if not exists invoices_number_live_idx
  on invoices (lower(invoice_number))
  where deleted_at is null;

create index if not exists invoices_issued_idx
  on invoices (issued_on desc, created_at desc)
  where deleted_at is null;

comment on table invoices is
  'Invoices drawn in the Invoice Builder. document is the builder''s whole '
  'state; the other columns are read from it on save for the list. Not a '
  'ledger entry: saving one moves no money.';

commit;
