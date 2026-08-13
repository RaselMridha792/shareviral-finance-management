import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { RawRow } from "../../modules/imports/row-parser";
import { aiChats } from "./ai-chats";
import { users } from "./users";

/**
 * A file somebody attached to a conversation.
 *
 * Parsed on arrival and kept as rows rather than bytes: nothing here needs the
 * original file back, and storing a blob would mean deciding where blobs live,
 * which this app has deliberately never had to answer (receipts are links).
 *
 * It belongs to the person who attached it, like the conversation it sits in.
 * A bank statement is not shared reading material, and the row cannot be
 * reached without `user_id` matching — a Super Admin included.
 *
 * When the rows are handed to the import screen, `import_batch_id` records
 * which batch, so the same file cannot be staged twice by accident.
 */
export const aiAttachments = pgTable(
  "ai_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Null until the first turn — a file can be attached before anything is said. */
    chatId: uuid("chat_id").references(() => aiChats.id, {
      onDelete: "cascade",
    }),

    filename: text("filename").notNull(),

    /** Column headings, in the order the file had them. */
    headers: jsonb("headers").$type<string[]>().notNull().default([]),

    /** Rows kept for analysis. Capped — a huge file belongs in Import. */
    rows: jsonb("rows").$type<RawRow[]>().notNull().default([]),

    /** Rows in the file, which may exceed the number kept above. */
    totalRows: integer("total_rows").notNull().default(0),

    importBatchId: uuid("import_batch_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_attachments_user_idx").on(t.userId, t.createdAt)],
);

export type AiAttachmentRow = typeof aiAttachments.$inferSelect;
export type NewAiAttachment = typeof aiAttachments.$inferInsert;
