import { z } from "zod";

import { amountSchema, isoDateSchema } from "./masters.ts";
import { patchOf } from "./patch.ts";
import {
  checkPeriodIndex,
  granularitySchema,
  type Granularity,
} from "./periods.ts";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/* -------------------------------------------------------------------------- */
/*  TDS deposits — the A-Challan                                               */
/* -------------------------------------------------------------------------- */

export const TDS_DEPOSIT_TYPES = ["salary", "vendor", "mixed"] as const;
export const tdsDepositTypeSchema = z.enum(TDS_DEPOSIT_TYPES);
export type TdsDepositType = z.infer<typeof tdsDepositTypeSchema>;

export const TDS_DEPOSIT_TYPE_LABELS: Record<TdsDepositType, string> = {
  salary: "Salary deductions",
  vendor: "Vendor and supplier deductions",
  mixed: "Both",
};

export const createTdsDepositSchema = z.strictObject({
  challanNumber: z.string().trim().min(1, "Enter the challan number").max(60),
  challanDate: isoDateSchema,
  depositDate: isoDateSchema,
  amount: amountSchema,
  bankName: optionalText(80),
  branch: optionalText(80),
  periodYear: z.coerce.number().int().min(2000).max(2200),
  periodMonth: z.coerce.number().int().min(1).max(12),
  depositType: tdsDepositTypeSchema.default("salary"),
  /** When set, a matching money-out entry is written to the ledger. */
  accountId: z.string().uuid().optional(),
  attachmentUrl: optionalText(500),
  notes: optionalText(500),
});
export type CreateTdsDepositInput = z.infer<typeof createTdsDepositSchema>;

/**
 * Correcting a challan that is already recorded.
 *
 * `patchOf` rather than `.partial()`, for the reason that keeps coming up:
 * `.partial()` leaves a field's default inside the now-optional field, so an
 * absent key materialises as the default rather than staying absent — and a
 * PATCH that silently rewrites `depositType` to "salary" because nobody sent
 * it is exactly the kind of quiet wrong this app is careful about.
 *
 * `accountId` is deliberately absent. Creating a deposit with one writes the
 * matching money-out row into the ledger; changing it afterwards would have to
 * move that row between accounts, which is the thing a ledger must refuse. A
 * challan posted against the wrong account is fixed by voiding the ledger entry
 * and recording it again.
 */
export const updateTdsDepositSchema = patchOf(createTdsDepositSchema).omit({
  accountId: true,
});
export type UpdateTdsDepositInput = z.infer<typeof updateTdsDepositSchema>;

export const tdsLiabilityQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type TdsLiabilityQuery = z.infer<typeof tdsLiabilityQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  The salary withholding register                                            */
/* -------------------------------------------------------------------------- */

/**
 * Whose salary was taxed, and by how much, over a period.
 *
 * The period arrives the way every other report's does — a fiscal year, a
 * granularity and an index into it — rather than as a pair of dates. The
 * screen's filter offers monthly, quarterly, half-yearly and yearly, which is
 * exactly `GRANULARITIES`, and only `periodsInFiscalYear` knows whether this
 * company's quarters run Jul–Sep or Jan–Mar. A second way of naming a period
 * here would be a second answer to that question.
 *
 * Both `fiscalYear` and `index` are optional: with neither, the answer is the
 * period we are actually in, which is what somebody opening the page wants.
 */
export const salaryTdsRegisterQuerySchema = z
  .strictObject({
    granularity: granularitySchema.default("month"),
    /** The fiscal year's starting calendar year. */
    fiscalYear: z.coerce.number().int().min(2000).max(2200).optional(),
    /** Which period within it: 1-12 for months, 1-4 quarters, 1-2 halves. */
    index: z.coerce.number().int().min(1).max(12).optional(),
  })
  .superRefine(checkPeriodIndex);
export type SalaryTdsRegisterQuery = z.infer<
  typeof salaryTdsRegisterQuerySchema
>;

/**
 * One person's deduction in one month.
 *
 * `payrollLineId` is here so the row can link straight to that month's payslip.
 * The register answers who and how much; the payslip is where the working
 * behind the figure lives, and an employee asking why never wants the first
 * without the second.
 */
export type SalaryTdsRow = {
  payrollLineId: string;
  teamMemberId: string;
  fullName: string;
  periodYear: number;
  periodMonth: number;
  /** "August 2026" — the month the pay was for, ready to render. */
  periodLabel: string;
  /** What they were paid before deductions, which the tax was worked out from. */
  grossAmount: string;
  tdsAmount: string;
  /**
   * Whether this person's salary actually went out.
   *
   * The line's own flag rather than the run's status: a run can be part paid,
   * and a row that reads "paid" because the run it belongs to is half settled
   * is the kind of half-truth a payroll screen should not print.
   */
  isPaid: boolean;
  /**
   * The challan this person's withheld tax was deposited under, or null while
   * it has not been deposited yet.
   *
   * On the line rather than on the deposit, because this is what the register
   * is read for: an employee asking which challan their tax went in under is
   * asking about their own row. One A-Challan usually covers everybody in a
   * month, so the same number is written on every line of that month — the
   * form does it in one go.
   */
  challanNumber: string | null;
  /**
   * Which row holds the scan behind that number, if anybody attached one.
   *
   * A line rather than a file id, because that is what the documents popup
   * asks for — and it is not always this row: the file is uploaded once, from
   * whichever row the person had open, and every other line carrying the same
   * number opens that one. Uploading it again for each of twenty-five people
   * would be twenty-five copies of one PDF on disk.
   *
   * Null means the number was written down and no paper was attached to it.
   */
  challanFileLineId: string | null;
};

export type SalaryTdsRegister = {
  period: {
    label: string;
    start: string;
    end: string;
    granularity: Granularity;
    fiscalYear: number;
    /** Which period was read — set even when the request named none. */
    index: number;
  };
  rows: SalaryTdsRow[];
  /**
   * How many finalised payroll lines the period has, before the tax filter.
   *
   * `rows` holds only the people who owe something, so an empty table has two
   * possible meanings — no run was finalised, or one was and nobody crossed
   * the threshold. Those are different facts and a screen that states the
   * wrong one is worse than a screen that says nothing.
   */
  linesInPeriod: number;
  /** Tax deducted across the whole period. */
  periodTotal: string;
  /**
   * The calendar month we are in, whatever period is on screen.
   *
   * The page shows one card and this is what it shows. Switching the filter to
   * the year does not change what this month's deduction was, so it cannot be
   * read off `periodTotal`.
   */
  currentMonth: {
    year: number;
    month: number;
    label: string;
    total: string;
  };
};

export const allocateDepositSchema = z.strictObject({
  payrollLineIds: z.array(z.string().uuid()).default([]),
  transactionIds: z.array(z.string().uuid()).default([]),
});
export type AllocateDepositInput = z.infer<typeof allocateDepositSchema>;

/**
 * Writing a challan number onto the register.
 *
 * The number and nothing else: the deposit's own date, bank and amount belong
 * to `tds_deposits`, and asking for them again on a salary row would be the
 * same facts recorded twice, disagreeing by next month.
 */
export const setLineChallanSchema = z.strictObject({
  /**
   * Empty clears it. A challan typed against the wrong month has to be
   * removable, and a form that can only ever write means the correction is
   * "type something else and hope".
   */
  challanNumber: z.string().trim().max(60),
  /**
   * Write it on every line of the same payroll month, not only this one.
   *
   * On by default because that is what actually happens: one A-Challan settles
   * the tax withheld from everybody that month, so the alternative is typing
   * the same number twenty-five times.
   */
  applyToMonth: z.boolean().default(true),
});
export type SetLineChallanInput = z.infer<typeof setLineChallanSchema>;

export const listDepositsQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});
export type ListDepositsQuery = z.infer<typeof listDepositsQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Withholding returns                                                        */
/* -------------------------------------------------------------------------- */

export const FILING_STATUSES = ["pending", "filed", "late"] as const;
export const filingStatusSchema = z.enum(FILING_STATUSES);
export type FilingStatus = z.infer<typeof filingStatusSchema>;

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  pending: "Not filed",
  filed: "Filed",
  late: "Filed late",
};

export const fileReturnSchema = z.strictObject({
  filedOn: isoDateSchema,
  acknowledgementNo: optionalText(60),
  notes: optionalText(500),
});
export type FileReturnInput = z.infer<typeof fileReturnSchema>;

/* -------------------------------------------------------------------------- */
/*  Company income tax                                                         */
/* -------------------------------------------------------------------------- */

export const INCOME_TAX_RECORD_TYPES = [
  "advance_quarter",
  "final_return",
  "adjustment",
  "penalty",
] as const;
export const incomeTaxRecordTypeSchema = z.enum(INCOME_TAX_RECORD_TYPES);
export type IncomeTaxRecordType = z.infer<typeof incomeTaxRecordTypeSchema>;

export const INCOME_TAX_TYPE_LABELS: Record<IncomeTaxRecordType, string> = {
  advance_quarter: "Advance instalment",
  final_return: "Annual return",
  adjustment: "Adjustment",
  penalty: "Penalty",
};

export const INCOME_TAX_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
  "filed",
] as const;
export const incomeTaxStatusSchema = z.enum(INCOME_TAX_STATUSES);
export type IncomeTaxStatus = z.infer<typeof incomeTaxStatusSchema>;

export const INCOME_TAX_STATUS_LABELS: Record<IncomeTaxStatus, string> = {
  pending: "Not paid",
  partially_paid: "Part paid",
  paid: "Paid",
  filed: "Filed",
};

export const updateIncomeTaxSchema = z
  .strictObject({
    amountPayable: amountSchema.optional(),
    /** NBR extends Tax Day by order most years, so this is editable. */
    dueDate: isoDateSchema.optional(),
    notes: optionalText(500),
    returnSubmittedOn: isoDateSchema.optional(),
    acknowledgementNo: optionalText(60),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateIncomeTaxInput = z.infer<typeof updateIncomeTaxSchema>;

export const payIncomeTaxSchema = z.strictObject({
  amount: amountSchema,
  paidOn: isoDateSchema,
  challanNumber: z.string().trim().min(1, "Enter the challan number").max(60),
  challanDate: isoDateSchema,
  accountId: z.string().uuid("Choose the account paying"),
});
export type PayIncomeTaxInput = z.infer<typeof payIncomeTaxSchema>;

export const generateScheduleSchema = z.strictObject({
  /** The income year's starting calendar year: 2026 means Jul 2026–Jun 2027. */
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
});
export type GenerateScheduleInput = z.infer<typeof generateScheduleSchema>;

export const fiscalYearQuerySchema = z.strictObject({
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
});
export type FiscalYearQuery = z.infer<typeof fiscalYearQuerySchema>;

export const listIncomeTaxQuerySchema = z.strictObject({
  assessmentYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/, "Use the form 2027-2028")
    .optional(),
});
export type ListIncomeTaxQuery = z.infer<typeof listIncomeTaxQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  What is still pending — powers the dashboard card                          */
/* -------------------------------------------------------------------------- */

export const pendingQuerySchema = z.strictObject({
  /** Look this far ahead. Anything overdue is always included. */
  withinDays: z.coerce.number().int().min(1).max(365).default(45),
});
export type PendingQuery = z.infer<typeof pendingQuerySchema>;

export type PendingItem = {
  kind:
    "tds_deposit" | "withholding_return" | "advance_tax" | "income_tax_return";
  title: string;
  detail: string;
  /** Set when there is a figure attached; null for a filing with no amount. */
  amount: string | null;
  dueOn: string;
  status: "overdue" | "due_soon" | "upcoming";
  href: string;
};
