-- Four file kinds the HR app has and this one did not: education_certificate,
-- release_letter, experience_letter, bank_details.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-09-23-hr-file-kinds.sql
--
-- ==========================================================================
-- THERE IS NO `begin;` IN THIS FILE, AND THERE MUST NOT BE ONE
-- ==========================================================================
-- Every other file in this directory wraps its work in `begin; ... commit;`.
-- This one cannot. `ALTER TYPE ... ADD VALUE` is refused inside a transaction
-- block on older Postgres outright, and even where the server takes it the new
-- label cannot be USED until that transaction has committed -- so a `begin`
-- here buys nothing and risks the one thing this file exists to do failing at
-- the moment somebody runs it against the live database. If you are copying
-- this file as a template for something else, copy the transaction back in;
-- if you are adding a statement to THIS file, it has to be another bare
-- `ALTER TYPE ... ADD VALUE` and nothing else.
--
-- Four statements, no transaction, so a failure part-way leaves the earlier
-- ones applied. `IF NOT EXISTS` is what makes that harmless: re-running the
-- whole file is free, which it has to be, because this reaches the local
-- database and the VPS separately and a file that fails the second time is one
-- somebody learns to skip.
--
-- --------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE -- but know what "before" is worth here
-- --------------------------------------------------------------------------
-- `file_kind` is an enum TYPE, not a column, so a deploy that lands first does
-- not break reading: every row already in `files` holds a label the type
-- already has, and the directory, the salary sheet and every existing document
-- carry on exactly as they are. What breaks is the one act this change exists
-- for -- uploading one of these four fails at the INSERT, as a bare 500,
-- because Drizzle does no client-side enum checking and the exception filter
-- has no branch for a Postgres driver error. Same shape as
-- 2026-08-18-file-kinds.sql and 2026-08-30-resignation-letter.sql.
--
-- --------------------------------------------------------------------------
-- WHY. The two apps are being given the same vocabulary
-- --------------------------------------------------------------------------
-- The HR app (a separate repository, hrm.hellonizam.com) holds ten kinds of
-- paper about a person; this app held nine, and five of them already matched.
-- The owner decided on 22 Sep 2026 that the gaps get BUILT on both sides
-- rather than collapsed -- five different HR documents arriving here as `other`
-- would be a pile nobody could sort afterwards. These are the four this app
-- was missing. The three it has that HR does not -- salary_certificate,
-- etin_certificate, resignation_letter -- are being added over there, and are
-- no business of this file.
--
-- (HR's tenth kind, `linkedin_profile`, is a URL with no bytes behind it. It
-- is not a document and there is deliberately no enum value for it here.)
--
-- --------------------------------------------------------------------------
-- `bank_details`, and what this app can and cannot promise about it
-- --------------------------------------------------------------------------
-- Say it plainly, because the next person to read this file deserves to know
-- what was decided rather than to infer it. In the HR app a bank-details
-- document is SENSITIVE: hidden from anybody who cannot read pay, Management
-- included. In this app the same paper is visible to every role that can read
-- a person's compensation. The owner was told that, in those words, and asked
-- on 22 Sep 2026 for it to travel anyway. That is their call to make and it
-- has been made.
--
-- What this app CAN do is classify it honestly, and it does: `bank_details`
-- joins COMPENSATION_FILE_KINDS in packages/shared/src/files.ts, alongside the
-- appointment letter and the salary certificate, so reading one needs
-- `team.compensation.read` as well as `team.read` and it is filtered out of
-- the list entirely for anybody without it. That is the narrowest gate this
-- application has. It is not as narrow as HR's.
--
-- --------------------------------------------------------------------------
-- Order is not a choice
-- --------------------------------------------------------------------------
-- A value added to a Postgres enum lands at the END unless the whole type is
-- rewritten, and `FILE_KINDS` in packages/shared/src/files.ts IS this type's
-- declaration order -- the array's own comment says so, and
-- apps/api/src/db/schema/files.ts builds `pgEnum("file_kind", FILE_KINDS)`
-- straight from it. So these four go on the end, in this order, and the array
-- appends them in the same order. No `AFTER` clause anywhere: choosing a
-- position here is how the database comes to disagree with the app about what
-- `order by kind` means.
--
-- --------------------------------------------------------------------------
-- NOTHING IS REWRITTEN
-- --------------------------------------------------------------------------
-- No column is added, no row is touched, no constraint is replaced. `files`
-- already carries `team_member_id`, so `files_one_owner` is untouched and every
-- paper already uploaded stays exactly where it is. There is no backfill and
-- none is possible: this app has never held these four kinds, so no existing
-- row is one of them. A document that came over as `other` before today stays
-- `other` -- re-filing it is a person's judgement about a particular paper,
-- not something SQL should guess.

ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'education_certificate';
ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'release_letter';
ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'experience_letter';
ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'bank_details';

-- What this file did, in figures. All four should be present, on the end, in
-- the order the TypeScript array has them.
select enumlabel, enumsortorder
  from pg_enum
 where enumtypid = 'file_kind'::regtype
 order by enumsortorder;

select
  (select count(*) from pg_enum
    where enumtypid = 'file_kind'::regtype
      and enumlabel in ('education_certificate', 'release_letter',
                        'experience_letter', 'bank_details'))  as kinds_added,
  (select count(*) from files)                                 as files_total,
  (select count(*) from files where team_member_id is not null)
    as files_on_a_person;
