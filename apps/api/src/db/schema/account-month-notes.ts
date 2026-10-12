import { sql } from "drizzle-orm";
import {
  check,
  date,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { users } from "./users";

/**
 * The Note column of Accounts ▸ Bank status: one line per account per books
 * month, typed by hand. Made by `deploy/sql/2026-10-13-books-month.sql`.
 *
 * Removed with its account; outlives the person who typed it (`set null`).
 */
export const accountMonthNotes = pgTable(
  "account_month_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    /** The books month, as the first of that month. */
    month: date("month").notNull(),

    note: text("note").notNull(),

    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "account_month_notes_month_first",
      sql`extract(day from ${t.month}) = 1`,
    ),
    unique("account_month_notes_one").on(t.accountId, t.month),
  ],
);

export type AccountMonthNote = typeof accountMonthNotes.$inferSelect;
export type NewAccountMonthNote = typeof accountMonthNotes.$inferInsert;
