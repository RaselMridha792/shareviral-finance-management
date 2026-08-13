import { z } from "zod";

import { amountSchema, isoDateSchema } from "./masters.ts";

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

export const tdsLiabilityQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export type TdsLiabilityQuery = z.infer<typeof tdsLiabilityQuerySchema>;

export const allocateDepositSchema = z.strictObject({
  payrollLineIds: z.array(z.string().uuid()).default([]),
  transactionIds: z.array(z.string().uuid()).default([]),
});
export type AllocateDepositInput = z.infer<typeof allocateDepositSchema>;

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
