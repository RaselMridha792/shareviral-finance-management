-- The mark each signatory actually signs with, on the financial statement.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-who-signs.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- Drizzle names every column in its SELECT, so the code that reads
-- `files.statement_id` kills every document list and every upload until this
-- has run.
--
-- ------------------------------------------------------------------------
-- What changes
-- ------------------------------------------------------------------------
-- The statement's "Signed by" block held a name and a title, and the PDF drew
-- a ruled line with nothing above it. The owner asked for the signature
-- itself, so each signatory now carries an image and the closing page prints
-- it over the rule.
--
-- Two things the database has to learn:
--
--   * `statement_signature`, an eighth kind of file. Not `signature` — that
--     one is the company's single mark on a payslip and is singular by rule,
--     so a second one replaces the first. A statement has up to four
--     signatories and each has their own hand.
--
--   * `files.statement_id`, an eighth owner. The image hangs on the period it
--     was signed for, not on `app_settings`: `settings` files are written by
--     `settings.write`, which only super_admin holds, and the people who
--     reconcile a statement are Finance. A statement-owned file follows the
--     statement's own pair — `reports.view` to read, `transactions.write` to
--     change — which is exactly who may edit the page it appears on.
--
-- The signatory rows themselves stay in `statements.signatories`, which is
-- jsonb: the file id goes in beside the name and the title, so no column
-- changes there.
--
-- ------------------------------------------------------------------------
-- Why the constraint is replaced, again — and why this file is named "who"
-- ------------------------------------------------------------------------
-- `files` holds one rule: a row belongs to exactly one thing, counted across
-- its owner columns. A new owner column outside that count would let a file
-- belong to two things while the constraint went on claiming it could not, so
-- the check is REPLACED rather than added to. This is the fifth file to do
-- that, and like the fourth it names every owner column that exists rather
-- than the ones it cares about.
--
-- It also has to be the last of them in filename order. Replaying this
-- directory alphabetically must not put a shorter rule back on top of a
-- longer one, and every name already here sorts below "who" — which is why a
-- migration about signatures is not called "signature". The deploy records
-- each file in `schema_migrations` and runs it once, so this only matters to
-- a database rebuilt from scratch; that is precisely the case nobody is
-- watching when it breaks.
--
-- Safe to run twice.

-- `ALTER TYPE ... ADD VALUE` will not run inside an explicit transaction
-- block, so it comes first and alone. psql executes each statement in turn.
ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'statement_signature';

-- The period this mark was signed for. One nullable foreign key per owner,
-- like every other document in this table. ON DELETE CASCADE: a statement is
-- never deleted in this app, but if one ever were, its signatures are not
-- evidence of anything on their own.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS statement_id uuid
    REFERENCES statements (id) ON DELETE CASCADE;

-- The same partial index the other owner columns have: a file is looked up by
-- what it hangs on, and only rows that hang on a statement are worth indexing.
CREATE INDEX IF NOT EXISTS files_statement_idx
  ON files (statement_id)
  WHERE statement_id IS NOT NULL;

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_one_owner;
ALTER TABLE files ADD CONSTRAINT files_one_owner CHECK (
  (CASE WHEN team_member_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN transaction_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN import_batch_id IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN subscription_id IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN settings_id     IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN tds_deposit_id  IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN payroll_line_id IS NOT NULL THEN 1 ELSE 0 END
 + CASE WHEN statement_id    IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- The kind, the column, the rule, and that no existing file broke it on the
-- way through.
SELECT
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'file_kind' AND e.enumlabel = 'statement_signature') AS new_kind,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'files' AND column_name = 'statement_id') AS owner_column,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'files_statement_idx') AS owner_index,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'files_one_owner') AS one_owner_constraint,
  (SELECT count(*) FROM files WHERE deleted_at IS NULL) AS files_still_readable;
