import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { entityKey } from "./shared-columns";

/** Who signs the page off. Stored as written, not resolved against `users`. */
export type StatementSignatoryRow = { name: string; title: string };

/**
 * The parts of the monthly financial statement a ledger cannot derive.
 *
 * Everything else on the document — the summary, the waterfall, the ledgers —
 * is recomputed from `transactions` on every request, because a figure stored
 * twice is a figure that eventually disagrees with itself. What lives here is
 * only what no query can know: the prose, who signed, whether the period has
 * been reconciled and audited, and which of this period's receipts are already
 * spoken for by the next one.
 *
 * Keyed on the period rather than on a granularity and an index, so July 2026
 * is the same row whether it was opened from the month picker or from a
 * quarter drilling down into it.
 */
export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    /** "2026 · Cycle 03" — which statement this is within the financial year. */
    cycle: integer("cycle").notNull().default(1),

    /**
     * `draft` until somebody has tied the closing balance to the bank.
     *
     * Text with a check rather than a pgEnum: the two values mirror
     * `saveStatementSchema` in @finance/shared, and a check constraint can be
     * widened with an ALTER while an enum value can never be removed.
     */
    status: text("status").notNull().default("draft"),

    /** Signed off by whoever audits — a stronger claim than `reconciled`. */
    audited: boolean("audited").notNull().default(false),

    /** Prose, one sentence per entry. The app supplies a first draft. */
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    signatories: jsonb("signatories")
      .$type<StatementSignatoryRow[]>()
      .notNull()
      .default([]),

    /**
     * Receipts landing in this period that belong to the next one.
     *
     * Held here rather than on the transaction: "earmarked" is a statement of
     * this period's position, not a property of the money. The same transfer is
     * committed-forward on August's page and simply spent on September's, and a
     * flag on the row could only say one of those.
     */
    committedForwardTxnIds: jsonb("committed_forward_txn_ids")
      .$type<string[]>()
      .notNull()
      .default([]),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    // entity_id is inside the constraint from day one, as everywhere else —
    // adding it to a live unique index later means data surgery.
    uniqueIndex("statements_period_idx").on(
      entityKey(t.entityId),
      t.periodStart,
      t.periodEnd,
    ),
    index("statements_end_idx").on(t.periodEnd),
    check(
      "statements_status_known",
      sql`${t.status} in ('draft', 'reconciled')`,
    ),
    check("statements_cycle_range", sql`${t.cycle} between 1 and 99`),
    check("statements_period_order", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

export type Statement = typeof statements.$inferSelect;
export type NewStatement = typeof statements.$inferInsert;
