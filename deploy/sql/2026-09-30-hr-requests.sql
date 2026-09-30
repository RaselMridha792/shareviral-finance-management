-- Money moves when finance says it moves (#125).
--
-- The owner, 30 Sep 2026: "jokhon taka poysar kono hisab finance a pathabe
-- ... eigula akhon HRM theke dewa matro sorasori aprove hoye jay. eta kora
-- jabena." A raise sent from the HR portal closed the old salary row and
-- opened the new one at once; the owner watched it land in a month's payroll
-- that nobody in finance had approved.
--
-- Every money request from HR now waits for the CFO or the Super Admin:
-- a pay change, a one-off, a budget, a spend. One vocabulary for all four,
-- stored as the budget tables already store it:
--
--   received   waiting; nobody has decided          (HR reads "pending")
--   held       not yet: a question, a paper         (HR reads "held")
--   approved   agreed; only this writes anything     (HR reads "approved")
--   refused    no, for good; the note says why      (HR reads "rejected")
--   withdrawn  HR took it back while it waited      (HR reads "withdrawn")
--              -- off the waiting list, kept on record, never decided;
--              decided_at is when, decided_by is null (nobody in finance)
--
-- Idempotent throughout. The constraints this file redefines are defined in
-- one earlier file only (2026-09-30-hr-link.sql), inside CREATE TABLE IF NOT
-- EXISTS, so replaying the directory in order cannot put the older rule back.

-- ---- 1. Budgets and spends: `held`, `withdrawn` -------------------------
-- A hold is a decision deferred, not a decision: it records who held it and
-- when (decided_at is set), and it stays in the waiting list.

alter table hr_budget_periods
  drop constraint if exists hr_budget_periods_status_check;
alter table hr_budget_periods
  add constraint hr_budget_periods_status_check
    check (status in ('received', 'approved', 'refused', 'held', 'withdrawn'));

alter table hr_budget_spends
  drop constraint if exists hr_budget_spends_status_check;
alter table hr_budget_spends
  add constraint hr_budget_spends_status_check
    check (status in ('received', 'approved', 'refused', 'held', 'withdrawn', 'paid'));

-- ---- 2. One-offs: a state ------------------------------------------------
-- Until today a one-off went on the salary sheet the moment it arrived.

alter table payroll_one_offs
  add column if not exists status varchar(10) not null default 'received',
  add column if not exists status_note text,
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists applied_at timestamptz,
  add column if not exists before_approvals boolean not null default false;

alter table payroll_one_offs
  drop constraint if exists payroll_one_offs_status_check;
alter table payroll_one_offs
  add constraint payroll_one_offs_status_check
    check (status in ('received', 'approved', 'refused', 'held', 'withdrawn'));

-- What is already on a sheet was applied before approvals existed: approved,
-- with no decider and no note, and marked so. What is not on a sheet yet has
-- moved no money, so it is a real request and waits like one.
update payroll_one_offs
   set status = 'approved',
       applied_at = coalesce(applied_at, updated_at),
       before_approvals = true
 where payroll_line_id is not null
   and status = 'received'
   and decided_at is null;

create index if not exists payroll_one_offs_status_idx
  on payroll_one_offs (status, received_at desc);

-- ---- 3. Pay changes: their own table -------------------------------------
-- A request to change somebody's salary. Only an approval writes the
-- compensation_history row, and `compensation_id` points at it.

create table if not exists compensation_requests (
  id                  uuid primary key default gen_random_uuid(),
  -- The HR portal's own row id. Null only on a row copied in below, which
  -- no HR request ever named.
  external_id         uuid,
  team_member_id      uuid not null references team_members(id) on delete cascade,
  gross_amount        numeric(14, 2) not null,
  effective_from      date not null,
  change_reason       varchar(200),
  -- HR's side: who asked, who approved it in HR and when, and their note.
  hr_note             text,
  requested_by_name   varchar(120),
  hr_approved_by_name varchar(120),
  hr_approved_at      timestamptz,
  status              varchar(10) not null default 'received',
  status_note         text,
  decided_by          uuid,
  decided_at          timestamptz,
  -- When the salary row was written: the money moved.
  applied_at          timestamptz,
  compensation_id     uuid references compensation_history(id) on delete set null,
  before_approvals    boolean not null default false,
  send_count          integer not null default 1,
  received_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint compensation_requests_external_key unique (external_id),
  constraint compensation_requests_status_check
    check (status in ('received', 'approved', 'refused', 'held', 'withdrawn')),
  constraint compensation_requests_amount_check check (gross_amount > 0),
  constraint compensation_requests_origin_check
    check (external_id is not null or before_approvals)
);

create index if not exists compensation_requests_status_idx
  on compensation_requests (status, received_at desc);
create index if not exists compensation_requests_member_idx
  on compensation_requests (team_member_id, effective_from);

-- Pay already set from HR, before this existed. Not moved into `pending` --
-- people have been paid from these, and that would un-pay them on paper --
-- and not called approved by anybody, which would be a lie about a decision
-- nobody made. Approved, no decider, `before_approvals`, and the page says
-- so. A joining salary is not one of them: the owner chose that it goes
-- straight in.
insert into compensation_requests (
  team_member_id, gross_amount, effective_from, change_reason,
  requested_by_name, status, applied_at, compensation_id, before_approvals,
  received_at, updated_at
)
select ch.team_member_id, ch.gross_amount, ch.effective_from,
       left(ch.change_reason, 200), u.full_name, 'approved', ch.created_at,
       ch.id, true, ch.created_at, ch.created_at
  from compensation_history ch
  join users u on u.id = ch.created_by
 where u.role = 'hr'
   and ch.deleted_at is null
   and ch.gross_amount > 0
   and coalesce(ch.change_reason, '') <> 'Set from the salary agreed at joining'
   and not exists (
     select 1 from compensation_requests r where r.compensation_id = ch.id
   );

comment on table compensation_requests is
  'Pay changes sent by the HR portal. Only an approval writes compensation_history (#125).';
