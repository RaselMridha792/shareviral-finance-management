import { FILE_KINDS } from "@finance/shared";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { importBatches } from "./imports";
import { teamMembers } from "./team";
import { transactions } from "./transactions";
import { users } from "./users";

/** Kind names come from the shared package, so the database cannot drift. */
export const fileKindEnum = pgEnum("file_kind", FILE_KINDS);

/**
 * A file this server actually holds.
 *
 * The bytes are on disk under `UPLOAD_DIR`; this row is everything else. The
 * split is deliberate: a database dump stays small enough to take nightly and
 * restore in seconds, and the files are backed up beside it incrementally
 * rather than re-uploaded whole every night.
 *
 * **Which record a file hangs on is three nullable foreign keys, not a
 * type/id pair.** Polymorphic ownership would have been fewer columns, and it
 * would also mean the database cannot delete a person's documents when the
 * person is deleted, cannot stop a row pointing at an id that never existed,
 * and cannot answer "show me this file's owner" in a join. Every one of those
 * is a real bug this table would otherwise be free to have.
 *
 * `storage_key` is unique for a plain reason: two rows naming one path means
 * deleting either one takes the other's bytes with it.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Path under the uploads root — `2026/08/<uuid>.pdf`. Never absolute. */
    storageKey: text("storage_key").notNull().unique(),

    /** What it was called on the way in. Display only; nothing resolves it. */
    originalName: text("original_name").notNull(),

    /**
     * The type the *content* turned out to be, not the one the browser
     * claimed. See `sniffMime` — an upload whose bytes disagree with its name
     * is refused rather than stored under the name's word.
     */
    mimeType: text("mime_type").notNull(),

    sizeBytes: integer("size_bytes").notNull(),

    /**
     * sha256 of the bytes as written.
     *
     * Two jobs. It makes "is this file still what we stored" a question with
     * an answer, which a restore drill can ask. And it makes a duplicate
     * upload visible instead of silently doubling the disk.
     */
    checksum: varchar("checksum", { length: 64 }).notNull(),

    kind: fileKindEnum("kind").notNull(),
    label: text("label"),

    /* --- exactly one of these ------------------------------------------- */

    teamMemberId: uuid("team_member_id").references(() => teamMembers.id, {
      onDelete: "cascade",
    }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "cascade",
    }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, {
      onDelete: "cascade",
    }),

    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Soft, like every other record that represents something real.
     *
     * The bytes go at the same moment — a deleted document that is still
     * readable by anyone who kept the URL is not deleted. The row survives so
     * the audit trail can still say a document existed, who removed it, and
     * when.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("files_team_member_idx").on(t.teamMemberId, t.kind),
    index("files_transaction_idx").on(t.transactionId),
    index("files_import_batch_idx").on(t.importBatchId),
    index("files_checksum_idx").on(t.checksum),
    check("files_size_positive", sql`${t.sizeBytes} > 0`),
    /**
     * A file belongs to one thing. Enforced here rather than in the service,
     * because a row owned by nothing is unreachable through every screen and
     * still on the disk — the kind of leak that is only found by running out
     * of space.
     */
    check(
      "files_one_owner",
      sql`(case when ${t.teamMemberId} is not null then 1 else 0 end
         + case when ${t.transactionId} is not null then 1 else 0 end
         + case when ${t.importBatchId} is not null then 1 else 0 end) = 1`,
    ),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
