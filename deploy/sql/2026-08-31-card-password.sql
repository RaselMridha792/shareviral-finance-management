-- The password that stands between a signed-in admin and a card number.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-08-31-card-password.sql
--
-- RUN THIS BEFORE THE CODE.
--
-- WHY. `2026-08-31-card-fields.sql` put a sealed card number and CVC on an
-- account. Sealed at rest is only half an answer: something has to decide who
-- may unseal them, and "whoever is signed in as an admin" is not much of a
-- decision when a laptop is left open.
--
-- THE OWNER'S DECISION, recorded as his: a separate card password that a few
-- people know, on top of the role. So a reveal needs BOTH — a role that may
-- write accounts (super_admin, admin, cfo) AND this password typed in.
--
-- One row, because it is one shared secret. `app_settings` is already the
-- single-row table every app-wide setting lives in.
--
-- WHAT WAS SAID ABOUT IT AT THE TIME, so nobody has to rediscover it: a shared
-- password cannot be revoked for one person. When somebody leaves, it has to
-- be changed and everyone else told. A per-person gate — each typing their own
-- sign-in password — would not have that problem, and the owner was told so
-- and chose this. `card_password_set_at` is here to make the change visible:
-- the Settings panel can say when it was last changed, which is the only thing
-- that makes "we should change it" a question anybody asks.
--
-- Stored as a bcrypt hash, never as the password. Same shape and same reason as
-- `users.password_hash`.
--
-- NOTHING IS REWRITTEN. Three nullable columns on a table that holds one row.
-- Null means no card password has been set yet, and until one is, the reveal
-- endpoint refuses everybody — which is the safe direction to fail.
begin;

alter table app_settings
  add column if not exists card_password_hash   text,
  add column if not exists card_password_set_at timestamptz,
  add column if not exists card_password_set_by uuid;

comment on column app_settings.card_password_hash is
  'bcrypt of the shared card password. Null until one is set, and while it is '
  'null the card reveal endpoint refuses everybody.';

comment on column app_settings.card_password_set_at is
  'When it was last changed. Shown in Settings, because a shared password '
  'nobody remembers changing is one that has not been changed since somebody '
  'left.';

commit;

-- What this file did.
select
  (select count(*) from information_schema.columns
    where table_name = 'app_settings' and column_name like 'card_password%')
      as columns_added,
  (select count(*) from app_settings)                       as settings_rows,
  (select card_password_hash is not null from app_settings limit 1)
      as password_already_set;
