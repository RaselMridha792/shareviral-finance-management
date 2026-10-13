import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { transactions } from "./transactions";
import { users } from "./users";
import { deletion } from "./shared-columns";

/**
 * TDS handed back to the staff it was taken from. Made by
 * `deploy/sql/2026-10-13-tds-refunds.sql`.
 *
 * Not a challan: a refund never reaches the challan list or a return. What is
 * owed to the treasury is withheld − deposited − refunded. Payslips keep the
 * TDS they took; the refund is its own event.
 *
 * Outlives its ledger row and the people who wrote it (`set null`).
 */
export const tdsRefunds = pgTable(
  "tds_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    /** The month whose TDS this hands back. */
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),

    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    refundedOn: date("refunded_on").notNull(),

    /** The ledger row that paid it out, if there is one. */
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),

    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...deletion(),
  },
  (t) => [
    index("tds_refunds_period_idx")
      .on(t.periodYear, t.periodMonth)
      .where(sql`${t.deletedAt} is null`),
    check("tds_refunds_month", sql`${t.periodMonth} between 1 and 12`),
    check("tds_refunds_amount_positive", sql`${t.amount} > 0`),
  ],
);

export type TdsRefund = typeof tdsRefunds.$inferSelect;
export type NewTdsRefund = typeof tdsRefunds.$inferInsert;
