import { FILE_KINDS } from "@finance/shared";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  smallint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { importBatches } from "./imports";
import { appSettings } from "./settings";
import { statements } from "./statements";
import { subscriptions } from "./subscriptions";
import { tdsDeposits } from "./tax";
import { payrollLines, payrollRuns, teamMembers } from "./team";
import { transactions } from "./transactions";
import { users } from "./users";
import { deletion } from "./shared-columns";

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
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "cascade",
    }),

    /**
     * The A-Challan's own scan.
     *
     * A deposit is the one document on the TDS screen that had nowhere to
     * hang: every other owner here had a column and this did not, so the
     * bank's receipt for tax actually paid could not be attached to the row
     * that records paying it.
     */
    tdsDepositId: uuid("tds_deposit_id").references(() => tdsDeposits.id, {
      onDelete: "cascade",
    }),
    /**
     * One person's line on one month's payroll.
     *
     * The withholding register reads a challan per person, so its scan hangs
     * on the line whoever attached it had open. Everybody else on that month's
     * run reaches the same file through the challan number they share rather
     * than through a copy of their own — see `TdsService.salaryRegister`.
     */
    payrollLineId: uuid("payroll_line_id").references(() => payrollLines.id, {
      onDelete: "cascade",
    }),
    /**
     * One month's payroll run — the sheet, not a person's row on it.
     *
     * The bill we were sent for the month's salaries and the bank's record of
     * paying them are one document each for the whole run, so they hang here
     * rather than on a line. The obvious alternative was the salary
     * transaction the run writes when it is paid, which would have needed no
     * column at all; it is the wrong shape, because that row does not exist
     * until the money moves and the slot has to be fillable while the run is
     * still a draft.
     */
    payrollRunId: uuid("payroll_run_id").references(() => payrollRuns.id, {
      onDelete: "cascade",
    }),
    /**
     * The financial statement one signatory signed.
     *
     * The signature block on the closing page carries up to four people, and
     * each of them has their own hand — so this is not the company's single
     * `signature`, which lives on the settings row below and is singular by
     * rule. Owned by the period rather than by settings so that the pair
     * guarding it is the statement's own: Finance reconciles these pages and
     * Finance does not hold `settings.write`.
     */
    statementId: uuid("statement_id").references(() => statements.id, {
      onDelete: "cascade",
    }),
    /**
     * The settings row, which is the company itself.
     *
     * A smallint and not a uuid, because `app_settings` is a single row keyed
     * by one with `check (id = 1)`. It is an owner like the other four rather
     * than an exception to the rule, so a signature is reachable and countable
     * the same way every other file is.
     */
    settingsId: smallint("settings_id").references(() => appSettings.id, {
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
    ...deletion(),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("files_team_member_idx").on(t.teamMemberId, t.kind),
    index("files_transaction_idx").on(t.transactionId),
    index("files_import_batch_idx").on(t.importBatchId),
    index("files_subscription_idx").on(t.subscriptionId),
    index("files_settings_idx").on(t.settingsId),
    index("files_tds_deposit_idx").on(t.tdsDepositId),
    index("files_payroll_line_idx").on(t.payrollLineId),
    index("files_payroll_run_idx").on(t.payrollRunId),
    index("files_statement_idx").on(t.statementId),
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
         + case when ${t.importBatchId} is not null then 1 else 0 end
         + case when ${t.subscriptionId} is not null then 1 else 0 end
         + case when ${t.settingsId} is not null then 1 else 0 end
         + case when ${t.tdsDepositId} is not null then 1 else 0 end
         + case when ${t.payrollLineId} is not null then 1 else 0 end
         + case when ${t.statementId} is not null then 1 else 0 end
         + case when ${t.payrollRunId} is not null then 1 else 0 end) = 1`,
    ),
  ],
);

export type FileRow = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
