-- A challan can carry its scan.
--
-- One enum value and a column. `files` hangs on its owner through one nullable
-- foreign key per entity type — team member, transaction, import batch,
-- subscription, settings — and a deposit had none, so the A-Challan the whole
-- TDS screen is about was the one document with nowhere to live.
--
-- `ALTER TYPE ... ADD VALUE` will not run inside a transaction block, so the
-- enum statement comes first, on its own, and the DDL follows. Run the file as
-- a whole; psql executes each statement separately.
--
-- Only `file_kind` is a Postgres enum. `FILE_OWNERS` in packages/shared is a
-- Zod enum naming the API's owner parameter — the database expresses ownership
-- as one nullable foreign key per entity, which is what the column below adds.
--
-- `IF NOT EXISTS` throughout: this is applied to the local development database
-- and to the VPS separately, and a migration that fails the second time is one
-- somebody learns to skip.

ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'challan';
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS tds_deposit_id uuid
    REFERENCES tds_deposits(id) ON DELETE CASCADE;

-- The same partial index every other owner column has: a file is looked up by
-- what it hangs on, and only rows that hang on a deposit are worth indexing.
CREATE INDEX IF NOT EXISTS files_tds_deposit_idx
  ON files (tds_deposit_id)
  WHERE tds_deposit_id IS NOT NULL;
