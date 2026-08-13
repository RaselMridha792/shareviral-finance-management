import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { paymentMethodEnum, psrStatusEnum } from "./enums";
import { transactions } from "./transactions";
import { entityKey } from "./shared-columns";

export const engagementTypeEnum = pgEnum("engagement_type", [
  "employee",
  "contractor",
]);

export const employmentStatusEnum = pgEnum("employment_status", [
  "active",
  "on_leave",
  "resigned",
  "terminated",
]);

export const payrollStatusEnum = pgEnum("payroll_status", [
  "draft",
  "finalized",
  "partially_paid",
  "paid",
]);

export const payrollPaymentModeEnum = pgEnum("payroll_payment_mode", [
  "consolidated",
  "individual",
]);

/**
 * People.
 *
 * **The only money here is `joiningSalary` — the figure agreed at hire.** It is
 * a fact about the offer, fixed on the day they joined, and it is visible to
 * anyone who can read the team, HR included. That is intended.
 *
 * Everything about what somebody is *paid* — the current figure, every raise,
 * the history — lives in `compensation_history`, and no HR-facing query joins
 * it. That is what keeps the boundary structural rather than a promise: a
 * field-stripping serializer can be forgotten, a missing join cannot. Adding a
 * column here can never reach that table.
 */
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    employeeCode: text("employee_code").notNull(),
    fullName: text("full_name").notNull(),
    engagementType: engagementTypeEnum("engagement_type")
      .notNull()
      .default("employee"),

    department: text("department"),
    designation: text("designation"),
    joinedOn: date("joined_on").notNull(),
    endedOn: date("ended_on"),
    status: employmentStatusEnum("status").notNull().default("active"),

    personalEmail: text("personal_email"),
    workEmail: text("work_email"),
    phone: text("phone"),

    /** National ID. */
    nid: varchar("nid", { length: 20 }),
    etin: varchar("etin", { length: 12 }),
    /**
     * Employees on a basic salary of BDT 16,000 a month or more must furnish
     * proof they filed a return.
     */
    psrStatus: psrStatusEnum("psr_status").notNull().default("unknown"),
    psrAssessmentYear: varchar("psr_assessment_year", { length: 9 }),

    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankRouting: text("bank_routing"),
    walletProvider: text("wallet_provider"),
    walletNumber: text("wallet_number"),

    address: text("address"),

    /* --- who they are -------------------------------------------------- */

    /**
     * A link, not a file.
     *
     * This app stores no blobs anywhere — a receipt is a Drive link and so is
     * this. It keeps a backup a database dump and nothing else, and it keeps
     * the deployment free of a storage service to lose.
     */
    photoUrl: text("photo_url"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    bloodGroup: varchar("blood_group", { length: 3 }),

    /** `address` above is where they live now; this is home. */
    permanentAddress: text("permanent_address"),

    /* --- retained, no longer collected --------------------------------- */

    /**
     * Kept for rows that already carry values; nothing writes here any more.
     *
     * The company's employee sheet is the specification, and none of these are
     * on it — they were added on a guess about what a Bangladeshi HR record
     * usually holds. `createTeamMemberSchema` no longer accepts them and the
     * form no longer offers them, so a value below is one somebody typed in
     * before that decision.
     *
     * Dropping the columns would destroy that data to satisfy a preference,
     * which is not a trade worth making. Bringing one back is a line in the
     * shared schema and a field in the form — not an archaeology exercise.
     */
    maritalStatus: text("marital_status"),
    spouseName: text("spouse_name"),
    fatherName: text("father_name"),
    motherName: text("mother_name"),
    religion: varchar("religion", { length: 40 }),
    passportNumber: varchar("passport_number", { length: 20 }),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactRelation: varchar("emergency_contact_relation", {
      length: 40,
    }),
    emergencyContactPhone: varchar("emergency_contact_phone", { length: 30 }),
    /** Never a foreign key — a manager who leaves is only soft-deleted. */
    reportingManagerId: uuid("reporting_manager_id"),
    probationUntil: date("probation_until"),
    confirmedOn: date("confirmed_on"),

    /* --- the shape of the job ------------------------------------------ */

    /**
     * What was agreed at hire. The one money column on this table, and the one
     * salary figure HR may see — a fact about the offer, not about payroll.
     * It never changes; raises go to `compensation_history`.
     */
    joiningSalary: numeric("joining_salary", { precision: 14, scale: 2 }),

    /**
     * Superseded by the level/major pair below, which are the two columns the
     * sheet actually has. Kept, not dropped, on the same terms as the block
     * above: it holds what was typed in before the split existed.
     */
    lastQualification: varchar("last_qualification", { length: 120 }),
    educationLevel: text("education_level"),
    /** Free text — the real answers include "Wet Process Engineering". */
    educationMajor: varchar("education_major", { length: 120 }),

    /* --- papers on file ------------------------------------------------ */

    /** Links, like `photoUrl`. Nothing is uploaded to this app. */
    cvUrl: text("cv_url"),
    appointmentLetterUrl: text("appointment_letter_url"),

    notes: text("notes"),

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
    uniqueIndex("team_members_code_idx").on(
      entityKey(t.entityId),
      sql`lower(${t.employeeCode})`,
    ),
    index("team_members_status_idx").on(t.status, t.engagementType),
    index("team_members_name_idx").on(t.fullName),
  ],
);

/**
 * What someone is paid, and since when.
 *
 * A history rather than a single number, so a mid-year raise does not erase
 * what the figure was in January — which is exactly the question an audit asks.
 */
export const compensationHistory = pgTable(
  "compensation_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),

    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("BDT"),

    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),

    changeReason: text("change_reason"),

    /**
     * Room for a basic / house rent / medical / conveyance split without a
     * migration. Bangladesh payslips usually want one eventually.
     */
    components: jsonb("components"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [
    uniqueIndex("compensation_effective_idx").on(
      t.teamMemberId,
      t.effectiveFrom,
    ),
    index("compensation_member_idx").on(t.teamMemberId),
    check("compensation_positive", sql`${t.grossAmount} >= 0`),
  ],
);

/** One month's payroll. */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    label: text("label").notNull(),

    status: payrollStatusEnum("status").notNull().default("draft"),
    paymentMode: payrollPaymentModeEnum("payment_mode")
      .notNull()
      .default("consolidated"),

    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    paymentDate: date("payment_date"),
    paymentMethod: paymentMethodEnum("payment_method")
      .notNull()
      .default("bank_transfer"),

    totalGross: numeric("total_gross", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalAdditions: numeric("total_additions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalTds: numeric("total_tds", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalDeductions: numeric("total_deductions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    totalNet: numeric("total_net", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),

    notes: text("notes"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by"),

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
    uniqueIndex("payroll_runs_period_idx").on(
      entityKey(t.entityId),
      t.periodYear,
      t.periodMonth,
    ),
    check("payroll_runs_month", sql`${t.periodMonth} between 1 and 12`),
  ],
);

/** One person's pay for one month. */
export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payrollRunId: uuid("payroll_run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "restrict" }),

    grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
    bonusAmount: numeric("bonus_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    otherAdditions: numeric("other_additions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),

    /** Typed in by the user — the accountant works it out, the app records it. */
    tdsAmount: numeric("tds_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    otherDeductions: numeric("other_deductions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    deductionNote: text("deduction_note"),

    netAmount: numeric("net_amount", { precision: 14, scale: 2 })
      .notNull()
      .generatedAlwaysAs(
        (): ReturnType<typeof sql> =>
          sql`${payrollLines.grossAmount} + ${payrollLines.bonusAmount} + ${payrollLines.otherAdditions} - ${payrollLines.tdsAmount} - ${payrollLines.otherDeductions}`,
      ),

    isPaid: boolean("is_paid").notNull().default(false),
    paidOn: date("paid_on"),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),

    /**
     * Frozen copies of who they were that month. A payslip issued in July must
     * not change when someone switches bank in September.
     */
    snapshotDesignation: text("snapshot_designation"),
    snapshotDepartment: text("snapshot_department"),
    snapshotBankName: text("snapshot_bank_name"),
    snapshotBankAccount: text("snapshot_bank_account"),
    snapshotEtin: varchar("snapshot_etin", { length: 12 }),

    remarks: text("remarks"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    uniqueIndex("payroll_lines_unique_idx").on(t.payrollRunId, t.teamMemberId),
    index("payroll_lines_member_idx").on(t.teamMemberId),
    check(
      "payroll_lines_non_negative",
      sql`${t.tdsAmount} >= 0 and ${t.otherDeductions} >= 0`,
    ),
  ],
);

export const teamMembersRelations = relations(teamMembers, ({ many }) => ({
  compensation: many(compensationHistory),
  payrollLines: many(payrollLines),
}));

export const payrollRunsRelations = relations(payrollRuns, ({ many, one }) => ({
  lines: many(payrollLines),
  account: one(accounts, {
    fields: [payrollRuns.accountId],
    references: [accounts.id],
  }),
}));

export const payrollLinesRelations = relations(payrollLines, ({ one }) => ({
  run: one(payrollRuns, {
    fields: [payrollLines.payrollRunId],
    references: [payrollRuns.id],
  }),
  member: one(teamMembers, {
    fields: [payrollLines.teamMemberId],
    references: [teamMembers.id],
  }),
}));

export type TeamMember = typeof teamMembers.$inferSelect;
export type Compensation = typeof compensationHistory.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollLine = typeof payrollLines.$inferSelect;
