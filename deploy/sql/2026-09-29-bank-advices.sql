-- Bank advices: the payment file the company uploads to its bank (SCB S2B).
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-29-bank-advices.sql
--
-- RUN THIS BEFORE THE CODE. The trash counts every kind it knows on every
-- visit to Settings -> Trashed, and the code that follows adds bank advices
-- to that list -- without the tables the whole trash screen fails.
--
-- WHY. The owner, 29 Sep 2026: "amake every month bank a ekta excel sheet
-- submit korte hoy jeta manually banano onek problem ... etay sobgula excel
-- sundor vabe table a list kora thakbe edit delete update kora jabe. eta
-- mainly generate hobe payroll theke". The bank's own instructions ("Preparing
-- Excel File", Standard Chartered's S2B bulk format) ask for one row per
-- payment across 44 columns, an H row above them and a T row below, saved as
-- CSV -- typed by hand every month, for every salary.
--
-- WHAT IT HOLDS. `bank_advices`: one file -- the account the money leaves
-- (as the file writes it: two zeros, then the account number), the value
-- date, and the payroll month it was built from, if it was. Downloading the
-- CSV stamps `downloaded_at` / `downloaded_by`, so the list says which files
-- have gone to the bank. `bank_advice_lines`: one payment each -- the payment
-- type (ACH = BEFTN, BT = SCB to SCB, RTGS, PAY = payroll), who, their bank
-- code (SCBLBDDXXXX for an SCB account, else two zeros and the routing
-- number), their account number, what for, the amount, and an email for the
-- bank's confirmation. The team member and the payroll line it came from are
-- kept, set null if either goes.
--
-- A line's bank code and account number may be empty: a person on the sheet
-- with no bank details on file is still a line to fill in, not one to drop.
-- The file is refused for download while any line is incomplete.
--
-- Not a ledger entry. Paying the salary sheet is still what moves money in
-- the books; this is the instruction the bank reads.
--
-- NOTHING IS REWRITTEN. Two new tables, empty, and their indexes.
begin;

create table if not exists bank_advices (
  id               uuid primary key default gen_random_uuid(),
  title            varchar(160) not null,
  payroll_run_id   uuid references payroll_runs(id) on delete set null,
  account_id       uuid references accounts(id) on delete set null,
  debit_account_no varchar(24) not null default '',
  debit_city_code  varchar(8) not null default 'DHK',
  value_date       date not null,
  note             text,
  downloaded_at    timestamptz,
  downloaded_by    uuid,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid,
  delete_reason    text
);

create index if not exists bank_advices_created_idx
  on bank_advices (created_at desc)
  where deleted_at is null;
create index if not exists bank_advices_run_idx
  on bank_advices (payroll_run_id);

create table if not exists bank_advice_lines (
  id               uuid primary key default gen_random_uuid(),
  bank_advice_id   uuid not null references bank_advices(id) on delete cascade,
  position         integer not null default 0,
  payment_type     varchar(4) not null default 'PAY',
  beneficiary_name varchar(140) not null,
  bank_code        varchar(20) not null default '',
  account_no       varchar(34) not null default '',
  payment_details  varchar(140) not null default '',
  currency         varchar(3) not null default 'BDT',
  amount           numeric(14, 2) not null,
  email            varchar(254),
  team_member_id   uuid references team_members(id) on delete set null,
  payroll_line_id  uuid references payroll_lines(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bank_advice_lines_type_check
    check (payment_type in ('ACH', 'BT', 'RTGS', 'PAY')),
  constraint bank_advice_lines_amount_check check (amount >= 0),
  constraint bank_advice_lines_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index if not exists bank_advice_lines_advice_idx
  on bank_advice_lines (bank_advice_id, position);

comment on table bank_advices is
  'A payment file for the bank (SCB S2B bulk CSV): the debit account, the '
  'value date, and the payroll month it came from. Not a ledger entry.';
comment on table bank_advice_lines is
  'One payment in a bank advice: type, beneficiary, bank code, account, '
  'details, amount, email. Empty bank code or account = not ready to download.';

commit;
