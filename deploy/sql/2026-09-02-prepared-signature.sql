-- A second signature on the payslip: the one who prepared it.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-02-prepared-signature.sql
--
-- RUN THIS BEFORE THE CODE. `file_kind` is a real Postgres enum, so a row
-- written with a value the type does not have is refused outright — and the
-- upload would fail on a screen that had just offered the button.
--
-- WHY. The payslip has two signature blocks: "Prepared by" on the left and
-- "Authorised signatory" on the right. Only the right one could carry a mark,
-- so the left block's rule sat 28pt higher than the right's and the two never
-- lined up. The owner asked for both: *"prepared by je ache onar signature
-- upload korar option rekhe diyo settings a"*.
--
-- NO TRANSACTION AROUND THIS, and it is not an oversight. `ALTER TYPE … ADD
-- VALUE` cannot run inside one — Postgres refuses with "ALTER TYPE ... ADD
-- cannot run inside a transaction block" — which is why this file has no
-- begin/commit while every other migration here does. `IF NOT EXISTS` is what
-- makes re-running it a no-op instead of an error.
--
-- APPENDED, never inserted. The `FILE_KINDS` array in packages/shared is the
-- declaration order of this type, and a value added in the middle of that array
-- would make the code a second, disagreeing claim about what the database did.
-- New values go on the end, on both sides.
--
-- NOTHING IS REWRITTEN. One new label on an enum. No row is touched, no
-- existing file changes kind, and every payslip already printed keeps the mark
-- it has.
alter type file_kind add value if not exists 'prepared_signature';

-- What this file did, in figures.
select
  (select count(*) from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'file_kind' and e.enumlabel = 'prepared_signature')
    as label_added,
  (select count(*) from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'file_kind')                          as labels_total,
  (select count(*) from files where kind = 'signature' and deleted_at is null)
    as signatures_on_file;
