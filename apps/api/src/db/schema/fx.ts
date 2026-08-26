import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { fxSourceEnum } from "./enums";
import { deletion, entityKey } from "./shared-columns";

/**
 * One USD/BDT rate per day.
 *
 * Reporting in USD is a **translation**, not a fact: the same July shown at
 * July's rate and at today's rate differ by pure currency movement with no
 * money having changed. So every translated figure has to be able to say which
 * rate produced it and when that rate was true — which means storing the rate
 * with its date rather than converting on the fly against whatever is current.
 *
 * The exception is a real conversion. When the CEO sends dollars and the bank
 * lands taka, the realised rate is a fact about that transfer and lives on the
 * transaction itself (`fx_rate`), frozen for ever. Nothing here can change it.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    baseCurrency: text("base_currency").notNull().default("USD"),
    quoteCurrency: text("quote_currency").notNull().default("BDT"),

    /** How many BDT one USD buys. */
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    rateDate: date("rate_date").notNull(),

    source: fxSourceEnum("source").notNull().default("manual"),
    /** Which provider, when it came from one. */
    provider: text("provider"),
    /**
     * When the figure was actually retrieved, as opposed to the day it applies
     * to. A month-end close reached with a four-day-old cached rate should say
     * so rather than implying it is current.
     */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),

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
    uniqueIndex("fx_rate_day_idx").on(
      entityKey(t.entityId),
      t.baseCurrency,
      t.quoteCurrency,
      t.rateDate,
    ),
    index("fx_rate_date_idx").on(t.rateDate),
    check("fx_rate_positive", sql`${t.rate} > 0`),
  ],
);

export type FxRate = typeof fxRates.$inferSelect;
