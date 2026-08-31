-- What a card is, beyond an account with a balance.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-08-31-card-fields.sql
--
-- RUN THIS BEFORE THE CODE. Drizzle names every column in its SELECT, so the
-- moment these are in the projection and missing from the database, the whole
-- accounts query dies and the site goes with it.
--
-- WHY. An account of type `card` has facts a bank account has not: whose name
-- is on it, what the card itself is called, the number, when it expires, and
-- the three digits on the back. Until now the drawer asked for a bank, a
-- branch, a routing number and a SWIFT code — none of which a card has — and
-- had nowhere to put any of the above.
--
-- THE OWNER'S DECISION, recorded as theirs: "card er puro number save hobe,
-- cvc encrypted hobe" — the whole number is kept, and the CVC is encrypted.
--
-- Both are sealed here, not only the CVC, and that is a deliberate step beyond
-- what was asked. A number kept in an ordinary column travels: `projection` in
-- accounts.service.ts feeds GET /accounts, the dashboard, every account picker
-- and the Accounts spreadsheet, and it is also the `read` of every audit
-- mutation on that table — so one plain column would put the card number on
-- the wire, in a downloadable file, and in `audit_logs.before` at once.
-- Sealed, all three are closed by the same fact. `secret-box.ts` seals with
-- AES-256-GCM under SECRET_ENCRYPTION_KEY, the same way the Anthropic key is
-- already held.
--
-- `card_last4` is the exception and is stored PLAINLY on purpose: it is what
-- the screen shows so a person can tell one card from another, and four digits
-- identify a card to its owner without being the card.
--
-- A note about what the rules say, so the decision stays informed rather than
-- forgotten: PCI-DSS forbids storing the CVC after a payment is authorised.
-- This is a company recording its own cards for its own staff, not a processor
-- holding customers' — the owner has weighed that and chosen. Encrypted at
-- rest, reachable only through one endpoint, and every reveal is audited.
--
-- NOTHING IS REWRITTEN. Seven nullable columns are added; every existing row is
-- legitimately null and no backfill is possible or wanted.
begin;

alter table accounts
  add column if not exists card_holder_name  text,
  add column if not exists card_label        text,
  add column if not exists card_number_sealed text,
  add column if not exists card_last4        varchar(4),
  add column if not exists card_expiry       varchar(7),
  add column if not exists card_cvc_sealed   text,
  add column if not exists card_secrets_set_at timestamptz,
  add column if not exists card_secrets_set_by uuid;

comment on column accounts.card_number_sealed is
  'The full card number, sealed by secret-box (v1.<iv>.<tag>.<ciphertext>). '
  'MUST NOT appear in accounts.service.ts projection: that feeds GET /accounts, '
  'the Accounts export and every audit before/after image.';

comment on column accounts.card_cvc_sealed is
  'The three digits on the back, sealed. Stored on the owner''s explicit '
  'decision (31 Aug 2026); PCI-DSS forbids it for a payment processor.';

comment on column accounts.card_last4 is
  'Plain on purpose — what the screen shows so one card is telling apart from '
  'another. Four digits identify a card to its owner without being the card.';

comment on column accounts.card_expiry is
  'MM/YYYY as typed. Text rather than a date: a card expires at the end of a '
  'month, and a date column would invent a day.';

commit;

-- What this file did, in figures.
select
  (select count(*) from information_schema.columns
    where table_name = 'accounts' and column_name like 'card_%') as card_columns,
  (select count(*) from accounts)                               as accounts_total,
  (select count(*) from accounts where card_number_sealed is not null)
                                                                as cards_on_file;
