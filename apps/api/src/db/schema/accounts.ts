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
    /* ------------------------------------------------------------------ */
    /*  A card, when `type` is 'card'                                      */
    /* ------------------------------------------------------------------ */

    /** Whose name is embossed on it. */
    cardHolderName: text("card_holder_name"),
    /** What the card itself is called — "Platinum Business", not the bank. */
    cardLabel: text("card_label"),

    /**
     * The whole number, sealed.
     *
     * MUST NOT be added to `projection` in accounts.service.ts. That object
     * feeds `GET /accounts`, the dashboard, every account picker, the Accounts
     * spreadsheet, AND the before/after image of every audit row on this
     * table — so one line there would put a card number in three places at
     * once. It is read only through the reveal endpoint.
     */
    cardNumberSealed: text("card_number_sealed"),
    /** Plain on purpose: what the screen shows to tell one card from another. */
    cardLast4: varchar("card_last4", { length: 4 }),
    /** MM/YYYY as typed. A card expires at the end of a month, not on a day. */
    cardExpiry: varchar("card_expiry", { length: 7 }),
    /** The three digits on the back, sealed. Same rule as the number above. */
    cardCvcSealed: text("card_cvc_sealed"),

    cardSecretsSetAt: timestamp("card_secrets_set_at", { withTimezone: true }),
    cardSecretsSetBy: uuid("card_secrets_set_by"),

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
