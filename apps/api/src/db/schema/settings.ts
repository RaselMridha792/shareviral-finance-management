import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  fiscalYearModeEnum,
  fxModeEnum,
  fxReportBasisEnum,
  numberFormatEnum,
} from "./enums";

/**
 * One typed row, not a key/value bag.
 *
 * These settings drive money logic — which months a quarter covers, how an
 * amount is grouped, whether a period is still editable. Typed columns get
 * type checking and migrations; a jsonb blob gets neither.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),

    companyName: text("company_name")
      .notNull()
      .default("ShareViral Finance Management"),
    companyEtin: varchar("company_etin", { length: 12 }),
    companyBin: varchar("company_bin", { length: 13 }),
    companyAddress: text("company_address"),

    baseCurrency: text("base_currency").notNull().default("BDT"),
    secondaryCurrency: text("secondary_currency").notNull().default("USD"),

    /** Bangladesh's income year runs 1 July – 30 June. */
    fiscalYearMode: fiscalYearModeEnum("fiscal_year_mode")
      .notNull()
      .default("bd_july_june"),

    /** ৳12,50,000 by default; western grouping is ৳1,250,000. */
    numberFormat: numberFormatEnum("number_format")
      .notNull()
      .default("bangladeshi"),

    fxMode: fxModeEnum("fx_mode").notNull().default("fixed"),
    fxFixedUsdBdt: numeric("fx_fixed_usd_bdt", { precision: 18, scale: 6 }),
    fxProvider: varchar("fx_provider", { length: 40 }),
    fxLastSyncedAt: timestamp("fx_last_synced_at", { withTimezone: true }),
    fxReportBasis: fxReportBasisEnum("fx_report_basis")
      .notNull()
      .default("period_end"),

    /**
     * Nothing dated on or before this may be created, edited, or voided.
     * Without it, someone can quietly change June after the CEO has read the
     * June report; the audit trail would record it but not prevent it.
     */
    booksLockedThrough: date("books_locked_through"),

    /** Days of warning before a statutory deadline shows on the dashboard. */
    tdsReminderDays: integer("tds_reminder_days").notNull().default(7),

    /**
     * The Anthropic key for the assistant, sealed with AES-256-GCM.
     *
     * Stored rather than kept in the environment so a Super Admin can switch
     * the assistant on from Settings without a redeploy. Encrypted because it
     * is the first value here that is worth money to somebody else on its own
     * — a database dump would otherwise hand over a working billing credential.
     *
     * Never leaves the server. The API returns only whether it is set and the
     * last four characters.
     */
    anthropicApiKey: text("anthropic_api_key"),
    anthropicKeySetAt: timestamp("anthropic_key_set_at", {
      withTimezone: true,
    }),
    anthropicKeySetBy: uuid("anthropic_key_set_by"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    // Enforces the singleton at the database level, not by convention.
    check("app_settings_single_row", sql`${t.id} = 1`),
  ],
);

export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
