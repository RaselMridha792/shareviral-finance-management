import { isoDateSchema } from "@finance/shared";
import { z } from "zod";

/** Fields a spreadsheet column can be mapped onto. */
export const TRANSACTION_FIELDS = [
  "txnDate",
  "description",
  "amount",
  "amountIn",
  "amountOut",
  "direction",
  "categoryName",
  "vendorName",
  "reference",
  "paymentMethod",
  "notes",
] as const;
export type TransactionField = (typeof TRANSACTION_FIELDS)[number];

export const FIELD_LABELS: Record<TransactionField, string> = {
  txnDate: "Date",
  description: "Description",
  amount: "Amount (one column, sign shows direction)",
  amountIn: "Money in (separate column)",
  amountOut: "Money out (separate column)",
  direction: "In or out",
  categoryName: "Category",
  vendorName: "Paid to / received from",
  reference: "Reference",
  paymentMethod: "Payment method",
  notes: "Notes",
};

/**
 * Bank exports write dates every which way, and 03/04/2026 is genuinely
 * ambiguous — so the format is stated rather than guessed.
 */
export const DATE_FORMATS = ["dmy", "mdy", "ymd", "auto"] as const;
export const dateFormatSchema = z.enum(DATE_FORMATS);
export type DateFormat = z.infer<typeof dateFormatSchema>;

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: "Day first — 05/08/2026 is 5 August",
  mdy: "Month first — 05/08/2026 is 8 May",
  ymd: "Year first — 2026-08-05",
  auto: "Work it out from the file",
};

export const mappingSchema = z.strictObject({
  /** Spreadsheet header → our field. Unmapped columns are ignored. */
  columnMap: z.record(z.string(), z.enum(TRANSACTION_FIELDS).nullable()),
  defaults: z.strictObject({
    accountId: z.string().uuid("Choose which account these belong to"),
    dateFormat: dateFormatSchema.default("dmy"),
    /** Used when a row's category is blank or unrecognised. */
    fallbackCategoryId: z.string().uuid().optional(),
    /** When the file has one amount column with no sign or direction. */
    assumeDirection: z.enum(["in", "out"]).optional(),
    /*
     * One rate for the file, stamped on every row it writes — an import is a
     * batch of ledger entries and every ledger entry states a rate:
     * *"puro application a joto dhoroner transaction a hok na keno manually
     * prottekbar rate bosate hobe"*.
     *
     * A statement covers a span of days whose rates differed, so this is the
     * rate the file is read at rather than a claim about each row's own day.
     * Any row that needs its own can be opened and corrected afterwards.
     */
    usdRate: z
      .string()
      .trim()
      .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77")
      .refine((v) => Number(v) > 0, "A rate has to be more than nothing"),
  }),
});
export type MappingInput = z.infer<typeof mappingSchema>;

export const commitSchema = z.strictObject({
  /** Row numbers to leave out — duplicates the user decided against. */
  skipRows: z.array(z.number().int().min(1)).default([]),
});
export type CommitInput = z.infer<typeof commitSchema>;

export const previewQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z
    .enum(["valid", "error", "duplicate", "imported", "skipped"])
    .optional(),
});
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

/** A parsed row, before it becomes a transaction. */
export const parsedRowSchema = z.object({
  txnDate: isoDateSchema,
  description: z.string().min(1),
  amount: z.string(),
  direction: z.enum(["in", "out"]),
  categoryName: z.string().optional(),
  vendorName: z.string().optional(),
  reference: z.string().optional(),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});
export type ParsedRow = z.infer<typeof parsedRowSchema>;
