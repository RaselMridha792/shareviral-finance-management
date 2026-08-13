import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { payrollLines } from "./team";
import { transactions } from "./transactions";
import { entityKey } from "./shared-columns";

export const tdsDepositTypeEnum = pgEnum("tds_deposit_type", [
  "salary",
  "vendor",
  "mixed",
]);

export const filingStatusEnum = pgEnum("filing_status", [
  "pending",
  "filed",
  "late",
]);

export const incomeTaxRecordTypeEnum = pgEnum("income_tax_record_type", [
  "advance_quarter",
  "final_return",
  "adjustment",
  "penalty",
]);

export const incomeTaxStatusEnum = pgEnum("income_tax_status", [
  "pending",
  "partially_paid",
  "paid",
  "filed",
]);

/**
 * An A-Challan: tax withheld from someone else's money, deposited to the
 * treasury. The ledger entry for the money leaving is linked, not duplicated.
 */
export const tdsDeposits = pgTable(
  "tds_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    challanNumber: text("challan_number").notNull(),
    challanDate: date("challan_date").notNull(),
    depositDate: date("deposit_date").notNull(),

    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),

    bankName: text("bank_name"),
    branch: text("branch"),

    /** Which month's deductions this covers. */
    periodYear: smallint("period_year").notNull(),
    periodMonth: smallint("period_month").notNull(),

    depositType: tdsDepositTypeEnum("deposit_type").notNull().default("salary"),

    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),

    attachmentUrl: text("attachment_url"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("tds_challan_idx").on(t.challanNumber, t.challanDate),
    index("tds_period_idx").on(t.periodYear, t.periodMonth),
    check("tds_amount_positive", sql`${t.amount} > 0`),
  ],
);

/**
 * Which deductions a challan covers.
 *
 * Without this, "how much of July's tax is still undeposited" is a manual
 * comparison. With it, it is one query — and an auditor asking what a given
 * challan paid for gets an answer.
 */
export const tdsAllocations = pgTable(
  "tds_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    depositId: uuid("deposit_id")
      .notNull()
      .references(() => tdsDeposits.id, { onDelete: "cascade" }),

    /** Exactly one of these is set. */
    payrollLineId: uuid("payroll_line_id").references(() => payrollLines.id, {
      onDelete: "cascade",
    }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "cascade",
    }),

    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tds_alloc_deposit_idx").on(t.depositId),
    index("tds_alloc_line_idx").on(t.payrollLineId),
    check(
      "tds_alloc_one_target",
      sql`(${t.payrollLineId} is not null)::int + (${t.transactionId} is not null)::int = 1`,
    ),
  ],
);

/**
 * The quarterly withholding return (s.177, ITA 2023).
 * Due 25 Oct / 25 Jan / 25 Apr / 25 Jul — quarterly, not half-yearly.
 */
export const withholdingReturns = pgTable(
  "withholding_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    fiscalYear: smallint("fiscal_year").notNull(),
    quarter: smallint("quarter").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),

    filedOn: date("filed_on"),
    acknowledgementNo: text("acknowledgement_no"),
    status: filingStatusEnum("status").notNull().default("pending"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("withholding_period_idx").on(
      entityKey(t.entityId),
      t.fiscalYear,
      t.quarter,
    ),
    check("withholding_quarter", sql`${t.quarter} between 1 and 4`),
  ],
);

/**
 * The company's own tax — advance instalments and the annual return.
 * This is what the user meant by the "TDS Record sheet".
 */
export const incomeTaxRecords = pgTable(
  "income_tax_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    /** "2027-2028". */
    assessmentYear: varchar("assessment_year", { length: 9 }).notNull(),
    incomeYearStart: date("income_year_start").notNull(),
    incomeYearEnd: date("income_year_end").notNull(),

    recordType: incomeTaxRecordTypeEnum("record_type").notNull(),
    /** 1–4 for advance instalments, null otherwise. */
    quarter: smallint("quarter"),

    dueDate: date("due_date").notNull(),
    amountPayable: numeric("amount_payable", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),

    paidOn: date("paid_on"),
    challanNumber: text("challan_number"),
    challanDate: date("challan_date"),

    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),

    returnSubmittedOn: date("return_submitted_on"),
    acknowledgementNo: text("acknowledgement_no"),
    status: incomeTaxStatusEnum("status").notNull().default("pending"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    index("income_tax_year_idx").on(t.assessmentYear),
    check(
      "income_tax_quarter",
      sql`${t.quarter} is null or ${t.quarter} between 1 and 4`,
    ),
  ],
);

export const tdsDepositsRelations = relations(tdsDeposits, ({ many, one }) => ({
  allocations: many(tdsAllocations),
  transaction: one(transactions, {
    fields: [tdsDeposits.transactionId],
    references: [transactions.id],
  }),
}));

export const tdsAllocationsRelations = relations(tdsAllocations, ({ one }) => ({
  deposit: one(tdsDeposits, {
    fields: [tdsAllocations.depositId],
    references: [tdsDeposits.id],
  }),
}));

export type TdsDeposit = typeof tdsDeposits.$inferSelect;
export type TdsAllocation = typeof tdsAllocations.$inferSelect;
export type WithholdingReturn = typeof withholdingReturns.$inferSelect;
export type IncomeTaxRecord = typeof incomeTaxRecords.$inferSelect;
