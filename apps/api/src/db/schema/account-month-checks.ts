import { sql } from "drizzle-orm";
import {
  check,
  date,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { users } from "./users";

/**
 * The Check column of Accounts ▸ Bank status, ticked by hand: a row per
 * account per books month that someone ticked; unticking deletes it. Made by
 * `deploy/sql/2026-10-13-bank-status-checks.sql`.
 *
 * Removed with its account; outlives the person who ticked it (`set null`).
 */
export const accountMonthChecks = pgTable(
  "account_month_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    /** The books month, as the first of that month. */
    month: date("month").notNull(),

    checkedBy: uuid("checked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "account_month_checks_month_first",
      sql`extract(day from ${t.month}) = 1`,
    ),
    unique("account_month_checks_one").on(t.accountId, t.month),
  ],
);

export type AccountMonthCheck = typeof accountMonthChecks.$inferSelect;
export type NewAccountMonthCheck = typeof accountMonthChecks.$inferInsert;
