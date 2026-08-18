import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The salary TDS rule, as data.
 *
 * One row per income year, not one row full stop — and that is the point of
 * the table rather than a handful of columns on `app_settings`.
 *
 * The app now works the tax out instead of taking a typed figure, so the rule
 * is what produced every payslip. A single editable row would mean July's
 * payslip re-rendering under August's rates the moment somebody adjusted a
 * band, silently and with no way to tell. Keyed by year, an old payslip can
 * always be read back against the rule that made it.
 *
 * Typed columns rather than a jsonb blob, following `app_settings` and for the
 * same reason: these figures drive money, and typed columns get type checking
 * and migrations where a blob gets neither. The one genuinely variable part —
 * the slab table — is a child table for the same reason.
 */
export const taxPolicies = pgTable(
  "tax_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    /** 2026 means the income year 2026-27. */
    fiscalYear: integer("fiscal_year").notNull(),

    /**
     * The untaxed share of salary, as a fraction, capped.
     *
     * Two integers rather than a decimal. One third has no exact decimal and
     * the difference is not academic: carried through paisa as 0.333333 it
     * made a 5,40,000 salary come out at 3,60,000.18 taxable instead of
     * 3,60,000.00, and ten of the advisor's twelve worked examples caught it.
     */
    exemptionNumerator: integer("exemption_numerator").notNull().default(1),
    exemptionDenominator: integer("exemption_denominator").notNull().default(3),
    exemptionCap: numeric("exemption_cap", { precision: 14, scale: 2 })
      .notNull()
      .default("400000.00"),

    /* ------------------------------------------------------------ rebate */
    /**
     * Held as a bracket, not collapsed.
     *
     * `investmentRate` then `rebateRate` is `(taxable × 25%) × 15%`, which
     * comes to 3.75% — and storing 3.75% would be shorter and wrong the first
     * time somebody changes 25% to 20% here, because the collapsed figure
     * would not move with it.
     */
    rebateInvestmentRate: numeric("rebate_investment_rate", {
      precision: 6,
      scale: 4,
    })
      .notNull()
      .default("0.2500"),
    rebateRate: numeric("rebate_rate", { precision: 6, scale: 4 })
      .notNull()
      .default("0.1500"),
    /** The other statutory limb: a share of taxable income. */
    rebateTaxableShare: numeric("rebate_taxable_share", {
      precision: 6,
      scale: 4,
    })
      .notNull()
      .default("0.0300"),
    rebateFixedCap: numeric("rebate_fixed_cap", { precision: 14, scale: 2 })
      .notNull()
      .default("1000000.00"),

    /**
     * Whether everybody is treated as having invested the full eligible
     * amount.
     *
     * On, and deliberately so — the owner's instruction, knowing it grants the
     * rebate to people who have not invested. It is a switch rather than a
     * constant precisely so that decision can be revisited from Settings
     * without a deploy, and so the app can be made strict for a year when the
     * documents are actually collected.
     */
    assumeFullInvestment: boolean("assume_full_investment")
      .notNull()
      .default(true),

    /* ----------------------------------------------------------- minimum */
    /**
     * The floor for somebody who is a taxpayer at all.
     *
     * Not in either spreadsheet; taken from the advisor's handwriting, where
     * two of the twelve land on it. It applies only above the first band —
     * seven of the twelve are below the threshold and every one of them is
     * zero, not 5,000.
     */
    minimumTax: numeric("minimum_tax", { precision: 14, scale: 2 })
      .notNull()
      .default("5000.00"),
    minimumTaxEnabled: boolean("minimum_tax_enabled").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [uniqueIndex("tax_policies_year_idx").on(t.fiscalYear)],
);

/**
 * The slab table, one row per band.
 *
 * A child table rather than a jsonb array, so a band is a row somebody can see,
 * order and change — and so `width` gets the same `numeric(14,2)` every other
 * money figure in this schema has.
 *
 * `width` is null on the last band and means "everything above". A number there
 * would be an arbitrary ceiling, and the day an income passed it the tax would
 * silently stop growing.
 */
export const taxPolicyBands = pgTable(
  "tax_policy_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => taxPolicies.id, { onDelete: "cascade" }),

    /** 1-based, and what the bands are read in. */
    position: smallint("position").notNull(),
    width: numeric("width", { precision: 14, scale: 2 }),
    /** 0.1000 is ten per cent. */
    rate: numeric("rate", { precision: 6, scale: 4 }).notNull(),
  },
  (t) => [uniqueIndex("tax_policy_bands_order_idx").on(t.policyId, t.position)],
);

export const taxPoliciesRelations = relations(taxPolicies, ({ many }) => ({
  bands: many(taxPolicyBands),
}));

export const taxPolicyBandsRelations = relations(taxPolicyBands, ({ one }) => ({
  policy: one(taxPolicies, {
    fields: [taxPolicyBands.policyId],
    references: [taxPolicies.id],
  }),
}));

export type TaxPolicyRow = typeof taxPolicies.$inferSelect;
export type NewTaxPolicyRow = typeof taxPolicies.$inferInsert;
export type TaxPolicyBandRow = typeof taxPolicyBands.$inferSelect;
export type NewTaxPolicyBandRow = typeof taxPolicyBands.$inferInsert;
