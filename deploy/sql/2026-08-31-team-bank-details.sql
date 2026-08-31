-- The three bank fields a salary transfer actually needs.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-08-31-team-bank-details.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment these are in the projection and missing from the database, the whole
-- team query dies and the site goes with it.
--
-- WHY. The person drawer asks for a bank, an account number and a routing
-- number, and stops. The owner listed six; three of them have nowhere to go.
--
--   Account Holder Name  a salary often goes to an account in a name that is
--                        not exactly the employee's — a father's name, a joint
--                        account, a maiden name — and a bank REJECTS a transfer
--                        whose beneficiary name does not match. It is the field
--                        most likely to be the reason a payment bounced, and
--                        the app had nowhere to record it.
--   Branch Name          asked for on every bank transfer form in the country.
--   SWIFT Code           needed when a salary is paid from abroad.
--
-- The three that exist keep their names. `bank_name`, `bank_account_number` and
-- `bank_routing` are unchanged, so nothing already recorded moves.
--
-- NOTHING IS REWRITTEN. Three nullable columns; every existing row is
-- legitimately null and no backfill is possible or wanted.
begin;

alter table team_members
  add column if not exists bank_account_holder text,
  add column if not exists bank_branch         text,
  add column if not exists bank_swift          varchar(11);

comment on column team_members.bank_account_holder is
  'The name on the account, which is not always the employee''s own. A bank '
  'refuses a transfer whose beneficiary name does not match.';

comment on column team_members.bank_swift is
  '8 or 11 characters. Needed when a salary is paid from outside Bangladesh.';

commit;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'team_members'
      and column_name in ('bank_account_holder', 'bank_branch', 'bank_swift'))
    as columns_added,
  (select count(*) from team_members)                       as people_total,
  (select count(*) from team_members where bank_name is not null)
    as people_with_a_bank;
