-- The paid tools, as a thing the app holds rather than a view over the ledger.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-20-subscriptions.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- New tables, so nothing existing breaks without it — but the Subscriptions
-- screen 500s on its first query, which is worse than the screen being absent.
--
-- ------------------------------------------------------------------------
-- Why a table, when there is already a subscriptions view
-- ------------------------------------------------------------------------
-- The screen today derives tools from vendors and the ledger: what was paid,
-- to whom, in a month. That answers "what did we spend" and cannot answer "who
-- is on Clickup", "what plan is this", or "which card renews on the 3rd" —
-- because none of those are facts about a payment.
--
-- A subscription is not a vendor either. Claude is one vendor and nine
-- subscriptions: Pro for seven people, Max 5x, Max 20x, each with its own
-- price, cycle and status.
--
-- The derived view stays. Nothing in this table is summed into a report: a
-- stored "renews on the 3rd" is a habit, not a schedule, and a total built
-- from it would assert spending that may never have happened. What was
-- actually paid still comes from the ledger. `cost_usd` here is the price as
-- billed - context, not a bill.
--
-- ------------------------------------------------------------------------
-- The parts worth explaining
-- ------------------------------------------------------------------------
-- All three of cost_usd / cost_bdt / usd_rate are stored, on the owner's
-- instruction. The argument against the last two is that a dollar price is the
-- fact and taka is a reading of it, which is how the rest of this app works.
-- The argument for is that this company's bills arrive in both and they want
-- both. What is not optional is that the three agree — the form derives
-- whichever was not typed rather than accepting all three. The Cash In sheet
-- already holds a row where all three were typed and one is wrong by ৳27,612,
-- with nothing in the file to say which.
--
-- next_renewal_on is nullable because the sheet has a row reading "Credit
-- Base" where a date belongs. Forcing a date there produces either a wrong one
-- or a lost row; renewal_note carries the reason instead.
--
-- login_email is a label, not a foreign key and not necessarily a person:
-- Github sits under one address and that person is not among its users at all.
-- Who pays and who uses are different questions.
--
-- bought_for is free text — "Engineering Core", "Whole development team".
-- These are not the app's departments, and an enum would force somebody to
-- pick the nearest wrong one.
--
-- The plan screenshot is a file that points *at* the subscription, and the
-- subscription holds no column back. One direction, so the two cannot disagree
-- the first time somebody deletes the file — and files already enforces that a
-- file belongs to exactly one thing, which a second pointer would undermine.
-- The kind is singular, like a profile photo: it is rendered as *the* picture
-- of the plan, and two of them means a screen has to pick.
--
-- subscription_users is a join table because Clickup is one row at $130 for 13
-- seats with twelve people against it. A team_member_id column could have
-- named one of them and would have dropped the rest silently — and "which
-- tools is this person on" would then come back wrong rather than empty, which
-- is the worse way to be wrong. Its own status, because a plan can be
-- perfectly active while one person's access to it was cancelled in July; its
-- own dates, because the request was for every tool somebody has *ever* been
-- on.
--
-- Safe to run twice.

begin;

-- The ten headings the tools sheet already uses, and four states.
-- `canceled` is a decision; `expired` is what happened when nobody renewed.
-- A sheet can blur the two; a screen asked "what did we cancel this quarter"
-- cannot.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_category') then
    create type subscription_category as enum (
      'ai_tool', 'development', 'marketing', 'design', 'hr',
      'productivity', 'management', 'esim', 'server_support', 'finance'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum (
      'active', 'paused', 'canceled', 'expired'
    );
  end if;
end $$;

create table if not exists subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid,

  vendor_id           uuid not null references vendors (id),
  plan_name           varchar(160) not null,

  category            subscription_category not null,
  status              subscription_status not null default 'active',

  cost_usd            numeric(14, 2) not null,
  cost_bdt            numeric(14, 2),
  usd_rate            numeric(18, 6),

  -- Text, matching vendors.billing_cycle, which is also text and constrained
  -- only by the shared BILLING_CYCLES list. An enum on one and not the other
  -- would leave two tables disagreeing about one idea.
  billing_cycle       text not null default 'monthly',

  start_date          date not null,
  next_renewal_on     date,
  renewal_note        varchar(120),

  payment_method      payment_method not null default 'card',
  account_id          uuid references accounts (id) on delete set null,

  bought_for          varchar(160),
  login_email         varchar(200),
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  deleted_at          timestamptz,

  constraint subscriptions_cost_usd_positive check (cost_usd >= 0),
  constraint subscriptions_cost_bdt_positive check (cost_bdt is null or cost_bdt >= 0),
  constraint subscriptions_usd_rate_positive check (usd_rate is null or usd_rate > 0)
);

create index if not exists subscriptions_vendor_idx
  on subscriptions (vendor_id);
create index if not exists subscriptions_status_idx
  on subscriptions (status, next_renewal_on);
create index if not exists subscriptions_account_idx
  on subscriptions (account_id);

create table if not exists subscription_users (
  subscription_id  uuid not null references subscriptions (id) on delete cascade,
  team_member_id   uuid not null references team_members (id) on delete cascade,

  from_date        date,
  until_date       date,
  status           subscription_status not null default 'active',

  created_at       timestamptz not null default now(),
  created_by       uuid,

  primary key (subscription_id, team_member_id)
);

-- The team page reads this the other way round — "what is this person on" —
-- and the primary key's leading column cannot serve that.
create index if not exists subscription_users_member_idx
  on subscription_users (team_member_id, status);

-- The fourth thing a file can belong to. The check constraint is replaced
-- rather than added to: it counts owners, and a new column outside the count
-- would let a row belong to two.
alter table files
  add column if not exists subscription_id uuid
    references subscriptions (id) on delete cascade;

create index if not exists files_subscription_idx
  on files (subscription_id);

alter table files drop constraint if exists files_one_owner;
alter table files add constraint files_one_owner check (
  (case when team_member_id  is not null then 1 else 0 end
 + case when transaction_id  is not null then 1 else 0 end
 + case when import_batch_id is not null then 1 else 0 end
 + case when subscription_id is not null then 1 else 0 end) = 1
);

-- A kind for it. Not inside a transaction that then uses the value: Postgres
-- refuses to read an enum label added in the same transaction.
commit;

alter type file_kind add value if not exists 'subscription_screenshot';

-- Both tables, both enums, and the four indexes. Every one should read true.
select
  (select count(*) = 1 from information_schema.tables
    where table_name = 'subscriptions') as subscriptions,
  (select count(*) = 1 from information_schema.tables
    where table_name = 'subscription_users') as subscription_users,
  (select count(*) = 10 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'subscription_category') as categories,
  (select count(*) = 4 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'subscription_status') as statuses,
  (select count(*) = 4 from pg_indexes
    where indexname in ('subscriptions_vendor_idx', 'subscriptions_status_idx',
                        'subscriptions_account_idx',
                        'subscription_users_member_idx')) as indexes,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'files' and column_name = 'subscription_id') as file_owner,
  (select count(*) = 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'file_kind'
      and e.enumlabel = 'subscription_screenshot') as file_kind;
