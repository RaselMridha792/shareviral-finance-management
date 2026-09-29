import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { deletion } from "./shared-columns";
import { payrollLines, payrollRuns, teamMembers } from "./team";

/**
 * Bank advices — the payment file uploaded to the bank (SCB S2B bulk CSV).
 * deploy/sql/2026-09-29-bank-advices.sql says why and what each column is.
 *
 * Not a ledger entry: paying the salary sheet is still what moves money in
 * the books. This is the instruction the bank reads.
 */
export const bankAdvices = pgTable(
  "bank_advices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 160 }).notNull(),
    payrollRunId: uuid("payroll_run_id").references(() => payrollRuns.id, {
      onDelete: "set null",
    }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    /** As the file writes it: two zeros, then the account number. */
    debitAccountNo: varchar("debit_account_no", { length: 24 })
      .notNull()
      .default(""),
    debitCityCode: varchar("debit_city_code", { length: 8 })
      .notNull()
      .default("DHK"),
    valueDate: date("value_date").notNull(),
    note: text("note"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    downloadedBy: uuid("downloaded_by"),
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
    index("bank_advices_created_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
    index("bank_advices_run_idx").on(t.payrollRunId),
  ],
);

export const bankAdviceLines = pgTable(
  "bank_advice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAdviceId: uuid("bank_advice_id")
      .notNull()
      .references(() => bankAdvices.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** ACH = BEFTN, BT = SCB to SCB, RTGS, PAY = payroll. */
    paymentType: varchar("payment_type", { length: 4 })
      .notNull()
      .default("PAY"),
    beneficiaryName: varchar("beneficiary_name", { length: 140 }).notNull(),
    /** SCBLBDDXXXX for an SCB account; otherwise 00 and the routing number. */
    bankCode: varchar("bank_code", { length: 20 }).notNull().default(""),
    accountNo: varchar("account_no", { length: 34 }).notNull().default(""),
    paymentDetails: varchar("payment_details", { length: 140 })
      .notNull()
      .default(""),
    currency: varchar("currency", { length: 3 }).notNull().default("BDT"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    email: varchar("email", { length: 254 }),
    teamMemberId: uuid("team_member_id").references(() => teamMembers.id, {
      onDelete: "set null",
    }),
    payrollLineId: uuid("payroll_line_id").references(() => payrollLines.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("bank_advice_lines_advice_idx").on(t.bankAdviceId, t.position)],
);

export type BankAdvice = typeof bankAdvices.$inferSelect;
export type BankAdviceLine = typeof bankAdviceLines.$inferSelect;
