import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const importTargetEnum = pgEnum("import_target", [
  "transactions",
  "team_members",
]);

export const importStatusEnum = pgEnum("import_status", [
  "uploaded",
  "mapped",
  "previewed",
  "committed",
  "reverted",
  "failed",
]);

export const importRowStatusEnum = pgEnum("import_row_status", [
  "valid",
  "error",
  "duplicate",
  "imported",
  "skipped",
]);

/**
 * An upload in progress.
 *
 * The preview lives in the database rather than in browser memory so an import
 * survives a refresh, leaves an audit trail, and — most importantly — can be
 * reverted as a unit when a whole file turns out to be wrong.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    target: importTargetEnum("target").notNull(),
    filename: text("filename").notNull(),
    status: importStatusEnum("status").notNull().default("uploaded"),

    /** Which spreadsheet column feeds which field. */
    columnMap: jsonb("column_map"),
    /** Applied to every row: which account, and how dates are written. */
    defaults: jsonb("defaults"),

    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),

    uploadedBy: uuid("uploaded_by"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("import_batches_status_idx").on(t.status, t.createdAt)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),

    /** Exactly what the spreadsheet said, before any interpretation. */
    raw: jsonb("raw").notNull(),
    /** After the column map and parsing. */
    mapped: jsonb("mapped"),

    status: importRowStatusEnum("status").notNull().default("valid"),
    errors: jsonb("errors"),
    /** "Looks like TXN-2026-000041 on the same day for the same amount." */
    warning: text("warning"),

    createdEntityId: uuid("created_entity_id"),
  },
  (t) => [index("import_rows_batch_idx").on(t.batchId, t.rowNumber)],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
