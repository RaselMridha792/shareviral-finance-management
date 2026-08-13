import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { psrStatusEnum, vendorTypeEnum } from "./enums";
import { entityKey } from "./shared-columns";

/**
 * Anyone money is paid to or received from.
 *
 * Kept as a master list rather than free text on each transaction so
 * "what did we pay this vendor this year" is answerable, and so "Beacon
 * Properties" and "beacon properties" don't become two parties.
 */
export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    name: text("name").notNull(),
    type: vendorTypeEnum("type").notNull().default("supplier"),

    /** 12-digit e-TIN. */
    etin: varchar("etin", { length: 12 }),
    /** 13-digit VAT Business Identification Number. */
    bin: varchar("bin", { length: 13 }),

    /**
     * Proof of Submission of Return, per assessment year. Its absence raises
     * the TDS rate by 50%, so it belongs on the payee, not on the payment.
     */
    psrStatus: psrStatusEnum("psr_status").notNull().default("unknown"),
    psrAssessmentYear: varchar("psr_assessment_year", { length: 9 }),
    psrReference: text("psr_reference"),

    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),

    /** Pre-selected when recording a payment to this vendor. */
    defaultCategoryId: uuid("default_category_id"),

    /**
     * What renews, how often, and when next.
     *
     * On the vendor rather than in a table of its own: an AI subscription is
     * something the company pays, which is what this table has always held.
     * What these columns add is a *next* payment beside the history.
     *
     * The currency is stored, not assumed. Most of these bill in dollars while
     * the books are in taka, and adding the two at 1:1 is a mistake this app
     * has already made once.
     */
    billingCycle: text("billing_cycle").notNull().default("none"),
    billingAmount: numeric("billing_amount", { precision: 14, scale: 2 }),
    billingCurrency: text("billing_currency").notNull().default("BDT"),
    /** An anchor, not a promise — the next date is rolled forward from it. */
    nextRenewalOn: date("next_renewal_on"),
    billingAccountId: uuid("billing_account_id"),

    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("vendors_name_idx").on(
      entityKey(t.entityId),
      sql`lower(${t.name})`,
    ),
    index("vendors_active_idx").on(t.isActive),
    index("vendors_etin_idx").on(t.etin),
    // "What renews soon" is the question this screen exists to answer.
    index("vendors_renewal_idx").on(t.nextRenewalOn),
  ],
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
