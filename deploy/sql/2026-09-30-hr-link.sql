-- What the HR portal sends to finance: budgets, spends against them, and
-- one-off amounts for a month's salary sheet.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-30-hr-link.sql
--
-- RUN THIS BEFORE THE CODE. The routes that follow read and write these
-- tables by name; without them the HR Budget page and the HR portal's sends
-- fail, and the salary sheet's Build list reads payroll_one_offs.
--
-- WHY. The owner, 30 Sep 2026: "hr theke jokhon budget dibe kono kichur oita
-- finance a request jabe er jonne hr budet name finance a ekta new page o
-- banate hobe and properly sob information manage korte hobe" -- and, asked,
-- that both a budget and each spend against it come over, that finance
-- approves, pays and records them, and that a bonus is its own flow: a bonus
-- sent through the compensation route becomes the person's salary every
-- month after, which is why it gets a table of its own here.
--
-- THE KEY. Every row carries the HR portal's own id (`external_id`), unique.
-- The two apps share no transaction, so a send may arrive twice; the second
-- AMENDS the row while finance has not acted on it, and is refused once it
-- has. That is what makes a repeat safe.
--
-- A spend names its budget by the budget's HR id and has NO foreign key to
-- it: a spend may arrive before its budget does (HR records the two
-- independently), and it links itself when the budget arrives. A refused
-- budget refuses nothing under it -- each spend is decided on its own.
--
-- A one-off is added to the person's bonus on that month's sheet: when the
-- sheet is built, or at once if a draft sheet already has them.
-- `applied_amount` is what it put there, so amending it moves the sheet by
-- the difference. `payroll_line_id` is set null if the line goes (the person
-- taken off the sheet, or the list rebuilt), which puts it back to waiting.
--
-- Nothing here is a ledger entry until finance pays a spend: that writes an
-- ordinary expense, and `transaction_id` points at it.
--
-- NOTHING IS REWRITTEN. Three new tables, empty, and their indexes.
begin;

create table if not exists hr_budget_periods (
  id               uuid primary key default gen_random_uuid(),
  external_id      uuid not null,
  category_name    varchar(120) not null,
  starts_on        date not null,
  ends_on          date not null,
  amount           numeric(14, 2) not null,
  note             text,
  recorded_by_name varchar(120) not null,
  status           varchar(10) not null default 'received',
  status_note      text,
  decided_by       uuid,
  decided_at       timestamptz,
  send_count       integer not null default 1,
  received_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint hr_budget_periods_external_key unique (external_id),
  constraint hr_budget_periods_status_check
    check (status in ('received', 'approved', 'refused')),
  constraint hr_budget_periods_dates_check check (ends_on >= starts_on),
  constraint hr_budget_periods_amount_check check (amount > 0),
  constraint hr_budget_periods_decided_check
    check ((status = 'received') = (decided_at is null))
);

create index if not exists hr_budget_periods_received_idx
  on hr_budget_periods (received_at desc);

create table if not exists hr_budget_spends (
  id                  uuid primary key default gen_random_uuid(),
  external_id         uuid not null,
  budget_external_id  uuid not null,
  spent_on            date not null,
  amount              numeric(14, 2) not null,
  purpose             varchar(500) not null,
  team_member_id      uuid references team_members(id) on delete set null,
  employee_name       varchar(120),
  hr_status           varchar(10) not null,
  hr_approved_by_name varchar(120),
  hr_approved_at      timestamptz,
  recorded_by_name    varchar(120) not null,
  has_receipt         boolean not null default false,
  status              varchar(10) not null default 'received',
  status_note         text,
  decided_by          uuid,
  decided_at          timestamptz,
  paid_on             date,
  transaction_id      uuid references transactions(id) on delete set null,
  send_count          integer not null default 1,
  received_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint hr_budget_spends_external_key unique (external_id),
  constraint hr_budget_spends_status_check
    check (status in ('received', 'approved', 'refused', 'paid')),
  constraint hr_budget_spends_hr_status_check
    check (hr_status in ('proposed', 'approved')),
  -- HR's own decision is one fact: both halves, or neither -- and an
  -- approved spend carries both. The same rule the HR portal's CHECK holds.
  constraint hr_budget_spends_hr_approval_check
    check ((hr_approved_by_name is null) = (hr_approved_at is null)
           and (hr_status = 'proposed' or hr_approved_at is not null)),
  constraint hr_budget_spends_amount_check check (amount > 0),
  constraint hr_budget_spends_paid_check
    check ((status = 'paid') = (paid_on is not null))
);

create index if not exists hr_budget_spends_budget_idx
  on hr_budget_spends (budget_external_id);
create index if not exists hr_budget_spends_received_idx
  on hr_budget_spends (received_at desc);

create table if not exists payroll_one_offs (
  id              uuid primary key default gen_random_uuid(),
  external_id     uuid not null,
  team_member_id  uuid not null references team_members(id) on delete cascade,
  period_year     integer not null,
  period_month    integer not null,
  amount          numeric(14, 2) not null,
  note            varchar(200),
  payroll_line_id uuid references payroll_lines(id) on delete set null,
  applied_amount  numeric(14, 2),
  send_count      integer not null default 1,
  received_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint payroll_one_offs_external_key unique (external_id),
  constraint payroll_one_offs_month_check
    check (period_month between 1 and 12 and period_year between 2000 and 2100),
  constraint payroll_one_offs_amount_check check (amount > 0),
  constraint payroll_one_offs_applied_check
    check ((payroll_line_id is null) or (applied_amount is not null))
);

create index if not exists payroll_one_offs_month_idx
  on payroll_one_offs (period_year, period_month, team_member_id);
create index if not exists payroll_one_offs_line_idx
  on payroll_one_offs (payroll_line_id);

comment on table hr_budget_periods is
  'Budgets sent by the HR portal (category, period, amount), keyed on its id. '
  'Finance approves or refuses; a repeat send amends while received.';
comment on table hr_budget_spends is
  'Spends sent by the HR portal against a budget (by the budget''s HR id, no '
  'FK: it may arrive first). Finance approves, refuses, pays; paying writes an '
  'expense and transaction_id points at it.';
comment on table payroll_one_offs is
  'One-off amounts (bonuses) sent by the HR portal for a month''s salary '
  'sheet, added to the person''s bonus there. Never compensation_history.';

commit;
