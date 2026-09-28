import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { deletion } from "./shared-columns";

/**
 * Invoices drawn in the Invoice Builder and saved (deploy/sql/2026-09-29-
 * invoices.sql).
 *
 * `document` is the builder's whole state, so opening an invoice again gives
 * back exactly what was saved. The columns beside it are read out of it on
 * save, for the list to search and sort by — and `total_amount` is worked out
 * on the server from the items, never taken from the browser.
 *
 * Not a ledger entry: saving one moves no money.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNumber: varchar("invoice_number", { length: 60 }).notNull(),
    status: varchar("status", { length: 12 }).notNull().default("DRAFT"),
    clientName: varchar("client_name", { length: 300 }),
    issuedOn: date("issued_on"),
    dueOn: date("due_on"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    usdRate: numeric("usd_rate", { precision: 18, scale: 6 }),
    document: jsonb("document").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
    ...deletion(),
  },
  (t) => [
    uniqueIndex("invoices_number_live_idx")
      .on(sql`lower(${t.invoiceNumber})`)
      .where(sql`${t.deletedAt} is null`),
    index("invoices_issued_idx")
      .on(t.issuedOn.desc(), t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
