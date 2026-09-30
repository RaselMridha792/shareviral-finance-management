import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { compensationHistory, payrollLines, teamMembers } from "./team";
import { transactions } from "./transactions";

/**
 * What the HR portal sends to finance (deploy/sql/2026-09-30-hr-link.sql says
 * why, and what each column is): budgets, spends against them, and one-off
 * amounts for a month's salary sheet. Every row is keyed on the HR portal's
 * own id, so a repeated send amends rather than doubles.
 */

export const hrBudgetPeriods = pgTable(
  "hr_budget_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: uuid("external_id").notNull(),
    categoryName: varchar("category_name", { length: 120 }).notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    note: text("note"),
    recordedByName: varchar("recorded_by_name", { length: 120 }).notNull(),
    /** received | approved | refused */
    status: varchar("status", { length: 10 }).notNull().default("received"),
    statusNote: text("status_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    sendCount: integer("send_count").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("hr_budget_periods_external_key").on(t.externalId),
    index("hr_budget_periods_received_idx").on(t.receivedAt.desc()),
  ],
);

export const hrBudgetSpends = pgTable(
  "hr_budget_spends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: uuid("external_id").notNull(),
    /** The budget's HR id — no foreign key: a spend may arrive first. */
    budgetExternalId: uuid("budget_external_id").notNull(),
    spentOn: date("spent_on").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    purpose: varchar("purpose", { length: 500 }).notNull(),
    teamMemberId: uuid("team_member_id").references(() => teamMembers.id, {
      onDelete: "set null",
    }),
    employeeName: varchar("employee_name", { length: 120 }),
    /** proposed | approved — HR's own decision, as sent. */
    hrStatus: varchar("hr_status", { length: 10 }).notNull(),
    hrApprovedByName: varchar("hr_approved_by_name", { length: 120 }),
    hrApprovedAt: timestamp("hr_approved_at", { withTimezone: true }),
    recordedByName: varchar("recorded_by_name", { length: 120 }).notNull(),
    hasReceipt: boolean("has_receipt").notNull().default(false),
    /** received | approved | refused | paid — finance's. */
    status: varchar("status", { length: 10 }).notNull().default("received"),
    statusNote: text("status_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    paidOn: date("paid_on"),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    sendCount: integer("send_count").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("hr_budget_spends_external_key").on(t.externalId),
    index("hr_budget_spends_budget_idx").on(t.budgetExternalId),
    index("hr_budget_spends_received_idx").on(t.receivedAt.desc()),
  ],
);

export const payrollOneOffs = pgTable(
  "payroll_one_offs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: uuid("external_id").notNull(),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    note: varchar("note", { length: 200 }),
    /** The sheet line it was added to; null while waiting. */
    payrollLineId: uuid("payroll_line_id").references(() => payrollLines.id, {
      onDelete: "set null",
    }),
    /** What it added to that line's bonus — an amend moves the difference. */
    appliedAmount: numeric("applied_amount", { precision: 14, scale: 2 }),
    /**
     * Finance's decision (#125) — received, held, approved, refused. Only an
     * approved one-off goes on a sheet. See 2026-09-30-hr-requests.sql.
     */
    status: varchar("status", { length: 10 }).notNull().default("received"),
    statusNote: text("status_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** When it went on a sheet line: the money moved. */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /** On a sheet before approvals existed: approved by nobody, and said so. */
    beforeApprovals: boolean("before_approvals").notNull().default(false),
    sendCount: integer("send_count").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("payroll_one_offs_external_key").on(t.externalId),
    index("payroll_one_offs_month_idx").on(
      t.periodYear,
      t.periodMonth,
      t.teamMemberId,
    ),
    index("payroll_one_offs_line_idx").on(t.payrollLineId),
  ],
);

/**
 * A pay change sent by the HR portal (#125). Only an approval writes the
 * `compensation_history` row, and `compensationId` points at it. Rows with
 * `beforeApprovals` were copied in from pay HR set before this existed.
 */
export const compensationRequests = pgTable(
  "compensation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: uuid("external_id"),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    changeReason: varchar("change_reason", { length: 200 }),
    hrNote: text("hr_note"),
    requestedByName: varchar("requested_by_name", { length: 120 }),
    hrApprovedByName: varchar("hr_approved_by_name", { length: 120 }),
    hrApprovedAt: timestamp("hr_approved_at", { withTimezone: true }),
    status: varchar("status", { length: 10 }).notNull().default("received"),
    statusNote: text("status_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    compensationId: uuid("compensation_id").references(
      () => compensationHistory.id,
      { onDelete: "set null" },
    ),
    beforeApprovals: boolean("before_approvals").notNull().default(false),
    sendCount: integer("send_count").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("compensation_requests_external_key").on(t.externalId),
    index("compensation_requests_status_idx").on(t.status, t.receivedAt),
    index("compensation_requests_member_idx").on(
      t.teamMemberId,
      t.effectiveFrom,
    ),
  ],
);

export type HrBudgetPeriod = typeof hrBudgetPeriods.$inferSelect;
export type HrBudgetSpend = typeof hrBudgetSpends.$inferSelect;
export type PayrollOneOff = typeof payrollOneOffs.$inferSelect;
export type CompensationRequest = typeof compensationRequests.$inferSelect;
