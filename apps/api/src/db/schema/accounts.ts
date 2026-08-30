import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { accountTypeEnum } from "./enums";
import { deletion, entityKey } from "./shared-columns";

/**
 * Where money sits: bank accounts, petty cash, mobile wallets.
 *
 * `openingBalance` and `openingBalanceOn` are the root of every reported
 * figure — the running balance is this plus the sum of every later
 * transaction. Editing them after transactions exist moves every balance in
 * the system, so the service warns and the change is audited.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull().default("bank"),

    bankName: text("bank_name"),
    branch: text("branch"),
    accountNumber: text("account_number"),
    routingNumber: text("routing_number"),
    /** SWIFT/BIC, for the transfers that arrive from abroad. */
    swiftCode: varchar("swift_code", { length: 11 }),

    currency: text("currency").notNull().default("BDT"),
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    /**
     * What it held in its OWN currency on that day.
     *
     * Null when nobody has stated it, and only meaningful when `currency` is
     * not BDT. It exists because a dollar account's dollars cannot be worked
     * out from its taka: dividing the running taka balance by one rate gives a
     * figure that moves whenever the rate does, which is how $14,000 read back
     * as $13,485.
     */
    openingBalanceUsd: numeric("opening_balance_usd", {
      precision: 14,
      scale: 2,
    }),
    openingBalanceOn: date("opening_balance_on").notNull(),

    /** Order in the sidebar and on the dashboard. */
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    ...deletion(),
  },
  (t) => [
    // entity_id is in the constraint from day one; adding it later to a
    // constraint that lacks it means data surgery.
    uniqueIndex("accounts_name_idx").on(
      entityKey(t.entityId),
      sql`lower(${t.name})`,
    ),
    index("accounts_active_idx").on(t.isActive, t.sortOrder),
  ],
);

export const accountsRelations = relations(accounts, () => ({}));

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
