import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
  ],
);

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
